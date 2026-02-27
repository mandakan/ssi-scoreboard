"use client";

import { useState, useId } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isMajorPowerFactor,
  simulateStageAdjustment,
  simulateMatchImpact,
} from "@/lib/what-if-calc";
import type { CompareResponse, CompetitorInfo, StageSimulatorAdjustments } from "@/lib/types";

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | null, digits = 2): string {
  if (n == null) return "—";
  return n.toFixed(digits);
}

function fmtDelta(n: number | null, digits = 2, invert = false): string {
  if (n == null || Math.abs(n) < 0.0001) return "";
  const val = invert ? -n : n;
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(digits)}`;
}

function fmtRankDelta(delta: number | null): string {
  if (delta == null || delta === 0) return "";
  if (delta > 0) return `↑${delta}`;
  return `↓${Math.abs(delta)}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
  decrementLabel?: string;
  incrementLabel?: string;
}

function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  formatValue = (v) => String(v),
  decrementLabel,
  incrementLabel,
}: StepperProps) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={id} className="text-sm text-foreground flex-1 leading-tight">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={decrementLabel ?? `Decrease ${label}`}
          onClick={() => onChange(Math.max(min, parseFloat((value - step).toFixed(10))))}
          disabled={value <= min}
          className={cn(
            "w-11 h-11 flex items-center justify-center rounded-md border",
            "text-foreground hover:bg-muted/50 active:bg-muted transition-colors",
            "disabled:opacity-40 disabled:pointer-events-none",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          )}
        >
          <Minus className="w-4 h-4" aria-hidden="true" />
        </button>
        <span
          id={id}
          className="text-sm font-mono font-medium w-14 text-center tabular-nums"
          aria-live="polite"
          aria-atomic="true"
        >
          {formatValue(value)}
        </span>
        <button
          type="button"
          aria-label={incrementLabel ?? `Increase ${label}`}
          onClick={() => onChange(Math.min(max, parseFloat((value + step).toFixed(10))))}
          disabled={value >= max}
          className={cn(
            "w-11 h-11 flex items-center justify-center rounded-md border",
            "text-foreground hover:bg-muted/50 active:bg-muted transition-colors",
            "disabled:opacity-40 disabled:pointer-events-none",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          )}
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

interface ResultRowProps {
  label: string;
  current: string;
  simulated: string;
  delta: string;
  deltaPositive?: boolean | null; // true = green, false = red, null = neutral
}

function ResultRow({ label, current, simulated, delta, deltaPositive }: ResultRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="text-sm font-mono tabular-nums text-muted-foreground">{current}</span>
      <span className="text-muted-foreground text-xs">→</span>
      <span className="text-sm font-mono tabular-nums font-medium">{simulated}</span>
      {delta ? (
        <span
          className={cn(
            "text-xs font-mono tabular-nums font-medium min-w-[3rem] text-right",
            deltaPositive === true && "text-green-600 dark:text-green-400",
            deltaPositive === false && "text-red-600 dark:text-red-400",
            deltaPositive == null && "text-muted-foreground"
          )}
        >
          ({delta})
        </span>
      ) : (
        <span className="min-w-[3rem]" />
      )}
    </div>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

interface StageSimulatorProps {
  data: CompareResponse;
  competitors: CompetitorInfo[];
  scoringCompleted: number;
}

const ZERO_ADJ: StageSimulatorAdjustments = {
  timeDelta: 0, missToACount: 0, missToCCount: 0,
  nsToACount: 0, nsToCCount: 0, cToACount: 0,
};

export function StageSimulator({ data, competitors, scoringCompleted }: StageSimulatorProps) {
  // All hooks must be called unconditionally before any early return.
  const [selectedCompetitorId, setSelectedCompetitorId] = useState<number>(
    competitors[0]?.id ?? 0
  );
  const [selectedStageId, setSelectedStageId] = useState<number>(
    data.stages[0]?.stage_id ?? 0
  );
  const [adj, setAdj] = useState<StageSimulatorAdjustments>(ZERO_ADJ);
  const liveRegionId = useId();

  if (scoringCompleted < 80) return null;

  const selectedComp = competitors.find((c) => c.id === selectedCompetitorId) ?? competitors[0];
  const selectedStage = data.stages.find((s) => s.stage_id === selectedStageId) ?? data.stages[0];

  if (!selectedComp || !selectedStage) return null;

  const compSummary = selectedStage.competitors[selectedComp.id];
  const isMajor = isMajorPowerFactor(selectedComp.division);

  // Current stats for selected competitor on selected stage
  const currentTime = compSummary?.time ?? null;
  const currentPoints = compSummary?.points ?? null;
  const currentHF = compSummary?.hit_factor ?? null;
  const currentGroupPct = compSummary?.group_percent ?? null;
  const currentMisses = compSummary?.miss_count ?? 0;
  const currentNS = compSummary?.no_shoots ?? 0;
  const currentCHits = compSummary?.c_hits ?? 0;
  const stageUnavailable =
    !compSummary || compSummary.dnf || compSummary.dq || compSummary.zeroed;

  // Constrain adjustments when stage/competitor changes
  const maxMissToA = currentMisses;
  const maxMissToC = Math.max(0, currentMisses - adj.missToACount);
  const maxNsToA = currentNS;
  const maxNsToC = Math.max(0, currentNS - adj.nsToACount);
  const maxCToA = currentCHits;

  const safeAdj: StageSimulatorAdjustments = {
    timeDelta: adj.timeDelta,
    missToACount: Math.min(adj.missToACount, maxMissToA),
    missToCCount: Math.min(adj.missToCCount, Math.max(0, currentMisses - Math.min(adj.missToACount, maxMissToA))),
    nsToACount: Math.min(adj.nsToACount, maxNsToA),
    nsToCCount: Math.min(adj.nsToCCount, Math.max(0, currentNS - Math.min(adj.nsToACount, maxNsToA))),
    cToACount: Math.min(adj.cToACount, maxCToA),
  };

  // Simulation — pure functions, synchronous, negligible cost (≤20 stages × 12 competitors)
  const simStage =
    !stageUnavailable && compSummary
      ? simulateStageAdjustment(compSummary, selectedStage, safeAdj, isMajor)
      : null;

  const simMatch = simStage
    ? simulateMatchImpact(
        data.stages,
        selectedComp.id,
        competitors.map((c) => c.id),
        simStage
      )
    : null;

  // Current match avg % and group rank — computed inline (data is tiny)
  function computeMatchAvg(compId: number): number | null {
    let sum = 0;
    let count = 0;
    for (const stage of data.stages) {
      const sc = stage.competitors[compId];
      if (!sc || sc.dnf || sc.dq || sc.zeroed || sc.group_percent == null) continue;
      sum += sc.group_percent;
      count++;
    }
    return count > 0 ? sum / count : null;
  }

  const currentMatchPct = computeMatchAvg(selectedComp.id);

  const avgs = competitors
    .map((c) => ({ id: c.id, avg: computeMatchAvg(c.id) }))
    .filter((x): x is { id: number; avg: number } => x.avg != null);
  avgs.sort((a, b) => b.avg - a.avg);
  const currentGroupRankIdx = avgs.findIndex((x) => x.id === selectedComp.id);
  const currentGroupRank = currentGroupRankIdx >= 0 ? currentGroupRankIdx + 1 : null;

  const hasChanges =
    safeAdj.timeDelta !== 0 || safeAdj.missToACount !== 0 ||
    safeAdj.missToCCount !== 0 || safeAdj.nsToACount !== 0 ||
    safeAdj.nsToCCount !== 0 || safeAdj.cToACount !== 0;

  function resetAdj() {
    setAdj(ZERO_ADJ);
  }

  return (
    <div className="space-y-4">
      {/* Competitor + stage selectors */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {competitors.length > 1 && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="sim-competitor-select">
              Competitor
            </label>
            <select
              id="sim-competitor-select"
              value={selectedCompetitorId}
              onChange={(e) => {
                setSelectedCompetitorId(Number(e.target.value));
                setAdj(ZERO_ADJ);
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              {competitors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.division ? ` (${c.division})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="sim-stage-select">
            Stage
          </label>
          <select
            id="sim-stage-select"
            value={selectedStageId}
            onChange={(e) => {
              setSelectedStageId(Number(e.target.value));
              setAdj(ZERO_ADJ);
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            {data.stages.map((s) => (
              <option key={s.stage_id} value={s.stage_id}>
                {s.stage_num} — {s.stage_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {stageUnavailable ? (
        <p className="text-sm text-muted-foreground">
          No scorecard data for this stage and competitor.
        </p>
      ) : (
        <>
          {/* Current stage stats */}
          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
            <p>
              <span className="font-medium text-foreground">
                {fmt(currentPoints, 0)} pts · {fmt(currentTime)}s · HF {fmt(currentHF)}
              </span>
            </p>
            <p>
              {compSummary?.a_hits ?? 0}A · {currentCHits}C · {compSummary?.d_hits ?? 0}D ·{" "}
              {currentMisses}M · {compSummary?.no_shoots ?? 0}NS ·{" "}
              {compSummary?.procedurals ?? 0}P
            </p>
          </div>

          {/* Adjustment controls */}
          <div className="space-y-2 border rounded-md px-3 py-3">
            <Stepper
              label="Time (s)"
              value={parseFloat((currentTime! + safeAdj.timeDelta).toFixed(10))}
              min={0.1}
              max={(currentTime ?? 999) + 60}
              step={0.5}
              onChange={(newTime) =>
                setAdj((a) => ({ ...a, timeDelta: parseFloat((newTime - currentTime!).toFixed(10)) }))
              }
              formatValue={(v) => v.toFixed(1)}
              decrementLabel="Decrease time by 0.5 seconds (shoot faster)"
              incrementLabel="Increase time by 0.5 seconds (shoot slower)"
            />
            {currentMisses > 0 && (
              <div className="pt-2 border-t border-border/30 mt-2 space-y-2">
                <Stepper
                  label="Misses → A"
                  value={safeAdj.missToACount}
                  min={0}
                  max={maxMissToA}
                  onChange={(v) => setAdj((a) => ({ ...a, missToACount: v }))}
                  decrementLabel="Convert one fewer miss to A-hit"
                  incrementLabel="Convert one miss to A-hit (+15 pts)"
                />
                <Stepper
                  label="Misses → C"
                  value={safeAdj.missToCCount}
                  min={0}
                  max={maxMissToC}
                  onChange={(v) => setAdj((a) => ({ ...a, missToCCount: v }))}
                  decrementLabel="Convert one fewer miss to C-hit"
                  incrementLabel={`Convert one miss to C-hit (${isMajor ? "+14 pts major" : "+13 pts minor"})`}
                />
              </div>
            )}
            {currentNS > 0 && (
              <div className="pt-2 border-t border-border/30 mt-2 space-y-2">
                <Stepper
                  label="NS → A"
                  value={safeAdj.nsToACount}
                  min={0}
                  max={maxNsToA}
                  onChange={(v) => setAdj((a) => ({ ...a, nsToACount: v }))}
                  decrementLabel="Convert one fewer no-shoot to A-hit"
                  incrementLabel="Convert one no-shoot to A-hit (+15 pts)"
                />
                <Stepper
                  label="NS → C"
                  value={safeAdj.nsToCCount}
                  min={0}
                  max={maxNsToC}
                  onChange={(v) => setAdj((a) => ({ ...a, nsToCCount: v }))}
                  decrementLabel="Convert one fewer no-shoot to C-hit"
                  incrementLabel={`Convert one no-shoot to C-hit (${isMajor ? "+14 pts major" : "+13 pts minor"})`}
                />
              </div>
            )}
            {currentCHits > 0 && (
              <div className="pt-2 border-t border-border/30 mt-2">
                <Stepper
                  label="C → A"
                  value={safeAdj.cToACount}
                  min={0}
                  max={maxCToA}
                  onChange={(v) => setAdj((a) => ({ ...a, cToACount: v }))}
                  decrementLabel="Upgrade one fewer C-hit to A-hit"
                  incrementLabel={`Upgrade one C-hit to A-hit (${isMajor ? "+1 pt major" : "+2 pts minor"})`}
                />
              </div>
            )}
          </div>

          {/* Stage group rank — computed inline */}
          {(() => {
            const currentStageGroupRank = compSummary?.group_rank ?? null;
            let simStageGroupRank: number | null = null;
            if (simStage) {
              const betterCount = competitors
                .filter(c => c.id !== selectedComp.id)
                .filter(c => {
                  const hf = selectedStage.competitors[c.id]?.hit_factor ?? null;
                  return hf != null && hf > simStage.newHF;
                }).length;
              simStageGroupRank = betterCount + 1;
            }
            const stageGroupRankDelta =
              simStageGroupRank != null && currentStageGroupRank != null
                ? currentStageGroupRank - simStageGroupRank
                : null;

            return (
              /* Live result */
              <div
                id={liveRegionId}
                aria-live="polite"
                aria-atomic="true"
                aria-label="Simulated result — this stage only"
              >
                <div className="rounded-md border px-3 py-3 space-y-0.5">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Simulated result — this stage only</p>
                  <ResultRow
                    label="Points"
                    current={fmt(currentPoints, 0)}
                    simulated={fmt(simStage?.newPoints ?? currentPoints, 0)}
                    delta={fmtDelta(simStage?.pointDelta ?? null, 0)}
                    deltaPositive={simStage ? simStage.pointDelta > 0 : null}
                  />
                  <ResultRow
                    label="HF"
                    current={fmt(currentHF)}
                    simulated={fmt(simStage?.newHF ?? currentHF)}
                    delta={fmtDelta(simStage?.hfDelta ?? null)}
                    deltaPositive={simStage ? simStage.hfDelta > 0 : null}
                  />
                  <ResultRow
                    label="Stage %"
                    current={fmt(currentGroupPct, 1)}
                    simulated={fmt(simStage?.newGroupPct ?? currentGroupPct, 1)}
                    delta={fmtDelta(simStage?.groupPctDelta ?? null, 1)}
                    deltaPositive={simStage ? (simStage.groupPctDelta ?? 0) > 0 : null}
                  />
                  {competitors.length > 1 && (
                    <ResultRow
                      label="Stage rank"
                      current={currentStageGroupRank != null ? ordinal(currentStageGroupRank) : "—"}
                      simulated={
                        simStageGroupRank != null
                          ? ordinal(simStageGroupRank)
                          : currentStageGroupRank != null
                          ? ordinal(currentStageGroupRank)
                          : "—"
                      }
                      delta={fmtRankDelta(stageGroupRankDelta)}
                      deltaPositive={stageGroupRankDelta != null ? stageGroupRankDelta > 0 : null}
                    />
                  )}
                  {competitors.length > 1 && (
                    <>
                      <ResultRow
                        label="Match avg"
                        current={fmt(currentMatchPct, 1)}
                        simulated={fmt(simMatch?.newMatchPct ?? currentMatchPct, 1)}
                        delta={fmtDelta(simMatch?.matchPctDelta ?? null, 1)}
                        deltaPositive={simMatch ? (simMatch.matchPctDelta ?? 0) > 0 : null}
                      />
                      <ResultRow
                        label="Group rank"
                        current={currentGroupRank != null ? ordinal(currentGroupRank) : "—"}
                        simulated={
                          simMatch?.newGroupRank != null
                            ? ordinal(simMatch.newGroupRank)
                            : currentGroupRank != null
                            ? ordinal(currentGroupRank)
                            : "—"
                        }
                        delta={fmtRankDelta(simMatch?.groupRankDelta ?? null)}
                        deltaPositive={simMatch ? (simMatch.groupRankDelta ?? 0) > 0 : null}
                      />
                    </>
                  )}
                  {competitors.length === 1 && (
                    <ResultRow
                      label="Match avg"
                      current={fmt(currentMatchPct, 1)}
                      simulated={fmt(simMatch?.newMatchPct ?? currentMatchPct, 1)}
                      delta={fmtDelta(simMatch?.matchPctDelta ?? null, 1)}
                      deltaPositive={simMatch ? (simMatch.matchPctDelta ?? 0) > 0 : null}
                    />
                  )}
                </div>
              </div>
            );
          })()}

          {/* Reset */}
          {hasChanges && (
            <button
              type="button"
              onClick={resetAdj}
              className={cn(
                "text-xs text-muted-foreground hover:text-foreground underline underline-offset-2",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring rounded"
              )}
            >
              Reset
            </button>
          )}
        </>
      )}
    </div>
  );
}
