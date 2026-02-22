// Deterministic competitor color palette — index-stable as long as selectedIds order is stable.

const PALETTE = [
  "#3b82f6", // blue-500
  "#ef4444", // red-500
  "#22c55e", // green-500
  "#f59e0b", // amber-500
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
  "#14b8a6", // teal-500
  "#f97316", // orange-500
  "#6366f1", // indigo-500
  "#84cc16", // lime-500
];

/**
 * Returns a map of competitor_id → hex color string.
 * Colors are assigned by position in the `ids` array, cycling through the palette.
 */
export function buildColorMap(ids: number[]): Record<number, string> {
  const map: Record<number, string> = {};
  ids.forEach((id, i) => {
    map[id] = PALETTE[i % PALETTE.length];
  });
  return map;
}

export { PALETTE };
