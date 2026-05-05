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
import { parseEventRef } from "./autocomplete";

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

  // Resolve the match — autocomplete pre-resolved or search fallback
  let matchCt: number;
  let matchId: number;
  let matchName: string;

  const ref = parseEventRef(query);
  if (ref) {
    matchCt = ref.ct;
    matchId = ref.id;
    matchName = ""; // filled from getMatch below
  } else {
    const events = await client.searchEvents(query);
    if (events.length === 0) {
      return {
        content: `No matches found for "${query}".`,
        embeds: [],
      };
    }
    const event = events[0];
    matchCt = event.content_type;
    matchId = event.id;
    matchName = event.name;
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

  // Fetch full match data for scoring status, counts, and competitor resolution
  const fullMatch = await client.getMatch(matchCt, matchId);
  if (!matchName) matchName = fullMatch.name;

  if (fullMatch.scoring_completed === 100) {
    return {
      content: `**${matchName}** is already fully scored. Nothing to watch.`,
      embeds: [],
    };
  }

  // Resolve linked shooters to match competitors
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
        `None of the linked shooters are competing in **${matchName}**.\n` +
        `Linked in this server: ${linkedNames}\n\n` +
        `If someone is missing, they can use \`/link <name>\` to connect their account.`,
      embeds: [],
    };
  }

  const state: WatchState = {
    matchCt,
    matchId,
    matchName,
    channelId,
    lastScoringPct: fullMatch.scoring_completed,
    notifiedStages: {},
    createdAt: new Date().toISOString(),
  };

  await kv.put(watchKey(guildId), JSON.stringify(state));

  const matchUrl = `${baseUrl}/match/${matchCt}/${matchId}`;
  const statusLabel =
    fullMatch.scoring_completed > 0
      ? `${fullMatch.scoring_completed}% scored`
      : "Not started yet";

  // SSI currently withholds per-stage scorecards while a match is live, so
  // live stage notifications are unavailable until scoring completes. The watch
  // state is stored anyway so results post automatically once done. If SSI
  // reinstates live access, this branch can be removed to restore real-time
  // notifications.
  const isLive =
    fullMatch.scoring_completed < 95 &&
    (() => {
      if (!fullMatch.date) return true;
      const daysSince =
        (Date.now() - new Date(fullMatch.date).getTime()) / (1000 * 60 * 60 * 24);
      return daysSince <= 3;
    })();
  const footerText = isLive
    ? "Detailed results will post once scoring is complete. Use /unwatch to cancel."
    : "I'll post here when these shooters finish a stage. Use /unwatch to stop.";

  const embed: APIEmbed = {
    title: `Now watching: ${matchName}`,
    url: matchUrl,
    color: 0xf59e0b, // amber
    fields: [
      { name: "Status", value: statusLabel, inline: true },
      { name: "Stages", value: String(fullMatch.stages_count), inline: true },
      { name: "Competitors", value: String(fullMatch.competitors_count), inline: true },
      { name: "Tracking", value: trackedNames.join(", "), inline: false },
    ],
    footer: { text: footerText },
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
