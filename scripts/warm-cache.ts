#!/usr/bin/env node
/**
 * Cache warming script for historical IPSC matches.
 *
 * Calls the app's existing API routes with admin authentication
 * (Authorization: Bearer <CACHE_PURGE_SECRET>) to warm the cache.
 * Admin-authenticated requests skip popularity tracking (recordMatchAccess)
 * so the popular-matches sorted sets are not affected.
 *
 * All heavy lifting (GraphQL fetching, cache writes, TTL correction, D1
 * persistence, shooter indexing, fingerprint computation) happens inside the
 * app's route handlers — this script is just an HTTP client.
 *
 * Usage (from repo root):
 *   pnpm tsx scripts/warm-cache.ts [options]
 *
 * Options:
 *   --url <base>                           App URL (default: NEXT_PUBLIC_APP_URL or http://localhost:3000)
 *   --level <all|l2plus|l3plus|l4plus>     Min event level (default: l3plus)
 *   --country <ISO-3>                      Filter by country, e.g. SWE (default: all)
 *   --after  <YYYY-MM-DD>                  Fetch matches starting after (default: 5 years ago)
 *   --before <YYYY-MM-DD>                  Fetch matches starting before (default: 4 days ago)
 *   --delay  <ms>                          Delay between requests (default: 2000)
 *   --jitter                               Add ±50% random jitter to each delay
 *   --limit  <n>                           Max matches to warm (default: unlimited)
 *   --skip-scorecards                      Only warm GetMatch, skip compare call
 *   --dry-run                              List matches without warming
 *   --force                                Purge + re-warm (calls purge endpoint first)
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

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
  url: string;
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
  defaultAfter.setFullYear(defaultAfter.getFullYear() - 5);
  const defaultBefore = new Date(now);
  defaultBefore.setDate(defaultBefore.getDate() - 4);

  const args = process.argv.slice(2);
  const get = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
  };
  const has = (flag: string): boolean => args.includes(flag);

  return {
    url: get("--url") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    level: get("--level") ?? "l3plus",
    country: get("--country"),
    after: get("--after") ?? defaultAfter.toISOString().slice(0, 10),
    before: get("--before") ?? defaultBefore.toISOString().slice(0, 10),
    delay: parseInt(get("--delay") ?? "2000", 10),
    jitter: has("--jitter"),
    limit: get("--limit") !== null ? parseInt(get("--limit")!, 10) : null,
    skipScorecards: has("--skip-scorecards"),
    dryRun: has("--dry-run"),
    force: has("--force"),
  };
}

// ─── HTTP fetch with retry + back-off ───────────────────────────────────────

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 10_000;

async function apiFetch<T>(
  url: string,
  authHeader: string,
  method: "GET" | "DELETE" = "GET",
): Promise<{ data: T; status: number }> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      method,
      headers: { Authorization: authHeader },
    });

    if (!response.ok) {
      const status = response.status;
      const retryable = status === 429 || status >= 500;
      if (!retryable || attempt === MAX_RETRIES) {
        let body = "";
        try { body = (await response.text()).slice(0, 200); } catch { /* ignore */ }
        throw new Error(`HTTP ${status} ${response.statusText}${body ? `: ${body}` : ""}`);
      }

      const retryAfterHeader = response.headers.get("Retry-After");
      const backoffMs = retryAfterHeader
        ? parseInt(retryAfterHeader, 10) * 1000
        : BACKOFF_BASE_MS * Math.pow(2, attempt);

      console.log(`  [retry ${attempt + 1}/${MAX_RETRIES}] HTTP ${status} — waiting ${formatDuration(backoffMs)}`);
      await sleep(backoffMs);
      continue;
    }

    const data = (await response.json()) as T;
    return { data, status: response.status };
  }

  throw new Error("Exceeded retries");
}

// ─── Types for API responses ─────────────────────────────────────────────────

interface EventSummary {
  id: number;
  content_type: number;
  name: string;
  venue: string | null;
  date: string;
  status: string;
  region: string;
  discipline: string;
  level: string;
}

interface MatchResponse {
  name: string;
  scoring_completed: number;
  competitors_count: number;
  stages_count: number;
  date: string | null;
  competitors: Array<{ id: number }>;
  cacheInfo: { cachedAt: string | null };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnvFile(join(process.cwd(), ".env.local"));

  const secret = process.env.CACHE_PURGE_SECRET;
  if (!secret) {
    console.error("Error: CACHE_PURGE_SECRET is not set (check .env.local or environment)");
    process.exit(1);
  }

  const args = parseArgs();
  const authHeader = `Bearer ${secret}`;
  const baseUrl = args.url.replace(/\/$/, "");

  const validLevels = new Set(["all", "l2plus", "l3plus", "l4plus"]);
  if (!validLevels.has(args.level)) {
    console.error(`Error: unknown --level "${args.level}". Valid values: ${[...validLevels].join(", ")}`);
    process.exit(1);
  }

  console.log("SSI cache warmer (HTTP client)");
  console.log("─".repeat(50));
  console.log(`App URL      : ${baseUrl}`);
  console.log(`Level filter : ${args.level}`);
  console.log(`Country      : ${args.country ?? "all"}`);
  console.log(`Date range   : ${args.after} → ${args.before}`);
  console.log(`Delay        : ${args.delay}ms between requests${args.jitter ? " ±50% jitter" : ""}`);
  console.log(`Scorecards   : ${args.skipScorecards ? "skip" : "include"}`);
  console.log(`Mode         : ${args.dryRun ? "DRY RUN (no requests)" : args.force ? "force re-warm" : "normal (skip already cached)"}`);
  if (args.limit !== null) console.log(`Warm limit   : ${args.limit} matches`);
  console.log("─".repeat(50));

  // ── Fetch event list via /api/events ──────────────────────────────────────

  process.stdout.write("Fetching event list... ");

  const eventsParams = new URLSearchParams({
    starts_after: args.after,
    starts_before: args.before,
    minLevel: args.level,
    firearms: "hg",
  });
  if (args.country) eventsParams.set("country", args.country);

  let events: EventSummary[];
  try {
    const result = await apiFetch<EventSummary[]>(
      `${baseUrl}/api/events?${eventsParams}`,
      authHeader,
    );
    events = result.data;
  } catch (err) {
    console.error(`\nFailed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Filter to historical only (≥4 days ago)
  const fourDaysAgo = Date.now() - 4 * 86_400_000;
  const filtered = events
    .filter((e) => new Date(e.date).getTime() <= fourDaysAgo)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  console.log(`found ${events.length} events → ${filtered.length} historical${args.limit !== null ? ` (warm up to ${args.limit})` : ""}`);

  if (filtered.length === 0) {
    console.log("Nothing to warm.");
    return;
  }

  if (args.dryRun) {
    console.log(`\nMatches to warm${args.limit !== null ? ` (up to ${args.limit})` : ""}:`);
    for (const m of filtered.slice(0, args.limit ?? undefined)) {
      console.log(`  [ct=${m.content_type} id=${m.id}] ${m.date.slice(0, 10)}  ${m.level}  ${m.region}  ${m.name}`);
    }
    return;
  }

  // ── Warm each match ─────────────────────────────────────────────────────

  let warmed = 0;
  let skipped = 0;
  let failed = 0;
  const sessionStart = Date.now();

  for (let i = 0; i < filtered.length; i++) {
    if (args.limit !== null && warmed >= args.limit) break;

    const ev = filtered[i];
    const ct = ev.content_type;
    const id = ev.id;

    console.log(`\n[${i + 1}/${filtered.length}] ${ev.name}`);
    console.log(`      ${ev.date.slice(0, 10)}  ${ev.level}  ${ev.region}`);

    // ── Force: purge first ──────────────────────────────────────────────
    if (args.force) {
      try {
        await apiFetch(
          `${baseUrl}/api/admin/cache/purge?ct=${ct}&id=${id}`,
          authHeader,
          "DELETE",
        );
        opLine("Purge", "ok", "cleared Redis + D1");
      } catch (err) {
        opLine("Purge", "FAIL", err instanceof Error ? err.message : String(err));
      }
    }

    // ── Step 1: Warm match data via GET /api/match/{ct}/{id} ────────────
    const t0 = Date.now();
    let matchResponse: MatchResponse;
    try {
      const result = await apiFetch<MatchResponse>(
        `${baseUrl}/api/match/${ct}/${id}`,
        authHeader,
      );
      matchResponse = result.data;
    } catch (err) {
      opLine("GetMatch", "FAIL", err instanceof Error ? err.message : String(err), Date.now() - t0);
      failed++;
      await wait(args.delay, args.jitter);
      continue;
    }

    const fetchMs = Date.now() - t0;
    const scoring = matchResponse.scoring_completed;
    const matchDate = matchResponse.date ? new Date(matchResponse.date) : null;
    const daysSince = matchDate ? (Date.now() - matchDate.getTime()) / 86_400_000 : 99;

    // Skip actively scoring matches
    if (scoring > 0 && scoring < 95 && daysSince <= 3) {
      opLine("GetMatch", "SKIP", `still active (${scoring}% scored)`, fetchMs);
      skipped++;
      await wait(args.delay, args.jitter);
      continue;
    }

    const cacheHit = matchResponse.cacheInfo.cachedAt !== null;
    if (cacheHit && !args.force) {
      opLine("GetMatch", "skip", "cached", fetchMs);
      skipped++;
      // Scorecards are warmed alongside GetMatch — skip Compare and use a
      // minimal delay so already-cached runs don't compound unnecessarily.
      await wait(Math.min(args.delay, 200), false);
      printProgress(i + 1, filtered.length, warmed, args.limit, sessionStart);
      continue;
    }

    opLine("GetMatch", "ok", `${matchResponse.competitors_count} competitors, ${matchResponse.stages_count} stages`, fetchMs);
    warmed++;

    // ── Step 2: Warm scorecards + fingerprints via /api/compare ─────────
    if (!args.skipScorecards && matchResponse.competitors.length > 0) {
      const firstCompId = matchResponse.competitors[0].id;
      const compareParams = new URLSearchParams({
        ct: String(ct),
        id: String(id),
        competitor_ids: String(firstCompId),
        mode: "coaching",
      });

      const t1 = Date.now();
      try {
        await apiFetch(
          `${baseUrl}/api/compare?${compareParams}`,
          authHeader,
        );
        opLine("Compare", "ok", `scorecards + fingerprints`, Date.now() - t1);
      } catch (err) {
        opLine("Compare", "FAIL", err instanceof Error ? err.message : String(err), Date.now() - t1);
      }

      await wait(args.delay, args.jitter);
    } else if (!args.skipScorecards) {
      await wait(args.delay, args.jitter);
    } else {
      // Small delay even when skipping scorecards to avoid hammering the app
      await wait(Math.min(args.delay, 500), args.jitter);
    }

    printProgress(i + 1, filtered.length, warmed, args.limit, sessionStart);
  }

  const totalMs = Date.now() - sessionStart;
  console.log("\n" + "─".repeat(50));
  console.log(`Done in ${formatDuration(totalMs)}  ·  warmed=${warmed}  skipped=${skipped}  failed=${failed}`);
}

// ─── Utility helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wait(base: number, jitter: boolean): Promise<void> {
  const ms = jitter
    ? Math.round(base * (0.5 + Math.random()))
    : base;
  await sleep(ms);
}

const OP_COL = 20;

function opLine(op: string, status: string, detail: string, ms?: number): void {
  const parts = [
    "  " + op.padEnd(OP_COL),
    status.padEnd(4),
    detail,
    ms !== undefined ? `  ${formatDuration(ms)}` : "",
  ];
  console.log(parts.join("  ").trimEnd());
}

function printProgress(
  scanned: number,
  total: number,
  warmed: number,
  limit: number | null,
  startMs: number,
): void {
  const showForLimit = limit !== null && limit > 1;
  const showForTotal = limit === null && total > 1;
  if (!showForLimit && !showForTotal) return;

  const elapsed = Date.now() - startMs;
  const barWidth = 28;
  const parts: string[] = [];

  if (limit !== null) {
    const ratio = Math.min(1, warmed / limit);
    const filled = Math.round(ratio * barWidth);
    const bar = "[" + "█".repeat(filled) + "░".repeat(barWidth - filled) + "]";
    parts.push(bar, `warmed ${warmed}/${limit}`, `scanned ${scanned}/${total}`, `elapsed ${formatDuration(elapsed)}`);
    if (warmed > 0 && warmed < limit && scanned < total) {
      const eta = Math.round((elapsed / warmed) * (limit - warmed));
      parts.push(`ETA ~${formatDuration(eta)}`);
    }
  } else {
    const filled = Math.round((scanned / total) * barWidth);
    const bar = "[" + "█".repeat(filled) + "░".repeat(barWidth - filled) + "]";
    const pct = Math.round((scanned / total) * 100);
    parts.push(bar, `${scanned}/${total}`, `${pct}%`, `elapsed ${formatDuration(elapsed)}`);
    if (scanned < total) {
      const eta = Math.round((elapsed / scanned) * (total - scanned));
      parts.push(`ETA ~${formatDuration(eta)}`);
    }
  }

  console.log("\n" + parts.join("  "));
}

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
