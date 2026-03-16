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
    ],
    footer: {
      text:
        "I'll post here when linked shooters finish a stage. Use /unwatch to stop.",
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
