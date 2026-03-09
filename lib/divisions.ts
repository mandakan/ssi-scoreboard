/**
 * Formats a competitor's division display name, appending "Major" or "Minor"
 * when the power factor data is available.
 *
 * The API provides a display string (e.g. "Open", "Standard") and
 * `shoots_handgun_major` (boolean). In Handgun divisions like Open and Standard
 * where both power factors compete, the suffix is meaningful context.
 *
 * Single-power-factor divisions (Production, Production Optics) and all
 * non-Handgun disciplines (Rifle, Shotgun, PCC, etc.) never receive the suffix
 * because `shoots_handgun_major` is always false for non-Handgun competitors.
 */

const SINGLE_POWER_FACTOR_DIVISIONS = new Set(["Production", "Production Optics"]);

export function formatDivisionDisplay(
  divDisplay: string | null | undefined,
  shootsMajor: boolean | null | undefined,
): string | null {
  if (!divDisplay) return null;
  if (shootsMajor == null) return divDisplay;
  if (SINGLE_POWER_FACTOR_DIVISIONS.has(divDisplay)) return divDisplay;
  return `${divDisplay} ${shootsMajor ? "Major" : "Minor"}`;
}

/**
 * Extract and format a competitor's division from a raw GraphQL competitor
 * node, across all IPSC disciplines.
 *
 * `get_division_display` is a universal field available on IpscCompetitorNode
 * that returns the correct division name regardless of discipline (Handgun,
 * Rifle, Shotgun, PCC, Mini Rifle, etc.). The field was introduced in cache
 * schema v8 — the older `get_handgun_div_display` / `handgun_div` fields are
 * kept as a fallback for entries cached before the schema bump.
 *
 * The Major/Minor power-factor suffix is only ever applied for Handgun
 * competitors — for all other disciplines `shoots_handgun_major` is false and
 * no suffix is added.
 */
export function extractDivision(c: {
  get_division_display?: string | null;
  get_handgun_div_display?: string | null;
  handgun_div?: string | null;
  shoots_handgun_major?: boolean | null;
}): string | null {
  return formatDivisionDisplay(
    c.get_division_display || c.get_handgun_div_display || c.handgun_div,
    c.shoots_handgun_major,
  );
}
