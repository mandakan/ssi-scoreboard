# Public API v1

`/api/v1/*` is the **stable, externally-consumable** surface of this app. It
exists so projects like [splitsmith](https://github.com/mandakan/splitsmith)
(IPSC shot-split extraction from head-cam footage) can pull match and shooter
data without re-implementing the SSI GraphQL client, vendoring the MCP server,
or pinning to internal `/api/*` routes that may change at any time.

The internal `/api/*` routes used by the browser app remain unauthenticated
and are **not** part of any contract. Only `/api/v1/*` is gated, rate-limited,
and shape-locked.

The base URL for the production deployment is `https://scoreboard.urdr.dev`.
All examples below use `$TOKEN` as a placeholder for a valid bearer token (see
[Authentication](#authentication)).

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/events` | Match search / browse |
| GET | `/api/v1/match/{ct}/{id}` | Full match overview |
| GET | `/api/v1/match/{ct}/{id}/competitor/{competitorId}/stages` | Per-competitor stage results for one match |
| GET | `/api/v1/shooter/search` | Name search over indexed shooter profiles |
| GET | `/api/v1/shooter/{shooterId}` | Shooter dashboard (stats, achievements, recent matches) |

All endpoints accept only `GET`. Other methods return `405 Method Not Allowed`.

---

## `GET /api/v1/events`

Search or browse IPSC matches.

### Query parameters

| Param | Type | Default | Notes |
|---|---|---|---|
| `q` | string | -- | Free-text search; passes to SSI's search backend. When set, the date window auto-widens to 5 years back / 2 years forward. |
| `minLevel` | `all` \| `l2plus` \| `l3plus` \| `l4plus` | `all` for v1 callers | Filters by sanction level. `live=1` overrides this. |
| `country` | string (ISO 3166-1 alpha-3) | -- | e.g. `SWE`. |
| `starts_after` | `YYYY-MM-DD` | -1 month | Lower bound on match start date. |
| `starts_before` | `YYYY-MM-DD` | +1 month | Upper bound on match start date. |
| `firearms` | `hg` \| `rfl` \| `shg` \| `pcc` \| `mr` \| `prr` \| `air` | -- | Discipline filter. |
| `live` | `1` | -- | Only matches scoring right now. **Caps the result list at 8.** Overrides `minLevel`, the date window, and the default sort. |

### Response

`200 OK` with a JSON array (no envelope -- response body is the array
directly). The array is sorted by start date descending.

| Field | Type | Notes |
|---|---|---|
| `id` | number | SSI numeric match ID. |
| `content_type` | number | SSI Django content type. Always `22` for IPSC matches today. Combine with `id` for `/api/v1/match/{content_type}/{id}`. |
| `name` | string | Match name. |
| `venue` | string \| null | Free-text venue name. |
| `date` | string | ISO timestamp of match start. |
| `ends` | string \| null | ISO timestamp of match end. |
| `status` | string | SSI lifecycle code: `dr` draft, `on` active, `ol` active/no-self-edit, `pr` preliminary, `cp` completed, `cs` cancelled. |
| `region` | string | Country code (ISO 3166-1 alpha-3). |
| `discipline` | string | Human-readable, e.g. `IPSC Handgun & PCC`. |
| `level` | string | `Level I` ... `Level V`, or `Unsanctioned`. |
| `registration_status` | string | SSI registration code: `op` open, `cl` closed, `ax` auto-approve on payment, `ox` waiting list + auto-approve, etc. |
| `registration_starts` | string \| null | ISO timestamp. |
| `registration_closes` | string \| null | ISO timestamp. |
| `is_registration_possible` | boolean | |
| `squadding_starts` | string \| null | ISO timestamp. |
| `squadding_closes` | string \| null | ISO timestamp. |
| `is_squadding_possible` | boolean | |
| `max_competitors` | number \| null | Cap configured by the organizer. |
| `scoring_completed` | number | Percent 0-100. `0` for upcoming or empty matches. |

There is no pagination -- v1 returns the full result set for the given window.
For broad browse queries, narrow the window or add filters rather than relying
on slicing.

### Example

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://scoreboard.urdr.dev/api/v1/events?q=SPSK&country=SWE&minLevel=l2plus" \
  | jq '.[0]'
```

---

## `GET /api/v1/match/{ct}/{id}`

Fetch the full match overview for a single match.

### Path parameters

| Param | Type | Notes |
|---|---|---|
| `ct` | number | SSI Django content type. `22` for all current IPSC matches. |
| `id` | number | SSI numeric match ID. |

### Response

`200 OK` with a `MatchResponse` object. Top-level fields:

| Field | Type | Notes |
|---|---|---|
| `name` | string | |
| `venue` | string \| null | |
| `lat`, `lng` | number \| null | Match venue coordinates. |
| `date`, `ends` | string \| null | ISO timestamps. |
| `level` | string \| null | |
| `sub_rule` | string \| null | |
| `discipline` | string \| null | |
| `region` | string \| null | |
| `stages_count` | number | |
| `competitors_count` | number | Approved, non-DNF competitor count. |
| `max_competitors` | number \| null | |
| `scoring_completed` | number | Percent 0-100. |
| `match_status` | string | Lifecycle code (see `events.status` above). |
| `results_status` | string | Visibility: `org` organizers-only, `stg` scores-public, `cmp` participants-only, `all` publicly published. |
| `registration_status` | string | See `events.registration_status`. |
| `registration_starts`, `registration_closes` | string \| null | ISO timestamps. |
| `is_registration_possible` | boolean | |
| `squadding_starts`, `squadding_closes` | string \| null | ISO timestamps. |
| `is_squadding_possible` | boolean | |
| `ssi_url` | string \| null | Canonical SSI URL for the match. |
| `stages` | `StageInfo[]` | One entry per stage. |
| `competitors` | `CompetitorInfo[]` | Approved, non-DNF competitors. |
| `squads` | `SquadInfo[]` | Squad assignments. |
| `cacheInfo` | `CacheInfo` | Server-side cache metadata. |

`StageInfo`: `id`, `name`, `stage_number`, `max_points`, `min_rounds`,
`paper_targets`, `steel_targets`, `ssi_url`, `course_display` (`Short` /
`Medium` / `Long`), `procedure`, `firearm_condition` -- nullable where SSI did
not provide a value.

`CompetitorInfo`: `id` (per-match competitor ID), `shooterId` (globally stable
SSI ShooterNode ID -- the same across matches for the same person), `name`,
`competitor_number`, `club`, `division`, `region` (ISO 3166-1 alpha-3),
`region_display`, `category` (e.g. `S`, `L`, `-`), `ics_alias`, `license`.

`SquadInfo`: `id`, `number`, `name`, `competitorIds[]`.

`CacheInfo`: `cachedAt` (ISO timestamp or `null` for a fresh fetch),
`upstreamDegraded?` (boolean), `lastScorecardAt?` (ISO of the most recent
scorecard SSI knows about), `scorecardsCachedAt?` (ISO of the last scorecard
refetch -- absent on this endpoint, present in the compare endpoint).

### Errors

- `404 not_found` -- match does not exist.
- `400 bad_request` -- `ct` is not a number.
- `502 upstream_failed` -- SSI unreachable or returned an error.

### Example

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://scoreboard.urdr.dev/api/v1/match/22/27190" \
  | jq '{name, scoring_completed, stages: (.stages | length), competitors: (.competitors | length)}'
```

---

## `GET /api/v1/match/{ct}/{id}/competitor/{competitorId}/stages`

Per-competitor, per-stage results for a single match: time, hit factor, points,
hit-zone counts, penalties, and DQ flag. Mirrors the data the MCP
`compare_competitors` and `get_stage_times` tools return, but published on the
v1 contract.

### Path parameters

| Param | Type | Notes |
|---|---|---|
| `ct` | number | SSI Django content type. `22` for IPSC matches. |
| `id` | number | SSI numeric match ID. |
| `competitorId` | number | Per-match competitor ID (`competitors[].id` from the match endpoint). **Not** the global `shooterId`. |

### Response

`200 OK` with a `CompetitorStageResults` object:

| Field | Type | Notes |
|---|---|---|
| `ct` | number | Echoed. |
| `matchId` | number | Echoed. |
| `competitorId` | number | Echoed. |
| `shooterId` | number \| null | Globally stable shooter ID. `null` when SSI did not surface one. |
| `division` | string \| null | Division this competitor was registered in for this match (may differ from the shooter's profile division). |
| `stages` | `CompetitorStageResult[]` | One entry per match stage, ordered by `stage_number` ascending. Stages without a scorecard are emitted with all numeric fields `null` and `dq=false` so callers see a stable per-stage entry. |
| `cacheInfo` | `CacheInfo` | `cachedAt` is the match-overview cache age; `scorecardsCachedAt` is the scorecards cache age and is the right signal during scoring. |

`CompetitorStageResult` per-stage fields:

| Field | Type | Notes |
|---|---|---|
| `stage_number` | number | |
| `stage_id` | number | SSI stage ID (matches `MatchResponse.stages[].id`). |
| `time_seconds` | number \| null | Raw stage time. `null` for unscored / DNF / missing timer reading. |
| `scorecard_updated_at` | string \| null | ISO timestamp of the scorecard. Drives splitsmith's video-match window. |
| `hit_factor` | number \| null | |
| `stage_points` | number \| null | Includes penalty deductions. |
| `stage_pct` | number \| null | HF as percent of the overall stage leader's HF (0-100). |
| `alphas` | number \| null | A-zone hit count. |
| `charlies` | number \| null | C-zone hit count. SSI combines B-zone into C; this field reflects that. |
| `deltas` | number \| null | D-zone hit count. |
| `misses` | number \| null | |
| `no_shoots` | number \| null | |
| `procedurals` | number \| null | |
| `dq` | boolean | `true` for the stage on which the competitor was disqualified. |

### Errors

- `404 not_found` -- match does not exist, or the competitor is not registered in this match.
- `400 bad_request` -- `ct`, `id`, or `competitorId` is not a number.
- `502 upstream_failed` -- SSI unreachable.

### Example

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://scoreboard.urdr.dev/api/v1/match/22/27190/competitor/12345/stages" \
  | jq '{division, stages: (.stages | map({stage_number, time_seconds, hit_factor}))}'
```

---

## `GET /api/v1/shooter/search`

Name search over the shooter profile index. Only shooters who have appeared
in at least one match this app has indexed are searchable.

### Query parameters

| Param | Type | Default | Notes |
|---|---|---|---|
| `q` | string (max 100 chars) | `""` | Empty `q` returns the most-recently-seen shooters (effectively a browse). |
| `limit` | number (1-100) | 20 | Clamped to the range. |

### Response

`200 OK` with an array of `ShooterSearchResult`:

| Field | Type | Notes |
|---|---|---|
| `shooterId` | number | Globally stable ID. Use with `/api/v1/shooter/{shooterId}`. |
| `name` | string | Display name. |
| `club` | string \| null | |
| `division` | string \| null | Latest known division. |
| `lastSeen` | string | ISO timestamp of the most recent match this shooter was indexed in. |

### Errors

- `400 bad_request` -- `limit` is not a number.

### Example

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://scoreboard.urdr.dev/api/v1/shooter/search?q=mathias&limit=10" \
  | jq '.[0]'
```

---

## `GET /api/v1/shooter/{shooterId}`

Cross-match dashboard for a single shooter: profile, recent matches, aggregate
stats, achievements, and any upcoming registrations.

### Path parameters

| Param | Type | Notes |
|---|---|---|
| `shooterId` | number | Globally stable SSI ShooterNode ID. |

### Response

`200 OK` with a `ShooterDashboardResponse`:

| Field | Type | Notes |
|---|---|---|
| `shooterId` | number | Echoed for convenience. |
| `profile` | object \| null | `null` when no profile has been indexed yet. |
| `profile.name` | string | |
| `profile.club` | string \| null | |
| `profile.division` | string \| null | Latest known division. |
| `profile.lastSeen` | string | ISO timestamp. |
| `profile.region` | string \| null | ISO 3166-1 alpha-3. |
| `profile.region_display` | string \| null | |
| `profile.category` | string \| null | IPSC category code (`S`, `L`, `-`). |
| `profile.ics_alias` | string \| null | |
| `profile.license` | string \| null | |
| `matchCount` | number | Total indexed match count (may exceed `matches.length`). |
| `matches` | `ShooterMatchSummary[]` | Up to 50 most recent, newest first. |
| `stats` | `ShooterAggregateStats` | Cross-match aggregates. |
| `achievements` | `AchievementProgress[]` (optional) | Progress per achievement category. |
| `upcomingMatches` | `UpcomingMatch[]` (optional) | Only present when non-empty. |

`ShooterMatchSummary` per-match fields: `ct`, `matchId`, `name`, `date`,
`venue`, `level`, `region`, `division`, `competitorId`,
`competitorsInDivision`, `stageCount`, `avgHF`, `matchPct`, `totalA`,
`totalC`, `totalD`, `totalMiss`, `totalNoShoots`, plus optional
`totalProcedurals`, `dq`, `perfectStages`, `consistencyIndex`,
`squadmateShooterIds`, `squadAllSameClub`, `discipline`.

`ShooterAggregateStats`: `totalStages`, `dateRange.{from,to}`, `overallAvgHF`,
`overallMatchPct`, `aPercent`, `cPercent`, `dPercent`, `missPercent`,
`consistencyCV`, `hfTrendSlope`, plus optional `avgPenaltyRate`,
`avgConsistencyIndex`. Numeric fields are nullable when there isn't enough
data to compute them.

### Errors

- `404 not_found` -- shooter not indexed in this app's database.
- `410 not_found` (note: code is `not_found`, status is `410`) -- shooter has
  been suppressed via GDPR right-to-erasure. Treat the same as a 404.
- `400 bad_request` -- `shooterId` is not a positive integer.

### Example

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://scoreboard.urdr.dev/api/v1/shooter/12345" \
  | jq '{name: .profile.name, matchCount, recent: (.matches[0:3] | map({name, date, matchPct}))}'
```

---

## Authentication

Every `/api/v1/*` request must carry a bearer token:

```
Authorization: Bearer <token>
```

Tokens are configured server-side via the `EXTERNAL_API_TOKENS` environment
variable -- a comma-separated list:

```
EXTERNAL_API_TOKENS=splitsmith-prod-xxxx,splitsmith-dev-yyyy
```

Each consumer should get its own token so revocation is per-consumer.

### Generating tokens

Use any cryptographically random value of >= 32 bytes:

```bash
python -c "import secrets; print('splitsmith-prod-' + secrets.token_urlsafe(32))"
```

### Rotation procedure

1. Generate the new token.
2. Append it to `EXTERNAL_API_TOKENS` (do **not** remove the old one yet):
   ```
   EXTERNAL_API_TOKENS=old-token,new-token
   ```
   On Cloudflare: `wrangler secret put EXTERNAL_API_TOKENS` (paste the
   comma-separated list). On Docker: update the env var on the host and
   restart.
3. Roll out the new token to consumers and confirm they're using it (look at
   their config / your egress logs).
4. Remove the old token from `EXTERNAL_API_TOKENS`.

If `EXTERNAL_API_TOKENS` is unset or empty, **every** v1 request returns
`401 unauthorized` -- there is no implicit "no auth required" mode.

---

## Rate limiting

Per-token, fixed-window:

- Default: 60 req/min per token
- Override: `EXTERNAL_API_RATE_LIMIT_PER_MIN=120` (positive integer)

The bucket key is a SHA-256 hash of the token (the raw token never lands in
Redis). When a token is over the limit:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 23
Content-Type: application/json

{"error":{"code":"rate_limited","message":"Rate limit exceeded"}}
```

Cache outages fail open -- a degraded Redis must not lock external consumers
out (same posture as the internal IP-based limiter).

The internal IP-based rate limit on routes like `/api/events` (30/min) does
**not** apply to `/api/v1/*` calls -- the v1 wrapper bypasses it so the
documented per-token limit is the effective one.

---

## Error envelope

Every non-2xx response uses the same shape:

```json
{
  "error": {
    "code": "<one of the documented codes>",
    "message": "<human-readable explanation, may be passed through from upstream>"
  }
}
```

| Code | HTTP | Meaning |
|---|---|---|
| `unauthorized` | 401 | Missing / malformed Authorization header, unknown token, or `EXTERNAL_API_TOKENS` unconfigured |
| `rate_limited` | 429 | Per-token bucket exhausted; check `Retry-After` |
| `bad_request` | 400 | Malformed query params or path segments |
| `not_found` | 404 (or 410 for GDPR-suppressed shooters) | Resource does not exist |
| `upstream_failed` | 502 | SSI GraphQL or downstream cache failed |

2xx responses **never** contain an `error` key.

---

## Versioning policy

The shape of every successful 2xx response is locked at v1. Within v1:

- **Allowed**: adding new optional fields. Consumers must ignore unknown keys.
- **Not allowed**: renaming, removing, or changing the type of any existing
  field. Such changes require a `/api/v2/` namespace.

Snapshot tests in `tests/unit/api-v1-routes.test.ts` enforce the shape; CI
fails on any drift. Fixtures are typed against the production interfaces via
`satisfies`, so the typechecker also catches divergence between the fixture
and the real types -- snapshots alone could lock a fictional shape if the
fixture was hand-written without that constraint. Updating a snapshot is an
explicit signal that the contract is changing -- review carefully before
doing so.

---

## Caching headers

The v1 endpoints return JSON with no explicit `Cache-Control`, mirroring the
internal routes' behaviour. Edge / SWR caching happens server-side; consumers
can poll on whatever schedule fits their use case.

The `Server-Timing` header that internal routes emit for debugging is
intentionally stripped from v1 responses -- it is not part of the contract.

---

## OpenAPI schema (future)

The issue (#396) lists an OpenAPI 3 spec at `/api/v1/openapi.json` as a
nice-to-have follow-up. Not implemented yet. Consumers should pin to this
markdown contract until that lands.
