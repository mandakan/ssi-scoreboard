// Cloudflare Worker entry point for the SSI Discord bot.
// Handles Discord Interactions (slash commands) via HTTP POST.

import { InteractionResponseType } from "discord-interactions";
import {
  InteractionType,
  type APIInteraction,
} from "discord-api-types/v10";

import type { Env } from "./types";
import { verifyDiscordRequest } from "./verify";
import { ScoreboardClient } from "./scoreboard-client";
import { handleMatch } from "./commands/match";
import { handleShooter } from "./commands/shooter";
import { handleLink, getLinkedShooter } from "./commands/link";

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Only accept POST to the root path
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/") {
      return new Response("Not found", { status: 404 });
    }

    // Verify the request signature
    const interaction = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
    if (!interaction) {
      return new Response("Invalid request signature", { status: 401 });
    }

    const body = interaction as unknown as APIInteraction;

    // Handle PING (required for Discord to verify the endpoint)
    if (body.type === InteractionType.Ping) {
      return jsonResponse({ type: InteractionResponseType.PONG });
    }

    // Handle slash commands
    if (body.type === InteractionType.ApplicationCommand) {
      return await handleCommand(body, env);
    }

    return jsonResponse({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: "Unknown interaction type.", flags: 64 },
    });
  },
};

export default worker;

/** Extract the Discord user ID from an interaction (works in both guild and DM contexts). */
function getUserId(interaction: APIInteraction): string | undefined {
  const raw = interaction as Record<string, unknown>;
  const member = raw.member as Record<string, unknown> | undefined;
  const user = (member?.user ?? raw.user) as Record<string, string> | undefined;
  return user?.id;
}

async function handleCommand(
  interaction: APIInteraction,
  env: Env,
): Promise<Response> {
  const data = (interaction as Record<string, unknown>).data as {
    name: string;
    options?: Array<{ name: string; value: unknown }>;
  };

  const commandName = data.name;
  const options = (data.options ?? []).reduce(
    (acc, opt) => {
      acc[opt.name] = opt.value;
      return acc;
    },
    {} as Record<string, unknown>,
  );

  const client = new ScoreboardClient(env.SCOREBOARD_BASE_URL);
  const baseUrl = env.SCOREBOARD_BASE_URL;

  try {
    let content = "";
    let embeds: unknown[] = [];

    switch (commandName) {
      case "match": {
        const result = await handleMatch(client, baseUrl, options.query as string);
        content = result.content;
        embeds = result.embeds;
        break;
      }

      case "shooter": {
        const result = await handleShooter(client, baseUrl, options.name as string);
        content = result.content;
        embeds = result.embeds;
        break;
      }

      case "link": {
        const userId = getUserId(interaction);
        if (!userId) {
          content = "Could not determine your Discord user ID.";
          break;
        }
        content = await handleLink(client, env.BOT_KV, userId, options.name as string);
        break;
      }

      case "me": {
        const userId = getUserId(interaction);
        if (!userId) {
          content = "Could not determine your Discord user ID.";
          break;
        }
        const linked = await getLinkedShooter(env.BOT_KV, userId);
        if (!linked) {
          content =
            "You haven't linked your account yet. Use `/link <your name>` first.";
          break;
        }
        const result = await handleShooter(client, baseUrl, linked.name);
        content = result.content;
        embeds = result.embeds;
        break;
      }

      default:
        content = `Unknown command: ${commandName}`;
    }

    return jsonResponse({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: content || undefined,
        embeds: embeds.length > 0 ? embeds : undefined,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Command /${commandName} failed:`, message);
    return jsonResponse({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: `Something went wrong: ${message}`,
        flags: 64, // ephemeral
      },
    });
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
