// Slash command definitions — used by both the register script and the worker.
// Keep command metadata here; handlers are in separate files.

import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
} from "discord-api-types/v10";

export const COMMANDS = [
  {
    name: "match",
    description: "Search for a match and show its overview",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "query",
        description: "Match name to search for (e.g. 'Swedish Handgun')",
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: "shooter",
    description: "Look up a shooter's cross-competition stats",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "name",
        description: "Shooter name to search for",
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: "link",
    description: "Link your Discord account to an SSI shooter profile",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "name",
        description: "Your shooter name as it appears on SSI",
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: "unlink",
    description: "Unlink your Discord account from your SSI shooter profile",
    type: ApplicationCommandType.ChatInput,
  },
  {
    name: "linked",
    description: "Show all linked and unlinked members in this server",
    type: ApplicationCommandType.ChatInput,
  },
  {
    name: "me",
    description: "Show your own shooter dashboard (requires /link first)",
    type: ApplicationCommandType.ChatInput,
  },
  {
    name: "help",
    description: "Show available commands and how to get started",
    type: ApplicationCommandType.ChatInput,
  },
  {
    name: "introduction",
    description: "Let the Range Officer introduce himself to the channel",
    type: ApplicationCommandType.ChatInput,
  },
  {
    name: "summary",
    description: "Show a per-stage breakdown for linked shooters in a match",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "query",
        description: "Match name to search for",
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: "leaderboard",
    description: "Show who's leading among linked shooters and stage winners",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "query",
        description: "Match name to search for",
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: "watch",
    description: "Watch a match — get notified when linked shooters finish a stage",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "query",
        description: "Match name to search for",
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: "unwatch",
    description: "Stop watching the current match",
    type: ApplicationCommandType.ChatInput,
  },
  {
    name: "remind-registrations",
    description: "Daily digest of upcoming matches and registration status",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "action",
        description: "set = configure, show = view config, off = disable",
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: "set — configure the daily reminder", value: "set" },
          { name: "show — view current config", value: "show" },
          { name: "off — disable the reminder", value: "off" },
        ],
      },
      {
        name: "country",
        description: "ISO country code filter (e.g. SWE, NOR, FIN)",
        type: ApplicationCommandOptionType.String,
        required: false,
      },
      {
        name: "level",
        description: "Minimum match level (default: Level II+)",
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: [
          { name: "All levels", value: "all" },
          { name: "Level II+", value: "l2plus" },
          { name: "Level III+", value: "l3plus" },
          { name: "Level IV+", value: "l4plus" },
        ],
      },
      {
        name: "discipline",
        description: "Filter by discipline (default: all)",
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: [
          { name: "Handgun (incl. PCC)", value: "handgun" },
          { name: "Rifle", value: "rifle" },
          { name: "Shotgun", value: "shotgun" },
          { name: "Mini Rifle", value: "minirifle" },
        ],
      },
      {
        name: "days",
        description: "How many days ahead to look (default: 365, max: 730)",
        type: ApplicationCommandOptionType.Integer,
        required: false,
        min_value: 1,
        max_value: 730,
      },
    ],
  },
  {
    name: "remind-squads",
    description: "Remind linked shooters when squadding opens or match day arrives",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "action",
        description: "set = configure, show = view config, off = disable",
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: "set — configure squad reminders", value: "set" },
          { name: "show — view current config", value: "show" },
          { name: "off — disable squad reminders", value: "off" },
        ],
      },
      {
        name: "days",
        description: "Days before squadding to remind, comma-separated (default: 1,7). Day 0 always included.",
        type: ApplicationCommandOptionType.String,
        required: false,
      },
    ],
  },
  {
    name: "remind",
    description: "Set personal DM reminders for a specific match",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "action",
        description: "set = add reminder, list = view active, cancel = remove, upcoming = action checklist",
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: "set \u2014 remind me about a match", value: "set" },
          { name: "list \u2014 show my active reminders", value: "list" },
          { name: "cancel \u2014 remove a reminder", value: "cancel" },
          { name: "upcoming \u2014 what do I need to do?", value: "upcoming" },
        ],
      },
      {
        name: "query",
        description: "Match name to search for (required for set/cancel)",
        type: ApplicationCommandOptionType.String,
        required: false,
        autocomplete: true,
      },
      {
        name: "days",
        description: "Days ahead to look for upcoming matches (default: 8)",
        type: ApplicationCommandOptionType.Integer,
        required: false,
        min_value: 1,
        max_value: 90,
      },
    ],
  },
  {
    name: "predict",
    description: "Predict your match performance — % and mikes (misses)",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "action",
        description: "submit = make a prediction, reveal = show results, status = check predictions",
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: "submit — predict your match performance", value: "submit" },
          { name: "reveal — reveal predictions after match", value: "reveal" },
          { name: "status — check who has predicted", value: "status" },
        ],
      },
      {
        name: "query",
        description: "Match name to search for",
        type: ApplicationCommandOptionType.String,
        required: false,
        autocomplete: true,
      },
      {
        name: "percent",
        description: "Your predicted overall match % (0-100)",
        type: ApplicationCommandOptionType.Number,
        required: false,
        min_value: 0,
        max_value: 100,
      },
      {
        name: "mikes",
        description: "Your predicted total number of mikes (misses)",
        type: ApplicationCommandOptionType.Integer,
        required: false,
        min_value: 0,
      },
    ],
  },
  // --- Easter eggs ---
  {
    name: "dq",
    description: "Disqualify someone (just for fun)",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "target",
        description: "The competitor to DQ",
        type: ApplicationCommandOptionType.User,
        required: false,
      },
    ],
  },
  {
    name: "standby",
    description: "Issue the RO start command sequence",
    type: ApplicationCommandType.ChatInput,
  },
  {
    name: "alpha",
    description: "Call a perfect hit",
    type: ApplicationCommandType.ChatInput,
  },
  {
    name: "mike",
    description: "Call a miss",
    type: ApplicationCommandType.ChatInput,
  },
  {
    name: "doublemike",
    description: "Call a double miss on the same target",
    type: ApplicationCommandType.ChatInput,
  },
  {
    name: "delta",
    description: "Call a delta hit",
    type: ApplicationCommandType.ChatInput,
  },
  {
    name: "procedural",
    description: "Issue a procedural penalty (just for fun)",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "target",
        description: "The competitor to penalise",
        type: ApplicationCommandOptionType.User,
        required: false,
      },
    ],
  },
] as const;
