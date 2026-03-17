// Handler for /linked — shows all linked members in the guild.
// Ephemeral response so only the caller sees it.

import { getGuildLinkedShootersWithUsers } from "../linked-shooters";

export async function handleLinked(
  kv: KVNamespace,
  guildId: string,
): Promise<string> {
  const linked = await getGuildLinkedShootersWithUsers(kv, guildId);

  if (linked.length === 0) {
    return (
      "No one has linked their account yet.\n" +
      "Use `/link <name>` to connect your SSI shooter profile!"
    );
  }

  const lines: string[] = [];
  lines.push(`**Linked members** (${linked.length})\n`);
  for (const l of linked) {
    lines.push(`<@${l.discordUserId}> → **${l.name}**`);
  }
  lines.push("\nNot on the list? Run `/link <name>` to connect your SSI profile!");

  return lines.join("\n");
}
