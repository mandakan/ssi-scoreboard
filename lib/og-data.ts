// Server-only — fetches match metadata for OG image and page metadata generation.
// Uses the same cached GraphQL path as the match API route.

import { fetchRawMatchData } from "@/lib/match-data";
import { formatDivisionDisplay } from "@/lib/divisions";
import type { CompetitorInfo } from "@/lib/types";

// ── Public types ────────────────────────────────────────────────────────

export interface OgMatchData {
  name: string;
  venue: string | null;
  date: string | null;
  level: string | null;
  region: string | null;
  stagesCount: number;
  competitorsCount: number;
  scoringCompleted: number;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  competitors: CompetitorInfo[];
}

// ── Fetch helper ────────────────────────────────────────────────────────

// Maximum time to wait for match data during metadata generation.
// In production the data is almost always in Redis cache (sub-ms).
// The timeout prevents slow upstream responses from blocking client-side
// soft navigations (Next.js re-runs generateMetadata on router.replace).
const METADATA_FETCH_TIMEOUT_MS = 1500;

/**
 * Fetch match data needed for OG images and page metadata.
 * Uses the same cached GraphQL query as the match API route, so in most
 * cases this is a Redis cache hit (sub-millisecond on Docker).
 *
 * @param timeoutMs – Maximum time to wait. Defaults to
 * METADATA_FETCH_TIMEOUT_MS (1500ms) which is tight enough to avoid
 * blocking soft navigations in generateMetadata(). The OG image route
 * passes a longer timeout because social-media crawlers are patient.
 *
 * Returns null if the match cannot be found, the fetch fails, or the
 * fetch exceeds the timeout.
 */
export async function fetchOgMatchData(
  ct: string,
  id: string,
  timeoutMs: number = METADATA_FETCH_TIMEOUT_MS,
): Promise<OgMatchData | null> {
  return Promise.race([
    fetchOgMatchDataImpl(ct, id),
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs),
    ),
  ]);
}

async function fetchOgMatchDataImpl(
  ct: string,
  id: string,
): Promise<OgMatchData | null> {
  const ctNum = parseInt(ct, 10);
  if (isNaN(ctNum)) return null;

  try {
    const { data } = await fetchRawMatchData(ctNum, id);

    if (!data.event) return null;
    const ev = data.event;

    const competitors: CompetitorInfo[] = (
      ev.competitors_approved_w_wo_results_not_dnf ?? []
    ).map((c) => ({
      id: parseInt(c.id, 10),
      name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown",
      competitor_number: c.number ?? "",
      club: c.club ?? null,
      division: formatDivisionDisplay(
        c.get_handgun_div_display ?? c.handgun_div,
        c.shoots_handgun_major,
      ),
    }));

    // Only use the image URL if it's non-empty (API returns "" for unset images)
    const imageUrl = ev.image?.url?.trim() || null;
    const imageWidth = imageUrl && ev.image?.width ? ev.image.width : null;
    const imageHeight = imageUrl && ev.image?.height ? ev.image.height : null;

    return {
      name: ev.name,
      venue: ev.venue ?? null,
      date: ev.starts ?? null,
      level: ev.level ?? null,
      region: ev.region ?? null,
      stagesCount: ev.stages_count ?? 0,
      competitorsCount: ev.competitors_count ?? competitors.length,
      imageUrl,
      imageWidth,
      imageHeight,
      scoringCompleted:
        ev.scoring_completed != null
          ? Math.round(parseFloat(String(ev.scoring_completed)))
          : 0,
      competitors,
    };
  } catch (err) {
    console.error("[og] Failed to fetch match data:", err);
    return null;
  }
}
