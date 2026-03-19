// Cron-triggered personal DM reminders.
// Scans all KV keys matching g:*:remind:* (but NOT remind-registrations or remind-squads),
// checks each user's tracked matches for milestones, and sends DMs.
//
// Triggers:
// - registration-open: registration_starts date is today
// - squadding-open: squadding_starts date is today
// - match-day-eve: match start date is tomorrow
// - match-day: match start date is today
//
// After all milestones for a match have fired, the match is auto-removed.

import type { APIEmbed } from "discord-api-types/v10";
import type { Env, UpcomingMatch } from "../types";
import { sendDirectMessage } from "../discord-api";
import { ScoreboardClient } from "../scoreboard-client";
import {
  personalReminderKey,
  daysUntil,
  getMatchAction,
  type PersonalReminderConfig,
  type PersonalReminder,
} from "../commands/remind";
import { isGuildNotificationHour } from "../guild-settings";

/** Live status for a specific match, resolved from the shooter dashboard. */
interface MatchStatus {
  isRegistered: boolean;
  isSquadded: boolean;
}

// Matches keys like g:{guildId}:remind:{userId}
// Does NOT match g:{guildId}:remind-registrations or g:{guildId}:remind-squads
const PERSONAL_REMIND_RE = /^g:([^:]+):remind:([^:]+)$/;

/** Return YYYY-MM-DD for tomorrow relative to today. */
function tomorrowStr(todayStr: string): string {
  const d = new Date(todayStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function pollPersonalReminders(env: Env): Promise<void> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const listed = await env.BOT_KV.list({ prefix: "g:" });

  // Cache per-guild notification hour check to avoid redundant KV reads
  const guildHourCache = new Map<string, boolean>();

  for (const key of listed.keys) {
    const match = PERSONAL_REMIND_RE.exec(key.name);
    if (!match) continue;

    const guildId = match[1];
    const userId = match[2];

    // Check if it's notification hour for this guild
    let isHour = guildHourCache.get(guildId);
    if (isHour === undefined) {
      isHour = await isGuildNotificationHour(env.BOT_KV, guildId);
      guildHourCache.set(guildId, isHour);
    }
    if (!isHour) continue;

    try {
      await processUserReminders(env, guildId, userId, todayStr);
    } catch (err) {
      console.error(
        `Error processing personal reminders for user ${userId} in guild ${guildId}:`,
        err,
      );
    }
  }
}

async function processUserReminders(
  env: Env,
  guildId: string,
  userId: string,
  todayStr: string,
): Promise<void> {
  const key = personalReminderKey(guildId, userId);
  const raw = await env.BOT_KV.get(key);
  if (!raw) return;

  const config: PersonalReminderConfig = JSON.parse(raw);
  if (config.matches.length === 0) return;

  let changed = false;
  const baseUrl = env.SCOREBOARD_BASE_URL;

  // Resolve live registration/squad status from the shooter dashboard.
  // Only fetched when a registration-open or squadding-open trigger is pending.
  const statusMap = await resolveMatchStatuses(env, guildId, userId, config, todayStr);

  for (const reminder of config.matches) {
    const matchRef = `${reminder.matchCt}:${reminder.matchId}`;
    const firedTriggers = config.notifiedEvents[matchRef] ?? [];
    const status = statusMap.get(matchRef) ?? null;

    const triggers: Array<{
      type: string;
      embed: APIEmbed;
    }> = [];

    // Registration opening
    if (
      reminder.registrationStarts &&
      reminder.registrationStarts.slice(0, 10) === todayStr &&
      !firedTriggers.includes("registration-open")
    ) {
      triggers.push({
        type: "registration-open",
        embed: buildRegistrationEmbed(reminder, baseUrl, status),
      });
    }

    // Squadding opening
    if (
      reminder.squaddingStarts &&
      reminder.squaddingStarts.slice(0, 10) === todayStr &&
      !firedTriggers.includes("squadding-open")
    ) {
      triggers.push({
        type: "squadding-open",
        embed: buildSquaddingEmbed(reminder, baseUrl, status),
      });
    }

    // Match day eve (24h before)
    const tomorrow = tomorrowStr(todayStr);
    if (
      reminder.matchDate &&
      reminder.matchDate.slice(0, 10) === tomorrow &&
      !firedTriggers.includes("match-day-eve")
    ) {
      triggers.push({
        type: "match-day-eve",
        embed: buildMatchDayEveEmbed(reminder, baseUrl),
      });
    }

    // Match day
    if (
      reminder.matchDate &&
      reminder.matchDate.slice(0, 10) === todayStr &&
      !firedTriggers.includes("match-day")
    ) {
      triggers.push({
        type: "match-day",
        embed: buildMatchDayEmbed(reminder, baseUrl),
      });
    }

    // Send DMs for triggered milestones
    for (const trigger of triggers) {
      await sendDirectMessage(
        env.DISCORD_BOT_TOKEN,
        userId,
        "",
        [trigger.embed],
      );

      if (!config.notifiedEvents[matchRef]) {
        config.notifiedEvents[matchRef] = [];
      }
      config.notifiedEvents[matchRef].push(trigger.type);
      changed = true;
    }
  }

  // ── Daily upcoming action digest ──────────────────────────────────────────
  if (config.dailyUpcoming && config.dailyUpcoming.lastSentDate !== todayStr) {
    try {
      const sent = await sendDailyDigest(env, guildId, userId, config.dailyUpcoming.days);
      config.dailyUpcoming.lastSentDate = todayStr;
      changed = true;
      if (sent) {
        console.log(`Sent daily upcoming digest to user ${userId} in guild ${guildId}`);
      }
    } catch (err) {
      console.error(`Failed to send daily digest for user ${userId}:`, err);
    }
  }

  // Auto-remove matches whose date has passed
  const before = config.matches.length;
  config.matches = config.matches.filter((m) => {
    if (!m.matchDate) return true;
    return m.matchDate.slice(0, 10) >= todayStr;
  });
  if (config.matches.length !== before) {
    changed = true;
    // Clean up notifiedEvents for removed matches
    const activeRefs = new Set(
      config.matches.map((m) => `${m.matchCt}:${m.matchId}`),
    );
    for (const ref of Object.keys(config.notifiedEvents)) {
      if (!activeRefs.has(ref)) {
        delete config.notifiedEvents[ref];
      }
    }
  }

  if (changed) {
    if (config.matches.length === 0) {
      await env.BOT_KV.delete(personalReminderKey(guildId, userId));
    } else {
      await env.BOT_KV.put(
        personalReminderKey(guildId, userId),
        JSON.stringify(config),
      );
    }
  }
}

// ── Status resolution ────────────────────────────────────────────────────────

/**
 * Fetch the linked shooter's dashboard and build a map of matchRef → live status.
 * Only called when at least one registration-open or squadding-open trigger is pending,
 * to avoid unnecessary API calls on days with no status-sensitive triggers.
 */
async function resolveMatchStatuses(
  env: Env,
  guildId: string,
  userId: string,
  config: PersonalReminderConfig,
  todayStr: string,
): Promise<Map<string, MatchStatus>> {
  const statusMap = new Map<string, MatchStatus>();

  // Check if any registration-open or squadding-open trigger is pending today
  const needsStatus = config.matches.some((m) => {
    const ref = `${m.matchCt}:${m.matchId}`;
    const fired = config.notifiedEvents[ref] ?? [];
    const regToday = m.registrationStarts?.slice(0, 10) === todayStr && !fired.includes("registration-open");
    const sqToday = m.squaddingStarts?.slice(0, 10) === todayStr && !fired.includes("squadding-open");
    return regToday || sqToday;
  });

  if (!needsStatus) return statusMap;

  // Resolve linked shooter
  const linkRaw = await env.BOT_KV.get(`g:${guildId}:link:${userId}`);
  if (!linkRaw) return statusMap;
  const { shooterId } = JSON.parse(linkRaw) as { shooterId: number };

  // Fetch dashboard — upcomingMatches includes live isRegistered/isSquadded
  try {
    const client = new ScoreboardClient(env.SCOREBOARD_BASE_URL);
    const dashboard = await client.getShooterDashboard(shooterId);
    for (const match of dashboard.upcomingMatches ?? []) {
      statusMap.set(`${match.ct}:${match.matchId}`, {
        isRegistered: match.isRegistered,
        isSquadded: match.isSquadded,
      });
    }
  } catch (err) {
    console.error(`Failed to fetch dashboard for status check (shooter ${shooterId}):`, err);
  }

  return statusMap;
}

// ── Embed builders ──────────────────────────────────────────────────────────

function buildRegistrationEmbed(
  reminder: PersonalReminder,
  baseUrl: string,
  status: MatchStatus | null,
): APIEmbed {
  const matchUrl = `${baseUrl}/match/${reminder.matchCt}/${reminder.matchId}`;
  const ssiUrl = `https://shootnscoreit.com/event/${reminder.matchCt}/${reminder.matchId}/`;

  const alreadyRegistered = status?.isRegistered ?? false;

  const lines: string[] = [];
  if (alreadyRegistered) {
    lines.push(`Registration opens **today** for **${reminder.matchName}** \u2014 you're already registered!`);
  } else {
    lines.push(`Registration opens **today** for **${reminder.matchName}**!`);
  }
  lines.push("");

  if (reminder.registrationStarts) {
    const unixTs = Math.floor(
      new Date(reminder.registrationStarts).getTime() / 1000,
    );
    lines.push(`Opens at: <t:${unixTs}:t> (<t:${unixTs}:R>)`);
    lines.push("");
  }

  if (reminder.matchDate) {
    lines.push(`Match date: ${formatDate(reminder.matchDate)}`);
    lines.push("");
  }

  if (alreadyRegistered) {
    lines.push(`[View on Scoreboard](${matchUrl}) \u00b7 [SSI](${ssiUrl})`);
  } else {
    lines.push(`[Register on SSI](${ssiUrl}) \u00b7 [View on Scoreboard](${matchUrl})`);
  }

  return {
    title: alreadyRegistered
      ? "Registration opens today \u2014 you're in!"
      : "Registration opens today!",
    color: alreadyRegistered ? 0x22c55e : 0xf59e0b, // green if done, amber if action needed
    description: lines.join("\n"),
    footer: { text: "Personal match reminder" },
    timestamp: new Date().toISOString(),
  };
}

function buildSquaddingEmbed(
  reminder: PersonalReminder,
  baseUrl: string,
  status: MatchStatus | null,
): APIEmbed {
  const matchUrl = `${baseUrl}/match/${reminder.matchCt}/${reminder.matchId}`;
  const ssiUrl = `https://shootnscoreit.com/event/${reminder.matchCt}/${reminder.matchId}/`;

  const alreadySquadded = status?.isSquadded ?? false;

  const lines: string[] = [];
  if (alreadySquadded) {
    lines.push(`Squadding opens **today** for **${reminder.matchName}** \u2014 you're already in a squad!`);
  } else {
    lines.push(`Squadding opens **today** for **${reminder.matchName}**!`);
  }
  lines.push("");

  if (reminder.squaddingStarts) {
    const unixTs = Math.floor(
      new Date(reminder.squaddingStarts).getTime() / 1000,
    );
    lines.push(`Opens at: <t:${unixTs}:t> (<t:${unixTs}:R>)`);
    lines.push("");
  }

  if (alreadySquadded) {
    lines.push("Your squad is locked in. Share this with friends who still need to squad!");
  } else {
    lines.push(
      "Squads are first-come-first-serve \u2014 be ready to pick your squad!",
    );
  }
  lines.push("");
  lines.push(`[Squad on SSI](${ssiUrl}) \u00b7 [View on Scoreboard](${matchUrl})`);

  return {
    title: alreadySquadded
      ? "Squadding opens today \u2014 you're set!"
      : "Squadding opens today!",
    color: alreadySquadded ? 0x22c55e : 0xef4444, // green if done, red if urgent
    description: lines.join("\n"),
    footer: { text: "Personal match reminder" },
    timestamp: new Date().toISOString(),
  };
}

function buildMatchDayEveEmbed(
  reminder: PersonalReminder,
  baseUrl: string,
): APIEmbed {
  const matchUrl = `${baseUrl}/match/${reminder.matchCt}/${reminder.matchId}`;
  const ssiUrl = `https://shootnscoreit.com/event/${reminder.matchCt}/${reminder.matchId}/`;

  const lines: string[] = [
    `**${reminder.matchName}** starts tomorrow!`,
    "",
    `[SSI](${ssiUrl}) \u00b7 [Scoreboard](${matchUrl})`,
  ];

  return {
    title: "Match starts tomorrow!",
    color: 0xf59e0b, // amber
    description: lines.join("\n"),
    footer: { text: "Time to pack your gear!" },
    timestamp: new Date().toISOString(),
  };
}

function buildMatchDayEmbed(
  reminder: PersonalReminder,
  baseUrl: string,
): APIEmbed {
  const matchUrl = `${baseUrl}/match/${reminder.matchCt}/${reminder.matchId}`;
  const ssiUrl = `https://shootnscoreit.com/event/${reminder.matchCt}/${reminder.matchId}/`;

  const lines: string[] = [
    `**${reminder.matchName}** starts today!`,
    "",
    `[SSI](${ssiUrl}) \u00b7 [Scoreboard](${matchUrl})`,
  ];

  return {
    title: "Match day!",
    color: 0x22c55e, // green
    description: lines.join("\n"),
    footer: { text: "Good luck and shoot safe!" },
    timestamp: new Date().toISOString(),
  };
}

// ── Daily upcoming action digest ──────────────────────────────────────────────

/**
 * Fetch the shooter's dashboard and send a DM with actionable upcoming matches.
 * Returns true if a DM was sent, false if skipped (no actionable items).
 */
async function sendDailyDigest(
  env: Env,
  guildId: string,
  userId: string,
  days: number,
): Promise<boolean> {
  // Resolve linked shooter
  const linkRaw = await env.BOT_KV.get(`g:${guildId}:link:${userId}`);
  if (!linkRaw) return false;
  const { shooterId, name: shooterName } = JSON.parse(linkRaw) as { shooterId: number; name: string };

  // Fetch dashboard
  const client = new ScoreboardClient(env.SCOREBOARD_BASE_URL);
  const dashboard = await client.getShooterDashboard(shooterId);
  const upcoming = dashboard.upcomingMatches ?? [];
  if (upcoming.length === 0) return false;

  // Filter to matches with actions within the window
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  const cutoffStr = cutoff.toISOString();

  const inWindow = upcoming.filter((m: UpcomingMatch) => {
    if (!m.date) return true;
    if (m.date <= cutoffStr) return true;
    if (m.registrationCloses && m.registrationCloses <= cutoffStr) return true;
    if (m.squaddingCloses && m.squaddingCloses <= cutoffStr) return true;
    if (m.registrationStarts && m.registrationStarts <= cutoffStr) return true;
    if (m.squaddingStarts && m.squaddingStarts <= cutoffStr) return true;
    return false;
  });
  if (inWindow.length === 0) return false;

  // Build action list sorted by priority
  const withActions = inWindow.map((m: UpcomingMatch) => ({ match: m, action: getMatchAction(m) }));
  withActions.sort((a, b) => {
    if (a.action.priority !== b.action.priority) return a.action.priority - b.action.priority;
    return (a.match.date ?? "").localeCompare(b.match.date ?? "");
  });

  // Only send if there's at least one actionable item (not all "you're set")
  const hasAction = withActions.some((w) => w.action.priority <= 5);
  if (!hasAction) return false;

  const baseUrl = env.SCOREBOARD_BASE_URL;
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

  const color = 0xf59e0b; // amber — there are actions to take

  const embed: APIEmbed = {
    title: `Daily checklist \u2014 ${inWindow.length} match${inWindow.length !== 1 ? "es" : ""}`,
    color,
    description: lines.join("\n\n"),
    footer: { text: `Linked as ${shooterName} \u00b7 /remind upcoming off to disable` },
    timestamp: new Date().toISOString(),
  };

  return sendDirectMessage(env.DISCORD_BOT_TOKEN, userId, "", [embed]);
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
