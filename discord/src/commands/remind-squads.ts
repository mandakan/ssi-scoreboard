// Handler for /remind-squads
// Manages daily squad/match-day reminders for linked shooters.
//
// Config is stored per-guild in KV at g:{guildId}:remind-squads.
// The cron trigger checks lastRunDate to ensure at most one run per day.

import type { APIEmbed } from "discord-api-types/v10";

export interface SquadReminderConfig {
  channelId: string;
  /** How many days before a match to send the "match coming up" reminder. 0 = match day only. */
  daysBefore: number;
  /** ISO date string (YYYY-MM-DD) of the last successful run. */
  lastRunDate: string | null;
  /**
   * Track which events have been notified for which trigger types,
   * so we don't repeat the same reminder if cron fires multiple times per day.
   * Map of matchRef ("ct:matchId") -> array of trigger types ("squadding" | "match-day" | "match-eve").
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
  daysBefore: number | undefined,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  switch (action) {
    case "off":
      return handleOff(kv, guildId);
    case "show":
      return handleShow(kv, guildId);
    case "set":
    default:
      return handleSet(kv, guildId, channelId, daysBefore);
  }
}

async function handleSet(
  kv: KVNamespace,
  guildId: string,
  channelId: string,
  daysBefore: number | undefined,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  const days = daysBefore != null && daysBefore >= 0 && daysBefore <= 7 ? daysBefore : 1;

  const config: SquadReminderConfig = {
    channelId,
    daysBefore: days,
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
      `Remind before match: **${days === 0 ? "match day only" : `${days} day${days > 1 ? "s" : ""} before + match day`}**`,
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
      name: "Remind before",
      value: config.daysBefore === 0
        ? "Match day only"
        : `${config.daysBefore} day${config.daysBefore > 1 ? "s" : ""} before`,
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
