// Cron-triggered notification logic.
// Polls watched matches, detects when linked shooters complete new stages,
// and posts results to the configured channel.
//
// When multiple linked shooters finish the same stage, they're grouped into
// a single embed with a comparison table (sorted by hit factor).

import type { APIEmbed } from "discord-api-types/v10";
import type { Env, CompetitorStageResult } from "../types";
import { ScoreboardClient } from "../scoreboard-client";
import { postChannelMessage } from "../discord-api";
import { watchKey, type WatchState } from "../commands/watch";

/** Prefix used to discover all guild watch keys. */
const WATCH_PREFIX = "g:";
const WATCH_SUFFIX = ":watch";

/**
 * Called by the cron trigger. Scans all watched matches across guilds,
 * detects newly scored stages for linked shooters, and posts notifications.
 */
export async function pollWatchedMatches(env: Env): Promise<void> {
  const client = new ScoreboardClient(env.SCOREBOARD_BASE_URL);

  // List all watch keys from KV
  const listed = await env.BOT_KV.list({ prefix: WATCH_PREFIX });

  for (const key of listed.keys) {
    if (!key.name.endsWith(WATCH_SUFFIX)) continue;

    const guildId = key.name.slice(WATCH_PREFIX.length, -WATCH_SUFFIX.length);

    try {
      await pollGuildWatch(env, client, guildId);
    } catch (err) {
      console.error(`Error polling watch for guild ${guildId}:`, err);
    }
  }
}

interface NewStageScore {
  competitorName: string;
  competitorId: number;
  stageId: number;
  stageName: string;
  stageNum: number;
  result: CompetitorStageResult;
  overallLeaderHf: number | null;
}

async function pollGuildWatch(
  env: Env,
  client: ScoreboardClient,
  guildId: string,
): Promise<void> {
  const raw = await env.BOT_KV.get(watchKey(guildId));
  if (!raw) return;

  const state: WatchState = JSON.parse(raw);

  // Find linked shooters in this guild
  const linkedShooters = await getGuildLinkedShooters(env.BOT_KV, guildId);
  if (linkedShooters.length === 0) return;

  // Get match data to resolve shooter IDs → competitor IDs
  const match = await client.getMatch(state.matchCt, state.matchId);

  const trackedCompetitors: Array<{
    competitorId: number;
    shooterId: number;
    name: string;
  }> = [];

  for (const linked of linkedShooters) {
    const competitor = match.competitors.find(
      (c) => c.shooterId === linked.shooterId,
    );
    if (competitor) {
      trackedCompetitors.push({
        competitorId: competitor.id,
        shooterId: linked.shooterId,
        name: competitor.name,
      });
    }
  }

  if (trackedCompetitors.length === 0) return;

  // Fetch compare data for tracked competitors
  const compareResult = await client.compare(
    state.matchCt,
    state.matchId,
    trackedCompetitors.map((c) => c.competitorId),
  );

  // SSI withholds per-stage scorecards while results visibility is "org" (live
  // matches). stages will be empty; skip detection and let the auto-unwatch
  // below fire when scoring eventually completes. Preserved: if SSI reinstates
  // live scorecard access, remove this early-return and detection resumes.
  if (compareResult.scorecardsRestricted) {
    if (isMatchDone(match.scoring_completed, match.date)) {
      await env.BOT_KV.delete(watchKey(guildId));
      const label = match.scoring_completed >= 95
        ? `**${state.matchName}** is fully scored!`
        : `**${state.matchName}** appears to be done (${match.scoring_completed}% scored, match date passed).`;
      await postChannelMessage(
        env.DISCORD_BOT_TOKEN,
        state.channelId,
        `${label} Stopped watching.\nFull results: ${env.SCOREBOARD_BASE_URL}/match/${state.matchCt}/${state.matchId}`,
      );
    }
    return;
  }

  // Detect newly scored stages per competitor
  const newScores: NewStageScore[] = [];
  const updatedNotified = { ...state.notifiedStages };

  for (const tracked of trackedCompetitors) {
    const prevStages = new Set(state.notifiedStages[tracked.competitorId] ?? []);

    for (const stage of compareResult.stages) {
      const result = stage.competitors[tracked.competitorId];
      if (!result) continue;

      const isScored = result.hit_factor != null && !result.incomplete;
      if (!isScored) continue;
      if (prevStages.has(stage.stage_id)) continue;

      newScores.push({
        competitorName: tracked.name,
        competitorId: tracked.competitorId,
        stageId: stage.stage_id,
        stageName: stage.stage_name,
        stageNum: stage.stage_num,
        result,
        overallLeaderHf: stage.overall_leader_hf,
      });

      if (!updatedNotified[tracked.competitorId]) {
        updatedNotified[tracked.competitorId] = [];
      }
      updatedNotified[tracked.competitorId].push(stage.stage_id);
    }
  }

  if (newScores.length > 0) {
    const baseUrl = env.SCOREBOARD_BASE_URL;
    const matchUrl = `${baseUrl}/match/${state.matchCt}/${state.matchId}`;

    // Group by stage for combined embeds
    const byStage = groupByStage(newScores);
    for (const group of byStage) {
      const embed = buildStageGroupEmbed(group, state.matchName, matchUrl);
      await postChannelMessage(env.DISCORD_BOT_TOKEN, state.channelId, "", [embed]);
    }

    // Update watch state
    state.notifiedStages = updatedNotified;
    state.lastScoringPct = match.scoring_completed;
    await env.BOT_KV.put(watchKey(guildId), JSON.stringify(state));
  }

  // Auto-unwatch when match is effectively done.
  // Same heuristic as the main app: scoring >= 95% OR > 3 days past match date.
  if (isMatchDone(match.scoring_completed, match.date)) {
    await env.BOT_KV.delete(watchKey(guildId));
    const label = match.scoring_completed >= 95
      ? `**${state.matchName}** is fully scored!`
      : `**${state.matchName}** appears to be done (${match.scoring_completed}% scored, match date passed).`;
    await postChannelMessage(
      env.DISCORD_BOT_TOKEN,
      state.channelId,
      `${label} Stopped watching.\nFull results: ${env.SCOREBOARD_BASE_URL}/match/${state.matchCt}/${state.matchId}`,
    );
  }
}

/**
 * Determines if a match should be considered done.
 * Mirrors the main app heuristic from lib/match-ttl.ts:
 *   scoring >= 95%  OR  match date is > 3 days ago
 */
export function isMatchDone(scoringPct: number, matchDate: string | null): boolean {
  if (scoringPct >= 95) return true;
  if (matchDate) {
    const daysSince =
      (Date.now() - new Date(matchDate).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 3) return true;
  }
  return false;
}

interface StageGroup {
  stageId: number;
  stageName: string;
  stageNum: number;
  overallLeaderHf: number | null;
  scores: Array<{
    competitorName: string;
    result: CompetitorStageResult;
  }>;
}

function groupByStage(scores: NewStageScore[]): StageGroup[] {
  const map = new Map<number, StageGroup>();

  for (const s of scores) {
    let group = map.get(s.stageId);
    if (!group) {
      group = {
        stageId: s.stageId,
        stageName: s.stageName,
        stageNum: s.stageNum,
        overallLeaderHf: s.overallLeaderHf,
        scores: [],
      };
      map.set(s.stageId, group);
    }
    group.scores.push({
      competitorName: s.competitorName,
      result: s.result,
    });
  }

  // Sort groups by stage number, scores within each group by HF descending
  const groups = [...map.values()].sort((a, b) => a.stageNum - b.stageNum);
  for (const group of groups) {
    group.scores.sort(
      (a, b) => (b.result.hit_factor ?? 0) - (a.result.hit_factor ?? 0),
    );
  }

  return groups;
}

/**
 * Build an embed for a stage group.
 * Single shooter: detailed card.
 * Multiple shooters: comparison table with HF, points, time, rank.
 */
export function buildStageGroupEmbed(
  group: StageGroup,
  matchName: string,
  matchUrl: string,
): APIEmbed {
  const fields: APIEmbed["fields"] = [];

  if (group.scores.length === 1) {
    // Single shooter — detailed view
    const { competitorName, result: r } = group.scores[0];
    fields.push({ name: "Shooter", value: competitorName, inline: true });

    if (r.hit_factor != null) {
      fields.push({ name: "HF", value: r.hit_factor.toFixed(4), inline: true });
    }
    if (r.time != null) {
      fields.push({ name: "Time", value: `${r.time.toFixed(2)}s`, inline: true });
    }
    if (r.points != null) {
      fields.push({ name: "Points", value: String(r.points), inline: true });
    }
    if (r.overall_rank != null) {
      fields.push({ name: "Stage Rank", value: `#${r.overall_rank}`, inline: true });
    }
    if (r.overall_percent != null) {
      fields.push({ name: "vs Leader", value: `${r.overall_percent.toFixed(1)}%`, inline: true });
    }

    const hits = formatHits(r);
    if (hits) {
      fields.push({ name: "Hits", value: hits, inline: false });
    }
  } else {
    // Multiple shooters — comparison table using code block for alignment
    const table = buildComparisonTable(group.scores);
    fields.push({ name: "Results", value: table, inline: false });
  }

  // Best performer's percentage determines embed color
  const bestPct = group.scores[0]?.result.overall_percent;
  let color = 0x6b7280; // gray
  if (bestPct != null) {
    if (bestPct >= 90) color = 0x22c55e;
    else if (bestPct >= 70) color = 0x3b82f6;
    else if (bestPct >= 50) color = 0xf59e0b;
    else color = 0xef4444;
  }

  return {
    title: `Stage ${group.stageNum}: ${group.stageName}`,
    url: matchUrl,
    color,
    fields,
    footer: { text: matchName },
  };
}

function buildComparisonTable(
  scores: Array<{ competitorName: string; result: CompetitorStageResult }>,
): string {
  // Use a code block for monospace alignment
  const lines: string[] = [];

  // Header
  lines.push("```");
  lines.push(
    padRight("Name", 16) +
    padLeft("HF", 8) +
    padLeft("Pts", 6) +
    padLeft("Time", 7) +
    padLeft("Rank", 6),
  );
  lines.push("-".repeat(43));

  for (const { competitorName, result: r } of scores) {
    const name = competitorName.length > 15
      ? competitorName.slice(0, 14) + "."
      : competitorName;
    const hf = r.hit_factor != null ? r.hit_factor.toFixed(4) : "—";
    const pts = r.points != null ? String(r.points) : "—";
    const time = r.time != null ? r.time.toFixed(2) : "—";
    const rank = r.overall_rank != null ? `#${r.overall_rank}` : "—";

    lines.push(
      padRight(name, 16) +
      padLeft(hf, 8) +
      padLeft(pts, 6) +
      padLeft(time, 7) +
      padLeft(rank, 6),
    );
  }

  lines.push("```");
  return lines.join("\n");
}

function formatHits(r: CompetitorStageResult): string | null {
  const parts: string[] = [];
  if (r.a_hits != null) parts.push(`${r.a_hits}A`);
  if (r.c_hits != null && r.c_hits > 0) parts.push(`${r.c_hits}C`);
  if (r.d_hits != null && r.d_hits > 0) parts.push(`${r.d_hits}D`);
  if (r.miss_count != null && r.miss_count > 0) parts.push(`${r.miss_count}M`);
  return parts.length > 0 ? parts.join(" / ") : null;
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

/**
 * Get all linked shooters for a guild by scanning KV keys.
 */
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
