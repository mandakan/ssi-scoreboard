// Server-only — match-scorecards fetch via SSI's per-stage root query.
//
// SSI deprecated the whole-match `event { stages { scorecards } }` path on
// 2026-05-04. The blessed replacement is `stage(content_type, id) { scorecards }`,
// fetched per stage. We parallel-fetch all stages for a match and reassemble
// them into the `RawScorecardsData` shape downstream parsers consume — no
// caller-side refactor needed.
//
// Cold-load latency vs the deprecated whole-match path (matches 26193, 27046,
// 27704, measured 2026-05-04):
//   legacy whole-match:           8-17s wall-clock
//   per-stage parallel fan-out:   2.6-3.5s wall-clock
//
// `getMatchScorecards` is the single read path used by both the post-match
// archive (permanent cache, ttl=null) and the live courtside view (TTL'd
// cache + stale-while-revalidate refresh). The cache key matches the legacy
// `gql:GetMatchScorecards:{...}` shape so existing infrastructure (D1 mirror,
// force-refresh sentinel, popular-match indexer) keeps working.

import { afterResponse } from "@/lib/background-impl";
import cache from "@/lib/cache-impl";
import { CACHE_SCHEMA_VERSION } from "@/lib/constants";
import { cacheTelemetry } from "@/lib/cache-telemetry";
import {
  cachedExecuteQuery,
  clearForceRefresh,
  executeQuery,
  forceRefreshKey,
  gqlCacheKey,
  isForceRefreshRequested,
  isMatchProbeEnabled,
  maxProbeSkipAgeSeconds,
  refreshCachedMatchQuery,
  runMatchSyncProbe,
  writeMatchCacheEntry,
  STAGE_SCORECARDS_QUERY,
  STAGE_SCORECARDS_DELTA_QUERY,
  type ProbeStageData,
} from "@/lib/graphql";
import { withJitter } from "@/lib/jitter";
import { markUpstreamDegraded } from "@/lib/upstream-status";
import { shouldProbeNow, recordProbeOutcome } from "@/lib/probe-cadence";
import type {
  RawScorecardsData,
  RawStage,
  RawScCard,
} from "@/lib/scorecard-data";

// ─── Raw response shape ──────────────────────────────────────────────────────

interface SingleStageResponse {
  stage: {
    id: string;
    number: number;
    name: string;
    max_points?: number | null;
    scorecards?: RawScCard[];
  } | null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Identifies a stage to fetch via the root `stage(ct, id)` query. */
export interface StageRef {
  /** IpscStageNode content_type (always 24 for IPSC). */
  ct: number;
  /** Stage primary key as a string (SSI's id type). */
  id: string;
}

export interface GetMatchScorecardsArgs {
  /** IpscMatchNode content_type (22 for all IPSC disciplines). */
  ct: number;
  /** Match primary key as a string. */
  matchId: string;
  /** Stages to fan-out across on a cache miss. */
  stages: StageRef[];
  /**
   * Cache TTL (seconds). `null` = permanent — use for completed matches.
   * A positive number caps freshness during live matches; the SWR refresh
   * below keeps the cache warm within that window.
   */
  ttlSeconds: number | null;
  /**
   * Optional stale-while-revalidate window (seconds). When the cached entry
   * is older than this, an in-flight refresh is scheduled (single-flighted
   * via Redis NX lock) using the same per-stage fan-out. Ignored when
   * `ttlSeconds` is null (permanent entries don't refresh).
   */
  freshnessSeconds?: number | null;
}

/**
 * Read-or-fetch match scorecards. Single entry point for both post-match
 * (permanent cache) and live (TTL + SWR) modes — the only difference is the
 * `ttlSeconds` / `freshnessSeconds` pair.
 */
export async function getMatchScorecards(
  args: GetMatchScorecardsArgs,
): Promise<{ data: RawScorecardsData; cachedAt: string | null }> {
  const { ct, matchId, stages, ttlSeconds, freshnessSeconds } = args;
  const cacheKey = gqlCacheKey("GetMatchScorecards", { ct, id: matchId });
  const variables = { ct, id: matchId };

  const lockTtl = computeScorecardsLockTtl(stages.length);
  const result = await cachedExecuteQuery<RawScorecardsData>(
    cacheKey,
    // STAGE_SCORECARDS_QUERY is passed for diagnostics / cache-key shape; the
    // fetcher below replaces the actual upstream call (the single-stage
    // variables would be wrong otherwise). Cold misses are single-flighted:
    // N concurrent first-viewers of a match must produce ONE fan-out, not N
    // (2026-08-15 incident hardening).
    STAGE_SCORECARDS_QUERY,
    variables,
    ttlSeconds,
    {
      fetcher: () =>
        coldFetchSingleFlight(cacheKey, lockTtl, () => fetchWholeMatchArchive(stages), {
          maxWaitMs: computeColdWaitMs(stages.length),
        }),
    },
  );

  // SWR: when the cached entry is older than freshnessSeconds, kick off a
  // single-flighted background refresh using the same per-stage fan-out.
  // Permanent entries (ttl=null) don't refresh — completed matches are
  // immutable.
  if (
    result.cachedAt !== null &&
    ttlSeconds !== null &&
    freshnessSeconds != null
  ) {
    const ageSeconds =
      (Date.now() - new Date(result.cachedAt).getTime()) / 1000;
    if (ageSeconds > withJitter(freshnessSeconds)) {
      afterResponse(
        refreshScorecardsIncremental({ ct, matchId, stages, ttlSeconds }),
      );
    }
  }

  return result;
}

// ─── Probe-driven incremental refresh ────────────────────────────────────────

/** Sidecar key holding the last-seen per-stage probe state for a match. */
export function stageProbeSidecarKey(ct: number, matchId: string): string {
  return `probe:stage-state:${ct}:${matchId}`;
}

interface StageProbeState {
  /** `IpscStageNode.latest_scorecard_update` — max `updated` across the
   *  stage's cards. THE change signal per SSI (2026-08-18); `Stage.updated`
   *  tracks stage-info edits and must not be used for results. Also the
   *  delta watermark. Sidecars written before the rename lack this key and
   *  diff as changed once — self-healing. */
  scUpdated?: string | null;
  count: number | null;
  scored: number | null;
  total: number | null;
}

interface StageProbeSidecar {
  v: number;
  stages: Record<string, StageProbeState>;
  /** ISO timestamp of the last FULL fan-out — the self-heal ceiling counts
   *  against this, not the snapshot's cachedAt (which moves on every
   *  incremental merge). */
  lastFullSyncAt: string;
}

export interface RefreshScorecardsIncrementalArgs {
  ct: number;
  matchId: string;
  /** Fallback stage refs (from the caller's GetMatch data) — used only when
   *  the probe itself fails; the probe's stage list is authoritative. */
  stages: StageRef[];
  ttlSeconds: number | null;
}

function toStageProbeState(s: ProbeStageData): StageProbeState {
  return {
    scUpdated: s.latest_scorecard_update ?? null,
    count: s.scorecards_count ?? null,
    scored: s.scoring_progress?.scored ?? null,
    total: s.scoring_progress?.total ?? null,
  };
}

function stageStatesEqual(a: StageProbeState, b: StageProbeState): boolean {
  return (
    (a.scUpdated ?? null) === (b.scUpdated ?? null) &&
    a.count === b.count &&
    a.scored === b.scored &&
    a.total === b.total
  );
}

interface SnapshotEntry {
  data: RawScorecardsData;
  cachedAt: string;
  v?: number;
}

/**
 * Probe-driven scorecards refresh (2026-08-15 SSI-load redesign; SSI asks
 * #2/#4/#5). One tiny sync probe per cycle decides which stages actually
 * changed; ONLY those stages are refetched and replaced wholesale in the
 * cached snapshot. Unchanged cycles cost one probe. Replaces the previous
 * full per-stage fan-out that ran every SWR cycle.
 *
 * Full-resync fallbacks (all self-healing): missing/stale-version sidecar or
 * snapshot, probe failure, force-refresh sentinel, or `lastFullSyncAt` older
 * than the max-skip-age ceiling. A stage id in the probe that the snapshot
 * has never seen also sets the GetMatch force-refresh sentinel so the match
 * overview's stage list heals on its next cycle.
 */
export async function refreshScorecardsIncremental(
  args: RefreshScorecardsIncrementalArgs,
): Promise<void> {
  const { ct, matchId, stages, ttlSeconds } = args;
  const cacheKey = gqlCacheKey("GetMatchScorecards", { ct, id: matchId });

  // Probe kill switch: degrade to the legacy always-full-refetch path.
  if (!isMatchProbeEnabled()) {
    return refreshCachedMatchQuery<RawScorecardsData>(
      cacheKey,
      STAGE_SCORECARDS_QUERY,
      { ct, id: matchId },
      ttlSeconds,
      { ct, id: matchId },
      computeScorecardsLockTtl(stages.length),
      { fetcher: () => fetchWholeMatchArchive(stages) },
    );
  }

  const lockKey = `inflight:${cacheKey}`;
  const lockTtl = computeScorecardsLockTtl(stages.length);
  let acquired = false;
  try {
    acquired = await cache.setIfAbsent(lockKey, "1", lockTtl);
  } catch {
    return;
  }
  if (!acquired) return;

  const startedAt = Date.now();
  let outcome: "skip" | "incremental" | "forced-refresh" | "error" = "error";
  try {
    const sidecarKey = stageProbeSidecarKey(ct, matchId);

    const forced = await isForceRefreshRequested(ct, matchId);

    // Adaptive idle cadence (#503): during a hold-off window from consecutive
    // quiet cycles, skip even the probe — just keep the cache alive.
    if (!forced && !(await shouldProbeNow(ct, matchId))) {
      outcome = "skip";
      if (ttlSeconds !== null) {
        try { await cache.expire(cacheKey, ttlSeconds); } catch { /* self-heals */ }
        try { await cache.expire(sidecarKey, sidecarTtl(ttlSeconds)); } catch { /* harmless */ }
      }
      return;
    }

    let probeStages: ProbeStageData[] | null = null;
    if (!forced) {
      try {
        const probe = await runMatchSyncProbe(ct, matchId);
        probeStages = probe.event?.stages ?? null;
      } catch {
        probeStages = null;
      }
    }

    if (forced || probeStages === null) {
      // Sentinel set, probe failed, or probe carried no stage info — full
      // resync using the caller's stage refs.
      await fullResync(cacheKey, sidecarKey, stages, ttlSeconds, null);
      if (forced) await clearForceRefresh(ct, matchId);
      outcome = "forced-refresh";
      return;
    }

    const probeRefs: StageRef[] = probeStages.map((s) => ({ ct: 24, id: s.id }));
    const currentStates = new Map(probeStages.map((s) => [s.id, toStageProbeState(s)]));

    const sidecar = await readSidecar(sidecarKey);
    const snapshot = await readSnapshot(cacheKey);

    const ceilingExceeded =
      sidecar != null &&
      (Date.now() - new Date(sidecar.lastFullSyncAt).getTime()) / 1000 > maxProbeSkipAgeSeconds();

    if (!sidecar || !snapshot || ceilingExceeded) {
      await fullResync(cacheKey, sidecarKey, probeRefs, ttlSeconds, currentStates);
      outcome = "forced-refresh";
      return;
    }

    // Diff: which stages changed since the last cycle?
    const snapshotIds = new Set((snapshot.data.event?.stages ?? []).map((s) => s.id));
    const changed: StageRef[] = [];
    let newStageSeen = false;
    for (const [id, state] of currentStates) {
      const prev = sidecar.stages[id];
      if (!prev || !stageStatesEqual(prev, state) || !snapshotIds.has(id)) {
        changed.push({ ct: 24, id });
        if (!snapshotIds.has(id)) newStageSeen = true;
      }
    }
    const removedIds = [...snapshotIds].filter((id) => !currentStates.has(id));

    if (changed.length === 0 && removedIds.length === 0) {
      // Nothing moved — extend TTLs only; no rewrite (avoids cachedAt/D1 churn).
      await recordProbeOutcome(ct, matchId, false);
      outcome = "skip";
      if (ttlSeconds !== null) {
        try { await cache.expire(cacheKey, ttlSeconds); } catch { /* self-heals */ }
        try { await cache.expire(sidecarKey, sidecarTtl(ttlSeconds)); } catch { /* harmless */ }
      }
      return;
    }

    // Fetch only the changed stages and splice them into the snapshot. With
    // SCORECARDS_DELTA_ENABLED=on, stages the sidecar has seen before are
    // fetched via updated_after (only changed CARDS); otherwise (and for
    // first-seen stages) the whole stage is refetched.
    const fetchedStages = isScorecardsDeltaEnabled()
      ? await fetchChangedStagesDelta(changed, sidecar, snapshot, currentStates)
      : (await fetchWholeMatchArchive(changed)).event?.stages ?? [];
    const merged = new Map((snapshot.data.event?.stages ?? []).map((s) => [s.id, s]));
    for (const id of removedIds) merged.delete(id);
    for (const s of fetchedStages) merged.set(s.id, s);
    const mergedStages = [...merged.values()].sort((a, b) => a.number - b.number);

    // Order matters: snapshot first, sidecar second. A crash in between just
    // re-fetches the same stages next cycle (idempotent); the reverse order
    // would mark stages as synced that were never written.
    await writeMatchCacheEntry(cacheKey, { event: { stages: mergedStages } }, ttlSeconds);
    await writeSidecar(sidecarKey, {
      v: CACHE_SCHEMA_VERSION,
      stages: Object.fromEntries(currentStates),
      lastFullSyncAt: sidecar.lastFullSyncAt,
    }, ttlSeconds);

    await recordProbeOutcome(ct, matchId, true);
    if (newStageSeen) {
      // The match overview's stage list doesn't know this stage yet — force
      // its next refresh cycle to do a clean full refetch.
      try {
        await cache.set(forceRefreshKey(ct, matchId), "1", 300);
      } catch { /* best-effort */ }
    }
    outcome = "incremental";
  } catch (err) {
    console.error("[scorecards] incremental refresh failed for", cacheKey, err);
    await markUpstreamDegraded(
      "refresh-scorecards-incremental",
      err instanceof Error ? err.name : null,
    );
    // Stale-on-error: keep serving the current snapshot.
    if (ttlSeconds !== null) {
      try { await cache.expire(cacheKey, ttlSeconds); } catch { /* gone — D1 covers */ }
    }
  } finally {
    cacheTelemetry({
      op: "match-probe",
      matchKey: cacheKey,
      keyType: "scorecards",
      outcome,
      probeMs: Date.now() - startedAt,
      cachedAgeSeconds: null,
      upstreamUpdatedIso: null,
      prevUpstreamUpdatedIso: null,
    });
    try {
      await cache.del(lockKey);
    } catch { /* lock expires via TTL */ }
  }
}

/** Flag: fetch changed stages via `scorecards(updated_after:)` instead of a
 *  whole-stage refetch. SSI confirmed semantics 2026-08-18 (new cards get
 *  created==updated, so the watermark catches creates AND edits); verified
 *  live 2026-08-19. Flip on in staging first, then prod. */
function isScorecardsDeltaEnabled(): boolean {
  return process.env.SCORECARDS_DELTA_ENABLED === "on";
}

/** Raw delta card: normal RawScCard plus the response-only `updated` field. */
type DeltaCard = RawScCard & { updated?: string | null };

/** Watermark overlap (SSI recommends 2-5s): re-fetch a small window before
 *  the last-seen marker so a card that landed the same instant as the probe
 *  read is never missed. The by-competitor merge is idempotent, so overlap
 *  duplicates are harmless. */
const DELTA_OVERLAP_MS = 3_000;

/**
 * Delta-fetch the changed stages. Watermark per stage = the PREVIOUS cycle's
 * `latest_scorecard_update` from the sidecar, minus DELTA_OVERLAP_MS, sent
 * as UTC with Z suffix (verified against the live API 2026-08-19). Cards are
 * merged by competitor id into the snapshot's existing stage (one card per
 * competitor per stage — idempotent upsert; a reshoot replacing a card gets
 * picked up because the new card's `updated` is fresh); the `updated` field
 * is stripped before the merge so the cached shape stays unchanged. Falls
 * back to a whole-stage refetch when: the stage or its watermark is unknown,
 * or the merged card count disagrees with the probe's `scorecards_count`
 * (deletions / semantics drift).
 */
async function fetchChangedStagesDelta(
  changed: StageRef[],
  sidecar: StageProbeSidecar,
  snapshot: SnapshotEntry,
  currentStates: Map<string, StageProbeState>,
): Promise<RawStage[]> {
  const snapshotById = new Map((snapshot.data.event?.stages ?? []).map((s) => [s.id, s]));
  return (
    await mapWithConcurrency(changed, MAX_CONCURRENCY, async (ref): Promise<RawStage | null> => {
      const prevStage = snapshotById.get(ref.id);
      const watermark = sidecar.stages[ref.id]?.scUpdated;
      const fullStageFetch = async (): Promise<RawStage | null> => {
        const r = await executeQuery<SingleStageResponse>(
          STAGE_SCORECARDS_QUERY,
          { ct: ref.ct, id: ref.id },
          false,
          { timeoutMs: STAGE_FETCH_TIMEOUT_MS },
        );
        if (!r?.stage) return null;
        return {
          id: r.stage.id,
          number: r.stage.number,
          name: r.stage.name,
          max_points: r.stage.max_points ?? null,
          scorecards: r.stage.scorecards ?? [],
        };
      };

      if (!prevStage || !watermark) return fullStageFetch();

      const watermarkMs = Date.parse(watermark);
      if (!Number.isFinite(watermarkMs)) return fullStageFetch();
      const r = await executeQuery<SingleStageResponse>(
        STAGE_SCORECARDS_DELTA_QUERY,
        { ct: ref.ct, id: ref.id, updatedAfter: new Date(watermarkMs - DELTA_OVERLAP_MS).toISOString() },
        false,
        { timeoutMs: STAGE_FETCH_TIMEOUT_MS },
      );
      if (!r?.stage) return null;

      // Merge delta cards over the previous stage's cards by competitor id.
      const byCompetitor = new Map(
        (prevStage.scorecards ?? []).map((c) => [c.competitor?.id, c]),
      );
      for (const card of (r.stage.scorecards ?? []) as DeltaCard[]) {
        const { updated: _stripped, ...clean } = card;
        void _stripped;
        byCompetitor.set(clean.competitor?.id, clean);
      }
      const mergedCards = [...byCompetitor.values()];

      // Count sanity: probe told us how many cards this stage has NOW. A
      // mismatch means a deletion or updated_after semantics drift — refetch
      // the whole stage rather than serve a corrupted merge.
      const expected = currentStates.get(ref.id)?.count;
      if (expected != null && mergedCards.length !== expected) {
        return fullStageFetch();
      }

      return {
        id: r.stage.id,
        number: r.stage.number,
        name: r.stage.name,
        max_points: r.stage.max_points ?? prevStage.max_points ?? null,
        scorecards: mergedCards,
      };
    })
  ).filter((s): s is RawStage => s !== null);
}

/** Sidecar TTL: outlive the snapshot comfortably so a live match's sidecar
 *  doesn't evict between cycles. Permanent snapshots keep a bounded sidecar
 *  (no need to diff completed matches). */
function sidecarTtl(ttlSeconds: number | null): number {
  return ttlSeconds === null ? 24 * 3600 : Math.max(ttlSeconds * 4, 3600);
}

async function readSidecar(sidecarKey: string): Promise<StageProbeSidecar | null> {
  try {
    const raw = await cache.get(sidecarKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StageProbeSidecar;
    if (parsed.v !== CACHE_SCHEMA_VERSION || !parsed.stages || !parsed.lastFullSyncAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeSidecar(
  sidecarKey: string,
  sidecar: StageProbeSidecar,
  ttlSeconds: number | null,
): Promise<void> {
  try {
    await cache.set(sidecarKey, JSON.stringify(sidecar), sidecarTtl(ttlSeconds));
  } catch { /* one lost sidecar costs one full resync */ }
}

async function readSnapshot(cacheKey: string): Promise<SnapshotEntry | null> {
  try {
    const raw = await cache.get(cacheKey);
    if (!raw) return null;
    const entry = JSON.parse(raw) as SnapshotEntry;
    if (entry.v !== CACHE_SCHEMA_VERSION || !entry.data) return null;
    return entry;
  } catch {
    return null;
  }
}

/** Full per-stage resync: fetch every stage, write snapshot + fresh sidecar. */
async function fullResync(
  cacheKey: string,
  sidecarKey: string,
  refs: StageRef[],
  ttlSeconds: number | null,
  currentStates: Map<string, StageProbeState> | null,
): Promise<void> {
  const data = await fetchWholeMatchArchive(refs);
  await writeMatchCacheEntry(cacheKey, data, ttlSeconds);
  if (currentStates) {
    await writeSidecar(sidecarKey, {
      v: CACHE_SCHEMA_VERSION,
      stages: Object.fromEntries(currentStates),
      lastFullSyncAt: new Date().toISOString(),
    }, ttlSeconds);
  } else {
    // No probe state to record — drop the sidecar so the next cycle
    // re-establishes it from a fresh probe + full diff.
    try { await cache.del(sidecarKey); } catch { /* harmless */ }
  }
}

/**
 * Uncached parallel per-stage fetch + assembly. Use only when you need to
 * bypass the cache (e.g. the cache layer's miss path); most callers should
 * use `getMatchScorecards` instead.
 */
export async function fetchWholeMatchArchive(
  stages: StageRef[],
): Promise<RawScorecardsData> {
  if (stages.length === 0) {
    return { event: { stages: [] } };
  }
  const responses = await mapWithConcurrency(stages, MAX_CONCURRENCY, (s) =>
    executeQuery<SingleStageResponse>(
      STAGE_SCORECARDS_QUERY,
      { ct: s.ct, id: s.id },
      false,
      // Per-stage calls are empirically 1-2s; 15s is generous headroom while
      // keeping the whole fan-out's worst case inside the sized refresh lock
      // (computeScorecardsLockTtl). The global 60s default would let one hung
      // stage stretch an 18-stage refresh past any reasonable lock TTL.
      { timeoutMs: STAGE_FETCH_TIMEOUT_MS },
    ),
  );
  const out: RawStage[] = [];
  for (let i = 0; i < responses.length; i++) {
    const r = responses[i];
    if (!r?.stage) continue;
    out.push({
      id: r.stage.id,
      number: r.stage.number,
      name: r.stage.name,
      max_points: r.stage.max_points ?? null,
      scorecards: r.stage.scorecards ?? [],
    });
  }
  // Sort by stage number so downstream consumers see the same ordering as
  // the legacy whole-match query.
  out.sort((a, b) => a.number - b.number);
  return { event: { stages: out } };
}

// ─── Lock sizing + cold-miss single-flight ───────────────────────────────────

/** Per-stage upstream timeout for the fan-out (ms). */
const STAGE_FETCH_TIMEOUT_MS = 15_000;

/**
 * Redis lock TTL (seconds) sized to the fan-out worst case: stages run at
 * concurrency 2 with a 15s per-stage timeout, plus a 30s margin. Floor 120s.
 * A lock that expires mid-fan-out lets a second refresh pile onto SSI exactly
 * when it is slow — the opposite of what the lock is for.
 */
export function computeScorecardsLockTtl(stageCount: number): number {
  return Math.max(120, Math.ceil(stageCount / 2) * (STAGE_FETCH_TIMEOUT_MS / 1000) + 30);
}

/**
 * How long a cold-miss waiter will wait for the winning flight's cache write
 * before fetching itself. Must scale with the fan-out it is waiting on: a
 * fixed 10s budget meant that on a 14-stage match every waiter timed out and
 * ran its own full fan-out — roughly doubling the upstream calls at exactly
 * the moment the single-flight exists to prevent that (measured against prod
 * 2026-08-20: 3 viewers, 14 stages, 30 stage fetches instead of 14).
 *
 * Sized to the realistic fan-out (~2.5s per stage at concurrency 2) plus
 * headroom, and capped so a dead winner can't strand a request. Waiters
 * return as soon as the winner's entry lands, so this is only the give-up
 * point, not an added delay in the happy path.
 */
export function computeColdWaitMs(stageCount: number): number {
  // Cap kept well under the runtime's tolerance for a long-running request:
  // a waiter holds its request open for this long, so an over-generous cap
  // trades duplicate fan-outs for cancelled requests (seen at 45s during the
  // 2026-08-20 load test, alongside the withdrawn global leases).
  return Math.min(25_000, Math.max(10_000, Math.ceil(stageCount / 2) * 2_500 + 5_000));
}

interface ColdFetchWaitOptions {
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

/**
 * Single-flight wrapper for the cache-miss cold fan-out. Without this, N
 * concurrent first-viewers of a match each run the full per-stage fan-out
 * (N x stages upstream calls). With it: one flight fetches, the rest poll
 * the cache for its write and reuse it. If the winning flight dies (nothing
 * lands within the wait budget), the waiter falls back to fetching itself —
 * correctness over dedupe.
 */
export async function coldFetchSingleFlight(
  cacheKey: string,
  lockTtlSeconds: number,
  fetch: () => Promise<RawScorecardsData>,
  waitOptions: ColdFetchWaitOptions = {},
): Promise<RawScorecardsData> {
  const lockKey = `inflight:${cacheKey}`;
  let acquired = false;
  try {
    acquired = await cache.setIfAbsent(lockKey, "1", lockTtlSeconds);
  } catch {
    // Lock primitive down — fetch directly rather than fail the request.
    return fetch();
  }

  if (acquired) {
    try {
      return await fetch();
    } finally {
      try {
        await cache.del(lockKey);
      } catch { /* lock expires via TTL */ }
    }
  }

  // Another flight is fetching — wait for its cache write.
  const pollIntervalMs = waitOptions.pollIntervalMs ?? 500;
  const maxWaitMs = waitOptions.maxWaitMs ?? 10_000;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    try {
      const raw = await cache.get(cacheKey);
      if (raw) {
        const entry = JSON.parse(raw) as { data?: RawScorecardsData; v?: number };
        if (entry.v === CACHE_SCHEMA_VERSION && entry.data) {
          return entry.data;
        }
      }
    } catch { /* keep waiting */ }
  }
  // Winner never landed (died, or is slower than our budget) — fetch ourselves.
  return fetch();
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * Concurrency cap for the per-stage fan-out. Lowered 4 -> 2 after the
 * 2026-08-15 incident: SSI requires 1-2 concurrent GraphQL requests from us.
 * The global per-isolate semaphore (lib/upstream-limiter.ts) enforces the
 * same bound across ALL call sites; this local cap keeps the fan-out from
 * monopolizing the semaphore queue.
 */
const MAX_CONCURRENCY = 2;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers: Promise<void>[] = [];
  const n = Math.min(concurrency, items.length);
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}
