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
      value:
        "Link your Discord account to your SSI shooter profile. " +
        "Enables `/me`, and makes you appear in `/summary`, `/leaderboard`, " +
        "`/watch` notifications, and `/remind-squads` @mentions.",
      inline: false,
    },
    {
      name: "/unlink",
      value: "Disconnect your Discord account from your SSI shooter profile.",
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
      name: "/remind-registrations set [country] [level] [discipline] [days]",
      value:
        "Daily digest of upcoming matches with registration status. " +
        "Filter by country, level, discipline, and how far ahead to look. " +
        "Pings @here when registration opens today. " +
        "One config per server — running `set` again replaces the previous one.",
      inline: false,
    },
    {
      name: "/remind-squads set [days]",
      value:
        "Notify linked shooters (with @mentions) before squadding opens " +
        "(e.g. `1,7` = 7 days + 1 day + day-of). Also posts match-day reminders " +
        "with squad assignments. Requires `/link` first. " +
        "One config per server — running `set` again replaces the previous one.",
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

const INTRODUCTION_EMBED: APIEmbed = {
  title: "Attention on the range!",
  color: 0x22c55e, // green
  description:
    "Good morning, competitors. I'm your **Range Officer** for this server.\n\n" +
    "My job is to keep you informed \u2014 match results, stage scores, registration deadlines, " +
    "squad reminders, the works. Think of me as the RO who actually *wants* you to know " +
    "what's going on.\n\n" +
    "But I can't do my job if I don't know who you are.",
  fields: [
    {
      name: "Step 1 \u2014 Link your account",
      value:
        "Run `/link <your name>` with your name exactly as it appears on " +
        "[Shoot'n Score It](https://shootnscoreit.com). I'll match you to your shooter profile.\n\n" +
        "Once linked, you unlock everything: your personal dashboard (`/me`), " +
        "live stage updates, squad reminders with @mentions, and you'll show up " +
        "in match summaries and leaderboards.",
      inline: false,
    },
    {
      name: "Step 2 \u2014 There is no step 2",
      value:
        "That's it. You're done. The rest is on your server admin to set up:\n\n" +
        "\u2022 `/watch <match>` \u2014 live score updates as you finish stages\n" +
        "\u2022 `/remind-registrations set` \u2014 daily digest of upcoming matches so you never miss a registration opening\n" +
        "\u2022 `/remind-squads set` \u2014 @mentions when squadding opens (first-come-first-serve, be ready!)\n\n" +
        "Or just use me casually \u2014 `/match`, `/shooter`, `/summary`, `/leaderboard` work for everyone.",
      inline: false,
    },
    {
      name: "The fine print",
      value:
        "I only see what's on [SSI Scoreboard](https://scoreboard.urdr.dev). " +
        "If your match isn't there, I can't help you.\n\n" +
        "Your link is per-server \u2014 link once in each server you use me in. " +
        "`/unlink` if you change your mind.\n\n" +
        "Now \u2014 load and make ready.",
      inline: false,
    },
  ],
};

export function handleIntroduction(): { content: string; embeds: APIEmbed[] } {
  return { content: "", embeds: [INTRODUCTION_EMBED] };
}
