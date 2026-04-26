// Compact name helpers for mobile-first table cells. The SSI API returns full
// names like "John Smith" or "Maria del Carmen Lopez". Two compaction levels:
//
//   compactName  — abbreviate every token except the last to a single letter.
//                  "John Smith" -> "J. Smith"
//                  "Maria del Carmen Lopez" -> "M. D. C. Lopez"
//   initialsName — collapse to first + last initial, no separator.
//                  "John Smith" -> "JS"
//                  "Maria del Carmen Lopez" -> "ML"
//
// Both preserve the surname's information density. Pick `compactName` when
// surname recognition is the goal; pick `initialsName` when only ~2 chars fit.

function tokenize(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
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
