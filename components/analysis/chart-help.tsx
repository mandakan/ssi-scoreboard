import type { ReactNode } from "react";
import { ArrowUpDown } from "lucide-react";
import type { AnalysisChartId } from "@/lib/analysis-charts";

const SORT_NOTE = (
  <p>Stages appear in the same order as the comparison table. Use the <ArrowUpDown className="inline w-3 h-3 align-middle" aria-hidden="true" /><span className="sr-only">sort</span> button in a competitor&apos;s column header to sort by their shooting order — this chart will follow.</p>
);

const SWITCH_NOTE = (
  <p>Use the chips above the chart to switch views; your last choice is remembered on this device.</p>
);

export const CHART_HELP: Record<AnalysisChartId, { description: ReactNode; body: ReactNode }> = {
  "hf-by-stage": {
    description: "Bar height = hit factor (points ÷ time) for each stage. Higher is always better.",
    body: (
      <>
        <p>The dashed line (field leader) and dotted line (field median) benchmark your group against the full match field — toggle them with the buttons above the chart.</p>
        <p>DNF and DQ runs appear at HF 0 with reduced opacity.</p>
        <p>Click a competitor name in the legend to show or hide their bars.</p>
        {SORT_NOTE}
        {SWITCH_NOTE}
      </>
    ),
  },
  "hf-pct": {
    description: "Your hit factor as a percentage of the reference, per stage. 100% = you matched the winner.",
    body: (
      <>
        <p>Colour bands: green ≥ 95%, amber 85–95%, red &lt; 85% indicate run quality zones.</p>
        <p>Use the reference buttons above the chart to switch from &ldquo;stage winner&rdquo; to any specific competitor to compare gaps directly.</p>
        <p>Percentages control for relative HF level — a short stage and a long stage at 90% represent equal relative performance.</p>
        {SORT_NOTE}
        {SWITCH_NOTE}
      </>
    ),
  },
  "division-position": {
    description: <>Where each competitor sits within their division&apos;s HF distribution per stage — as a percentage of the division winner.</>,
    body: (
      <>
        <p>The shaded band shows where the middle 50% of the division scored (Q1–Q3). The dashed line is the division median, and the faint dotted line is the division minimum.</p>
        <p>A competitor sitting above the band outperformed most of their division on that stage; below the band means they trailed the majority.</p>
        <p>Compare stages where your line dips below the band — those are disproportionate opportunities relative to peers in the same division.</p>
        <p>Hover a stage bar to see the number of competitors contributing to that distribution. The legend shows the n range across all stages — a narrow band from a small field (e.g. n=4) is less reliable than one from a large field.</p>
        <p>When competitors are in different divisions, use the selector to switch between them.</p>
        {SORT_NOTE}
        {SWITCH_NOTE}
      </>
    ),
  },
  "speed-accuracy": {
    description: "Each point is one stage: X-axis = time taken, Y-axis = points scored.",
    body: (
      <>
        <p>Up and to the left is better — more points, less time.</p>
        <p>Diagonal iso-HF lines connect all time/points combinations with the same hit factor. A stage dot above the &ldquo;HF 6&rdquo; line means you achieved better than HF 6 on that stage.</p>
        <p>Look for stages where you drifted right (slow) or dropped down (lost points) relative to your usual cluster — those are your biggest improvement opportunities.</p>
        {SWITCH_NOTE}
      </>
    ),
  },
  "stage-balance": {
    description: "Radar polygon showing your percentage per stage. A uniform shape means consistent performance.",
    body: (
      <>
        <p>Each spoke is one stage; distance from the centre = your % of the reference.</p>
        <p>Inward dips are stages where you under-performed; outward spikes are strong stages.</p>
        <p>Switch between Group %, Division %, and Overall % using the toggle inside the chart. Toggle competitors on/off to compare polygon shapes side-by-side.</p>
        {SWITCH_NOTE}
      </>
    ),
  },
};
