"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3 } from "lucide-react";
import { LiveGridCellView } from "@/components/live-grid-cell";
import { LiveGridSheet } from "@/components/live-grid-sheet";
import { computeLiveEdgeStageId } from "@/lib/live-grid";
import type { GridRowSource } from "@/lib/live-grid-rows";
import { useLiveGridQuery } from "@/lib/queries";
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
  matchName: string;
  myShooterId?: number | null;
  source: GridRowSource;
  onSourceChange: (source: GridRowSource) => void;
  /** Switches to the deep comparison table. */
  onExit: () => void;
}

/**
 * The courtside grid: one row per shooter, one column per stage, filling the
 * viewport. See docs/superpowers/specs/2026-08-23-live-grid-design.md.
 */
export function LiveGrid({
  ct,
  id,
  shooters,
  matchName,
  myShooterId = null,
  source,
  onSourceChange,
  onExit,
}: LiveGridProps) {
  const query = useLiveGridQuery(ct, id, shooters);
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

  // Lock body scroll while the grid owns the viewport.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

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

  const active =
    openCell != null
      ? {
          shooter: shooterById.get(openCell.row),
          stage: stages.find((s) => s.stage_id === openCell.stage),
          cell: cells[openCell.row]?.[openCell.stage] ?? PENDING_CELL,
        }
      : null;

  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-background">
      {/* Title bar */}
      <div className="flex flex-none items-center gap-2.5 border-b bg-card px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <span
          aria-hidden="true"
          className="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--perf-green)]"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-[13px] font-semibold tracking-tight">
            {matchName}
          </b>
          <span className="text-[10.5px] text-muted-foreground">
            {source === "squad" ? "My squad" : "Tracked"} &middot;{" "}
            {query.isFetching ? "updating…" : `${shooters.length} shooters`}
          </span>
        </span>
        <button
          type="button"
          onClick={onExit}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium text-muted-foreground"
        >
          <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
          Full analysis
        </button>
      </div>

      {/* Row source */}
      <div className="flex flex-none items-center gap-1.5 bg-card px-3 pb-1 pt-2">
        {(["squad", "tracked"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={source === s}
            onClick={() => onSourceChange(s)}
            className={cn(
              "min-h-0 rounded-full border px-3 py-1.5 text-[11.5px] font-medium",
              source === s
                ? "border-foreground bg-foreground text-background"
                : "text-muted-foreground",
            )}
          >
            {s === "squad" ? "My squad" : "Tracked"}
          </button>
        ))}
      </div>

      {/* Stage rail */}
      <div className="flex flex-none items-center gap-[3px] border-b bg-card px-3 py-1.5">
        {stages.map((stage) => {
          const state = stageState(stage);
          return (
            <button
              key={stage.stage_id}
              type="button"
              onClick={() => jumpTo(stage.stage_id)}
              aria-label={`Jump to stage ${stage.stage_num}`}
              className="grid h-5 flex-1 place-items-center bg-transparent p-0"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "block w-full rounded-sm",
                  state === "live"
                    ? "h-[5px] bg-foreground"
                    : state === "done"
                      ? "h-[3px] bg-[var(--perf-green)]"
                      : "h-[3px] bg-border",
                )}
              />
            </button>
          );
        })}
        <small className="ml-1.5 whitespace-nowrap font-mono text-[9.5px] tracking-wide text-muted-foreground">
          {stages.filter((s) => stageState(s) === "done").length}/{stages.length}
        </small>
      </div>

      {/* Grid */}
      <div
        ref={scrollerRef}
        data-live-grid-scroller
        className="min-h-0 flex-1 overflow-auto bg-muted [scroll-snap-type:x_proximity] [overscroll-behavior-x:contain]"
      >
        <table className="border-separate border-spacing-0 font-mono tabular-nums">
          <thead>
            <tr>
              <th
                scope="col"
                data-name-col
                className="sticky left-0 top-0 z-40 w-[94px] min-w-[94px] border-b border-r bg-card px-2 py-1.5 text-left text-[10px] font-semibold tracking-widest text-muted-foreground"
              >
                SHOOTER
              </th>
              {stages.map((stage) => (
                <th
                  key={stage.stage_id}
                  scope="col"
                  className={cn(
                    "sticky top-0 z-30 border-b border-r bg-card px-1 py-1.5 text-center text-[10px] font-semibold tracking-wide",
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
                  className="sticky left-0 z-20 w-[94px] min-w-[94px] border-b border-r bg-card px-2 py-1.5 text-left shadow-[3px_0_6px_-4px_rgba(0,0,0,0.28)]"
                >
                  <span className="block truncate font-sans text-[11.5px] font-semibold tracking-tight text-foreground">
                    {shortName(shooter.name)}
                    {shooter.shooterId != null &&
                      shooter.shooterId === myShooterId && (
                        <span className="ml-1.5 inline-flex items-center rounded-sm bg-primary/10 px-1 py-px align-middle font-sans text-[8.5px] font-medium uppercase tracking-wide text-primary">
                          You
                        </span>
                      )}
                  </span>
                  <span className="block text-[9.5px] tracking-wide text-muted-foreground">
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
                        className="flex min-h-11 w-full min-w-[74px] flex-col gap-0.5 bg-transparent px-1.5 py-1.5 text-left font-mono tabular-nums"
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

// "Mathias Axell" -> "Mathias A." so a 94px column holds a real name.
function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}
