// Pure prediction logic — diff calculation and award computation.
// No I/O, fully unit-testable.

export interface Prediction {
  discordUserId: string;
  shooterId: number;
  shooterName: string;
  predictedPct: number;
  predictedMikes: number;
  submittedAt: string;
}

export interface PredictionState {
  matchCt: number;
  matchId: number;
  matchName: string;
  matchDate: string;
  predictions: Record<string, Prediction>; // keyed by discordUserId
  revealed: boolean;
}

export interface ActualResult {
  discordUserId: string;
  shooterName: string;
  predictedPct: number;
  predictedMikes: number;
  actualPct: number;
  actualMikes: number;
  pctDiff: number; // actual - predicted (positive = better than predicted)
  mikesDiff: number; // actual - predicted (positive = more mikes than predicted)
}

export interface PredictionAwards {
  mostAccurate: ActualResult | null; // smallest absolute pctDiff
  mostHumble: ActualResult | null; // biggest positive pctDiff (actual >> predicted)
  mostOverconfident: ActualResult | null; // biggest negative pctDiff (actual << predicted)
  oracle: ActualResult | null; // pctDiff within 1%
  mikeOracle: ActualResult | null; // exact mike prediction
  mikePessimist: ActualResult | null; // predicted most mikes over actual
}

/**
 * Compute actual results by comparing predictions against real match data.
 */
export function computeResults(
  predictions: Record<string, Prediction>,
  actualData: Record<
    string,
    { matchPctActual: number; totalMisses: number }
  >,
): ActualResult[] {
  const results: ActualResult[] = [];

  for (const [userId, pred] of Object.entries(predictions)) {
    const actual = actualData[userId];
    if (!actual) continue;

    results.push({
      discordUserId: userId,
      shooterName: pred.shooterName,
      predictedPct: pred.predictedPct,
      predictedMikes: pred.predictedMikes,
      actualPct: actual.matchPctActual,
      actualMikes: actual.totalMisses,
      pctDiff: actual.matchPctActual - pred.predictedPct,
      mikesDiff: actual.totalMisses - pred.predictedMikes,
    });
  }

  // Sort by smallest absolute pctDiff (most accurate first)
  results.sort((a, b) => Math.abs(a.pctDiff) - Math.abs(b.pctDiff));

  return results;
}

/**
 * Determine awards from computed results.
 */
export function computeAwards(results: ActualResult[]): PredictionAwards {
  if (results.length === 0) {
    return {
      mostAccurate: null,
      mostHumble: null,
      mostOverconfident: null,
      oracle: null,
      mikeOracle: null,
      mikePessimist: null,
    };
  }

  // Most accurate: smallest absolute pctDiff (already sorted)
  const mostAccurate = results[0];

  // Most humble: biggest positive pctDiff (actual >> predicted, underestimated self)
  const mostHumble = results.reduce((best, r) =>
    r.pctDiff > (best?.pctDiff ?? -Infinity) ? r : best,
  );

  // Most overconfident: biggest negative pctDiff (actual << predicted)
  const mostOverconfident = results.reduce((best, r) =>
    r.pctDiff < (best?.pctDiff ?? Infinity) ? r : best,
  );

  // Oracle: within 1% absolute diff
  const oracle = results.find((r) => Math.abs(r.pctDiff) <= 1) ?? null;

  // Mike oracle: exact mike prediction
  const mikeOracle = results.find((r) => r.mikesDiff === 0) ?? null;

  // Mike pessimist: predicted most mikes over actual (biggest negative mikesDiff)
  const mikePessimist = results.reduce((best, r) =>
    r.mikesDiff < (best?.mikesDiff ?? Infinity) ? r : best,
  );

  return {
    mostAccurate,
    // Only award humble/overconfident if they're different from most accurate
    // and the diff is meaningful (> 1%)
    mostHumble:
      mostHumble !== mostAccurate && mostHumble.pctDiff > 1
        ? mostHumble
        : null,
    mostOverconfident:
      mostOverconfident !== mostAccurate && mostOverconfident.pctDiff < -1
        ? mostOverconfident
        : null,
    oracle,
    mikeOracle,
    // Only award if predicted more mikes than actual by at least 2
    mikePessimist:
      mikePessimist && mikePessimist.mikesDiff < -1 ? mikePessimist : null,
  };
}

/**
 * Format the prediction reveal embed description.
 */
export function formatResultsTable(results: ActualResult[]): string {
  if (results.length === 0) return "No predictions matched competitors.";

  const lines: string[] = ["```"];
  lines.push(
    padRight("Shooter", 16) +
      padLeft("Pred%", 7) +
      padLeft("Act%", 7) +
      padLeft("Diff", 7) +
      padLeft("PMike", 6) +
      padLeft("AMike", 6),
  );
  lines.push("-".repeat(49));

  for (const r of results) {
    const name =
      r.shooterName.length > 15
        ? r.shooterName.slice(0, 14) + "."
        : r.shooterName;
    const diffStr = (r.pctDiff >= 0 ? "+" : "") + r.pctDiff.toFixed(1) + "%";
    lines.push(
      padRight(name, 16) +
        padLeft(r.predictedPct.toFixed(1) + "%", 7) +
        padLeft(r.actualPct.toFixed(1) + "%", 7) +
        padLeft(diffStr, 7) +
        padLeft(String(r.predictedMikes), 6) +
        padLeft(String(r.actualMikes), 6),
    );
  }

  lines.push("```");
  return lines.join("\n");
}

/**
 * Format award lines for the embed.
 */
export function formatAwards(awards: PredictionAwards): string {
  const lines: string[] = [];

  if (awards.oracle) {
    lines.push(
      `\u{1F52E} **Oracle:** ${awards.oracle.shooterName} — within ${Math.abs(awards.oracle.pctDiff).toFixed(1)}% of actual!`,
    );
  }
  if (awards.mostAccurate) {
    lines.push(
      `\u{1F3AF} **Most Accurate:** ${awards.mostAccurate.shooterName} (off by ${Math.abs(awards.mostAccurate.pctDiff).toFixed(1)}%)`,
    );
  }
  if (awards.mostHumble) {
    lines.push(
      `\u{1F4C8} **Most Humble:** ${awards.mostHumble.shooterName} (predicted ${awards.mostHumble.predictedPct.toFixed(1)}%, got ${awards.mostHumble.actualPct.toFixed(1)}%)`,
    );
  }
  if (awards.mostOverconfident) {
    lines.push(
      `\u{1F4C9} **Most Overconfident:** ${awards.mostOverconfident.shooterName} (predicted ${awards.mostOverconfident.predictedPct.toFixed(1)}%, got ${awards.mostOverconfident.actualPct.toFixed(1)}%)`,
    );
  }
  if (awards.mikeOracle) {
    lines.push(
      `\u{1F52B} **Mike Oracle:** ${awards.mikeOracle.shooterName} — nailed it with ${awards.mikeOracle.predictedMikes} mikes!`,
    );
  }
  if (awards.mikePessimist) {
    lines.push(
      `\u{1F648} **Mike Pessimist:** ${awards.mikePessimist.shooterName} (predicted ${awards.mikePessimist.predictedMikes}, only got ${awards.mikePessimist.actualMikes})`,
    );
  }

  return lines.join("\n");
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s : " ".repeat(len - s.length) + s;
}
