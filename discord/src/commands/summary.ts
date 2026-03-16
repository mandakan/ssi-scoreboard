// Handler for /summary <match-query>
// Shows a per-stage breakdown for all linked shooters in a match.
// Each shooter gets their own embed with a table: HF, A, C, D, M, Proc per stage.

import type { APIEmbed } from "discord-api-types/v10";
import type { ScoreboardClient } from "../scoreboard-client";
import type { CompetitorStageResult } from "../types";
import { parseEventRef } from "./autocomplete";

interface ShooterStageRow {
  stageNum: number;
  stageName: string;
  result: CompetitorStageResult;
}

interface ShooterSummary {
  name: string;
  division: string;
  club: string;
  competitorId: number;
  stages: ShooterStageRow[];
  /** Overall match rank across all competitors. */
  overallRank: number | null;
  /** Average HF% vs stage leader across scored stages. */
  avgPercent: number | null;
}

export async function handleSummary(
  client: ScoreboardClient,
  kv: KVNamespace,
  baseUrl: string,
  guildId: string,
  query: string,
): Promise<{ content: string; embeds: APIEmbed[] }> {
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
      return { content: `No matches found for "${query}".`, embeds: [] };
    }
    const event = events[0];
    matchCt = event.content_type;
    matchId = event.id;
    matchName = event.name;
  }

  // Get match data to resolve linked shooters → competitor IDs
  const match = await client.getMatch(matchCt, matchId);
  if (!matchName) matchName = match.name;

  // Find linked shooters in this guild
  const linkedShooters = await getGuildLinkedShooters(kv, guildId);
  if (linkedShooters.length === 0) {
    return {
      content:
        "No linked shooters in this server. Use `/link <name>` to connect your account first.",
      embeds: [],
    };
  }

  // Map linked shooters to competitors in this match
  const tracked: Array<{ competitorId: number; name: string }> = [];
  for (const linked of linkedShooters) {
    const competitor = match.competitors.find(
      (c) => c.shooterId === linked.shooterId,
    );
    if (competitor) {
      tracked.push({ competitorId: competitor.id, name: competitor.name });
    }
  }

  if (tracked.length === 0) {
    return {
      content: `None of the linked shooters are competing in **${matchName}**.`,
      embeds: [],
    };
  }

  // Fetch compare data
  const compareResult = await client.compare(
    matchCt,
    matchId,
    tracked.map((t) => t.competitorId),
  );

  // Build per-shooter summaries
  const summaries: ShooterSummary[] = [];
  for (const t of tracked) {
    const compInfo = compareResult.competitors.find((c) => c.id === t.competitorId);
    const stages: ShooterStageRow[] = [];
    const percents: number[] = [];

    for (const stage of compareResult.stages) {
      const result = stage.competitors[t.competitorId];
      if (!result) continue;
      stages.push({
        stageNum: stage.stage_num,
        stageName: stage.stage_name,
        result,
      });
      if (result.overall_percent != null) {
        percents.push(result.overall_percent);
      }
    }

    stages.sort((a, b) => a.stageNum - b.stageNum);

    summaries.push({
      name: compInfo?.name ?? t.name,
      division: compInfo?.division ?? "",
      club: compInfo?.club ?? "",
      competitorId: t.competitorId,
      stages,
      overallRank: null, // filled below if available
      avgPercent:
        percents.length > 0
          ? percents.reduce((a, b) => a + b, 0) / percents.length
          : null,
    });
  }

  const matchUrl = `${baseUrl}/match/${matchCt}/${matchId}`;
  const scoringLabel =
    match.scoring_completed === 100
      ? "Completed"
      : match.scoring_completed > 0
        ? `${match.scoring_completed}% scored`
        : "Not started";

  const embeds: APIEmbed[] = [];

  // One embed per shooter
  for (const summary of summaries) {
    embeds.push(buildSummaryEmbed(summary, matchName, scoringLabel, matchUrl));
  }

  const content =
    tracked.length < linkedShooters.length
      ? `Showing ${tracked.length} of ${linkedShooters.length} linked shooters (others not in this match).`
      : "";

  return { content, embeds };
}

export function buildSummaryEmbed(
  summary: ShooterSummary,
  matchName: string,
  scoringLabel: string,
  matchUrl: string,
): APIEmbed {
  const fields: APIEmbed["fields"] = [];

  // Shooter info line
  const infoLine = [summary.division, summary.club].filter(Boolean).join(" | ");
  if (infoLine) {
    fields.push({ name: "Info", value: infoLine, inline: true });
  }
  if (summary.avgPercent != null) {
    fields.push({
      name: "Avg %",
      value: `${summary.avgPercent.toFixed(1)}%`,
      inline: true,
    });
  }
  fields.push({ name: "Status", value: scoringLabel, inline: true });

  // Stage table
  const scoredStages = summary.stages.filter(
    (s) => s.result.hit_factor != null && !s.result.incomplete,
  );
  const unscoredCount = summary.stages.length - scoredStages.length;

  if (scoredStages.length > 0) {
    const table = buildStageTable(scoredStages);
    fields.push({ name: "Stage Results", value: table, inline: false });
  }

  if (unscoredCount > 0) {
    fields.push({
      name: "Pending",
      value: `${unscoredCount} stage${unscoredCount > 1 ? "s" : ""} not yet scored`,
      inline: false,
    });
  }

  // Color based on avg percent
  let color = 0x6b7280;
  if (summary.avgPercent != null) {
    if (summary.avgPercent >= 90) color = 0x22c55e;
    else if (summary.avgPercent >= 70) color = 0x3b82f6;
    else if (summary.avgPercent >= 50) color = 0xf59e0b;
    else color = 0xef4444;
  }

  return {
    title: summary.name,
    url: matchUrl,
    color,
    fields,
    footer: { text: matchName },
  };
}

function buildStageTable(stages: ShooterStageRow[]): string {
  const lines: string[] = [];
  lines.push("```");
  lines.push(
    padR("Stg", 5) +
      padL("HF", 8) +
      padL("A", 4) +
      padL("C", 4) +
      padL("D", 4) +
      padL("M", 4) +
      padL("Pr", 4) +
      padL("%", 6),
  );
  lines.push("-".repeat(39));

  for (const { stageNum, result: r } of stages) {
    const hf = r.hit_factor != null ? r.hit_factor.toFixed(4) : "—";
    const a = r.a_hits != null ? String(r.a_hits) : "—";
    const c = r.c_hits != null ? String(r.c_hits) : "—";
    const d = r.d_hits != null ? String(r.d_hits) : "—";
    const m = r.miss_count != null ? String(r.miss_count) : "—";
    const proc = r.dnf ? "DNF" : "0"; // procedurals not in CompetitorStageResult yet
    const pct =
      r.overall_percent != null ? `${r.overall_percent.toFixed(1)}` : "—";

    lines.push(
      padR(`S${String(stageNum).padStart(2, "0")}`, 5) +
        padL(hf, 8) +
        padL(a, 4) +
        padL(c, 4) +
        padL(d, 4) +
        padL(m, 4) +
        padL(proc, 4) +
        padL(pct, 6),
    );
  }

  lines.push("```");
  return lines.join("\n");
}

function padR(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function padL(s: string, len: number): string {
  return s.length >= len ? s : " ".repeat(len - s.length) + s;
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
