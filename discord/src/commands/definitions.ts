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
      },
    ],
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
    name: "summary",
    description: "Show a per-stage breakdown for linked shooters in a match",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "query",
        description: "Match name to search for",
        type: ApplicationCommandOptionType.String,
        required: true,
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
    description: "Daily digest of upcoming matches with open registration",
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
        name: "days",
        description: "How many days ahead to look (default: 60, max: 365)",
        type: ApplicationCommandOptionType.Integer,
        required: false,
        min_value: 1,
        max_value: 365,
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
        name: "days_before",
        description: "Days before match to remind (default: 1, 0 = match day only)",
        type: ApplicationCommandOptionType.Integer,
        required: false,
        min_value: 0,
        max_value: 7,
      },
    ],
  },
] as const;
