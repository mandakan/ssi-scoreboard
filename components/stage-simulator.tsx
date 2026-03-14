"use client";

import { useState, useId, useEffect, useRef } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  isMajorPowerFactor,
  simulateStageAdjustment,
  simulateMatchImpact,
} from "@/lib/what-if-calc";
import type {
  CompareResponse,
  CompetitorInfo,
  StageSimulatorAdjustments,
  SimulatedStageResult,
  WhatIfSimulationResponse,
} from "@/lib/types";

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

function isZeroAdj(adj: StageSimulatorAdjustments): boolean {
  return (
    adj.timeDelta === 0 &&
    adj.missToACount === 0 && adj.missToCCount === 0 &&
    adj.nsToACount === 0 && adj.nsToCCount === 0 &&
    adj.cToACount === 0 &&
    adj.dToACount === 0 && adj.dToCCount === 0 &&
    adj.removedProcedurals === 0 &&
    adj.aToCCount === 0 && adj.aToMissCount === 0 && adj.aToNSCount === 0
  );
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
  simulatedLoading?: boolean;     // show animated skeleton in the simulated cell
}

function ResultRow({ label, current, simulated, delta, deltaPositive, simulatedLoading }: ResultRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="text-sm font-mono tabular-nums text-muted-foreground">{current}</span>
      <span className="text-muted-foreground text-xs">→</span>
      {simulatedLoading ? (
        <span className="h-4 w-14 rounded bg-muted/60 animate-pulse" aria-label="Loading" />
      ) : (
        <span className="text-sm font-mono tabular-nums font-medium">{simulated}</span>
      )}
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
  ct: string;
  id: string;
  data: CompareResponse;
  competitors: CompetitorInfo[];
  scoringCompleted: number;
}

const ZERO_ADJ: StageSimulatorAdjustments = {
  timeDelta: 0, missToACount: 0, missToCCount: 0,
  nsToACount: 0, nsToCCount: 0, cToACount: 0,
  dToACount: 0, dToCCount: 0, removedProcedurals: 0,
  aToCCount: 0, aToMissCount: 0, aToNSCount: 0,
};

export function StageSimulator({ ct, id, data, competitors, scoringCompleted }: StageSimulatorProps) {
  // All hooks must be called unconditionally before any early return.
  const [selectedCompetitorId, setSelectedCompetitorId] = useState<number>(
    competitors[0]?.id ?? 0
  );
  const [selectedStageId, setSelectedStageId] = useState<number>(
    data.stages[0]?.stage_id ?? 0
  );
  const [adjByStage, setAdjByStage] = useState<Record<number, StageSimulatorAdjustments>>({});
  const [simMode, setSimMode] = useState<"improve" | "trade">("improve");
  const [serverRank, setServerRank] = useState<WhatIfSimulationResponse | null>(null);
  const [serverRankLoading, setServerRankLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveRegionId = useId();

  // Build sessionStorage key scoped to match + competitor
  const storageKey = `what-if-adj:v1:${ct}:${id}:${selectedCompetitorId}`;

  // Load from sessionStorage on mount (and when competitor changes)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<number, StageSimulatorAdjustments>;
        setAdjByStage(parsed);
      } else {
        setAdjByStage({});
      }
    } catch {
      setAdjByStage({});
    }
  }, [storageKey]);

  // Save to sessionStorage when adjByStage changes
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(adjByStage));
    } catch { /* ignore */ }
  }, [adjByStage, storageKey]);

  // Debounced server call for div/overall rank
  useEffect(() => {
    const hasAnyAdj = Object.values(adjByStage).some((a) => !isZeroAdj(a));
    if (!hasAnyAdj) {
      setServerRank(null);
      setServerRankLoading(false);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return;
    }

    setServerRankLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ct,
            id,
            competitorId: selectedCompetitorId,
            adjustments: adjByStage,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as WhatIfSimulationResponse;
        setServerRank(data);
      } catch {
        setServerRank(null);
      } finally {
        setServerRankLoading(false);
      }
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [adjByStage, selectedCompetitorId, ct, id]);

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
  const currentAHits = compSummary?.a_hits ?? 0;
  const currentMisses = compSummary?.miss_count ?? 0;
  const currentNS = compSummary?.no_shoots ?? 0;
  const currentCHits = compSummary?.c_hits ?? 0;
  const currentDHits = compSummary?.d_hits ?? 0;
  const currentProcedurals = compSummary?.procedurals ?? 0;
  const stageUnavailable =
    !compSummary || compSummary.dnf || compSummary.dq || compSummary.zeroed;

  // Current stage adjustments
  const adj = adjByStage[selectedStageId] ?? ZERO_ADJ;

  // Constrain adjustments to valid ranges for current stage/competitor
  const maxMissToA = currentMisses;
  const maxMissToC = Math.max(0, currentMisses - adj.missToACount);
  const maxNsToA = currentNS;
  const maxNsToC = Math.max(0, currentNS - adj.nsToACount);
  const maxCToA = currentCHits;
  const maxDToA = currentDHits;
  const maxDToC = Math.max(0, currentDHits - adj.dToACount);
  const maxProcedurals = currentProcedurals;

  const safeAdj: StageSimulatorAdjustments = {
    timeDelta: adj.timeDelta,
    missToACount: Math.min(adj.missToACount, maxMissToA),
    missToCCount: Math.min(adj.missToCCount, Math.max(0, currentMisses - Math.min(adj.missToACount, maxMissToA))),
    nsToACount: Math.min(adj.nsToACount, maxNsToA),
    nsToCCount: Math.min(adj.nsToCCount, Math.max(0, currentNS - Math.min(adj.nsToACount, maxNsToA))),
    cToACount: Math.min(adj.cToACount, maxCToA),
    dToACount: Math.min(adj.dToACount, maxDToA),
    dToCCount: Math.min(adj.dToCCount, Math.max(0, currentDHits - Math.min(adj.dToACount, maxDToA))),
    removedProcedurals: Math.min(adj.removedProcedurals, maxProcedurals),
    aToCCount: Math.min(adj.aToCCount, currentAHits),
    aToMissCount: Math.min(adj.aToMissCount, Math.max(0, currentAHits - Math.min(adj.aToCCount, currentAHits))),
    aToNSCount: Math.min(adj.aToNSCount, Math.max(0, currentAHits - Math.min(adj.aToCCount, currentAHits) - Math.min(adj.aToMissCount, Math.max(0, currentAHits - Math.min(adj.aToCCount, currentAHits))))),
  };

  // Max values for Trade mode steppers (derived from safeAdj to avoid double-counting)
  const maxAToC = currentAHits;
  const maxAToMiss = Math.max(0, currentAHits - safeAdj.aToCCount);
  const maxAToNS = Math.max(0, currentAHits - safeAdj.aToCCount - safeAdj.aToMissCount);

  function updateAdj(updater: (a: StageSimulatorAdjustments) => StageSimulatorAdjustments) {
    setAdjByStage((prev) => {
      const current = prev[selectedStageId] ?? ZERO_ADJ;
      const updated = updater(current);
      if (isZeroAdj(updated)) {
        const next = { ...prev };
        delete next[selectedStageId];
        return next;
      }
      return { ...prev, [selectedStageId]: updated };
    });
  }

  // Build multi-stage simulated results (for all adjusted stages)
  const simResultsByStage: Record<number, SimulatedStageResult> = {};
  for (const stage of data.stages) {
    const stageAdj = adjByStage[stage.stage_id];
    if (!stageAdj || isZeroAdj(stageAdj)) continue;
    const sc = stage.competitors[selectedComp.id];
    if (!sc || sc.dnf || sc.dq || sc.zeroed) continue;
    simResultsByStage[stage.stage_id] = simulateStageAdjustment(sc, stage, stageAdj, isMajor);
  }

  // Current stage simulation (for display in the results panel)
  const simStage = !stageUnavailable && compSummary && !isZeroAdj(safeAdj)
    ? simulateStageAdjustment(compSummary, selectedStage, safeAdj, isMajor)
    : null;

  const simMatch =
    Object.keys(simResultsByStage).length > 0
      ? simulateMatchImpact(
          data.stages,
          selectedComp.id,
          competitors.map((c) => c.id),
          simResultsByStage
        )
      : null;

  // Current match avg % and group rank
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

  const hasChangesForCurrentStage = !isZeroAdj(safeAdj);
  const modifiedStageIds = new Set(
    Object.entries(adjByStage)
      .filter(([, a]) => !isZeroAdj(a))
      .map(([k]) => Number(k))
  );
  const hasAnyChanges = modifiedStageIds.size > 0;
  const modifiedStageCount = modifiedStageIds.size;

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
                setAdjByStage({});
                setServerRank(null);
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
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="sim-stage-select">
              Stage
            </label>
            {modifiedStageCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {modifiedStageCount} modified
              </span>
            )}
          </div>
          <select
            id="sim-stage-select"
            value={selectedStageId}
            onChange={(e) => {
              setSelectedStageId(Number(e.target.value));
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            {data.stages.map((s) => (
              <option key={s.stage_id} value={s.stage_id}>
                {modifiedStageIds.has(s.stage_id) ? "[✓] " : ""}
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
              {currentAHits}A · {currentCHits}C · {currentDHits}D ·{" "}
              {currentMisses}M · {currentNS}NS · {currentProcedurals}P
            </p>
          </div>

          {/* Adjustment controls */}
          <div className="border rounded-md px-3 py-3 space-y-3">
            {/* Time — always visible regardless of mode */}
            <Stepper
              label="Time (s)"
              value={parseFloat((currentTime! + safeAdj.timeDelta).toFixed(10))}
              min={0.1}
              max={(currentTime ?? 999) + 60}
              step={0.5}
              onChange={(newTime) =>
                updateAdj((a) => ({ ...a, timeDelta: parseFloat((newTime - currentTime!).toFixed(10)) }))
              }
              formatValue={(v) => v.toFixed(1)}
              decrementLabel="Decrease time by 0.5 seconds (shoot faster)"
              incrementLabel="Increase time by 0.5 seconds (shoot slower)"
            />

            {/* Mode toggle */}
            {(() => {
              const improveActive = safeAdj.missToACount > 0 || safeAdj.missToCCount > 0 ||
                safeAdj.nsToACount > 0 || safeAdj.nsToCCount > 0 || safeAdj.cToACount > 0 ||
                safeAdj.dToACount > 0 || safeAdj.dToCCount > 0 || safeAdj.removedProcedurals > 0;
              const tradeActive = safeAdj.aToCCount > 0 || safeAdj.aToMissCount > 0 || safeAdj.aToNSCount > 0;
              return (
                <ToggleGroup
                  type="single"
                  value={simMode}
                  onValueChange={(v) => { if (v) setSimMode(v as "improve" | "trade"); }}
                  className="flex rounded-md border border-input overflow-hidden text-sm"
                  aria-label="Adjustment mode"
                >
                  <ToggleGroupItem
                    value="improve"
                    className={cn(
                      "h-auto min-w-0 flex-1 py-2 font-medium transition-colors flex items-center justify-center gap-1.5",
                      simMode === "improve"
                        ? "bg-foreground text-background"
                        : "bg-background text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Improve
                    {improveActive && simMode !== "improve" && (
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
                    )}
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="trade"
                    className={cn(
                      "h-auto min-w-0 flex-1 py-2 font-medium transition-colors border-l border-input flex items-center justify-center gap-1.5",
                      simMode === "trade"
                        ? "bg-foreground text-background"
                        : "bg-background text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Trade
                    {tradeActive && simMode !== "trade" && (
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
                    )}
                  </ToggleGroupItem>
                </ToggleGroup>
              );
            })()}

            {/* Improve mode: upgrade zones, remove penalties */}
            {simMode === "improve" && (
              <div className="space-y-2">
                {currentMisses > 0 && (
                  <div className="space-y-2">
                    <Stepper
                      label="Misses → A"
                      value={safeAdj.missToACount}
                      min={0}
                      max={maxMissToA}
                      onChange={(v) => updateAdj((a) => ({ ...a, missToACount: v }))}
                      decrementLabel="Convert one fewer miss to A-hit"
                      incrementLabel="Convert one miss to A-hit (+15 pts)"
                    />
                    <Stepper
                      label="Misses → C"
                      value={safeAdj.missToCCount}
                      min={0}
                      max={maxMissToC}
                      onChange={(v) => updateAdj((a) => ({ ...a, missToCCount: v }))}
                      decrementLabel="Convert one fewer miss to C-hit"
                      incrementLabel={`Convert one miss to C-hit (${isMajor ? "+14 pts major" : "+13 pts minor"})`}
                    />
                  </div>
                )}
                {currentNS > 0 && (
                  <div className="space-y-2">
                    <Stepper
                      label="NS → A"
                      value={safeAdj.nsToACount}
                      min={0}
                      max={maxNsToA}
                      onChange={(v) => updateAdj((a) => ({ ...a, nsToACount: v }))}
                      decrementLabel="Convert one fewer no-shoot to A-hit"
                      incrementLabel="Convert one no-shoot to A-hit (+15 pts)"
                    />
                    <Stepper
                      label="NS → C"
                      value={safeAdj.nsToCCount}
                      min={0}
                      max={maxNsToC}
                      onChange={(v) => updateAdj((a) => ({ ...a, nsToCCount: v }))}
                      decrementLabel="Convert one fewer no-shoot to C-hit"
                      incrementLabel={`Convert one no-shoot to C-hit (${isMajor ? "+14 pts major" : "+13 pts minor"})`}
                    />
                  </div>
                )}
                {currentCHits > 0 && (
                  <Stepper
                    label="C → A"
                    value={safeAdj.cToACount}
                    min={0}
                    max={maxCToA}
                    onChange={(v) => updateAdj((a) => ({ ...a, cToACount: v }))}
                    decrementLabel="Upgrade one fewer C-hit to A-hit"
                    incrementLabel={`Upgrade one C-hit to A-hit (${isMajor ? "+1 pt major" : "+2 pts minor"})`}
                  />
                )}
                {currentDHits > 0 && (
                  <div className="space-y-2">
                    <Stepper
                      label="D → A"
                      value={safeAdj.dToACount}
                      min={0}
                      max={maxDToA}
                      onChange={(v) => updateAdj((a) => ({ ...a, dToACount: v }))}
                      decrementLabel="Upgrade one fewer D-hit to A-hit"
                      incrementLabel={`Upgrade one D-hit to A-hit (${isMajor ? "+3 pts major" : "+4 pts minor"})`}
                    />
                    <Stepper
                      label="D → C"
                      value={safeAdj.dToCCount}
                      min={0}
                      max={maxDToC}
                      onChange={(v) => updateAdj((a) => ({ ...a, dToCCount: v }))}
                      decrementLabel="Upgrade one fewer D-hit to C-hit"
                      incrementLabel="Upgrade one D-hit to C-hit (+2 pts)"
                    />
                  </div>
                )}
                {currentProcedurals > 0 && (
                  <Stepper
                    label="Remove proc."
                    value={safeAdj.removedProcedurals}
                    min={0}
                    max={maxProcedurals}
                    onChange={(v) => updateAdj((a) => ({ ...a, removedProcedurals: v }))}
                    decrementLabel="Restore one procedural penalty"
                    incrementLabel="Remove one procedural penalty (+10 pts)"
                  />
                )}
                {currentMisses === 0 && currentNS === 0 && currentCHits === 0 && currentDHits === 0 && currentProcedurals === 0 && (
                  <p className="text-xs text-muted-foreground">No zone upgrades available — adjust time above.</p>
                )}
              </div>
            )}

            {/* Trade mode: downgrade A-hits to simulate going faster with lower accuracy */}
            {simMode === "trade" && (
              <div className="space-y-2">
                {currentAHits > 0 ? (
                  <>
                    <Stepper
                      label="A → C"
                      value={safeAdj.aToCCount}
                      min={0}
                      max={maxAToC}
                      onChange={(v) => updateAdj((a) => ({ ...a, aToCCount: v }))}
                      decrementLabel="Convert one fewer A-hit to C-hit"
                      incrementLabel={`Convert one A-hit to C-hit (${isMajor ? "−1 pt major" : "−2 pts minor"})`}
                    />
                    <Stepper
                      label="A → Miss"
                      value={safeAdj.aToMissCount}
                      min={0}
                      max={maxAToMiss}
                      onChange={(v) => updateAdj((a) => ({ ...a, aToMissCount: v }))}
                      decrementLabel="Convert one fewer A-hit to miss"
                      incrementLabel="Convert one A-hit to miss (−15 pts)"
                    />
                    <Stepper
                      label="A → NS"
                      value={safeAdj.aToNSCount}
                      min={0}
                      max={maxAToNS}
                      onChange={(v) => updateAdj((a) => ({ ...a, aToNSCount: v }))}
                      decrementLabel="Convert one fewer A-hit to no-shoot"
                      incrementLabel="Convert one A-hit to no-shoot (−15 pts)"
                    />
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No A-hits on this stage to trade down.</p>
                )}
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

            const adjustedStageCount = modifiedStageIds.size;

            return (
              /* Live result */
              <div
                id={liveRegionId}
                aria-live="polite"
                aria-atomic="true"
                aria-label={
                  adjustedStageCount > 1
                    ? `What-if result — ${adjustedStageCount} stages`
                    : "What-if result — this stage"
                }
              >
                <div className="rounded-md border px-3 py-3 space-y-0.5">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    {adjustedStageCount > 1
                      ? `What-if result — ${adjustedStageCount} stages`
                      : "What-if result — this stage"}
                  </p>
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
                  {/* Div / overall rank — always shown; current from whatIfStats, simulated from server */}
                  {(() => {
                    const currentDivRank = data.whatIfStats?.[selectedComp.id]?.actualDivRank ?? null;
                    const currentOverallRank = data.whatIfStats?.[selectedComp.id]?.actualOverallRank ?? null;
                    const simDivRank = serverRank?.newDivRank ?? null;
                    const simOverallRank = serverRank?.newOverallRank ?? null;
                    const divRankDelta = simDivRank != null && currentDivRank != null ? currentDivRank - simDivRank : null;
                    const overallRankDelta = simOverallRank != null && currentOverallRank != null ? currentOverallRank - simOverallRank : null;

                    function simRankDisplay(current: number | null, simulated: number | null): string {
                      if (simulated != null) return ordinal(simulated);
                      return current != null ? ordinal(current) : "—";
                    }

                    return (
                      <>
                        <ResultRow
                          label="Div rank"
                          current={currentDivRank != null ? ordinal(currentDivRank) : "—"}
                          simulated={simRankDisplay(currentDivRank, simDivRank)}
                          simulatedLoading={hasAnyChanges && serverRankLoading}
                          delta={hasAnyChanges && !serverRankLoading ? fmtRankDelta(divRankDelta) : ""}
                          deltaPositive={divRankDelta != null ? divRankDelta > 0 : null}
                        />
                        <ResultRow
                          label="Overall rank"
                          current={currentOverallRank != null ? ordinal(currentOverallRank) : "—"}
                          simulated={simRankDisplay(currentOverallRank, simOverallRank)}
                          simulatedLoading={hasAnyChanges && serverRankLoading}
                          delta={hasAnyChanges && !serverRankLoading ? fmtRankDelta(overallRankDelta) : ""}
                          deltaPositive={overallRankDelta != null ? overallRankDelta > 0 : null}
                        />
                      </>
                    );
                  })()}
                  <p className="text-xs text-muted-foreground/60 pt-2 mt-1 border-t border-border/30">
                    Hypothetical only — the comparison table above is unchanged.
                  </p>
                </div>
              </div>
            );
          })()}

          {/* Reset buttons */}
          <div className="flex gap-3">
            {hasChangesForCurrentStage && (
              <button
                type="button"
                onClick={() => {
                  setAdjByStage((prev) => {
                    const next = { ...prev };
                    delete next[selectedStageId];
                    return next;
                  });
                }}
                className={cn(
                  "text-xs text-muted-foreground hover:text-foreground underline underline-offset-2",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring rounded"
                )}
              >
                Reset this stage
              </button>
            )}
            {(modifiedStageCount > 1 || (hasAnyChanges && !hasChangesForCurrentStage)) && (
              <button
                type="button"
                onClick={() => {
                  setAdjByStage({});
                  setServerRank(null);
                }}
                className={cn(
                  "text-xs text-muted-foreground hover:text-foreground underline underline-offset-2",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring rounded"
                )}
              >
                Reset all
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
