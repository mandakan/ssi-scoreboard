// Handler for /remind-registrations
// Manages daily digest reminders for upcoming matches with open registration.
//
// Config is stored per-guild in KV at g:{guildId}:remind-registrations.
// The cron trigger checks lastRunDate to ensure at most one digest per day.

import type { APIEmbed } from "discord-api-types/v10";

export interface RegistrationReminderConfig {
  channelId: string;
  country: string | null;
  minLevel: string;
  /** Discipline filter: "handgun", "rifle", "shotgun", "minirifle", or null (all). */
  discipline: string | null;
  daysAhead: number;
  /** ISO date string (YYYY-MM-DD) of the last successful digest post. */
  lastRunDate: string | null;
  createdAt: string;
}

/** KV key for a guild's registration reminder config. */
export function reminderKey(guildId: string): string {
  return `g:${guildId}:remind-registrations`;
}

export async function handleRemindRegistrations(
  kv: KVNamespace,
  guildId: string,
  channelId: string,
  action: string | undefined,
  country: string | undefined,
  level: string | undefined,
  discipline: string | undefined,
  days: number | undefined,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  switch (action) {
    case "off":
      return handleOff(kv, guildId);
    case "show":
      return handleShow(kv, guildId);
    case "set":
    default:
      return handleSet(kv, guildId, channelId, country, level, discipline, days);
  }
}

async function handleSet(
  kv: KVNamespace,
  guildId: string,
  channelId: string,
  country: string | undefined,
  level: string | undefined,
  discipline: string | undefined,
  days: number | undefined,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  const validLevels = ["l2plus", "l3plus", "l4plus", "all"];
  const minLevel = level && validLevels.includes(level) ? level : "l2plus";
  const validDisciplines = ["handgun", "rifle", "shotgun", "minirifle"];
  const normalizedDiscipline = discipline && validDisciplines.includes(discipline) ? discipline : null;
  const daysAhead = days && days >= 1 && days <= 730 ? days : 365;
  const normalizedCountry = country?.toUpperCase() ?? null;

  // Check for existing config
  const existingRaw = await kv.get(reminderKey(guildId));
  const existing: RegistrationReminderConfig | null = existingRaw ? JSON.parse(existingRaw) : null;

  const config: RegistrationReminderConfig = {
    channelId,
    country: normalizedCountry,
    minLevel,
    discipline: normalizedDiscipline,
    daysAhead,
    lastRunDate: null,
    createdAt: new Date().toISOString(),
  };

  await kv.put(reminderKey(guildId), JSON.stringify(config));

  const filters: string[] = [];
  if (normalizedCountry) filters.push(`Country: **${normalizedCountry}**`);
  filters.push(`Level: **${formatLevel(minLevel)}**`);
  if (normalizedDiscipline) filters.push(`Discipline: **${formatDiscipline(normalizedDiscipline)}**`);
  filters.push(`Window: **next ${daysAhead} days**`);
  filters.push(`Channel: <#${channelId}>`);

  let description = "I'll post a daily digest of upcoming matches with registration status.\n\n" +
    filters.join("\n");

  if (existing) {
    description += `\n\n*Replaced previous config (was posting to <#${existing.channelId}>).*`;
  }

  const embed: APIEmbed = {
    title: existing ? "Registration reminder updated" : "Registration reminder configured",
    color: 0x22c55e, // green
    description,
    footer: {
      text: "Runs daily at ~08:00 UTC. The first digest will appear within a few minutes.",
    },
  };

  return { content: "", embeds: [embed] };
}

async function handleOff(
  kv: KVNamespace,
  guildId: string,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  const existing = await kv.get(reminderKey(guildId));
  if (!existing) {
    return {
      content: "No registration reminder is configured for this server.",
      embeds: [],
    };
  }

  await kv.delete(reminderKey(guildId));
  return {
    content: "Registration reminder disabled. No more daily digests will be posted.",
    embeds: [],
  };
}

async function handleShow(
  kv: KVNamespace,
  guildId: string,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  const raw = await kv.get(reminderKey(guildId));
  if (!raw) {
    return {
      content:
        "No registration reminder configured.\n" +
        "Use `/remind-registrations set` to set one up.",
      embeds: [],
    };
  }

  const config: RegistrationReminderConfig = JSON.parse(raw);

  const fields: APIEmbed["fields"] = [
    { name: "Channel", value: `<#${config.channelId}>`, inline: true },
    { name: "Level", value: formatLevel(config.minLevel), inline: true },
    { name: "Window", value: `Next ${config.daysAhead} days`, inline: true },
  ];

  if (config.country) {
    fields.push({ name: "Country", value: config.country, inline: true });
  }

  if (config.discipline) {
    fields.push({ name: "Discipline", value: formatDiscipline(config.discipline), inline: true });
  }

  if (config.lastRunDate) {
    fields.push({ name: "Last digest", value: config.lastRunDate, inline: true });
  }

  const embed: APIEmbed = {
    title: "Registration reminder",
    color: 0x5865f2, // blurple
    fields,
    footer: { text: "Use /remind-registrations set to update, or off to disable." },
  };

  return { content: "", embeds: [embed] };
}

function formatLevel(minLevel: string): string {
  switch (minLevel) {
    case "all": return "All levels";
    case "l2plus": return "Level II+";
    case "l3plus": return "Level III+";
    case "l4plus": return "Level IV+";
    default: return minLevel;
  }
}

export function formatDiscipline(discipline: string): string {
  switch (discipline) {
    case "handgun": return "Handgun (incl. PCC)";
    case "rifle": return "Rifle";
    case "shotgun": return "Shotgun";
    case "minirifle": return "Mini Rifle";
    default: return discipline;
  }
}

/**
 * Test whether an event's discipline string matches the configured filter.
 * Uses substring matching so "handgun" matches both "IPSC Handgun" and "IPSC Handgun & PCC".
 */
export function matchesDiscipline(eventDiscipline: string, filter: string): boolean {
  const d = eventDiscipline.toLowerCase();
  switch (filter) {
    case "handgun": return d.includes("handgun") || d.includes("pcc");
    case "rifle": return d.includes("rifle") && !d.includes("mini rifle");
    case "shotgun": return d.includes("shotgun");
    case "minirifle": return d.includes("mini rifle");
    default: return true;
  }
}
