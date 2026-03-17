// Handler for /remind — personal DM reminders for specific matches.
//
// Users pick a match and get DM reminders for key milestones:
// - Registration opening
// - Squadding opening
// - Match day
//
// Config is stored per-user per-guild in KV at g:{guildId}:remind:{userId}.
// The cron trigger scans these keys daily and sends DMs for triggered milestones.

import type { APIEmbed } from "discord-api-types/v10";
import type { ScoreboardClient } from "../scoreboard-client";
import type { EventSearchResult, UpcomingMatch } from "../types";
import { parseEventRef } from "./autocomplete";

/** A single match the user wants reminders for. */
export interface PersonalReminder {
  matchCt: number;
  matchId: number;
  matchName: string;
  matchDate: string | null;
  registrationStarts: string | null;
  squaddingStarts: string | null;
  createdAt: string;
}

/** Per-user reminder config stored in KV. */
export interface PersonalReminderConfig {
  matches: PersonalReminder[];
  /**
   * Track which milestones have been notified to prevent duplicates.
   * Map of "ct:matchId" → array of trigger types
   * ("registration-open" | "squadding-open" | "match-day-eve" | "match-day").
   */
  notifiedEvents: Record<string, string[]>;
}

const MAX_REMINDERS = 20;

/** KV key for a user's personal reminders in a guild. */
export function personalReminderKey(guildId: string, userId: string): string {
  return `g:${guildId}:remind:${userId}`;
}

export async function handleRemind(
  client: ScoreboardClient,
  kv: KVNamespace,
  baseUrl: string,
  guildId: string,
  userId: string,
  action: string | undefined,
  query: string | undefined,
  days?: number,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  switch (action) {
    case "list":
      return handleList(kv, baseUrl, guildId, userId);
    case "cancel":
      return handleCancel(kv, guildId, userId, query);
    case "upcoming":
      return handleUpcoming(client, kv, baseUrl, guildId, userId, days ?? 8);
    case "set":
    default:
      return handleSet(client, kv, baseUrl, guildId, userId, query);
  }
}

async function handleSet(
  client: ScoreboardClient,
  kv: KVNamespace,
  baseUrl: string,
  guildId: string,
  userId: string,
  query: string | undefined,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  if (!query) {
    return {
      content: "Please provide a match name to search for.\nUsage: `/remind set <match name>`",
      embeds: [],
    };
  }

  // Load existing config
  const key = personalReminderKey(guildId, userId);
  const raw = await kv.get(key);
  const config: PersonalReminderConfig = raw
    ? JSON.parse(raw)
    : { matches: [], notifiedEvents: {} };

  if (config.matches.length >= MAX_REMINDERS) {
    return {
      content: `You already have ${MAX_REMINDERS} active reminders. Use \`/remind cancel\` to remove one first.`,
      embeds: [],
    };
  }

  // Resolve the event — either from autocomplete or search
  let event: EventSearchResult | null = null;
  const ref = parseEventRef(query);
  if (ref) {
    // Pre-resolved from autocomplete — search to get full event data
    const events = await client.searchEvents("");
    // searchEvents with empty query won't help, use getMatch instead
    try {
      const match = await client.getMatch(ref.ct, ref.id);
      event = {
        id: ref.id,
        content_type: ref.ct,
        name: match.name,
        venue: match.venue,
        date: match.date ?? "",
        ends: null,
        level: match.level ?? "",
        status: "",
        region: "",
        discipline: "",
        registration_status: "",
        registration_starts: null,
        registration_closes: null,
        is_registration_possible: false,
        squadding_starts: match.squadding_starts,
        squadding_closes: null,
        is_squadding_possible: match.is_squadding_possible,
        max_competitors: null,
      };
    } catch {
      return { content: "Could not load that match. Please try again.", embeds: [] };
    }
  } else {
    // Search by name
    const events = await client.searchEvents(query);
    if (events.length === 0) {
      return {
        content: `No matches found for "${query}". Try a different search term.`,
        embeds: [],
      };
    }
    event = events[0];
  }

  // Check for duplicate
  const matchRef = `${event.content_type}:${event.id}`;
  const alreadyTracked = config.matches.some(
    (m) => m.matchCt === event!.content_type && m.matchId === event!.id,
  );
  if (alreadyTracked) {
    return {
      content: `You already have a reminder set for **${event.name}**.`,
      embeds: [],
    };
  }

  // Add the reminder
  const reminder: PersonalReminder = {
    matchCt: event.content_type,
    matchId: event.id,
    matchName: event.name,
    matchDate: event.date || null,
    registrationStarts: event.registration_starts,
    squaddingStarts: event.squadding_starts,
    createdAt: new Date().toISOString(),
  };

  config.matches.push(reminder);
  await kv.put(key, JSON.stringify(config));

  // Build confirmation embed
  const matchUrl = `${baseUrl}/match/${event.content_type}/${event.id}`;
  const milestones: string[] = [];

  if (reminder.registrationStarts) {
    const regDate = reminder.registrationStarts.slice(0, 10);
    const isPast = regDate <= new Date().toISOString().slice(0, 10);
    if (isPast) {
      milestones.push("~~Registration opening~~ (already open)");
    } else {
      milestones.push(`Registration opening: **${formatDate(reminder.registrationStarts)}**`);
    }
  }

  if (reminder.squaddingStarts) {
    const sqDate = reminder.squaddingStarts.slice(0, 10);
    const isPast = sqDate <= new Date().toISOString().slice(0, 10);
    if (isPast) {
      milestones.push("~~Squadding opening~~ (already open)");
    } else {
      milestones.push(`Squadding opening: **${formatDate(reminder.squaddingStarts)}**`);
    }
  }

  if (reminder.matchDate) {
    milestones.push(`Day before match + match day: **${formatDate(reminder.matchDate)}**`);
  }

  const description = milestones.length > 0
    ? `I'll DM you when these milestones arrive:\n${milestones.map((m) => `\u2022 ${m}`).join("\n")}\n\n[View on Scoreboard](${matchUrl})`
    : `No milestone dates available yet \u2014 I'll check daily and DM you if dates appear.\n\n[View on Scoreboard](${matchUrl})`;

  const embed: APIEmbed = {
    title: `Reminder set: ${event.name}`,
    color: 0x22c55e, // green
    description,
    footer: {
      text: `${config.matches.length}/${MAX_REMINDERS} reminders active. Make sure your DMs are open!`,
    },
  };

  return { content: "", embeds: [embed] };
}

async function handleList(
  kv: KVNamespace,
  baseUrl: string,
  guildId: string,
  userId: string,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  const key = personalReminderKey(guildId, userId);
  const raw = await kv.get(key);
  if (!raw) {
    return {
      content: "You don't have any active reminders.\nUse `/remind set <match name>` to set one up.",
      embeds: [],
    };
  }

  const config: PersonalReminderConfig = JSON.parse(raw);
  if (config.matches.length === 0) {
    return {
      content: "You don't have any active reminders.\nUse `/remind set <match name>` to set one up.",
      embeds: [],
    };
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const notified = config.notifiedEvents;

  const fields: NonNullable<APIEmbed["fields"]> = config.matches.map((m) => {
    const matchRef = `${m.matchCt}:${m.matchId}`;
    const matchUrl = `${baseUrl}/match/${m.matchCt}/${m.matchId}`;
    const firedTriggers = notified[matchRef] ?? [];
    const lines: string[] = [];

    if (m.matchDate) lines.push(`Match: ${formatDate(m.matchDate)}`);
    if (m.registrationStarts) {
      const done = firedTriggers.includes("registration-open") ||
        m.registrationStarts.slice(0, 10) <= todayStr;
      lines.push(done ? "~~Registration opening~~" : `Reg opens: ${formatDate(m.registrationStarts)}`);
    }
    if (m.squaddingStarts) {
      const done = firedTriggers.includes("squadding-open") ||
        m.squaddingStarts.slice(0, 10) <= todayStr;
      lines.push(done ? "~~Squadding opening~~" : `Squadding opens: ${formatDate(m.squaddingStarts)}`);
    }
    if (m.matchDate) {
      const done = firedTriggers.includes("match-day") || m.matchDate.slice(0, 10) < todayStr;
      if (done) lines.push("~~Match day~~");
    }

    lines.push(`[Scoreboard](${matchUrl})`);

    return {
      name: m.matchName,
      value: lines.join("\n"),
      inline: false,
    };
  });

  const embed: APIEmbed = {
    title: "Your match reminders",
    color: 0x5865f2, // blurple
    fields,
    footer: { text: `${config.matches.length}/${MAX_REMINDERS} reminders active` },
  };

  return { content: "", embeds: [embed] };
}

async function handleCancel(
  kv: KVNamespace,
  guildId: string,
  userId: string,
  query: string | undefined,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  if (!query) {
    return {
      content: "Please provide the match name to cancel.\nUsage: `/remind cancel <match name>`",
      embeds: [],
    };
  }

  const key = personalReminderKey(guildId, userId);
  const raw = await kv.get(key);
  if (!raw) {
    return { content: "You don't have any active reminders.", embeds: [] };
  }

  const config: PersonalReminderConfig = JSON.parse(raw);
  if (config.matches.length === 0) {
    return { content: "You don't have any active reminders.", embeds: [] };
  }

  // Try exact match by autocomplete-resolved ref
  const ref = parseEventRef(query);
  let idx = -1;
  if (ref) {
    idx = config.matches.findIndex(
      (m) => m.matchCt === ref.ct && m.matchId === ref.id,
    );
  } else {
    // Fuzzy match by name (case-insensitive substring)
    const lower = query.toLowerCase();
    idx = config.matches.findIndex((m) =>
      m.matchName.toLowerCase().includes(lower),
    );
  }

  if (idx === -1) {
    const names = config.matches.map((m) => `\u2022 ${m.matchName}`).join("\n");
    return {
      content: `No reminder found matching "${query}".\n\nYour active reminders:\n${names}`,
      embeds: [],
    };
  }

  const removed = config.matches.splice(idx, 1)[0];
  // Clean up notified events for this match
  const matchRef = `${removed.matchCt}:${removed.matchId}`;
  delete config.notifiedEvents[matchRef];

  if (config.matches.length === 0) {
    await kv.delete(key);
  } else {
    await kv.put(key, JSON.stringify(config));
  }

  return {
    content: `Reminder cancelled for **${removed.matchName}**.`,
    embeds: [],
  };
}

// ─── /remind upcoming ────────────────────────────────────────────────────────

/** Days from now to a date string. Negative = past. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso);
  if (isNaN(target.getTime())) return null;
  const now = new Date();
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((targetDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

interface MatchAction {
  emoji: string;
  label: string;
  /** 1 = most urgent */
  priority: number;
}

/** Determine the action status for an upcoming match. */
function getMatchAction(match: UpcomingMatch): MatchAction {
  const days = daysUntil(match.date);
  const now = new Date();

  if (days === 0) return { emoji: "\u{1F3C1}", label: "**Match day!**", priority: 1 };
  if (days === 1) return { emoji: "\u{1F4E3}", label: "**Match tomorrow** \u2014 gear check, travel plan", priority: 2 };

  // Squadding open — derive from dates
  const squaddingOpen = match.squaddingStarts
    ? new Date(match.squaddingStarts) <= now && (!match.squaddingCloses || new Date(match.squaddingCloses) > now)
    : match.isSquaddingPossible;
  if (squaddingOpen) {
    const closeDays = daysUntil(match.squaddingCloses);
    const closeNote = closeDays != null ? ` (closes in ${closeDays}d)` : "";
    return { emoji: "\u26A1", label: `Pick your squad${closeNote}`, priority: 3 };
  }

  // Registration open
  const regOpen = match.registrationStarts
    ? new Date(match.registrationStarts) <= now && (!match.registrationCloses || new Date(match.registrationCloses) > now)
    : match.isRegistrationPossible;
  if (regOpen) {
    const closeDays = daysUntil(match.registrationCloses);
    const closeNote = closeDays != null ? ` (closes in ${closeDays}d)` : "";
    return { emoji: "\u{1F4DD}", label: `Register now${closeNote}`, priority: 4 };
  }

  // Registration opens soon
  if (match.registrationStarts) {
    const regDays = daysUntil(match.registrationStarts);
    if (regDays != null && regDays > 0 && regDays <= 14) {
      return { emoji: "\u{1F514}", label: `Registration opens ${formatDate(match.registrationStarts)}`, priority: 5 };
    }
  }

  // Squadding opens soon
  if (match.squaddingStarts) {
    const sqDays = daysUntil(match.squaddingStarts);
    if (sqDays != null && sqDays > 0 && sqDays <= 14) {
      return { emoji: "\u{1F514}", label: `Squadding opens ${formatDate(match.squaddingStarts)}`, priority: 5 };
    }
  }

  // All set
  const countdown = days != null && days > 0 ? `${days}d to go` : "";
  return { emoji: "\u2705", label: `You're set${countdown ? ` \u2014 ${countdown}` : ""}`, priority: 6 };
}

async function handleUpcoming(
  client: ScoreboardClient,
  kv: KVNamespace,
  baseUrl: string,
  guildId: string,
  userId: string,
  days: number,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  // Check if user is linked
  const linkKey = `g:${guildId}:link:${userId}`;
  const linkRaw = await kv.get(linkKey);
  if (!linkRaw) {
    return {
      content: "You need to link your Discord account to an SSI shooter profile first.\nUse `/link <your name>` to get started.",
      embeds: [],
    };
  }
  const { shooterId, name: shooterName } = JSON.parse(linkRaw) as { shooterId: number; name: string };

  // Fetch dashboard
  let dashboard;
  try {
    dashboard = await client.getShooterDashboard(shooterId);
  } catch {
    return { content: "Could not load your shooter dashboard. Please try again later.", embeds: [] };
  }

  const upcoming = dashboard.upcomingMatches ?? [];
  if (upcoming.length === 0) {
    return {
      content: `No upcoming matches found for **${shooterName}**.\nMatches appear here once you've been registered and the match page has been viewed on the scoreboard.`,
      embeds: [],
    };
  }

  // Filter to the requested window
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  const cutoffStr = cutoff.toISOString();

  const inWindow = upcoming.filter((m) => {
    if (!m.date) return true; // no date = include (can't determine)
    return m.date <= cutoffStr;
  });

  if (inWindow.length === 0) {
    // Show when the next match is
    const nextMatch = upcoming[0];
    const nextDays = daysUntil(nextMatch.date);
    const nextNote = nextDays != null ? ` (in ${nextDays} days)` : "";
    return {
      content: `No matches in the next ${days} days.\nYour next match is **${nextMatch.name}**${nextNote}.`,
      embeds: [],
    };
  }

  // Build action list, sorted by priority then date
  const withActions = inWindow.map((m) => ({ match: m, action: getMatchAction(m) }));
  withActions.sort((a, b) => {
    if (a.action.priority !== b.action.priority) return a.action.priority - b.action.priority;
    return (a.match.date ?? "").localeCompare(b.match.date ?? "");
  });

  const lines = withActions.map(({ match, action }) => {
    const matchDays = daysUntil(match.date);
    const countdown = matchDays != null && matchDays >= 0
      ? matchDays === 0 ? "today" : matchDays === 1 ? "tomorrow" : `in ${matchDays}d`
      : "";
    const dateStr = match.date ? formatDate(match.date) : "Date TBD";
    const ssiUrl = `https://shootnscoreit.com/event/${match.ct}/${match.matchId}/`;
    const scoreboardUrl = `${baseUrl}/match/${match.ct}/${match.matchId}`;

    return [
      `**${match.name}**`,
      `${dateStr}${match.venue ? ` \u2014 ${match.venue}` : ""}${countdown ? ` (${countdown})` : ""}`,
      `${action.emoji} ${action.label}`,
      `[Scoreboard](${scoreboardUrl}) \u00b7 [SSI](${ssiUrl})`,
    ].join("\n");
  });

  // Color: amber if any action needed, green if all set
  const hasAction = withActions.some((w) => w.action.priority <= 4);
  const color = hasAction ? 0xf59e0b : 0x22c55e;

  const embed: APIEmbed = {
    title: `Your next ${days} days \u2014 ${inWindow.length} match${inWindow.length !== 1 ? "es" : ""}`,
    color,
    description: lines.join("\n\n"),
    footer: { text: `Linked as ${shooterName} \u00b7 /remind upcoming [days]` },
  };

  return { content: "", embeds: [embed] };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
