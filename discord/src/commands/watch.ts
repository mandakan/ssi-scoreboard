// Handler for /watch and /unwatch
// Manages live match watching — the cron trigger polls watched matches
// and posts notifications when linked shooters complete a stage.
//
// Notification model:
// - Tracks linked users (via /link) who are competitors in the watched match
// - When a linked shooter's scorecard appears for a new stage, posts their result
// - Posts to a dedicated channel configured via /watch (bot channel pattern)

import type { APIEmbed } from "discord-api-types/v10";
import type { ScoreboardClient } from "../scoreboard-client";

export interface WatchState {
  matchCt: number;
  matchId: number;
  matchName: string;
  channelId: string;
  lastScoringPct: number;
  /** Map of competitorId → set of stage IDs already notified about. */
  notifiedStages: Record<number, number[]>;
  createdAt: string;
}

/** KV key for a guild's watched match. */
export function watchKey(guildId: string): string {
  return `g:${guildId}:watch`;
}

export async function handleWatch(
  client: ScoreboardClient,
  kv: KVNamespace,
  baseUrl: string,
  guildId: string,
  channelId: string,
  query: string,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  // Check if already watching
  const existing = await kv.get(watchKey(guildId));
  if (existing) {
    const state: WatchState = JSON.parse(existing);
    return {
      content:
        `Already watching **${state.matchName}** in <#${state.channelId}>.\n` +
        `Use \`/unwatch\` first to stop watching, then \`/watch\` again.`,
      embeds: [],
    };
  }

  // Search for the match
  const events = await client.searchEvents(query);
  if (events.length === 0) {
    return {
      content: `No matches found for "${query}".`,
      embeds: [],
    };
  }

  const match = events[0];

  if (match.scoring_completed === 100) {
    return {
      content: `**${match.name}** is already fully scored. Nothing to watch.`,
      embeds: [],
    };
  }

  // Validate that there are linked shooters competing in this match
  const linkedShooters = await getGuildLinkedShooters(kv, guildId);
  if (linkedShooters.length === 0) {
    return {
      content:
        "No one in this server has linked their account yet.\n" +
        "Use `/link <your name>` to connect your Discord account to your SSI shooter profile, then try `/watch` again.",
      embeds: [],
    };
  }

  // Resolve linked shooters to match competitors
  const fullMatch = await client.getMatch(match.content_type, match.id);
  const trackedNames: string[] = [];
  for (const linked of linkedShooters) {
    const competitor = fullMatch.competitors.find(
      (c) => c.shooterId === linked.shooterId,
    );
    if (competitor) {
      trackedNames.push(competitor.name);
    }
  }

  if (trackedNames.length === 0) {
    const linkedNames = linkedShooters.map((s) => s.name).join(", ");
    return {
      content:
        `None of the linked shooters are competing in **${match.name}**.\n` +
        `Linked in this server: ${linkedNames}\n\n` +
        `If someone is missing, they can use \`/link <name>\` to connect their account.`,
      embeds: [],
    };
  }

  const state: WatchState = {
    matchCt: match.content_type,
    matchId: match.id,
    matchName: match.name,
    channelId,
    lastScoringPct: match.scoring_completed,
    notifiedStages: {},
    createdAt: new Date().toISOString(),
  };

  await kv.put(watchKey(guildId), JSON.stringify(state));

  const matchUrl = `${baseUrl}/match/${match.content_type}/${match.id}`;
  const statusLabel =
    match.scoring_completed > 0
      ? `${match.scoring_completed}% scored`
      : "Not started yet";

  const embed: APIEmbed = {
    title: `Now watching: ${match.name}`,
    url: matchUrl,
    color: 0xf59e0b, // amber
    fields: [
      { name: "Status", value: statusLabel, inline: true },
      { name: "Stages", value: String(match.stages_count), inline: true },
      { name: "Competitors", value: String(match.competitors_count), inline: true },
      { name: "Tracking", value: trackedNames.join(", "), inline: false },
    ],
    footer: {
      text:
        "I'll post here when these shooters finish a stage. Use /unwatch to stop.",
    },
  };

  return { content: "", embeds: [embed] };
}

export async function handleUnwatch(
  kv: KVNamespace,
  guildId: string,
): Promise<string> {
  const existing = await kv.get(watchKey(guildId));
  if (!existing) {
    return "Not currently watching any match.";
  }

  const state: WatchState = JSON.parse(existing);
  await kv.delete(watchKey(guildId));

  return `Stopped watching **${state.matchName}**.`;
}

async function getGuildLinkedShooters(
  kv: KVNamespace,
  guildId: string,
): Promise<Array<{ shooterId: number; name: string }>> {
  const prefix = `g:${guildId}:link:`;
  const listed = await kv.list({ prefix });
  const results: Array<{ shooterId: number; name: string }> = [];

  for (const key of listed.keys) {
    const raw = await kv.get(key.name);
    if (raw) {
      results.push(JSON.parse(raw));
    }
  }

  return results;
}
