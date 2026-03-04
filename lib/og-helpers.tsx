// Shared OG image design tokens, constants, and visual primitives.
// Used by all OG image routes (match, shooter, root).

import type React from "react";

// ── Design tokens ──────────────────────────────────────────────────────

export const C = {
  bg: "#0a0a0a",
  cardBg: "#18181b",
  border: "#27272a",
  text: "#fafafa",
  muted: "#a1a1aa",
  dim: "#52525b",
  accent: "#f97316",
  barBg: "#27272a",
} as const;

// ── Canvas dimensions ──────────────────────────────────────────────────

export const OG_W = 1200;
export const OG_H = 630;

// ── Formatters ─────────────────────────────────────────────────────────

export function formatDate(iso: string): string {
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

export function formatPct(pct: number): string {
  return pct >= 100 ? "100" : pct.toFixed(1);
}

// ── Shared layout pieces ───────────────────────────────────────────────

/** Brand icon — concentric-circles target using design system colors. */
export function brandIcon(size = 48) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ display: "flex" }}
    >
      <circle cx="50" cy="50" r="44" fill="none" stroke={C.dim} strokeWidth="4" />
      <circle cx="50" cy="50" r="28" fill="none" stroke={C.muted} strokeWidth="4" />
      <circle cx="50" cy="50" r="12" fill="none" stroke={C.accent} strokeWidth="6" />
    </svg>
  );
}

export function topAccent() {
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

export function brandHeader(rightText?: string) {
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
            backgroundColor: "rgba(10, 10, 10, 0.65)",
            padding: "6px 14px",
            borderRadius: "8px",
          }}
        >
          {rightText}
        </div>
      ) : null}
    </div>
  );
}

export function statBadge(value: string, label: string) {
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

export function pill(label: string, color: string, icon?: React.ReactNode) {
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
export function pctBar(percent: number, color: string, height: string) {
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

/**
 * Decorative target background — shown when no match image is available.
 * Positioned on the right third like match images, with left-to-right fade.
 */
export function targetBgLayers() {
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
      {/* Target — shifted right so only the left portion is visible */}
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
      {/* Gradient fade — same direction as match images */}
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

/** Fallback — shown when data cannot be loaded. Tagline is configurable. */
export function fallbackImage(tagline = "Live IPSC competitor comparison") {
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
            alignItems: "center",
            justifyContent: "center",
            gap: "20px",
          }}
        >
          {brandIcon()}
          <div style={{ fontSize: "40px", fontWeight: 700 }}>SSI Scoreboard</div>
          <div style={{ fontSize: "22px", color: C.muted }}>
            {tagline}
          </div>
        </div>
      </div>
    </div>
  );
}
