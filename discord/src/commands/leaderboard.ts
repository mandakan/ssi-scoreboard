// Handler for /leaderboard <match-query>
// Shows an at-a-glance ranking of linked shooters in a match:
// who's leading overall and who won each scored stage.

import type { APIEmbed } from "discord-api-types/v10";
import type { ScoreboardClient } from "../scoreboard-client";

interface TrackedCompetitor {
  competitorId: number;
  name: string;
}

export async function handleLeaderboard(
  client: ScoreboardClient,
  kv: KVNamespace,
  baseUrl: string,
  guildId: string,
  query: string,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  const events = await client.searchEvents(query);
  if (events.length === 0) {
    return { content: `No matches found for "${query}".`, embeds: [] };
  }

  const event = events[0];
  const match = await client.getMatch(event.content_type, event.id);

  const linkedShooters = await getGuildLinkedShooters(kv, guildId);
  if (linkedShooters.length === 0) {
    return {
      content:
        "No linked shooters in this server. Use `/link <name>` to connect your account first.",
      embeds: [],
    };
  }

  const tracked: TrackedCompetitor[] = [];
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
      content: `None of the linked shooters are competing in **${event.name}**.`,
      embeds: [],
    };
  }

  const compareResult = await client.compare(
    event.content_type,
    event.id,
    tracked.map((t) => t.competitorId),
  );

  // Compute per-shooter stats
  const shooterStats: Array<{
    name: string;
    competitorId: number;
    avgPercent: number;
    stagesScored: number;
    stageWins: number;
  }> = [];

  // Track stage winners among linked shooters
  const stageWinners: Array<{
    stageNum: number;
    stageName: string;
    winnerName: string;
    winnerHf: number;
  }> = [];

  for (const stage of compareResult.stages) {
    let bestHf = -1;
    let bestName = "";

    for (const t of tracked) {
      const result = stage.competitors[t.competitorId];
      if (!result || result.hit_factor == null || result.incomplete) continue;

      if (result.hit_factor > bestHf) {
        bestHf = result.hit_factor;
        bestName = t.name;
      }
    }

    if (bestHf >= 0) {
      stageWinners.push({
        stageNum: stage.stage_num,
        stageName: stage.stage_name,
        winnerName: bestName,
        winnerHf: bestHf,
      });
    }
  }

  for (const t of tracked) {
    const percents: number[] = [];
    let wins = 0;

    for (const stage of compareResult.stages) {
      const result = stage.competitors[t.competitorId];
      if (!result || result.hit_factor == null || result.incomplete) continue;
      if (result.overall_percent != null) {
        percents.push(result.overall_percent);
      }
    }

    // Count stage wins
    for (const sw of stageWinners) {
      if (sw.winnerName === t.name) wins++;
    }

    if (percents.length > 0) {
      shooterStats.push({
        name: t.name,
        competitorId: t.competitorId,
        avgPercent: percents.reduce((a, b) => a + b, 0) / percents.length,
        stagesScored: percents.length,
        stageWins: wins,
      });
    }
  }

  // Sort by avg percent descending
  shooterStats.sort((a, b) => b.avgPercent - a.avgPercent);

  const matchUrl = `${baseUrl}/match/${event.content_type}/${event.id}`;
  const fields: APIEmbed["fields"] = [];

  // Overall ranking table
  if (shooterStats.length > 0) {
    const lines: string[] = ["```"];
    lines.push(
      padR("#", 3) +
        padR("Name", 16) +
        padL("Avg%", 7) +
        padL("Wins", 5) +
        padL("Stgs", 5),
    );
    lines.push("-".repeat(36));

    shooterStats.forEach((s, i) => {
      const name =
        s.name.length > 15 ? s.name.slice(0, 14) + "." : s.name;
      lines.push(
        padR(String(i + 1), 3) +
          padR(name, 16) +
          padL(s.avgPercent.toFixed(1), 7) +
          padL(String(s.stageWins), 5) +
          padL(String(s.stagesScored), 5),
      );
    });

    lines.push("```");
    fields.push({ name: "Overall Ranking", value: lines.join("\n"), inline: false });
  }

  // Stage winners list
  if (stageWinners.length > 0) {
    stageWinners.sort((a, b) => a.stageNum - b.stageNum);
    const winnerLines = stageWinners.map(
      (sw) =>
        `**S${String(sw.stageNum).padStart(2, "0")}** ${sw.stageName} — ${sw.winnerName} (${sw.winnerHf.toFixed(4)} HF)`,
    );
    // Split into chunks if too long (1024 char limit per field)
    const chunks = chunkLines(winnerLines, 1000);
    chunks.forEach((chunk, i) => {
      fields.push({
        name: i === 0 ? "Stage Winners" : "Stage Winners (cont.)",
        value: chunk,
        inline: false,
      });
    });
  }

  const scoringLabel =
    event.scoring_completed === 100
      ? "Completed"
      : `${event.scoring_completed}% scored`;

  // Leader highlight
  const leader = shooterStats[0];
  let color = 0x5865f2; // blurple default
  if (leader?.avgPercent >= 90) color = 0x22c55e;
  else if (leader?.avgPercent >= 70) color = 0x3b82f6;
  else if (leader?.avgPercent >= 50) color = 0xf59e0b;

  const embed: APIEmbed = {
    title: `Leaderboard: ${event.name}`,
    url: matchUrl,
    description: leader
      ? `${leader.name} leads with ${leader.avgPercent.toFixed(1)}% avg — ${scoringLabel}`
      : scoringLabel,
    color,
    fields,
    footer: {
      text: `${tracked.length} linked shooter${tracked.length > 1 ? "s" : ""} tracked`,
    },
  };

  return { content: "", embeds: [embed] };
}

function chunkLines(lines: string[], maxLen: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current.length + line.length + 1 > maxLen && current) {
      chunks.push(current);
      current = "";
    }
    current += (current ? "\n" : "") + line;
  }
  if (current) chunks.push(current);
  return chunks;
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
