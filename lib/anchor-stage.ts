// Pure function for selecting the shooter's best-ever stage. No I/O, fully unit-tested.

import type { AnchorStage } from "@/lib/types";

export interface StagePctRecord {
  stagePct: number;
  stageName: string;
  stageNumber: number;
  matchName: string;
  ct: string;
  matchId: string;
  date: string | null;
  division: string | null;
}

const MIN_STAGES = 10;

/**
 * Pick the shooter's single best stage from their match history.
 * Returns null when fewer than MIN_STAGES valid stage records are provided.
 * Tiebreak: most recent date wins (ISO date string comparison, desc).
 */
export function computeAnchorStage(stages: StagePctRecord[]): AnchorStage | null {
  if (stages.length < MIN_STAGES) return null;

  let best = stages[0];
  for (let i = 1; i < stages.length; i++) {
    const s = stages[i];
    if (s.stagePct > best.stagePct) {
      best = s;
    } else if (s.stagePct === best.stagePct) {
      const db = best.date ?? "";
      const ds = s.date ?? "";
      if (ds > db) best = s;
    }
  }

  return {
    stageName: best.stageName,
    stageNumber: best.stageNumber,
    matchName: best.matchName,
    ct: best.ct,
    matchId: best.matchId,
    date: best.date,
    division: best.division,
    stagePct: best.stagePct,
  };
}
