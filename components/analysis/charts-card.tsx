"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { HelpCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CHART_HELP } from "@/components/analysis/chart-help";
import {
  ANALYSIS_CHARTS,
  CHART_STORAGE_KEY,
  availableCharts,
  CHART_ANCHORS,
  resolveChart,
  type AnalysisChartId,
} from "@/lib/analysis-charts";
import { useHashAnchor } from "@/lib/hooks/use-hash-anchor";
import { trackUi } from "@/lib/ui-telemetry";
import type { CompareResponse, StageComparison } from "@/lib/types";

const ChartSkeleton = () => <Skeleton className="h-64 w-full rounded-lg" />;

const ComparisonChart = dynamic(
  () => import("@/components/comparison-chart").then((m) => m.ComparisonChart),
  { ssr: false, loading: ChartSkeleton },
);
const HfPercentChart = dynamic(
  () => import("@/components/hf-percent-chart").then((m) => m.HfPercentChart),
  { ssr: false, loading: ChartSkeleton },
);
const SpeedAccuracyChart = dynamic(
  () => import("@/components/scatter-chart").then((m) => m.SpeedAccuracyChart),
  { ssr: false, loading: ChartSkeleton },
);
const StageBalanceChart = dynamic(
  () => import("@/components/radar-chart").then((m) => m.StageBalanceChart),
  { ssr: false, loading: ChartSkeleton },
);
const DivisionDistributionChart = dynamic(
  () =>
    import("@/components/division-distribution-chart").then(
      (m) => m.DivisionDistributionChart,
    ),
  { ssr: false, loading: ChartSkeleton },
);

const noopSubscribe = () => () => {};

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the choice just won't persist.
  }
}

const SHOWS_SHOOTING_ORDER: AnalysisChartId[] = ["hf-by-stage", "hf-pct", "division-position"];

interface ChartsCardProps {
  data: CompareResponse;
  stages: StageComparison[];
  sortedCompName: string | null;
  careerBaselineHF: number | null | undefined;
  careerBaselinePct: number | null | undefined;
  ct: string;
}

export function ChartsCard({
  data,
  stages,
  sortedCompName,
  careerBaselineHF,
  careerBaselinePct,
  ct,
}: ChartsCardProps) {
  const stored = useSyncExternalStore(
    noopSubscribe,
    () => safeGet(CHART_STORAGE_KEY),
    () => null,
  );
  const [override, setOverride] = useState<AnalysisChartId | null>(null);
  const available = availableCharts(data);
  const selected = resolveChart(override ?? stored, available);
  const title = ANALYSIS_CHARTS.find((c) => c.id === selected)?.title ?? "";
  const help = CHART_HELP[selected];

  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          trackUi({ op: "analysis-section-open", ct: parseInt(ct, 10), section: "charts" });
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ct]);

  // Anchors are only offered for charts that are available; the hook clears
  // the hash once it fires. Scroll waits a frame so the chart has rendered.
  const anchors = Object.keys(CHART_ANCHORS).filter((k) => available.includes(CHART_ANCHORS[k]));
  useHashAnchor(anchors, (anchor) => {
    const id = CHART_ANCHORS[anchor];
    setOverride(id);
    safeSet(CHART_STORAGE_KEY, id);
    requestAnimationFrame(() =>
      document.getElementById("charts-card")?.scrollIntoView({ block: "start" }),
    );
  });

  function choose(id: AnalysisChartId) {
    setOverride(id);
    safeSet(CHART_STORAGE_KEY, id);
    trackUi({ op: "chart-switch", ct: parseInt(ct, 10), chart: id });
  }

  return (
    <section
      ref={rootRef}
      id="charts-card"
      aria-labelledby="charts-card-heading"
      className="rounded-lg border p-4 space-y-3"
    >
      <div className="flex items-center gap-1.5">
        <h2 id="charts-card-heading" className="font-semibold">
          {title}
          {sortedCompName && SHOWS_SHOOTING_ORDER.includes(selected) && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">· {sortedCompName}&apos;s shooting order</span>
          )}
        </h2>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              aria-label={`About ${title}`}
            >
              <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 max-w-[calc(100vw-2rem)]" side="bottom" align="start">
            <PopoverHeader>
              <PopoverTitle>{title}</PopoverTitle>
              <PopoverDescription>{help.description}</PopoverDescription>
            </PopoverHeader>
            <div className="text-xs text-muted-foreground space-y-1.5 mt-2">{help.body}</div>
          </PopoverContent>
        </Popover>
      </div>

      <div role="group" aria-label="Chart" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {ANALYSIS_CHARTS.filter((c) => available.includes(c.id)).map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={c.id === selected}
            onClick={() => choose(c.id)}
            className={`min-h-11 shrink-0 rounded-full border px-3 text-sm transition-colors ${
              c.id === selected
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {selected === "hf-by-stage" && (
        <ComparisonChart data={data} stages={stages} careerBaselineHF={careerBaselineHF} />
      )}
      {selected === "hf-pct" && (
        <HfPercentChart data={data} stages={stages} careerBaselinePct={careerBaselinePct} />
      )}
      {selected === "division-position" && (
        <DivisionDistributionChart data={data} stages={stages} />
      )}
      {selected === "speed-accuracy" && <SpeedAccuracyChart data={data} />}
      {selected === "stage-balance" && <StageBalanceChart data={data} />}
    </section>
  );
}
