/**
 * Fit a name into a 94px column: "Mathias Axell" -> "Mathias A."
 *
 * When the first token is already an initial -- plenty of competitors
 * register as "A. Lindstrom" -- abbreviating the surname too would leave
 * "A. L.", dropping the only part that identifies them. Keep the surname
 * whole in that case and let CSS truncate if it must.
 */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  const first = parts[0];
  const last = parts[parts.length - 1];
  const firstIsInitial = first.replace(".", "").length <= 1;
  return firstIsInitial ? `${first} ${last}` : `${first} ${last.charAt(0)}.`;
}

export function selectionSummary(names: string[], maxNames = 2): string {
  if (names.length === 0) return "";
  const head = names.slice(0, maxNames).map(shortName).join(", ");
  const rest = names.length - maxNames;
  return rest > 0 ? `${head} +${rest}` : head;
}
