import { ImageResponse } from "next/og";

// ── Design tokens (same as match OG images) ─────────────────────────────

const C = {
  bg: "#0a0a0a",
  cardBg: "#18181b",
  border: "#27272a",
  text: "#fafafa",
  muted: "#a1a1aa",
  dim: "#52525b",
  accent: "#f97316",
} as const;

const OG_W = 1200;
const OG_H = 630;

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
          {/* Top accent bar */}
          <div
            style={{
              display: "flex",
              width: "100%",
              height: "4px",
              backgroundColor: C.accent,
            }}
          />

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
            <svg
              width={96}
              height={96}
              viewBox="0 0 100 100"
              style={{ display: "flex" }}
            >
              <circle cx="50" cy="50" r="44" fill="none" stroke={C.dim} strokeWidth="4" />
              <circle cx="50" cy="50" r="28" fill="none" stroke={C.muted} strokeWidth="4" />
              <circle cx="50" cy="50" r="12" fill="none" stroke={C.accent} strokeWidth="6" />
            </svg>

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

/** Decorative target background — faded half-target on the right side. */
function targetBgLayers() {
  const displayW = Math.round(OG_W / 3);
  const containerLeft = OG_W - displayW;
  const targetSize = OG_H;

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
      <div
        style={{
          position: "absolute",
          left: displayW * 0.15,
          top: 0,
          width: targetSize,
          height: targetSize,
          display: "flex",
          opacity: 0.1,
        }}
      >
        <svg
          width={targetSize}
          height={targetSize}
          viewBox="0 0 200 200"
          style={{ display: "flex" }}
        >
          <circle cx="100" cy="100" r="96" fill="none" stroke={C.muted} strokeWidth="2" />
          <circle cx="100" cy="100" r="72" fill="none" stroke={C.muted} strokeWidth="2" />
          <circle cx="100" cy="100" r="48" fill="none" stroke={C.muted} strokeWidth="2" />
          <circle cx="100" cy="100" r="24" fill="none" stroke={C.muted} strokeWidth="2" />
          <line x1="100" y1="4" x2="100" y2="196" stroke={C.muted} strokeWidth="1" />
          <line x1="4" y1="100" x2="196" y2="100" stroke={C.muted} strokeWidth="1" />
        </svg>
      </div>
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
