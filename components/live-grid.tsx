"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveGridCellView } from "@/components/live-grid-cell";
import { LiveGridSheet } from "@/components/live-grid-sheet";
import { CELL_MIN_W, NAME_COL, SCROLL_PAD } from "@/components/live-grid-layout";
import { computeLiveEdgeStageId } from "@/lib/live-grid";
import type { GridRowSource } from "@/lib/live-grid-rows";
import { useLiveGridQuery } from "@/lib/queries";
import { shortName } from "@/lib/selection-summary";
import { cn } from "@/lib/utils";
import type { LiveGridCell, LiveGridStage } from "@/lib/types";

const PENDING_CELL: LiveGridCell = {
  hf: null, time: null, points: null,
  a: null, c: null, d: null, m: null, ns: null, p: null,
  status: "pending", created: null,
};

export interface LiveGridProps {
  ct: string;
  id: string;
  /** Competitor IDs, already resolved by resolveGridRows. */
  shooters: number[];
  myShooterId?: number | null;
  source: GridRowSource;
  onSourceChange: (source: GridRowSource) => void;
  /** Opens the tracked-shooters manager; the Manage button shows for the tracked source only. */
  onManage?: () => void;
  /**
   * False once the match is complete: the grid fetches once and stops
   * polling. Defaults to true (live polling).
   */
  live?: boolean;
}

/**
 * The courtside grid: one row per shooter, one column per stage; fills its
 * container (the match shell owns the viewport). See docs/superpowers/specs/2026-08-23-live-grid-design.md.
 */
export function LiveGrid({
  ct,
  id,
  shooters,
  myShooterId = null,
  source,
  onSourceChange,
  onManage,
  live = true,
}: LiveGridProps) {
  const query = useLiveGridQuery(ct, id, shooters, { live });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const didAutoScroll = useRef(false);
  const [openCell, setOpenCell] = useState<{ row: number; stage: number } | null>(
    null,
  );

  const data = query.data;
  const stages = useMemo(() => data?.stages ?? [], [data]);
  const cells = useMemo(() => data?.cells ?? {}, [data]);

  const liveEdgeStageId = useMemo(
    () => computeLiveEdgeStageId(cells, stages),
    [cells, stages],
  );

  const jumpTo = useCallback(
    (stageId: number, behavior: ScrollBehavior = "smooth") => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const target = scroller.querySelector<HTMLElement>(
        `[data-stage-col="${stageId}"]`,
      );
      const nameCol = scroller.querySelector<HTMLElement>("[data-name-col]");
      if (!target) return;
      const offset = nameCol?.getBoundingClientRect().width ?? 0;
      const left = Math.max(0, target.offsetLeft - offset);
      // scrollTo is absent in jsdom and in a few older mobile browsers;
      // assigning scrollLeft works everywhere and just skips the animation.
      if (typeof scroller.scrollTo === "function") {
        scroller.scrollTo({ left, behavior });
      } else {
        scroller.scrollLeft = left;
      }
    },
    [],
  );

  // Open scrolled to the stage they just shot -- once, not on every refetch.
  useEffect(() => {
    if (didAutoScroll.current || liveEdgeStageId == null) return;
    didAutoScroll.current = true;
    jumpTo(liveEdgeStageId, "auto");
  }, [liveEdgeStageId, jumpTo]);

  const shooterById = useMemo(
    () => new Map((data?.shooters ?? []).map((s) => [s.id, s])),
    [data],
  );

  const stageState = useCallback(
    (stage: LiveGridStage): "done" | "live" | "todo" => {
      if (stage.stage_id === liveEdgeStageId) return "live";
      const rows = data?.shooters ?? [];
      if (rows.length === 0) return "todo";
      const allScored = rows.every(
        (s) => cells[s.id]?.[stage.stage_id]?.created != null,
      );
      return allScored ? "done" : "todo";
    },
    [cells, data, liveEdgeStageId],
  );

  const doneCount = stages.filter((s) => stageState(s) === "done").length;
  const liveEdgeStage = stages.find((s) => s.stage_id === liveEdgeStageId);

  const active =
    openCell != null
      ? {
          shooter: shooterById.get(openCell.row),
          stage: stages.find((s) => s.stage_id === openCell.stage),
          cell: cells[openCell.row]?.[openCell.stage] ?? PENDING_CELL,
        }
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Row source chips, progress indicator and live-stage jump */}
      <div
        data-live-grid-header
        className="flex-none border-b bg-card"
      >
        <div className="flex items-center gap-2 px-3 py-1.5">
        <div className="flex flex-none items-center gap-1.5">
          {(["squad", "tracked"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={source === s}
              onClick={() => onSourceChange(s)}
              className={cn(
                "min-h-11 rounded-full border px-3 text-[12px] font-medium",
                source === s
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground",
              )}
            >
              {s === "squad" ? "My squad" : "Tracked"}
            </button>
          ))}
          {source === "tracked" && onManage && (
            <button
              type="button"
              onClick={onManage}
              className="min-h-11 rounded-md border px-2.5 text-[12px] font-medium"
            >
              Manage
            </button>
          )}
        </div>
        <span className="ml-auto flex-none whitespace-nowrap font-mono text-[12px] text-muted-foreground">
          <span className="sr-only">Stages done: </span>
          {doneCount}/{stages.length}
        </span>
        {liveEdgeStage && (
          <button
            type="button"
            onClick={() => jumpTo(liveEdgeStage.stage_id)}
            aria-label={`Jump to live stage ${liveEdgeStage.stage_num}`}
            className="min-h-11 shrink-0 rounded-md border px-2.5 text-[12px] font-medium"
          >
            Live: S{liveEdgeStage.stage_num}
          </button>
        )}
        </div>
        {/* Progress only, full width: per-stage buttons cannot reach 44px at 390px. */}
        <div
          aria-hidden="true"
          data-live-grid-rail
          className="flex w-full gap-px"
        >
          {stages.map((stage) => {
            const state = stageState(stage);
            return (
              <span
                key={stage.stage_id}
                className={cn(
                  "block h-1 flex-1",
                  state === "live"
                    ? "bg-foreground"
                    : state === "done"
                      ? "bg-[var(--perf-green)]"
                      : "bg-border",
                )}
              />
            );
          })}
        </div>
      </div>

      {/* Grid. scroll-padding-left (SCROLL_PAD) matches the sticky name column (NAME_COL, 104px) so snap
          points land beside it rather than hiding a stage underneath. */}
      <div
        ref={scrollerRef}
        data-live-grid-scroller
        className={cn(
          "min-h-0 flex-1 overflow-auto bg-muted [scroll-snap-type:x_proximity] [overscroll-behavior-x:contain]",
          SCROLL_PAD,
        )}
      >
        <table className="min-w-full border-separate border-spacing-0 font-mono tabular-nums">
          <thead>
            <tr>
              <th
                scope="col"
                data-name-col
                className={cn(
                  NAME_COL,
                  "sticky left-0 top-0 z-40 border-b border-r bg-card px-2 py-1.5 text-left text-[12px] font-semibold tracking-widest text-muted-foreground",
                )}
              >
                SHOOTER
              </th>
              {stages.map((stage) => (
                <th
                  key={stage.stage_id}
                  scope="col"
                  className={cn(
                    "sticky top-0 z-30 border-b border-r bg-card px-1 py-1.5 text-center text-[12px] font-semibold tracking-wide",
                    stage.stage_id === liveEdgeStageId
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  S{stage.stage_num}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.shooters ?? []).map((shooter) => (
              <tr key={shooter.id}>
                <th
                  scope="row"
                  data-name-col
                  className={cn(
                    NAME_COL,
                    "sticky left-0 z-20 border-b border-r bg-card px-2 py-1.5 text-left shadow-[3px_0_6px_-4px_rgba(0,0,0,0.28)]",
                  )}
                >
                  <span className="flex items-center gap-1.5 font-sans text-[12px] font-semibold tracking-tight text-foreground">
                    <span className="min-w-0 truncate">{shortName(shooter.name)}</span>
                    {shooter.shooterId != null &&
                      shooter.shooterId === myShooterId && (
                        <span className="inline-flex shrink-0 items-center rounded-sm bg-primary/10 px-1 py-px font-sans text-[12px] font-medium uppercase tracking-wide text-primary">
                          You
                        </span>
                      )}
                  </span>
                  <span className="block truncate text-[12px] tracking-wide text-muted-foreground">
                    {shooter.division ?? "—"} &middot; {shooter.competitor_number}
                  </span>
                </th>
                {stages.map((stage) => {
                  const cell =
                    cells[shooter.id]?.[stage.stage_id] ?? PENDING_CELL;
                  return (
                    <td
                      key={stage.stage_id}
                      data-stage-col={stage.stage_id}
                      className="border-b border-r bg-card p-0 [scroll-snap-align:start]"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenCell({ row: shooter.id, stage: stage.stage_id })
                        }
                        aria-label={`${shooter.name}, stage ${stage.stage_num}`}
                        className={cn(
                          CELL_MIN_W,
                          "flex min-h-11 w-full flex-col gap-0.5 bg-transparent px-1.5 py-1.5 text-left font-mono tabular-nums",
                        )}
                      >
                        <LiveGridCellView cell={cell} />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active?.shooter && active.stage && (
        <LiveGridSheet
          open
          cell={active.cell}
          shooter={active.shooter}
          stage={active.stage}
          onClose={() => setOpenCell(null)}
        />
      )}
    </div>
  );
}
