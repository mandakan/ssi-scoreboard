#!/usr/bin/env node
/**
 * Cache warming script for historical IPSC matches.
 *
 * Fetches match data directly from the SSI GraphQL API and writes it to Redis
 * using the same cache key/value format as the app — WITHOUT calling
 * recordMatchAccess(), so the popular-matches sorted sets are not affected.
 *
 * Intended use: run manually after a CACHE_SCHEMA_VERSION bump to re-warm
 * completed matches so the first real user request is served from cache.
 * Only targets historical matches (started ≥ 4 days ago).
 *
 * Usage (from repo root):
 *   npx tsx scripts/warm-cache.ts [options]
 *   pnpm tsx scripts/warm-cache.ts [options]
 *
 * Options:
 *   --level <l2plus|l3plus|l4plus|all>   Min event level (default: l3plus)
 *   --country <ISO-3>                    Filter by country, e.g. SWE (default: all)
 *   --after  <YYYY-MM-DD>                Fetch matches starting after (default: 1 year ago)
 *   --before <YYYY-MM-DD>                Fetch matches starting before (default: 4 days ago)
 *   --delay  <ms>                        Delay between GraphQL requests (default: 5000)
 *   --jitter                             Add ±50% random jitter to each delay
 *   --limit  <n>                         Max matches to warm (default: unlimited)
 *   --skip-scorecards                    Only warm GetMatch, skip GetMatchScorecards
 *   --dry-run                            List matches without writing to cache
 *   --force                              Re-warm even if already cached at current schema version
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import IORedis from "ioredis";
import { Redis as UpstashRedis } from "@upstash/redis";

// ─── Inline constants (keep in sync with lib/constants.ts) ───────────────────

const CACHE_SCHEMA_VERSION = 3;
const GRAPHQL_ENDPOINT = "https://shootnscoreit.com/graphql/";

// ─── Inline TTL logic (keep in sync with lib/match-ttl.ts) ───────────────────

function computeMatchTtl(
  scoringPct: number,
  daysSince: number,
  dateStr: string | null,
): number | null {
  if (scoringPct >= 95 || daysSince > 3) return null; // permanent
  if (scoringPct > 0) return 30;
  if (dateStr) {
    const hoursUntil = (new Date(dateStr).getTime() - Date.now()) / 3_600_000;
    if (hoursUntil > 7 * 24) return 4 * 60 * 60;
    if (hoursUntil > 2 * 24) return 60 * 60;
    if (hoursUntil > 0) return 30 * 60;
    if (hoursUntil > -12) return 5 * 60;
  }
  return 30;
}

// ─── Inline level filter (keep in sync with app/api/events/route.ts) ─────────

const ALLOWED_LEVELS: Record<string, Set<string> | null> = {
  all: null,
  l2plus: new Set(["Level II", "Level III", "Level IV", "Level V"]),
  l3plus: new Set(["Level III", "Level IV", "Level V"]),
  l4plus: new Set(["Level IV", "Level V"]),
};

// ─── Inline GraphQL queries (keep in sync with lib/graphql.ts) ───────────────

const EVENTS_QUERY = `
  query GetEvents($search: String, $starts_after: String, $starts_before: String, $firearms: String) {
    events(rule: "ip", firearms: $firearms, search: $search, starts_after: $starts_after, starts_before: $starts_before) {
      id
      get_content_type_key
      name
      venue
      starts
      status
      region
      get_full_rule_display
      get_full_level_display
    }
  }
`;

const MATCH_QUERY = `
  query GetMatch($ct: Int!, $id: String!) {
    event(content_type: $ct, id: $id) {
      id
      get_content_type_key
      name
      venue
      starts
      scoring_completed
      ... on IpscMatchNode {
        region
        sub_rule
        level
        stages_count
        competitors_count
        image {
          url
          width
          height
        }
        stages {
          id
          number
          name
          ... on IpscStageNode {
            max_points
            minimum_rounds
            paper
            popper
            plate
            get_full_absolute_url
          }
        }
        competitors_approved_w_wo_results_not_dnf {
          id
          get_content_type_key
          ... on IpscCompetitorNode {
            first_name
            last_name
            number
            club
            handgun_div
            get_handgun_div_display
            shoots_handgun_major
          }
        }
        squads {
          id
          ... on IpscSquadNode {
            number
            get_squad_display
            competitors {
              id
            }
          }
        }
      }
    }
  }
`;

const SCORECARDS_QUERY = `
  query GetMatchScorecards($ct: Int!, $id: String!) {
    event(content_type: $ct, id: $id) {
      ... on IpscMatchNode {
        stages {
          id
          number
          name
          ... on IpscStageNode {
            max_points
          }
          scorecards {
            ... on IpscScoreCardNode {
              created
              points
              hitfactor
              time
              disqualified
              zeroed
              stage_not_fired
              incomplete
              ascore
              bscore
              cscore
              dscore
              miss
              penalty
              procedural
              competitor {
                id
                ... on IpscCompetitorNode {
                  first_name
                  last_name
                  number
                  club
                  handgun_div
                  get_handgun_div_display
                }
              }
            }
          }
        }
      }
    }
  }
`;

// ─── .env.local loader ───────────────────────────────────────────────────────

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ─── CLI argument parser ──────────────────────────────────────────────────────

interface CliArgs {
  level: string;
  country: string | null;
  after: string;
  before: string;
  delay: number;
  jitter: boolean;
  limit: number | null;
  skipScorecards: boolean;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(): CliArgs {
  const now = new Date();
  const defaultAfter = new Date(now);
  defaultAfter.setFullYear(defaultAfter.getFullYear() - 1);
  const defaultBefore = new Date(now);
  defaultBefore.setDate(defaultBefore.getDate() - 4); // historical only

  const args = process.argv.slice(2);
  const get = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
  };
  const has = (flag: string): boolean => args.includes(flag);

  return {
    level: get("--level") ?? "l3plus",
    country: get("--country"),
    after: get("--after") ?? defaultAfter.toISOString().slice(0, 10),
    before: get("--before") ?? defaultBefore.toISOString().slice(0, 10),
    delay: parseInt(get("--delay") ?? "5000", 10),
    jitter: has("--jitter"),
    limit: get("--limit") !== null ? parseInt(get("--limit")!, 10) : null,
    skipScorecards: has("--skip-scorecards"),
    dryRun: has("--dry-run"),
    force: has("--force"),
  };
}

// ─── GraphQL fetch ────────────────────────────────────────────────────────────

async function gqlFetch<T>(
  query: string,
  variables: Record<string, unknown>,
  apiKey: string,
): Promise<T> {
  const operationName = query.match(/query\s+(\w+)/)?.[1] ?? "unknown";
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Api-Key ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const retryAfter = response.headers.get("Retry-After");
    throw new Error(
      `${operationName} HTTP ${response.status}${retryAfter ? ` (Retry-After: ${retryAfter}s)` : ""}`,
    );
  }

  const result = (await response.json()) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join("; "));
  }
  if (!result.data) throw new Error(`${operationName}: empty response`);
  return result.data;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function gqlCacheKey(operationName: string, variables: Record<string, unknown>): string {
  return `gql:${operationName}:${JSON.stringify(variables)}`;
}

// ─── Cache client abstraction ─────────────────────────────────────────────────
// Allows the script to target either Upstash (REST) or ioredis (binary protocol)
// without changing any warming logic. Key prefix is applied inside the client.

interface SimpleCacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl: number | null): Promise<void>;
  quit(): Promise<void>;
}

async function createCacheClient(): Promise<SimpleCacheClient> {
  const prefix = process.env.CACHE_KEY_PREFIX ?? "";
  const pk = (key: string) => `${prefix}${key}`;

  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (upstashUrl && upstashToken) {
    const redis = new UpstashRedis({ url: upstashUrl, token: upstashToken, automaticDeserialization: false });
    // Smoke-test the connection before starting the warm run
    try {
      await redis.ping();
    } catch (err) {
      console.error(`Upstash connection failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
    const host = new URL(upstashUrl).hostname;
    console.log(`Redis        : Upstash (${host})${prefix ? `  prefix="${prefix}"` : ""}`);
    return {
      async get(key) { return redis.get<string>(pk(key)); },
      async set(key, value, ttl) {
        if (ttl === null) await redis.set(pk(key), value);
        else await redis.set(pk(key), value, { ex: ttl });
      },
      async quit() { /* no-op — Upstash is stateless HTTP */ },
    };
  }

  // Fall back to ioredis for Docker / local Redis
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const redis = new IORedis(redisUrl, { lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 2 });
  try {
    await redis.connect();
  } catch (err) {
    console.error(`Redis connection failed (${redisUrl}): ${err instanceof Error ? err.message : err}`);
    await redis.quit().catch(() => {});
    process.exit(1);
  }
  console.log(`Redis        : ioredis (${redisUrl})${prefix ? `  prefix="${prefix}"` : ""}`);
  return {
    async get(key) { return redis.get(pk(key)); },
    async set(key, value, ttl) {
      if (ttl === null) await redis.set(pk(key), value);
      else await redis.set(pk(key), value, "EX", ttl);
    },
    async quit() { await redis.quit(); },
  };
}

async function isCachedAtCurrentVersion(client: SimpleCacheClient, key: string): Promise<boolean> {
  try {
    const raw = await client.get(key);
    if (!raw) return false;
    const entry = JSON.parse(raw) as { v?: number };
    return entry.v === CACHE_SCHEMA_VERSION;
  } catch {
    return false;
  }
}

async function writeToCache(
  client: SimpleCacheClient,
  key: string,
  data: unknown,
  ttl: number | null,
): Promise<void> {
  const entry = {
    data,
    cachedAt: new Date().toISOString(),
    v: CACHE_SCHEMA_VERSION,
  };
  await client.set(key, JSON.stringify(entry), ttl);
}

// ─── Event fetching with sub-window strategy ──────────────────────────────────
// Mirrors app/api/events/route.ts to work around the SSI API's result cap.

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

async function fetchEvents(
  startsAfter: string,
  startsBefore: string,
  apiKey: string,
): Promise<RawEvent[]> {
  const windows: Array<{ starts_after: string; starts_before: string }> = [];
  let cur = new Date(startsAfter);
  const end = new Date(startsBefore);
  while (cur < end) {
    const next = new Date(cur);
    next.setMonth(next.getMonth() + 2);
    if (next > end) next.setTime(end.getTime());
    windows.push({
      starts_after: cur.toISOString().slice(0, 10),
      starts_before: next.toISOString().slice(0, 10),
    });
    cur = new Date(next);
  }

  const results = await Promise.all(
    windows.map((vars) =>
      gqlFetch<{ events: RawEvent[] }>(EVENTS_QUERY, { ...vars, firearms: "hg" }, apiKey),
    ),
  );

  const seen = new Set<string>();
  const events: RawEvent[] = [];
  for (const result of results) {
    for (const ev of result.events) {
      if (!seen.has(ev.id)) {
        seen.add(ev.id);
        events.push(ev);
      }
    }
  }
  return events;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Load .env.local from cwd (expected: repo root) or the scripts/ parent
  loadEnvFile(join(process.cwd(), ".env.local"));

  const apiKey = process.env.SSI_API_KEY;
  if (!apiKey) {
    console.error("Error: SSI_API_KEY is not set (check .env.local or environment)");
    process.exit(1);
  }

  const args = parseArgs();

  const levelAllowed = args.level in ALLOWED_LEVELS
    ? ALLOWED_LEVELS[args.level]
    : ALLOWED_LEVELS.l3plus;

  console.log("SSI cache warmer");
  console.log("─".repeat(50));
  console.log(`Level filter : ${args.level}`);
  console.log(`Country      : ${args.country ?? "all"}`);
  console.log(`Date range   : ${args.after} → ${args.before}`);
  console.log(`Delay        : ${args.delay}ms between requests${args.jitter ? " ±50% jitter" : ""}`);
  console.log(`Scorecards   : ${args.skipScorecards ? "skip" : "include"}`);
  console.log(`Mode         : ${args.dryRun ? "DRY RUN (no writes)" : args.force ? "force re-warm" : "normal (skip already cached)"}`);
  if (args.limit) console.log(`Limit        : ${args.limit} matches`);
  console.log("─".repeat(50));

  // ── Fetch event list ──────────────────────────────────────────────────────

  process.stdout.write("Fetching event list... ");
  let rawEvents: RawEvent[];
  try {
    rawEvents = await fetchEvents(args.after, args.before, apiKey);
  } catch (err) {
    console.error(`\nFailed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Apply filters: ct=22, country, level, historical only (≥4 days ago)
  const fourDaysAgo = Date.now() - 4 * 86_400_000;
  const filtered = rawEvents
    .filter((e) => e.get_content_type_key === 22)
    .filter((e) => !args.country || e.region.toUpperCase() === args.country.toUpperCase())
    .filter((e) => {
      if (levelAllowed === null) return true;
      return levelAllowed.has(e.get_full_level_display);
    })
    .filter((e) => new Date(e.starts).getTime() <= fourDaysAgo)
    .sort((a, b) => new Date(b.starts).getTime() - new Date(a.starts).getTime());

  const matches = args.limit !== null ? filtered.slice(0, args.limit) : filtered;
  console.log(`found ${rawEvents.length} raw events → ${filtered.length} after filters${args.limit !== null ? ` → ${matches.length} after limit` : ""}`);

  if (matches.length === 0) {
    console.log("Nothing to warm.");
    return;
  }

  if (args.dryRun) {
    console.log("\nMatches that would be warmed:");
    for (const m of matches) {
      console.log(`  [ct=22 id=${m.id}] ${m.starts.slice(0, 10)}  ${m.get_full_level_display}  ${m.region}  ${m.name}`);
    }
    return;
  }

  // ── Connect to Redis ──────────────────────────────────────────────────────

  const client = await createCacheClient();

  // ── Warm each match ───────────────────────────────────────────────────────

  let warmed = 0;
  let skipped = 0;
  let failed = 0;
  const ct = 22;
  const sessionStart = Date.now();

  for (let i = 0; i < matches.length; i++) {
    const ev = matches[i];
    const id = ev.id;

    console.log(`\n[${i + 1}/${matches.length}] ${ev.name}`);
    console.log(`      ${ev.starts.slice(0, 10)}  ${ev.get_full_level_display}  ${ev.region}`);

    // ── GetMatch ─────────────────────────────────────────────────────────

    const matchKey = gqlCacheKey("GetMatch", { ct, id });
    const matchCached = !args.force && await isCachedAtCurrentVersion(client, matchKey);

    if (!matchCached) {
      const t0 = Date.now();
      try {
        const data = await gqlFetch(MATCH_QUERY, { ct, id }, apiKey);
        const fetchMs = Date.now() - t0;

        // Determine TTL from match state
        const ev2 = (data as { event?: { scoring_completed?: string | number | null; starts?: string | null } }).event;
        const scoringPct = ev2 ? Math.round(parseFloat(String(ev2.scoring_completed ?? 0))) : 0;
        const matchDate = ev2?.starts ? new Date(ev2.starts) : null;
        const daysSince = matchDate ? (Date.now() - matchDate.getTime()) / 86_400_000 : 99;
        const ttl = computeMatchTtl(scoringPct, daysSince, ev2?.starts ?? null);

        if (scoringPct > 0 && scoringPct < 95 && daysSince <= 3) {
          opLine("GetMatch", "SKIP", `still active (${scoringPct}% scored)`, fetchMs);
          failed++;
          continue;
        }

        await writeToCache(client, matchKey, data, ttl);
        opLine("GetMatch", "ok", ttl === null ? "permanent" : `ttl=${ttl}s`, fetchMs);
        warmed++;
      } catch (err) {
        opLine("GetMatch", "FAIL", err instanceof Error ? err.message : String(err), Date.now() - t0);
        failed++;
        await wait(args.delay, args.jitter);
        continue;
      }

      await wait(args.delay, args.jitter);
    } else {
      opLine("GetMatch", "skip", `cached v${CACHE_SCHEMA_VERSION}`);
      skipped++;
    }

    if (args.skipScorecards) {
      printProgress(i + 1, matches.length, sessionStart);
      continue;
    }

    // ── GetMatchScorecards ───────────────────────────────────────────────

    const scorecardsKey = gqlCacheKey("GetMatchScorecards", { ct, id });
    const scorecardsCached = !args.force && await isCachedAtCurrentVersion(client, scorecardsKey);

    if (!scorecardsCached) {
      const t0 = Date.now();
      try {
        const data = await gqlFetch(SCORECARDS_QUERY, { ct, id }, apiKey);
        await writeToCache(client, scorecardsKey, data, null);
        opLine("GetMatchScorecards", "ok", "permanent", Date.now() - t0);
      } catch (err) {
        opLine("GetMatchScorecards", "FAIL", err instanceof Error ? err.message : String(err), Date.now() - t0);
        failed++;
      }

      await wait(args.delay, args.jitter);
    } else {
      opLine("GetMatchScorecards", "skip", `cached v${CACHE_SCHEMA_VERSION}`);
    }

    printProgress(i + 1, matches.length, sessionStart);
  }

  await client.quit();

  const totalMs = Date.now() - sessionStart;
  console.log("\n" + "─".repeat(50));
  console.log(`Done in ${formatDuration(totalMs)}  ·  warmed=${warmed}  skipped=${skipped}  failed=${failed}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait for `base` ms, optionally applying ±50% uniform jitter. */
async function wait(base: number, jitter: boolean): Promise<void> {
  const ms = jitter
    ? Math.round(base * (0.5 + Math.random())) // uniform in [0.5×, 1.5×]
    : base;
  console.log(`  waiting ${formatDuration(ms)}`);
  await sleep(ms);
}

// ─── CLI output helpers ───────────────────────────────────────────────────────

const OP_COL = 20; // width of the operation name column

/** Print a single operation result line, e.g. "  GetMatch            ok   45ms" */
function opLine(op: string, status: string, detail: string, ms?: number): void {
  const parts = [
    "  " + op.padEnd(OP_COL),
    status.padEnd(4),
    detail,
    ms !== undefined ? `  ${formatDuration(ms)}` : "",
  ];
  console.log(parts.join("  ").trimEnd());
}

/** Print an ASCII progress bar with ETA after each completed match. */
function printProgress(done: number, total: number, startMs: number): void {
  if (total <= 1) return; // no point showing progress for a single match
  const elapsed = Date.now() - startMs;
  const pct = Math.round((done / total) * 100);
  const barWidth = 28;
  const filled = Math.round((done / total) * barWidth);
  const bar = "[" + "█".repeat(filled) + "░".repeat(barWidth - filled) + "]";
  const parts: string[] = [bar, `${done}/${total}`, `${pct}%`, `elapsed ${formatDuration(elapsed)}`];
  if (done < total) {
    const eta = Math.round((elapsed / done) * (total - done));
    parts.push(`ETA ~${formatDuration(eta)}`);
  }
  console.log("\n" + parts.join("  "));
}

/** Format a millisecond duration as a human-readable string. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s < 10 ? "0" : ""}${s}s`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
