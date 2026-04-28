---
name: incident
description: Investigate "data stuck", "match shows wrong scores", "shooter dashboard broken" reports by gathering all telemetry that touched a specific match or shooter into one timeline. Use when the user describes a user-reported bug tied to a specific match ID or shooter — questions like "match 22157 shows stale data", "why isn't the dashboard updating for shooter 12345", "what happened to this match yesterday", "diagnose this incident". Triggers on "incident", "diagnose", "investigate", "data stuck", "stale data", "wrong scores", or when the user shares a match URL alongside a complaint.
---

# Incident gather

Lays out a chronological timeline of every telemetry event that touched a
specific match or shooter, plus a summary of shape (event counts, upstream
outcomes, error sites, pinning rate). **Gather mode only — no analysis,
no flagging.** The goal is to surface the data so you can spot the
divergence point yourself.

## How to drive this

1. **Run the gather script** with the match ID or shooter ID:

   ```bash
   .claude/skills/incident/scripts/gather.py --match 22157 --since 24h
   .claude/skills/incident/scripts/gather.py --shooter 12345 --since 7d
   .claude/skills/incident/scripts/gather.py --env staging --match 22157
   ```

2. **Read the timeline.** Scan the events in chronological order looking for:
   - **Cache TTL decisions** — when did `trulyDone` flip true? Did it flip
     too early relative to scoring progress?
   - **Upstream outcomes** — any `http-error`, `timeout`, `graphql-error`?
     What was the latency trend?
   - **Error events** — any `domain=error` entries near the pivot point?
     Their `site` field tells you which layer failed.
   - **Gaps** — long stretches with no events can mean SSI was unreachable,
     or the cache was permanently pinned and stopped refreshing.

3. **Cross-reference with ground truth.** The R2 telemetry tells you what
   *we* did. To know what *should* be true, query the SSI MCP server:

   ```
   mcp__claude_ai_SSI_Scoreboard__get_match(ct=22, id="22157")
   ```

   Compare the live SSI `match_status`, `results_status`, `scoring_completed`
   against the most recent cache decision in the timeline. If they diverge,
   the bug is in our refresh path.

4. **For recent incidents (< 3 days)**, supplement with `wrangler tail`
   for the live picture if needed:

   ```bash
   wrangler tail ssi-scoreboard --format json | grep -i 22157
   ```

   R2 has the historical record; tail catches anything that hasn't been
   flushed to R2 yet (per-isolate batching means very recent events may
   not be in R2 yet).

## What gather.py does

Calls `r2-telemetry/scripts/fetch.py` with appropriate filters, parses the
NDJSON output, prints a summary header, then a per-event timeline.

The summary surfaces shape information that's faster to read than scanning
hundreds of timeline lines:
- Total event count
- Domain breakdown (`{cache: 18, upstream: 4, error: 0, usage: 7}`)
- Upstream outcome breakdown (`{ok: 4}` vs `{ok: 2, timeout: 1, http-error: 1}`)
- Cache pinning rate (`5/18 decisions pinned (trulyDone=true)`)
- Error sites if any (`{shooter.dashboard-cache-read: 2}`)

## Common patterns

### "Match shows old scores" / "stale data"
- Look for `match-ttl-decision` with `trulyDone=true` and `ttl=null`
  (permanent pin). Compare its `scoringPct` to ground truth — if SSI
  shows higher progress, the pin happened too early.
- Look for `match-cache-schema-evict` events; recent schema bumps would
  re-fetch on next request.
- Skepplanda Apr 2026 was this exact pattern — match pinned at high
  scoring before all squads finished.

### "Match page won't load" / 502s
- Filter to `--domain upstream` first. Look for `outcome=timeout` or
  `outcome=http-error` clusters.
- Cross-reference `httpStatus` for 5xx (SSI down) vs 4xx (auth/bad
  request). Look at the `errorClass` on related `error` events.

### "Shooter dashboard empty / wrong stats"
- Use `--shooter <id>` (filters on `shooterId` field — only `error`
  events have it directly).
- Check for `error` events with sites starting `shooter.` or `backfill.`.
- The dashboard rebuilds from cached match data; missing matches in the
  shooter index typically point to `shooter-index.suppression-load`
  failures or recent matches that never got indexed.

### "Comparison shows null scoring"
- Filter to `--match <id>` and look at `gql:GetMatchScorecards:` events.
- Compare last successful upstream `bytes` against the typical size for
  matches of that scale (5-10MB scorecards is normal for L3+).

## When the data isn't enough

Some incidents are client-side and won't show in R2:
- Browser localStorage pointing at stale competitor IDs
- Client-side TanStack Query staleness
- A specific browser/OS rendering bug

If `gather.py` shows nothing surprising and the user still sees the
problem, ask them:
- to hard-reload (Cmd+Shift+R) and report whether anything changed
- for a screenshot — sometimes "no scoring data" means a chart panel
  collapsed, not a missing API response
- to check the DevTools network tab for failed `/api/*` requests

## Auth

Same as `r2-telemetry`: reads OAuth from wrangler config. Run
`wrangler login` if you see HTTP 401/403.
