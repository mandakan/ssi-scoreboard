// Handler for /shooter <name> and /me
// Looks up a shooter and returns dashboard stats.

import type { APIEmbed } from "discord-api-types/v10";
import type { ScoreboardClient } from "../scoreboard-client";

export async function handleShooter(
  client: ScoreboardClient,
  baseUrl: string,
  name: string,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  // First search for the shooter
  const results = await client.searchShooters(name);

  if (results.length === 0) {
    return {
      content: `No shooter found matching "${name}".`,
      embeds: [],
    };
  }

  const shooter = results[0];

  // Fetch full dashboard
  const dashboard = await client.getShooterDashboard(shooter.shooterId);
  const dashUrl = `${baseUrl}/shooter/${shooter.shooterId}`;

  const fields: APIEmbed["fields"] = [
    {
      name: "Matches",
      value: String(dashboard.matchCount),
      inline: true,
    },
    {
      name: "Stages",
      value: String(dashboard.stageCount),
      inline: true,
    },
  ];

  if (dashboard.avgMatchPercent != null) {
    fields.push({
      name: "Avg Match %",
      value: `${dashboard.avgMatchPercent.toFixed(1)}%`,
      inline: true,
    });
  }

  if (dashboard.club) {
    fields.push({
      name: "Club",
      value: dashboard.club,
      inline: true,
    });
  }

  if (dashboard.division) {
    fields.push({
      name: "Division",
      value: dashboard.division,
      inline: true,
    });
  }

  // Show achievements if any
  if (dashboard.achievements.length > 0) {
    const achievementText = dashboard.achievements
      .slice(0, 6)
      .map((a) => `${a.icon} ${a.name} (${a.tier})`)
      .join("\n");
    fields.push({
      name: "Achievements",
      value: achievementText,
      inline: false,
    });
  }

  // Show recent matches
  if (dashboard.recentMatches.length > 0) {
    const recentText = dashboard.recentMatches
      .slice(0, 3)
      .map((m) => {
        const pct = m.matchPercent != null ? ` — ${m.matchPercent.toFixed(1)}%` : "";
        return `• ${m.name} (${m.date})${pct}`;
      })
      .join("\n");
    fields.push({
      name: "Recent Matches",
      value: recentText,
      inline: false,
    });
  }

  const embed: APIEmbed = {
    title: dashboard.name,
    url: dashUrl,
    color: 0x8b5cf6, // purple
    fields,
  };

  let content = "";
  if (results.length > 1) {
    const others = results
      .slice(1, 4)
      .map((r) => `• ${r.name}${r.club ? ` (${r.club})` : ""}`)
      .join("\n");
    content = `Found ${results.length} shooters. Showing top result.\n\n**Did you mean:**\n${others}`;
  }

  return { content, embeds: [embed] };
}
