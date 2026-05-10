// Match visibility classifier.
//
// SSI's IpscMatchNode.visibility is a short code drawn from a fixed enum:
//   pub  Public, searchable and details/names for all
//   lim  Limited, not searchable and details/names for all
//   res  Restricted, searchable but details/names only participants
//   csd  Closed, not searchable and details/names only participants
//   clb  Club members only registration, searchable, details/names only participants
//
// Our scoreboard only ever sees a non-pub match if the bot account
// (`admin@urdr.dev`) has been invited as Staff/Admin. Issue #426 introduces a
// three-class projection so the UI can surface that consent state:
//   - public:               pub
//   - unlisted:             lim          (full data on SSI but not searchable)
//   - organizer-published:  res|csd|clb  (SSI hides names from non-participants)
// The badge is rendered only for organizer-published.

import type { VisibilityClass } from "@/lib/types";

const CLASS_BY_RAW: Readonly<Record<string, VisibilityClass>> = {
  pub: "public",
  lim: "unlisted",
  res: "organizer-published",
  csd: "organizer-published",
  clb: "organizer-published",
};

export function classifyVisibility(rawCode: string | null | undefined): VisibilityClass {
  if (!rawCode) return "organizer-published";
  return CLASS_BY_RAW[rawCode] ?? "organizer-published";
}

/**
 * True only if the given cached match data (raw GraphQL response or shaped
 * MatchResponse) classifies as a fully public match. Used to keep
 * non-public matches (unlisted / organizer-published) out of any "popular"
 * or "trending" surface, matching the searchEvents publication boundary.
 *
 * Defensive on shape: missing or unrecognized visibility codes are treated
 * as non-public via classifyVisibility's fallback. The data field can be
 * either the raw event node (`{ visibility: "pub" }`) or the shaped
 * MatchResponse (`{ visibility: { class: "public" } }`).
 */
export function isPublicMatchData(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const event = (data as { event?: unknown }).event;
  if (event && typeof event === "object") {
    const raw = (event as { visibility?: unknown }).visibility;
    if (typeof raw === "string") {
      return classifyVisibility(raw) === "public";
    }
  }
  const shaped = (data as { visibility?: unknown }).visibility;
  if (shaped && typeof shaped === "object") {
    const cls = (shaped as { class?: unknown }).class;
    return cls === "public";
  }
  return false;
}
