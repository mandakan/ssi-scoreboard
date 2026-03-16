// Handler for /shooter <name> and /me
// Looks up a shooter and returns dashboard stats.

import type { APIEmbed } from "discord-api-types/v10";
import type { ScoreboardClient } from "../scoreboard-client";
import type { ShooterSearchResult } from "../types";
import { parseShooterRef } from "./autocomplete";

/**
 * Look up a shooter by name search, then show their dashboard.
 * Used by `/shooter <name>`. Accepts autocomplete-resolved "sid:12345" values.
 */
export async function handleShooter(
  client: ScoreboardClient,
  baseUrl: string,
  name: string,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  // If autocomplete resolved the value, skip the search
  const shooterId = parseShooterRef(name);
  if (shooterId != null) {
    return buildShooterEmbed(client, baseUrl, shooterId);
  }

  const results = await client.searchShooters(name);

  if (results.length === 0) {
    return {
      content: `No shooter found matching "${name}".`,
      embeds: [],
    };
  }

  const shooter = results[0];
  return buildShooterEmbed(client, baseUrl, shooter.shooterId, results);
}

/**
 * Show the dashboard for a known shooter ID (skips name search).
 * Used by `/me` where we already have the shooterId from KV.
 */
export async function handleShooterById(
  client: ScoreboardClient,
  baseUrl: string,
  shooterId: number,
): Promise<{ content: string; embeds: APIEmbed[] }> {
  return buildShooterEmbed(client, baseUrl, shooterId);
}

async function buildShooterEmbed(
  client: ScoreboardClient,
  baseUrl: string,
  shooterId: number,
  searchResults?: ShooterSearchResult[],
): Promise<{ content: string; embeds: APIEmbed[] }> {
  const dashboard = await client.getShooterDashboard(shooterId);
  const dashUrl = `${baseUrl}/shooter/${shooterId}`;

  const profile = dashboard.profile;
  const displayName = profile?.name ?? `Shooter #${shooterId}`;

  const fields: APIEmbed["fields"] = [
    {
      name: "Matches",
      value: String(dashboard.matchCount),
      inline: true,
    },
    {
      name: "Stages",
      value: String(dashboard.stats?.totalStages ?? 0),
      inline: true,
    },
  ];

  if (dashboard.stats?.overallMatchPct != null) {
    fields.push({
      name: "Avg Match %",
      value: `${dashboard.stats.overallMatchPct.toFixed(1)}%`,
      inline: true,
    });
  }

  if (profile?.club) {
    fields.push({
      name: "Club",
      value: profile.club,
      inline: true,
    });
  }

  if (profile?.division) {
    fields.push({
      name: "Division",
      value: profile.division,
      inline: true,
    });
  }

  // Show achievements if any
  const achievements = dashboard.achievements ?? [];
  const unlocked = achievements.filter((a) => a.unlockedTiers.length > 0);
  if (unlocked.length > 0) {
    const achievementText = unlocked
      .slice(0, 6)
      .map((a) => `${a.definition.icon} ${a.definition.name}`)
      .join("\n");
    fields.push({
      name: "Achievements",
      value: achievementText,
      inline: false,
    });
  }

  // Show recent matches
  const matches = dashboard.matches ?? [];
  if (matches.length > 0) {
    const recentText = matches
      .slice(0, 3)
      .map((m) => {
        const pct = m.matchPct != null ? ` — ${m.matchPct.toFixed(1)}%` : "";
        return `• ${m.name} (${m.date ?? "?"})${pct}`;
      })
      .join("\n");
    fields.push({
      name: "Recent Matches",
      value: recentText,
      inline: false,
    });
  }

  const embed: APIEmbed = {
    title: displayName,
    url: dashUrl,
    color: 0x8b5cf6, // purple
    fields,
  };

  let content = "";
  if (searchResults && searchResults.length > 1) {
    const others = searchResults
      .slice(1, 4)
      .map((r) => `• ${r.name}${r.club ? ` (${r.club})` : ""}`)
      .join("\n");
    content = `Found ${searchResults.length} shooters. Showing top result.\n\n**Did you mean:**\n${others}`;
  }

  return { content, embeds: [embed] };
}
