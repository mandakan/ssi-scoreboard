// Compact name helpers for mobile-first table cells. The SSI API returns full
// names like "John Smith" or "Maria del Carmen Lopez". Three compaction levels:
//
//   rollCallName — keep the first name, abbreviate the last name. Mirrors how
//                  competitors are called during roll call and shooting order.
//                  "Mathias Andersson" -> "Mathias A."
//                  "Maria del Carmen Lopez" -> "Maria L."
//   compactName  — abbreviate every token except the last to a single letter.
//                  "John Smith" -> "J. Smith"
//                  "Maria del Carmen Lopez" -> "M. D. C. Lopez"
//   initialsName — collapse to first + last initial, no separator.
//                  "John Smith" -> "JS"
//                  "Maria del Carmen Lopez" -> "ML"
//
// Pick `rollCallName` as the default — it matches IPSC range terminology.
// Use `compactName` when surname recognition is the priority, or
// `initialsName` when only ~2 chars fit.

function tokenize(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
}

/**
 * Keeps the first name and abbreviates the last name to a single uppercase
 * letter followed by ".". Mirrors IPSC roll-call / shooting-order naming.
 *
 *   "Mathias Andersson"      -> "Mathias A."
 *   "Maria del Carmen Lopez" -> "Maria L."
 *   "Cher"                   -> "Cher"
 *   ""                       -> ""
 */
export function rollCallName(name: string | null | undefined): string {
  if (!name) return "";
  const tokens = tokenize(name);
  if (tokens.length === 0) return "";
  if (tokens.length === 1) return tokens[0]!;
  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;
  return `${first} ${last[0]!.toUpperCase()}.`;
}

/**
 * Abbreviates all but the last name token to a single uppercase letter
 * followed by ".".
 *
 *   "John Smith"             -> "J. Smith"
 *   "Maria del Carmen Lopez" -> "M. D. C. Lopez"
 *   "Cher"                   -> "Cher"
 *   ""                       -> ""
 */
export function compactName(name: string | null | undefined): string {
  if (!name) return "";
  const tokens = tokenize(name);
  if (tokens.length <= 1) return tokens[0] ?? "";

  const last = tokens[tokens.length - 1];
  const initials = tokens
    .slice(0, -1)
    .map((t) => `${t[0]!.toUpperCase()}.`)
    .join(" ");
  return `${initials} ${last}`;
}

/**
 * Collapses a name to first-token + last-token initials, uppercase, no
 * separator.
 *
 *   "John Smith"             -> "JS"
 *   "Maria del Carmen Lopez" -> "ML"
 *   "Cher"                   -> "C"
 *   ""                       -> ""
 */
export function initialsName(name: string | null | undefined): string {
  if (!name) return "";
  const tokens = tokenize(name);
  if (tokens.length === 0) return "";
  if (tokens.length === 1) return tokens[0]![0]!.toUpperCase();
  const first = tokens[0]![0]!.toUpperCase();
  const last = tokens[tokens.length - 1]![0]!.toUpperCase();
  return `${first}${last}`;
}
