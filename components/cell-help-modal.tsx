"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HitZoneBar } from "@/components/hit-zone-bar";
import {
  RankBadge,
  ShootingOrderBadge,
  StageClassificationBadge,
} from "@/components/stage-cell-parts";
import { ArrowUpDown, CheckCircle2, Cloud, CloudRain, CloudSnow, CloudSun, Crosshair, Flame, Focus, Hand, HandMetal, Layers, Moon, Shield, Sun, Sunrise, Sunset, Timer, Wind, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StageClassification } from "@/lib/types";

// --- Mock data for StageColumnDiagram ---
const MOCK_STAGE_NUM = 3;
const MOCK_STAGE_NAME = "Accelerator";
const MOCK_STAGE_ROUNDS = 18;
const MOCK_STAGE_PAPER = 6;
const MOCK_STAGE_STEEL = 2;
const MOCK_STAGE_MEDIAN_HF = 4.21;

// --- Mock data for StageCellDiagram ---
const MOCK_ORDER = 3;
const MOCK_RANK = 2;
const MOCK_HF = 5.82;
const MOCK_POINTS = 147;
const MOCK_MAX = 160;
const MOCK_TIME = 25.26;
const MOCK_GROUP_PCT = 91.2;
const MOCK_PERCENTILE = 0.75;
const MOCK_A = 8, MOCK_C = 2, MOCK_D = 1, MOCK_M = 1;
const MOCK_NS = 1, MOCK_P = 0;
const MOCK_CLASSIFICATION: StageClassification = "conservative";

// --- Mock data for SummaryRowDiagram ---
const MOCK_TOTAL_PTS = 1247;
const MOCK_AVG_PCT = 89.4;
const MOCK_TA = 64, MOCK_TC = 12, MOCK_TD = 5, MOCK_TM = 4;
const MOCK_TNS = 2, MOCK_TP = 1;
const MOCK_PENALTY_COST = 2.1;
const MOCK_PTS_PER_SHOT = 7.82;
const MOCK_CI = 0.08;
const MOCK_TOTAL_PENALTY_PTS = (MOCK_TM + MOCK_TNS + MOCK_TP) * 10; // 70

function DiagramRow({
  visual,
  badge,
  title,
  description,
  last = false,
}: {
  visual: ReactNode;
  badge: string;
  title: string;
  description: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[7rem_1fr] gap-3 py-3",
        !last && "border-b border-dashed border-border/40"
      )}
    >
      <div className="flex items-center justify-center w-full overflow-hidden">
        {visual}
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted text-muted-foreground text-xs font-bold shrink-0"
          >
            {badge}
          </span>
          <span className="text-sm font-medium">{title}</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}

function StageColumnDiagram() {
  return (
    <section>
      <h3 className="text-sm font-semibold mb-1">Stage column header</h3>
      <p className="text-xs text-muted-foreground mb-3">
        The leftmost column identifies each stage and provides key context.
      </p>
      <div>
        <DiagramRow
          visual={
            <span className="text-sm font-bold tabular-nums">
              S{MOCK_STAGE_NUM}
            </span>
          }
          badge="1"
          title="Stage label"
          description={`Stage number. Desktop also shows the full stage name (e.g. "${MOCK_STAGE_NAME}") with a link to the SSI result page.`}
        />
        <DiagramRow
          visual={
            <div className="flex items-end gap-px" aria-hidden="true">
              <div className="w-1 h-1 rounded-sm bg-emerald-500" />
              <div className="w-1 h-2 rounded-sm bg-lime-500" />
              <div className="w-1 h-3 rounded-sm bg-yellow-500" />
              <div className="w-1 h-4 rounded-sm bg-muted-foreground/25" />
              <div className="w-1 h-5 rounded-sm bg-muted-foreground/25" />
            </div>
          }
          badge="2"
          title="HF Level"
          description={<>
            1–5 bars show relative HF level across stages in this match. More bars = higher field hit factor on this stage. Lower bars may reflect long movement, high round count, or hard shots — hover for field median and accuracy.{" "}
            A <span className="inline-flex items-center gap-0.5 text-violet-500"><ArrowUpDown className="w-3 h-3" aria-hidden="true" /> separator</span> icon appears on stages whose field spread is a genuine statistical outlier for this match — typically 0–2 stages.
          </>}
        />
        <DiagramRow
          visual={
            <div className="flex items-center gap-2">
              <span className="inline-flex text-blue-500" aria-label="Speed stage" role="img">
                <Timer className="w-3.5 h-3.5" aria-hidden="true" />
              </span>
              <span className="inline-flex text-purple-500" aria-label="Precision stage" role="img">
                <Focus className="w-3.5 h-3.5" aria-hidden="true" />
              </span>
              <span className="inline-flex text-muted-foreground" aria-label="Mixed stage" role="img">
                <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              </span>
            </div>
          }
          badge="3"
          title="Stage archetype"
          description={<>
            Appears next to the HF Level bars.{" "}
            <span className="inline-flex items-center gap-0.5 text-blue-500"><Timer className="w-3 h-3" aria-hidden="true" /> Speed</span>
            {" — "}
            <span className="inline-flex items-center gap-0.5 text-purple-500"><Focus className="w-3 h-3" aria-hidden="true" /> Precision</span>
            {" — "}
            <span className="inline-flex items-center gap-0.5 text-muted-foreground"><Layers className="w-3 h-3" aria-hidden="true" /> Mixed</span>
            {". Derived from the ratio of steel to paper targets. Hover for the label."}
          </>}
        />
        <DiagramRow
          visual={
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
              {MOCK_STAGE_ROUNDS}r · {MOCK_STAGE_PAPER}P · {MOCK_STAGE_STEEL}S
            </span>
          }
          badge="4"
          title="Rounds & targets"
          description="Minimum round count, paper targets (P), and steel targets (S). Indicates stage type — high round count suggests a long course."
        />
        <DiagramRow
          visual={
            <div className="flex items-center gap-1" aria-hidden="true">
              <Hand className="w-3.5 h-3.5 text-amber-500" />
              <Crosshair className="w-3.5 h-3.5 text-teal-500" />
              <HandMetal className="w-3.5 h-3.5 text-cyan-500" />
            </div>
          }
          badge="4"
          title="Constraint badges"
          description={<>Shown when the stage brief includes a shooting restriction: <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400"><Hand className="w-3 h-3" aria-hidden="true" /> strong hand only</span>, <span className="inline-flex items-center gap-0.5 text-cyan-600 dark:text-cyan-400"><HandMetal className="w-3 h-3" aria-hidden="true" /> weak hand only</span>, or <span className="inline-flex items-center gap-0.5 text-teal-600 dark:text-teal-400"><Crosshair className="w-3 h-3" aria-hidden="true" /> moving targets</span>. Tap the icon for a tooltip. Also visible in the stage info popover on mobile.</>}
        />
        <DiagramRow
          last
          visual={
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
              med: {MOCK_STAGE_MEDIAN_HF.toFixed(2)}
            </span>
          }
          badge="5"
          title="Field median HF"
          description="Median hit factor of all competitors on this stage. A useful baseline — compare it with the hit factors in the cells above."
        />
      </div>
    </section>
  );
}

function StageCellDiagram() {
  const totalHits = MOCK_A + MOCK_C + MOCK_D + MOCK_M;
  const aPct = totalHits > 0 ? (MOCK_A / totalHits) * 100 : null;

  return (
    <section>
      <h3 className="text-sm font-semibold mb-1">Stage cell</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Each table cell shows one competitor&rsquo;s result on one stage.
      </p>
      <div>
        <DiagramRow
          visual={<ShootingOrderBadge order={MOCK_ORDER} />}
          badge="1"
          title="Shooting order"
          description="The order this competitor shot this stage (from scorecard timestamps). Useful for spotting late-draw conditions."
        />
        <DiagramRow
          visual={
            <div className="flex items-center gap-1">
              <RankBadge rank={MOCK_RANK} tooltip="Rank 2 of 3 in your group" />
              <span className="text-sm font-semibold tabular-nums">
                {MOCK_HF.toFixed(2)} HF
              </span>
            </div>
          }
          badge="2"
          title="Rank & hit factor"
          description="Colored badge shows placement in your comparison group. Gold=1st, silver=2nd, bronze=3rd. Hit factor = points / time — the primary IPSC scoring metric."
        />
        <DiagramRow
          visual={
            <span className="text-xs text-muted-foreground tabular-nums">
              {MOCK_POINTS}/{MOCK_MAX} · {MOCK_TIME.toFixed(2)}s
            </span>
          }
          badge="3"
          title="Points & time"
          description="Raw points scored over stage maximum, and the time taken."
        />
        <DiagramRow
          visual={
            <span className="text-xs font-medium text-muted-foreground tabular-nums">
              {MOCK_GROUP_PCT.toFixed(1)}%
            </span>
          }
          badge="4"
          title="Group percentage"
          description="This competitor's hit factor as a percentage of the group leader on this stage. 100% = best in group. Use the Group / Division / Overall toggle to change the reference."
        />
        <DiagramRow
          visual={
            <span className="text-xs text-muted-foreground/70 tabular-nums leading-none">
              P{Math.round(MOCK_PERCENTILE * 100)}
            </span>
          }
          badge="5"
          title="Field percentile"
          description="Top X% of all competitors in the full field on this stage. P75 = top 75%, i.e. beat 75% of the field."
        />
        <DiagramRow
          visual={
            <HitZoneBar
              aHits={MOCK_A}
              cHits={MOCK_C}
              dHits={MOCK_D}
              misses={MOCK_M}
              noShoots={MOCK_NS}
              procedurals={MOCK_P}
            />
          }
          badge="6"
          title="Hit zone bar + penalty pips"
          description="Bar shows A-zone (solid green), C (light diagonal yellow), and D (dense diagonal orange) proportions. Below the bar: a square per miss, triangle per no-shoot, diamond per procedural — each pip costs 10 pts. Hover or tap for exact counts and total points lost."
        />
        <DiagramRow
          last
          visual={
            <StageClassificationBadge
              classification={MOCK_CLASSIFICATION}
              groupPercent={MOCK_GROUP_PCT}
              aPct={aPct}
              miss={MOCK_M}
              noShoots={MOCK_NS}
              procedurals={MOCK_P}
            />
          }
          badge="7"
          title="Run classification"
          description={<>
            <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Solid</span>
            {" / "}
            <span className="inline-flex items-center gap-0.5 text-yellow-600 dark:text-yellow-400"><Shield className="w-3 h-3" aria-hidden="true" /> Conservative</span>
            {" / "}
            <span className="inline-flex items-center gap-0.5 text-orange-600 dark:text-orange-400"><Zap className="w-3 h-3" aria-hidden="true" /> Over-push</span>
            {" / "}
            <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400"><Flame className="w-3 h-3" aria-hidden="true" /> Meltdown</span>
            {" — a run quality label based on your HF%, A-zone rate, and penalty count relative to the group leader."}
          </>}
        />
      </div>
    </section>
  );
}

function SummaryRowDiagram() {
  return (
    <section>
      <h3 className="text-sm font-semibold mb-1">Summary row</h3>
      <p className="text-xs text-muted-foreground mb-3">
        The bottom row aggregates data across all stages fired.
      </p>
      <div>
        <DiagramRow
          visual={
            <span className="font-bold tabular-nums text-sm">
              {MOCK_TOTAL_PTS}
            </span>
          }
          badge="A"
          title="Total points"
          description="Sum of raw points across all fired stages."
        />
        <DiagramRow
          visual={
            <span className="text-xs text-muted-foreground tabular-nums">
              {MOCK_AVG_PCT.toFixed(1)}%
            </span>
          }
          badge="B"
          title="Match percentage"
          description="Official IPSC match percentage: stage points are weighted by stage size (longer stages count more), then summed and divided by the leader's total. In Group mode the anchor is the highest-scoring selected competitor, so one of them always lands on 100%. In Division / Overall mode the anchor is the full-division or full-field leader."
        />
        <DiagramRow
          visual={
            <HitZoneBar
              aHits={MOCK_TA}
              cHits={MOCK_TC}
              dHits={MOCK_TD}
              misses={MOCK_TM}
              noShoots={MOCK_TNS}
              procedurals={MOCK_TP}
            />
          }
          badge="C"
          title="Aggregated hit zones"
          description="All hits across every stage combined. A quick picture of overall accuracy."
        />
        <DiagramRow
          visual={
            <span className="text-xs font-medium text-red-600 dark:text-red-400 tabular-nums">
              {`\u2212${MOCK_TOTAL_PENALTY_PTS}pts`}
            </span>
          }
          badge="D"
          title="Total match penalties"
          description="Total points lost to all misses, no-shoots, and procedurals across the match."
        />
        <DiagramRow
          visual={
            <Badge
              variant="outline"
              className="text-xs font-medium border-red-400 text-red-600 dark:text-red-400 tabular-nums whitespace-nowrap"
            >
              {`pen \u2212${MOCK_PENALTY_COST.toFixed(1)}%`}
            </Badge>
          }
          badge="E"
          title="Penalty cost"
          description="How much match percentage was lost to penalties. Tooltip shows rate per stage and per 100 rounds, plus clean vs actual match %."
        />
        <DiagramRow
          visual={
            <div className="flex flex-col items-center gap-0">
              <span className="text-xs text-muted-foreground tabular-nums">
                {`${MOCK_PTS_PER_SHOT.toFixed(2)} pts/shot`}
              </span>
              <div aria-label={`${MOCK_PTS_PER_SHOT.toFixed(2)} pts/shot — field distribution`}>
                <svg
                  width="56"
                  height="12"
                  aria-hidden="true"
                >
                  {/* Range bar */}
                  <rect x="2" y="5" width="52" height="2" rx="1" fill="currentColor" opacity="0.2" />
                  {/* Median tick */}
                  <rect x="27" y="3" width="1" height="6" fill="currentColor" opacity="0.45" />
                  {/* Competitor dot — right of median = above median */}
                  <circle cx="38" cy="6" r="3" fill="currentColor" opacity="0.85" />
                </svg>
              </div>
            </div>
          }
          badge="F"
          title="Points per shot"
          description="Average points per round fired. The strip shows where this competitor sits vs the full field — dot = their value, tick = field median."
        />
        <DiagramRow
          visual={
            <div className="flex flex-col items-center gap-0 text-center">
              <span className="text-xs font-medium tabular-nums border rounded px-1.5 py-0.5 border-border">
                {`CI ${MOCK_CI.toFixed(2)}`}
              </span>
              <span className="text-xs text-muted-foreground mt-0.5">consistent</span>
            </div>
          }
          badge="G"
          title="Consistency index"
          description="Coefficient of variation of HF% across stages. Lower = more consistent. Ranges: < 0.05 very consistent · 0.05–0.10 consistent · 0.10–0.15 moderate · 0.15–0.20 variable · > 0.20 streaky. Grayed out when fewer than 4 stages."
        />
        <DiagramRow
          last
          visual={
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded border px-1.5 py-0.5",
                "text-xs font-medium tabular-nums whitespace-nowrap",
                "border-amber-400 text-amber-700 dark:text-amber-400"
              )}
            >
              −95 pts on table
            </span>
          }
          badge="H"
          title="Points on the table"
          description="Total points left on the table from hit-quality loss (C/D/miss vs A) and penalties combined. Tap to open the coaching analysis panel for a per-stage breakdown."
        />
      </div>
      <p className="text-xs text-muted-foreground/70 mt-3">
        Note: if a competitor has zero penalties across all stages, a{" "}
        <span className="inline-flex items-center gap-0.5 text-green-600 dark:text-green-400 font-medium">
          <CheckCircle2 className="w-3 h-3 inline-block align-middle" aria-hidden="true" /> Clean
        </span>{" "}
        badge appears instead of penalty rows.
      </p>
    </section>
  );
}

function ConditionsOverlaySection() {
  return (
    <section>
      <h3 className="text-sm font-semibold mb-0.5">
        Conditions overlay{" "}
        <span className="text-xs font-normal text-muted-foreground">(coaching mode)</span>
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        Tap the{" "}
        <span className="inline-flex items-center gap-0.5 align-middle">
          <CloudSun className="w-3.5 h-3.5" aria-hidden="true" />
        </span>{" "}
        button above the table to reveal per-cell weather, time-of-day, and wind
        icons for each stage. The button only appears in coaching mode when venue
        coordinates are available. Tap or hover any icon cluster for full details.
      </p>
      <div>
        <DiagramRow
          visual={
            <div className="flex items-center gap-1.5 text-muted-foreground" aria-hidden="true">
              <Sun className="w-3.5 h-3.5 text-yellow-500" />
              <CloudSun className="w-3.5 h-3.5" />
              <Cloud className="w-3.5 h-3.5" />
              <CloudRain className="w-3.5 h-3.5 text-blue-400" />
              <CloudSnow className="w-3.5 h-3.5 text-sky-300" />
            </div>
          }
          badge="W"
          title="Weather icon"
          description="Sky conditions at the moment this competitor shot the stage — derived from Open-Meteo historical data at the match venue. Icons cover clear, partly cloudy, overcast, drizzle, rain, snow, fog, and thunderstorm."
        />
        <DiagramRow
          visual={
            <div className="flex items-center gap-1.5 text-muted-foreground" aria-hidden="true">
              <Sunrise className="w-3.5 h-3.5 text-orange-400" />
              <Sun className="w-3.5 h-3.5 text-yellow-500" />
              <Sunset className="w-3.5 h-3.5 text-orange-500" />
              <Moon className="w-3.5 h-3.5 text-indigo-400" />
            </div>
          }
          badge="T"
          title="Time-of-day icon"
          description="When the stage was shot (UTC): Sunrise 04–08, Daytime 09–17, Sunset 18–21, Night otherwise. Competitors in different squads shoot the same stage at different times — this makes that visible at a glance."
        />
        <DiagramRow
          last
          visual={
            <div className="flex flex-col items-center gap-1" aria-hidden="true">
              <span className="inline-flex items-center gap-px text-sky-400">
                <Wind className="w-3 h-3" />
                <span className="text-[9px] font-medium tabular-nums leading-none">4</span>
              </span>
              <span className="inline-flex items-center gap-px text-amber-500">
                <Wind className="w-3 h-3" />
                <span className="text-[9px] font-medium tabular-nums leading-none">8</span>
              </span>
              <span className="inline-flex items-center gap-px text-orange-500">
                <Wind className="w-3 h-3" />
                <span className="text-[9px] font-medium tabular-nums leading-none">12</span>
              </span>
            </div>
          }
          badge="V"
          title="Wind speed & direction"
          description={<>
            Only shown when wind is ≥ 3 m/s. The number is the rounded speed in m/s — readable without relying on color alone. Color indicates intensity:{" "}
            <span className="text-sky-400 font-medium">blue</span> light (3–5),{" "}
            <span className="text-amber-500 font-medium">amber</span> moderate (6–9),{" "}
            <span className="text-orange-500 font-medium">orange</span> strong (10–14),{" "}
            <span className="text-red-500 font-medium">red</span> very strong (≥ 15).{" "}
            Tap or hover for compass direction and gust speed.
          </>}
        />
      </div>
    </section>
  );
}

function ViewModeNote() {
  return (
    <div className="bg-muted rounded-md px-4 py-3 text-sm">
      <span className="font-semibold">Delta mode</span>
      {" — "}
      Switch to &ldquo;Delta&rdquo; with the toggle above the table to see points
      gained or lost relative to the group leader per stage, with colour-coded
      heatmap cells. The summary row then shows total match deficit.
    </div>
  );
}

export function CellHelpModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-xl max-h-[90svh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-6 pb-4 pr-12 border-b">
          <DialogTitle>How to read the comparison table</DialogTitle>
          <DialogDescription>
            An annotated guide to the data shown in each cell and the summary
            row. Tap any row in the table to get started.
          </DialogDescription>
        </DialogHeader>
        <TooltipProvider>
          <div className="px-6 pb-6 space-y-8 pt-4">
            <StageColumnDiagram />
            <StageCellDiagram />
            <ConditionsOverlaySection />
            <SummaryRowDiagram />
            <ViewModeNote />
          </div>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
