import { describe, it, expect } from "vitest";
import { computeBriefHooks, MAX_BRIEF_HOOKS } from "@/lib/pre-match-brief-hooks";
import type { StageInfo, ShooterDashboardResponse } from "@/lib/types";
import type { SquadContext } from "@/lib/pre-match-prompt";

function makeStage(overrides: Partial<StageInfo> = {}): StageInfo {
  return {
    id: 1,
    name: "Stage 1",
    stage_number: 1,
    max_points: 100,
    min_rounds: 12,
    paper_targets: 6,
    steel_targets: 0,
    ssi_url: null,
    course_display: "Medium",
    procedure: null,
    firearm_condition: null,
    ...overrides,
  };
}

function makeStages(count: number, overrides: Partial<StageInfo> = {}): StageInfo[] {
  return Array.from({ length: count }, (_, i) =>
    makeStage({ id: i + 1, stage_number: i + 1, name: `Stage ${i + 1}`, ...overrides }),
  );
}

function makeDashboard(overrides: Partial<ShooterDashboardResponse> = {}): ShooterDashboardResponse {
  return {
    shooterId: 1,
    profile: { name: "Test Shooter", club: null, division: "Production Optics", lastSeen: "2025-01-01", region: null, region_display: null, category: null, ics_alias: null, license: null },
    matchCount: 10,
    matches: Array.from({ length: 10 }, (_, i) => ({
      ct: "22",
      matchId: String(i + 1),
      name: `Match ${i + 1}`,
      date: `2025-0${(i % 9) + 1}-01`,
      venue: null,
      level: "l2",
      region: null,
      division: "Production Optics",
      competitorId: 1,
      competitorsInDivision: 20,
      stageCount: 6,
      avgHF: 3.5,
      matchPct: 80,
      totalA: 50,
      totalC: 5,
      totalD: 2,
      totalMiss: 0,
      totalNoShoots: 0,
      dq: false,
    })),
    stats: {
      totalStages: 60,
      dateRange: { from: "2024-01-01", to: "2025-01-01" },
      overallAvgHF: 3.5,
      overallMatchPct: 80,
      aPercent: 75,
      cPercent: 15,
      dPercent: 5,
      missPercent: 2,
      hfTrendSlope: 0.001,
      consistencyCV: 0.15,
      avgPenaltyRate: 0.02,
    },
    ...overrides,
  };
}

function makeSquadContext(overrides: Partial<SquadContext> = {}): SquadContext {
  return {
    position: 1,
    squadSize: 4,
    startingStages: [1, 5],
    ...overrides,
  };
}

describe("computeBriefHooks", () => {
  it("returns empty array when matches list is empty", () => {
    const dashboard = makeDashboard({ matches: [], matchCount: 0 });
    const result = computeBriefHooks(makeStages(6), dashboard, null);
    expect(result).toEqual([]);
  });

  it("returns empty array when fewer than MIN_MATCHES and no high-priority rules fire", () => {
    const dashboard = makeDashboard({
      matches: Array.from({ length: 4 }, (_, i) => ({
        ct: "22", matchId: String(i), name: `M${i}`, date: null, venue: null, level: "l2",
        region: null, division: null, competitorId: 1, competitorsInDivision: null,
        stageCount: 5, avgHF: 3.5, matchPct: 80, totalA: 50, totalC: 5, totalD: 2,
        totalMiss: 0, totalNoShoots: 0, dq: false,
      })),
      matchCount: 4,
    });
    const result = computeBriefHooks(makeStages(6), dashboard, null);
    expect(result).toEqual([]);
  });

  describe("recent DQ hook", () => {
    it("fires when a recent match has dq=true", () => {
      const dashboard = makeDashboard();
      dashboard.matches[2] = { ...dashboard.matches[2], dq: true };
      const result = computeBriefHooks(makeStages(6), dashboard, null);
      expect(result.some((h) => h.tag === "recent-dq")).toBe(true);
    });

    it("does not fire when no recent DQ", () => {
      const dashboard = makeDashboard();
      const result = computeBriefHooks(makeStages(6), dashboard, null);
      expect(result.some((h) => h.tag === "recent-dq")).toBe(false);
    });

    it("recent-dq is highest priority hook", () => {
      const dashboard = makeDashboard({ stats: { ...makeDashboard().stats, avgPenaltyRate: 0.1 } });
      dashboard.matches[0] = { ...dashboard.matches[0], dq: true };
      const constrained = makeStage({ procedure: "Weak hand only" });
      const stages = [constrained, ...makeStages(5, {})];
      const result = computeBriefHooks(stages, dashboard, null);
      expect(result[0].tag).toBe("recent-dq");
    });
  });

  describe("constraint-stages hook", () => {
    it("fires for weak-hand stage", () => {
      const stages = [makeStage({ procedure: "Weak hand only" }), ...makeStages(5)];
      const result = computeBriefHooks(stages, makeDashboard(), null);
      expect(result.some((h) => h.tag === "constraint-stages")).toBe(true);
    });

    it("fires for strong-hand stage", () => {
      const stages = [makeStage({ procedure: "Strong hand only" }), ...makeStages(5)];
      const result = computeBriefHooks(stages, makeDashboard(), null);
      expect(result.some((h) => h.tag === "constraint-stages")).toBe(true);
    });

    it("fires for unloaded start", () => {
      const stages = [makeStage({ firearm_condition: "Unloaded, hammer down" }), ...makeStages(5)];
      const result = computeBriefHooks(stages, makeDashboard(), null);
      expect(result.some((h) => h.tag === "constraint-stages")).toBe(true);
    });

    it("includes count in signal", () => {
      const stages = [
        makeStage({ id: 1, stage_number: 1, procedure: "Weak hand only" }),
        makeStage({ id: 2, stage_number: 2, procedure: "Strong hand only" }),
        ...makeStages(4),
      ];
      const result = computeBriefHooks(stages, makeDashboard(), null);
      const hook = result.find((h) => h.tag === "constraint-stages");
      expect(hook?.signal).toContain("2 constrained stages");
    });

    it("does not fire when no constrained stages", () => {
      const result = computeBriefHooks(makeStages(6), makeDashboard(), null);
      expect(result.some((h) => h.tag === "constraint-stages")).toBe(false);
    });
  });

  describe("penalty-rate hook", () => {
    it("fires when penalty rate >= 0.05 and no constraint stages and enough history", () => {
      const dashboard = makeDashboard({
        stats: { ...makeDashboard().stats, avgPenaltyRate: 0.06 },
      });
      const result = computeBriefHooks(makeStages(6), dashboard, null);
      expect(result.some((h) => h.tag === "penalty-rate")).toBe(true);
    });

    it("does not fire when penalty rate < 0.05", () => {
      const dashboard = makeDashboard({
        stats: { ...makeDashboard().stats, avgPenaltyRate: 0.03 },
      });
      const result = computeBriefHooks(makeStages(6), dashboard, null);
      expect(result.some((h) => h.tag === "penalty-rate")).toBe(false);
    });

    it("does not fire when constraint-stages hook already covers context", () => {
      const dashboard = makeDashboard({
        stats: { ...makeDashboard().stats, avgPenaltyRate: 0.1 },
      });
      const stages = [makeStage({ procedure: "Weak hand only" }), ...makeStages(5)];
      const result = computeBriefHooks(stages, dashboard, null);
      expect(result.some((h) => h.tag === "penalty-rate")).toBe(false);
    });

    it("does not fire when fewer than MIN_MATCHES", () => {
      const dashboard = makeDashboard({
        matches: Array.from({ length: 3 }, (_, i) => ({
          ct: "22", matchId: String(i), name: `M${i}`, date: null, venue: null, level: "l2",
          region: null, division: null, competitorId: 1, competitorsInDivision: null,
          stageCount: 5, avgHF: 3.5, matchPct: 80, totalA: 50, totalC: 5, totalD: 2,
          totalMiss: 0, totalNoShoots: 0, dq: false,
        })),
        stats: { ...makeDashboard().stats, avgPenaltyRate: 0.1 },
      });
      const result = computeBriefHooks(makeStages(6), dashboard, null);
      expect(result.some((h) => h.tag === "penalty-rate")).toBe(false);
    });
  });

  describe("long-stage-consistency hook", () => {
    it("fires for long stage with high CV", () => {
      const stages = [makeStage({ course_display: "Long" }), ...makeStages(5)];
      const dashboard = makeDashboard({
        stats: { ...makeDashboard().stats, consistencyCV: 0.25 },
      });
      const result = computeBriefHooks(stages, dashboard, null);
      expect(result.some((h) => h.tag === "long-stage-consistency")).toBe(true);
    });

    it("does not fire when no long stages", () => {
      const result = computeBriefHooks(makeStages(6), makeDashboard(), null);
      expect(result.some((h) => h.tag === "long-stage-consistency")).toBe(false);
    });

    it("does not fire when CV is below threshold", () => {
      const stages = [makeStage({ course_display: "Long" }), ...makeStages(5)];
      const dashboard = makeDashboard({
        stats: { ...makeDashboard().stats, consistencyCV: 0.15 },
      });
      const result = computeBriefHooks(stages, dashboard, null);
      expect(result.some((h) => h.tag === "long-stage-consistency")).toBe(false);
    });
  });

  describe("squad timing hooks", () => {
    it("fires squad-timing for late squad position", () => {
      const squad = makeSquadContext({ position: 3, squadSize: 4, startingStages: [] });
      const result = computeBriefHooks(makeStages(6), makeDashboard(), squad);
      expect(result.some((h) => h.tag === "squad-timing")).toBe(true);
    });

    it("squad-timing signal mentions declining trend when present", () => {
      const squad = makeSquadContext({ position: 4, squadSize: 4, startingStages: [] });
      const dashboard = makeDashboard({
        stats: { ...makeDashboard().stats, hfTrendSlope: -0.01 },
      });
      const result = computeBriefHooks(makeStages(6), dashboard, squad);
      const hook = result.find((h) => h.tag === "squad-timing");
      expect(hook?.signal).toContain("declining");
    });

    it("fires squad-starter for early position that starts stages", () => {
      const squad = makeSquadContext({ position: 1, squadSize: 4, startingStages: [1, 5] });
      const result = computeBriefHooks(makeStages(6), makeDashboard(), squad);
      expect(result.some((h) => h.tag === "squad-starter")).toBe(true);
    });

    it("squad-starter not fired when early position but no starting stages", () => {
      const squad = makeSquadContext({ position: 1, squadSize: 4, startingStages: [] });
      const result = computeBriefHooks(makeStages(6), makeDashboard(), squad);
      expect(result.some((h) => h.tag === "squad-starter")).toBe(false);
    });

    it("does not fire squad hooks when squadContext is null", () => {
      const result = computeBriefHooks(makeStages(6), makeDashboard(), null);
      expect(result.some((h) => h.tag === "squad-timing" || h.tag === "squad-starter")).toBe(false);
    });
  });

  it("caps output at MAX_BRIEF_HOOKS", () => {
    const stages = [
      makeStage({ procedure: "Weak hand only" }),
      makeStage({ id: 2, stage_number: 2, procedure: "Strong hand only" }),
      makeStage({ id: 3, stage_number: 3, course_display: "Long" }),
      ...makeStages(3),
    ];
    const dashboard = makeDashboard({
      stats: { ...makeDashboard().stats, consistencyCV: 0.3, avgPenaltyRate: 0.1, hfTrendSlope: -0.01 },
    });
    dashboard.matches[0] = { ...dashboard.matches[0], dq: true };
    const squad = makeSquadContext({ position: 4, squadSize: 4, startingStages: [] });
    const result = computeBriefHooks(stages, dashboard, squad);
    expect(result.length).toBeLessThanOrEqual(MAX_BRIEF_HOOKS);
  });

  it("returns hooks sorted by priority descending", () => {
    const stages = [makeStage({ procedure: "Weak hand only" }), ...makeStages(5)];
    const dashboard = makeDashboard({
      stats: { ...makeDashboard().stats, consistencyCV: 0.3 },
    });
    // Add a long stage too
    stages.push(makeStage({ id: 7, stage_number: 7, course_display: "Long" }));
    const result = computeBriefHooks(stages, dashboard, null);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].priority).toBeGreaterThanOrEqual(result[i].priority);
    }
  });
});
