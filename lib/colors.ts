// Deterministic competitor color palette — index-stable as long as selectedIds order is stable.
//
// Uses the Okabe-Ito 8-color palette (https://jfly.uni-koeln.de/color/) which is
// peer-reviewed safe for the two most common color-vision deficiencies (deuteranopia,
// protanopia ~8% of men). Black is replaced with a dark slate so the first colors
// remain readable on both light and dark backgrounds.
//
// MAX_COMPETITORS is 12 but the palette has 8 entries — indices 9-12 cycle back to
// the start. Charts that need to disambiguate beyond 8 series should pair color with
// shape via SHAPE_PALETTE.
const PALETTE = [
  "#0072B2", // Okabe-Ito blue
  "#D55E00", // Okabe-Ito vermillion
  "#009E73", // Okabe-Ito bluish green
  "#CC79A7", // Okabe-Ito reddish purple
  "#F0E442", // Okabe-Ito yellow
  "#56B4E9", // Okabe-Ito sky blue
  "#E69F00", // Okabe-Ito orange
  "#525252", // dark neutral (Okabe-Ito black, lightened for dark-mode legibility)
];

// Recharts marker shapes — pair with PALETTE so series with cycled colors (indices 9-12)
// remain distinguishable by marker shape. Keep this length aligned with PALETTE.
const SHAPE_PALETTE = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "cross",
  "star",
  "wye",
  "circle", // last index falls back to circle; rarely reached at 8 distinct colors
] as const;

export type CompetitorShape = (typeof SHAPE_PALETTE)[number];

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

/**
 * Returns a map of competitor_id → recharts marker shape.
 * Shapes are assigned by position in the `ids` array, cycling through SHAPE_PALETTE.
 * Use alongside buildColorMap so series remain distinguishable when color cycles.
 */
export function buildShapeMap(ids: number[]): Record<number, CompetitorShape> {
  const map: Record<number, CompetitorShape> = {};
  ids.forEach((id, i) => {
    map[id] = SHAPE_PALETTE[i % SHAPE_PALETTE.length];
  });
  return map;
}

export { PALETTE, SHAPE_PALETTE };
