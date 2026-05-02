# Public API v1

`/api/v1/*` is the **stable, externally-consumable** surface of this app. It
exists so projects like [splitsmith](https://github.com/mandakan/splitsmith)
(IPSC shot-split extraction from head-cam footage) can pull match and shooter
data without re-implementing the SSI GraphQL client, vendoring the MCP server,
or pinning to internal `/api/*` routes that may change at any time.

The internal `/api/*` routes used by the browser app remain unauthenticated
and are **not** part of any contract. Only `/api/v1/*` is gated, rate-limited,
and shape-locked.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/events` | Match search / browse |
| GET | `/api/v1/match/{ct}/{id}` | Full match overview |
| GET | `/api/v1/shooter/search` | Name search over indexed shooter profiles |
| GET | `/api/v1/shooter/{shooterId}` | Shooter dashboard (stats, achievements, recent matches) |

### `GET /api/v1/events`

Query parameters (all optional):

- `q` -- text search; passes through to SSI's search backend
- `minLevel` -- `all` | `l2plus` | `l3plus` | `l4plus` (default `all`)
- `country` -- ISO 3166-1 alpha-3, e.g. `SWE`
- `starts_after`, `starts_before` -- ISO date (`YYYY-MM-DD`)
- `firearms` -- `hg` | `rfl` | `shg` | `pcc` | `mr` | `prr` | `air`
- `live=1` -- restrict to matches scoring right now (overrides level + window)

Returns an array of `EventSummary` (see `lib/types.ts`).

### `GET /api/v1/match/{ct}/{id}`

`ct` is the SSI Django content type. For all IPSC matches today this is `22`.
`id` is the match's numeric SSI ID.

Returns a `MatchResponse`.

### `GET /api/v1/shooter/search`

Query parameters:

- `q` -- name fragment (max 100 chars)
- `limit` -- 1-100 (default 20)

Returns an array of `ShooterSearchResult`.

### `GET /api/v1/shooter/{shooterId}`

`shooterId` is the globally stable SSI ShooterNode primary key (the same number
that appears across matches for the same person).

Returns a `ShooterDashboardResponse`. A 410 means the shooter exercised their
GDPR right to erasure -- treat the same as a 404 from the consumer's POV.

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

Use any cryptographically random value of >= 32 bytes. A short shell snippet:

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

## Versioning policy

The shape of every successful 2xx response is locked at v1. Within v1:

- **Allowed**: adding new optional fields. Consumers must ignore unknown keys.
- **Not allowed**: renaming, removing, or changing the type of any existing
  field. Such changes require a `/api/v2/` namespace.

Snapshot tests in `tests/unit/api-v1-routes.test.ts` enforce the shape; CI
fails on any drift. Updating a snapshot is an explicit signal that the
contract is changing -- review carefully before doing so.

## Caching headers

The v1 endpoints return JSON with no explicit `Cache-Control`, mirroring the
internal routes' behaviour. Edge / SWR caching happens server-side; consumers
can poll on whatever schedule fits their use case.

## OpenAPI schema (future)

The issue (#396) lists an OpenAPI 3 spec at `/api/v1/openapi.json` as a
nice-to-have follow-up. Not implemented yet. Consumers should pin to this
markdown contract until that lands.
