// Handler for /link <name> and /unlink
// Links/unlinks a Discord user to an SSI shooter ID via KV.
// All KV keys are scoped by guild ID to prevent cross-server data leaks.

import type { ScoreboardClient } from "../scoreboard-client";
import { parseShooterRef } from "./autocomplete";

/** What linking your account enables — shown after /link. */
const LINK_BENEFITS =
  "\n\n**What this enables:**\n" +
  "\u2022 `/me` — your personal shooter dashboard\n" +
  "\u2022 `/summary` `/leaderboard` — you'll appear in match breakdowns\n" +
  "\u2022 `/watch` — get stage-by-stage updates during live matches\n" +
  "\u2022 `/remind-squads` — reminders when squadding opens or match day arrives\n" +
  "\nUse `/unlink` to disconnect your account.";

export async function handleLink(
  client: ScoreboardClient,
  kv: KVNamespace,
  guildId: string,
  discordUserId: string,
  name: string,
): Promise<string> {
  // If autocomplete resolved the value, use the shooter ID directly
  const resolvedId = parseShooterRef(name);
  if (resolvedId != null) {
    const dashboard = await client.getShooterDashboard(resolvedId);
    const profile = dashboard.profile;
    const shooterName = profile?.name ?? `Shooter #${resolvedId}`;

    await kv.put(
      kvKey(guildId, discordUserId),
      JSON.stringify({
        shooterId: resolvedId,
        name: shooterName,
      }),
    );

    let msg = `Linked your account to **${shooterName}** (ID: ${resolvedId}).`;
    if (profile?.club) msg += `\nClub: ${profile.club}`;
    msg += LINK_BENEFITS;
    return msg;
  }

  // Fallback: search by name
  const results = await client.searchShooters(name);

  if (results.length === 0) {
    return `No shooter found matching "${name}". Check the spelling and try again.`;
  }

  const shooter = results[0];

  // Store the mapping scoped to this guild
  await kv.put(
    kvKey(guildId, discordUserId),
    JSON.stringify({
      shooterId: shooter.shooterId,
      name: shooter.name,
    }),
  );

  let msg = `Linked your account to **${shooter.name}** (ID: ${shooter.shooterId}).`;
  if (shooter.club) msg += `\nClub: ${shooter.club}`;
  msg += LINK_BENEFITS;

  if (results.length > 1) {
    const others = results
      .slice(1, 3)
      .map((r) => `• ${r.name}${r.club ? ` (${r.club})` : ""}`)
      .join("\n");
    msg += `\n\n**Wrong person?** Other matches:\n${others}\nRun \`/link\` again with a more specific name.`;
  }

  return msg;
}

export async function handleUnlink(
  kv: KVNamespace,
  guildId: string,
  discordUserId: string,
): Promise<string> {
  const existing = await getLinkedShooter(kv, guildId, discordUserId);
  if (!existing) {
    return "You don't have a linked account in this server. Use `/link <name>` to connect one.";
  }

  await kv.delete(kvKey(guildId, discordUserId));
  return (
    `Unlinked your account from **${existing.name}**.\n\n` +
    "You'll no longer appear in `/summary`, `/leaderboard`, `/watch` notifications, " +
    "or `/remind-squads` @mentions in this server.\n\n" +
    "Use `/link <name>` to reconnect."
  );
}

/** Look up the linked shooter ID for a Discord user within a guild. */
export async function getLinkedShooter(
  kv: KVNamespace,
  guildId: string,
  discordUserId: string,
): Promise<{ shooterId: number; name: string } | null> {
  const raw = await kv.get(kvKey(guildId, discordUserId));
  if (!raw) return null;
  return JSON.parse(raw);
}

/** Guild-scoped KV key for user↔shooter links. */
function kvKey(guildId: string, userId: string): string {
  return `g:${guildId}:link:${userId}`;
}
