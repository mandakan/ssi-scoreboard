// Handler for /linked — shows all linked and unlinked members in the guild.
// Ephemeral response so only the caller sees it. Useful for admins to remind
// unlinked members to run /link.

import { getGuildLinkedShootersWithUsers } from "../linked-shooters";
import { listGuildMembers } from "../discord-api";

export async function handleLinked(
  kv: KVNamespace,
  botToken: string,
  guildId: string,
): Promise<string> {
  const [linked, members] = await Promise.all([
    getGuildLinkedShootersWithUsers(kv, guildId),
    listGuildMembers(botToken, guildId),
  ]);

  if (members.length === 0) {
    return (
      "Could not fetch server members. " +
      "Make sure the **Server Members Intent** is enabled in the " +
      "[Discord Developer Portal](https://discord.com/developers/applications)."
    );
  }

  const linkedByUserId = new Map(linked.map((l) => [l.discordUserId, l]));

  const linkedMembers: string[] = [];
  const unlinkedMembers: string[] = [];

  for (const m of members) {
    const userId = m.user?.id;
    if (!userId) continue;

    const link = linkedByUserId.get(userId);
    if (link) {
      linkedMembers.push(`<@${userId}> → **${link.name}**`);
    } else {
      unlinkedMembers.push(`<@${userId}>`);
    }
  }

  // Also include linked entries whose Discord user left the server
  for (const l of linked) {
    if (!members.some((m) => m.user?.id === l.discordUserId)) {
      linkedMembers.push(`<@${l.discordUserId}> → **${l.name}** *(left server)*`);
    }
  }

  const lines: string[] = [];

  lines.push(
    `**Linked** (${linkedMembers.length}/${members.length} members)\n`,
  );

  if (linkedMembers.length > 0) {
    for (const entry of linkedMembers) {
      lines.push(entry);
    }
  } else {
    lines.push("*No one has linked yet.*");
  }

  lines.push("");
  lines.push(`**Not linked** (${unlinkedMembers.length})\n`);

  if (unlinkedMembers.length > 0) {
    lines.push(unlinkedMembers.join(", "));
    lines.push(
      "\nRemind them to run `/link <name>` to connect their SSI profile!",
    );
  } else {
    lines.push("*Everyone is linked!*");
  }

  return lines.join("\n");
}
