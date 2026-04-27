import { NextResponse } from "next/server";
import { executeQuery, EVENTS_QUERY } from "@/lib/graphql";
import { checkRateLimit } from "@/lib/rate-limit";

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

// The SSI API applies an undocumented result cap per query when browsing
// without a search term, silently dropping events further out in the date
// window. We work around it by splitting the requested range into small
// sub-windows so each request stays well under the cap.
//
// 7 days is chosen to stay safe even when no firearms filter is set: country
// and minLevel are *post-fetch* filters in this route (the SSI GraphQL has no
// params for them), so the cap bites on the unfiltered upstream count, not on
// what the user sees. Bug seen in the wild: browsing a month with discipline
// "All" + country=SWE + minLevel=L2+ used to show only the first ~9 days
// because the single 1-month query was already truncated before SWE/L2+
// filtering ran.
//
// Each sub-window gets its own Next.js fetch-cache entry (revalidate: 3600),
// so the extra requests are cached independently.
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
  // Caller may override the date window; fall back to ±3 months from today.
  const now = new Date();
  const defaultAfter = new Date(now);
  defaultAfter.setMonth(defaultAfter.getMonth() - 3);
  const defaultBefore = new Date(now);
  defaultBefore.setMonth(defaultBefore.getMonth() + 3);

  const country = searchParams.get("country");
  const minLevel = searchParams.get("minLevel") ?? "all";

  // When a text query is present the caller is searching for a specific event
  // and we should not silently clip results to a narrow date window — use a
  // wide fallback (5 years back / 2 years forward) so past matches are found.
  // The narrow ±3-month default applies only to browse mode (no q) where we
  // need the sub-window strategy to work around the SSI API result cap.
  const wideAfter = new Date(now);
  wideAfter.setFullYear(wideAfter.getFullYear() - 5);
  const wideBefore = new Date(now);
  wideBefore.setFullYear(wideBefore.getFullYear() + 2);

  const startsAfter = searchParams.get("starts_after") ??
    (q ? wideAfter.toISOString().slice(0, 10) : defaultAfter.toISOString().slice(0, 10));
  const startsBefore = searchParams.get("starts_before") ??
    (q ? wideBefore.toISOString().slice(0, 10) : defaultBefore.toISOString().slice(0, 10));
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
      const windows = buildSubWindows(startsAfter, startsBefore, firearms ? { firearms } : {});
      const results = await Promise.all(
        windows.map((vars) => executeQuery<RawEventsData>(EVENTS_QUERY, vars, 3600)),
      );
      const seen = new Set<string>();
      rawEvents = [];
      for (const result of results) {
        for (const event of result.events) {
          if (!seen.has(event.id)) {
            seen.add(event.id);
            rawEvents.push(event);
          }
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const events: EventSummary[] = rawEvents
    // All IPSC disciplines (Handgun, Rifle, Shotgun, PCC, etc.) share ct=22.
    // Exclude series nodes (ct=43) — those are event series, not scoreable matches.
    .filter((e) => e.get_content_type_key === 22)
    // Filter by country/region if specified
    .filter((e) => !country || e.region.toUpperCase() === country.toUpperCase())
    // Filter by minimum level (e.g. l2plus keeps only Level II+).
    // "all" (null entry) passes everything; unknown minLevel falls back to l2plus.
    // Any unrecognised level string (e.g. "Unsanctioned") is excluded.
    .filter((e) => {
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
    }));

  console.log(JSON.stringify({
    route: "events",
    has_query: q.length > 0,
    country: country ?? null,
    min_level: minLevel,
    firearms,
    result_count: events.length,
    ms_total: Math.round(performance.now() - t0),
  }));
  return NextResponse.json(events);
}
