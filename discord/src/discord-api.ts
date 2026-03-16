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
