# Architecture diagrams

Interactive, self-contained HTML diagrams generated with the
[archify](https://github.com/tt-a1i/archify) skill. Open the `.html` files in a
browser; each has pan/zoom, search, guided views, light/dark themes, and PNG/SVG
export built in. The `.json` files are the sources.

| Diagram | Source | Output |
|---|---|---|
| System architecture: clients, Route Handlers, upstream guard rail, stores | `system.architecture.json` | `system-architecture.html` |
| Live scorecard refresh cycle: serve-from-cache, one probe, changed-stage splice | `scorecard-refresh.sequence.json` | `scorecard-refresh-cycle.html` |
| Match data tiered store: GraphQL -> Redis -> D1/SQLite -> consumers | `match-data.dataflow.json` | `match-data-tiers.html` |

## Regenerating

Edit the `.json` source, then from the archify skill directory:

```bash
node bin/archify.mjs validate <type> docs/diagrams/<source>.json --quality showcase --json
node bin/archify.mjs deliver <type> docs/diagrams/<source>.json docs/diagrams/<output>.html --quality showcase --json
```

`<type>` is `architecture`, `sequence`, or `dataflow`. A showcase pass must
report 9 artifact checks with 0 errors and 0 warnings. Keep the diagrams in
step with the contracts in `CLAUDE.md` (match cache refresh, tiered read path).
