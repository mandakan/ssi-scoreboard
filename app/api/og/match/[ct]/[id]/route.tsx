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

  // Social-media crawlers are patient — allow up to 15s for a cold-cache fetch.
  const match = await fetchOgMatchData(ct, id, 15_000);

  // Determine cache duration based on match completion status
  const isComplete = match ? match.scoringCompleted >= 95 : false;
  const cacheControl = isComplete
    ? "public, max-age=86400, s-maxage=604800"
    : "public, max-age=60, s-maxage=300";

  if (!match) {
    return new ImageResponse(fallbackImage(), {
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

      // Compute average group_percent and overall_percent from stages
      let groupSum = 0;
      let overallSum = 0;
      let count = 0;
      for (const stage of data.stages ?? []) {
        const cs = stage.competitors?.[cidStr];
        if (cs && cs.group_percent != null) {
          groupSum += cs.group_percent;
          overallSum += cs.overall_percent ?? cs.group_percent;
          count++;
        }
      }

      const penaltyData = data.penaltyStats?.[cidStr];
      const consistencyData = data.consistencyStats?.[cidStr];
      const styleData = data.styleFingerprintStats?.[cidStr];
      const effData = data.efficiencyStats?.[cidStr];

      map.set(cid, {
        matchPct: penaltyData?.matchPctActual ?? (count > 0 ? groupSum / count : 0),
        overallPct: count > 0 ? overallSum / count : 0,
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

// ── Shared layout pieces ────────────────────────────────────────────────

function brandIcon() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "32px",
        height: "32px",
        borderRadius: "50%",
        border: `2.5px solid ${C.accent}`,
      }}
    >
      <div
        style={{
          display: "flex",
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          backgroundColor: C.accent,
        }}
      />
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
        <div style={{ fontSize: "20px", fontWeight: 600 }}>SSI Scoreboard</div>
      </div>
      {rightText !== undefined && rightText !== "" ? (
        <div
          style={{
            display: "flex",
            fontSize: "18px",
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
      <div style={{ fontSize: "32px", fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: "14px", color: C.muted, marginTop: "2px" }}>
        {label}
      </div>
    </div>
  );
}

function pill(label: string, color: string) {
  return (
    <div
      style={{
        display: "flex",
        padding: "6px 16px",
        borderRadius: "20px",
        backgroundColor: C.cardBg,
        border: `1px solid ${C.border}`,
        fontSize: "16px",
        color,
      }}
    >
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
          padding: "40px 56px 36px",
          justifyContent: "space-between",
        }}
      >
        {brandHeader()}

        {/* Main content — match name and subtitle */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
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
            <div style={{ display: "flex", fontSize: "24px", color: C.muted }}>
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
            {match.region
              ? statBadge(match.region, "region")
              : null}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: "6px",
            }}
          >
            <div style={{ display: "flex", fontSize: "16px", color: C.accent }}>
              {statusText}
            </div>
            <div style={{ fontSize: "18px", color: C.dim }}>
              scoreboard.urdr.dev
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

function singleCompetitorWithStats(
  match: OgMatchData,
  competitor: CompetitorInfo,
  stats: OgCompetitorStats,
  matchInfo: string,
  details: string,
) {
  const pills = [
    stats.archetype,
    stats.consistency,
    stats.pointsPerShot != null
      ? `${stats.pointsPerShot.toFixed(1)} pts/shot`
      : null,
  ].filter((s): s is string => s != null);

  const pillElements = pills.map((label) => pill(label, C.muted));

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
          padding: "36px 56px 32px",
          gap: "24px",
        }}
      >
        {brandHeader(matchInfo)}

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
          <div
            style={{ display: "flex", flexDirection: "column", gap: "4px" }}
          >
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
              <div
                style={{ display: "flex", fontSize: "22px", color: C.muted }}
              >
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
              <div style={{ display: "flex", fontSize: "13px", color: C.dim }}>
                match performance
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
                  {formatPct(stats.matchPct)}
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
              {pctBar(stats.matchPct, C.accent, "18px")}
              <div style={{ display: "flex", fontSize: "14px", color: C.dim }}>
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
          <div style={{ fontSize: "18px", color: C.dim }}>
            scoreboard.urdr.dev
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
              <div style={{ display: "flex", fontSize: "16px", color: C.dim }}>
                {ctx}
              </div>
            ) : null}
            <div style={{ fontSize: "18px", color: C.dim }}>
              scoreboard.urdr.dev
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
            alignItems: "baseline",
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
                fontSize: "28px",
                fontWeight: 700,
                color: i === 0 ? C.text : C.muted,
              }}
            >
              {c.name}
            </div>
            {subtitle !== "" ? (
              <div style={{ display: "flex", fontSize: "17px", color: C.dim }}>
                {subtitle}
              </div>
            ) : null}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "28px",
              fontWeight: 700,
              color,
            }}
          >
            {`${formatPct(pct)}%`}
          </div>
        </div>
        {pctBar(pct, color, "18px")}
      </div>
    );
  });

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
                  fontSize: "18px",
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
          <div style={{ display: "flex", fontSize: "16px", color: C.dim }}>
            {`${String(match.stagesCount)} stages  \u00b7  ${String(match.competitorsCount)} competitors  \u00b7  ${String(match.scoringCompleted)}% scored`}
          </div>
          <div style={{ fontSize: "18px", color: C.dim }}>
            scoreboard.urdr.dev
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
        <div style={{ display: "flex", fontSize: "26px", fontWeight: 600 }}>
          {c.name}
        </div>
        {info !== "" ? (
          <div style={{ display: "flex", fontSize: "18px", color: C.muted }}>
            {info}
          </div>
        ) : null}
      </div>
    );
  });

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
              fontSize: "22px",
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
                fontSize: "18px",
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
          <div style={{ fontSize: "18px", color: C.dim }}>
            scoreboard.urdr.dev
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
          gap: "16px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            border: `3px solid ${C.accent}`,
          }}
        >
          <div
            style={{
              display: "flex",
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              backgroundColor: C.accent,
            }}
          />
        </div>
        <div style={{ fontSize: "40px", fontWeight: 700 }}>SSI Scoreboard</div>
        <div style={{ fontSize: "22px", color: C.muted }}>
          Live IPSC competitor comparison
        </div>
      </div>
    </div>
  );
}
