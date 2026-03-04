import { ImageResponse } from "next/og";
import {
  C,
  OG_W,
  OG_H,
  brandIcon,
  topAccent,
  targetBgLayers,
} from "@/lib/og-helpers";

// ── Route handler ────────────────────────────────────────────────────────

export async function GET() {
  return new ImageResponse(
    (
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
        {/* Faded target decoration on the right */}
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
              alignItems: "center",
              justifyContent: "center",
              gap: "28px",
              padding: "40px 60px",
            }}
          >
            {/* App icon — concentric-circles target */}
            {brandIcon(96)}

            {/* Title */}
            <div
              style={{
                display: "flex",
                fontSize: "64px",
                fontWeight: 700,
                letterSpacing: "-0.02em",
              }}
            >
              SSI Scoreboard
            </div>

            {/* Tagline */}
            <div
              style={{
                display: "flex",
                fontSize: "28px",
                color: C.muted,
                textAlign: "center",
              }}
            >
              Live stage-by-stage IPSC competitor comparison
            </div>

            {/* Feature pills */}
            <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
              {["Side-by-side results", "Hit factor charts", "Coaching analysis"].map(
                (label) => (
                  <div
                    key={label}
                    style={{
                      display: "flex",
                      padding: "10px 24px",
                      borderRadius: "24px",
                      backgroundColor: C.cardBg,
                      border: `1px solid ${C.border}`,
                      fontSize: "22px",
                      color: C.muted,
                    }}
                  >
                    {label}
                  </div>
                ),
              )}
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              paddingBottom: "32px",
              fontSize: "22px",
              color: C.dim,
            }}
          >
            scoreboard.urdr.dev
          </div>
        </div>
      </div>
    ),
    {
      width: OG_W,
      height: OG_H,
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" },
    },
  );
}
