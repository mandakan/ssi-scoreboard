// Cloudflare Worker entry point for the SSI Discord bot.
// Handles Discord Interactions (slash commands) via HTTP POST.
//
// SECURITY: All guild-specific data (user↔shooter links, watch state, reminders)
// is scoped by guild_id in KV keys. Commands that access guild-scoped data
// reject DM interactions to prevent cross-server data leaks.

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
import { handleHelp, WELCOME_EMBED } from "./commands/help";
import { handleLeaderboard } from "./commands/leaderboard";
import { handleSummary } from "./commands/summary";
import { handleWatch, handleUnwatch } from "./commands/watch";
import { handleRemindRegistrations } from "./commands/remind-registrations";
import { handleRemindSquads } from "./commands/remind-squads";
import { pollWatchedMatches } from "./notifications/stage-scored";
import { pollRegistrationReminders } from "./notifications/registration-reminder";
import { landingPage, privacyPage, tosPage } from "./pages";
import { pollSquadReminders } from "./notifications/squad-reminder";

const worker: ExportedHandler<Env> = {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    // Static pages and invite redirect (GET routes)
    if (request.method === "GET") {
      switch (url.pathname) {
        case "/":
          return htmlResponse(landingPage());
        case "/privacy":
          return htmlResponse(privacyPage());
        case "/tos":
          return htmlResponse(tosPage());
        case "/invite": {
          const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${env.DISCORD_APP_ID}&scope=bot%20applications.commands&permissions=2048`;
          return Response.redirect(inviteUrl, 302);
        }
      }
    }

    // Only POST / is the Discord interactions endpoint
    if (request.method !== "POST" || url.pathname !== "/") {
      return new Response("Not found", { status: 404 });
    }

    const interaction = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
    if (!interaction) {
      return new Response("Invalid request signature", { status: 401 });
    }

    const body = interaction as unknown as APIInteraction;

    if (body.type === InteractionType.Ping) {
      return jsonResponse({ type: InteractionResponseType.PONG });
    }

    if (body.type === InteractionType.ApplicationCommand) {
      return await handleCommand(body, env);
    }

    return jsonResponse({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: "Unknown interaction type.", flags: 64 },
    });
  },

  async scheduled(_, env) {
    await Promise.all([
      pollWatchedMatches(env),
      pollRegistrationReminders(env),
      pollSquadReminders(env),
    ]);
  },
};

export default worker;

/** Extract the Discord user ID from an interaction (guild or DM context). */
function getUserId(interaction: APIInteraction): string | undefined {
  const raw = interaction as Record<string, unknown>;
  const member = raw.member as Record<string, unknown> | undefined;
  const user = (member?.user ?? raw.user) as Record<string, string> | undefined;
  return user?.id;
}

/** Extract the guild ID from an interaction. Undefined in DM context. */
function getGuildId(interaction: APIInteraction): string | undefined {
  return (interaction as Record<string, unknown>).guild_id as string | undefined;
}

/** Extract the channel ID from an interaction. */
function getChannelId(interaction: APIInteraction): string | undefined {
  return (interaction as Record<string, unknown>).channel_id as string | undefined;
}

/**
 * Check if this is the first interaction from a guild.
 * If so, mark it as seen and return the welcome embed to prepend.
 */
async function maybeWelcome(
  kv: KVNamespace,
  guildId: string | undefined,
): Promise<unknown | null> {
  if (!guildId) return null;
  const key = `g:${guildId}:welcomed`;
  const seen = await kv.get(key);
  if (seen) return null;
  // Mark as welcomed (no expiry — persists forever)
  await kv.put(key, "1");
  return WELCOME_EMBED;
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
  const guildId = getGuildId(interaction);

  // Commands where the response is only visible to the caller
  const EPHEMERAL_COMMANDS = new Set(["help", "link", "me", "unwatch", "remind-registrations", "remind-squads"]);

  try {
    let content = "";
    let embeds: unknown[] = [];
    const ephemeral = EPHEMERAL_COMMANDS.has(commandName);

    // On first-ever interaction in a guild, prepend the welcome embed
    // (only for public commands so it's visible to the whole channel)
    const welcomeEmbed = !ephemeral
      ? await maybeWelcome(env.BOT_KV, guildId)
      : null;

    switch (commandName) {
      case "help": {
        const result = handleHelp();
        content = result.content;
        embeds = result.embeds;
        break;
      }

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

      case "leaderboard": {
        if (!guildId) {
          content = "This command can only be used in a server, not in DMs.";
          break;
        }
        const lbResult = await handleLeaderboard(
          client, env.BOT_KV, baseUrl, guildId, options.query as string,
        );
        content = lbResult.content;
        embeds = lbResult.embeds;
        break;
      }

      case "summary": {
        if (!guildId) {
          content = "This command can only be used in a server, not in DMs.";
          break;
        }
        const summaryResult = await handleSummary(
          client, env.BOT_KV, baseUrl, guildId, options.query as string,
        );
        content = summaryResult.content;
        embeds = summaryResult.embeds;
        break;
      }

      case "link": {
        if (!guildId) {
          content = "This command can only be used in a server, not in DMs.";
          break;
        }
        const userId = getUserId(interaction);
        if (!userId) {
          content = "Could not determine your Discord user ID.";
          break;
        }
        content = await handleLink(client, env.BOT_KV, guildId, userId, options.name as string);
        break;
      }

      case "me": {
        if (!guildId) {
          content = "This command can only be used in a server, not in DMs.";
          break;
        }
        const userId = getUserId(interaction);
        if (!userId) {
          content = "Could not determine your Discord user ID.";
          break;
        }
        const linked = await getLinkedShooter(env.BOT_KV, guildId, userId);
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

      case "watch": {
        if (!guildId) {
          content = "This command can only be used in a server, not in DMs.";
          break;
        }
        const channelId = getChannelId(interaction);
        if (!channelId) {
          content = "Could not determine the channel.";
          break;
        }
        const watchResult = await handleWatch(
          client, env.BOT_KV, baseUrl, guildId, channelId, options.query as string,
        );
        content = watchResult.content;
        embeds = watchResult.embeds;
        break;
      }

      case "unwatch": {
        if (!guildId) {
          content = "This command can only be used in a server, not in DMs.";
          break;
        }
        content = await handleUnwatch(env.BOT_KV, guildId);
        break;
      }

      case "remind-registrations": {
        if (!guildId) {
          content = "This command can only be used in a server, not in DMs.";
          break;
        }
        const reminderChannelId = getChannelId(interaction);
        if (!reminderChannelId) {
          content = "Could not determine the channel.";
          break;
        }
        const reminderResult = await handleRemindRegistrations(
          env.BOT_KV,
          guildId,
          reminderChannelId,
          options.action as string | undefined,
          options.country as string | undefined,
          options.level as string | undefined,
          options.days as number | undefined,
        );
        content = reminderResult.content;
        embeds = reminderResult.embeds;
        break;
      }

      case "remind-squads": {
        if (!guildId) {
          content = "This command can only be used in a server, not in DMs.";
          break;
        }
        const squadChannelId = getChannelId(interaction);
        if (!squadChannelId) {
          content = "Could not determine the channel.";
          break;
        }
        const squadResult = await handleRemindSquads(
          env.BOT_KV,
          guildId,
          squadChannelId,
          options.action as string | undefined,
          options.days_before as number | undefined,
        );
        content = squadResult.content;
        embeds = squadResult.embeds;
        break;
      }

      default:
        content = `Unknown command: ${commandName}`;
    }

    // If this is the guild's first interaction, prepend the welcome embed
    if (welcomeEmbed) {
      embeds = [welcomeEmbed, ...embeds];
      if (!content) {
        content = "Welcome! Here's what you asked for:";
      }
    }

    return jsonResponse({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: content || undefined,
        embeds: embeds.length > 0 ? embeds : undefined,
        // ephemeral = only visible to the user who ran the command
        ...(ephemeral ? { flags: 64 } : {}),
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

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html;charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
