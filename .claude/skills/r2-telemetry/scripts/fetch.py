#!/usr/bin/env python3
"""
Fetch + filter telemetry events from the R2 NDJSON store.

Auth: reads the wrangler-cached OAuth token and account ID. Run
`wrangler login` first if the token has expired.

Usage examples (see argparse below for the full set):

    # last 2 hours, all domains
    fetch.py --since 2h

    # last 24 hours, only upstream errors
    fetch.py --since 24h --domain upstream --where outcome=http-error

    # everything that mentions match 22157 in the last 3 days
    fetch.py --since 3d --match 22157

    # group usage events by op + level
    fetch.py --since 7d --domain usage --group-by op,level

    # timeline view (one compact line per event, ts-sorted)
    fetch.py --since 2h --match 22157 --format timeline
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

# ── Auth ─────────────────────────────────────────────────────────────

WRANGLER_CONFIG_CANDIDATES = [
    Path.home() / "Library/Preferences/.wrangler/config/default.toml",  # macOS
    Path.home() / ".config/.wrangler/config/default.toml",              # Linux
    Path.home() / ".wrangler/config/default.toml",                      # legacy
]

# This account ID is specific to this repo's CF account. Run
# `wrangler whoami` to verify if you're hitting auth errors after
# switching accounts.
ACCOUNT_ID = "e1854db8e2a989281305b1b229319c31"

BUCKETS = {
    "prod": "ssi-scoreboard-telemetry",
    "staging": "ssi-scoreboard-telemetry-staging",
}


def read_oauth_token() -> str:
    for path in WRANGLER_CONFIG_CANDIDATES:
        if path.is_file():
            for line in path.read_text().splitlines():
                m = re.match(r'^oauth_token\s*=\s*"([^"]+)"', line)
                if m:
                    return m.group(1)
    sys.exit(
        "Could not find oauth_token in wrangler config. "
        "Run `wrangler login` first."
    )


# ── Time-range expansion ────────────────────────────────────────────

DURATION_RE = re.compile(r"^(\d+)(m|h|d)$")


def parse_since(raw: str, now: datetime) -> datetime:
    """Accept '2h', '30m', '3d', or an ISO date 'YYYY-MM-DD'."""
    m = DURATION_RE.match(raw)
    if m:
        n, unit = int(m.group(1)), m.group(2)
        delta = {"m": "minutes", "h": "hours", "d": "days"}[unit]
        return now - timedelta(**{delta: n})
    try:
        return datetime.strptime(raw, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        sys.exit(f"--since must be like '2h', '3d', or 'YYYY-MM-DD' (got {raw!r})")


def day_prefixes(since: datetime, until: datetime) -> list[str]:
    """UTC day strings from `since` (inclusive) to `until` (inclusive)."""
    days: list[str] = []
    d = since.replace(hour=0, minute=0, second=0, microsecond=0)
    while d.date() <= until.date():
        days.append(d.strftime("%Y-%m-%d"))
        d += timedelta(days=1)
    return days


# ── R2 REST API ─────────────────────────────────────────────────────


def cf_get(path: str, token: str, accept_404: bool = False) -> bytes | None:
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}{path}"
    req = Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urlopen(req, timeout=30) as r:
            return r.read()
    except HTTPError as e:
        if accept_404 and e.code == 404:
            return None
        msg = e.read().decode("utf-8", errors="replace")[:300]
        sys.exit(f"HTTP {e.code} on {path}: {msg}")
    except URLError as e:
        sys.exit(f"Network error on {path}: {e}")


def list_objects(bucket: str, prefix: str, token: str) -> list[str]:
    """Return all object keys under `prefix` for the bucket. Paginates."""
    keys: list[str] = []
    cursor = ""
    while True:
        path = f"/r2/buckets/{bucket}/objects?prefix={quote(prefix)}&per_page=1000"
        if cursor:
            path += f"&cursor={quote(cursor)}"
        body = cf_get(path, token)
        if body is None:
            break
        data = json.loads(body)
        result = data.get("result") or []
        for obj in result:
            keys.append(obj["key"])
        cursor = data.get("result_info", {}).get("cursor", "")
        if not cursor or len(result) < 1000:
            break
    return keys


def fetch_object(bucket: str, key: str, token: str) -> str:
    """Return the NDJSON body of one object."""
    body = cf_get(
        f"/r2/buckets/{bucket}/objects/{quote(key, safe='/')}", token
    )
    return body.decode("utf-8") if body else ""


# ── Filtering ───────────────────────────────────────────────────────

WHERE_RE = re.compile(r"^([^=!]+)(==|=|!=)(.*)$")


def parse_where(raw: list[str]) -> list[tuple[str, str, str]]:
    """Parse `--where key=value,key=value` into (key, op, value) tuples."""
    out: list[tuple[str, str, str]] = []
    for chunk in raw:
        for clause in chunk.split(","):
            clause = clause.strip()
            if not clause:
                continue
            m = WHERE_RE.match(clause)
            if not m:
                sys.exit(f"--where clause must be key=value, got {clause!r}")
            out.append((m.group(1).strip(), m.group(2), m.group(3).strip()))
    return out


def matches_clause(ev: dict[str, Any], key: str, op: str, value: str) -> bool:
    raw = ev.get(key)
    raw_str = str(raw).lower() if raw is not None else ""
    target = value.lower()
    if op == "!=":
        return raw_str != target
    # treat = and == identically — common typo proofing
    return raw_str == target


def passes_filters(
    ev: dict[str, Any],
    domain: str | None,
    op: str | None,
    where: list[tuple[str, str, str]],
    match_substr: str | None,
    shooter_id: int | None,
    since_ts: datetime,
    until_ts: datetime,
) -> bool:
    if domain and ev.get("domain") != domain:
        return False
    if op and ev.get("op") != op:
        return False
    if match_substr is not None:
        # match anywhere across any string-valued field
        joined = " ".join(str(v) for v in ev.values() if isinstance(v, (str, int, float)))
        if match_substr not in joined:
            return False
    if shooter_id is not None and ev.get("shooterId") != shooter_id:
        return False
    if where:
        for k, o, v in where:
            if not matches_clause(ev, k, o, v):
                return False
    ts = ev.get("ts")
    if isinstance(ts, str):
        try:
            ev_ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            if ev_ts < since_ts or ev_ts > until_ts:
                return False
        except ValueError:
            pass
    return True


# ── Output ──────────────────────────────────────────────────────────


def render_timeline(events: list[dict[str, Any]]) -> None:
    events.sort(key=lambda e: e.get("ts", ""))
    for ev in events:
        ts = ev.get("ts", "")[:19]  # YYYY-MM-DDTHH:MM:SS
        dom = ev.get("domain", "?")
        op = ev.get("op", "?")
        # Compact summary of the most useful 2-3 fields per domain
        summary_keys = SUMMARY_KEYS.get(dom, [])
        bits = [f"{k}={ev.get(k)!s}" for k in summary_keys if k in ev]
        print(f"{ts}Z  {dom:9}  {op:30}  {' '.join(bits)}")


SUMMARY_KEYS = {
    "cache": ["matchKey", "trulyDone", "ttl", "scoringPct"],
    "upstream": ["operation", "outcome", "ms", "httpStatus"],
    "error": ["site", "errorClass", "errorMsg"],
    "usage": ["op", "ct", "level", "scoringBucket", "nCompetitors"],
}


def render_group(events: list[dict[str, Any]], keys: list[str]) -> None:
    counts: dict[tuple[str, ...], int] = {}
    for ev in events:
        k = tuple(str(ev.get(key, "<none>")) for key in keys)
        counts[k] = counts.get(k, 0) + 1
    rows = sorted(counts.items(), key=lambda kv: -kv[1])
    widths = [max(len(keys[i]), max((len(k[i]) for k, _ in rows), default=0)) for i in range(len(keys))]
    header = "  ".join(k.ljust(w) for k, w in zip(keys, widths)) + "  count"
    print(header)
    print("-" * len(header))
    for k, c in rows:
        line = "  ".join(v.ljust(w) for v, w in zip(k, widths)) + f"  {c}"
        print(line)
    print(f"\n{sum(c for _, c in rows)} events across {len(rows)} groups")


# ── Main ────────────────────────────────────────────────────────────


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--env", choices=("prod", "staging"), default="prod")
    p.add_argument("--since", default="2h", help="duration like 2h/3d or YYYY-MM-DD (default 2h)")
    p.add_argument("--until", default=None, help="YYYY-MM-DD (default now)")
    p.add_argument("--domain", default=None, help="cache | upstream | error | usage")
    p.add_argument("--op", default=None, help="filter to a specific op within the domain")
    p.add_argument("--match", default=None, help="substring match across all fields (e.g. a match ID)")
    p.add_argument("--shooter", type=int, default=None, help="filter to a specific shooterId")
    p.add_argument("--where", action="append", default=[], help="key=value (repeatable, comma-separable)")
    p.add_argument("--group-by", default=None, help="comma-separated keys to group + count")
    p.add_argument("--limit", type=int, default=200, help="max events to emit (default 200)")
    p.add_argument("--format", choices=("json", "timeline"), default="timeline")
    args = p.parse_args()

    if args.env not in BUCKETS:
        sys.exit(f"--env must be one of: {', '.join(BUCKETS)}")
    bucket = BUCKETS[args.env]

    now = datetime.now(timezone.utc)
    since_ts = parse_since(args.since, now)
    until_ts = (
        datetime.strptime(args.until, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1)
        if args.until
        else now
    )
    if since_ts >= until_ts:
        sys.exit("--since is after --until")

    token = read_oauth_token()
    where = parse_where(args.where)

    # Discover objects across the relevant day prefixes.
    days = day_prefixes(since_ts, until_ts)
    print(f"# scanning {len(days)} day prefix(es) in bucket {bucket}", file=sys.stderr)
    keys: list[str] = []
    for d in days:
        keys.extend(list_objects(bucket, f"cache-telemetry/{d}/", token))
    print(f"# {len(keys)} R2 object(s)", file=sys.stderr)

    # Fetch in parallel.
    events: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        for body in pool.map(lambda k: fetch_object(bucket, k, token), keys):
            for line in body.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if passes_filters(ev, args.domain, args.op, where, args.match, args.shooter, since_ts, until_ts):
                    events.append(ev)

    print(f"# {len(events)} event(s) after filtering", file=sys.stderr)

    if args.group_by:
        keys = [k.strip() for k in args.group_by.split(",") if k.strip()]
        render_group(events, keys)
        return

    # Apply limit (most recent first when applicable)
    events.sort(key=lambda e: e.get("ts", ""), reverse=True)
    events = events[: args.limit]

    if args.format == "timeline":
        render_timeline(events)
    else:
        for ev in events:
            print(json.dumps(ev))


if __name__ == "__main__":
    main()
