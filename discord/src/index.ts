// Cloudflare Worker entry point for the SSI Discord bot.
// Handles Discord Interactions (slash commands) via HTTP POST.
//
// SECURITY: All guild-specific data (user↔shooter links, watch state, reminders)
// is scoped by guild_id in KV keys. Commands that access guild-scoped data
// reject DM interactions to prevent cross-server data leaks.
//
// DEFERRED RESPONSES: Commands that do any async work (API calls, KV reads) return
// a deferred response (type 5) immediately, then edit the original message via the
// Discord webhook once the data is ready. This avoids Discord's 3-second interaction
// response deadline.

import { InteractionResponseType } from "discord-interactions";
import {
  InteractionType,
  type APIInteraction,
} from "discord-api-types/v10";

import type { Env } from "./types";
import { verifyDiscordRequest } from "./verify";
import { ScoreboardClient } from "./scoreboard-client";
import { handleMatch } from "./commands/match";
import { handleShooter, handleShooterById } from "./commands/shooter";
import { handleLink, handleUnlink, getLinkedShooter } from "./commands/link";
import { handleHelp, handleIntroduction, WELCOME_EMBED } from "./commands/help";
import { handleDq, handleStandby, getStandbyDelayMs, handleAlpha, handleMike, handleDoubleMike, handleDelta, handleProcedural } from "./commands/easter-eggs";
import { handleLinked } from "./commands/linked";
import { handleLeaderboard } from "./commands/leaderboard";
import { handleSummary } from "./commands/summary";
import { handleWatch, handleUnwatch } from "./commands/watch";
import { handleRemindRegistrations } from "./commands/remind-registrations";
import { handleRemindSquads } from "./commands/remind-squads";
import { handleRemind } from "./commands/remind";
import { handlePredict } from "./commands/predict";
import { handleTimezone } from "./commands/timezone";
import { handleAutocomplete } from "./commands/autocomplete";
import { pollWatchedMatches } from "./notifications/stage-scored";
import { pollRegistrationReminders } from "./notifications/registration-reminder";
import { landingPage, privacyPage, tosPage } from "./pages";
import { pollSquadReminders } from "./notifications/squad-reminder";
import { pollPersonalReminders } from "./notifications/personal-reminder";
import { pollAchievements } from "./notifications/achievement-announce";

const worker: ExportedHandler<Env> = {
  async fetch(request, env, ctx): Promise<Response> {
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

    if (body.type === InteractionType.ApplicationCommandAutocomplete) {
      return handleAutocompleteInteraction(body, env);
    }

    if (body.type === InteractionType.ApplicationCommand) {
      return handleCommand(body, env, ctx);
    }

    return jsonResponse({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: "Unknown interaction type.", flags: 64 },
    });
  },

  async scheduled(_, env) {
    const results = await Promise.allSettled([
      pollWatchedMatches(env),
      pollRegistrationReminders(env),
      pollSquadReminders(env),
      pollPersonalReminders(env),
      pollAchievements(env),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("Cron task failed:", result.reason);
      }
    }
  },
};

export default worker;

// --- Helpers ---

function getUserId(interaction: APIInteraction): string | undefined {
  const raw = interaction as Record<string, unknown>;
  const member = raw.member as Record<string, unknown> | undefined;
  const user = (member?.user ?? raw.user) as Record<string, string> | undefined;
  return user?.id;
}

function getGuildId(interaction: APIInteraction): string | undefined {
  return (interaction as Record<string, unknown>).guild_id as string | undefined;
}

function getChannelId(interaction: APIInteraction): string | undefined {
  return (interaction as Record<string, unknown>).channel_id as string | undefined;
}

async function maybeWelcome(
  kv: KVNamespace,
  guildId: string | undefined,
): Promise<unknown | null> {
  if (!guildId) return null;
  const key = `g:${guildId}:welcomed`;
  const seen = await kv.get(key);
  if (seen) return null;
  await kv.put(key, "1");
  return WELCOME_EMBED;
}

// Commands where the response is only visible to the caller
const EPHEMERAL_COMMANDS = new Set(["help", "link", "unlink", "me", "remind", "linked"]);

/**
 * Edit the original deferred response via the Discord webhook API.
 */
async function editOriginalResponse(
  appId: string,
  token: string,
  data: { content?: string; embeds?: unknown[] },
): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`;
  const resp = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error(`Failed to edit deferred response: ${resp.status} ${text}`);
  }
}

/**
 * Send a follow-up message via the Discord webhook API.
 * Each follow-up appears as a new message in the channel.
 */
async function sendFollowupMessage(
  appId: string,
  token: string,
  data: { content?: string; embeds?: unknown[] },
): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${appId}/${token}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error(`Failed to send follow-up message: ${resp.status} ${text}`);
  }
}

// --- Autocomplete ---

async function handleAutocompleteInteraction(
  interaction: APIInteraction,
  env: Env,
): Promise<Response> {
  const data = (interaction as Record<string, unknown>).data as {
    name: string;
    options?: Array<{ name: string; value: unknown; focused?: boolean }>;
  };

  const focused = data.options?.find((o) => o.focused);
  if (!focused) {
    return jsonResponse({
      type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
      data: { choices: [] },
    });
  }

  const client = new ScoreboardClient(env.SCOREBOARD_BASE_URL);
  try {
    const choices = await handleAutocomplete(
      client,
      data.name,
      String(focused.value),
    );
    return jsonResponse({
      type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
      data: { choices },
    });
  } catch (err) {
    console.error(`Autocomplete for /${data.name} failed:`, err);
    return jsonResponse({
      type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
      data: { choices: [] },
    });
  }
}

// --- Command routing ---

function handleCommand(
  interaction: APIInteraction,
  env: Env,
  ctx: ExecutionContext,
): Response {
  const data = (interaction as Record<string, unknown>).data as {
    name: string;
    options?: Array<{ name: string; value: unknown }>;
  };
  const commandName = data.name;
  let ephemeral = EPHEMERAL_COMMANDS.has(commandName);

  // /predict submit and status are ephemeral; reveal is public
  if (commandName === "predict") {
    const action = data.options?.find((o) => o.name === "action")?.value;
    ephemeral = action !== "reveal";
  }

  // Fully synchronous commands — respond inline
  if (commandName === "help") {
    const result = handleHelp();
    return jsonResponse({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: result.content || undefined,
        embeds: result.embeds.length > 0 ? result.embeds : undefined,
        flags: 64,
      },
    });
  }

  if (commandName === "introduction") {
    const result = handleIntroduction();
    return jsonResponse({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: result.content || undefined,
        embeds: result.embeds.length > 0 ? result.embeds : undefined,
        // NOT ephemeral — the whole point is for everyone to see it
      },
    });
  }

  // Easter-egg commands — synchronous, public (everyone should see the fun)
  // /standby is deferred (uses a real delay) — handled below in handleDeferredCommand
  if (commandName === "dq" || commandName === "alpha" || commandName === "mike" ||
      commandName === "doublemike" || commandName === "delta" || commandName === "procedural") {
    const opts = (data.options ?? []) as Array<{ name: string; value: unknown }>;
    const targetUser = opts.find((o) => o.name === "target")?.value as string | undefined;
    let result: { content: string; embeds: unknown[] };
    switch (commandName) {
      case "dq": result = handleDq(targetUser); break;
      case "alpha": result = handleAlpha(); break;
      case "mike": result = handleMike(); break;
      case "doublemike": result = handleDoubleMike(); break;
      case "delta": result = handleDelta(); break;
      case "procedural": result = handleProcedural(targetUser); break;
    }
    return jsonResponse({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: result!.content || undefined,
        embeds: result!.embeds.length > 0 ? result!.embeds : undefined,
      },
    });
  }

  // All other commands: defer immediately, process in background
  const token = (interaction as Record<string, unknown>).token as string;
  const options = (data.options ?? []).reduce(
    (acc, opt) => {
      acc[opt.name] = opt.value;
      return acc;
    },
    {} as Record<string, unknown>,
  );

  ctx.waitUntil(
    handleDeferredCommand(commandName, options, interaction, env, token, ephemeral),
  );

  return jsonResponse({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      ...(ephemeral ? { flags: 64 } : {}),
    },
  });
}

/**
 * Process a command in the background and edit the deferred response when done.
 */
async function handleDeferredCommand(
  commandName: string,
  options: Record<string, unknown>,
  interaction: APIInteraction,
  env: Env,
  token: string,
  ephemeral: boolean,
): Promise<void> {
  const client = new ScoreboardClient(env.SCOREBOARD_BASE_URL);
  const baseUrl = env.SCOREBOARD_BASE_URL;
  const guildId = getGuildId(interaction);

  try {
    let content = "";
    let embeds: unknown[] = [];

    // On first-ever interaction in a guild, prepend the welcome embed
    const welcomeEmbed = !ephemeral
      ? await maybeWelcome(env.BOT_KV, guildId)
      : null;

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

      case "unlink": {
        if (!guildId) {
          content = "This command can only be used in a server, not in DMs.";
          break;
        }
        const unlinkUserId = getUserId(interaction);
        if (!unlinkUserId) {
          content = "Could not determine your Discord user ID.";
          break;
        }
        content = await handleUnlink(env.BOT_KV, guildId, unlinkUserId);
        break;
      }

      case "linked": {
        if (!guildId) {
          content = "This command can only be used in a server, not in DMs.";
          break;
        }
        content = await handleLinked(env.BOT_KV, guildId);
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
        const result = await handleShooterById(client, baseUrl, linked.shooterId);
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
        const reminderAction = options.action as string | undefined;
        const reminderResult = await handleRemindRegistrations(
          env.BOT_KV,
          guildId,
          reminderChannelId,
          reminderAction,
          options.country as string | undefined,
          options.level as string | undefined,
          options.discipline as string | undefined,
          options.days as number | undefined,
        );
        content = reminderResult.content;
        embeds = reminderResult.embeds;
        break;
      }

      case "remind": {
        if (!guildId) {
          content = "This command can only be used in a server, not in DMs.";
          break;
        }
        const remindUserId = getUserId(interaction);
        if (!remindUserId) {
          content = "Could not determine your Discord user ID.";
          break;
        }
        const remindResult = await handleRemind(
          client,
          env.BOT_KV,
          baseUrl,
          guildId,
          remindUserId,
          options.action as string | undefined,
          options.query as string | undefined,
          options.days as number | undefined,
        );
        content = remindResult.content;
        embeds = remindResult.embeds;
        break;
      }

      case "predict": {
        if (!guildId) {
          content = "This command can only be used in a server, not in DMs.";
          break;
        }
        const predictUserId = getUserId(interaction);
        if (!predictUserId) {
          content = "Could not determine your Discord user ID.";
          break;
        }
        const predictAction = options.action as string | undefined;
        // Make predict ephemeral for submit/status, but reveal is public
        const predictResult = await handlePredict(
          client,
          env.BOT_KV,
          baseUrl,
          guildId,
          predictUserId,
          predictAction,
          options.query as string | undefined,
          options.percent as number | undefined,
          options.mikes as number | undefined,
        );
        content = predictResult.content;
        embeds = predictResult.embeds;
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
        const squadAction = options.action as string | undefined;
        const squadResult = await handleRemindSquads(
          env.BOT_KV,
          guildId,
          squadChannelId,
          squadAction,
          options.days as string | undefined,
        );
        content = squadResult.content;
        embeds = squadResult.embeds;
        break;
      }

      case "timezone": {
        if (!guildId) {
          content = "This command can only be used in a server, not in DMs.";
          break;
        }
        content = await handleTimezone(
          env.BOT_KV,
          guildId,
          options.timezone as string,
          options.hour as number | undefined,
        );
        break;
      }

      case "standby": {
        const delayMs = getStandbyDelayMs();
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        const standbyResult = handleStandby();
        content = standbyResult.content;
        embeds = standbyResult.embeds;
        break;
      }

      default:
        content = `Unknown command: ${commandName}`;
    }

    if (welcomeEmbed) {
      embeds = [welcomeEmbed, ...embeds];
      if (!content) {
        content = "Welcome! Here's what you asked for:";
      }
    }

    // Discord has a 6000-char total embed limit per message.
    // When there are multiple embeds, send the first with the original response
    // and the rest as follow-up messages to avoid hitting the limit.
    if (embeds.length > 1) {
      const [firstEmbed, ...restEmbeds] = embeds;
      await editOriginalResponse(env.DISCORD_APP_ID, token, {
        content: content || undefined,
        embeds: [firstEmbed],
      });
      for (const embed of restEmbeds) {
        await sendFollowupMessage(env.DISCORD_APP_ID, token, {
          embeds: [embed],
        });
      }
    } else {
      await editOriginalResponse(env.DISCORD_APP_ID, token, {
        content: content || undefined,
        embeds: embeds.length > 0 ? embeds : undefined,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Command /${commandName} failed:`, message);
    try {
      await editOriginalResponse(env.DISCORD_APP_ID, token, {
        content: `Something went wrong: ${message}`,
      });
    } catch (editErr) {
      console.error("Failed to send error response:", editErr);
    }
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
