import { NextResponse } from "next/server";
import { executeQuery, EVENTS_QUERY } from "@/lib/graphql";
import { checkRateLimit } from "@/lib/rate-limit";
import { usageTelemetry, bucketCount } from "@/lib/usage-telemetry";
import { markUpstreamDegraded } from "@/lib/upstream-status";

import type { EventSummary } from "@/lib/types";

interface RawEvent {
  id: string;
  get_content_type_key: number;
  name: string;
  venue: string | null;
  starts: string;
  ends: string | null;
  status: string;
  region: string;
  scoring_completed: string | number | null;
  get_full_rule_display: string;
  get_full_level_display: string;
  registration_starts: string | null;
  registration_closes: string | null;
  squadding_starts: string | null;
  squadding_closes: string | null;
  is_registration_possible: boolean;
  is_squadding_possible: boolean;
  max_competitors: number | null;
  registration: string;
}

interface RawEventsData {
  events: RawEvent[];
}

// Which level strings are accepted for each minLevel value.
// null = accept everything (used for "all").
// Unsanctioned/unrecognised level strings are excluded by any non-"all" filter.
const ALLOWED_LEVELS: Record<string, Set<string> | null> = {
  all: null,
  l2plus: new Set(["Level II", "Level III", "Level IV", "Level V"]),
  l3plus: new Set(["Level III", "Level IV", "Level V"]),
  l4plus: new Set(["Level IV", "Level V"]),
};

// ─── DO NOT WIDEN THIS WINDOW WITHOUT MEASURING ─────────────────────────────
//
// The SSI API applies an undocumented result cap per query when browsing
// without a search term, silently dropping events further out in the date
// window. We work around it by splitting the requested range into 7-day
// sub-windows so each request stays well under the cap. Each sub-window gets
// its own Next.js fetch-cache entry (revalidate: 3600), so they cache
// independently.
//
// History — every previous attempt to widen this has caused a user-visible
// regression. Read these BEFORE changing the value:
//
//   #345 (5e9e63b, 2026-04-27) — shrunk from 30 days to 7 after browsing a
//     month with discipline=All + country=SWE + minLevel=L2+ showed only
//     the first ~9 days. SSI's cap bites on the unfiltered worldwide IPSC
//     count, before our post-fetch country/minLevel filters run.
//   #370 (cb57560, 2026-04-28) — widened back to 30 days when `firearms`
//     was set, on the assumption SSI's upstream filter cut the count
//     enough. It does not. Empirical check on staging: a 30-day worldwide
//     query for firearms=hg returned 1 event; same range as 4× 7-day
//     chunks returned 139. Reverted in #371.
//
// The cap bites on whatever SSI returns, regardless of whether we asked it
// to filter upstream. The safe value is 7 days. If you want to widen it,
// measure against the live API for every supported firearms value
// (hg, rfl, shg, pcc, mr, prr, air) AND the unfiltered case, across a full
// 30-day month, and confirm none of them get truncated. Don't guess.
const SUB_WINDOW_DAYS = 7;

function buildSubWindows(
  startsAfter: string,
  startsBefore: string,
  baseVars: Record<string, string>,
): Array<Record<string, string>> {
  const windows: Array<Record<string, string>> = [];
  let cur = new Date(startsAfter);
  const end = new Date(startsBefore);
  while (cur < end) {
    const next = new Date(cur);
    next.setDate(next.getDate() + SUB_WINDOW_DAYS);
    if (next > end) next.setTime(end.getTime());
    windows.push({
      ...baseVars,
      starts_after: cur.toISOString().slice(0, 10),
      starts_before: next.toISOString().slice(0, 10),
    });
    cur = new Date(next);
  }
  return windows;
}

export async function GET(req: Request) {
  const rl = await checkRateLimit(req, { prefix: "events", limit: 30, windowSeconds: 60 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const t0 = performance.now();
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";

  // Query params: q (search), starts_after, starts_before (ISO dates),
  // firearms (default "hg"), country (ISO 3166-1 alpha-3, e.g. "SWE"),
  // minLevel (default "all" — callers omit the param when they want everything).
  //
  // The browse UI (components/event-search.tsx) always sends an explicit
  // 1-month window, so the default below is a fallback only for off-path
  // callers (admin curls, scripts, MCP tools). Kept tight at ±1 month so a
  // bare `GET /api/events` doesn't pull half a year of data.
  const now = new Date();
  const defaultAfter = new Date(now);
  defaultAfter.setMonth(defaultAfter.getMonth() - 1);
  const defaultBefore = new Date(now);
  defaultBefore.setMonth(defaultBefore.getMonth() + 1);

  const country = searchParams.get("country");
  const minLevel = searchParams.get("minLevel") ?? "all";
  // Live mode: surface matches that started recently and are still scoring.
  // Overrides date window + minLevel + sort + limit. Used by the homepage
  // "Live now" section to help users find matches they are attending.
  const liveMode = searchParams.get("live") === "1";

  // When a text query is present the caller is searching for a specific event
  // and we should not silently clip results to a narrow date window — use a
  // wide fallback (5 years back / 2 years forward) so past matches are found.
  // The narrow ±1-month default applies only to browse mode (no q) where we
  // need the sub-window strategy to work around the SSI API result cap.
  const wideAfter = new Date(now);
  wideAfter.setFullYear(wideAfter.getFullYear() - 5);
  const wideBefore = new Date(now);
  wideBefore.setFullYear(wideBefore.getFullYear() + 2);

  // Live mode pins the date window to the past 36 hours so we catch matches
  // that started yesterday and are still scoring today (covers most weekend
  // 2-day club matches and the second day of L3+ events).
  const liveAfter = new Date(now);
  liveAfter.setHours(liveAfter.getHours() - 36);
  const liveBefore = new Date(now);
  liveBefore.setDate(liveBefore.getDate() + 1);

  const startsAfter = liveMode
    ? liveAfter.toISOString().slice(0, 10)
    : (searchParams.get("starts_after") ??
        (q ? wideAfter.toISOString().slice(0, 10) : defaultAfter.toISOString().slice(0, 10)));
  const startsBefore = liveMode
    ? liveBefore.toISOString().slice(0, 10)
    : (searchParams.get("starts_before") ??
        (q ? wideBefore.toISOString().slice(0, 10) : defaultBefore.toISOString().slice(0, 10)));
  const firearms = searchParams.get("firearms") ?? null;

  let rawEvents: RawEvent[];
  try {
    if (q) {
      // Text search: the API's search backend returns good results in one call.
      const data = await executeQuery<RawEventsData>(
        EVENTS_QUERY,
        { starts_after: startsAfter, starts_before: startsBefore, firearms, search: q },
        3600,
      );
      rawEvents = data.events;
    } else {
      // No search text: work around the API's per-request result cap by
      // splitting the date range into small sub-windows, fetching in
      // parallel, then deduplicating by event ID.
      //
      // Use allSettled so one transient SSI hiccup doesn't blank the whole
      // page. SSI occasionally drops POST bodies and surfaces "Must provide
      // document." for a single window; degrading to a partial result (one
      // 7-day gap) is far better UX than a 502 over the entire date range.
      // executeQuery already retries that specific transient internally; we
      // only land here if the retry also failed.
      const windows = buildSubWindows(startsAfter, startsBefore, firearms ? { firearms } : {});
      const settled = await Promise.allSettled(
        windows.map((vars) => executeQuery<RawEventsData>(EVENTS_QUERY, vars, 3600)),
      );
      const failures: string[] = [];
      const seen = new Set<string>();
      rawEvents = [];
      for (let i = 0; i < settled.length; i++) {
        const r = settled[i];
        if (r.status === "fulfilled") {
          for (const event of r.value.events) {
            if (!seen.has(event.id)) {
              seen.add(event.id);
              rawEvents.push(event);
            }
          }
        } else {
          const w = windows[i];
          failures.push(`${w.starts_after}..${w.starts_before}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
        }
      }
      // If every sub-window failed there's nothing useful to return — surface
      // the original 502 so the client error path runs (existing behaviour).
      if (failures.length > 0 && failures.length === windows.length) {
        throw new Error(failures.join(" | "));
      }
      if (failures.length > 0) {
        // Partial outage — flag upstream as degraded so the homepage banner
        // surfaces it. The 60s TTL on the flag means it self-clears once SSI
        // recovers, without us having to write a "healthy again" signal.
        await markUpstreamDegraded("events-route-partial");
        console.warn(JSON.stringify({
          route: "events",
          partial_failure: true,
          failed_windows: failures.length,
          total_windows: windows.length,
          first_error: failures[0],
        }));
      }
    }
  } catch (err) {
    // Total failure — every sub-window failed, or the search call failed.
    // Mark degraded so the homepage banner surfaces it instead of users
    // assuming the scoreboard itself is broken.
    await markUpstreamDegraded(
      "events-route-total",
      err instanceof Error ? err.name : null,
    );
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Post-fetch guard against SSI returning events whose `starts` is outside
  // the requested window (observed: browsing May surfaced matches that started
  // in April, presumably because SSI matches the date filter against
  // ends/registration dates too). We only want events whose start date falls
  // within [startsAfter, startsBefore]. Compare on YYYY-MM-DD prefix so the
  // raw ISO timestamp's timezone doesn't shift events across the boundary.
  const startsAfterDate = startsAfter; // already YYYY-MM-DD
  const startsBeforeDate = startsBefore;

  const events: EventSummary[] = rawEvents
    // All IPSC disciplines (Handgun, Rifle, Shotgun, PCC, etc.) share ct=22.
    // Exclude series nodes (ct=43) — those are event series, not scoreable matches.
    .filter((e) => e.get_content_type_key === 22)
    // Drop events whose start date falls outside the requested window.
    .filter((e) => {
      const startDay = (e.starts ?? "").slice(0, 10);
      if (!startDay) return false;
      return startDay >= startsAfterDate && startDay <= startsBeforeDate;
    })
    // Filter by country/region if specified
    .filter((e) => !country || e.region.toUpperCase() === country.toUpperCase())
    // Filter by minimum level (e.g. l2plus keeps only Level II+).
    // "all" (null entry) passes everything; unknown minLevel falls back to l2plus.
    // Any unrecognised level string (e.g. "Unsanctioned") is excluded.
    // Live mode bypasses the level filter — courtside users want to find
    // their match regardless of sanction level (most weekend matches are L1).
    .filter((e) => {
      if (liveMode) return true;
      const entry = ALLOWED_LEVELS[minLevel];
      const allowed = entry === undefined ? ALLOWED_LEVELS.l2plus : entry;
      return allowed === null || allowed.has(e.get_full_level_display);
    })
    // Sort by start date descending (upcoming/most-recent first)
    .sort((a, b) => new Date(b.starts).getTime() - new Date(a.starts).getTime())
    .map((e) => ({
      id: parseInt(e.id, 10),
      content_type: e.get_content_type_key,
      name: e.name,
      venue: e.venue || null,
      date: e.starts,
      ends: e.ends ?? null,
      status: e.status,
      region: e.region,
      discipline: e.get_full_rule_display,
      level: e.get_full_level_display,
      registration_status: e.registration ?? "cl",
      registration_starts: e.registration_starts ?? null,
      registration_closes: e.registration_closes ?? null,
      is_registration_possible: e.is_registration_possible ?? false,
      squadding_starts: e.squadding_starts ?? null,
      squadding_closes: e.squadding_closes ?? null,
      is_squadding_possible: e.is_squadding_possible ?? false,
      max_competitors: e.max_competitors ?? null,
      scoring_completed:
        e.scoring_completed != null ? parseFloat(String(e.scoring_completed)) : 0,
    }));

  // Live mode post-filter: only matches with status=on and active scoring,
  // capped at 8 to keep the homepage section compact on mobile.
  const finalEvents: EventSummary[] = liveMode
    ? events
        .filter((e) => e.status === "on" && e.scoring_completed > 0 && e.scoring_completed < 100)
        .slice(0, 8)
    : events;

  console.log(JSON.stringify({
    route: "events",
    has_query: q.length > 0,
    live_mode: liveMode,
    country: country ?? null,
    min_level: minLevel,
    firearms,
    result_count: finalEvents.length,
    ms_total: Math.round(performance.now() - t0),
  }));

  if (q.length > 0) {
    usageTelemetry({
      op: "search",
      kind: "events",
      queryLength: q.length,
      resultBucket: bucketCount(finalEvents.length),
    });
  } else {
    usageTelemetry({
      op: "browse",
      kind: "events",
      resultBucket: bucketCount(finalEvents.length),
    });
  }

  return NextResponse.json(finalEvents);
}
