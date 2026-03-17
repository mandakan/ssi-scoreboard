// Thin wrapper around the Discord REST API for posting messages.
// Used by the cron trigger to send notifications to channels.

import type { APIEmbed } from "discord-api-types/v10";

const DISCORD_API = "https://discord.com/api/v10";

/**
 * Post a message to a channel. Returns the message ID on success, null on failure.
 */
export async function postChannelMessage(
  botToken: string,
  channelId: string,
  content: string,
  embeds?: APIEmbed[],
): Promise<string | null> {
  const resp = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify({
      content: content || undefined,
      embeds: embeds && embeds.length > 0 ? embeds : undefined,
    }),
  });

  if (!resp.ok) {
    console.error(
      `Discord API error: ${resp.status} posting to channel ${channelId}`,
    );
    return null;
  }

  const data = (await resp.json()) as { id: string };
  return data.id;
}

/**
 * Edit an existing message. Returns true on success.
 */
export async function editChannelMessage(
  botToken: string,
  channelId: string,
  messageId: string,
  content: string,
  embeds?: APIEmbed[],
): Promise<boolean> {
  const resp = await fetch(
    `${DISCORD_API}/channels/${channelId}/messages/${messageId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${botToken}`,
      },
      body: JSON.stringify({
        content: content || undefined,
        embeds: embeds && embeds.length > 0 ? embeds : undefined,
      }),
    },
  );

  if (!resp.ok) {
    console.error(
      `Discord API error: ${resp.status} editing message ${messageId} in channel ${channelId}`,
    );
    return false;
  }

  return true;
}

/**
 * Pin a message in a channel. Returns true on success.
 */
export async function pinMessage(
  botToken: string,
  channelId: string,
  messageId: string,
): Promise<boolean> {
  const resp = await fetch(
    `${DISCORD_API}/channels/${channelId}/pins/${messageId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    },
  );

  if (!resp.ok) {
    console.error(
      `Discord API error: ${resp.status} pinning message ${messageId} in channel ${channelId}`,
    );
    return false;
  }

  return true;
}

/** Minimal guild member shape returned by the Discord REST API. */
export interface GuildMember {
  user?: { id: string; username: string; global_name?: string | null; bot?: boolean };
  nick?: string | null;
}

/**
 * List all (non-bot) members in a guild.
 * Requires the GUILD_MEMBERS privileged intent enabled in the Developer Portal.
 * Paginates automatically (1000 per page).
 */
export async function listGuildMembers(
  botToken: string,
  guildId: string,
): Promise<GuildMember[]> {
  const members: GuildMember[] = [];
  let after = "0";

  for (;;) {
    const resp = await fetch(
      `${DISCORD_API}/guilds/${guildId}/members?limit=1000&after=${after}`,
      {
        headers: { Authorization: `Bot ${botToken}` },
      },
    );

    if (!resp.ok) {
      console.error(
        `Discord API error: ${resp.status} listing members for guild ${guildId}`,
      );
      break;
    }

    const batch = (await resp.json()) as GuildMember[];
    if (batch.length === 0) break;

    // Filter out bots
    for (const m of batch) {
      if (m.user && !m.user.bot) {
        members.push(m);
      }
    }

    after = batch[batch.length - 1]?.user?.id ?? "0";
    if (batch.length < 1000) break;
  }

  return members;
}

/**
 * Send a direct message to a user via the bot.
 * Creates (or retrieves) a DM channel, then posts to it.
 * Returns false silently if the user has DMs disabled.
 */
export async function sendDirectMessage(
  botToken: string,
  userId: string,
  content: string,
  embeds?: APIEmbed[],
): Promise<boolean> {
  // Step 1: Create/get DM channel
  const dmResp = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify({ recipient_id: userId }),
  });

  if (!dmResp.ok) {
    // User has DMs disabled or bot cannot reach them — skip silently
    console.warn(`Could not open DM channel for user ${userId}: ${dmResp.status}`);
    return false;
  }

  const { id: channelId } = (await dmResp.json()) as { id: string };

  // Step 2: Post message to the DM channel
  const messageId = await postChannelMessage(botToken, channelId, content, embeds);
  return messageId !== null;
}
