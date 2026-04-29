# MCP Server (developer notes)

The app exposes a [Model Context Protocol](https://modelcontextprotocol.io) server with seven tools:
`search_events`, `get_match`, `compare_competitors`, `get_stage_times`, `get_popular_matches`,
`get_shooter_dashboard`, `find_shooter`.

Two transport modes share the same tool logic via `lib/mcp-tools.ts`:
- **HTTP** (`app/api/mcp/route.ts`) -- stateless JSON-RPC, single-shot transport; used by the Smithery
  external deployment and any MCP-over-HTTP client.
- **stdio** (`mcp/src/index.ts`) -- spawned by Claude Desktop / Claude Code via `.mcp.json`.

The stdio server's `configSchema` (a Zod schema exported from `mcp/src/index.ts`) and `createServer`
default export are used by Smithery's hosted TypeScript runtime. The HTTP server always uses
`NEXT_PUBLIC_APP_URL` (or `http://localhost:PORT`) as its `baseUrl` -- it does not read session config.

User-facing setup guide: `docs/mcp.md`.

## Smithery registry

The server is published on [smithery.ai](https://smithery.ai) as an **external** server
pointing at `https://scoreboard.urdr.dev/api/mcp` (qualified name: `mandakan/ssi-scoreboard`).

**Metadata set via the Smithery UI (registry listing page):**
- Homepage -> `https://scoreboard.urdr.dev`
- Icon -> `https://scoreboard.urdr.dev/icons/icon-512.png`

**Tool annotations** (`readOnlyHint: true`, `openWorldHint: true`) are declared inline in
`lib/mcp-tools.ts` as the 4th argument to each `server.tool()` call.

**Publishing / updating the registry entry** -- trigger the `Publish to Smithery Registry`
workflow manually from the GitHub Actions tab (workflow_dispatch). This pushes the latest
configSchema (`mcp/smithery-config-schema.json`) to the external deployment. The Smithery UI
has no field for configSchema on external servers -- the workflow is the only way to update it.

Prerequisite: add `SMITHERY_API_KEY` as a secret in the GitHub repo's `production` environment
(Settings -> Environments -> production -> Add secret). Obtain the key from
https://smithery.ai/account/api-keys.

The `configSchema` block in `smithery.yaml` mirrors `mcp/smithery-config-schema.json` and
covers the hosted TypeScript runtime path. Keep both in sync when changing the schema.
