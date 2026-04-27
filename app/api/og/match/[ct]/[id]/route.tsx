import { ImageResponse } from "next/og";
import { fetchOgMatchData, type OgMatchData } from "@/lib/og-data";
import { cachedExecuteQuery, gqlCacheKey, SCORECARDS_QUERY } from "@/lib/graphql";
import { parseRawScorecards, type RawScorecardsData } from "@/lib/scorecard-data";
import {
  computeGroupRankings,
  computeConsistencyStats,
  computeCompetitorPPS,
  computeAllFingerprintPoints,
  computeStyleFingerprint,
  computePercentileRank,
  assignArchetype,
} from "@/app/api/compare/logic";
import { PALETTE } from "@/lib/colors";
import { isMatchComplete } from "@/lib/match-ttl";
import {
  C,
  OG_W,
  OG_H,
  formatDate,
  formatPct,
  topAccent,
  brandHeader,
  statBadge,
  pill,
  pctBar,
  targetBgLayers,
  fallbackImage,
} from "@/lib/og-helpers";
import type { CompetitorInfo } from "@/lib/types";

// ── Compare data types (minimal subset of CompareResponse) ─────────────

interface OgCompetitorStats {
  matchPct: number; // average group_percent across stages
  overallPct: number; // average overall_percent across stages
  divPct: number; // average div_percent across stages
  archetype: string | null;
  consistency: string | null;
  pointsPerShot: number | null;
  stagesFired: number;
}

// ── Route handler ──────────────────────────────────────────────────────

export async function GET(
  req: Request,
  { params }: { params: Promise<{ ct: string; id: string }> },
) {
  const { ct, id } = await params;
  const { searchParams } = new URL(req.url);
  const competitorsParam = searchParams.get("competitors");

  // Parse competitor IDs from the URL up front so we can start the compare
  // fetch in parallel with the match-data fetch. On cold cache the compare
  // endpoint (which fetches all scorecards) can take several seconds, so
  // running it concurrently cuts total latency roughly in half.
  const rawCompetitorIds = competitorsParam
    ? competitorsParam
        .split(",")
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];

  // Run match-data and compare-data fetches in parallel.
  // Stats are fetched directly from the scorecard cache — no HTTP subrequest
  // needed. CF Workers stateless model spawns a new Worker invocation per
  // subrequest, giving it a separate CPU budget that the compare endpoint can
  // exhaust. Fetching scorecards inline avoids that entirely.
  // Social-media crawlers are patient — allow up to 15s for cold-cache.
  const [match, prefetchedStats] = await Promise.all([
    fetchOgMatchData(ct, id, 15_000),
    rawCompetitorIds.length > 0
      ? fetchOgCompareStats(ct, id, rawCompetitorIds, 14_000)
      : Promise.resolve(null),
  ]);

  if (!match) {
    return new ImageResponse(fallbackImage(), {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  }

  const daysSince = match.date
    ? (Date.now() - new Date(match.date).getTime()) / 86_400_000
    : 0;
  const isComplete = isMatchComplete(match.scoringCompleted, daysSince, {
    status: match.matchStatus,
    resultsPublished: match.resultsStatus === "all",
  });

  // Resolve which of the requested IDs actually exist in the match.
  const selectedCompetitors = rawCompetitorIds
    .map((cid) => match.competitors.find((c) => c.id === cid))
    .filter((c): c is CompetitorInfo => c != null);

  // Use the prefetched stats if we have valid competitors, otherwise null.
  const statsMap = selectedCompetitors.length > 0 ? prefetchedStats : null;

  // Determine cache duration based on match completion and stats availability.
  // When a competitor OG is served without stats (compare data not yet warm),
  // use a short s-maxage so CF re-fetches rather than caching the no-stats
  // version for the full 7-day TTL of a completed match.
  let cacheControl: string;
  if (selectedCompetitors.length > 0 && (statsMap == null || statsMap.size === 0)) {
    cacheControl = "public, max-age=30, s-maxage=120";
  } else if (isComplete) {
    cacheControl = "public, max-age=86400, s-maxage=604800";
  } else {
    cacheControl = "public, max-age=60, s-maxage=300";
  }

  const element =
    selectedCompetitors.length === 1
      ? singleCompetitorImage(match, selectedCompetitors[0], statsMap)
      : selectedCompetitors.length > 1
        ? multiCompetitorImage(match, selectedCompetitors, statsMap)
        : matchOverviewImage(match);

  try {
    return new ImageResponse(element, {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": cacheControl },
    });
  } catch (err) {
    console.error("[og] ImageResponse failed:", err);
    return new ImageResponse(fallbackImage(), {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }
}

// ── Compare stats via direct cache access (no HTTP subrequest) ─────────
//
// Fetches scorecard data directly from Redis/GraphQL — the same path the
// compare route uses — so we avoid spawning a second Worker invocation.
// On CF Workers the stateless model gives each invocation its own CPU
// budget; a subrequest to /api/compare would exhaust that budget running
// the full compute for 100+ competitors. Fetching inline here shares the
// OG Worker's already-generous budget.

async function fetchOgCompareStats(
  ct: string,
  id: string,
  selectedIds: number[],
  timeoutMs: number = 12_000,
): Promise<Map<number, OgCompetitorStats> | null> {
  return Promise.race([
    fetchOgCompareStatsImpl(ct, id, selectedIds),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

async function fetchOgCompareStatsImpl(
  ct: string,
  id: string,
  selectedIds: number[],
): Promise<Map<number, OgCompetitorStats> | null> {
  const ctNum = parseInt(ct, 10);
  if (isNaN(ctNum)) return null;

  try {
    const scorecardsKey = gqlCacheKey("GetMatchScorecards", { ct: ctNum, id });
    const { data } = await cachedExecuteQuery<RawScorecardsData>(
      scorecardsKey,
      SCORECARDS_QUERY,
      { ct: ctNum, id },
      3600, // fallback TTL on cache miss; compare route will correct it later
    );

    if (!data.event) return null;

    // Parse full scorecard data using the shared parser (same as compare route)
    const rawScorecards = parseRawScorecards(data);

    // Build minimal CompetitorInfo for the selected group — only id is used by
    // computeGroupRankings to define group membership; division comes from scorecards.
    const requestedCompetitors: CompetitorInfo[] = selectedIds.map((cid) => ({
      id: cid,
      shooterId: null,
      name: `Competitor ${String(cid)}`,
      competitor_number: "",
      club: null,
      division: null,
      region: null,
      region_display: null,
      category: null,
      ics_alias: null,
      license: null,
    }));

    // computeGroupRankings gives accurate group/div/overall % using the full field
    const stages = computeGroupRankings(rawScorecards, requestedCompetitors);

    // Build division map from scorecards (no match metadata needed here)
    const divisionMap = new Map<number, string | null>();
    for (const sc of rawScorecards) {
      if (!divisionMap.has(sc.competitor_id)) {
        divisionMap.set(sc.competitor_id, sc.competitor_division);
      }
    }

    // Full-field fingerprint points — needed for percentile ranks
    const fieldFingerprintPoints = computeAllFingerprintPoints(rawScorecards, divisionMap);
    const fieldAlphaRatios = fieldFingerprintPoints.map((p) => p.alphaRatio);
    const fieldSpeeds = fieldFingerprintPoints.map((p) => p.pointsPerSecond);

    const map = new Map<number, OgCompetitorStats>();
    for (const cid of selectedIds) {
      // Aggregate per-stage percentages
      const firedStages = stages.filter((s) => {
        const c = s.competitors[cid];
        return c != null && !c.dnf;
      });

      const groupPcts = firedStages.map((s) => s.competitors[cid]?.group_percent).filter((v): v is number => v != null);
      const overallPcts = firedStages.map((s) => s.competitors[cid]?.overall_percent).filter((v): v is number => v != null);
      const divPcts = firedStages.map((s) => s.competitors[cid]?.div_percent).filter((v): v is number => v != null);

      const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

      // Consistency label
      const { label: consistency } = computeConsistencyStats(stages, cid);

      // Points per shot
      const pointsPerShot = computeCompetitorPPS(stages, cid);

      // Style fingerprint → archetype
      const base = computeStyleFingerprint(stages, cid);
      const accuracyPercentile =
        base.alphaRatio != null
          ? computePercentileRank(base.alphaRatio, fieldAlphaRatios)
          : null;
      const speedPercentile =
        base.pointsPerSecond != null
          ? computePercentileRank(base.pointsPerSecond, fieldSpeeds)
          : null;
      const archetype = assignArchetype(accuracyPercentile, speedPercentile);

      map.set(cid, {
        matchPct: avg(groupPcts),
        overallPct: avg(overallPcts),
        divPct: avg(divPcts),
        archetype,
        consistency,
        pointsPerShot,
        stagesFired: firedStages.length,
      });
    }

    return map;
  } catch (err) {
    console.error("[og-stats] ERROR in fetchOgCompareStatsImpl:", err);
    return null;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Inline SVG icon for each archetype — same icons as lucide-react uses in
 * the comparison table (Target, Crosshair, Gauge, TrendingUp).
 * Satori can render inline <svg> elements but not React components from
 * lucide-react, so we embed the raw SVG paths here.
 */
function archetypeIcon(archetype: string, size: number, color: string) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (archetype) {
    case "Gunslinger": // Target
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      );
    case "Surgeon": // Crosshair
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <line x1="22" x2="18" y1="12" y2="12" />
          <line x1="6" x2="2" y1="12" y2="12" />
          <line x1="12" x2="12" y1="6" y2="2" />
          <line x1="12" x2="12" y1="22" y2="18" />
        </svg>
      );
    case "Speed Demon": // Gauge
      return (
        <svg {...props}>
          <path d="m12 14 4-4" />
          <path d="M3.34 19a10 10 0 1 1 17.32 0" />
        </svg>
      );
    case "Grinder": // TrendingUp
      return (
        <svg {...props}>
          <path d="M16 7h6v6" />
          <path d="m22 7-8.5 8.5-5-5L2 17" />
        </svg>
      );
    default:
      return null;
  }
}

function matchSubtitle(match: OgMatchData): string {
  return [
    match.venue,
    match.date ? formatDate(match.date) : null,
    match.level,
  ]
    .filter(Boolean)
    .join("  \u00b7  ");
}

function matchContext(match: OgMatchData): string {
  return [
    `${String(match.stagesCount)} stages`,
    `${String(match.competitorsCount)} competitors`,
    match.level,
  ]
    .filter(Boolean)
    .join("  \u00b7  ");
}

// ── Image variants ──────────────────────────────────────────────────────

/** Match overview — no competitors selected. Shows match metadata + stats. */
function matchOverviewImage(match: OgMatchData) {
  const subtitle = matchSubtitle(match);
  const scored = match.scoringCompleted;
  const statusText =
    scored >= 95
      ? "Results complete"
      : scored > 0
        ? `Scoring in progress (${String(scored)}%)`
        : "Upcoming match";

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        backgroundColor: C.bg,
        color: C.text,
      }}
    >
      {/* Background image layers (below content) */}
      {match.imageUrl ? matchImageBgLayers(match.imageUrl, match.imageWidth, match.imageHeight) : targetBgLayers()}

      {/* Content layer (above background) */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: OG_W,
          height: OG_H,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {topAccent()}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            padding: "40px 56px 36px",
            justifyContent: "space-between",
          }}
        >
          {brandHeader()}

          {/* Main content — match name and subtitle */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div
              style={{
                fontSize: "52px",
                fontWeight: 700,
                lineHeight: 1.15,
                letterSpacing: "-0.02em",
              }}
            >
              {match.name}
            </div>
            {subtitle !== "" ? (
              <div style={{ display: "flex", fontSize: "28px", color: C.muted }}>
                {subtitle}
              </div>
            ) : null}
          </div>

          {/* Stats row */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-end",
              justifyContent: "space-between",
              width: "100%",
            }}
          >
            <div style={{ display: "flex", flexDirection: "row", gap: "20px" }}>
              {statBadge(String(match.stagesCount), "stages")}
              {match.minRounds ? statBadge(String(match.minRounds), "rounds") : null}
              {statBadge(String(match.competitorsCount), "competitors")}
              {match.scoringCompleted > 0 ? statBadge(`${String(match.scoringCompleted)}%`, "scored") : null}
              {match.region ? statBadge(match.region, "region") : null}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", fontSize: "20px", color: C.accent }}>
                {statusText}
              </div>
              <div style={{ fontSize: "22px", color: C.dim }}>
                scoreboard.urdr.dev
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Single competitor — personal result card with performance data. */
function singleCompetitorImage(
  match: OgMatchData,
  competitor: CompetitorInfo,
  statsMap: Map<number, OgCompetitorStats> | null,
) {
  const matchInfo = [match.name, match.date ? formatDate(match.date) : null]
    .filter(Boolean)
    .join("  \u00b7  ");
  const details = [competitor.division, competitor.club]
    .filter(Boolean)
    .join("  \u00b7  ");
  const stats = statsMap?.get(competitor.id) ?? null;

  // If we have results data, show the rich card
  if (stats && stats.stagesFired > 0) {
    return singleCompetitorWithStats(match, competitor, stats, matchInfo, details);
  }

  // No results — show metadata card with match stats
  return singleCompetitorNoStats(match, competitor, matchInfo, details);
}

/**
 * Background layer: the match image sits in the rightmost 1/3 of the canvas
 * (400px wide) at full OG height, with a linear gradient spanning the FULL
 * display width (bg→transparent left-to-right) so the image fades in smoothly.
 *
 * Sizing logic (requires the image's natural dimensions):
 *   • Scale the image to OG_H height: scaledW = naturalW * (OG_H / naturalH)
 *   • If scaledW >= 400px → crop to right 400px (objectFit:cover), container
 *     starts at x = OG_W - 400 = 800
 *   • If scaledW < 400px → show the full image right-aligned, container width
 *     = scaledW, starts at x = OG_W - scaledW
 *   • If dimensions unknown → fall back to 400px container
 *
 * The container has position:absolute so Satori positions it via left/top.
 * The gradient lives inside the same container, also position:absolute, so
 * it inherits the container as its positioning context.
 *
 * Returns a SINGLE <div> (not a Fragment) — required for Satori.
 */
/**
 * Auto-detect layout based on image aspect ratio:
 *
 * **Landscape** (aspect ≥ 1.4 — wider than OG canvas ratio 1200/630 ≈ 1.9):
 *   Full-width background spanning the entire canvas. Left-to-right gradient
 *   keeps text readable on the left while the image dominates.
 *
 * **Portrait / square** (aspect < 1.4):
 *   Image pinned to the right, scaled to full OG height. Left-to-right
 *   gradient fades the image into the dark background.
 *
 * Falls back to landscape (full-width) when dimensions are unknown.
 */
function matchImageBgLayers(
  imageUrl: string,
  imageWidth: number | null,
  imageHeight: number | null,
) {
  const aspect =
    imageWidth != null && imageHeight != null && imageHeight > 0
      ? imageWidth / imageHeight
      : null;

  // Landscape or unknown → full-width hero
  if (aspect == null || aspect >= 1.4) {
    return matchImageFullWidth(imageUrl);
  }

  // Portrait / square → right-aligned column
  return matchImageRightAligned(imageUrl, imageWidth!, imageHeight!);
}

/** Landscape layout: image spans the full 1200×630 canvas. */
function matchImageFullWidth(imageUrl: string) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: OG_W,
        height: OG_H,
        display: "flex",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt=""
        width={OG_W}
        height={OG_H}
        style={{ objectFit: "cover", objectPosition: "center", display: "flex" }}
      />
      {/* Gradient: opaque left → transparent right */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: OG_W,
          height: OG_H,
          backgroundImage: `linear-gradient(to right, ${C.bg} 0%, rgba(10,10,10,0.85) 35%, rgba(10,10,10,0.4) 65%, rgba(10,10,10,0.15) 100%)`,
          display: "flex",
        }}
      />
    </div>
  );
}

/** Portrait / square layout: image on the right ~50%, full height. */
function matchImageRightAligned(
  imageUrl: string,
  imageWidth: number,
  imageHeight: number,
) {
  // Scale image to full OG height, then cap at 50% of canvas width
  const scaledW = Math.round(imageWidth * (OG_H / imageHeight));
  const displayW = Math.min(scaledW, Math.round(OG_W * 0.5));
  const containerLeft = OG_W - displayW;

  return (
    <div
      style={{
        position: "absolute",
        left: containerLeft,
        top: 0,
        width: displayW,
        height: OG_H,
        display: "flex",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt=""
        width={displayW}
        height={OG_H}
        style={{ objectFit: "cover", objectPosition: "center", display: "flex" }}
      />
      {/* Gradient: solid left edge fading to transparent */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: displayW,
          height: OG_H,
          backgroundImage: `linear-gradient(to right, ${C.bg} 0%, rgba(10,10,10,0.5) 40%, rgba(10,10,10,0.15) 100%)`,
          display: "flex",
        }}
      />
    </div>
  );
}

function singleCompetitorWithStats(
  match: OgMatchData,
  competitor: CompetitorInfo,
  stats: OgCompetitorStats,
  matchInfo: string,
  details: string,
) {
  const pillElements: React.ReactNode[] = [];
  if (stats.archetype) {
    pillElements.push(pill(stats.archetype, C.muted, archetypeIcon(stats.archetype, 20, C.muted)));
  }
  if (stats.consistency) {
    pillElements.push(pill(stats.consistency, C.muted));
  }
  if (stats.pointsPerShot != null) {
    pillElements.push(pill(`${stats.pointsPerShot.toFixed(1)} pts/shot`, C.muted));
  }

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        backgroundColor: C.bg,
        color: C.text,
      }}
    >
      {/* Background image layers (below content) */}
      {match.imageUrl ? matchImageBgLayers(match.imageUrl, match.imageWidth, match.imageHeight) : targetBgLayers()}

      {/* Content layer (above background) */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: OG_W,
          height: OG_H,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {topAccent()}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            padding: "36px 56px 32px",
            gap: "24px",
          }}
        >
          {brandHeader(matchInfo)}

          {/* Content card: name + performance together.
              maxWidth keeps the card out of the image area (gradient starts
              at x = OG_W - imgW - gradW = 600). */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              justifyContent: "center",
              gap: "24px",
              width: "100%",
              maxWidth: 650,
              padding: "28px 36px",
              backgroundColor: C.cardBg,
              borderRadius: "16px",
              border: `1px solid ${C.border}`,
            }}
          >
            {/* Name + details */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <div
                style={{
                  fontSize: "48px",
                  fontWeight: 700,
                  lineHeight: 1.15,
                  letterSpacing: "-0.02em",
                }}
              >
                {competitor.name}
              </div>
              {details !== "" ? (
                <div style={{ display: "flex", fontSize: "24px", color: C.muted }}>
                  {details}
                </div>
              ) : null}
            </div>

          {/* Match % + bar */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-end",
              gap: "20px",
              width: "100%",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: "18px", color: C.dim }}>
                division performance
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "4px",
                }}
              >
                <div
                  style={{
                    fontSize: "60px",
                    fontWeight: 700,
                    color: C.accent,
                    lineHeight: 1,
                  }}
                >
                  {formatPct(stats.divPct)}
                </div>
                <div style={{ fontSize: "28px", color: C.dim }}>%</div>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flex: 1,
                flexDirection: "column",
                gap: "8px",
                paddingBottom: "8px",
              }}
            >
              {pctBar(stats.divPct, C.accent, "20px")}
              <div style={{ display: "flex", fontSize: "18px", color: C.dim }}>
                {`${String(stats.stagesFired)} of ${String(match.stagesCount)} stages  \u00b7  ${String(match.competitorsCount)} competitors`}
              </div>
            </div>
          </div>

          {/* Trait pills */}
          <div style={{ display: "flex", gap: "10px" }}>{pillElements}</div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            width: "100%",
            maxWidth: 650,
          }}
        >
          <div style={{ fontSize: "22px", color: C.dim }}>
            scoreboard.urdr.dev
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

function singleCompetitorNoStats(
  match: OgMatchData,
  competitor: CompetitorInfo,
  matchInfo: string,
  details: string,
) {
  const ctx = matchContext(match);

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        backgroundColor: C.bg,
        color: C.text,
      }}
    >
      {match.imageUrl ? matchImageBgLayers(match.imageUrl, match.imageWidth, match.imageHeight) : targetBgLayers()}

      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: OG_W,
          height: OG_H,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {topAccent()}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            padding: "40px 56px 36px",
            justifyContent: "space-between",
          }}
        >
          {brandHeader(matchInfo)}

          {/* Name + details */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div
              style={{
                fontSize: "56px",
                fontWeight: 700,
                lineHeight: 1.15,
                letterSpacing: "-0.02em",
              }}
            >
              {competitor.name}
            </div>
            {details !== "" ? (
              <div style={{ display: "flex", fontSize: "28px", color: C.muted }}>
                {details}
              </div>
            ) : null}
          </div>

          {/* Stats row */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-end",
              justifyContent: "space-between",
              width: "100%",
            }}
          >
            <div style={{ display: "flex", gap: "20px" }}>
              {statBadge(String(match.stagesCount), "stages")}
              {statBadge(String(match.competitorsCount), "competitors")}
              {match.scoringCompleted > 0 ? statBadge(`${String(match.scoringCompleted)}%`, "scored") : null}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: "6px",
              }}
            >
              {ctx !== "" ? (
                <div style={{ display: "flex", fontSize: "20px", color: C.dim }}>
                  {ctx}
                </div>
              ) : null}
              <div style={{ fontSize: "22px", color: C.dim }}>
                scoreboard.urdr.dev
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Multi-competitor — head-to-head with performance bars. */
function multiCompetitorImage(
  match: OgMatchData,
  competitors: CompetitorInfo[],
  statsMap: Map<number, OgCompetitorStats> | null,
) {
  const matchInfo = [match.name, match.date ? formatDate(match.date) : null]
    .filter(Boolean)
    .join("  \u00b7  ");
  const hasStats = statsMap != null && statsMap.size > 0;

  if (hasStats) {
    return multiCompetitorWithStats(match, competitors, statsMap, matchInfo);
  }

  return multiCompetitorNoStats(match, competitors, matchInfo);
}

function multiCompetitorWithStats(
  match: OgMatchData,
  competitors: CompetitorInfo[],
  statsMap: Map<number, OgCompetitorStats>,
  matchInfo: string,
) {
  const maxShown = 5;
  const shown = competitors.slice(0, maxShown);
  const remaining = competitors.length - maxShown;

  // Sort by matchPct descending for a leaderboard feel
  const sorted = [...shown].sort((a, b) => {
    const sa = statsMap.get(a.id);
    const sb = statsMap.get(b.id);
    return (sb?.matchPct ?? 0) - (sa?.matchPct ?? 0);
  });

  const rows = sorted.map((c, i) => {
    const stats = statsMap.get(c.id);
    const pct = stats?.matchPct ?? 0;
    const color = PALETTE[competitors.indexOf(c) % PALETTE.length];
    const archetype = stats?.archetype ?? "";
    const icon = archetype !== "" ? archetypeIcon(archetype, 20, C.dim) : null;
    const divClub = [c.division, c.club].filter(Boolean).join("  \u00b7  ");
    const subtitle = archetype !== "" ? archetype : divClub;

    return (
      <div
        key={String(c.id)}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          width: "100%",
        }}
      >
        {/* Name row — name left, percentage right, never compete for space */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "baseline",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: "28px",
              fontWeight: 700,
              color: i === 0 ? C.text : C.muted,
            }}
          >
            {c.name}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "28px",
              fontWeight: 700,
              color,
              paddingLeft: "16px",
            }}
          >
            {`${formatPct(pct)}%`}
          </div>
        </div>
        {/* Subtitle row — division/archetype, never overlaps with percentage */}
        {subtitle !== "" ? (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "18px", color: C.dim }}>
            {icon}
            {subtitle}
          </div>
        ) : null}
        {pctBar(pct, color, "16px")}
      </div>
    );
  });

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        backgroundColor: C.bg,
        color: C.text,
      }}
    >
      {match.imageUrl ? matchImageBgLayers(match.imageUrl, match.imageWidth, match.imageHeight) : targetBgLayers()}

      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: OG_W,
          height: OG_H,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {topAccent()}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            padding: "36px 56px 32px",
            gap: "24px",
          }}
        >
          {brandHeader(matchInfo)}

          {/* Leaderboard card — wrapper centers the card vertically */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              width: "100%",
              maxWidth: 650,
              padding: "24px 32px",
              backgroundColor: C.cardBg,
              borderRadius: "16px",
              border: `1px solid ${C.border}`,
            }}
          >
            {rows}
            {remaining > 0 ? (
              <div
                style={{
                  display: "flex",
                  fontSize: "20px",
                  color: C.dim,
                }}
              >
                {`+${String(remaining)} more competitors`}
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-end",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", fontSize: "20px", color: C.dim }}>
            {match.scoringCompleted > 0
              ? `${String(match.stagesCount)} stages  \u00b7  ${String(match.competitorsCount)} competitors  \u00b7  ${String(match.scoringCompleted)}% scored`
              : `${String(match.stagesCount)} stages  \u00b7  ${String(match.competitorsCount)} competitors`}
          </div>
          <div style={{ fontSize: "22px", color: C.dim }}>
            scoreboard.urdr.dev
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

function multiCompetitorNoStats(
  match: OgMatchData,
  competitors: CompetitorInfo[],
  matchInfo: string,
) {
  const maxShown = 5;
  const shown = competitors.slice(0, maxShown);
  const remaining = competitors.length - maxShown;

  const rows = shown.map((c, i) => {
    const info = [c.division, c.club].filter(Boolean).join("  \u00b7  ");
    const color = PALETTE[i % PALETTE.length];
    return (
      <div
        key={String(c.id)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "14px",
          width: "100%",
        }}
      >
        {/* Color bar indicator */}
        <div
          style={{
            display: "flex",
            width: "4px",
            height: "36px",
            borderRadius: "2px",
            backgroundColor: color,
          }}
        />
        <div style={{ display: "flex", fontSize: "28px", fontWeight: 600 }}>
          {c.name}
        </div>
        {info !== "" ? (
          <div style={{ display: "flex", fontSize: "20px", color: C.muted }}>
            {info}
          </div>
        ) : null}
      </div>
    );
  });

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        backgroundColor: C.bg,
        color: C.text,
      }}
    >
      {match.imageUrl ? matchImageBgLayers(match.imageUrl, match.imageWidth, match.imageHeight) : targetBgLayers()}

      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: OG_W,
          height: OG_H,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {topAccent()}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            padding: "36px 56px 32px",
            justifyContent: "space-between",
          }}
        >
          {brandHeader(matchInfo)}

          {/* Competitor list */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              width: "100%",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: "24px",
                fontWeight: 600,
                color: C.muted,
              }}
            >
              {`Comparing ${String(competitors.length)} competitors`}
            </div>
            {rows}
            {remaining > 0 ? (
              <div
                style={{
                  display: "flex",
                  fontSize: "20px",
                  color: C.dim,
                  paddingLeft: "18px",
                }}
              >
                {`+${String(remaining)} more`}
              </div>
            ) : null}
          </div>

          {/* Footer with stats */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-end",
              width: "100%",
            }}
          >
            <div style={{ display: "flex", gap: "20px" }}>
              {statBadge(String(match.stagesCount), "stages")}
              {statBadge(String(match.competitorsCount), "competitors")}
              {match.scoringCompleted > 0 ? statBadge(`${String(match.scoringCompleted)}%`, "scored") : null}
            </div>
            <div style={{ fontSize: "22px", color: C.dim }}>
              scoreboard.urdr.dev
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

