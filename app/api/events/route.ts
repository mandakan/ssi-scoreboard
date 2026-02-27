import { NextResponse } from "next/server";
import { executeQuery, EVENTS_QUERY } from "@/lib/graphql";

import type { EventSummary } from "@/lib/types";

interface RawEvent {
  id: string;
  get_content_type_key: number;
  name: string;
  venue: string | null;
  starts: string;
  status: string;
  region: string;
  get_full_rule_display: string;
  get_full_level_display: string;
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
// window. Splitting into 2-month sub-windows keeps each request small enough
// to fall within the cap, so all events in the full range are returned.
// Each sub-window gets its own Next.js fetch-cache entry (revalidate: 3600).
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
    next.setMonth(next.getMonth() + 2);
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
  const t0 = performance.now();
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";

  // Query params: q (search), starts_after, starts_before (ISO dates),
  // firearms (default "hg"), country (ISO 3166-1 alpha-3, e.g. "SWE"),
  // minLevel (default "l2plus" — hides Level I club matches).
  // Caller may override the date window; fall back to ±3 months from today.
  const now = new Date();
  const defaultAfter = new Date(now);
  defaultAfter.setMonth(defaultAfter.getMonth() - 3);
  const defaultBefore = new Date(now);
  defaultBefore.setMonth(defaultBefore.getMonth() + 3);

  const country = searchParams.get("country");
  const minLevel = searchParams.get("minLevel") ?? "l2plus";

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
  const firearms = searchParams.get("firearms") ?? "hg";

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
      // splitting the date range into 2-month sub-windows, fetching in
      // parallel, then deduplicating by event ID.
      const windows = buildSubWindows(startsAfter, startsBefore, { firearms });
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
    // Only include match nodes (ct=22), not series (ct=43)
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
      status: e.status,
      region: e.region,
      discipline: e.get_full_rule_display,
      level: e.get_full_level_display,
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
