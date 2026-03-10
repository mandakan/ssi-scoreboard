// Server-only — never import from client components or files with "use client".
// Core backfill logic: scans cached match data in Redis for a specific shooter
// and indexes any newly discovered matches. Zero GraphQL API calls.
//
// Dependency-injected so it can be unit-tested without a real Redis connection.

import { decodeShooterId } from "@/lib/shooter-index";
import type { BackfillProgress } from "@/lib/types";

export interface BackfillDeps {
  scanCachedMatchKeys(): Promise<string[]>;
  getCachedMatch(key: string): Promise<string | null>;
  getExistingMatchRefs(shooterId: number): Promise<Set<string>>;
  indexMatch(params: {
    shooterId: number;
    ct: string;
    matchId: string;
    startTimestamp: number;
    competitor: {
      name: string;
      club: string | null;
      division: string | null;
      region: string | null;
      region_display: string | null;
      category: string | null;
      ics_alias: string | null;
      license: string | null;
    };
  }): Promise<void>;
}

export interface BackfillOptions {
  shooterId: number;
  batchSize?: number;
  onProgress?: (p: BackfillProgress) => void;
}

interface RawCompetitor {
  id: string;
  first_name?: string;
  last_name?: string;
  club?: string | null;
  handgun_div?: string | null;
  get_handgun_div_display?: string | null;
  region?: string | null;
  get_region_display?: string | null;
  category?: string | null;
  ics_alias?: string | null;
  license?: string | null;
  shooter?: { id: string } | null;
}

interface RawMatchEvent {
  starts?: string | null;
  competitors_approved_w_wo_results_not_dnf?: RawCompetitor[];
}

interface CacheEntry {
  data?: { event?: RawMatchEvent | null } | null;
  v?: number;
}

/**
 * Extract ct and matchId from a GetMatch cache key.
 * Key format: gql:GetMatch:{"ct":22,"id":"26547"}
 */
function parseMatchKeyRef(key: string): { ct: string; matchId: string } | null {
  const prefix = "gql:GetMatch:";
  if (!key.startsWith(prefix)) return null;
  try {
    const vars = JSON.parse(key.slice(prefix.length)) as { ct?: number; id?: string };
    if (vars.ct == null || !vars.id) return null;
    return { ct: String(vars.ct), matchId: vars.id };
  } catch {
    return null;
  }
}

export async function runBackfill(
  deps: BackfillDeps,
  options: BackfillOptions,
): Promise<BackfillProgress> {
  const { shooterId, batchSize = 50, onProgress } = options;

  const progress: BackfillProgress = {
    status: "scanning",
    totalCached: 0,
    checked: 0,
    discovered: 0,
    alreadyIndexed: 0,
  };

  // 1. Scan all cached match keys
  let allKeys: string[];
  try {
    allKeys = await deps.scanCachedMatchKeys();
  } catch (err) {
    return {
      ...progress,
      status: "error",
      errorMessage: err instanceof Error ? err.message : "Scan failed",
    };
  }
  progress.totalCached = allKeys.length;
  progress.status = "checking";
  onProgress?.(progress);

  if (allKeys.length === 0) {
    return { ...progress, status: "complete" };
  }

  // 2. Get already-indexed match refs
  let existingRefs: Set<string>;
  try {
    existingRefs = await deps.getExistingMatchRefs(shooterId);
  } catch {
    existingRefs = new Set();
  }

  // 3. Filter out already-indexed keys
  const toCheck: Array<{ key: string; ct: string; matchId: string }> = [];
  for (const key of allKeys) {
    const ref = parseMatchKeyRef(key);
    if (!ref) continue;
    const matchRef = `${ref.ct}:${ref.matchId}`;
    if (existingRefs.has(matchRef)) {
      progress.alreadyIndexed++;
    } else {
      toCheck.push({ key, ...ref });
    }
  }

  // 4. Process in batches
  for (let i = 0; i < toCheck.length; i += batchSize) {
    const batch = toCheck.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async ({ key, ct, matchId }) => {
        progress.checked++;
        try {
          const raw = await deps.getCachedMatch(key);
          if (!raw) return;

          const entry = JSON.parse(raw) as CacheEntry;
          // Require at least v6, when shooter { id } was added to IpscCompetitorNode.
          // Allow any newer version so D1 entries pre-dating a schema bump are usable.
          if (!entry.v || entry.v < 6) return;
          if (!entry.data?.event) return;

          const ev = entry.data.event;
          const competitors = ev.competitors_approved_w_wo_results_not_dnf ?? [];

          for (const c of competitors) {
            const sid = decodeShooterId(c.shooter?.id);
            if (sid !== shooterId) continue;

            const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown";
            const startTimestamp = ev.starts
              ? Math.floor(new Date(ev.starts).getTime() / 1000)
              : Math.floor(Date.now() / 1000);

            await deps.indexMatch({
              shooterId,
              ct,
              matchId,
              startTimestamp,
              competitor: {
                name,
                club: c.club ?? null,
                division: c.get_handgun_div_display ?? c.handgun_div ?? null,
                region: c.region || null,
                region_display: c.get_region_display || null,
                category: c.category || null,
                ics_alias: c.ics_alias || null,
                license: c.license || null,
              },
            });
            progress.discovered++;
            break;
          }
        } catch {
          // Skip individual match errors silently
        }
      }),
    );

    onProgress?.({ ...progress, status: "checking" });
  }

  return { ...progress, status: "complete" };
}
