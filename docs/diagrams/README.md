# Architecture diagrams

Static SVG versions render inline below and in the repository web UI. Each diagram also
ships as a self-contained interactive `.html` viewer (pan/zoom, search, guided views,
light/dark themes, PNG/SVG export) generated with the
[archify](https://github.com/tt-a1i/archify) skill; open those in a browser. The `.json`
files are the sources.

| Diagram | Source | Interactive | Static |
|---|---|---|---|
| System architecture | `system.architecture.json` | `system-architecture.html` | `system-architecture.svg` |
| Live scorecard refresh cycle | `scorecard-refresh.sequence.json` | `scorecard-refresh-cycle.html` | `scorecard-refresh-cycle.svg` |
| Match data tiered store | `match-data.dataflow.json` | `match-data-tiers.html` | `match-data-tiers.svg` |

## System architecture

Clients (browser, MCP, `/api/v1`) converge on the Route Handlers, the only code that calls
ShootNScoreIt. Every upstream call passes the limiter (semaphore, backoff, pause switch)
and carries a Redis-shared JWT from `lib/ssi-auth.ts`.

![System architecture](system-architecture.svg)

## Live scorecard refresh cycle

The poll is answered from Redis first. When the snapshot is older than the freshness
window, a single-flighted background refresh runs one `MatchSyncProbe`, diffs it against
the `probe:stage-state` sidecar, refetches only the changed stages, and writes the
snapshot before the sidecar. See the "Match cache refresh contract" section in `CLAUDE.md`.

![Live scorecard refresh cycle](scorecard-refresh-cycle.svg)

## Match data tiered store

Read order is Redis, then D1/SQLite `match_data_cache`, then GraphQL. Redis drains into
the durable tier; `indexMatchShooters` updates the shooter index after every response.

![Match data tiered store](match-data-tiers.svg)

## Regenerating

Edit the `.json` source, then from the archify skill directory:

```bash
node bin/archify.mjs validate <type> docs/diagrams/<source>.json --quality showcase --json
node bin/archify.mjs deliver <type> docs/diagrams/<source>.json docs/diagrams/<output>.html --quality showcase --json
```

`<type>` is `architecture`, `sequence`, or `dataflow`. A showcase pass must report 9
artifact checks with 0 errors and 0 warnings. Then regenerate the static `.svg` by opening
the delivered `.html` and choosing **Export > SVG** (the file is written next to the
`.html` with the same basename), or drive that export headlessly. Keep the diagrams in
step with the contracts in `CLAUDE.md` (match cache refresh, tiered read path).
