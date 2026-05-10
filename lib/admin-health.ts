// Aggregates the last hour / 24h / 7d of telemetry from R2 Parquet files.
// Reads via the TELEMETRY_BUCKET binding (Pipelines writes; we read).
//
// The Pipelines-written rows look like { value: VARCHAR JSON } where the
// JSON is `{"value": <event>}` — we unwrap once to reach the event.

import { parquetReadObjects } from "hyparquet";

interface R2Object {
  key: string;
}
interface R2GetResult {
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface R2Bucket {
  list(opts: { prefix: string; limit?: number }): Promise<{ objects: R2Object[] }>;
  get(key: string): Promise<R2GetResult | null>;
}

interface RawEvent {
  ts?: string;
  domain?: string;
  op?: string;
  // upstream
  operation?: string;
  outcome?: string;
  ms?: number;
  httpStatus?: number;
  // error
  site?: string;
  errorClass?: string;
  errorMsg?: string;
  // cache
  matchKey?: string;
  trulyDone?: boolean;
  ttl?: number | null;
  scoringPct?: number;
  // usage
  level?: string;
  ct?: number;
  scoringBucket?: string;
  cacheHit?: boolean;
}

export interface UpstreamOp {
  operation: string;
  ok: number;
  err: number;
  p50_ms: number;
  p95_ms: number;
}

export interface ErrorBySite {
  site: string;
  count: number;
}

export interface TopMatch {
  match_id: string;
  count: number;
}

export interface RecentError {
  ts: string;
  site: string;
  errorClass?: string;
  errorMsg?: string;
}

export interface DashboardData {
  generated_at: string;
  events_scanned: number;
  files_scanned: number;
  ssi_h1: { ok_pct: number; calls: number; by_op: UpstreamOp[] };
  ssi_h24: { ok_pct: number; calls: number; by_op: UpstreamOp[] };
  app_errors_h1: { count: number; by_site: ErrorBySite[] };
  app_errors_h24: { count: number; by_site: ErrorBySite[] };
  cache_h1: { hit_pct: number; samples: number };
  cache_h24: { hit_pct: number; samples: number };
  usage_today: {
    match_views: number;
    comparisons: number;
    searches: number;
    dashboards: number;
  };
  top_matches_h24: TopMatch[];
  recent_errors: RecentError[];
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export async function buildDashboard(bucket: R2Bucket, now: Date = new Date()): Promise<DashboardData> {
  const events = await loadEventsLast24h(bucket, now);
  return aggregate(events.events, events.filesScanned, now);
}

async function loadEventsLast24h(bucket: R2Bucket, now: Date): Promise<{ events: RawEvent[]; filesScanned: number }> {
  // 24h window can straddle the UTC day boundary; list both yesterday and today.
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10);
  const days = today === yesterday ? [today] : [yesterday, today];

  const keys: string[] = [];
  for (const day of days) {
    const list = await bucket.list({ prefix: `pipelines/cache-telemetry/${day}/` });
    for (const obj of list.objects) {
      if (obj.key.endsWith(".parquet")) keys.push(obj.key);
    }
  }

  const events: RawEvent[] = [];
  await Promise.all(keys.map(async (key) => {
    const r = await bucket.get(key);
    if (!r) return;
    const buf = await r.arrayBuffer();
    let rows: { value?: unknown }[];
    try {
      rows = (await parquetReadObjects({ file: buf })) as { value?: unknown }[];
    } catch {
      return;
    }
    for (const row of rows) {
      const raw = row.value;
      if (typeof raw !== "string") continue;
      try {
        const wrapper = JSON.parse(raw) as { value?: RawEvent };
        const ev = wrapper.value;
        if (ev && typeof ev.ts === "string") events.push(ev);
      } catch {
        // skip malformed row
      }
    }
  }));

  return { events, filesScanned: keys.length };
}

function aggregate(events: RawEvent[], filesScanned: number, now: Date): DashboardData {
  const h1Cutoff = now.getTime() - HOUR_MS;
  const h24Cutoff = now.getTime() - DAY_MS;
  const todayStart = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z").getTime();

  const upstreamH1: RawEvent[] = [];
  const upstreamH24: RawEvent[] = [];
  const errorsH1: RawEvent[] = [];
  const errorsH24: RawEvent[] = [];
  const matchViewsH1: RawEvent[] = [];
  const matchViewsH24: RawEvent[] = [];
  const cacheDecisionsH24: RawEvent[] = [];
  const usageToday: RawEvent[] = [];

  for (const ev of events) {
    const t = parseTs(ev.ts);
    if (t == null) continue;
    if (ev.domain === "upstream") {
      if (t >= h24Cutoff) upstreamH24.push(ev);
      if (t >= h1Cutoff) upstreamH1.push(ev);
    } else if (ev.domain === "error") {
      if (t >= h24Cutoff) errorsH24.push(ev);
      if (t >= h1Cutoff) errorsH1.push(ev);
    } else if (ev.domain === "cache" && ev.op === "match-ttl-decision") {
      if (t >= h24Cutoff) cacheDecisionsH24.push(ev);
    } else if (ev.domain === "usage") {
      if (ev.op === "match-view") {
        if (t >= h24Cutoff) matchViewsH24.push(ev);
        if (t >= h1Cutoff) matchViewsH1.push(ev);
      }
      if (t >= todayStart) usageToday.push(ev);
    }
  }

  return {
    generated_at: now.toISOString(),
    events_scanned: events.length,
    files_scanned: filesScanned,
    ssi_h1: aggregateUpstream(upstreamH1),
    ssi_h24: aggregateUpstream(upstreamH24),
    app_errors_h1: aggregateErrors(errorsH1),
    app_errors_h24: aggregateErrors(errorsH24),
    cache_h1: aggregateCacheHit(matchViewsH1),
    cache_h24: aggregateCacheHit(matchViewsH24),
    usage_today: {
      match_views: usageToday.filter((e) => e.op === "match-view").length,
      comparisons: usageToday.filter((e) => e.op === "comparison").length,
      searches: usageToday.filter((e) => e.op === "search").length,
      dashboards: usageToday.filter((e) => e.op === "shooter-dashboard-view").length,
    },
    top_matches_h24: aggregateTopMatches(cacheDecisionsH24),
    recent_errors: errorsH24
      .sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""))
      .slice(0, 10)
      .map((e) => ({
        ts: e.ts ?? "",
        site: e.site ?? "?",
        errorClass: e.errorClass,
        errorMsg: e.errorMsg,
      })),
  };
}

function parseTs(ts: string | undefined): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
}

function aggregateUpstream(events: RawEvent[]): { ok_pct: number; calls: number; by_op: UpstreamOp[] } {
  const groups = new Map<string, { ok: number; err: number; ms: number[] }>();
  for (const ev of events) {
    const key = ev.operation ?? "?";
    let g = groups.get(key);
    if (!g) {
      g = { ok: 0, err: 0, ms: [] };
      groups.set(key, g);
    }
    if (ev.outcome === "ok") g.ok++;
    else g.err++;
    if (typeof ev.ms === "number" && Number.isFinite(ev.ms)) g.ms.push(ev.ms);
  }
  let totalOk = 0;
  let totalErr = 0;
  const by_op: UpstreamOp[] = [];
  for (const [operation, g] of groups) {
    totalOk += g.ok;
    totalErr += g.err;
    by_op.push({
      operation,
      ok: g.ok,
      err: g.err,
      p50_ms: percentile(g.ms, 0.5),
      p95_ms: percentile(g.ms, 0.95),
    });
  }
  by_op.sort((a, b) => (b.ok + b.err) - (a.ok + a.err));
  const calls = totalOk + totalErr;
  const ok_pct = calls === 0 ? 100 : Math.round((totalOk / calls) * 1000) / 10;
  return { ok_pct, calls, by_op };
}

function aggregateErrors(events: RawEvent[]): { count: number; by_site: ErrorBySite[] } {
  const counts = new Map<string, number>();
  for (const ev of events) {
    const site = ev.site ?? "?";
    counts.set(site, (counts.get(site) ?? 0) + 1);
  }
  const by_site = Array.from(counts, ([site, count]) => ({ site, count }))
    .sort((a, b) => b.count - a.count);
  return { count: events.length, by_site };
}

function aggregateCacheHit(matchViews: RawEvent[]): { hit_pct: number; samples: number } {
  if (matchViews.length === 0) return { hit_pct: 0, samples: 0 };
  const hits = matchViews.filter((e) => e.cacheHit === true).length;
  return {
    hit_pct: Math.round((hits / matchViews.length) * 1000) / 10,
    samples: matchViews.length,
  };
}

function aggregateTopMatches(decisions: RawEvent[]): TopMatch[] {
  const counts = new Map<string, number>();
  // matchKey shape: gql:GetMatch:{"ct":22,"id":"27190"}
  const idRe = /"id":"(\d+)"/;
  for (const ev of decisions) {
    if (!ev.matchKey) continue;
    const m = ev.matchKey.match(idRe);
    if (!m) continue;
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return Array.from(counts, ([match_id, count]) => ({ match_id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const xs = [...sorted].sort((a, b) => a - b);
  const idx = Math.min(xs.length - 1, Math.floor(p * xs.length));
  return Math.round(xs[idx]);
}

// Test-only — exported for unit tests of the pure aggregator.
export const _internal = { aggregate };
