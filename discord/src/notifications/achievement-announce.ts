// Cron-triggered achievement announcements.
// Polls linked shooters' dashboards, detects new achievement tier unlocks,
// and posts celebratory embeds to the guild's configured channel.
//
// On first check for a shooter, snapshots current achievements silently
// (no spam for historical unlocks).
//
// Achievement checks piggyback on the existing cron cycle. The channel
// is resolved from /watch or /remind-squads config (first found).

import type { APIEmbed } from "discord-api-types/v10";
import type { Env } from "../types";
import { ScoreboardClient } from "../scoreboard-client";
import { postChannelMessage } from "../discord-api";
import {
  getGuildLinkedShootersWithUsers,
  type LinkedShooterWithUser,
} from "../linked-shooters";
import { watchKey } from "../commands/watch";
import { squadReminderKey } from "../commands/remind-squads";

// ── KV schema ──────────────────────────────────────────────────────────────

/** Stored achievement snapshot for a shooter in a guild. */
export interface AchievementSnapshot {
  /** Array of { achievementId, tier } representing highest unlocked tier per achievement. */
  achievements: Array<{ id: string; tier: number }>;
  lastChecked: string;
}

/** KV key for a guild+shooter achievement snapshot. */
export function achievementKey(guildId: string, shooterId: number): string {
  return `g:${guildId}:achievements:${shooterId}`;
}

// ── Achievement diff ───────────────────────────────────────────────────────

/** Represents a newly unlocked achievement tier. */
export interface AchievementUnlock {
  achievementId: string;
  achievementName: string;
  achievementIcon: string;
  tierLevel: number;
  tierName: string;
  tierLabel: string;
  /** All tiers for this achievement (for rendering the tier ladder). */
  allTiers: Array<{ level: number; name: string; label: string }>;
  /** All unlocked tier levels (including the new one). */
  unlockedLevels: number[];
  /** Next tier to unlock (null if maxed out). */
  nextTier: { name: string; label: string } | null;
}

/**
 * Pure function: compute new unlocks by diffing dashboard achievements against snapshot.
 * Returns the list of newly unlocked tiers (may be empty).
 */
export function diffAchievements(
  dashboardAchievements: Array<{
    definition: { id: string; name: string; icon: string; tiers: Array<{ level: number; name: string; label: string }> };
    unlockedTiers: Array<{ level: number }>;
    nextTier: { name: string; label: string } | null;
  }>,
  snapshot: AchievementSnapshot | null,
): AchievementUnlock[] {
  const snapshotMap = new Map<string, number>();
  if (snapshot) {
    for (const a of snapshot.achievements) {
      snapshotMap.set(a.id, a.tier);
    }
  }

  const unlocks: AchievementUnlock[] = [];

  for (const achievement of dashboardAchievements) {
    if (achievement.unlockedTiers.length === 0) continue;

    const highestUnlocked = Math.max(
      ...achievement.unlockedTiers.map((t) => t.level),
    );
    const previousHighest = snapshotMap.get(achievement.definition.id) ?? 0;

    if (highestUnlocked > previousHighest) {
      // Find newly unlocked tiers (all tiers above previous highest)
      const newTierLevels = achievement.unlockedTiers
        .map((t) => t.level)
        .filter((level) => level > previousHighest)
        .sort((a, b) => a - b);

      for (const level of newTierLevels) {
        const tierDef = achievement.definition.tiers.find(
          (t) => t.level === level,
        );
        if (!tierDef) continue;

        unlocks.push({
          achievementId: achievement.definition.id,
          achievementName: achievement.definition.name,
          achievementIcon: achievement.definition.icon,
          tierLevel: level,
          tierName: tierDef.name,
          tierLabel: tierDef.label,
          allTiers: achievement.definition.tiers.map((t) => ({
            level: t.level,
            name: t.name,
            label: t.label,
          })),
          unlockedLevels: achievement.unlockedTiers.map((t) => t.level),
          nextTier: achievement.nextTier
            ? { name: achievement.nextTier.name, label: achievement.nextTier.label }
            : null,
        });
      }
    }
  }

  return unlocks;
}

/**
 * Build the new snapshot from dashboard achievements.
 * Stores the highest unlocked tier per achievement.
 */
export function buildSnapshot(
  dashboardAchievements: Array<{
    definition: { id: string };
    unlockedTiers: Array<{ level: number }>;
  }>,
): AchievementSnapshot {
  const achievements: AchievementSnapshot["achievements"] = [];

  for (const a of dashboardAchievements) {
    if (a.unlockedTiers.length === 0) continue;
    const highest = Math.max(...a.unlockedTiers.map((t) => t.level));
    achievements.push({ id: a.definition.id, tier: highest });
  }

  return {
    achievements,
    lastChecked: new Date().toISOString(),
  };
}

// ── Icon mapping ───────────────────────────────────────────────────────────

/** Map Lucide icon names to Unicode/emoji equivalents for Discord. */
const ICON_MAP: Record<string, string> = {
  trophy: "\u{1F3C6}",
  swords: "\u2694\uFE0F",
  award: "\u{1F3C5}",
  globe: "\u{1F30D}",
  ban: "\u{1F6AB}",
  crosshair: "\u{1F3AF}",
  target: "\u{1F3AF}",
  "shield-check": "\u{1F6E1}\uFE0F",
  "map-pin": "\u{1F4CD}",
  shuffle: "\u{1F500}",
  users: "\u{1F465}",
  "repeat-2": "\u{1F504}",
  sparkles: "\u2728",
  flag: "\u{1F3F4}",
  "calendar-days": "\u{1F4C5}",
};

function iconEmoji(lucideIcon: string): string {
  return ICON_MAP[lucideIcon] ?? "\u2B50";
}

// ── Embed builder ──────────────────────────────────────────────────────────

/**
 * Build a celebratory embed for one or more achievement unlocks for a single shooter.
 */
export function buildAchievementEmbed(
  shooterName: string,
  shooterId: number,
  unlocks: AchievementUnlock[],
  baseUrl: string,
): APIEmbed {
  const dashUrl = `${baseUrl}/shooter/${shooterId}`;

  // Use the category of the first (or most significant) unlock for color
  // Since we don't have category in the unlock, default to gold
  const color = 0xf59e0b; // gold — celebratory

  const fields: NonNullable<APIEmbed["fields"]> = [];

  for (const unlock of unlocks) {
    const emoji = iconEmoji(unlock.achievementIcon);

    // Build tier ladder: show all tiers with checkmarks for unlocked
    const ladderLines = unlock.allTiers.map((t) => {
      const isUnlocked = unlock.unlockedLevels.includes(t.level);
      const isNew = t.level === unlock.tierLevel;
      if (isNew) return `**\u2B50 ${t.name}** (${t.label}) \u2190 NEW!`;
      if (isUnlocked) return `\u2705 ${t.name} (${t.label})`;
      return `\u2B1C ${t.name} (${t.label})`;
    });

    // Add next goal hint
    if (unlock.nextTier) {
      ladderLines.push(`\nNext: **${unlock.nextTier.name}** (${unlock.nextTier.label})`);
    }

    fields.push({
      name: `${emoji} ${unlock.achievementName} \u2014 ${unlock.tierName}`,
      value: ladderLines.join("\n"),
      inline: false,
    });
  }

  const title =
    unlocks.length === 1
      ? `${shooterName} unlocked a new achievement!`
      : `${shooterName} unlocked ${unlocks.length} new achievements!`;

  return {
    title,
    url: dashUrl,
    color,
    fields,
    footer: { text: "View full achievements on the dashboard" },
    timestamp: new Date().toISOString(),
  };
}

// ── Channel resolution ─────────────────────────────────────────────────────

/**
 * Find the best channel to post achievement announcements in.
 * Priority: /watch channel > /remind-squads channel.
 * Returns null if no channel is configured.
 */
async function resolveAnnouncementChannel(
  kv: KVNamespace,
  guildId: string,
): Promise<string | null> {
  // Try watch channel first
  const watchRaw = await kv.get(watchKey(guildId));
  if (watchRaw) {
    const watchState = JSON.parse(watchRaw);
    if (watchState.channelId) return watchState.channelId;
  }

  // Try remind-squads channel
  const squadRaw = await kv.get(squadReminderKey(guildId));
  if (squadRaw) {
    const squadConfig = JSON.parse(squadRaw);
    if (squadConfig.channelId) return squadConfig.channelId;
  }

  return null;
}

// ── Main cron poller ───────────────────────────────────────────────────────

/**
 * Called by the cron trigger. Scans all guilds with linked shooters,
 * checks for new achievement unlocks, and posts announcements.
 */
export async function pollAchievements(env: Env): Promise<void> {
  const client = new ScoreboardClient(env.SCOREBOARD_BASE_URL);

  // Find all guilds that have linked shooters by scanning link keys
  const listed = await env.BOT_KV.list({ prefix: "g:" });

  // Collect unique guild IDs from link keys
  const guildIds = new Set<string>();
  const linkKeyRe = /^g:([^:]+):link:/;
  for (const key of listed.keys) {
    const match = linkKeyRe.exec(key.name);
    if (match) guildIds.add(match[1]);
  }

  for (const guildId of guildIds) {
    try {
      await processGuildAchievements(env, client, guildId);
    } catch (err) {
      console.error(
        `Error checking achievements for guild ${guildId}:`,
        err,
      );
    }
  }
}

async function processGuildAchievements(
  env: Env,
  client: ScoreboardClient,
  guildId: string,
): Promise<void> {
  // Resolve announcement channel — skip guild if none configured
  const channelId = await resolveAnnouncementChannel(env.BOT_KV, guildId);
  if (!channelId) return;

  // Get all linked shooters
  const linkedShooters = await getGuildLinkedShootersWithUsers(
    env.BOT_KV,
    guildId,
  );
  if (linkedShooters.length === 0) return;

  const baseUrl = env.SCOREBOARD_BASE_URL;

  for (const shooter of linkedShooters) {
    try {
      await checkShooterAchievements(
        env,
        client,
        guildId,
        channelId,
        shooter,
        baseUrl,
      );
    } catch (err) {
      console.error(
        `Error checking achievements for shooter ${shooter.shooterId} in guild ${guildId}:`,
        err,
      );
    }
  }
}

async function checkShooterAchievements(
  env: Env,
  client: ScoreboardClient,
  guildId: string,
  channelId: string,
  shooter: LinkedShooterWithUser,
  baseUrl: string,
): Promise<void> {
  const kvKey = achievementKey(guildId, shooter.shooterId);

  // Fetch dashboard
  const dashboard = await client.getShooterDashboard(shooter.shooterId);
  const achievements = dashboard.achievements ?? [];

  if (achievements.length === 0) return;

  // Load existing snapshot
  const snapshotRaw = await env.BOT_KV.get(kvKey);
  const snapshot: AchievementSnapshot | null = snapshotRaw
    ? JSON.parse(snapshotRaw)
    : null;

  // First time seeing this shooter — snapshot silently (no spam)
  if (!snapshot) {
    const newSnapshot = buildSnapshot(achievements);
    await env.BOT_KV.put(kvKey, JSON.stringify(newSnapshot));
    return;
  }

  // Diff against snapshot
  const unlocks = diffAchievements(achievements, snapshot);

  if (unlocks.length > 0) {
    // Post announcement
    const embed = buildAchievementEmbed(
      shooter.name,
      shooter.shooterId,
      unlocks,
      baseUrl,
    );

    const mention = `<@${shooter.discordUserId}>`;
    await postChannelMessage(env.DISCORD_BOT_TOKEN, channelId, mention, [
      embed,
    ]);
  }

  // Always update snapshot (even if no unlocks, to update lastChecked)
  const newSnapshot = buildSnapshot(achievements);
  await env.BOT_KV.put(kvKey, JSON.stringify(newSnapshot));
}
