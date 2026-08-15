# Post-mortem: SSI Scoreboard traffic burst against shootnscoreit.com, 2026-08-15

From: SSI Scoreboard (ssi-scoreboard.long-sun-fac0.workers.dev)
To: ShootNScoreIt team
Status: our outbound traffic is fully paused; fixes are implemented and deployed
Contact: m@thias.se

## Summary

On the morning of 2026-08-15, during a live Level III match in Sweden, our
application sent a burst of 156 GraphQL `events` search queries to
shootnscoreit.com within roughly 10 seconds. We believe this burst
contributed to, and may have caused, the outage of shootnscoreit.com that
followed. We are sorry. This document explains what happened, what we have
already done about it, and what we changed so it cannot happen again.

## What our application does

SSI Scoreboard is a read-only live scoreboard and comparison tool built on
top of your public GraphQL API. It caches aggressively (Redis plus a durable
mirror) precisely so that courtside usage during a match does not translate
into load on your servers. Under normal operation our total volume is small:
in the 24 hours around the incident we sent about 820 GraphQL requests in
total, roughly 34 per hour.

## Timeline (UTC)

- 07:55-08:00 -- normal traffic: users viewing a live Swedish L3 match
  through our cached pages (cache hits, no unusual upstream load).
- 08:00:13-08:00:23 -- two requests to our event-browse endpoint carried
  caller-supplied date ranges of roughly two years and one year. Our
  endpoint fanned these out into 156 parallel `events` queries (104
  distinct 7-day windows plus overlap) against your GraphQL API within
  about 10 seconds, peaking above 20 concurrent requests per second.
  Every query returned HTTP 200; observed p95 latency was about 5 seconds,
  which suggests the queries were expensive on your side.
- Shortly after -- shootnscoreit.com became unavailable during the live
  match (as reported to us; we do not have visibility into your systems).
- 11:20 -- on learning of the outage we deployed an emergency kill switch
  that blocks every outbound request from our application to
  shootnscoreit.com, including authentication calls. It has been on since
  then. Our users are served cached data only.

## Root cause

Your API applies a result cap on un-searched `events` queries, so our
browse endpoint splits a requested date range into 7-day sub-windows and
queries each window separately. Two bugs in that design combined:

1. No limit on the requested range. The endpoint accepted arbitrary
   `starts_after`/`starts_before` values from callers (including our
   public API and MCP integrations) and generated one sub-window query
   per 7 days, unbounded. A two-year range meant 104 upstream queries
   for a single incoming request.
2. No concurrency limit. All sub-window queries were fired in parallel
   at once, so those 104 queries hit your API within seconds instead of
   trickling out.

Our per-caller rate limiting did not help, because a single incoming
request was amplified about 100-fold before it reached the rate-limited
boundary of your API.

## What we fixed (deployed before we resume any traffic)

1. Range cap: a browse request can now generate at most 10 sub-windows
   (70 days). Our own UI never requests more than about 5. Wider ranges
   are truncated, and integrations are documented to page with narrow
   requests, which our rate limits then bound.
2. Concurrency cap: sub-window queries now run at most 4 at a time
   instead of all at once.
3. Kill switch: a permanent operational switch that stops every outbound
   request to shootnscoreit.com within seconds, without a deploy. It is
   active right now and stays active until you confirm you are
   comfortable with us resuming.

Worst case per incoming browse request is now 10 queries, at most 4 in
flight, instead of unbounded. Combined with our caching (each sub-window
result is cached for an hour), repeat browsing generates no upstream
traffic at all.

## What we ask of you

- Let us know when you are comfortable with us re-enabling traffic; we
  will start with cached-match refreshes only and watch our telemetry.
- If you have server-side rate limits or a preferred request budget for
  API consumers, tell us the numbers and we will enforce them client-side.
- If you can share anything from your side about the outage window
  (around 08:00-08:30 UTC), it would help us confirm whether our burst
  was the trigger or a contributing factor.

We value the API and the work you do running it, and we want our tool to
be a well-behaved consumer of it. Again, our apologies for the trouble
this caused during a live match.
