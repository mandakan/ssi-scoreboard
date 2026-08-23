"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { PENALTY_DEFS } from "@/components/hit-zone-bar";
import { BAR_SEGMENTS } from "@/components/hit-zone-bar";
import type {
  LiveGridCell,
  LiveGridShooter,
  LiveGridStage,
} from "@/lib/types";

// Points a single hit or penalty costs against an all-alpha run.
//
// TODO(major-scoring): these are Minor values (A5/C3/D1). Major is A5/C4/D2,
// which changes charlie from -2 to -1 and delta from -4 to -3. The scorecard
// response does not currently carry the competitor's power factor into this
// component, so the section is labelled "minor" rather than silently
// presenting Minor numbers as universal.
const COST = { c: 2, d: 4, m: 15, ns: 10, p: 10 } as const;

interface ZoneRow {
  key: string;
  label: string;
  count: number;
  cost: number;
  swatch: { fill: string; shape: "bar" | "square" | "triangle" | "diamond" };
}

export interface LiveGridSheetProps {
  open: boolean;
  cell: LiveGridCell;
  shooter: LiveGridShooter;
  stage: LiveGridStage;
  onClose: () => void;
}

/**
 * Scorecard detail for one cell.
 *
 * Every figure derives from this shooter's own card plus the stage's
 * max_points. This is where field context would be most tempting to add --
 * "you were 87% of the stage winner" -- and it must not be, because that
 * would reintroduce the whole-field dependency the grid exists to avoid.
 */
export function LiveGridSheet({
  open,
  cell,
  shooter,
  stage,
  onClose,
}: LiveGridSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-20 flex items-end bg-black/45"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Scorecard detail for ${shooter.name}, stage ${stage.stage_num}`}
        className="flex w-full flex-col gap-3 rounded-t-lg border-t bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-card-foreground"
      >
        <span
          aria-hidden="true"
          className="mx-auto h-1 w-8 rounded-full bg-border"
        />

        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <b className="block text-[15px] font-semibold tracking-tight">
              {shooter.name}
            </b>
            <span className="text-[11.5px] text-muted-foreground">
              Stage {stage.stage_num} &middot; {stage.name}
              {shooter.division ? ` · ${shooter.division}` : ""}
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close detail"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md border text-muted-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <SheetBody cell={cell} stage={stage} />
      </div>
    </div>
  );
}

function SheetBody({
  cell,
  stage,
}: {
  cell: LiveGridCell;
  stage: LiveGridStage;
}) {
  if (cell.status === "pending" || cell.status === "not_fired") {
    return (
      <p className="text-[13px] text-muted-foreground">
        Not shot yet.
      </p>
    );
  }
  if (cell.status === "dq") {
    return (
      <p className="text-[13px] font-semibold text-destructive">
        Disqualified. No score recorded for this stage.
      </p>
    );
  }
  if (cell.status === "zeroed") {
    return (
      <p className="text-[13px] font-semibold text-destructive">
        Stage zeroed. Time {cell.time?.toFixed(2) ?? "—"}s, but no points count.
      </p>
    );
  }

  const a = cell.a ?? 0;
  const c = cell.c ?? 0;
  const d = cell.d ?? 0;
  const m = cell.m ?? 0;
  const ns = cell.ns ?? 0;
  const p = cell.p ?? 0;

  const hitLoss = c * COST.c + d * COST.d + m * 5;
  const penLoss = (m + ns) * 10 + p * COST.p;
  const dropped = hitLoss + penLoss;
  const cleanHf = cell.time ? stage.max_points / cell.time : null;
  const gain = cleanHf != null && cell.hf != null ? cleanHf - cell.hf : null;

  const rows: ZoneRow[] = ([
    { key: "a", label: "alpha", count: a, cost: 0,
      swatch: { fill: BAR_SEGMENTS[0].fill, shape: "bar" as const } },
    { key: "c", label: "charlie", count: c, cost: COST.c,
      swatch: { fill: BAR_SEGMENTS[1].fill, shape: "bar" as const } },
    { key: "d", label: "delta", count: d, cost: COST.d,
      swatch: { fill: BAR_SEGMENTS[2].fill, shape: "bar" as const } },
    { key: "m", label: "miss", count: m, cost: COST.m,
      swatch: { fill: "var(--destructive)", shape: shapeFor("m") } },
    { key: "ns", label: "no-shoot", count: ns, cost: COST.ns,
      swatch: { fill: "var(--destructive)", shape: shapeFor("ns") } },
    { key: "p", label: "procedural", count: p, cost: COST.p,
      swatch: { fill: "var(--destructive)", shape: shapeFor("p") } },
  ] satisfies ZoneRow[]).filter((r) => r.count > 0);

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="Hit factor" value={cell.hf?.toFixed(4) ?? "—"} />
        <Metric label="Time" value={cell.time?.toFixed(2) ?? "—"} />
        <Metric
          label="Points"
          value={cell.points != null ? String(cell.points) : "—"}
          suffix={`/${stage.max_points}`}
        />
      </div>

      <ul className="divide-y overflow-hidden rounded-md border">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 px-2.5 py-1.5">
            <Swatch swatch={r.swatch} />
            <b className="min-w-[1.4em] font-mono text-[13px] font-semibold tabular-nums">
              {r.count}
            </b>
            <span className="flex-1 text-[12px] text-muted-foreground">
              {r.label}
            </span>
            <span
              className={
                r.cost > 0
                  ? "font-mono text-[12px] font-semibold text-destructive"
                  : "font-mono text-[12px] text-muted-foreground"
              }
            >
              {r.cost > 0 ? `−${r.cost * r.count}` : "0"}
            </span>
          </li>
        ))}
      </ul>

      {dropped > 0 ? (
        <div className="flex items-center gap-3 rounded-md bg-muted px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <b className="block text-[13px] font-semibold">
              −{dropped} points dropped (minor)
            </b>
            <span className="text-[11px] text-muted-foreground">
              {hitLoss} on target
              {penLoss ? `, ${penLoss} to penalties` : ""}
            </span>
          </div>
          {cleanHf != null && gain != null && (
            <div className="flex flex-col items-end">
              <b className="font-mono text-[17px] font-semibold tracking-tight text-[var(--perf-green)] tabular-nums">
                {cleanHf.toFixed(2)}
              </b>
              <span className="text-[11px] text-muted-foreground">
                HF if clean (+{gain.toFixed(2)})
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md bg-muted px-3 py-2.5">
          <b className="block text-[13px] font-semibold text-[var(--perf-green)]">
            Clean stage
          </b>
          <span className="text-[11px] text-muted-foreground">
            Every shot an alpha. Nothing left on the table.
          </span>
        </div>
      )}

      <p className="border-t pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
        Stage max {stage.max_points} points. Every figure here comes from this
        shooter&rsquo;s own scorecard &mdash; no stage winner, no field median,
        no ranking.
      </p>
    </>
  );
}

function shapeFor(key: string): ZoneRow["swatch"]["shape"] {
  return PENALTY_DEFS.find((d) => d.key === key)?.shape ?? "square";
}

function Swatch({ swatch }: { swatch: ZoneRow["swatch"] }) {
  const clip =
    swatch.shape === "triangle"
      ? "polygon(50% 0, 100% 100%, 0 100%)"
      : swatch.shape === "diamond"
        ? "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)"
        : undefined;
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 rounded-[1px]"
      style={{ background: swatch.fill, clipPath: clip }}
    />
  );
}

function Metric({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[9.5px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="m-0 font-mono text-[16px] font-semibold tracking-tight tabular-nums">
        {value}
        {suffix && (
          <span className="text-[11px] font-medium text-muted-foreground">
            {suffix}
          </span>
        )}
      </dd>
    </div>
  );
}
