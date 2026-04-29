# Delta-merge contract (CRITICAL)

`refreshCachedMatchQuery` no longer just caches SSI responses opaquely -- when the match-level
probe (#361) reports `changed`, the helper attempts an incremental scorecard delta merge (#362)
via `scorecards(updated_after:)`. We are now **mirroring SSI's data structure** and applying
upstream changes incrementally, so any SSI schema drift can silently corrupt cached snapshots.

## When changing scorecard fields, ALL of these must be updated together -- in the SAME PR

1. **`SCORECARD_NODE_FIELDS`** in `lib/graphql.ts` -- the shared GraphQL fragment used by both
   `SCORECARDS_QUERY` (full fetch) and `SCORECARDS_DELTA_QUERY` (delta fetch). Adding the field
   here automatically threads it through both. Do NOT add a field to one query and not the other.
2. **`RawScCard`** in `lib/scorecard-data.ts` -- the TypeScript shape of a cached scorecard.
3. **`ScorecardDeltaEntry`** in `lib/graphql.ts` -- the delta-payload shape (subset of `RawScCard`
   plus `stage.id`).
4. **`deltaToCacheCard()`** in `lib/scorecard-merge.ts` -- the field-by-field copy from delta entry
   to cached scorecard. New fields must be copied here or they will be silently dropped on every
   delta merge.
5. **`parseRawScorecards()`** in `lib/scorecard-data.ts` -- if the field is consumed downstream
   (e.g. used in `computeGroupRankings`).
6. **`CACHE_SCHEMA_VERSION`** in `lib/constants.ts` -- bump by 1 with a one-line history comment.
   Otherwise old delta-merged entries written before the change will linger.
7. **`scripts/ssi-schema-snapshot.json`** -- run `pnpm check:ssi-schema --update` to refresh the
   snapshot. Commit the diff. Reviewers can see exactly which SSI fields changed.

**For other tracked types** (`IpscMatchNode`, `IpscStageNode`, `IpscCompetitorNode`,
`IpscSquadNode`): the same discipline applies, but the surface area is smaller -- match metadata
goes through the standard probe + full refetch path, no merge logic. Update the relevant
GraphQL query, the corresponding TypeScript type, and bump `CACHE_SCHEMA_VERSION`.

## Detecting SSI drift before users do

```bash
pnpm check:ssi-schema           # report drift, exit 1 if any
pnpm check:ssi-schema --update  # accept current schema as the new snapshot
pnpm check:ssi-schema --json    # machine-readable output for CI

pnpm validate:ssi-queries       # static check: every field/arg in every
                                # outbound query exists on the parent type
                                # in the snapshot. Zero network. Runs in CI.
```

`validate:ssi-queries` parses each query in `lib/graphql.ts`, walks the AST
against `scripts/ssi-schema-snapshot.json`, and fails on missing fields,
undeclared arguments, or fields whose parent type doesn't declare them. It
catches snapshot/query drift and typos. It **does not** catch resolver-level
bugs where the schema advertises a field on an interface but the underlying
Django model on a subtype throws `AttributeError` at runtime (the #367 class) --
that gap needs a live dry-run smoke test, not static introspection.

The script introspects `RootQuery`, `EventInterface`, `IpscMatchNode`,
`IpscStageNode`, `IpscScoreCardNode`, `IpscCompetitorNode`, and `IpscSquadNode`
from the live SSI GraphQL endpoint and compares against
`scripts/ssi-schema-snapshot.json`. Run it weekly (manually or via cron) to catch silent
upstream changes. If it reports drift:

- **Added fields** -- usually safe to ignore unless we want to consume them. Update the snapshot
  with `--update` once you've decided.
- **Removed fields** -- high-risk. The delta merge will write `null` for removed fields, so
  cached entries gradually lose data. Plan a migration: stop reading the field, bump
  `CACHE_SCHEMA_VERSION`, then update the snapshot.
- **Type / argument changes** -- read the diff carefully; may be a breaking change.

## Recovery from a corrupted snapshot

If a delta merge produces wrong data on a live match, the user-facing recovery lever is:

```bash
curl -X POST -H "Authorization: Bearer $CACHE_PURGE_SECRET" \
  "https://scoreboard.urdr.dev/api/admin/cache/force-refresh?ct=22&id=<match-id>"
```

This sets a `force-refresh:{ct}:{id}` Redis sentinel that bypasses probe / delta paths and
forces a clean full refetch on the next SWR cycle. The sentinel auto-clears after a successful
refresh and auto-expires after 5 minutes.
