import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  collectSyncPayload,
  importSyncPayload,
  getSyncStats,
  isValidSyncPayload,
} from "@/lib/sync";
import type { SyncPayload } from "@/lib/types";

// Mock localStorage
const store = new Map<string, string>();
const localStorageMock: Storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (index: number) => [...store.keys()][index] ?? null,
};

Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: localStorageMock,
    dispatchEvent: vi.fn(),
    location: { origin: "http://localhost:3000" },
  },
  writable: true,
});

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

function buildPayload(overrides: Partial<SyncPayload> = {}): SyncPayload {
  return {
    version: 1,
    identity: { shooterId: 42, name: "Test User", license: "ABC123" },
    tracked: [
      { shooterId: 1, name: "Alice", club: "Club A", division: "Production" },
      { shooterId: 2, name: "Bob", club: null, division: "Standard" },
    ],
    recentCompetitions: [
      {
        ct: "22",
        id: "100",
        name: "Test Match",
        venue: "Range",
        date: "2026-01-01",
        scoring_completed: 100,
        last_visited: 1700000000000,
      },
    ],
    competitorSelections: { "ssi_competitors_22_100": [10, 20, 30] },
    modeOverrides: { "ssi_mode_22_100": "coaching" },
    eventFilters: { level: "l2plus", firearms: "hg", country: "SWE" },
    ...overrides,
  };
}

describe("collectSyncPayload", () => {
  beforeEach(() => store.clear());

  it("returns empty payload when localStorage is empty", () => {
    const payload = collectSyncPayload();
    expect(payload).not.toBeNull();
    expect(payload!.version).toBe(1);
    expect(payload!.identity).toBeNull();
    expect(payload!.tracked).toEqual([]);
    expect(payload!.recentCompetitions).toEqual([]);
    expect(payload!.competitorSelections).toEqual({});
    expect(payload!.modeOverrides).toEqual({});
    expect(payload!.eventFilters).toBeNull();
  });

  it("collects all relevant keys", () => {
    store.set("ssi-my-shooter", JSON.stringify({ shooterId: 42, name: "Me", license: null }));
    store.set("ssi-tracked-shooters", JSON.stringify([{ shooterId: 1, name: "A", club: null, division: null }]));
    store.set("ssi_recent_competitions", JSON.stringify([{ ct: "22", id: "1", name: "M", venue: null, date: null, scoring_completed: 50, last_visited: 1 }]));
    store.set("ssi_competitors_22_1", JSON.stringify([10, 20]));
    store.set("ssi_mode_22_1", "live");
    store.set("ssi_event_filters", JSON.stringify({ level: "all", firearms: "all", country: "all" }));
    // Non-sync keys should be ignored
    store.set("whats-new-seen-id", "2026-01-01");
    store.set("pwa-install-dismissed", "1");

    const payload = collectSyncPayload()!;
    expect(payload.identity).toEqual({ shooterId: 42, name: "Me", license: null });
    expect(payload.tracked).toHaveLength(1);
    expect(payload.recentCompetitions).toHaveLength(1);
    expect(payload.competitorSelections).toEqual({ "ssi_competitors_22_1": [10, 20] });
    expect(payload.modeOverrides).toEqual({ "ssi_mode_22_1": "live" });
    expect(payload.eventFilters).toEqual({ level: "all", firearms: "all", country: "all" });
  });
});

describe("importSyncPayload", () => {
  beforeEach(() => store.clear());

  it("writes all payload data to localStorage", () => {
    const payload = buildPayload();
    importSyncPayload(payload);

    expect(JSON.parse(store.get("ssi-my-shooter")!)).toEqual(payload.identity);
    expect(JSON.parse(store.get("ssi-tracked-shooters")!)).toEqual(payload.tracked);
    expect(JSON.parse(store.get("ssi_recent_competitions")!)).toEqual(payload.recentCompetitions);
    expect(JSON.parse(store.get("ssi_competitors_22_100")!)).toEqual([10, 20, 30]);
    expect(store.get("ssi_mode_22_100")).toBe("coaching");
    expect(JSON.parse(store.get("ssi_event_filters")!)).toEqual(payload.eventFilters);
  });

  it("clears identity when null", () => {
    store.set("ssi-my-shooter", JSON.stringify({ shooterId: 1, name: "Old", license: null }));
    importSyncPayload(buildPayload({ identity: null }));
    expect(store.has("ssi-my-shooter")).toBe(false);
  });

  it("clears old selections before importing new ones", () => {
    store.set("ssi_competitors_22_999", JSON.stringify([1, 2]));
    store.set("ssi_mode_22_999", "live");
    importSyncPayload(buildPayload());
    // Old keys should be gone
    expect(store.has("ssi_competitors_22_999")).toBe(false);
    expect(store.has("ssi_mode_22_999")).toBe(false);
    // New keys should be present
    expect(store.has("ssi_competitors_22_100")).toBe(true);
  });

  it("dispatches all change events", () => {
    const spy = vi.fn();
    (globalThis.window as unknown as { dispatchEvent: typeof spy }).dispatchEvent = spy;

    importSyncPayload(buildPayload());

    const eventNames = spy.mock.calls.map((c) => (c[0] as Event).type);
    expect(eventNames).toContain("ssi:identity_changed");
    expect(eventNames).toContain("ssi:tracked_changed");
    expect(eventNames).toContain("ssi:recents_changed");
    expect(eventNames).toContain("ssi:selection_changed");
    expect(eventNames).toContain("ssi:mode_changed");
  });
});

describe("getSyncStats", () => {
  it("returns correct stats", () => {
    const stats = getSyncStats(buildPayload());
    expect(stats).toEqual({
      hasIdentity: true,
      trackedCount: 2,
      recentCount: 1,
      selectionsCount: 1,
    });
  });

  it("handles empty payload", () => {
    const stats = getSyncStats(buildPayload({
      identity: null,
      tracked: [],
      recentCompetitions: [],
      competitorSelections: {},
    }));
    expect(stats.hasIdentity).toBe(false);
    expect(stats.trackedCount).toBe(0);
    expect(stats.recentCount).toBe(0);
    expect(stats.selectionsCount).toBe(0);
  });
});

describe("isValidSyncPayload", () => {
  it("accepts valid payload", () => {
    expect(isValidSyncPayload(buildPayload())).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isValidSyncPayload(null)).toBe(false);
    expect(isValidSyncPayload("string")).toBe(false);
    expect(isValidSyncPayload(42)).toBe(false);
  });

  it("rejects wrong version", () => {
    expect(isValidSyncPayload({ ...buildPayload(), version: 2 })).toBe(false);
  });

  it("rejects missing required fields", () => {
    const payload = buildPayload();
    const noTracked = { ...payload, tracked: undefined };
    expect(isValidSyncPayload(noTracked)).toBe(false);
  });
});
