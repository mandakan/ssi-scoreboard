// Pure builder for the stage-times export feature (issue #329).
// Same data, two formats: JSON (one object per competitor with stages[])
// and CSV (flat rows, competitor-blocked, stage-ordered).
//
// No I/O, no DOM. Used both client-side (download buttons) and server-side
// (MCP get_stage_times tool).

import type {
  CompareResponse,
  CompetitorInfo,
  SquadInfo,
} from "@/lib/types";

export interface StageTimeEntry {
  stage_number: number;
  stage_name: string;
  /** Raw stage time in seconds. Null when the competitor has no scorecard
   *  for this stage, DNF'd, or the timer reading is missing. */
  time_seconds: number | null;
  /** ISO timestamp of when the scorecard was recorded. Null when unknown. */
  scorecard_updated_at: string | null;
}

export interface CompetitorStageTimes {
  competitor_id: number;
  name: string;
  division: string | null;
  club: string | null;
  squad: string | null;
  stages: StageTimeEntry[];
}

export interface StageTimesMatchInfo {
  ct: string;
  id: string;
  name: string;
}

export interface StageTimesExport {
  match: StageTimesMatchInfo;
  competitors: CompetitorStageTimes[];
}

interface BuildInput {
  match: StageTimesMatchInfo;
  compareData: Pick<CompareResponse, "stages">;
  competitors: CompetitorInfo[];
  squads: SquadInfo[];
  selectedIds: readonly number[];
}

/**
 * Build the structured JSON export for a set of selected competitors.
 *
 * Ordering:
 *  - competitors[] follows `selectedIds` order (preserves user's selection order)
 *  - each competitor's stages[] is sorted by stage_number ascending
 *
 * Competitors that don't appear in the match `competitors` list are skipped.
 */
export function buildStageTimesExport({
  match,
  compareData,
  competitors,
  squads,
  selectedIds,
}: BuildInput): StageTimesExport {
  const competitorById = new Map<number, CompetitorInfo>();
  for (const c of competitors) competitorById.set(c.id, c);

  const squadById = new Map<number, string>();
  for (const sq of squads) {
    for (const cid of sq.competitorIds) squadById.set(cid, sq.name);
  }

  const sortedStages = [...compareData.stages].sort(
    (a, b) => a.stage_num - b.stage_num,
  );

  const competitorEntries: CompetitorStageTimes[] = [];
  for (const cid of selectedIds) {
    const info = competitorById.get(cid);
    if (!info) continue;

    const stages: StageTimeEntry[] = sortedStages.map((stage) => {
      const summary = stage.competitors[cid];
      return {
        stage_number: stage.stage_num,
        stage_name: stage.stage_name,
        time_seconds: summary?.time ?? null,
        scorecard_updated_at: summary?.scorecard_created ?? null,
      };
    });

    competitorEntries.push({
      competitor_id: cid,
      name: info.name,
      division: info.division,
      club: info.club,
      squad: squadById.get(cid) ?? null,
      stages,
    });
  }

  return { match, competitors: competitorEntries };
}

/** RFC 4180 field escape: quote any field containing comma, quote, CR, or LF. */
export function escapeCsvField(value: string | number | null): string {
  if (value === null) return "";
  const s = typeof value === "number" ? String(value) : value;
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Build a flat CSV from the same export data. Rows are ordered competitor-then-stage.
 * Includes a UTF-8 BOM so Excel detects the encoding correctly when double-clicking.
 */
export function buildStageTimesCsv(data: StageTimesExport): string {
  const headers = [
    "competitor",
    "division",
    "club",
    "squad",
    "stage_number",
    "stage_name",
    "time_seconds",
    "scorecard_updated_at",
  ];

  const lines: string[] = [headers.join(",")];

  for (const comp of data.competitors) {
    for (const st of comp.stages) {
      lines.push(
        [
          escapeCsvField(comp.name),
          escapeCsvField(comp.division),
          escapeCsvField(comp.club),
          escapeCsvField(comp.squad),
          escapeCsvField(st.stage_number),
          escapeCsvField(st.stage_name),
          escapeCsvField(st.time_seconds),
          escapeCsvField(st.scorecard_updated_at),
        ].join(","),
      );
    }
  }

  // Excel-friendly UTF-8 BOM + CRLF line endings.
  // The BOM (﻿) is intentional — it's how Excel detects UTF-8.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Suggested filename stem (no extension) for downloads. */
export function stageTimesFilenameStem(match: StageTimesMatchInfo): string {
  const slug = match.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "match";
  return `stage-times-${slug}-${match.ct}-${match.id}`;
}
