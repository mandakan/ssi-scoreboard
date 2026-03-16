// Handler for /predict
// Manages match prediction game — users predict their match % and mikes count
// before a match starts. After the match, results are revealed with awards.

import type { APIEmbed } from "discord-api-types/v10";
import type { ScoreboardClient } from "../scoreboard-client";
import { getGuildLinkedShootersWithUsers } from "../linked-shooters";
import { parseEventRef } from "./autocomplete";
import {
  computeResults,
  computeAwards,
  formatResultsTable,
  formatAwards,
  type PredictionState,
  type Prediction,
} from "../predict-logic";

/** KV key for a guild+match prediction pool. */
export function predictKey(guildId: string, ct: number, matchId: number): string {
  return `g:${guildId}:predict:${ct}:${matchId}`;
}

/** KV key prefix for listing all prediction pools in a guild. */
export function predictPrefix(guildId: string): string {
  return `g:${guildId}:predict:`;
}

export async function handlePredict(
  client: ScoreboardClient,
  kv: KVNamespace,
  baseUrl: string,
  guildId: string,
  discordUserId: string,
  action: string | undefined,
  query: string | undefined,
  percent: number | undefined,
  mikes: number | undefined,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  if (action === "reveal") {
    return handleReveal(client, kv, baseUrl, guildId, query);
  }

  if (action === "status") {
    return handleStatus(kv, guildId, query);
  }

  // Default action: submit a prediction
  return handleSubmit(client, kv, guildId, discordUserId, query, percent, mikes);
}

async function handleSubmit(
  client: ScoreboardClient,
  kv: KVNamespace,
  guildId: string,
  discordUserId: string,
  query: string | undefined,
  percent: number | undefined,
  mikes: number | undefined,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  if (!query) {
    return { content: "Please specify a match to predict for.", embeds: [] };
  }
  if (percent == null) {
    return {
      content: "Please provide your predicted match percentage (0-100).",
      embeds: [],
    };
  }
  if (mikes == null) {
    return {
      content: "Please provide your predicted number of mikes (misses).",
      embeds: [],
    };
  }

  // Clamp percent to 0-100
  const clampedPct = Math.max(0, Math.min(100, percent));
  const clampedMikes = Math.max(0, Math.round(mikes));

  // Resolve the match
  let matchCt: number;
  let matchId: number;

  const ref = parseEventRef(query);
  if (ref) {
    matchCt = ref.ct;
    matchId = ref.id;
  } else {
    const events = await client.searchEvents(query);
    if (events.length === 0) {
      return { content: `No matches found for "${query}".`, embeds: [] };
    }
    matchCt = events[0].content_type;
    matchId = events[0].id;
  }

  // Fetch match data
  const match = await client.getMatch(matchCt, matchId);

  // Check that match hasn't started scoring yet
  if (match.scoring_completed > 0) {
    return {
      content: `**${match.name}** already has ${match.scoring_completed}% scored — predictions are locked!`,
      embeds: [],
    };
  }

  // Check that the user is linked and is a competitor
  const linkedShooters = await getGuildLinkedShootersWithUsers(kv, guildId);
  const linked = linkedShooters.find((s) => s.discordUserId === discordUserId);
  if (!linked) {
    return {
      content:
        "You need to link your account first with `/link <your name>` before making predictions.",
      embeds: [],
    };
  }

  const competitor = match.competitors.find(
    (c) => c.shooterId === linked.shooterId,
  );
  if (!competitor) {
    return {
      content: `You're not registered as a competitor in **${match.name}**. Only registered shooters can predict.`,
      embeds: [],
    };
  }

  // Load or create prediction state
  const key = predictKey(guildId, matchCt, matchId);
  const raw = await kv.get(key);
  let state: PredictionState;

  if (raw) {
    state = JSON.parse(raw);
    if (state.revealed) {
      return {
        content: `Predictions for **${match.name}** have already been revealed!`,
        embeds: [],
      };
    }
  } else {
    state = {
      matchCt,
      matchId,
      matchName: match.name,
      matchDate: match.date ?? "",
      predictions: {},
      revealed: false,
    };
  }

  const isUpdate = discordUserId in state.predictions;

  // Store prediction
  const prediction: Prediction = {
    discordUserId,
    shooterId: linked.shooterId,
    shooterName: linked.name,
    predictedPct: clampedPct,
    predictedMikes: clampedMikes,
    submittedAt: new Date().toISOString(),
  };
  state.predictions[discordUserId] = prediction;

  // Persist — expire after 30 days
  await kv.put(key, JSON.stringify(state), {
    expirationTtl: 30 * 24 * 60 * 60,
  });

  const verb = isUpdate ? "Updated" : "Locked in";
  const count = Object.keys(state.predictions).length;

  return {
    content:
      `${verb} your prediction for **${match.name}**:\n` +
      `> Match %: **${clampedPct}%** | Mikes: **${clampedMikes}**\n\n` +
      `${count} prediction${count === 1 ? "" : "s"} submitted so far. Good luck!`,
    embeds: [],
  };
}

async function handleReveal(
  client: ScoreboardClient,
  kv: KVNamespace,
  baseUrl: string,
  guildId: string,
  query: string | undefined,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  if (!query) {
    return { content: "Please specify which match to reveal predictions for.", embeds: [] };
  }

  // Resolve the match
  let matchCt: number;
  let matchId: number;

  const ref = parseEventRef(query);
  if (ref) {
    matchCt = ref.ct;
    matchId = ref.id;
  } else {
    const events = await client.searchEvents(query);
    if (events.length === 0) {
      return { content: `No matches found for "${query}".`, embeds: [] };
    }
    matchCt = events[0].content_type;
    matchId = events[0].id;
  }

  // Load prediction state
  const key = predictKey(guildId, matchCt, matchId);
  const raw = await kv.get(key);
  if (!raw) {
    return { content: "No predictions found for this match.", embeds: [] };
  }

  const state: PredictionState = JSON.parse(raw);
  const predictionCount = Object.keys(state.predictions).length;
  if (predictionCount === 0) {
    return { content: "No predictions were submitted for this match.", embeds: [] };
  }

  // Fetch match data to check scoring status
  const match = await client.getMatch(matchCt, matchId);
  if (match.scoring_completed < 95) {
    return {
      content:
        `**${state.matchName}** is only ${match.scoring_completed}% scored. ` +
        `Wait until scoring is complete (95%+) to reveal predictions.`,
      embeds: [],
    };
  }

  // Find competitor IDs for all predictors
  const competitorMap: Record<string, number> = {}; // userId -> competitorId
  for (const [userId, pred] of Object.entries(state.predictions)) {
    const competitor = match.competitors.find(
      (c) => c.shooterId === pred.shooterId,
    );
    if (competitor) {
      competitorMap[userId] = competitor.id;
    }
  }

  const competitorIds = Object.values(competitorMap);
  if (competitorIds.length === 0) {
    return {
      content: "None of the predictors are competitors in this match anymore.",
      embeds: [],
    };
  }

  // Fetch compare data with penalty stats for actual match %
  const compareResult = await client.compareWithPenaltyStats(
    matchCt,
    matchId,
    competitorIds,
  );

  // Build actual data map: userId -> { matchPctActual, totalMisses }
  const actualData: Record<string, { matchPctActual: number; totalMisses: number }> = {};

  for (const [userId, competitorId] of Object.entries(competitorMap)) {
    const penaltyStats = compareResult.penaltyStats?.[competitorId];
    if (penaltyStats) {
      // Sum total misses across all stages
      let totalMisses = 0;
      for (const stage of compareResult.stages) {
        const stageResult = stage.competitors[competitorId];
        if (stageResult?.miss_count != null) {
          totalMisses += stageResult.miss_count;
        }
      }

      actualData[userId] = {
        matchPctActual: penaltyStats.matchPctActual,
        totalMisses,
      };
    }
  }

  // Compute results and awards
  const results = computeResults(state.predictions, actualData);
  const awards = computeAwards(results);

  // Mark as revealed
  state.revealed = true;
  await kv.put(key, JSON.stringify(state), {
    expirationTtl: 7 * 24 * 60 * 60, // keep 7 days after reveal
  });

  const matchUrl = `${baseUrl}/match/${matchCt}/${matchId}`;
  const table = formatResultsTable(results);
  const awardText = formatAwards(awards);

  const embed: APIEmbed = {
    title: `Prediction Results — ${state.matchName}`,
    url: matchUrl,
    color: 0xf59e0b, // amber
    description: table + (awardText ? "\n" + awardText : ""),
    footer: {
      text: `${results.length} prediction${results.length === 1 ? "" : "s"} revealed`,
    },
  };

  return { content: "", embeds: [embed] };
}

async function handleStatus(
  kv: KVNamespace,
  guildId: string,
  query: string | undefined,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  if (!query) {
    // List all active predictions in guild
    const prefix = predictPrefix(guildId);
    const listed = await kv.list({ prefix });
    const active: Array<{ matchName: string; count: number; revealed: boolean }> = [];

    for (const key of listed.keys) {
      const raw = await kv.get(key.name);
      if (raw) {
        const state: PredictionState = JSON.parse(raw);
        active.push({
          matchName: state.matchName,
          count: Object.keys(state.predictions).length,
          revealed: state.revealed,
        });
      }
    }

    if (active.length === 0) {
      return {
        content: "No active prediction games in this server.",
        embeds: [],
      };
    }

    const lines = active.map(
      (a) =>
        `${a.revealed ? "\u2705" : "\u{1F52E}"} **${a.matchName}** — ${a.count} prediction${a.count === 1 ? "" : "s"}${a.revealed ? " (revealed)" : ""}`,
    );

    return {
      content: "**Active Predictions**\n" + lines.join("\n"),
      embeds: [],
    };
  }

  // Show predictions for a specific match (without revealing)
  const ref = parseEventRef(query);
  if (!ref) {
    return {
      content: "Please select a match from the autocomplete suggestions.",
      embeds: [],
    };
  }

  const key = predictKey(guildId, ref.ct, ref.id);
  const raw = await kv.get(key);
  if (!raw) {
    return { content: "No predictions found for this match.", embeds: [] };
  }

  const state: PredictionState = JSON.parse(raw);
  const count = Object.keys(state.predictions).length;

  return {
    content:
      `**${state.matchName}** — ${count} prediction${count === 1 ? "" : "s"} submitted` +
      (state.revealed ? " (already revealed)" : " (hidden until reveal)"),
    embeds: [],
  };
}
