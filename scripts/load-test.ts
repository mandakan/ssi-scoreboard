/**
 * Load-test driver for the SSI-facing refresh path (issue #521 Phase 3).
 *
 * SSI asked us to exercise several large matches in parallel so they get logs
 * to inspect. The point of this script is NOT to hammer anything: it simulates
 * realistic courtside VIEWER traffic (many clients polling a few live matches)
 * and lets our own throttling decide how much of that reaches SSI. A passing
 * run is one where viewer requests vastly outnumber upstream GraphQL calls.
 *
 * Client-side numbers are printed here; the upstream side is read afterwards
 * from telemetry:
 *   .claude/skills/r2-telemetry/scripts/fetch.py --domain upstream \
 *     --op graphql-request --since 1h --group-by operation,outcome
 * (Note the Pipelines flush lags ~25 min, so wait before reading.)
 *
 * Usage:
 *   pnpm tsx scripts/load-test.ts [flags]
 *
 *   --url <base>          App URL (default: NEXT_PUBLIC_APP_URL or prod)
 *   --matches <list>      Comma-separated ct/id pairs, e.g. 22/27099,22/28669
 *   --discover <n>        Auto-pick the N biggest recent matches (default 3)
 *   --viewers <n>         Concurrent pollers per match (default 3)
 *   --interval <s>        Seconds between polls per viewer (default 60)
 *   --duration <s>        Total run time in seconds (default 600)
 *   --compare             Also poll the compare endpoint (scorecards path)
 *   --dry-run             Resolve the match list and exit
 *
 * Politeness: viewers start staggered, each poll is jittered, and the run
 * stops on its own. Ctrl-C prints the summary collected so far.
 */

const DEFAULT_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://scoreboard.urdr.dev";

interface CliArgs {
  url: string;
  matches: string[] | null;
  discover: number;
  viewers: number;
  interval: number;
  duration: number;
  compare: boolean;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  const has = (flag: string): boolean => args.includes(flag);
  const num = (flag: string, fallback: number): number => {
    const raw = get(flag);
    if (raw === null) return fallback;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`Error: ${flag} must be a positive integer, got "${raw}"`);
      process.exit(1);
    }
    return n;
  };

  const matchesRaw = get("--matches");
  return {
    url: (get("--url") ?? DEFAULT_URL).replace(/\/$/, ""),
    matches: matchesRaw ? matchesRaw.split(",").map((s) => s.trim()).filter(Boolean) : null,
    discover: num("--discover", 3),
    viewers: num("--viewers", 3),
    interval: num("--interval", 60),
    duration: num("--duration", 600),
    compare: has("--compare"),
    dryRun: has("--dry-run"),
  };
}

// ─── Stats ───────────────────────────────────────────────────────────────────

interface Sample {
  op: string;
  ms: number;
  status: number;
}

const samples: Sample[] = [];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

function printSummary(startedAt: number): void {
  const elapsed = (Date.now() - startedAt) / 1000;
  console.log(`\n─── client-side summary (${elapsed.toFixed(0)}s) ───`);
  if (samples.length === 0) {
    console.log("no requests completed");
    return;
  }
  const byOp = new Map<string, Sample[]>();
  for (const s of samples) {
    const list = byOp.get(s.op) ?? [];
    list.push(s);
    byOp.set(s.op, list);
  }
  console.log("op        requests  ok   p50    p95    max");
  for (const [op, list] of [...byOp.entries()].sort()) {
    const times = list.map((s) => s.ms).sort((a, b) => a - b);
    const ok = list.filter((s) => s.status === 200).length;
    console.log(
      `${op.padEnd(9)} ${String(list.length).padStart(8)}  ${String(ok).padStart(3)}  ` +
        `${String(percentile(times, 50)).padStart(5)}  ${String(percentile(times, 95)).padStart(5)}  ` +
        `${String(percentile(times, 100)).padStart(5)}`,
    );
  }
  const bad = samples.filter((s) => s.status !== 200);
  if (bad.length > 0) {
    const codes = new Map<number, number>();
    for (const s of bad) codes.set(s.status, (codes.get(s.status) ?? 0) + 1);
    console.log(`non-200: ${[...codes].map(([c, n]) => `${c}x${n}`).join(", ")}`);
  }
  console.log(
    `\ntotal client requests: ${samples.length}\n` +
      `Now read the upstream side (wait ~25 min for the Pipelines flush):\n` +
      `  .claude/skills/r2-telemetry/scripts/fetch.py --domain upstream \\\n` +
      `    --op graphql-request --since 1h --group-by operation,outcome`,
  );
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

async function timedFetch(url: string, op: string): Promise<unknown | null> {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { "User-Agent": "ssi-scoreboard-loadtest/1" } });
    const ms = Date.now() - started;
    samples.push({ op, ms, status: res.status });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    samples.push({ op, ms: Date.now() - started, status: 0 });
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** +-25% jitter, same spirit as lib/jitter.ts (SSI ask: don't sync up). */
const jittered = (seconds: number) => seconds * 1000 * (0.75 + Math.random() * 0.5);

// ─── Match discovery ─────────────────────────────────────────────────────────

interface EventSummary {
  id: number;
  content_type: number;
  name: string;
  status: string;
  level: string;
}

interface MatchDetail {
  name?: string;
  competitors?: Array<{ id: number }>;
  stages?: unknown[];
  scoring_pct?: number;
  is_live_scores_accessible?: boolean;
}

interface Target {
  ct: number;
  id: string;
  name: string;
  competitorIds: number[];
  stages: number;
}

async function discover(url: string, count: number): Promise<string[]> {
  const after = new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const before = new Date(Date.now() + 1 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const events = (await timedFetch(
    `${url}/api/events?starts_after=${after}&starts_before=${before}`,
    "events",
  )) as EventSummary[] | null;
  if (!events || events.length === 0) {
    console.error("discovery failed: no events returned");
    return [];
  }
  // Prefer the biggest recent matches: Level III first, then II, then the rest.
  const rank = (e: EventSummary) =>
    e.level?.includes("III") ? 0 : e.level?.includes("II") ? 1 : 2;
  return [...events]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, count * 3)
    .map((e) => `${e.content_type}/${e.id}`);
}

/** Resolve ct/id strings to usable targets, dropping anything inaccessible. */
async function resolveTargets(url: string, refs: string[], want: number): Promise<Target[]> {
  const out: Target[] = [];
  for (const ref of refs) {
    if (out.length >= want) break;
    const [ctRaw, id] = ref.split("/");
    const ct = parseInt(ctRaw, 10);
    if (!Number.isFinite(ct) || !id) {
      console.error(`  skip ${ref}: expected ct/id`);
      continue;
    }
    const d = (await timedFetch(`${url}/api/match/${ct}/${id}`, "match")) as MatchDetail | null;
    if (!d) {
      console.error(`  skip ${ref}: not accessible`);
      continue;
    }
    const competitorIds = (d.competitors ?? []).slice(0, 3).map((c) => c.id);
    const stages = (d.stages ?? []).length;
    console.log(
      `  ${ref}  ${(d.name ?? "?").slice(0, 40).padEnd(40)} ` +
        `comps=${String(competitorIds.length ? (d.competitors ?? []).length : 0).padStart(3)} ` +
        `stages=${String(stages).padStart(2)} scoring=${d.scoring_pct ?? 0}%`,
    );
    out.push({ ct, id, name: d.name ?? ref, competitorIds, stages });
    await sleep(300);
  }
  return out;
}

// ─── Viewer loop ─────────────────────────────────────────────────────────────

async function viewer(
  url: string,
  target: Target,
  args: CliArgs,
  deadline: number,
  stagger: number,
): Promise<void> {
  await sleep(stagger);
  while (Date.now() < deadline) {
    await timedFetch(`${url}/api/match/${target.ct}/${target.id}`, "match");
    if (args.compare && target.competitorIds.length > 0 && target.stages > 0) {
      const ids = target.competitorIds.join(",");
      await timedFetch(
        `${url}/api/compare?ct=${target.ct}&id=${target.id}&competitor_ids=${ids}`,
        "compare",
      );
    }
    const wait = jittered(args.interval);
    if (Date.now() + wait > deadline) break;
    await sleep(wait);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`target: ${args.url}`);

  const refs = args.matches ?? (await discover(args.url, args.discover));
  if (refs.length === 0) {
    console.error("no matches to test");
    process.exit(1);
  }

  console.log("\nresolving matches:");
  const targets = await resolveTargets(args.url, refs, args.matches ? refs.length : args.discover);
  if (targets.length === 0) {
    console.error("no accessible matches — try --matches with known-public ids");
    process.exit(1);
  }

  if (args.dryRun) {
    console.log(`\ndry run: would poll ${targets.length} match(es) with ${args.viewers} viewers each`);
    return;
  }

  const totalViewers = targets.length * args.viewers;
  console.log(
    `\nstarting: ${targets.length} match(es) x ${args.viewers} viewers = ${totalViewers} pollers, ` +
      `every ~${args.interval}s for ${args.duration}s${args.compare ? ", incl. compare" : ""}`,
  );

  const startedAt = Date.now();
  const deadline = startedAt + args.duration * 1000;
  let stopped = false;
  process.on("SIGINT", () => {
    if (stopped) process.exit(1);
    stopped = true;
    console.log("\ninterrupted — summary so far:");
    printSummary(startedAt);
    process.exit(0);
  });

  const jobs: Promise<void>[] = [];
  for (const [ti, target] of targets.entries()) {
    for (let v = 0; v < args.viewers; v++) {
      // Stagger so pollers never fire as one burst.
      const stagger = (ti * args.viewers + v) * ((args.interval * 1000) / Math.max(1, totalViewers));
      jobs.push(viewer(args.url, target, args, deadline, stagger));
    }
  }
  await Promise.all(jobs);
  printSummary(startedAt);
}

main().catch((err) => {
  console.error("load-test failed:", err);
  process.exit(1);
});
