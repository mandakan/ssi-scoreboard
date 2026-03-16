// Handler for /help
// Shows available commands and getting-started instructions.

import type { APIEmbed } from "discord-api-types/v10";

const HELP_EMBED: APIEmbed = {
  title: "Range Officer — IPSC Match Bot",
  description:
    "I help you look up IPSC match results, shooter stats, and competition data " +
    "from [SSI Scoreboard](https://scoreboard.urdr.dev).",
  color: 0x5865f2, // Discord blurple
  fields: [
    {
      name: "Getting started",
      value:
        "1. Use `/link <your name>` to connect your Discord account to your SSI shooter profile\n" +
        "2. Use `/me` to see your personal dashboard\n" +
        "3. That's it!",
      inline: false,
    },
    {
      name: "/match <query>",
      value: "Search for a match by name and see its overview — stages, competitors, scoring status.",
      inline: false,
    },
    {
      name: "/shooter <name>",
      value: "Look up any shooter's cross-competition stats, achievements, and recent matches.",
      inline: false,
    },
    {
      name: "/link <name>",
      value: "Link your Discord account to your SSI shooter profile. Required for `/me`.",
      inline: false,
    },
    {
      name: "/me",
      value: "Show your own shooter dashboard (requires `/link` first).",
      inline: false,
    },
    {
      name: "/summary <query>",
      value:
        "Per-stage breakdown for linked shooters in a match — HF, A/C/D/M, and % vs leader.",
      inline: false,
    },
    {
      name: "/leaderboard <query>",
      value:
        "Who's leading among linked shooters? Overall ranking + stage winners at a glance.",
      inline: false,
    },
    {
      name: "/watch <query>",
      value:
        "Watch a live match — I'll post updates when linked shooters finish a stage. " +
        "Best used in a dedicated bot channel.",
      inline: false,
    },
    {
      name: "/unwatch",
      value: "Stop watching the current match.",
      inline: false,
    },
    {
      name: "/remind-registrations set [country] [level] [days]",
      value:
        "Daily digest of upcoming matches with open registration. " +
        "Filter by country, level, and how far ahead to look.",
      inline: false,
    },
    {
      name: "/remind-squads set [days]",
      value:
        "Notify linked shooters (with @mentions) before squadding opens " +
        "(e.g. `1,7` = 7 days + 1 day + day-of). Also posts match-day reminders " +
        "with squad assignments. Requires `/link` first.",
      inline: false,
    },
    {
      name: "Tip: restrict to a channel",
      value:
        "To keep bot output in a dedicated channel, go to Server Settings \u2192 Channels \u2192 " +
        "select the channel \u2192 Permissions, and only grant Range Officer the " +
        "\"Use Application Commands\" permission in your bot channel.",
      inline: false,
    },
  ],
};

/** Welcome embed shown on first interaction in a guild. Same content as /help. */
export const WELCOME_EMBED: APIEmbed = {
  ...HELP_EMBED,
  title: "Range Officer has entered the range!",
  description:
    "I'm an IPSC match bot powered by [SSI Scoreboard](https://scoreboard.urdr.dev). " +
    "Here's what I can do:",
  footer: { text: "Type /help any time to see this again." },
};

export function handleHelp(): { content: string; embeds: APIEmbed[] } {
  return { content: "", embeds: [HELP_EMBED] };
}
