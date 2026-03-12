# Using SSI Scoreboard with AI Assistants (MCP)

SSI Scoreboard exposes a [Model Context Protocol (MCP)](https://modelcontextprotocol.io)
server so Claude and other MCP-compatible AI assistants can query IPSC competition data
directly — without you having to copy-paste URLs or scorecard numbers.

---

## What the MCP server lets you do

Six tools are available:

| Tool | What it does |
|---|---|
| `search_events` | Search competitions by name, country, date range, or level |
| `get_match` | Fetch the full competitor list, stage details, and squads for a match |
| `compare_competitors` | Deep stage-by-stage comparison for 1–12 competitors |
| `get_popular_matches` | List recently viewed matches from the cache |
| `get_shooter_dashboard` | Cross-competition career profile and stats for a single shooter |
| `find_shooter` | Search for a shooter by name in the local database |

**Typical conversation flow:**
1. Ask the assistant to find a match → `search_events`
2. Ask it to look up competitors → `get_match`
3. Ask it to compare two or more competitors → `compare_competitors`

**For career / cross-match stats:**
1. `get_match` → note a competitor's `shooterId`
2. `get_shooter_dashboard(shooter_id)` → career history, aggregate stats, achievements

**For pre-match preparation (upcoming match, no scores yet):**
1. `search_events` → `get_match` → stage list with course lengths, round counts, and constraints
2. Optionally `get_shooter_dashboard` for historical context and personalised tips

---

## Option A — Use the hosted server (no local setup needed)

The production server at `https://scoreboard.urdr.dev/api/mcp` is publicly available.
Skip straight to [Connecting your AI client](#connecting-your-ai-client).

---

## Option B — Run locally

### Prerequisites

- Node.js 20+
- pnpm 10+ (`corepack enable && corepack prepare pnpm@10.30.1 --activate`)
- A ShootNScoreIt API key (from account settings on shootnscoreit.com)

### Step 1 — Clone and install

```bash
git clone https://github.com/mandakan/ssi-scoreboard.git
cd ssi-scoreboard
pnpm install            # also installs the mcp/ workspace dependencies
```

### Step 2 — Configure environment

```bash
cp .env.local.example .env.local
```

Open `.env.local` and fill in at minimum:

```
SSI_API_KEY=your_key_here
```

### Step 3 — Start the dev server

```bash
pnpm dev                # http://localhost:3000
```

The stdio MCP server (`ssi-scoreboard-local` in `.mcp.json`) will call
`http://localhost:3000` automatically — keep this terminal running.

---

## Connecting your AI client

### Claude Code (automatic)

`.mcp.json` is already committed to the repo root. When you open the repository in
Claude Code it automatically registers two stdio servers:

| Server name | Calls |
|---|---|
| `ssi-scoreboard` | Live production instance — works without `pnpm dev` |
| `ssi-scoreboard-local` | `localhost:3000` — requires `pnpm dev` to be running |

**No extra configuration needed.** You can start prompting immediately.

---

### Claude Desktop

Find the config file for your platform:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

Add the following block (replace `/absolute/path/to/ssi-scoreboard` with the real path
on your machine — run `pwd` from the repo root to get it):

**Using the live production server (no `pnpm dev` needed):**

```json
{
  "mcpServers": {
    "ssi-scoreboard": {
      "command": "/absolute/path/to/ssi-scoreboard/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/ssi-scoreboard/mcp/src/index.ts"],
      "env": {
        "SSI_SCOREBOARD_BASE_URL": "https://scoreboard.urdr.dev"
      }
    }
  }
}
```

**Using a local instance (requires `pnpm dev` running):**

```json
{
  "mcpServers": {
    "ssi-scoreboard-local": {
      "command": "/absolute/path/to/ssi-scoreboard/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/ssi-scoreboard/mcp/src/index.ts"],
      "env": {
        "SSI_SCOREBOARD_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

After saving the file, **restart Claude Desktop** for the change to take effect.
A hammer icon (🔨) in the toolbar confirms the MCP server connected successfully.

---

### Other MCP-compatible clients (generic HTTP)

Any client that supports the MCP streamable HTTP transport can point directly at the
production endpoint — no subprocess or local installation needed:

```
POST https://scoreboard.urdr.dev/api/mcp
Content-Type: application/json
```

Clients typically ask you for a **server URL**; enter `https://scoreboard.urdr.dev/api/mcp`.

> **Note:** ChatGPT and Perplexity do not support MCP. They use separate plugin/GPT
> action mechanisms that are not compatible with this server.

---

## Example prompts

Once connected, try these prompts to get started:

### Find a match

> "Search for the Swedish Open IPSC match in 2024."

> "Find Level 4 IPSC matches in Norway."

> "Look up match 26547 on shootnscoreit."

### Explore competitors

> "Get the competitor list for that match and find me Alice Andersson and Bob Björk."

> "Which squads are in the Swedish Open?"

### Compare competitors

> "Compare Alice Andersson and Bob Björk stage by stage. Who lost the most points and on which stage?"

> "For those two competitors, show me efficiency (points per shot) and consistency score."

> "What's the penalty rate impact for each competitor?"

### Pre-match preparation

> "I'm shooting the Nordic Open next weekend in Squad 4 — give me a stage rotation and highlight any constrained stages."

> "What should I focus on before the Swedish Championship? My name is Alice Andersson."

### Shooter career stats

> "Show me Alice Andersson's match history and how her accuracy has been trending."

> "Find shooter Bob Björk and pull up his career dashboard."

### End-to-end example

```
You: Find the Stockholm Classic IPSC match from last year.

Claude: [calls search_events] Found it: Stockholm Classic 2024, id 26547.

You: Get the full competitor list.

Claude: [calls get_match] Found 87 competitors. Who would you like to compare?

You: Compare competitors 12 and 34.

Claude: [calls compare_competitors] Here's the stage-by-stage breakdown:
Stage 1: Competitor 12 — 7.42 HF (rank 3), Competitor 34 — 6.81 HF (rank 8)
...
```

---

## Troubleshooting

**`tsx: command not found` / server won't start**
Run `pnpm install` from the repo root — this installs tsx in `node_modules/.bin/`.

**`Cannot connect to localhost:3000`**
Make sure `pnpm dev` is running (needed only for the `ssi-scoreboard-local` config).

**Empty results from `search_events`**
The default level filter is `l2plus` (Level II and above). Pass `min_level: "all"` to
include Level I club matches, or `min_level: "l3plus"` / `"l4plus"` to narrow further.

**`get_popular_matches` returns an empty list**
The cache is cold — no matches have been viewed on this instance yet. Use `search_events`
to find a match first.
