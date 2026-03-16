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
] as const;
