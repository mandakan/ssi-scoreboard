// Handler for /remind-squads
// Manages daily squad/match-day reminders for linked shooters.
//
// Config is stored per-guild in KV at g:{guildId}:remind-squads.
// The cron trigger checks lastRunDate to ensure at most one run per day.

import type { APIEmbed } from "discord-api-types/v10";

export interface SquadReminderConfig {
  channelId: string;
  /**
   * Days before squadding opens to send a heads-up reminder.
   * 0 is always included (fires on the day squadding opens).
   * Example: [0, 1, 7] = remind 7 days before, 1 day before, and on the day.
   */
  remindDays: number[];
  /** ISO date string (YYYY-MM-DD) of the last successful run. */
  lastRunDate: string | null;
  /**
   * Track which events have been notified for which trigger types,
   * so we don't repeat the same reminder if cron fires multiple times per day.
   * Map of matchRef ("ct:matchId") -> array of trigger types
   * ("squadding-0" | "squadding-1" | "squadding-7" | "match-day").
   */
  notifiedEvents: Record<string, string[]>;
  createdAt: string;
}

/** KV key for a guild's squad reminder config. */
export function squadReminderKey(guildId: string): string {
  return `g:${guildId}:remind-squads`;
}

export async function handleRemindSquads(
  kv: KVNamespace,
  guildId: string,
  channelId: string,
  action: string | undefined,
  daysRaw: string | undefined,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  switch (action) {
    case "off":
      return handleOff(kv, guildId);
    case "show":
      return handleShow(kv, guildId);
    case "set":
    default:
      return handleSet(kv, guildId, channelId, daysRaw);
  }
}

/**
 * Parse a comma-separated list of days into a sorted, deduplicated number array.
 * Always includes 0 (the day squadding opens). Clamps to 0–30.
 * Examples: "1,7" → [0, 1, 7], "" → [0], "0,1,1,3" → [0, 1, 3]
 */
/** Default remind days: day-of + 1 day before + 7 days before. */
const DEFAULT_REMIND_DAYS = [0, 1, 7];

function parseRemindDays(raw: string | undefined): number[] {
  // No input → use defaults
  if (!raw) return [...DEFAULT_REMIND_DAYS];

  const days = new Set<number>([0]); // 0 is always included

  for (const part of raw.split(",")) {
    const n = parseInt(part.trim(), 10);
    if (!isNaN(n) && n >= 0 && n <= 30) {
      days.add(n);
    }
  }

  return [...days].sort((a, b) => a - b);
}

function formatRemindDays(days: number[]): string {
  if (days.length === 1 && days[0] === 0) {
    return "On the day squadding opens";
  }
  const parts = days.map((d) => {
    if (d === 0) return "day of";
    if (d === 1) return "1 day before";
    return `${d} days before`;
  });
  return parts.join(", ");
}

async function handleSet(
  kv: KVNamespace,
  guildId: string,
  channelId: string,
  daysRaw: string | undefined,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  const remindDays = parseRemindDays(daysRaw);

  const config: SquadReminderConfig = {
    channelId,
    remindDays,
    lastRunDate: null,
    notifiedEvents: {},
    createdAt: new Date().toISOString(),
  };

  await kv.put(squadReminderKey(guildId), JSON.stringify(config));

  const embed: APIEmbed = {
    title: "Squad reminder configured",
    color: 0x22c55e, // green
    description:
      "I'll remind linked shooters when squadding opens for their upcoming matches, " +
      "and post match-day reminders with squad assignments.\n\n" +
      `Channel: <#${channelId}>\n` +
      `Squadding reminders: **${formatRemindDays(remindDays)}**\n` +
      "Match-day reminder: **always on**",
    footer: {
      text: "Runs daily. Shooters must /link their accounts to get mentioned.",
    },
  };

  return { content: "", embeds: [embed] };
}

async function handleOff(
  kv: KVNamespace,
  guildId: string,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  const existing = await kv.get(squadReminderKey(guildId));
  if (!existing) {
    return {
      content: "No squad reminder is configured for this server.",
      embeds: [],
    };
  }

  await kv.delete(squadReminderKey(guildId));
  return {
    content: "Squad reminder disabled. No more reminders will be posted.",
    embeds: [],
  };
}

async function handleShow(
  kv: KVNamespace,
  guildId: string,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  const raw = await kv.get(squadReminderKey(guildId));
  if (!raw) {
    return {
      content:
        "No squad reminder configured.\n" +
        "Use `/remind-squads set` to set one up.",
      embeds: [],
    };
  }

  const config: SquadReminderConfig = JSON.parse(raw);

  const fields: APIEmbed["fields"] = [
    { name: "Channel", value: `<#${config.channelId}>`, inline: true },
    {
      name: "Squadding reminders",
      value: formatRemindDays(config.remindDays),
      inline: true,
    },
  ];

  if (config.lastRunDate) {
    fields.push({ name: "Last run", value: config.lastRunDate, inline: true });
  }

  const embed: APIEmbed = {
    title: "Squad reminder",
    color: 0x5865f2, // blurple
    fields,
    footer: { text: "Use /remind-squads set to update, or off to disable." },
  };

  return { content: "", embeds: [embed] };
}
