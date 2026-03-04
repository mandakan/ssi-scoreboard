import { ImageResponse } from "next/og";
import { fetchOgShooterData, type OgShooterData } from "@/lib/og-data";
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

// ── Route handler ──────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ shooterId: string }> },
) {
  const { shooterId: shooterIdStr } = await params;
  const shooterId = parseInt(shooterIdStr, 10);
  if (isNaN(shooterId) || shooterId <= 0) {
    return new ImageResponse(
      fallbackImage("Shooter performance dashboard"),
      {
        width: OG_W,
        height: OG_H,
        headers: { "Cache-Control": "public, max-age=3600" },
      },
    );
  }

  // Social-media crawlers are patient — allow up to 5s for cold cache
  const shooter = await fetchOgShooterData(shooterId, 5_000);

  if (!shooter) {
    return new ImageResponse(
      fallbackImage("Shooter performance dashboard"),
      {
        width: OG_W,
        height: OG_H,
        headers: { "Cache-Control": "public, max-age=60" },
      },
    );
  }

  const hasStats = shooter.overallMatchPct != null && shooter.totalStages > 0;
  const element = hasStats
    ? shooterWithStatsImage(shooter)
    : shooterProfileImage(shooter);
  const cacheControl = hasStats
    ? "public, max-age=300, s-maxage=1800"
    : "public, max-age=60, s-maxage=300";

  try {
    return new ImageResponse(element, {
      width: OG_W,
      height: OG_H,
      headers: { "Cache-Control": cacheControl },
    });
  } catch (err) {
    console.error("[og] Shooter ImageResponse failed:", err);
    return new ImageResponse(
      fallbackImage("Shooter performance dashboard"),
      {
        width: OG_W,
        height: OG_H,
        headers: { "Cache-Control": "public, max-age=60" },
      },
    );
  }
}

// ── Image variants ──────────────────────────────────────────────────────

/** Full stats card — shown when dashboard cache is populated. */
function shooterWithStatsImage(shooter: OgShooterData) {
  const details = [shooter.division, shooter.club]
    .filter(Boolean)
    .join("  \u00b7  ");

  const matchPct = shooter.overallMatchPct ?? 0;

  // Date range text
  const dateRange =
    shooter.dateRange.from && shooter.dateRange.to
      ? `${formatDate(shooter.dateRange.from)} \u2013 ${formatDate(shooter.dateRange.to)}`
      : null;

  // Trend pill
  const trendLabel =
    shooter.hfTrendSlope != null
      ? shooter.hfTrendSlope > 0.01
        ? "Improving"
        : shooter.hfTrendSlope < -0.01
          ? "Declining"
          : "Stable"
      : null;
  const trendColor =
    trendLabel === "Improving"
      ? "#22c55e"
      : trendLabel === "Declining"
        ? "#ef4444"
        : C.muted;

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
      {targetBgLayers()}

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
          {brandHeader("Shooter Dashboard")}

          {/* Content card */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              justifyContent: "center",
              gap: "24px",
              width: "100%",
              maxWidth: 700,
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
                {shooter.name}
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
                  avg match performance
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
                    {formatPct(matchPct)}
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
                {pctBar(matchPct, C.accent, "20px")}
                <div style={{ display: "flex", fontSize: "18px", color: C.dim }}>
                  {`${String(shooter.matchCount)} matches  \u00b7  ${String(shooter.totalStages)} stages`}
                </div>
              </div>
            </div>

            {/* Stat badges + trend pill */}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {shooter.overallAvgHF != null
                ? pill(`${shooter.overallAvgHF.toFixed(2)} avg HF`, C.muted)
                : null}
              {shooter.aPercent != null
                ? pill(`${formatPct(shooter.aPercent)}% A-zone`, C.muted)
                : null}
              {trendLabel ? pill(trendLabel, trendColor) : null}
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
            {dateRange ? (
              <div style={{ display: "flex", fontSize: "20px", color: C.dim }}>
                {dateRange}
              </div>
            ) : (
              <div style={{ display: "flex" }} />
            )}
            <div style={{ fontSize: "22px", color: C.dim }}>
              scoreboard.urdr.dev
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Profile-only card — shown when no dashboard cache is available. */
function shooterProfileImage(shooter: OgShooterData) {
  const details = [shooter.division, shooter.club]
    .filter(Boolean)
    .join("  \u00b7  ");

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
      {targetBgLayers()}

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
          {brandHeader("Shooter Dashboard")}

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
              {shooter.name}
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
              {statBadge(String(shooter.matchCount), "matches")}
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
