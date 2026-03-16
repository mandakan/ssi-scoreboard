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

  // Take the top result and fetch full match data for scoring/counts
  const event = events[0];
  const match = await client.getMatch(event.content_type, event.id);

  const scoringLabel =
    match.scoring_completed === 100
      ? "Completed"
      : match.scoring_completed > 0
        ? `${match.scoring_completed}% scored`
        : "Not started";

  const matchUrl = `${baseUrl}/match/${event.content_type}/${event.id}`;

  const embed: APIEmbed = {
    title: event.name,
    url: matchUrl,
    color: match.scoring_completed === 100 ? 0x22c55e : 0x3b82f6, // green or blue
    fields: [
      { name: "Venue", value: event.venue || "—", inline: true },
      { name: "Date", value: event.date || "—", inline: true },
      { name: "Level", value: event.level || "—", inline: true },
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
