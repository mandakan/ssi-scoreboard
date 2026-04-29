// Per-user comparison-table view preferences.
// State stored in localStorage as a JSON blob under key "ssi-table-view".

export type TableViewGroup =
  | "ranking"
  | "hits"
  | "coaching"
  | "stageInfo"
  | "conditions";

export type TableViewPreset = "courtside" | "standard" | "deep" | "custom";

export interface TableViewPrefs {
  preset: TableViewPreset;
  groups: Record<TableViewGroup, boolean>;
}

export const TABLE_VIEW_GROUPS: TableViewGroup[] = [
  "ranking",
  "hits",
  "coaching",
  "stageInfo",
  "conditions",
];

export const GROUP_LABELS: Record<TableViewGroup, string> = {
  ranking: "Ranking",
  hits: "Hits & penalties",
  coaching: "Coaching analysis",
  stageInfo: "Stage details",
  conditions: "Weather & time",
};

export const GROUP_DESCRIPTIONS: Record<TableViewGroup, string> = {
  ranking: "Rank badges, group/division %, field percentile.",
  hits: "Hit-zone bars (A/C/D/M) and penalty totals.",
  coaching: "Run classification, archetype, consistency, loss breakdown.",
  stageInfo: "Difficulty, archetype icons, constraints, round counts, field median.",
  conditions: "Per-stage weather and time-of-day badges.",
};

export const PRESET_LABELS: Record<Exclude<TableViewPreset, "custom">, string> = {
  courtside: "Courtside",
  standard: "Standard",
  deep: "Deep dive",
};

export const PRESET_DESCRIPTIONS: Record<Exclude<TableViewPreset, "custom">, string> = {
  courtside: "Just the essentials — HF, points/time, rank.",
  standard: "Adds hits and stage details. The default.",
  deep: "Everything turned on, including coaching analysis.",
};

export const PRESETS: Record<
  Exclude<TableViewPreset, "custom">,
  Record<TableViewGroup, boolean>
> = {
  courtside: {
    ranking: true,
    hits: false,
    coaching: false,
    stageInfo: false,
    conditions: false,
  },
  standard: {
    ranking: true,
    hits: true,
    coaching: false,
    stageInfo: true,
    conditions: false,
  },
  deep: {
    ranking: true,
    hits: true,
    coaching: true,
    stageInfo: true,
    conditions: true,
  },
};

export const DEFAULT_PREFS: TableViewPrefs = {
  preset: "standard",
  groups: { ...PRESETS.standard },
};

const STORAGE_KEY = "ssi-table-view";

function isValidGroups(g: unknown): g is Record<TableViewGroup, boolean> {
  if (!g || typeof g !== "object") return false;
  for (const key of TABLE_VIEW_GROUPS) {
    if (typeof (g as Record<string, unknown>)[key] !== "boolean") return false;
  }
  return true;
}

export function readPrefs(): TableViewPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as { preset?: unknown; groups?: unknown };
    const preset = (
      parsed.preset === "courtside" ||
      parsed.preset === "standard" ||
      parsed.preset === "deep" ||
      parsed.preset === "custom"
        ? parsed.preset
        : "standard"
    ) as TableViewPreset;
    const groups = isValidGroups(parsed.groups)
      ? parsed.groups
      : { ...PRESETS.standard };
    return { preset, groups };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writePrefs(prefs: TableViewPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent("ssi-table-view-change"));
  } catch {
    /* ignore storage errors */
  }
}

export function applyPreset(preset: Exclude<TableViewPreset, "custom">): TableViewPrefs {
  return { preset, groups: { ...PRESETS[preset] } };
}

export function toggleGroup(
  prefs: TableViewPrefs,
  group: TableViewGroup,
): TableViewPrefs {
  const groups = { ...prefs.groups, [group]: !prefs.groups[group] };
  return { preset: "custom", groups };
}
