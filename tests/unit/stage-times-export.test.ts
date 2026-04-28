import { describe, it, expect } from "vitest";
import {
  buildStageTimesExport,
  buildStageTimesCsv,
  escapeCsvField,
  stageTimesFilenameStem,
} from "@/lib/stage-times-export";
import type {
  CompareResponse,
  CompetitorInfo,
  CompetitorSummary,
  SquadInfo,
  StageComparison,
} from "@/lib/types";

const BOM = "﻿";

function summary(partial: Partial<CompetitorSummary> & { competitor_id: number }): CompetitorSummary {
  return {
    points: null,
    hit_factor: null,
    time: null,
    group_rank: null,
    group_percent: null,
    div_rank: null,
    div_percent: null,
    overall_rank: null,
    overall_percent: null,
    overall_percentile: null,
    dq: false,
    zeroed: false,
    dnf: false,
    incomplete: false,
    a_hits: null,
    c_hits: null,
    d_hits: null,
    miss_count: null,
    no_shoots: null,
    procedurals: null,
    stageClassification: null,
    hitLossPoints: null,
    penaltyLossPoints: 0,
    ...partial,
  };
}

function stage(num: number, name: string, comps: Record<number, CompetitorSummary>): StageComparison {
  return {
    stage_id: 1000 + num,
    stage_name: name,
    stage_num: num,
    max_points: 100,
    group_leader_hf: null,
    group_leader_points: null,
    overall_leader_hf: null,
    field_median_hf: null,
    field_competitor_count: 0,
    field_median_accuracy: null,
    field_cv: null,
    stageDifficultyLevel: 3,
    stageDifficultyLabel: "Medium",
    stageSeparatorLevel: 2,
    competitors: comps,
  };
}

const competitors: CompetitorInfo[] = [
  {
    id: 11,
    shooterId: 111,
    name: "Alice Andersson",
    competitor_number: "1",
    club: "Club A",
    division: "Production",
    region: "SWE",
    region_display: "Sweden",
    category: null,
    ics_alias: null,
    license: null,
  },
  {
    id: 22,
    shooterId: 222,
    name: 'Bob "Quoted, " Berg',
    competitor_number: "2",
    club: null,
    division: "Open",
    region: "SWE",
    region_display: "Sweden",
    category: null,
    ics_alias: null,
    license: null,
  },
  {
    id: 33,
    shooterId: 333,
    name: "Carol Cederblom",
    competitor_number: "3",
    club: "Club C",
    division: "Standard",
    region: "SWE",
    region_display: "Sweden",
    category: null,
    ics_alias: null,
    license: null,
  },
];

const squads: SquadInfo[] = [
  { id: 1, number: 1, name: "Squad 1", competitorIds: [11, 22] },
  { id: 2, number: 2, name: "Squad 2", competitorIds: [33] },
];

const compareData: Pick<CompareResponse, "stages"> = {
  stages: [
    // Intentionally out of order to verify sort
    stage(2, "Beta", {
      11: summary({ competitor_id: 11, time: 18.5, scorecard_created: "2026-04-27T11:00:00Z" }),
      22: summary({ competitor_id: 22, time: 17.2, scorecard_created: "2026-04-27T11:05:00Z" }),
    }),
    stage(1, "Alpha, the first", {
      11: summary({ competitor_id: 11, time: 12.3, scorecard_created: "2026-04-27T10:00:00Z" }),
      22: summary({ competitor_id: 22, time: null, dnf: true }),
    }),
  ],
};

const matchInfo = { ct: "22", id: "26547", name: "Test Match" };

describe("buildStageTimesExport", () => {
  it("orders competitors by selectedIds and stages by stage_number", () => {
    const out = buildStageTimesExport({
      match: matchInfo,
      compareData,
      competitors,
      squads,
      selectedIds: [22, 11],
    });

    expect(out.competitors.map((c) => c.competitor_id)).toEqual([22, 11]);
    expect(out.competitors[0].stages.map((s) => s.stage_number)).toEqual([1, 2]);
    expect(out.competitors[1].stages.map((s) => s.stage_number)).toEqual([1, 2]);
  });

  it("attaches squad name for each competitor when known", () => {
    const out = buildStageTimesExport({
      match: matchInfo,
      compareData,
      competitors,
      squads,
      selectedIds: [11, 33],
    });

    expect(out.competitors[0].squad).toBe("Squad 1");
    expect(out.competitors[1].squad).toBe("Squad 2");
  });

  it("sets squad to null when competitor is not in any squad", () => {
    const orphan: CompetitorInfo = {
      ...competitors[0],
      id: 99,
      name: "Orphan",
    };
    const out = buildStageTimesExport({
      match: matchInfo,
      compareData,
      competitors: [...competitors, orphan],
      squads,
      selectedIds: [99],
    });
    expect(out.competitors[0].squad).toBeNull();
  });

  it("emits null time_seconds and scorecard_updated_at for DNF/missing scorecards", () => {
    const out = buildStageTimesExport({
      match: matchInfo,
      compareData,
      competitors,
      squads,
      selectedIds: [22],
    });

    const stage1 = out.competitors[0].stages[0];
    expect(stage1.stage_number).toBe(1);
    expect(stage1.time_seconds).toBeNull();
    expect(stage1.scorecard_updated_at).toBeNull();

    const stage2 = out.competitors[0].stages[1];
    expect(stage2.time_seconds).toBe(17.2);
    expect(stage2.scorecard_updated_at).toBe("2026-04-27T11:05:00Z");
  });

  it("skips selectedIds that are not in the match competitor list", () => {
    const out = buildStageTimesExport({
      match: matchInfo,
      compareData,
      competitors,
      squads,
      selectedIds: [11, 9999, 22],
    });
    expect(out.competitors.map((c) => c.competitor_id)).toEqual([11, 22]);
  });

  it("includes match info verbatim", () => {
    const out = buildStageTimesExport({
      match: matchInfo,
      compareData,
      competitors,
      squads,
      selectedIds: [11],
    });
    expect(out.match).toEqual(matchInfo);
  });
});

describe("escapeCsvField", () => {
  it("returns empty string for null", () => {
    expect(escapeCsvField(null)).toBe("");
  });

  it("passes plain text through unchanged", () => {
    expect(escapeCsvField("Hello world")).toBe("Hello world");
  });

  it("quotes and doubles internal quotes when value contains a comma", () => {
    expect(escapeCsvField("a, b")).toBe('"a, b"');
  });

  it("quotes and doubles internal quotes when value contains a quote", () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes when value contains a newline", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("converts numbers to strings without quoting", () => {
    expect(escapeCsvField(12.34)).toBe("12.34");
    expect(escapeCsvField(0)).toBe("0");
  });
});

describe("buildStageTimesCsv", () => {
  it("starts with a UTF-8 BOM", () => {
    const out = buildStageTimesExport({
      match: matchInfo,
      compareData,
      competitors,
      squads,
      selectedIds: [11],
    });
    expect(buildStageTimesCsv(out).startsWith(BOM)).toBe(true);
  });

  it("uses CRLF line endings", () => {
    const out = buildStageTimesExport({
      match: matchInfo,
      compareData,
      competitors,
      squads,
      selectedIds: [11],
    });
    const csv = buildStageTimesCsv(out);
    expect(csv).toContain("\r\n");
    expect(csv.includes("\n\n")).toBe(false);
  });

  it("emits the expected header row", () => {
    const out = buildStageTimesExport({
      match: matchInfo,
      compareData,
      competitors,
      squads,
      selectedIds: [11],
    });
    const csv = buildStageTimesCsv(out);
    const firstLine = csv.slice(BOM.length).split("\r\n")[0];
    expect(firstLine).toBe(
      "competitor,division,club,squad,stage_number,stage_name,time_seconds,scorecard_updated_at",
    );
  });

  it("blocks rows by competitor and orders stages within each block", () => {
    const out = buildStageTimesExport({
      match: matchInfo,
      compareData,
      competitors,
      squads,
      selectedIds: [11, 22],
    });
    const csv = buildStageTimesCsv(out);
    const rows = csv.slice(BOM.length).trimEnd().split("\r\n").slice(1); // drop header
    expect(rows).toHaveLength(4);

    expect(rows[0]).toContain("Alice Andersson");
    expect(rows[0]).toContain(",1,");
    expect(rows[1]).toContain("Alice Andersson");
    expect(rows[1]).toContain(",2,");

    expect(rows[2]).toContain("Berg");
    expect(rows[2]).toContain(",1,");
    expect(rows[3]).toContain("Berg");
    expect(rows[3]).toContain(",2,");
  });

  it("escapes fields with commas and quotes", () => {
    const out = buildStageTimesExport({
      match: matchInfo,
      compareData,
      competitors,
      squads,
      selectedIds: [22],
    });
    const csv = buildStageTimesCsv(out);
    // Bob's name has a comma + quotes, must be quoted
    expect(csv).toContain('"Bob ""Quoted, "" Berg"');
    // Stage 1 name has a comma, must be quoted
    expect(csv).toContain('"Alpha, the first"');
  });

  it("emits empty cells for null time and timestamp", () => {
    const out = buildStageTimesExport({
      match: matchInfo,
      compareData,
      competitors,
      squads,
      selectedIds: [22],
    });
    const csv = buildStageTimesCsv(out);
    const rows = csv.slice(BOM.length).trimEnd().split("\r\n").slice(1);
    // Bob's stage 1 is DNF — last two columns should be empty
    expect(rows[0]).toMatch(/,$/);
    expect(rows[0].endsWith(",,")).toBe(true);
  });
});

describe("stageTimesFilenameStem", () => {
  it("slugifies the match name", () => {
    expect(
      stageTimesFilenameStem({ ct: "22", id: "26547", name: "Sw Open IPSC 2026!" }),
    ).toBe("stage-times-sw-open-ipsc-2026-22-26547");
  });

  it("falls back to 'match' when name slug is empty", () => {
    expect(stageTimesFilenameStem({ ct: "22", id: "26547", name: "!!!" })).toBe(
      "stage-times-match-22-26547",
    );
  });
});
