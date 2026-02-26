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

// ── Route handler ────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { origin } = new URL(req.url);
  const logoUrl = `${origin}/icons/icon-192.png`;

  return new ImageResponse(
    (
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
          {/* App icon */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl}
            width={96}
            height={96}
            alt="SSI Scoreboard"
            style={{ borderRadius: "20px" }}
          />

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
    ),
    {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" },
    },
  );
}
