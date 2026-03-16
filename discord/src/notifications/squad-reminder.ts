// Cron-triggered squad and match-day reminders.
// For each guild with a configured reminder:
// 1. Scans linked shooters' upcoming matches (from dashboard API)
// 2. Fetches match data for matches with relevant dates (squadding/match day)
// 3. Posts reminders with @ mentions showing squad assignments
//
// Squadding reminders fire N days before squadding opens (configurable,
// e.g. [0, 1, 7]). Day 0 = the day squadding opens. This is the most
// important trigger: squadding is first-come-first-serve, so shooters
// need to be ready at the exact opening time to squad together.

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
/**
 * Run the squad reminder for a single guild immediately.
 * Used to give instant feedback when a user configures the reminder.
 */
export async function runSquadReminderForGuild(
  env: Env,
  guildId: string,
): Promise<void> {
  const client = new ScoreboardClient(env.SCOREBOARD_BASE_URL);
  const todayStr = new Date().toISOString().slice(0, 10);
  await processGuildSquadReminder(env, client, guildId, todayStr);
}

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

/**
 * Trigger types:
 * - "squadding-N" — N days before squadding opens (0 = the day itself)
 * - "match-day"   — the day the match starts
 */
type TriggerType = string;

interface MatchNotification {
  ct: string;
  matchId: string;
  matchName: string;
  venue: string | null;
  date: string | null;
  level: string | null;
  triggerType: TriggerType;
  /** Shooters to @mention (unsquadded when squadding is already open, all otherwise). */
  shooters: MatchShooterInfo[];
  /** Shooters already in a squad — shown without @mention so others know which squad to join. */
  alreadySquadded: MatchShooterInfo[];
  /** The raw ISO timestamp when squadding opens (for displaying exact time). */
  squaddingStartsRaw: string | null;
  /** Whether squadding is currently open right now. */
  isSquaddingOpen: boolean;
  /** Days until squadding opens (0 = today, 1 = tomorrow, etc.). */
  daysUntilSquadding: number;
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
  const todayTime = new Date(todayStr).getTime();
  const msPerDay = 1000 * 60 * 60 * 24;

  for (const [ref, { upcoming, shooters }] of matchShooterMap) {
    const matchDate = upcoming.date ? upcoming.date.slice(0, 10) : null;

    const triggers: Array<{ type: TriggerType; daysUntilSquadding: number }> = [];

    // Match day check — always fires on match start date
    if (matchDate === todayStr) {
      if (!isAlreadyNotified(config, ref, "match-day")) {
        triggers.push({ type: "match-day", daysUntilSquadding: -1 });
      }
    }

    // Squadding checks — need full match data for squadding_starts
    let matchData: MatchResponse | null = null;
    try {
      matchData = await client.getMatch(
        parseInt(upcoming.ct, 10),
        parseInt(upcoming.matchId, 10),
      );
    } catch (err) {
      console.error(`Failed to get match ${ref}:`, err);
    }

    if (matchData?.squadding_starts) {
      const squaddingDateStr = matchData.squadding_starts.slice(0, 10);
      const squaddingTime = new Date(squaddingDateStr).getTime();
      const daysUntil = Math.round((squaddingTime - todayTime) / msPerDay);

      // Check each configured remind day
      for (const day of config.remindDays) {
        if (daysUntil === day) {
          const triggerKey = `squadding-${day}`;
          if (!isAlreadyNotified(config, ref, triggerKey)) {
            triggers.push({ type: triggerKey, daysUntilSquadding: day });
          }
        }
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

    const isOpen = matchData?.is_squadding_possible ?? false;

    for (const trigger of triggers) {
      // When squadding is already open, only @mention shooters who haven't
      // picked a squad yet. If everyone is squadded, skip entirely.
      // Already-squadded shooters are passed separately so the embed can
      // show them (without pinging) as a hint for which squad to join.
      let shootersToNotify = shooterInfos;
      let alreadySquadded: MatchShooterInfo[] = [];
      if (trigger.type.startsWith("squadding-") && isOpen) {
        shootersToNotify = shooterInfos.filter((s) => s.squadNumber == null);
        alreadySquadded = shooterInfos.filter((s) => s.squadNumber != null);
        if (shootersToNotify.length === 0) continue;
      }

      notifications.push({
        ct: upcoming.ct,
        matchId: upcoming.matchId,
        matchName: matchData?.name ?? upcoming.name,
        venue: matchData?.venue ?? upcoming.venue,
        date: upcoming.date,
        level: matchData?.level ?? upcoming.level,
        triggerType: trigger.type,
        shooters: shootersToNotify,
        alreadySquadded,
        squaddingStartsRaw: matchData?.squadding_starts ?? null,
        isSquaddingOpen: isOpen,
        daysUntilSquadding: trigger.daysUntilSquadding,
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

  // Clean up old notified events
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
 * Cap the notifiedEvents map to prevent unbounded KV growth.
 */
function pruneNotifiedEvents(config: SquadReminderConfig): void {
  const keys = Object.keys(config.notifiedEvents);
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

  if (notification.triggerType === "match-day") {
    return buildMatchDayEmbed(notification, matchUrl, ssiUrl);
  }
  // All squadding-N triggers
  return buildSquaddingEmbed(notification, matchUrl, ssiUrl);
}

function buildSquaddingEmbed(
  n: MatchNotification,
  matchUrl: string,
  ssiUrl: string,
): APIEmbed {
  const lines: string[] = [];

  if (n.daysUntilSquadding === 0) {
    // Day of — show exact opening time
    if (n.squaddingStartsRaw) {
      if (n.isSquaddingOpen) {
        lines.push(`Squadding is **OPEN** for **${n.matchName}**!`);
      } else {
        const unixTs = Math.floor(new Date(n.squaddingStartsRaw).getTime() / 1000);
        lines.push(`Squadding opens **today** for **${n.matchName}**!`);
        lines.push("");
        lines.push(`Opens at: <t:${unixTs}:t> (<t:${unixTs}:R>)`);
      }
    } else {
      lines.push(`Squadding opens today for **${n.matchName}**!`);
    }
  } else {
    // N days before
    const dayWord = n.daysUntilSquadding === 1 ? "tomorrow" : `in ${n.daysUntilSquadding} days`;
    lines.push(`Squadding opens **${dayWord}** for **${n.matchName}**!`);

    if (n.squaddingStartsRaw) {
      const unixTs = Math.floor(new Date(n.squaddingStartsRaw).getTime() / 1000);
      lines.push("");
      lines.push(`Opens: <t:${unixTs}:f> (<t:${unixTs}:R>)`);
    }
  }

  lines.push("");
  lines.push("Squads are first-come-first-serve \u2014 be ready to squad together!");
  lines.push("");

  if (n.venue || n.date) {
    const parts: string[] = [];
    if (n.date) parts.push(formatDate(n.date));
    if (n.venue) parts.push(n.venue);
    if (n.level) parts.push(n.level);
    lines.push(parts.join(" \u00b7 "));
    lines.push("");
  }

  lines.push(`[Squad on SSI](${ssiUrl}) \u00b7 [View on Scoreboard](${matchUrl})`);

  const shooterList = n.shooters
    .map((s) => `\u2022 <@${s.discordUserId}>`)
    .join("\n");

  const fieldName = n.isSquaddingOpen
    ? `Still need to squad (${n.shooters.length})`
    : `Ready up (${n.shooters.length})`;

  const fields: NonNullable<APIEmbed["fields"]> = [
    {
      name: fieldName,
      value: shooterList,
      inline: false,
    },
  ];

  // When squadding is open, show who already picked a squad (without pinging)
  // so the unsquadded shooters know which squad to join.
  if (n.alreadySquadded.length > 0) {
    const bySquad = new Map<number, string[]>();
    for (const s of n.alreadySquadded) {
      const sq = s.squadNumber!;
      const list = bySquad.get(sq) ?? [];
      list.push(s.shooterName);
      bySquad.set(sq, list);
    }

    const squaddedLines = [...bySquad.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([sq, names]) => `\u2022 **Squad ${sq}**: ${names.join(", ")}`)
      .join("\n");

    fields.push({
      name: "Already squadded",
      value: squaddedLines,
      inline: false,
    });
  }

  // Pick title based on state
  let title: string;
  if (n.daysUntilSquadding === 0) {
    title = n.isSquaddingOpen ? "Squadding is OPEN!" : "Squadding opens today!";
  } else if (n.daysUntilSquadding === 1) {
    title = "Squadding opens tomorrow!";
  } else {
    title = `Squadding opens in ${n.daysUntilSquadding} days`;
  }

  // Color: red for today (urgent), amber for tomorrow, blue for further out
  let color = 0x3b82f6; // blue
  if (n.daysUntilSquadding === 0) color = 0xef4444; // red — urgent
  else if (n.daysUntilSquadding === 1) color = 0xf59e0b; // amber

  return {
    title,
    color,
    description: lines.join("\n"),
    fields,
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
