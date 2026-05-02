# Match cache refresh contract (CRITICAL)

`refreshCachedMatchQuery` is split by cache key:

- **`GetMatch` (match overview)** keeps the if-modified-since probe (#361) on
  `IpscMatchNode.updated`. When the probe reports `changed` the cached snapshot is fully
  refetched; when it reports `skip` the TTL is extended.
  `MATCH_PROBE_MAX_SKIP_AGE_SECONDS` (default 300s) caps worst-case staleness.
- **`GetMatchScorecards`** bypasses the probe entirely. SSI's `IpscMatchNode.updated`
  does NOT tick when scorecards are added (verified live during SPSK Open 2026,
  match 22/27190: every stage advanced from 0% to 26% scored while `event.updated`
  stayed at the prior day's setup time). Trusting the probe-skip outcome on the
  scorecards key pegged refreshes at the 5-minute ceiling. Every SWR fire on a
  scorecards key now does a full refetch, single-flighted via the inflight lock.

The PR #366 incremental delta merge has been removed because it was unreachable in
practice (the gate required `event.updated` to change, which it didn't). The merge
helper (`mergeScorecardDelta` in `lib/scorecard-merge.ts`) and the `SCORECARDS_DELTA_QUERY`
GraphQL string in `lib/graphql.ts` are preserved for future revival should SSI expose a
usable scorecard-mutation timestamp; the validator still asserts the query parses
against the schema snapshot.

We are still **mirroring SSI's data structure** for the match overview probe path, so
any SSI schema drift can silently corrupt cached snapshots.

## When changing scorecard fields, ALL of these must be updated together -- in the SAME PR

1. **`SCORECARD_NODE_FIELDS`** in `lib/graphql.ts` -- the shared GraphQL fragment used by
   `SCORECARDS_QUERY` (full fetch) and the preserved `SCORECARDS_DELTA_QUERY`. Adding a field
   here threads it through both.
2. **`RawScCard`** in `lib/scorecard-data.ts` -- the TypeScript shape of a cached scorecard.
3. **`parseRawScorecards()`** in `lib/scorecard-data.ts` -- if the field is consumed downstream
   (e.g. used in `computeGroupRankings`).
4. **`CACHE_SCHEMA_VERSION`** in `lib/constants.ts` -- bump by 1 with a one-line history comment.
   Otherwise old entries written before the change will linger.
5. **`scripts/ssi-schema-snapshot.json`** -- run `pnpm check:ssi-schema --update` to refresh the
   snapshot. Commit the diff. Reviewers can see exactly which SSI fields changed.

If you ever revive the delta-merge path you'll also need to update `ScorecardDeltaEntry` in
`lib/graphql.ts` and `deltaToCacheCard()` in `lib/scorecard-merge.ts` to copy the new field
across — both still exist as preserved code.

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
- **Removed fields** -- high-risk. Plan a migration: stop reading the field, bump
  `CACHE_SCHEMA_VERSION`, then update the snapshot.
- **Type / argument changes** -- read the diff carefully; may be a breaking change.

## Recovery levers

If a cached match is producing wrong data on a live match:

### Force-refresh sentinel (per-match)

```bash
curl -X POST -H "Authorization: Bearer $CACHE_PURGE_SECRET" \
  "https://scoreboard.urdr.dev/api/admin/cache/force-refresh?ct=22&id=<match-id>"
```

Sets a `force-refresh:{ct}:{id}` Redis sentinel that bypasses the probe and forces a clean
full refetch on the next SWR cycle for both `GetMatch` and `GetMatchScorecards`. Sentinel
auto-clears after a successful refresh and auto-expires after 5 minutes.

### Probe kill switch (global)

If the match-overview probe path is observed misbehaving, disable it without a code deploy:

```bash
echo "off" | pnpm exec wrangler secret put MATCH_PROBE_ENABLED   # prod
```

Takes effect on the next request. Removes the probe optimization and falls back to a full
refetch on every SWR cycle for both keytypes. Revert with `wrangler secret delete
MATCH_PROBE_ENABLED`.
