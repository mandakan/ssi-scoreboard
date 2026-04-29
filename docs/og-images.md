# OG Images

Dynamic Open Graph images are generated on-the-fly for match pages using `next/og` (Satori).
The OG image endpoint at `app/api/og/match/[ct]/[id]/route.tsx` renders three variants:

- **Match overview** -- match name, venue/date/level, stat badges (stages, competitors, % scored)
- **Single competitor** -- competitor name, division/club, match context
- **Multi-competitor** -- "Comparing N competitors" with colored bullets (uses PALETTE from `lib/colors.ts`)

Page metadata in `app/match/[ct]/[id]/layout.tsx` sets `<meta property="og:image">` pointing at
the OG endpoint. The OG URL intentionally omits `?competitors=` to avoid `searchParams` dependency
(which would block client-side soft navigation). The endpoint accepts an optional `?competitors=`
param for direct use.

`lib/og-data.ts` fetches match data using the same cached GraphQL path as the match API route
(usually a Redis cache hit). A 1500ms timeout via `Promise.race` prevents slow upstreams from
blocking `generateMetadata()` during client-side `router.replace()` soft navigations.

Cache-Control headers are set based on match completion: active matches get short TTLs (1min/5min),
completed matches get long TTLs (1day/7days).

## Local testing

```bash
pnpm dev
# Open directly in browser -- returns a PNG:
open http://localhost:3000/api/og/match/22/{match_id}
# With competitors:
open http://localhost:3000/api/og/match/22/{match_id}?competitors=123,456
# Inspect the meta tags in page source:
curl -s http://localhost:3000/match/22/{match_id} | grep 'og:image'
```
