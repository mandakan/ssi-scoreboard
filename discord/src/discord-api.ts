// Thin wrapper around the Discord REST API for posting messages.
// Used by the cron trigger to send notifications to channels.

import type { APIEmbed } from "discord-api-types/v10";

const DISCORD_API = "https://discord.com/api/v10";

export async function postChannelMessage(
  botToken: string,
  channelId: string,
  content: string,
  embeds?: APIEmbed[],
): Promise<boolean> {
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
    return false;
  }

  return true;
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
  return postChannelMessage(botToken, channelId, content, embeds);
}
