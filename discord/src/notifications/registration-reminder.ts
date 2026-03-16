// Cron-triggered registration reminder digest.
// Scans all guilds with a configured reminder, checks if a digest
// has already been posted today, and posts a list of upcoming matches
// with open registration.

import type { APIEmbed } from "discord-api-types/v10";
import type { Env, EventSearchResult } from "../types";
import { ScoreboardClient } from "../scoreboard-client";
import { postChannelMessage } from "../discord-api";
import {
  reminderKey,
  type RegistrationReminderConfig,
} from "../commands/remind-registrations";

/** Prefix used to discover all guild reminder keys. */
const REMINDER_SUFFIX = ":remind-registrations";

/**
 * Called by the cron trigger. Scans all guilds with a registration reminder
 * config, and posts a digest if one hasn't been sent today.
 */
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
): Promise<void> {
  const raw = await env.BOT_KV.get(reminderKey(guildId));
  if (!raw) return;

  const config: RegistrationReminderConfig = JSON.parse(raw);

  // Already posted today — skip
  if (config.lastRunDate === todayStr) return;

  // Compute date window
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + config.daysAhead);

  const events = await client.browseEvents({
    country: config.country ?? undefined,
    minLevel: config.minLevel,
    startsAfter: todayStr,
    startsBefore: endDate.toISOString().slice(0, 10),
  });

  // Filter to matches with open registration
  const openEvents = events
    .filter((e) => e.is_registration_possible)
    // Sort by date ascending (soonest first)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Build and post the digest
  const embeds = buildDigestEmbeds(openEvents, config);

  if (embeds.length > 0) {
    await postChannelMessage(
      env.DISCORD_BOT_TOKEN,
      config.channelId,
      "",
      embeds,
    );
  } else {
    // No matches — post a short "nothing open" message so users know it ran
    await postChannelMessage(
      env.DISCORD_BOT_TOKEN,
      config.channelId,
      buildNoMatchesMessage(config),
    );
  }

  // Update lastRunDate
  config.lastRunDate = todayStr;
  await env.BOT_KV.put(reminderKey(guildId), JSON.stringify(config));
}

function buildDigestEmbeds(
  events: EventSearchResult[],
  config: RegistrationReminderConfig,
): APIEmbed[] {
  if (events.length === 0) return [];

  // Discord embed limit: max 25 fields per embed, max 10 embeds per message.
  // Use one field per match, cap at 20 matches (leaving room for header).
  const capped = events.slice(0, 20);
  const hasMore = events.length > 20;

  const fields: NonNullable<APIEmbed["fields"]> = capped.map((e) => {
    const date = formatDate(e.date);
    const parts: string[] = [];

    parts.push(`${date} \u00b7 ${e.level}`);
    if (e.venue) parts.push(e.venue);

    // Registration info
    const regParts: string[] = [];
    if (e.registration_closes) {
      regParts.push(`Closes ${formatDate(e.registration_closes)}`);
    }
    if (e.max_competitors) {
      regParts.push(`Max ${e.max_competitors} competitors`);
    }
    if (regParts.length > 0) {
      parts.push(regParts.join(" \u00b7 "));
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
    parts.push(`[Register on SSI](${ssiUrl})`);

    return {
      name: e.name,
      value: parts.join("\n"),
      inline: false,
    };
  });

  const filterDesc: string[] = [];
  if (config.country) filterDesc.push(config.country);
  filterDesc.push(formatLevel(config.minLevel));
  filterDesc.push(`next ${config.daysAhead} days`);

  const embed: APIEmbed = {
    title: `Registration open \u2014 ${events.length} match${events.length === 1 ? "" : "es"}`,
    color: 0x3b82f6, // blue
    description: `Upcoming matches with open registration (${filterDesc.join(" \u00b7 ")})`,
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

function buildNoMatchesMessage(config: RegistrationReminderConfig): string {
  const filterParts: string[] = [];
  if (config.country) filterParts.push(config.country);
  filterParts.push(formatLevel(config.minLevel));
  filterParts.push(`next ${config.daysAhead} days`);

  return `No upcoming matches with open registration found (${filterParts.join(" \u00b7 ")}).`;
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
