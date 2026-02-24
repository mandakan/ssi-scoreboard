# Deploying to Cloudflare Pages + Upstash Redis

This guide assumes you already have:
- A Cloudflare account with a domain you control
- An Upstash Redis database (REST URL + token from the Upstash console)
- Wrangler installed or available via `npx`

---

## Step 1 — Authenticate Wrangler

```bash
wrangler login
```

This opens a browser window to authorise the CLI against your Cloudflare account.

---

## Step 2 — Set secrets

Run each command below — Wrangler will prompt you to paste the value:

```bash
wrangler secret put SSI_API_KEY
wrangler secret put CACHE_PURGE_SECRET
wrangler secret put UPSTASH_REDIS_REST_URL
wrangler secret put UPSTASH_REDIS_REST_TOKEN
```

| Secret | Where to find it |
|---|---|
| `SSI_API_KEY` | ShootNScoreIt account settings |
| `CACHE_PURGE_SECRET` | Any strong random string — e.g. `openssl rand -hex 32` |
| `UPSTASH_REDIS_REST_URL` | Upstash console → your database → REST API → Endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash console → your database → REST API → Token |

Secrets are stored encrypted in Cloudflare and never committed to the repository.

---

## Step 3 — Build and deploy

```bash
pnpm cf:deploy
```

This runs `DEPLOY_TARGET=cloudflare npx @opennextjs/cloudflare build` followed by
`wrangler deploy`. On first run it creates the `ssi-scoreboard` Pages project automatically.
At the end of the output Wrangler prints the deployment URL:

```
✅  Deployed to https://ssi-scoreboard.pages.dev
```

---

## Step 4 — Add a custom subdomain

1. Open **Cloudflare Dashboard → Workers & Pages → ssi-scoreboard → Custom domains**
2. Click **Set up a custom domain**
3. Enter your subdomain (e.g. `scores.example.com`)
4. Because your domain is already on Cloudflare, the required CNAME record is added
   automatically — click **Activate domain** to confirm

SSL is provisioned automatically; the domain is usually live within a few minutes.

---

## Step 5 — Verify

```bash
# Version endpoint — should return a JSON object
curl https://scores.example.com/api/version

# Match lookup — should return data, not a 500
curl "https://scores.example.com/api/match/22/<some-match-id>"
```

A second request for the same match should be noticeably faster once the Upstash cache
is warm.

---

## Subsequent deploys

```bash
pnpm cf:deploy
```

Secrets persist between deploys — only re-run `wrangler secret put` when a value changes.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| 500 on all API routes | `SSI_API_KEY` secret missing or wrong |
| Every request is a cache miss | `UPSTASH_REDIS_REST_URL` or `_TOKEN` missing or wrong |
| Build fails with an ioredis error | `DEPLOY_TARGET` not set — always use `pnpm cf:deploy`, never bare `pnpm build` |
| Custom domain not resolving | DNS propagation — wait a few minutes and retry |

To stream live Worker logs:

```bash
wrangler pages deployment tail
```

---

## Known limitations

The **popular matches** feature (recently viewed matches on the home page) is unavailable
on Cloudflare Pages. Upstash's HTTP API does not expose `OBJECT IDLETIME`, so the
`/api/popular-matches` endpoint returns `[]`. All other features work identically to the
Docker target.
