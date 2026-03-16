// Cron-triggered personal DM reminders.
// Scans all KV keys matching g:*:remind:* (but NOT remind-registrations or remind-squads),
// checks each user's tracked matches for milestones, and sends DMs.
//
// Triggers:
// - registration-open: registration_starts date is today
// - squadding-open: squadding_starts date is today
// - match-day: match start date is today
//
// After all milestones for a match have fired, the match is auto-removed.

import type { APIEmbed } from "discord-api-types/v10";
import type { Env } from "../types";
import { sendDirectMessage } from "../discord-api";
import {
  personalReminderKey,
  type PersonalReminderConfig,
  type PersonalReminder,
} from "../commands/remind";

// Matches keys like g:{guildId}:remind:{userId}
// Does NOT match g:{guildId}:remind-registrations or g:{guildId}:remind-squads
const PERSONAL_REMIND_RE = /^g:([^:]+):remind:([^:]+)$/;

export async function pollPersonalReminders(env: Env): Promise<void> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const listed = await env.BOT_KV.list({ prefix: "g:" });

  for (const key of listed.keys) {
    const match = PERSONAL_REMIND_RE.exec(key.name);
    if (!match) continue;

    const guildId = match[1];
    const userId = match[2];

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

  for (const reminder of config.matches) {
    const matchRef = `${reminder.matchCt}:${reminder.matchId}`;
    const firedTriggers = config.notifiedEvents[matchRef] ?? [];

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
        embed: buildRegistrationEmbed(reminder, baseUrl),
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
        embed: buildSquaddingEmbed(reminder, baseUrl),
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

// ── Embed builders ──────────────────────────────────────────────────────────

function buildRegistrationEmbed(
  reminder: PersonalReminder,
  baseUrl: string,
): APIEmbed {
  const matchUrl = `${baseUrl}/match/${reminder.matchCt}/${reminder.matchId}`;
  const ssiUrl = `https://shootnscoreit.com/event/${reminder.matchCt}/${reminder.matchId}/`;

  const lines: string[] = [
    `Registration opens **today** for **${reminder.matchName}**!`,
    "",
  ];

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

  lines.push(`[Register on SSI](${ssiUrl}) \u00b7 [View on Scoreboard](${matchUrl})`);

  return {
    title: "Registration opens today!",
    color: 0xf59e0b, // amber
    description: lines.join("\n"),
    footer: { text: "Personal match reminder" },
    timestamp: new Date().toISOString(),
  };
}

function buildSquaddingEmbed(
  reminder: PersonalReminder,
  baseUrl: string,
): APIEmbed {
  const matchUrl = `${baseUrl}/match/${reminder.matchCt}/${reminder.matchId}`;
  const ssiUrl = `https://shootnscoreit.com/event/${reminder.matchCt}/${reminder.matchId}/`;

  const lines: string[] = [
    `Squadding opens **today** for **${reminder.matchName}**!`,
    "",
  ];

  if (reminder.squaddingStarts) {
    const unixTs = Math.floor(
      new Date(reminder.squaddingStarts).getTime() / 1000,
    );
    lines.push(`Opens at: <t:${unixTs}:t> (<t:${unixTs}:R>)`);
    lines.push("");
  }

  lines.push(
    "Squads are first-come-first-serve \u2014 be ready to pick your squad!",
  );
  lines.push("");
  lines.push(`[Squad on SSI](${ssiUrl}) \u00b7 [View on Scoreboard](${matchUrl})`);

  return {
    title: "Squadding opens today!",
    color: 0xef4444, // red — urgent
    description: lines.join("\n"),
    footer: { text: "Personal match reminder" },
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
