#!/usr/bin/env python3
"""
Fetch + filter telemetry events from the R2 Parquet store.

Backed by Cloudflare Pipelines (since 2026-05): a Workers stream
coalesces events across isolates and writes Parquet batches to R2 every
5 min, partitioned by UTC day:

    pipelines/cache-telemetry/YYYY-MM-DD/{uuid}.parquet

This script downloads any new Parquet files in the requested window to
~/.cache/ssi-scoreboard-telemetry/{env}/ (shared with the usage-analysis
skill) and runs the filter as a DuckDB query. No more line-by-line
NDJSON parsing.

Auth: reads the wrangler-cached OAuth token. Run `wrangler login` first
if the token has expired.

Usage examples:

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
import random
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

# ── Auth ─────────────────────────────────────────────────────────────

WRANGLER_CONFIG_CANDIDATES = [
    Path.home() / "Library/Preferences/.wrangler/config/default.toml",  # macOS
    Path.home() / ".config/.wrangler/config/default.toml",              # Linux
    Path.home() / ".wrangler/config/default.toml",                      # legacy
]

ACCOUNT_ID = "e1854db8e2a989281305b1b229319c31"

BUCKETS = {
    "prod": "ssi-scoreboard-telemetry",
    "staging": "ssi-scoreboard-telemetry-staging",
}

# Shared with the usage-analysis skill. Each Parquet file is immutable
# (Pipelines writes once with a UUID name), so on-disk hits are safe.
CACHE_ROOT = Path.home() / ".cache" / "ssi-scoreboard-telemetry"

MAX_RETRIES = 5
INITIAL_BACKOFF_SECONDS = 1.0
MAX_BACKOFF_SECONDS = 30.0


def read_oauth_token() -> str:
    for path in WRANGLER_CONFIG_CANDIDATES:
        if path.is_file():
            for line in path.read_text().splitlines():
                m = re.match(r'^oauth_token\s*=\s*"([^"]+)"', line)
                if m:
                    return m.group(1)
    sys.exit("Could not find oauth_token. Run `wrangler login` first.")


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


def cf_get(path: str, token: str) -> bytes:
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}{path}"
    backoff = INITIAL_BACKOFF_SECONDS
    last_err: str | None = None
    for attempt in range(MAX_RETRIES + 1):
        req = Request(url, headers={"Authorization": f"Bearer {token}"})
        try:
            with urlopen(req, timeout=30) as r:
                return r.read()
        except HTTPError as e:
            if e.code == 429 or e.code >= 500:
                if attempt >= MAX_RETRIES:
                    last_err = f"HTTP {e.code} after {MAX_RETRIES} retries"
                    break
                retry_after = e.headers.get("Retry-After") if e.headers else None
                if retry_after and retry_after.isdigit():
                    sleep_for = float(retry_after)
                else:
                    sleep_for = backoff + random.uniform(0, backoff * 0.5)
                sleep_for = min(sleep_for, MAX_BACKOFF_SECONDS)
                print(
                    f"# {e.code} on {path[:80]} -- retry {attempt + 1}/{MAX_RETRIES} in {sleep_for:.1f}s",
                    file=sys.stderr,
                )
                time.sleep(sleep_for)
                backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)
                continue
            msg = e.read().decode("utf-8", errors="replace")[:300]
            sys.exit(f"HTTP {e.code} on {path}: {msg}")
        except URLError as e:
            if attempt >= MAX_RETRIES:
                last_err = f"network error: {e}"
                break
            sleep_for = min(backoff + random.uniform(0, backoff * 0.5), MAX_BACKOFF_SECONDS)
            print(
                f"# network error on {path[:80]} -- retry {attempt + 1}/{MAX_RETRIES} in {sleep_for:.1f}s",
                file=sys.stderr,
            )
            time.sleep(sleep_for)
            backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)
            continue
    sys.exit(f"Exhausted retries on {path}: {last_err}")


def list_objects(bucket: str, prefix: str, token: str) -> list[str]:
    """Return all object keys under `prefix` for the bucket. Paginates."""
    keys: list[str] = []
    cursor = ""
    while True:
        path = f"/r2/buckets/{bucket}/objects?prefix={quote(prefix)}&per_page=1000"
        if cursor:
            path += f"&cursor={quote(cursor)}"
        body = cf_get(path, token)
        data = json.loads(body)
        result = data.get("result") or []
        for obj in result:
            keys.append(obj["key"])
        cursor = data.get("result_info", {}).get("cursor", "")
        if not cursor or len(result) < 1000:
            break
    return keys


def sync_window(env: str, since_ts: datetime, until_ts: datetime, token: str) -> Path:
    """Download any Parquet files in [since, until] we don't already have."""
    bucket = BUCKETS[env]
    root = CACHE_ROOT / env
    root.mkdir(parents=True, exist_ok=True)
    days = day_prefixes(since_ts, until_ts)
    print(f"# scanning {len(days)} day prefix(es) in bucket {bucket}", file=sys.stderr)
    keys: list[str] = []
    for d in days:
        keys.extend(list_objects(bucket, f"pipelines/cache-telemetry/{d}/", token))
    print(f"# {len(keys)} R2 object(s)", file=sys.stderr)

    def fetch_one(key: str) -> bool:
        dest = root / key
        if dest.exists():
            return False
        body = cf_get(f"/r2/buckets/{bucket}/objects/{quote(key, safe='/')}", token)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".tmp")
        tmp.write_bytes(body)
        tmp.replace(dest)
        return True

    new_count = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for downloaded in pool.map(fetch_one, keys):
            if downloaded:
                new_count += 1
    print(f"# downloaded {new_count} new file(s) ({len(keys) - new_count} cached)", file=sys.stderr)
    return root


# ── Filtering: SQL builder ─────────────────────────────────────────

WHERE_RE = re.compile(r"^([^=!]+)(==|=|!=)(.*)$")


def sql_str(s: str) -> str:
    """Single-quote a string for embedding in DuckDB SQL."""
    return "'" + s.replace("'", "''") + "'"


def field(key: str) -> str:
    """SQL fragment to extract a field from the doubly-wrapped value column."""
    return f"json_extract_string(value, '$.value.{key}')"


def build_query(args: argparse.Namespace, since_iso: str, until_iso: str, glob: str) -> str:
    where: list[str] = [
        f"{field('ts')} >= {sql_str(since_iso)}",
        f"{field('ts')} <= {sql_str(until_iso)}",
    ]
    if args.domain:
        where.append(f"{field('domain')} = {sql_str(args.domain)}")
    if args.op:
        where.append(f"{field('op')} = {sql_str(args.op)}")
    if args.shooter is not None:
        where.append(f"cast({field('shooterId')} as bigint) = {int(args.shooter)}")

    for chunk in args.where:
        for clause in chunk.split(","):
            clause = clause.strip()
            if not clause:
                continue
            m = WHERE_RE.match(clause)
            if not m:
                sys.exit(f"--where clause must be key=value, got {clause!r}")
            key, op_, val = m.group(1).strip(), m.group(2), m.group(3).strip()
            if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
                sys.exit(f"--where key must be a simple identifier, got {key!r}")
            sql_op = "!=" if op_ == "!=" else "="
            where.append(f"lower({field(key)}) {sql_op} lower({sql_str(val)})")

    if args.match:
        # substring match anywhere in the value JSON
        where.append(f"value ILIKE {sql_str('%' + args.match + '%')}")

    where_sql = " AND ".join(where)
    src = f"read_parquet({sql_str(glob)}, union_by_name = true)"

    if args.group_by:
        keys = [k.strip() for k in args.group_by.split(",") if k.strip()]
        for k in keys:
            if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", k):
                sys.exit(f"--group-by key must be a simple identifier, got {k!r}")
        cols = ", ".join(f"{field(k)} AS {k}" for k in keys)
        group = ", ".join(field(k) for k in keys)
        return (
            f"SELECT {cols}, count(*) AS count "
            f"FROM {src} "
            f"WHERE {where_sql} "
            f"GROUP BY {group} "
            f"ORDER BY count DESC;"
        )

    # SELECT all common fields + the inner event JSON for the timeline renderer.
    return (
        f"SELECT "
        f"  {field('ts')} AS ts, "
        f"  {field('domain')} AS domain, "
        f"  {field('op')} AS op, "
        f"  json_extract(value, '$.value') AS j "
        f"FROM {src} "
        f"WHERE {where_sql} "
        f"ORDER BY ts DESC "
        f"LIMIT {int(args.limit)};"
    )


# ── DuckDB invocation + output ─────────────────────────────────────


def run_duckdb(sql: str, fmt: str) -> str:
    flag = {"json": "-json", "timeline": "-csv"}.get(fmt, "-csv")
    proc = subprocess.run(
        ["duckdb", flag, "-c", sql],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"duckdb query failed:\n{proc.stderr}")
    return proc.stdout


SUMMARY_KEYS = {
    "cache": ["matchKey", "trulyDone", "ttl", "scoringPct"],
    "upstream": ["operation", "outcome", "ms", "httpStatus"],
    "error": ["site", "errorClass", "errorMsg"],
    "usage": ["op", "ct", "level", "scoringBucket", "nCompetitors"],
}


def render_timeline_csv(csv: str) -> None:
    import csv as _csv
    from io import StringIO

    reader = _csv.DictReader(StringIO(csv))
    for row in reader:
        ts = (row.get("ts") or "")[:19]
        dom = row.get("domain", "?") or "?"
        op = row.get("op", "?") or "?"
        # j is the inner event JSON; parse it for the summary fields.
        try:
            j = json.loads(row.get("j") or "{}")
        except (TypeError, ValueError):
            j = {}
        bits = []
        for k in SUMMARY_KEYS.get(dom, []):
            v = j.get(k)
            if v not in (None, ""):
                bits.append(f"{k}={v}")
        print(f"{ts}Z  {dom:9}  {op:30}  {' '.join(bits)}")


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
    cache_root = sync_window(args.env, since_ts, until_ts, token)

    glob = str(cache_root / "pipelines" / "cache-telemetry" / "**" / "*.parquet")
    sql = build_query(args, since_ts.isoformat().replace("+00:00", "Z"),
                      until_ts.isoformat().replace("+00:00", "Z"), glob)

    if args.format == "json":
        out = run_duckdb(sql, "json")
        sys.stdout.write(out)
    elif args.group_by:
        # CSV with header — print as a simple aligned table.
        import csv as _csv
        from io import StringIO
        out = run_duckdb(sql, "timeline")
        reader = _csv.reader(StringIO(out))
        rows = list(reader)
        if not rows:
            return
        widths = [max(len(c) for c in col) for col in zip(*rows)]
        for r in rows:
            print("  ".join(c.ljust(w) for c, w in zip(r, widths)))
        print(f"\n{len(rows) - 1} groups")
    else:
        out = run_duckdb(sql, "timeline")
        render_timeline_csv(out)


if __name__ == "__main__":
    main()
