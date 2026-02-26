import { ImageResponse } from "next/og";
import { fetchOgMatchData, type OgMatchData } from "@/lib/og-data";
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
  const { origin, searchParams } = new URL(req.url);
  const competitorsParam = searchParams.get("competitors");
  const logoUrl = `${origin}/icons/icon-192.png`;

  // Social-media crawlers are patient — allow up to 15s for a cold-cache fetch.
  const match = await fetchOgMatchData(ct, id, 15_000);

  // Determine cache duration based on match completion status
  const isComplete = match ? match.scoringCompleted >= 95 : false;
  const cacheControl = isComplete
    ? "public, max-age=86400, s-maxage=604800"
    : "public, max-age=60, s-maxage=300";

  if (!match) {
    return new ImageResponse(fallbackImage(logoUrl), {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  }

  // Resolve selected competitors from the match data
  const selectedCompetitors = competitorsParam
    ? competitorsParam
        .split(",")
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((cid) => match.competitors.find((c) => c.id === cid))
        .filter((c): c is CompetitorInfo => c != null)
    : [];

  // Fetch comparison data when competitors are selected
  let statsMap: Map<number, OgCompetitorStats> | null = null;
  if (selectedCompetitors.length > 0) {
    statsMap = await fetchCompareStats(
      req,
      ct,
      id,
      selectedCompetitors.map((c) => c.id),
    );
  }

  const element =
    selectedCompetitors.length === 1
      ? singleCompetitorImage(match, selectedCompetitors[0], statsMap, logoUrl)
      : selectedCompetitors.length > 1
        ? multiCompetitorImage(match, selectedCompetitors, statsMap, logoUrl)
        : matchOverviewImage(match, logoUrl);

  try {
    return new ImageResponse(element, {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": cacheControl },
    });
  } catch (err) {
    console.error("[og] ImageResponse failed:", err);
    return new ImageResponse(fallbackImage(logoUrl), {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }
}

// ── Compare data fetch ─────────────────────────────────────────────────

async function fetchCompareStats(
  req: Request,
  ct: string,
  id: string,
  competitorIds: number[],
): Promise<Map<number, OgCompetitorStats> | null> {
  try {
    const origin = new URL(req.url).origin;
    const url = `${origin}/api/compare?ct=${ct}&id=${id}&competitor_ids=${competitorIds.join(",")}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json();
    const map = new Map<number, OgCompetitorStats>();

    for (const cid of competitorIds) {
      const cidStr = String(cid);

      // Compute average group_percent, overall_percent, and div_percent from stages
      let groupSum = 0;
      let overallSum = 0;
      let divSum = 0;
      let count = 0;
      let divCount = 0;
      for (const stage of data.stages ?? []) {
        const cs = stage.competitors?.[cidStr];
        if (cs && cs.group_percent != null) {
          groupSum += cs.group_percent;
          overallSum += cs.overall_percent ?? cs.group_percent;
          count++;
          if (cs.div_percent != null) {
            divSum += cs.div_percent;
            divCount++;
          }
        }
      }

      const penaltyData = data.penaltyStats?.[cidStr];
      const consistencyData = data.consistencyStats?.[cidStr];
      const styleData = data.styleFingerprintStats?.[cidStr];
      const effData = data.efficiencyStats?.[cidStr];

      map.set(cid, {
        matchPct: penaltyData?.matchPctActual ?? (count > 0 ? groupSum / count : 0),
        overallPct: count > 0 ? overallSum / count : 0,
        divPct: divCount > 0 ? divSum / divCount : 0,
        archetype: styleData?.archetype ?? null,
        consistency: consistencyData?.label ?? null,
        pointsPerShot: effData?.pointsPerShot ?? null,
        stagesFired: consistencyData?.stagesFired ?? count,
      });
    }

    return map;
  } catch (err) {
    console.error("[og] Failed to fetch compare data:", err);
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

function brandIcon(logoUrl: string) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      width={48}
      height={48}
      alt="SSI Scoreboard"
      style={{ borderRadius: "10px" }}
    />
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

function brandHeader(logoUrl: string, rightText?: string) {
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
        {brandIcon(logoUrl)}
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
function matchOverviewImage(match: OgMatchData, logoUrl: string) {
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
      {match.imageUrl ? matchImageBgLayers(match.imageUrl) : null}

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
          {brandHeader(logoUrl)}

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
  logoUrl: string,
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
    return singleCompetitorWithStats(match, competitor, stats, matchInfo, details, logoUrl);
  }

  // No results — show metadata card with match stats
  return singleCompetitorNoStats(match, competitor, matchInfo, details, logoUrl);
}

// OG canvas dimensions (must match ImageResponse width/height).
// Used for explicit pixel heights on absolutely-positioned layers so Satori
// doesn't have to resolve "100%" through a chain of percentage containers.
const OG_W = 1200;
const OG_H = 630;

/**
 * Absolutely-positioned background layers: the match image occupies the right
 * ~33% of the canvas and a gradient fades it into the dark background.
 * Rendered BEFORE the content layer so it sits beneath the text.
 *
 * Uses explicit pixel heights (OG_H) because Satori does not reliably resolve
 * height:"100%" on absolutely-positioned children.
 */
function matchImageBgLayers(imageUrl: string) {
  const imgW = 400; // ~33% of OG_W
  return (
    <>
      {/* Image: right imgW px, full canvas height, objectFit:contain so any
          aspect ratio (portrait OR wide landscape banner) is fully visible */}
      <div
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          width: imgW,
          height: OG_H,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: C.bg,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          width={imgW}
          height={OG_H}
          style={{ objectFit: "contain", display: "flex" }}
        />
      </div>
      {/* Gradient: wider than image, fades from bg (left) to transparent (right) */}
      <div
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          width: imgW + 100,
          height: OG_H,
          backgroundImage: `linear-gradient(to right, ${C.bg} 0%, transparent 65%)`,
          display: "flex",
        }}
      />
    </>
  );
}

function singleCompetitorWithStats(
  match: OgMatchData,
  competitor: CompetitorInfo,
  stats: OgCompetitorStats,
  matchInfo: string,
  details: string,
  logoUrl: string,
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
      {match.imageUrl ? matchImageBgLayers(match.imageUrl) : null}

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
          {brandHeader(logoUrl, matchInfo)}

          {/* Content card: name + performance together */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              justifyContent: "center",
              gap: "24px",
              width: "100%",
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
  logoUrl: string,
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
      {match.imageUrl ? matchImageBgLayers(match.imageUrl) : null}

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
          {brandHeader(logoUrl, matchInfo)}

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
  logoUrl: string,
) {
  const matchInfo = [match.name, match.date ? formatDate(match.date) : null]
    .filter(Boolean)
    .join("  \u00b7  ");
  const hasStats = statsMap != null && statsMap.size > 0;

  if (hasStats) {
    return multiCompetitorWithStats(match, competitors, statsMap, matchInfo, logoUrl);
  }

  return multiCompetitorNoStats(match, competitors, matchInfo, logoUrl);
}

function multiCompetitorWithStats(
  match: OgMatchData,
  competitors: CompetitorInfo[],
  statsMap: Map<number, OgCompetitorStats>,
  matchInfo: string,
  logoUrl: string,
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
          gap: "8px",
          width: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: "30px",
                fontWeight: 700,
                color: i === 0 ? C.text : C.muted,
              }}
            >
              {c.name}
            </div>
            {subtitle !== "" ? (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "20px", color: C.dim }}>
                {icon}
                {subtitle}
              </div>
            ) : null}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "30px",
              fontWeight: 700,
              color,
            }}
          >
            {`${formatPct(pct)}%`}
          </div>
        </div>
        {pctBar(pct, color, "20px")}
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
      {match.imageUrl ? matchImageBgLayers(match.imageUrl) : null}

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
          {brandHeader(logoUrl, matchInfo)}

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
              gap: "24px",
              width: "100%",
              padding: "28px 36px",
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
  logoUrl: string,
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
      {match.imageUrl ? matchImageBgLayers(match.imageUrl) : null}

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
          {brandHeader(logoUrl, matchInfo)}

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
function fallbackImage(logoUrl: string) {
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          width={80}
          height={80}
          alt="SSI Scoreboard"
          style={{ borderRadius: "16px" }}
        />
        <div style={{ fontSize: "40px", fontWeight: 700 }}>SSI Scoreboard</div>
        <div style={{ fontSize: "22px", color: C.muted }}>
          Live IPSC competitor comparison
        </div>
      </div>
    </div>
  );
}
