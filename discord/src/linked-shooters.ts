// Shared utility for resolving guild-scoped Discord user -> shooter links.
// Returns Discord user IDs alongside shooter data, enabling @ mentions.

export interface LinkedShooterWithUser {
  discordUserId: string;
  shooterId: number;
  name: string;
}

/**
 * Get all linked shooters for a guild, including their Discord user IDs.
 * KV keys: g:{guildId}:link:{discordUserId} -> { shooterId, name }
 */
export async function getGuildLinkedShootersWithUsers(
  kv: KVNamespace,
  guildId: string,
): Promise<LinkedShooterWithUser[]> {
  const prefix = `g:${guildId}:link:`;
  const listed = await kv.list({ prefix });
  const results: LinkedShooterWithUser[] = [];

  for (const key of listed.keys) {
    const discordUserId = key.name.slice(prefix.length);
    const raw = await kv.get(key.name);
    if (raw) {
      const { shooterId, name } = JSON.parse(raw);
      results.push({ discordUserId, shooterId, name });
    }
  }

  return results;
}
