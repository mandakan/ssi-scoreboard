// Pure sub-window construction for the events browse query. Extracted from
// app/api/events/route.ts after the 2026-08-15 SSI incident so the clamp and
// windowing logic are unit-testable.

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
export const SUB_WINDOW_DAYS = 7;

// ─── DO NOT RAISE THIS CAP WITHOUT A CONVERSATION WITH SSI ──────────────────
//
// Hard ceiling on how many sub-windows (and therefore upstream GetEvents
// queries) a single browse request may generate. Each GetEvents is an
// expensive worldwide search on SSI's side (p95 ~5s observed 2026-08-15).
//
// On 2026-08-15 two browse requests with caller-supplied multi-year date
// ranges generated 156 GetEvents queries in ~10 seconds and contributed to
// shootnscoreit.com going down during a live match. The browse UI only ever
// requests 1 month (~5 windows); 10 windows (70 days) covers every
// legitimate caller with headroom. Wider caller ranges are truncated,
// anchored at the range start — callers wanting more must page with
// multiple requests, which the per-IP/per-token rate limits then bound.
export const MAX_SUB_WINDOWS = 10;

/** Next fetch-cache revalidate (seconds) for one sub-window. A window whose
 *  `starts_before` is entirely in the past cannot gain new events — cache it
 *  24h instead of 1h (#504). Compare on YYYY-MM-DD strings. Edge case: a
 *  match added retroactively to a past week appears up to a day late in
 *  browse; text search is unaffected. */
export const PAST_WINDOW_REVALIDATE_SECONDS = 86_400;
export const UPCOMING_WINDOW_REVALIDATE_SECONDS = 3_600;

export function windowRevalidateSeconds(startsBefore: string, todayYmd: string): number {
  return startsBefore < todayYmd ? PAST_WINDOW_REVALIDATE_SECONDS : UPCOMING_WINDOW_REVALIDATE_SECONDS;
}

export interface SubWindowsResult {
  windows: Array<Record<string, string>>;
  /** True when the requested range exceeded the cap and was truncated. */
  clamped: boolean;
}

export function buildSubWindows(
  startsAfter: string,
  startsBefore: string,
  baseVars: Record<string, string>,
): SubWindowsResult {
  const windows: Array<Record<string, string>> = [];
  let cur = new Date(startsAfter);
  const end = new Date(startsBefore);
  let clamped = false;
  while (cur < end) {
    if (windows.length >= MAX_SUB_WINDOWS) {
      clamped = true;
      break;
    }
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
  return { windows, clamped };
}
