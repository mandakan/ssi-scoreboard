// Cron-triggered registration reminder digest.
// Scans all guilds with a configured reminder, checks if a digest
// has already been posted today, and posts a list of upcoming matches
// with their registration status — open, upcoming, or not yet announced.
// The goal: make sure club mates don't miss registration openings
// (first-come-first-serve under heavy server load).

import type { APIEmbed } from "discord-api-types/v10";
import type { Env, EventSearchResult } from "../types";
import { ScoreboardClient } from "../scoreboard-client";
import { postChannelMessage, editChannelMessage, pinMessage } from "../discord-api";
import {
  reminderKey,
  matchesDiscipline,
  formatDiscipline,
  type RegistrationReminderConfig,
} from "../commands/remind-registrations";
import { isGuildNotificationHour } from "../guild-settings";

const REMINDER_SUFFIX = ":remind-registrations";

/**
 * Run the registration reminder for a single guild immediately.
 * Used to give instant feedback when a user configures the reminder.
 */
export async function runRegistrationReminderForGuild(
  env: Env,
  guildId: string,
): Promise<void> {
  const client = new ScoreboardClient(env.SCOREBOARD_BASE_URL);
  const todayStr = new Date().toISOString().slice(0, 10);
  await processGuildReminder(env, client, guildId, todayStr, true);
}

export async function pollRegistrationReminders(env: Env): Promise<void> {
  const client = new ScoreboardClient(env.SCOREBOARD_BASE_URL);
  const todayStr = new Date().toISOString().slice(0, 10);

  const listed = await env.BOT_KV.list({ prefix: "g:" });

  for (const key of listed.keys) {
    if (!key.name.endsWith(REMINDER_SUFFIX)) continue;

    const guildId = key.name.slice(2, -REMINDER_SUFFIX.length);

    try {
      await processGuildReminder(env, client, guildId, todayStr);
    } catch (err) {
      console.error(`Error processing registration reminder for guild ${guildId}:`, err);
    }
  }
}

async function processGuildReminder(
  env: Env,
  client: ScoreboardClient,
  guildId: string,
  todayStr: string,
  skipTimeCheck = false,
): Promise<void> {
  const raw = await env.BOT_KV.get(reminderKey(guildId));
  if (!raw) return;

  const config: RegistrationReminderConfig = JSON.parse(raw);

  // Already posted today — skip
  if (config.lastRunDate === todayStr) return;

  // Wait until the guild's configured notification hour (default 10:00 CET)
  if (!skipTimeCheck && !(await isGuildNotificationHour(env.BOT_KV, guildId))) return;

  // Compute date window
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + config.daysAhead);

  const events = await client.browseEvents({
    country: config.country ?? undefined,
    minLevel: config.minLevel,
    startsAfter: todayStr,
    startsBefore: endDate.toISOString().slice(0, 10),
  });

  // Apply discipline filter + exclude matches where registration already closed
  const now = new Date();
  const filtered = events
    .filter((e) => !config.discipline || matchesDiscipline(e.discipline, config.discipline))
    // Keep: registration open, registration not yet open, or no registration info
    // Exclude: registration explicitly closed (closes date in the past and not currently possible)
    .filter((e) => {
      if (e.is_registration_possible) return true;
      if (e.registration_starts) return true; // has a future/past start date — show it
      if (e.registration_closes) {
        // If closes is in the past and not currently possible, skip
        return new Date(e.registration_closes) > now;
      }
      return true; // no registration info — show it anyway
    })
    .sort((a, b) => {
      // Sort by registration urgency: open now → opens soonest → no date (by match date)
      const aOpen = a.is_registration_possible ? 1 : 0;
      const bOpen = b.is_registration_possible ? 1 : 0;
      // Open registrations first
      if (aOpen !== bOpen) return bOpen - aOpen;
      // Both have registration_starts — sort by that date (soonest first)
      if (a.registration_starts && b.registration_starts) {
        return new Date(a.registration_starts).getTime() - new Date(b.registration_starts).getTime();
      }
      // Has a registration date beats no registration date
      if (a.registration_starts && !b.registration_starts) return -1;
      if (!a.registration_starts && b.registration_starts) return 1;
      // Fallback: match date
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

  // Check for registrations opening today — these get a separate urgent alert
  const opensToday = filtered.filter((e) => {
    if (!e.registration_starts) return false;
    return e.registration_starts.slice(0, 10) === todayStr;
  });

  // Post urgent alert for registrations opening today as a NEW message (with @here)
  if (opensToday.length > 0) {
    const urgentEmbed = buildOpensTodayEmbed(opensToday);
    await postChannelMessage(
      env.DISCORD_BOT_TOKEN,
      config.channelId,
      "@here",
      [urgentEmbed],
    );
  }

  // Build the full digest — this goes into the pinned message (edited in-place)
  const embeds = buildDigestEmbeds(filtered, config);
  const digestContent = embeds.length === 0 && opensToday.length === 0
    ? buildNoMatchesMessage(config)
    : "";

  // Try to edit the existing pinned message; create + pin a new one if it fails or doesn't exist
  let pinnedOk = false;
  if (config.pinnedMessageId) {
    pinnedOk = await editChannelMessage(
      env.DISCORD_BOT_TOKEN,
      config.channelId,
      config.pinnedMessageId,
      digestContent,
      embeds.length > 0 ? embeds : undefined,
    );
  }

  if (!pinnedOk) {
    // Create a new message and pin it
    const messageId = await postChannelMessage(
      env.DISCORD_BOT_TOKEN,
      config.channelId,
      digestContent,
      embeds.length > 0 ? embeds : undefined,
    );

    if (messageId) {
      await pinMessage(env.DISCORD_BOT_TOKEN, config.channelId, messageId);
      config.pinnedMessageId = messageId;
    }
  }

  // Update lastRunDate (and possibly pinnedMessageId)
  config.lastRunDate = todayStr;
  await env.BOT_KV.put(reminderKey(guildId), JSON.stringify(config));
}

/**
 * Build an urgent embed for registrations opening today.
 * Posted with @here so the whole channel gets pinged.
 */
function buildOpensTodayEmbed(events: EventSearchResult[]): APIEmbed {
  const fields: NonNullable<APIEmbed["fields"]> = events.map((e) => {
    const parts: string[] = [];

    parts.push(`${formatDate(e.date)} \u00b7 ${e.level} \u00b7 ${e.discipline}`);
    if (e.venue) parts.push(e.venue);

    // Show exact opening time if available
    if (e.registration_starts) {
      const unixTs = Math.floor(new Date(e.registration_starts).getTime() / 1000);
      if (e.is_registration_possible) {
        parts.push(`\u2705 **OPEN NOW** — go go go!`);
      } else {
        parts.push(`Opens at <t:${unixTs}:t> (<t:${unixTs}:R>)`);
      }
    }

    if (e.max_competitors) {
      parts.push(`Max ${e.max_competitors} competitors`);
    }

    const ssiUrl = `https://shootnscoreit.com/event/${e.content_type}/${e.id}/`;
    parts.push(`[Register on SSI](${ssiUrl})`);

    return { name: e.name, value: parts.join("\n"), inline: false };
  });

  return {
    title: `\u{1F6A8} Registration opens TODAY \u2014 ${events.length} match${events.length === 1 ? "" : "es"}`,
    color: 0xef4444, // red — urgent
    description: "First-come-first-serve \u2014 be ready to register!",
    fields,
    timestamp: new Date().toISOString(),
  };
}

function buildDigestEmbeds(
  events: EventSearchResult[],
  config: RegistrationReminderConfig,
): APIEmbed[] {
  if (events.length === 0) return [];

  const capped = events.slice(0, 20);
  const hasMore = events.length > 20;

  const fields: NonNullable<APIEmbed["fields"]> = capped.map((e) => {
    const date = formatDate(e.date);
    const parts: string[] = [];

    parts.push(`${date} \u00b7 ${e.level} \u00b7 ${e.discipline}`);
    if (e.venue) parts.push(e.venue);

    // Registration status — the key info
    parts.push(buildRegistrationStatus(e));

    // Max competitors
    if (e.max_competitors) {
      parts.push(`Max ${e.max_competitors} competitors`);
    }

    // Squadding info
    if (e.is_squadding_possible) {
      parts.push("Squadding open");
    } else if (e.squadding_starts) {
      const squadDate = new Date(e.squadding_starts);
      if (squadDate > new Date()) {
        parts.push(`Squadding opens ${formatDate(e.squadding_starts)}`);
      }
    }

    const ssiUrl = `https://shootnscoreit.com/event/${e.content_type}/${e.id}/`;
    parts.push(`[SSI](${ssiUrl})`);

    return {
      name: e.name,
      value: parts.join("\n"),
      inline: false,
    };
  });

  const filterDesc: string[] = [];
  if (config.country) filterDesc.push(config.country);
  filterDesc.push(formatLevel(config.minLevel));
  if (config.discipline) filterDesc.push(formatDiscipline(config.discipline));
  filterDesc.push(`next ${config.daysAhead} days`);

  // Count by status for the title
  const openCount = events.filter((e) => e.is_registration_possible).length;
  const titleParts: string[] = [];
  if (openCount > 0) titleParts.push(`${openCount} open`);
  titleParts.push(`${events.length} total`);

  const embed: APIEmbed = {
    title: `Upcoming matches \u2014 ${titleParts.join(", ")}`,
    color: openCount > 0 ? 0x22c55e : 0x3b82f6, // green if any open, blue otherwise
    description: `Registration status for upcoming matches (${filterDesc.join(" \u00b7 ")})`,
    fields,
    footer: {
      text: hasMore
        ? `Showing 20 of ${events.length} matches. Use /remind-registrations show to check config.`
        : "Use /remind-registrations off to stop these digests.",
    },
    timestamp: new Date().toISOString(),
  };

  return [embed];
}

/**
 * Build a concise registration status line for an event.
 */
function buildRegistrationStatus(e: EventSearchResult): string {
  if (e.is_registration_possible) {
    if (e.registration_closes) {
      return `\u2705 **Registration OPEN** — closes ${formatDate(e.registration_closes)}`;
    }
    return "\u2705 **Registration OPEN**";
  }

  // Registration not yet open — show when it will open
  if (e.registration_starts) {
    const starts = new Date(e.registration_starts);
    if (starts > new Date()) {
      const unixTs = Math.floor(starts.getTime() / 1000);
      return `\u23f3 Registration opens <t:${unixTs}:f> (<t:${unixTs}:R>)`;
    }
    // Start date is in the past but not currently possible — likely closed
    return "\u274c Registration closed";
  }

  return "\u2014 Registration dates not announced";
}

function buildNoMatchesMessage(config: RegistrationReminderConfig): string {
  const filterParts: string[] = [];
  if (config.country) filterParts.push(config.country);
  filterParts.push(formatLevel(config.minLevel));
  if (config.discipline) filterParts.push(formatDiscipline(config.discipline));
  filterParts.push(`next ${config.daysAhead} days`);

  return `No upcoming matches found (${filterParts.join(" \u00b7 ")}).`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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
