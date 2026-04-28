#!/usr/bin/env python3
"""
Gather everything that touched a match (or shooter) into one annotated
timeline. Calls the r2-telemetry fetch.py under the hood, then layers
the events from each domain on top of each other so you can read the
divergence point chronologically.

Output is gather-mode by design — no analysis, no flagging. The
operator reads the timeline and decides where the bug lives.

Usage:
    gather.py --match 22157 [--since 24h] [--env prod|staging]
    gather.py --shooter 12345 [--since 7d]

Reads OAuth from wrangler config (same as fetch.py).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# Path to the sibling skill's fetch script.
FETCH_PY = (
    Path(__file__).resolve().parent.parent.parent / "r2-telemetry" / "scripts" / "fetch.py"
)


def run_fetch(args: list[str]) -> list[dict]:
    """Run fetch.py with --format json and return the parsed events."""
    cmd = [str(FETCH_PY), "--format", "json", "--limit", "10000", *args]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"# fetch.py failed: {result.stderr.strip()}", file=sys.stderr)
        return []
    events: list[dict] = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return events


def fmt_event(ev: dict) -> str:
    ts = ev.get("ts", "")[:19]
    domain = ev.get("domain", "?")
    op = ev.get("op", "?")
    if domain == "cache":
        return (
            f"{ts}Z  cache     {op:24}  "
            f"trulyDone={ev.get('trulyDone')!s:5}  ttl={ev.get('ttl')!s:5}  "
            f"scoringPct={ev.get('scoringPct')}  status={ev.get('status')}  "
            f"resultsPublished={ev.get('resultsPublished')}"
        )
    if domain == "upstream":
        return (
            f"{ts}Z  upstream  {ev.get('operation', '?'):24}  "
            f"outcome={ev.get('outcome')}  ms={ev.get('ms')}  "
            f"http={ev.get('httpStatus')}  bytes={ev.get('bytes')}"
        )
    if domain == "error":
        msg = (ev.get("errorMsg") or "")[:80]
        return (
            f"{ts}Z  error     {ev.get('site', '?'):24}  "
            f"class={ev.get('errorClass')}  msg={msg!r}"
        )
    if domain == "usage":
        bits = []
        for k in ("ct", "level", "scoringBucket", "mode", "nCompetitors", "variant", "kind", "queryLength", "resultBucket", "matchCountBucket", "cacheHit"):
            if k in ev:
                bits.append(f"{k}={ev[k]}")
        return f"{ts}Z  usage     {op:24}  {' '.join(bits)}"
    return f"{ts}Z  {domain:9}  {op}  {json.dumps({k: v for k, v in ev.items() if k not in ('ts', 'domain', 'op')})}"


def render_timeline(events: list[dict]) -> None:
    events.sort(key=lambda e: e.get("ts", ""))
    for ev in events:
        print(fmt_event(ev))


def render_summary(events: list[dict], scope: str) -> None:
    """Quick numeric summary at the top so the operator sees shape first."""
    by_domain: dict[str, int] = {}
    by_outcome: dict[str, int] = {}
    error_sites: dict[str, int] = {}
    cache_pinned = 0
    cache_total = 0
    for ev in events:
        d = ev.get("domain", "?")
        by_domain[d] = by_domain.get(d, 0) + 1
        if d == "upstream":
            by_outcome[ev.get("outcome", "?")] = by_outcome.get(ev.get("outcome", "?"), 0) + 1
        if d == "error":
            error_sites[ev.get("site", "?")] = error_sites.get(ev.get("site", "?"), 0) + 1
        if d == "cache" and ev.get("op") == "match-ttl-decision":
            cache_total += 1
            if ev.get("trulyDone"):
                cache_pinned += 1
    print(f"# === incident summary for {scope} ===")
    print(f"# total events: {len(events)}")
    print(f"# by domain:    {dict(sorted(by_domain.items()))}")
    if by_outcome:
        print(f"# upstream:     {dict(sorted(by_outcome.items()))}")
    if cache_total:
        print(f"# cache TTL:    {cache_pinned}/{cache_total} decisions pinned (trulyDone=true)")
    if error_sites:
        print(f"# error sites:  {dict(sorted(error_sites.items()))}")
    print("#")
    print("# === timeline ===")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    grp = p.add_mutually_exclusive_group(required=True)
    grp.add_argument("--match", help="match ID — substring searched across all event fields")
    grp.add_argument("--shooter", type=int, help="shooter ID — exact match on shooterId")
    p.add_argument("--env", choices=("prod", "staging"), default="prod")
    p.add_argument("--since", default="24h", help="duration (2h/3d) or YYYY-MM-DD; default 24h")
    p.add_argument("--until", default=None)
    args = p.parse_args()

    if not FETCH_PY.is_file():
        sys.exit(f"Could not find r2-telemetry fetch.py at {FETCH_PY}")

    base_args = ["--env", args.env, "--since", args.since]
    if args.until:
        base_args.extend(["--until", args.until])

    if args.match:
        scope = f"match {args.match}"
        events = run_fetch([*base_args, "--match", args.match])
    else:
        scope = f"shooter {args.shooter}"
        # error events have shooterId; cache/upstream/usage do not. Two passes:
        #   1) error events filtered by shooterId
        #   2) match-scoped events for any matchKey that appeared next to those errors
        # Keeping it simple: just the direct shooter events for now.
        events = run_fetch([*base_args, "--shooter", str(args.shooter)])

    if not events:
        print(f"# no events found for {scope} in the past {args.since} ({args.env})")
        print("# tips:")
        print("#   - widen --since (R2 retains 30 days)")
        print("#   - check --env (default is prod; try staging)")
        print("#   - run: wrangler login   (token rotates ~hourly)")
        return

    print(f"# generated at {datetime.now(timezone.utc).isoformat()}")
    render_summary(events, scope)
    render_timeline(events)


if __name__ == "__main__":
    main()
