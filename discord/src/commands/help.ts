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
