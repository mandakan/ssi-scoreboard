import { ImageResponse } from "next/og";
import { fetchOgMatchData, type OgMatchData } from "@/lib/og-data";
import { cachedExecuteQuery, gqlCacheKey, SCORECARDS_QUERY } from "@/lib/graphql";
import { PALETTE } from "@/lib/colors";
import type { CompetitorInfo } from "@/lib/types";

// ── Design tokens ──────────────────────────────────────────────────────

const C = {
  bg: "#0a0a0a",
  cardBg: "#18181b",
  border: "#27272a",
  text: "#fafafa",
  muted: "#a1a1aa",
  dim: "#52525b",
  accent: "#f97316",
  barBg: "#27272a",
} as const;

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

  const isComplete = match.scoringCompleted >= 95;

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
// OG Worker's already-generous budget and only does the minimal work
// needed for the OG image (group % and division % per selected competitor).

interface RawOgScorecard {
  competitor_id: number;
  competitor_division: string | null;
  stage_id: number;
  hit_factor: number | null;
  valid: boolean; // not DQ/zeroed/DNF and HF > 0
}

interface RawOgScorecardsData {
  event: {
    stages?: Array<{
      id: string;
      scorecards?: Array<{
        hitfactor?: number | string | null;
        disqualified?: boolean | null;
        zeroed?: boolean | null;
        stage_not_fired?: boolean | null;
        competitor?: {
          id: string;
          handgun_div?: string | null;
          get_handgun_div_display?: string | null;
        } | null;
      }>;
    }>;
  } | null;
}

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
    const { data, cachedAt } = await cachedExecuteQuery<RawOgScorecardsData>(
      scorecardsKey,
      SCORECARDS_QUERY,
      { ct: ctNum, id },
      3600, // fallback TTL on cache miss; compare route will correct it later
    );

    if (!data.event) return null;

    // Parse the minimal scorecard fields we need
    const scorecards: RawOgScorecard[] = [];
    for (const stage of data.event.stages ?? []) {
      const stageId = parseInt(stage.id, 10);
      for (const sc of stage.scorecards ?? []) {
        if (!sc.competitor) continue;
        const hfRaw = sc.hitfactor != null ? parseFloat(String(sc.hitfactor)) : null;
        const hf = hfRaw != null && !isNaN(hfRaw) ? hfRaw : null;
        scorecards.push({
          competitor_id: parseInt(sc.competitor.id, 10),
          competitor_division: sc.competitor.get_handgun_div_display ?? sc.competitor.handgun_div ?? null,
          stage_id: stageId,
          hit_factor: hf,
          valid: !(sc.disqualified ?? false) && !(sc.zeroed ?? false) && !(sc.stage_not_fired ?? false) && hf != null && hf > 0,
        });
      }
    }

    // Group by stage so we can compute per-stage leaders
    const byStage = new Map<number, RawOgScorecard[]>();
    for (const sc of scorecards) {
      const arr = byStage.get(sc.stage_id) ?? [];
      arr.push(sc);
      byStage.set(sc.stage_id, arr);
    }

    // Accumulators per competitor
    const groupSums = new Map(selectedIds.map((cid) => [cid, 0]));
    const divSums = new Map(selectedIds.map((cid) => [cid, 0]));
    const counts = new Map(selectedIds.map((cid) => [cid, 0]));
    const divCounts = new Map(selectedIds.map((cid) => [cid, 0]));

    for (const [, stageScs] of byStage) {
      const valid = stageScs.filter((sc) => sc.valid);
      if (valid.length === 0) continue;

      // Group leader = highest HF among selected competitors on this stage
      const selectedValid = valid.filter((sc) => selectedIds.includes(sc.competitor_id));
      const groupLeaderHf = selectedValid.reduce((m, sc) => Math.max(m, sc.hit_factor!), 0);
      if (groupLeaderHf <= 0) continue;

      // Division leaders = highest HF per division (full field)
      const divLeaders = new Map<string, number>();
      for (const sc of valid) {
        const div = sc.competitor_division ?? "__none__";
        divLeaders.set(div, Math.max(divLeaders.get(div) ?? 0, sc.hit_factor!));
      }

      for (const cid of selectedIds) {
        const sc = selectedValid.find((s) => s.competitor_id === cid);
        if (!sc || sc.hit_factor == null) continue;

        groupSums.set(cid, (groupSums.get(cid) ?? 0) + (sc.hit_factor / groupLeaderHf) * 100);
        counts.set(cid, (counts.get(cid) ?? 0) + 1);

        const div = sc.competitor_division ?? "__none__";
        const divLeader = divLeaders.get(div) ?? 0;
        if (divLeader > 0) {
          divSums.set(cid, (divSums.get(cid) ?? 0) + (sc.hit_factor / divLeader) * 100);
          divCounts.set(cid, (divCounts.get(cid) ?? 0) + 1);
        }
      }
    }

    const map = new Map<number, OgCompetitorStats>();
    for (const cid of selectedIds) {
      const n = counts.get(cid) ?? 0;
      const dn = divCounts.get(cid) ?? 0;
      map.set(cid, {
        matchPct: n > 0 ? (groupSums.get(cid) ?? 0) / n : 0,
        overallPct: 0, // not computed in OG mode (would need overall leader per stage)
        divPct: dn > 0 ? (divSums.get(cid) ?? 0) / dn : 0,
        archetype: null, // not computed (requires full-field fingerprint)
        consistency: null,
        pointsPerShot: null,
        stagesFired: n,
      });
    }

    return map;
  } catch (err) {
    console.error("[og-stats] ERROR in fetchOgCompareStatsImpl:", err);
    return null;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatPct(pct: number): string {
  return pct >= 100 ? "100" : pct.toFixed(1);
}

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

// ── Shared layout pieces ────────────────────────────────────────────────

/**
 * Brand icon as a styled div — avoids PNG fetch subrequests on CF Workers.
 * Fetching external images inside Satori on CF Workers can fail with
 * "Unsupported image type: unknown" and contribute to CPU time overruns.
 */
function brandIcon() {
  return (
    <div
      style={{
        display: "flex",
        width: 48,
        height: 48,
        borderRadius: "10px",
        backgroundColor: C.accent,
        alignItems: "center",
        justifyContent: "center",
        fontSize: "18px",
        fontWeight: 700,
        color: C.bg,
        letterSpacing: "-0.03em",
      }}
    >
      SSI
    </div>
  );
}

function topAccent() {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "4px",
        backgroundColor: C.accent,
      }}
    />
  );
}

function brandHeader(rightText?: string) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {brandIcon()}
        <div style={{ fontSize: "24px", fontWeight: 600 }}>SSI Scoreboard</div>
      </div>
      {rightText !== undefined && rightText !== "" ? (
        <div
          style={{
            display: "flex",
            fontSize: "22px",
            color: C.muted,
            maxWidth: "600px",
          }}
        >
          {rightText}
        </div>
      ) : null}
    </div>
  );
}

function statBadge(value: string, label: string) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "14px 24px",
        backgroundColor: C.cardBg,
        borderRadius: "12px",
        border: `1px solid ${C.border}`,
      }}
    >
      <div style={{ fontSize: "36px", fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: "18px", color: C.muted, marginTop: "2px" }}>
        {label}
      </div>
    </div>
  );
}

function pill(label: string, color: string, icon?: React.ReactNode) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 18px",
        borderRadius: "20px",
        backgroundColor: C.cardBg,
        border: `1px solid ${C.border}`,
        fontSize: "20px",
        color,
      }}
    >
      {icon ?? null}
      {label}
    </div>
  );
}

/** Horizontal percentage bar */
function pctBar(percent: number, color: string, height: string) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height,
        backgroundColor: C.barBg,
        borderRadius: "6px",
      }}
    >
      <div
        style={{
          display: "flex",
          width: `${String(clamped)}%`,
          height: "100%",
          backgroundColor: color,
          borderRadius: "6px",
        }}
      />
    </div>
  );
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
      {match.imageUrl ? matchImageBgLayers(match.imageUrl, match.imageWidth, match.imageHeight) : null}

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
              {statBadge(String(match.competitorsCount), "competitors")}
              {statBadge(`${String(match.scoringCompleted)}%`, "scored")}
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

// OG canvas dimensions (must match ImageResponse width/height).
// Used for explicit pixel heights on absolutely-positioned layers so Satori
// doesn't have to resolve "100%" through a chain of percentage containers.
const OG_W = 1200;
const OG_H = 630;

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
function matchImageBgLayers(
  imageUrl: string,
  imageWidth: number | null,
  imageHeight: number | null,
) {
  const MAX_W = Math.round(OG_W / 3); // 400px = rightmost 33%

  // Compute natural width when image is scaled to full OG height
  const scaledW =
    imageWidth != null && imageHeight != null && imageHeight > 0
      ? Math.round(imageWidth * (OG_H / imageHeight))
      : null;

  // If the image is wide enough at full height, crop to MAX_W (objectFit:cover
  // keeps it full-height). Otherwise show the full image right-aligned.
  const displayW = scaledW == null || scaledW >= MAX_W ? MAX_W : scaledW;
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
        style={{ objectFit: "cover", display: "flex" }}
      />
      {/* Gradient spans the FULL display width → perfectly linear fade */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: displayW,
          height: OG_H,
          backgroundImage: `linear-gradient(to right, ${C.bg}, transparent)`,
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
      {match.imageUrl ? matchImageBgLayers(match.imageUrl, match.imageWidth, match.imageHeight) : null}

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
      {match.imageUrl ? matchImageBgLayers(match.imageUrl, match.imageWidth, match.imageHeight) : null}

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
              {statBadge(`${String(match.scoringCompleted)}%`, "scored")}
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
      {match.imageUrl ? matchImageBgLayers(match.imageUrl, match.imageWidth, match.imageHeight) : null}

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
            {`${String(match.stagesCount)} stages  \u00b7  ${String(match.competitorsCount)} competitors  \u00b7  ${String(match.scoringCompleted)}% scored`}
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
      {match.imageUrl ? matchImageBgLayers(match.imageUrl, match.imageWidth, match.imageHeight) : null}

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
              {statBadge(`${String(match.scoringCompleted)}%`, "scored")}
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

/** Fallback — shown when the match cannot be loaded. */
function fallbackImage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: C.bg,
        color: C.text,
      }}
    >
      {topAccent()}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: "20px",
        }}
      >
        {brandIcon()}
        <div style={{ fontSize: "40px", fontWeight: 700 }}>SSI Scoreboard</div>
        <div style={{ fontSize: "22px", color: C.muted }}>
          Live IPSC competitor comparison
        </div>
      </div>
    </div>
  );
}
