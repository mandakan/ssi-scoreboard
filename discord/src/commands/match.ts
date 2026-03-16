// Handler for /match <query>
// Searches for events and returns a rich embed with match overview.

import type { APIEmbed } from "discord-api-types/v10";
import type { ScoreboardClient } from "../scoreboard-client";

export async function handleMatch(
  client: ScoreboardClient,
  baseUrl: string,
  query: string,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  const events = await client.searchEvents(query);

  if (events.length === 0) {
    return {
      content: `No matches found for "${query}".`,
      embeds: [],
    };
  }

  // Take the top result
  const match = events[0];
  const scoringLabel =
    match.scoring_completed === 100
      ? "Completed"
      : match.scoring_completed > 0
        ? `${match.scoring_completed}% scored`
        : "Not started";

  const matchUrl = `${baseUrl}/match/${match.content_type}/${match.id}`;

  const embed: APIEmbed = {
    title: match.name,
    url: matchUrl,
    color: match.scoring_completed === 100 ? 0x22c55e : 0x3b82f6, // green or blue
    fields: [
      { name: "Venue", value: match.venue || "—", inline: true },
      { name: "Date", value: match.date || "—", inline: true },
      { name: "Level", value: match.level || "—", inline: true },
      {
        name: "Stages",
        value: String(match.stages_count),
        inline: true,
      },
      {
        name: "Competitors",
        value: String(match.competitors_count),
        inline: true,
      },
      { name: "Status", value: scoringLabel, inline: true },
    ],
  };

  // If there are multiple results, mention them
  let content = "";
  if (events.length > 1) {
    const others = events
      .slice(1, 4)
      .map((e) => `• ${e.name} (${e.date})`)
      .join("\n");
    content = `Found ${events.length} matches. Showing top result.\n\n**Other matches:**\n${others}`;
  }

  return { content, embeds: [embed] };
}
