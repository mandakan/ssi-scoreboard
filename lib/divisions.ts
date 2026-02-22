/**
 * Formats a competitor's division display name, appending "Major" or "Minor"
 * when the power factor data is available.
 *
 * The API provides `get_handgun_div_display` (e.g. "Open", "Standard") and
 * `shoots_handgun_major` (boolean). In divisions like Open and Standard where
 * both power factors compete, the suffix is meaningful context.
 *
 * Production and Production Optics are single-power-factor divisions — no suffix.
 */

const SINGLE_POWER_FACTOR_DIVISIONS = new Set(["Production", "Production Optics"]);

export function formatDivisionDisplay(
  divDisplay: string | null | undefined,
  shootsMajor: boolean | null | undefined
): string | null {
  if (!divDisplay) return null;
  if (shootsMajor == null) return divDisplay;
  if (SINGLE_POWER_FACTOR_DIVISIONS.has(divDisplay)) return divDisplay;
  return `${divDisplay} ${shootsMajor ? "Major" : "Minor"}`;
}
