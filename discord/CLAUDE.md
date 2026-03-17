# Discord Bot — CLAUDE.md

Cloudflare Worker Discord bot ("Range Officer") for IPSC competition communities.
Deployed at `rangeofficer.urdr.dev`. Uses the SSI Scoreboard Next.js app as its data backend.

## Dev Commands

```bash
cd discord
pnpm dev              # wrangler dev (local worker)
pnpm run typecheck    # tsc --noEmit
pnpm test             # vitest run
pnpm test:watch       # vitest watch
pnpm run register     # register slash commands with Discord API (run after changing definitions.ts)
pnpm cf:deploy        # deploy to Cloudflare Workers (production)
```

**Important:** after adding/changing a command in `definitions.ts`, you **must** run
`pnpm run register` to push the updated command definitions to Discord. Otherwise the
bot will not show the new choices/options in the Discord UI.

## Architecture

```
Discord → Cloudflare Worker (HTTP POST /) → ScoreboardClient → Next.js API
                                          → KV (guild-scoped state)
```

### Entry point: `src/index.ts`

Two handlers:
- **`fetch()`** — HTTP interactions. Verifies Discord signature, routes by interaction type:
  - `Ping` → `PONG`
  - `ApplicationCommandAutocomplete` → `handleAutocompleteInteraction()`
  - `ApplicationCommand` → `handleCommand()`
- **`scheduled()`** — Cron trigger (every 2 min). Runs all notification pollers in parallel:
  `pollWatchedMatches`, `pollRegistrationReminders`, `pollSquadReminders`,
  `pollPersonalReminders`, `pollAchievements`

### Deferred response pattern

Discord requires a response within 3 seconds. All commands that do async work:
1. Return `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` (type 5) immediately
2. Do the real work in `ctx.waitUntil()` (background)
3. Edit the original response via `PATCH /webhooks/{appId}/{token}/messages/@original`

### Static pages

GET routes serve HTML pages: `/` (landing), `/privacy`, `/tos`, `/invite` (redirect).

## Directory Structure

```
src/
├── index.ts                    # Worker entry point (fetch + scheduled)
├── types.ts                    # Env bindings + Scoreboard API response types
├── verify.ts                   # Discord interaction signature verification
├── register.ts                 # CLI script to register slash commands
├── discord-api.ts              # REST helpers: postChannelMessage, editChannelMessage,
│                               #   pinMessage, sendDirectMessage
├── scoreboard-client.ts        # Typed HTTP client for the Next.js API
├── linked-shooters.ts          # Resolve guild-scoped Discord user → shooter links
├── pages.ts                    # Static HTML pages (landing, privacy, ToS)
├── commands/
│   ├── definitions.ts          # All slash command definitions (name, options, choices)
│   ├── autocomplete.ts         # Event search autocomplete handler
│   ├── help.ts                 # /help + /introduction + WELCOME_EMBED
│   ├── match.ts                # /match — search + overview embed
│   ├── shooter.ts              # /shooter — cross-competition stats embed
│   ├── link.ts                 # /link, /unlink — Discord↔SSI shooter mapping
│   ├── linked.ts               # /linked — show all linked/unlinked guild members
│   ├── summary.ts              # /summary — per-stage breakdown for linked shooters
│   ├── leaderboard.ts          # /leaderboard — leaders + stage winners
│   ├── watch.ts                # /watch, /unwatch — live match stage notifications
│   ├── remind.ts               # /remind set/list/cancel/upcoming — personal DM reminders
│   ├── remind-registrations.ts # /remind-registrations — daily digest (guild-level)
│   ├── remind-squads.ts        # /remind-squads — squad/match-day reminders
│   └── predict.ts              # /predict submit/reveal/status — prediction game
└── notifications/
    ├── stage-scored.ts          # Cron: live match → notify when stages scored
    ├── registration-reminder.ts # Cron: daily registration digest
    ├── squad-reminder.ts        # Cron: squad/match-day reminders
    ├── personal-reminder.ts     # Cron: personal DM reminders
    └── achievement-announce.ts  # Cron: announce newly unlocked achievements
```

## Adding a New Command

1. Add the command definition to `src/commands/definitions.ts`
2. Create handler file in `src/commands/` — export an async function returning
   `{ content: string; embeds: APIEmbed[] }`
3. Import and route in `src/index.ts` inside the `handleCommand()` switch
4. Run `pnpm run register` to push to Discord
5. Update `/help` in `src/commands/help.ts` (HELP_EMBED fields)

### Adding a subcommand (e.g. a new `/remind` action)

1. Add the choice to the existing command's `choices` array in `definitions.ts`
2. Add the case to the handler's switch (e.g. `handleRemind()`)
3. If the subcommand needs a new option, add it to the command's `options` array
4. Pass the new option through in `index.ts` where the handler is called
5. Run `pnpm run register`

## KV Schema

All data is **guild-scoped** to prevent cross-server data leaks.

```
g:{guildId}:link:{userId}           → { shooterId, name }
g:{guildId}:remind:{userId}         → PersonalReminderConfig
g:{guildId}:remind-registrations    → RegistrationReminderConfig
g:{guildId}:remind-squads           → SquadReminderConfig
g:{guildId}:watched                 → WatchConfig
g:{guildId}:predict:{ct}:{matchId}  → PredictionState
g:{guildId}:welcomed                → "1" (flag)
```

## Scoreboard Client

`src/scoreboard-client.ts` — typed HTTP client that calls the Next.js app's REST API.
Base URL comes from `SCOREBOARD_BASE_URL` in `wrangler.toml`.

Methods: `searchEvents`, `browseEvents`, `getMatch`, `searchShooters`,
`getShooterDashboard`, `compare`, `compareWithPenaltyStats`

## Types

`src/types.ts` contains:
- `Env` — Cloudflare Worker bindings (secrets, vars, KV)
- Response types mirroring the Next.js API (`EventSearchResult`, `MatchResponse`,
  `UpcomingMatch`, `ShooterDashboardResponse`, `CompareResult`, etc.)

These are a **subset** of the main app's types, kept separate because the Discord worker
is a standalone Cloudflare Worker (not a pnpm workspace package of the Next.js app).
When the main app's API response shape changes, update these types to match.

## Environment Variables

| Variable | How set | Notes |
|---|---|---|
| `DISCORD_BOT_TOKEN` | `wrangler secret put` | Bot token from Discord Developer Portal |
| `DISCORD_PUBLIC_KEY` | `wrangler secret put` | For interaction signature verification |
| `DISCORD_APP_ID` | `wrangler secret put` | Application ID |
| `SCOREBOARD_BASE_URL` | `wrangler.toml` [vars] | Default: `https://scoreboard.urdr.dev` |
| `BOT_KV` | `wrangler.toml` binding | KV namespace for all guild-scoped state |

## Cron / Notification System

All notification pollers run every 2 minutes via `[triggers] crons = ["*/2 * * * *"]`.

Pattern:
1. Scan relevant KV keys (e.g. `g:*:remind:*`)
2. For each config, check if any trigger condition is met
3. Send notification (DM or channel message)
4. Update `notifiedEvents` in KV to deduplicate

## Testing

Tests live in `discord/tests/`. Run with `pnpm test` from the `discord/` directory.
Tests use vitest and mock the KV namespace and ScoreboardClient.

## Deployment

```bash
pnpm cf:deploy          # production (rangeofficer.urdr.dev)
```

Secrets must be set via `wrangler secret put` before first deploy.
The worker is deployed to the `rangeofficer.urdr.dev` custom domain.
