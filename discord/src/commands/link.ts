// Handler for /link <name>
// Links a Discord user to an SSI shooter ID via KV.

import type { ScoreboardClient } from "../scoreboard-client";

export async function handleLink(
  client: ScoreboardClient,
  kv: KVNamespace,
  discordUserId: string,
  name: string,
): Promise<string> {
  const results = await client.searchShooters(name);

  if (results.length === 0) {
    return `No shooter found matching "${name}". Check the spelling and try again.`;
  }

  const shooter = results[0];

  // Store the mapping: discord user ID → shooter ID + name
  await kv.put(
    `link:${discordUserId}`,
    JSON.stringify({
      shooterId: shooter.shooterId,
      name: shooter.name,
    }),
  );

  let msg = `Linked your account to **${shooter.name}** (ID: ${shooter.shooterId}).`;
  if (shooter.club) msg += `\nClub: ${shooter.club}`;
  msg += `\n\nYou can now use \`/me\` to see your dashboard.`;

  if (results.length > 1) {
    const others = results
      .slice(1, 3)
      .map((r) => `• ${r.name}${r.club ? ` (${r.club})` : ""}`)
      .join("\n");
    msg += `\n\n**Wrong person?** Other matches:\n${others}\nRun \`/link\` again with a more specific name.`;
  }

  return msg;
}

/** Look up the linked shooter ID for a Discord user. */
export async function getLinkedShooter(
  kv: KVNamespace,
  discordUserId: string,
): Promise<{ shooterId: number; name: string } | null> {
  const raw = await kv.get(`link:${discordUserId}`);
  if (!raw) return null;
  return JSON.parse(raw);
}
