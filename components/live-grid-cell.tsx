import { BAR_SEGMENTS, PENALTY_DEFS } from "@/components/hit-zone-bar";
import type { LiveGridCell } from "@/lib/types";

/**
 * One cell of the courtside grid -- proposal C, "quiet by default".
 *
 * A stage where points were dropped draws the A/C/D bar plus penalty pips.
 * A clean run draws a single circle and "ALL A" instead: an all-alpha stage
 * is the best thing that can appear on the page, so it earns a positive mark
 * rather than an absence. Drawing nothing would make "clean" and "no data"
 * look identical.
 *
 * Circle is load-bearing for WCAG 1.4.1 -- it is the one shape neither the
 * bar (rectangle) nor the penalty pips (square, triangle, diamond) use, so
 * the marker separates under greyscale and CVD. The full breakdown is also
 * in the cell's aria-label, so nothing rests on colour alone.
 *
 * See docs/superpowers/specs/2026-08-23-live-grid-design.md.
 */
export function LiveGridCellView({ cell }: { cell: LiveGridCell }) {
  if (cell.status === "pending" || cell.status === "not_fired") {
    return (
      <span
        className="text-muted-foreground text-[13px]"
        role="img"
        aria-label="Not shot yet"
      >
        &mdash;
      </span>
    );
  }

  if (cell.status === "dq") {
    return (
      <>
        <span className="text-[11px] font-bold tracking-wide text-destructive">
          DQ
        </span>
        <span className="text-[10px] text-muted-foreground">&mdash;</span>
      </>
    );
  }

  const a = cell.a ?? 0;
  const c = cell.c ?? 0;
  const d = cell.d ?? 0;
  const m = cell.m ?? 0;
  const ns = cell.ns ?? 0;
  const p = cell.p ?? 0;

  if (cell.status === "zeroed") {
    return (
      <>
        <span className="text-[11px] font-bold tracking-wide text-destructive">
          ZERO
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {cell.time != null ? cell.time.toFixed(2) : "—"}
        </span>
        <PenaltyPips m={m} ns={ns} p={p} />
      </>
    );
  }

  const isClean = c + d + m + ns + p === 0;
  const breakdown =
    `${a}A ${c}C ${d}D` +
    (m ? ` ${m}M` : "") +
    (ns ? ` ${ns}NS` : "") +
    (p ? ` ${p}P` : "");

  return (
    <>
      <span className="text-[15px] font-semibold leading-none tracking-tight tabular-nums">
        {cell.hf != null ? cell.hf.toFixed(2) : "—"}
      </span>
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {cell.time != null ? cell.time.toFixed(2) : "—"}
      </span>
      {isClean ? (
        <span
          role="img"
          aria-label="All alpha, clean stage"
          className="flex h-[7px] items-center gap-1"
        >
          <span
            aria-hidden="true"
            className="h-[7px] w-[7px] shrink-0 rounded-full"
            style={{ background: ZONE_A }}
          />
          <span
            aria-hidden="true"
            className="text-[8.5px] font-bold uppercase tracking-wider"
            style={{ color: ZONE_A }}
          >
            All A
          </span>
        </span>
      ) : (
        <>
          <ZoneBar a={a} c={c} d={d} label={breakdown} />
          <PenaltyPips m={m} ns={ns} p={p} />
        </>
      )}
    </>
  );
}

const ZONE_A = BAR_SEGMENTS[0].fill;

// Cell-scale version of hit-zone-bar's SVG. Same fills, same ordering, same
// pattern semantics -- but 5px tall and tooltip-free, because a hover
// tooltip is useless on a phone. Exact counts live in the aria-label and in
// the detail sheet behind a tap.
function ZoneBar({
  a,
  c,
  d,
  label,
}: {
  a: number;
  c: number;
  d: number;
  label: string;
}) {
  const total = a + c + d;
  if (total === 0) return null;
  const counts: Record<string, number> = { a, c, d };
  return (
    <span
      role="img"
      aria-label={label}
      className="flex h-[5px] w-full overflow-hidden rounded-[1px]"
      style={{ background: "var(--border)" }}
    >
      {BAR_SEGMENTS.map(({ key, fill, patternKind }) => {
        const n = counts[key];
        if (!n) return null;
        return (
          <span
            key={key}
            className="block h-full"
            style={{
              flex: n,
              background: fill,
              backgroundImage: HATCH[patternKind],
            }}
          />
        );
      })}
    </span>
  );
}

// Mirrors hit-zone-bar's solid / diag-light / diag-dense vocabulary.
const HATCH: Record<string, string | undefined> = {
  solid: undefined,
  "diag-light":
    "repeating-linear-gradient(45deg, oklch(0 0 0 / 34%) 0 1px, transparent 1px 3px)",
  "diag-dense":
    "repeating-linear-gradient(45deg, oklch(0 0 0 / 34%) 0 1.5px, transparent 1.5px 3px)",
};

const PIP_SHAPE: Record<string, string> = {
  square: "1px",
  triangle: "polygon(50% 0, 100% 100%, 0 100%)",
  diamond: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)",
};

function PenaltyPips({ m, ns, p }: { m: number; ns: number; p: number }) {
  const counts: Record<string, number> = { m, ns, p };
  const visible = PENALTY_DEFS.filter((def) => counts[def.key] > 0);
  if (visible.length === 0) return null;

  const text = visible
    .map((def) => `${def.label === "NS" ? "N" : def.label}${counts[def.key]}`)
    .join(" ");

  return (
    <span className="flex items-center gap-[3px]">
      {visible.map((def) => (
        <span
          key={def.key}
          aria-hidden="true"
          className="h-[7px] w-[7px] shrink-0"
          style={{
            background: "var(--destructive)",
            ...(def.shape === "square"
              ? { borderRadius: PIP_SHAPE.square }
              : { clipPath: PIP_SHAPE[def.shape] }),
          }}
        />
      ))}
      <span className="text-[9px] font-bold tracking-tight text-destructive">
        {text}
      </span>
    </span>
  );
}
