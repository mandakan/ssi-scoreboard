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
} as const;

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

  const element =
    selectedCompetitors.length === 1
      ? singleCompetitorImage(match, selectedCompetitors[0])
      : selectedCompetitors.length > 1
        ? multiCompetitorImage(match, selectedCompetitors)
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

function footerRow() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        width: "100%",
      }}
    >
      <div style={{ fontSize: "18px", color: C.dim }}>scoreboard.urdr.dev</div>
    </div>
  );
}

function statBadge(value: string, label: string) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "14px 24px",
        backgroundColor: C.cardBg,
        borderRadius: "12px",
        border: `1px solid ${C.border}`,
      }}
    >
      <div style={{ fontSize: "32px", fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: "15px", color: C.muted, marginTop: "2px" }}>
        {label}
      </div>
    </div>
  );
}

// ── Image variants ──────────────────────────────────────────────────────

/** Match overview — no competitors selected. Shows match metadata + stats. */
function matchOverviewImage(match: OgMatchData) {
  const subtitleParts = [
    match.venue,
    match.date ? formatDate(match.date) : null,
    match.level,
  ].filter(Boolean);
  const subtitle = subtitleParts.join("  \u00b7  ");

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
        }}
      >
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {brandIcon()}
          <div
            style={{
              fontSize: "20px",
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            SSI Scoreboard
          </div>
        </div>

        {/* Content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            gap: "12px",
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
          {subtitle ? (
            <div style={{ display: "flex", fontSize: "24px", color: C.muted }}>
              {subtitle}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: "24px", marginTop: "20px" }}>
            {statBadge(String(match.stagesCount), "stages")}
            {statBadge(String(match.competitorsCount), "competitors")}
            {statBadge(`${match.scoringCompleted}%`, "scored")}
          </div>
        </div>

        {footerRow()}
      </div>
    </div>
  );
}

/** Single competitor — personal result card. */
function singleCompetitorImage(
  match: OgMatchData,
  competitor: CompetitorInfo,
) {
  const matchInfo = [match.name, match.date ? formatDate(match.date) : null]
    .filter(Boolean)
    .join("  \u00b7  ");

  const details = [competitor.division, competitor.club]
    .filter(Boolean)
    .join("  \u00b7  ");

  const matchContext = [
    `${match.stagesCount} stages`,
    `${match.competitorsCount} competitors`,
    match.level,
  ]
    .filter(Boolean)
    .join("  \u00b7  ");

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
        }}
      >
        {/* Brand + match context */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {brandIcon()}
            <div style={{ fontSize: "20px", fontWeight: 600 }}>
              SSI Scoreboard
            </div>
          </div>
          {matchInfo ? (
            <div
              style={{
                display: "flex",
                fontSize: "18px",
                color: C.muted,
                maxWidth: "600px",
              }}
            >
              {matchInfo}
            </div>
          ) : null}
        </div>

        {/* Content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            gap: "8px",
          }}
        >
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
          {details ? (
            <div style={{ display: "flex", fontSize: "28px", color: C.muted }}>
              {details}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              marginTop: "20px",
              fontSize: "20px",
              color: C.dim,
            }}
          >
            {matchContext}
          </div>
        </div>

        {footerRow()}
      </div>
    </div>
  );
}

/** Multi-competitor comparison — shows competitor names with color bullets. */
function multiCompetitorImage(
  match: OgMatchData,
  competitors: CompetitorInfo[],
) {
  const matchInfo = [match.name, match.date ? formatDate(match.date) : null]
    .filter(Boolean)
    .join("  \u00b7  ");

  const maxShown = 5;
  const shown = competitors.slice(0, maxShown);
  const remaining = competitors.length - maxShown;

  // Satori requires pre-built arrays — .map() inside JSX can crash the
  // renderer when combined with conditional children.  Build rows eagerly.
  const rows = shown.map((c, i) => {
    const info = [c.division, c.club].filter(Boolean).join("  \u00b7  ");
    return (
      <div
        key={String(c.id)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "14px",
        }}
      >
        <div
          style={{
            display: "flex",
            width: "12px",
            height: "12px",
            borderRadius: "50%",
            backgroundColor: PALETTE[i % PALETTE.length],
          }}
        />
        <div style={{ display: "flex", fontSize: "26px", fontWeight: 600 }}>
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
        }}
      >
        {/* Brand + match context */}
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
            <div style={{ fontSize: "20px", fontWeight: 600 }}>
              SSI Scoreboard
            </div>
          </div>
          {matchInfo !== "" ? (
            <div
              style={{
                display: "flex",
                fontSize: "18px",
                color: C.muted,
                maxWidth: "600px",
              }}
            >
              {matchInfo}
            </div>
          ) : null}
        </div>

        {/* Content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            gap: "16px",
          }}
        >
          <div style={{ display: "flex", fontSize: "28px", fontWeight: 600, color: C.muted }}>
            {`Comparing ${String(competitors.length)} competitors`}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            {rows}
            {remaining > 0 ? (
              <div
                style={{
                  display: "flex",
                  fontSize: "20px",
                  color: C.dim,
                  paddingLeft: "24px",
                }}
              >
                {`+${String(remaining)} more`}
              </div>
            ) : null}
          </div>
        </div>

        {footerRow()}
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
