import type {
  CompareResponse,
  FocusArea,
  FocusAreaCategory,
  FocusAreaConfidence,
} from "@/lib/types";

// ── helpers ──────────────────────────────────────────────────────────────────

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function rankArray(xs: number[]): number[] {
  const sorted = [...xs].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(xs.length);
  for (let r = 0; r < sorted.length; r++) {
    ranks[sorted[r].i] = r + 1;
  }
  return ranks;
}

function spearmanR(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 4) return null;
  const n = xs.length;
  const rx = rankArray(xs);
  const ry = rankArray(ys);
  let dSquaredSum = 0;
  for (let i = 0; i < n; i++) {
    const d = rx[i] - ry[i];
    dSquaredSum += d * d;
  }
  return 1 - (6 * dSquaredSum) / (n * (n * n - 1));
}

function confidence(n: number, lowThreshold: number, highThreshold: number): FocusAreaConfidence {
  if (n < lowThreshold) return "low";
  if (n < highThreshold) return "medium";
  return "high";
}

function area(
  category: FocusAreaCategory,
  title: string,
  evidence: string,
  chartAnchor: string,
  conf: FocusAreaConfidence,
  estimatedRecoverableMatchPct: number | null,
): FocusArea {
  return { category, title, evidence, chartAnchor, confidence: conf, estimatedRecoverableMatchPct };
}

// ── rules ────────────────────────────────────────────────────────────────────

function ruleSafety(compare: CompareResponse, competitorId: number): FocusArea | null {
  const hasDq = compare.stages.some((s) => s.competitors[competitorId]?.dq === true);
  const hasDnf = compare.stages.some((s) => s.competitors[competitorId]?.dnf === true);
  const hasZeroed = compare.stages.some((s) => s.competitors[competitorId]?.zeroed === true);
  if (!hasDq && !hasDnf && !hasZeroed) return null;

  const parts: string[] = [];
  if (hasDq) parts.push("DQ");
  if (hasDnf) parts.push("DNF");
  if (hasZeroed) parts.push("zeroed stage");
  const what = parts.join(", ");
  return area(
    "safety",
    "Safety / sequence",
    `${what} recorded this match. One procedural or sequence error costs a stage entirely -- review the stage video and dry-fire the sequence.`,
    "chart-stage-results",
    "high",
    null,
  );
}

function ruleMistakeReduction(compare: CompareResponse, competitorId: number): FocusArea | null {
  const stats = compare.penaltyStats[competitorId];
  if (!stats) return null;
  const { penaltyCostPercent, matchPctActual, totalPenalties } = stats;
  if (penaltyCostPercent < 10) return null;

  // Sample-size guard: count valid (non-DQ, non-DNF, non-zeroed) stages fired
  const stagesFired = compare.stages.filter(
    (s) => {
      const c = s.competitors[competitorId];
      return c && !c.dq && !c.dnf && !c.zeroed;
    },
  ).length;

  const conf = confidence(stagesFired, 4, 7);
  return area(
    "mistake-reduction",
    "Mistake reduction",
    `Penalties cost ${penaltyCostPercent.toFixed(1)}% of your match % (${totalPenalties} total across ${stagesFired} stages). Your actual match % was ${matchPctActual.toFixed(1)}% -- clean shooting would push it to ${(matchPctActual + penaltyCostPercent).toFixed(1)}%.`,
    "chart-stage-results",
    conf,
    penaltyCostPercent,
  );
}

function ruleWeakHand(compare: CompareResponse, competitorId: number): FocusArea | null {
  // Compute weak-hand stages specifically (not all constrained stages).
  const validResult = (s: (typeof compare.stages)[0]) => {
    const c = s.competitors[competitorId];
    return c && !c.dq && !c.dnf && !c.zeroed && c.group_percent != null
      ? (c.group_percent as number)
      : null;
  };

  const weakHandPcts: number[] = [];
  for (const s of compare.stages) {
    if (s.constraints?.weakHand) {
      const pct = validResult(s);
      if (pct !== null) weakHandPcts.push(pct);
    }
  }

  const normalPcts: number[] = [];
  for (const s of compare.stages) {
    if (!s.constraints?.weakHand && !s.constraints?.strongHand && !s.constraints?.movingTargets && !s.constraints?.unloadedStart) {
      const pct = validResult(s);
      if (pct !== null) normalPcts.push(pct);
    }
  }

  if (weakHandPcts.length < 3 || normalPcts.length < 1) return null;

  const avgWeakHand = mean(weakHandPcts);
  const avgNormal = mean(normalPcts);
  const delta = avgWeakHand - avgNormal;
  if (delta > -8) return null;

  const totalValidStages = weakHandPcts.length + normalPcts.length;
  const estimatedRecoverable = Math.abs(delta) * (weakHandPcts.length / totalValidStages);
  const conf = confidence(weakHandPcts.length, 3, 5);
  return area(
    "weak-hand",
    "Weak hand",
    `Weak-hand stages averaged ${avgWeakHand.toFixed(1)}% group %, ${Math.abs(delta).toFixed(1)}% below your normal-stage average of ${avgNormal.toFixed(1)}% (${weakHandPcts.length} weak-hand stages).`,
    "coaching-analysis",
    conf,
    estimatedRecoverable,
  );
}

function ruleLongStages(compare: CompareResponse, competitorId: number): FocusArea | null {
  const clp = compare.courseLengthPerformance?.[competitorId];
  if (!clp) return null;

  const longEntry = clp.find((e) => e.courseDisplay === "Long");
  const shortEntry = clp.find((e) => e.courseDisplay === "Short");

  if (!longEntry || !shortEntry) return null;
  if (longEntry.stageCount < 2 || shortEntry.stageCount < 2) return null;
  if (longEntry.avgGroupPercent == null || shortEntry.avgGroupPercent == null) return null;

  const delta = longEntry.avgGroupPercent - shortEntry.avgGroupPercent;
  if (delta > -10) return null;

  const minN = Math.min(longEntry.stageCount, shortEntry.stageCount);
  const conf = confidence(minN, 2, 4);
  const totalStages = compare.stages.length;
  const estimatedRecoverable =
    totalStages > 0
      ? Math.abs(delta) * (longEntry.stageCount / totalStages)
      : null;
  return area(
    "long-stages",
    "Long stages / endurance",
    `Long stages averaged ${longEntry.avgGroupPercent.toFixed(1)}% group %, ${Math.abs(delta).toFixed(1)}% below short stages (${shortEntry.avgGroupPercent.toFixed(1)}%). ${longEntry.stageCount} long, ${shortEntry.stageCount} short stages compared.`,
    "coaching-analysis",
    conf,
    estimatedRecoverable,
  );
}

function ruleTempo(compare: CompareResponse, competitorId: number): FocusArea | null {
  const fp = compare.styleFingerprintStats?.[competitorId];
  if (!fp || fp.speedPercentile == null || fp.accuracyPercentile == null) return null;
  if (!(fp.speedPercentile < 30 && fp.accuracyPercentile > 70)) return null;

  const conf = confidence(fp.stagesFired, 4, 7);
  const estimatedRecoverable = (30 - fp.speedPercentile) * 0.08;
  return area(
    "tempo",
    "Tempo / commit faster",
    `Speed percentile ${fp.speedPercentile.toFixed(0)} vs accuracy percentile ${fp.accuracyPercentile.toFixed(0)}: accurate but leaving time on the table. Committing 5-10% faster on lower-round-count stages could recover match %.`,
    "chart-speed-accuracy",
    conf,
    estimatedRecoverable,
  );
}

function ruleSightDiscipline(compare: CompareResponse, competitorId: number): FocusArea | null {
  const fp = compare.styleFingerprintStats?.[competitorId];
  if (!fp || fp.speedPercentile == null || fp.accuracyPercentile == null) return null;
  if (!(fp.speedPercentile > 70 && fp.accuracyPercentile < 30)) return null;

  const conf = confidence(fp.stagesFired, 4, 7);
  const estimatedRecoverable = (30 - fp.accuracyPercentile) * 0.1;
  return area(
    "sight-discipline",
    "Sight discipline / call your shots",
    `Speed percentile ${fp.speedPercentile.toFixed(0)} vs accuracy percentile ${fp.accuracyPercentile.toFixed(0)}: fast but losing points to poor hits. Slowing transitions 5-10% to confirm the sight picture would reduce miss/C rates.`,
    "chart-speed-accuracy",
    conf,
    estimatedRecoverable,
  );
}

function ruleMatchNerves(
  compare: CompareResponse,
  competitorId: number,
  careerComposurePercentile: number | null | undefined,
): FocusArea | null {
  if (careerComposurePercentile == null) return null;
  const fp = compare.styleFingerprintStats?.[competitorId];
  if (!fp) return null;
  const drop = careerComposurePercentile - fp.composurePercentile;
  if (drop < 15) return null;

  const conf = confidence(fp.stagesFired, 4, 7);
  return area(
    "match-nerves",
    "Match nerves",
    `Composure percentile ${fp.composurePercentile.toFixed(0)} vs career median ${careerComposurePercentile.toFixed(0)} -- ${drop.toFixed(0)} point drop. More penalties than usual suggest elevated pressure. Pre-stage routine focus may help.`,
    "chart-style-fingerprint",
    conf,
    drop * 0.05,
  );
}

function ruleStamina(compare: CompareResponse, competitorId: number): FocusArea | null {
  // Compute personal Spearman r between stage shooting_order and group_percent.
  const pairs: Array<{ order: number; pct: number }> = [];
  for (const s of compare.stages) {
    const c = s.competitors[competitorId];
    if (!c || c.dq || c.dnf || c.zeroed) continue;
    if (c.shooting_order == null || c.group_percent == null) continue;
    pairs.push({ order: c.shooting_order, pct: c.group_percent });
  }

  if (pairs.length < 4) return null;
  const orders = pairs.map((p) => p.order);
  const pcts = pairs.map((p) => p.pct);
  const r = spearmanR(orders, pcts);
  if (r == null || r >= -0.3) return null;

  const conf = confidence(pairs.length, 4, 7);
  return area(
    "stamina",
    "Stamina / focus management",
    `Performance declined as the match progressed (shooting-order correlation r = ${r.toFixed(2)}). Later stages averaged lower group % -- fatigue or concentration drift may be a factor.`,
    "coaching-analysis",
    conf,
    Math.abs(r) * 5,
  );
}

// ── public API ───────────────────────────────────────────────────────────────

export interface ComputeFocusAreasOpts {
  /** Career median composure percentile for the match-nerves rule. Omit or pass null to skip. */
  careerComposurePercentile?: number | null;
}

/**
 * Compute ranked focus areas for one competitor in a completed match.
 * Pure function: no I/O, no AI, no GraphQL.
 * Returns at most 3 items; Safety is always first when triggered.
 */
export function computeFocusAreas(
  compare: CompareResponse,
  competitorId: number,
  opts: ComputeFocusAreasOpts = {},
): FocusArea[] {
  const safetyArea = ruleSafety(compare, competitorId);

  const candidates: FocusArea[] = [
    ruleMistakeReduction(compare, competitorId),
    ruleWeakHand(compare, competitorId),
    ruleLongStages(compare, competitorId),
    ruleTempo(compare, competitorId),
    ruleSightDiscipline(compare, competitorId),
    ruleMatchNerves(compare, competitorId, opts.careerComposurePercentile),
    ruleStamina(compare, competitorId),
  ].filter((r): r is FocusArea => r !== null);

  // Sort remaining by estimatedRecoverableMatchPct desc (nulls last).
  candidates.sort((a, b) => {
    const av = a.estimatedRecoverableMatchPct ?? -Infinity;
    const bv = b.estimatedRecoverableMatchPct ?? -Infinity;
    return bv - av;
  });

  // Safety always leads; fill remaining slots from candidates.
  const slots = safetyArea ? 2 : 3;
  const result: FocusArea[] = safetyArea ? [safetyArea] : [];
  for (const c of candidates) {
    if (result.length - (safetyArea ? 1 : 0) >= slots) break;
    result.push(c);
  }

  return result;
}
