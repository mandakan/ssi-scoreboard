// Cron-triggered squad and match-day reminders.
// For each guild with a configured reminder:
// 1. Scans linked shooters' upcoming matches (from dashboard API)
// 2. Fetches match data for matches with relevant dates (squadding/match day)
// 3. Posts reminders with @ mentions showing squad assignments

import type { APIEmbed } from "discord-api-types/v10";
import type { Env, MatchResponse, UpcomingMatch } from "../types";
import { ScoreboardClient } from "../scoreboard-client";
import { postChannelMessage } from "../discord-api";
import {
  squadReminderKey,
  type SquadReminderConfig,
} from "../commands/remind-squads";
import {
  getGuildLinkedShootersWithUsers,
  type LinkedShooterWithUser,
} from "../linked-shooters";

const REMINDER_SUFFIX = ":remind-squads";

/**
 * Called by the cron trigger. Scans all guilds with a squad reminder config,
 * checks linked shooters' upcoming matches, and posts reminders.
 */
export async function pollSquadReminders(env: Env): Promise<void> {
  const client = new ScoreboardClient(env.SCOREBOARD_BASE_URL);
  const todayStr = new Date().toISOString().slice(0, 10);

  const listed = await env.BOT_KV.list({ prefix: "g:" });

  for (const key of listed.keys) {
    if (!key.name.endsWith(REMINDER_SUFFIX)) continue;

    const guildId = key.name.slice(2, -REMINDER_SUFFIX.length);

    try {
      await processGuildSquadReminder(env, client, guildId, todayStr);
    } catch (err) {
      console.error(`Error processing squad reminder for guild ${guildId}:`, err);
    }
  }
}

// ── Types for internal grouping ──────────────────────────────────────────────

interface MatchShooterInfo {
  discordUserId: string;
  shooterId: number;
  shooterName: string;
  competitorId: number;
  squadNumber: number | null;
  squadName: string | null;
}

type TriggerType = "squadding" | "match-day" | "match-eve";

interface MatchNotification {
  ct: string;
  matchId: string;
  matchName: string;
  venue: string | null;
  date: string | null;
  level: string | null;
  triggerType: TriggerType;
  shooters: MatchShooterInfo[];
  isSquaddingOpen: boolean;
  stagesCount: number;
}

// ── Main processing ──────────────────────────────────────────────────────────

async function processGuildSquadReminder(
  env: Env,
  client: ScoreboardClient,
  guildId: string,
  todayStr: string,
): Promise<void> {
  const raw = await env.BOT_KV.get(squadReminderKey(guildId));
  if (!raw) return;

  const config: SquadReminderConfig = JSON.parse(raw);

  // Already ran today — skip
  if (config.lastRunDate === todayStr) return;

  // Get all linked shooters with Discord user IDs
  const linkedShooters = await getGuildLinkedShootersWithUsers(env.BOT_KV, guildId);
  if (linkedShooters.length === 0) {
    config.lastRunDate = todayStr;
    await env.BOT_KV.put(squadReminderKey(guildId), JSON.stringify(config));
    return;
  }

  // Collect upcoming matches from all linked shooters' dashboards
  const matchShooterMap = new Map<string, {
    upcoming: UpcomingMatch;
    shooters: LinkedShooterWithUser[];
  }>();

  for (const shooter of linkedShooters) {
    try {
      const dashboard = await client.getShooterDashboard(shooter.shooterId);
      for (const match of dashboard.upcomingMatches ?? []) {
        const ref = `${match.ct}:${match.matchId}`;
        let entry = matchShooterMap.get(ref);
        if (!entry) {
          entry = { upcoming: match, shooters: [] };
          matchShooterMap.set(ref, entry);
        }
        entry.shooters.push(shooter);
      }
    } catch (err) {
      console.error(`Failed to get dashboard for shooter ${shooter.shooterId}:`, err);
    }
  }

  if (matchShooterMap.size === 0) {
    config.lastRunDate = todayStr;
    await env.BOT_KV.put(squadReminderKey(guildId), JSON.stringify(config));
    return;
  }

  // Check each match for relevant dates and fetch full data if needed
  const notifications: MatchNotification[] = [];
  const baseUrl = env.SCOREBOARD_BASE_URL;

  for (const [ref, { upcoming, shooters }] of matchShooterMap) {
    const matchDate = upcoming.date ? upcoming.date.slice(0, 10) : null;

    // Determine trigger types for this match
    const triggers: TriggerType[] = [];

    // Match day check
    if (matchDate === todayStr) {
      if (!isAlreadyNotified(config, ref, "match-day")) {
        triggers.push("match-day");
      }
    }

    // Match eve check (N days before)
    if (config.daysBefore > 0 && matchDate) {
      const matchTime = new Date(matchDate).getTime();
      const todayTime = new Date(todayStr).getTime();
      const daysUntil = Math.round((matchTime - todayTime) / (1000 * 60 * 60 * 24));
      if (daysUntil > 0 && daysUntil <= config.daysBefore) {
        if (!isAlreadyNotified(config, ref, "match-eve")) {
          triggers.push("match-eve");
        }
      }
    }

    // Squadding check — need full match data for squadding_starts
    // We fetch match data if there's any trigger, or to check squadding
    let matchData: MatchResponse | null = null;

    // Always try to fetch match data to check squadding date
    try {
      matchData = await client.getMatch(
        parseInt(upcoming.ct, 10),
        parseInt(upcoming.matchId, 10),
      );
    } catch (err) {
      console.error(`Failed to get match ${ref}:`, err);
    }

    if (matchData?.squadding_starts) {
      const squaddingDate = matchData.squadding_starts.slice(0, 10);
      if (squaddingDate === todayStr && !isAlreadyNotified(config, ref, "squadding")) {
        triggers.push("squadding");
      }
    }

    if (triggers.length === 0) continue;

    // Resolve shooters to competitors + squads
    const shooterInfos: MatchShooterInfo[] = [];
    if (matchData) {
      for (const shooter of shooters) {
        const competitor = matchData.competitors.find(
          (c) => c.shooterId === shooter.shooterId,
        );
        if (!competitor) continue;

        // Find squad assignment
        let squadNumber: number | null = null;
        let squadName: string | null = null;
        for (const squad of matchData.squads) {
          if (squad.competitorIds.includes(competitor.id)) {
            squadNumber = squad.number;
            squadName = squad.name;
            break;
          }
        }

        shooterInfos.push({
          discordUserId: shooter.discordUserId,
          shooterId: shooter.shooterId,
          shooterName: competitor.name,
          competitorId: competitor.id,
          squadNumber,
          squadName,
        });
      }
    }

    if (shooterInfos.length === 0) continue;

    // Create a notification for each trigger type
    for (const trigger of triggers) {
      notifications.push({
        ct: upcoming.ct,
        matchId: upcoming.matchId,
        matchName: matchData?.name ?? upcoming.name,
        venue: matchData?.venue ?? upcoming.venue,
        date: upcoming.date,
        level: matchData?.level ?? upcoming.level,
        triggerType: trigger,
        shooters: shooterInfos,
        isSquaddingOpen: matchData?.is_squadding_possible ?? false,
        stagesCount: matchData?.stages_count ?? 0,
      });
    }
  }

  // Post notifications
  for (const notification of notifications) {
    const mentions = notification.shooters
      .map((s) => `<@${s.discordUserId}>`)
      .join(" ");
    const embed = buildReminderEmbed(notification, baseUrl);

    await postChannelMessage(
      env.DISCORD_BOT_TOKEN,
      config.channelId,
      mentions,
      [embed],
    );

    // Mark as notified
    const ref = `${notification.ct}:${notification.matchId}`;
    if (!config.notifiedEvents[ref]) {
      config.notifiedEvents[ref] = [];
    }
    config.notifiedEvents[ref].push(notification.triggerType);
  }

  // Clean up old notified events (matches in the past)
  pruneNotifiedEvents(config);

  config.lastRunDate = todayStr;
  await env.BOT_KV.put(squadReminderKey(guildId), JSON.stringify(config));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAlreadyNotified(
  config: SquadReminderConfig,
  matchRef: string,
  triggerType: TriggerType,
): boolean {
  return (config.notifiedEvents[matchRef] ?? []).includes(triggerType);
}

/**
 * Remove entries for matches that were notified more than 7 days ago.
 * We don't have exact dates per entry, so we cap the map size instead.
 */
function pruneNotifiedEvents(config: SquadReminderConfig): void {
  const keys = Object.keys(config.notifiedEvents);
  // Keep at most 50 entries to prevent unbounded KV growth
  if (keys.length > 50) {
    const toRemove = keys.slice(0, keys.length - 50);
    for (const key of toRemove) {
      delete config.notifiedEvents[key];
    }
  }
}

function buildReminderEmbed(
  notification: MatchNotification,
  baseUrl: string,
): APIEmbed {
  const matchUrl = `${baseUrl}/match/${notification.ct}/${notification.matchId}`;
  const ssiUrl = `https://shootnscoreit.com/event/${notification.ct}/${notification.matchId}/`;

  switch (notification.triggerType) {
    case "squadding":
      return buildSquaddingEmbed(notification, matchUrl, ssiUrl);
    case "match-eve":
      return buildMatchEveEmbed(notification, matchUrl, ssiUrl);
    case "match-day":
      return buildMatchDayEmbed(notification, matchUrl, ssiUrl);
  }
}

function buildSquaddingEmbed(
  n: MatchNotification,
  matchUrl: string,
  ssiUrl: string,
): APIEmbed {
  const lines: string[] = [];
  lines.push(`Squadding is now open for **${n.matchName}**!`);
  lines.push("");

  if (n.venue || n.date) {
    const parts: string[] = [];
    if (n.date) parts.push(formatDate(n.date));
    if (n.venue) parts.push(n.venue);
    if (n.level) parts.push(n.level);
    lines.push(parts.join(" \u00b7 "));
    lines.push("");
  }

  lines.push("**Go pick your squad:**");
  lines.push(`[Open on SSI](${ssiUrl}) \u00b7 [View on Scoreboard](${matchUrl})`);

  const shooterList = n.shooters
    .map((s) => `\u2022 <@${s.discordUserId}> (${s.shooterName})`)
    .join("\n");

  return {
    title: "Squadding open!",
    color: 0xf59e0b, // amber
    description: lines.join("\n"),
    fields: [
      {
        name: `Registered shooters (${n.shooters.length})`,
        value: shooterList,
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
  };
}

function buildMatchEveEmbed(
  n: MatchNotification,
  matchUrl: string,
  ssiUrl: string,
): APIEmbed {
  const daysUntil = n.date
    ? Math.round(
        (new Date(n.date.slice(0, 10)).getTime() - new Date().setHours(0, 0, 0, 0)) /
          (1000 * 60 * 60 * 24),
      )
    : 1;

  const lines: string[] = [];
  lines.push(
    `**${n.matchName}** is ${daysUntil === 1 ? "tomorrow" : `in ${daysUntil} days`}!`,
  );
  lines.push("");

  if (n.venue || n.date) {
    const parts: string[] = [];
    if (n.date) parts.push(formatDate(n.date));
    if (n.venue) parts.push(n.venue);
    if (n.level) parts.push(n.level);
    lines.push(parts.join(" \u00b7 "));
    lines.push("");
  }

  if (n.stagesCount > 0) {
    lines.push(`${n.stagesCount} stages`);
  }

  lines.push(`[SSI](${ssiUrl}) \u00b7 [Scoreboard](${matchUrl})`);

  const shooterLines = n.shooters.map((s) => {
    const squad = s.squadNumber != null ? `Squad ${s.squadNumber}` : "No squad";
    return `\u2022 <@${s.discordUserId}> \u2014 ${squad}`;
  });

  return {
    title: `Match ${daysUntil === 1 ? "tomorrow" : "coming up"}!`,
    color: 0x3b82f6, // blue
    description: lines.join("\n"),
    fields: [
      {
        name: "Squad assignments",
        value: shooterLines.join("\n"),
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
  };
}

function buildMatchDayEmbed(
  n: MatchNotification,
  matchUrl: string,
  ssiUrl: string,
): APIEmbed {
  const lines: string[] = [];
  lines.push(`**${n.matchName}** starts today!`);
  lines.push("");

  if (n.venue) {
    lines.push(n.venue);
  }
  if (n.level) {
    lines.push(n.level);
  }
  if (n.stagesCount > 0) {
    lines.push(`${n.stagesCount} stages`);
  }
  lines.push("");
  lines.push(`[SSI](${ssiUrl}) \u00b7 [Scoreboard](${matchUrl})`);

  const shooterLines = n.shooters.map((s) => {
    const squad = s.squadNumber != null ? `Squad ${s.squadNumber}` : "No squad";
    return `\u2022 <@${s.discordUserId}> \u2014 ${squad}`;
  });

  return {
    title: "Match day!",
    color: 0x22c55e, // green
    description: lines.join("\n"),
    fields: [
      {
        name: "Squad assignments",
        value: shooterLines.join("\n"),
        inline: false,
      },
    ],
    footer: { text: "Good luck and shoot safe!" },
    timestamp: new Date().toISOString(),
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
