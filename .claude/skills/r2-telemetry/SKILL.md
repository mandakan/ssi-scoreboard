---
name: r2-telemetry
description: Fetch and filter SSI Scoreboard telemetry events from R2. Use whenever the user asks to look at cache decisions, upstream latency, errors, or product usage events — questions like "what's the p95 upstream latency this week", "show me match-ttl decisions for match X", "did anyone hit a graphql-error today", "how many people viewed the comparison page yesterday". Triggers on "r2 telemetry", "telemetry", "cache decisions", "upstream errors", "usage events", or when the user wants to inspect operational data flowing into the R2 bucket.
---

# R2 telemetry

Fetches structured telemetry events from the R2 NDJSON store
(`ssi-scoreboard-telemetry` / `ssi-scoreboard-telemetry-staging`)
and returns them as a filtered timeline or grouped count.

The script is the workhorse:

```
.claude/skills/r2-telemetry/scripts/fetch.py [flags]
```

It reads the OAuth token from the wrangler config, lists R2 objects
across the relevant UTC day prefixes, fetches them in parallel, parses
NDJSON, and applies in-memory filters.

## When to invoke

Use this skill when the user wants to inspect production or staging
telemetry. Examples:

- "what's the p95 latency for `GetMatchScorecards` over the past day"
- "show me everything that touched match 22157 in the last 6 hours"
- "are there any swallowed errors in the shooter dashboard path"
- "how many people opened a comparison this week"
- "did the cache evict any entries due to schema bumps today"

Don't use it for live tailing — that's `wrangler tail`. R2 captures the
last 30 days; live tailing only gives you 3.

## Core flags

| Flag | Default | Notes |
|---|---|---|
| `--env` | `prod` | `prod` or `staging` |
| `--since` | `2h` | `2h`, `30m`, `3d`, or `YYYY-MM-DD` |
| `--until` | now | `YYYY-MM-DD` |
| `--domain` | none | `cache` / `upstream` / `error` / `usage` |
| `--op` | none | filter to one op within the domain |
| `--match` | none | substring match across all fields (a match ID, error class, etc.) |
| `--shooter` | none | filter to a specific `shooterId` (error events) |
| `--where` | none | `key=value` clauses, repeatable, comma-separable |
| `--group-by` | none | comma-separated keys → counts |
| `--limit` | 200 | max events emitted (timeline/json modes) |
| `--format` | `timeline` | `timeline` or `json` |

## How to think about the workflow

1. **Pick the smallest scope first.** If the user asked about a specific
   match, lead with `--match=<id>` before `--domain`. If they asked about
   errors, lead with `--domain=error`. Narrow scope = faster, cheaper,
   easier to read.

2. **Default `--format=timeline`** for human-readable output. Switch to
   `--format=json` only when the user wants raw events or when piping
   into another tool.

3. **Reach for `--group-by` when the question is "how many" or "which
   X is most common".** Examples:
   - `--group-by op,outcome` — distribution of upstream outcomes
   - `--group-by site,errorClass` — which error sites fire what
   - `--group-by op,scoringBucket` — usage events split by match state

4. **Time ranges:** `--since` accepts both `2h`-style durations and
   absolute dates. The script resolves to UTC day prefixes, so a
   `--since=2h` near midnight UTC will scan two day prefixes.

## Examples

```bash
# what is the upstream right now
.claude/skills/r2-telemetry/scripts/fetch.py --domain upstream --since 1h

# any swallowed errors in the last day
.claude/skills/r2-telemetry/scripts/fetch.py --domain error --since 24h

# matches that pinned today
.claude/skills/r2-telemetry/scripts/fetch.py --domain cache --op match-ttl-decision \
  --where trulyDone=true --since 24h

# usage breakdown by op for the past week
.claude/skills/r2-telemetry/scripts/fetch.py --domain usage --since 7d --group-by op

# everything touching one match in staging
.claude/skills/r2-telemetry/scripts/fetch.py --env staging --match 22157 --since 6h

# p95-style latency dump for one operation
.claude/skills/r2-telemetry/scripts/fetch.py --domain upstream --op graphql-request \
  --where operation=GetMatchScorecards --since 24h --format json \
  | jq '.ms' | sort -n | awk 'BEGIN{c=0} {a[c++]=$1} END{print a[int(c*0.95)]}'
```

## Auth

The script reads the wrangler-cached OAuth token from
`~/Library/Preferences/.wrangler/config/default.toml` (macOS) or
`~/.config/.wrangler/config/default.toml` (Linux). If you see "Could
not find oauth_token" or HTTP 401/403:

```bash
wrangler login
```

The token rotates roughly hourly. The account ID is hardcoded at the
top of the script — update it if the repo's CF account ever changes.

## What you'll see

Each NDJSON event has a `domain`, `op`, and `ts`, plus domain-specific
fields:

| Domain | Key fields |
|---|---|
| `cache` | `matchKey`, `trulyDone`, `ttl`, `scoringPct`, `daysSince`, `status`, `resultsPublished` |
| `upstream` | `operation`, `outcome` (ok/http-error/timeout/graphql-error/empty/fetch-error), `ms`, `httpStatus`, `bytes`, `varsHash` |
| `error` | `site`, `errorClass`, `errorMsg` (≤200 chars), optional `matchKey`/`shooterId`/`ct`/`matchId` |
| `usage` | `op` (match-view/comparison/search/shooter-dashboard-view/og-render) plus per-op buckets |

Privacy guarantees enforced upstream: no IP, no User-Agent, no shooter
IDs in `usage`, no raw search query text. See `lib/usage-telemetry.ts`
for the full contract.

## When the script fails

- **HTTP 401/403** → run `wrangler login`
- **"Could not find oauth_token"** → same
- **Empty result** but you expect events → check `--env` (default is
  prod); also remember R2 lifecycle deletes objects after 30 days
- **Account ID mismatch** → update `ACCOUNT_ID` constant in `scripts/fetch.py`
