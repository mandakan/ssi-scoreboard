// Autocomplete handlers for slash command options.
// Returns up to 25 choices as the user types, encoding resolved IDs in the value
// so command handlers can skip the search step entirely.
//
// Value encoding conventions:
//   Event commands:  "22:12345"    (ct:id)
//   Shooter commands: "sid:98765"  (shooter ID)
// Raw typed text that doesn't match these patterns triggers the existing search fallback.

import type { ScoreboardClient } from "../scoreboard-client";

/** Commands whose query option searches for events. */
const EVENT_COMMANDS = new Set(["match", "watch", "summary", "leaderboard", "remind"]);

/** Commands whose name option searches for shooters. */
const SHOOTER_COMMANDS = new Set(["shooter", "link"]);

export async function handleAutocomplete(
  client: ScoreboardClient,
  commandName: string,
  focusedValue: string,
): Promise<Array<{ name: string; value: string }>> {
  const query = focusedValue.trim();
  if (query.length < 2) return [];

  if (EVENT_COMMANDS.has(commandName)) {
    const events = await client.searchEvents(query);
    return events.slice(0, 25).map((e) => ({
      name: truncate(`${e.name} (${e.date})`, 100),
      value: `${e.content_type}:${e.id}`,
    }));
  }

  if (SHOOTER_COMMANDS.has(commandName)) {
    const shooters = await client.searchShooters(query);
    return shooters.slice(0, 25).map((s) => ({
      name: truncate(`${s.name}${s.club ? ` (${s.club})` : ""}`, 100),
      value: `sid:${s.shooterId}`,
    }));
  }

  return [];
}

// --- Parsing helpers (used by command handlers to detect pre-resolved values) ---

/** Parse an autocomplete-resolved event ref like "22:12345", or null for raw queries. */
export function parseEventRef(value: string): { ct: number; id: number } | null {
  const m = /^(\d+):(\d+)$/.exec(value);
  if (!m) return null;
  return { ct: Number(m[1]), id: Number(m[2]) };
}

/** Parse an autocomplete-resolved shooter ID like "sid:98765", or null for raw queries. */
export function parseShooterRef(value: string): number | null {
  const m = /^sid:(\d+)$/.exec(value);
  if (!m) return null;
  return Number(m[1]);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "\u2026";
}
