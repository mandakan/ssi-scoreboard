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
import type { EventSearchResult } from "../types";
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
): Promise<{ content: string; embeds: APIEmbed[] }> {
  switch (action) {
    case "list":
      return handleList(kv, baseUrl, guildId, userId);
    case "cancel":
      return handleCancel(kv, guildId, userId, query);
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
