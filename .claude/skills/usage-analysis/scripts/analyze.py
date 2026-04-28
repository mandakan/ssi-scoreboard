#!/usr/bin/env python3
"""
SSI Scoreboard usage analysis — sync R2 telemetry to a local DuckDB
and run canned or ad-hoc SQL against it.

Layout:
    ~/.cache/ssi-scoreboard-telemetry/
        prod/cache-telemetry/YYYY-MM-DD/*.ndjson
        staging/cache-telemetry/YYYY-MM-DD/*.ndjson
        prod.duckdb
        staging.duckdb

The .duckdb file is just a thin layer of views over the NDJSON glob —
all data lives in the NDJSON files. Delete the cache directory to fully
reset.

Subcommands:

    sync   — incremental download of new R2 objects
    report — canned analytics digest (event volumes, funnels, etc.)
    sql    — run an ad-hoc SQL statement against the DuckDB
    open   — print the path to the DuckDB file (for `duckdb $(... open)`)
    queries — print useful query recipes

Auth: same OAuth-token-from-wrangler-config pattern as r2-telemetry.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

# ── Auth (mirrors r2-telemetry) ─────────────────────────────────────

WRANGLER_CONFIG_CANDIDATES = [
    Path.home() / "Library/Preferences/.wrangler/config/default.toml",
    Path.home() / ".config/.wrangler/config/default.toml",
    Path.home() / ".wrangler/config/default.toml",
]
ACCOUNT_ID = "e1854db8e2a989281305b1b229319c31"
BUCKETS = {
    "prod": "ssi-scoreboard-telemetry",
    "staging": "ssi-scoreboard-telemetry-staging",
}

CACHE_ROOT = Path.home() / ".cache" / "ssi-scoreboard-telemetry"
SETUP_SQL = Path(__file__).resolve().parent / "setup.sql"


def read_oauth_token() -> str:
    for path in WRANGLER_CONFIG_CANDIDATES:
        if path.is_file():
            for line in path.read_text().splitlines():
                m = re.match(r'^oauth_token\s*=\s*"([^"]+)"', line)
                if m:
                    return m.group(1)
    sys.exit("Could not find oauth_token. Run `wrangler login` first.")


def cf_get(path: str, token: str) -> bytes:
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}{path}"
    req = Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urlopen(req, timeout=30) as r:
            return r.read()
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:300]
        sys.exit(f"HTTP {e.code} on {path}: {body}")
    except URLError as e:
        sys.exit(f"Network error on {path}: {e}")


# ── Sync ────────────────────────────────────────────────────────────


def env_root(env: str) -> Path:
    return CACHE_ROOT / env


def parse_since(raw: str, now: datetime) -> datetime:
    m = re.match(r"^(\d+)(m|h|d)$", raw)
    if m:
        n, unit = int(m.group(1)), m.group(2)
        return now - timedelta(**{{"m": "minutes", "h": "hours", "d": "days"}[unit]: n})
    try:
        return datetime.strptime(raw, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        sys.exit(f"--since must be like '2h', '7d', or 'YYYY-MM-DD' (got {raw!r})")


def list_objects(bucket: str, prefix: str, token: str) -> list[dict]:
    """Return all R2 objects under prefix. Each entry has 'key' and 'size'."""
    objs: list[dict] = []
    cursor = ""
    while True:
        path = f"/r2/buckets/{bucket}/objects?prefix={quote(prefix)}&per_page=1000"
        if cursor:
            path += f"&cursor={quote(cursor)}"
        body = cf_get(path, token)
        data = json.loads(body)
        for o in data.get("result") or []:
            objs.append(o)
        cursor = (data.get("result_info") or {}).get("cursor", "")
        if not cursor or len(data.get("result") or []) < 1000:
            break
    return objs


def fetch_object(bucket: str, key: str, token: str, dest: Path) -> bool:
    if dest.exists():
        return False
    body = cf_get(f"/r2/buckets/{bucket}/objects/{quote(key, safe='/')}", token)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(body)
    return True


def cmd_sync(args: argparse.Namespace) -> None:
    bucket = BUCKETS[args.env]
    root = env_root(args.env)
    root.mkdir(parents=True, exist_ok=True)
    token = read_oauth_token()

    now = datetime.now(timezone.utc)
    since_ts = parse_since(args.since, now)

    # Day prefixes from since to now (UTC).
    days: list[str] = []
    d = since_ts.replace(hour=0, minute=0, second=0, microsecond=0)
    while d.date() <= now.date():
        days.append(d.strftime("%Y-%m-%d"))
        d += timedelta(days=1)

    print(f"# scanning {len(days)} day(s) in {bucket}", file=sys.stderr)
    all_objects: list[dict] = []
    for day in days:
        all_objects.extend(list_objects(bucket, f"cache-telemetry/{day}/", token))
    print(f"# {len(all_objects)} object(s) on R2", file=sys.stderr)

    new_count = 0

    def download(obj: dict) -> bool:
        dest = root / obj["key"]
        return fetch_object(bucket, obj["key"], token, dest)

    with ThreadPoolExecutor(max_workers=8) as pool:
        for downloaded in pool.map(download, all_objects):
            if downloaded:
                new_count += 1

    print(f"# downloaded {new_count} new file(s) (skipped {len(all_objects) - new_count})", file=sys.stderr)

    # Make sure DuckDB views exist + are current.
    refresh_views(args.env)
    print(f"# DuckDB ready: {duckdb_path(args.env)}", file=sys.stderr)


# ── DuckDB integration ─────────────────────────────────────────────


def duckdb_path(env: str) -> Path:
    return CACHE_ROOT / f"{env}.duckdb"


def refresh_views(env: str) -> None:
    """Run setup.sql against the DuckDB file, with CACHE_DIR substituted."""
    cache_dir = env_root(env)
    sql = SETUP_SQL.read_text().replace("CACHE_DIR", str(cache_dir))
    proc = subprocess.run(
        ["duckdb", str(duckdb_path(env))],
        input=sql,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"duckdb setup failed:\n{proc.stderr}")


def run_sql(env: str, sql: str, format_: str = "box", strict: bool = True) -> str:
    """Run a SQL statement against the DuckDB file. Returns stdout.

    When strict=False, a query that fails (e.g. references a column that
    doesn't exist yet because no events of that domain have been written)
    returns an explanatory string instead of exiting.
    """
    refresh_views(env)
    args = ["duckdb", str(duckdb_path(env))]
    # -box (default), -markdown, -csv, -json, -line
    if format_ == "markdown":
        args.append("-markdown")
    elif format_ == "csv":
        args.append("-csv")
    elif format_ == "json":
        args.append("-json")
    proc = subprocess.run(args, input=sql, capture_output=True, text=True)
    if proc.returncode != 0:
        if strict:
            sys.exit(f"duckdb query failed:\n{proc.stderr}")
        return f"(no data — {proc.stderr.strip().splitlines()[0] if proc.stderr.strip() else 'unknown error'})\n"
    return proc.stdout


# ── Canned report ──────────────────────────────────────────────────


def cmd_report(args: argparse.Namespace) -> None:
    since_clause = f"WHERE ts >= now() - INTERVAL '{int(args.days)} days'"

    sections = [
        ("Event volumes by domain & op", f"""
            SELECT domain, op, count(*) AS events
            FROM events {since_clause}
            GROUP BY domain, op
            ORDER BY events DESC;
        """),
        ("Match views: top 10 levels", f"""
            SELECT level, count(*) AS views
            FROM usage_events
            {since_clause} AND op = 'match-view'
            GROUP BY level ORDER BY views DESC LIMIT 10;
        """),
        ("Match views: top 10 regions", f"""
            SELECT region, count(*) AS views
            FROM usage_events
            {since_clause} AND op = 'match-view'
            GROUP BY region ORDER BY views DESC LIMIT 10;
        """),
        ("Match views: scoring bucket mix", f"""
            SELECT scoringBucket, count(*) AS views,
                   round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
            FROM usage_events
            {since_clause} AND op = 'match-view'
            GROUP BY scoringBucket ORDER BY views DESC;
        """),
        ("Match-view cache hit rate", f"""
            SELECT cacheHit, count(*) AS views,
                   round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
            FROM usage_events
            {since_clause} AND op = 'match-view'
            GROUP BY cacheHit;
        """),
        ("Comparison breakdown", f"""
            SELECT mode, nCompetitors, count(*) AS opens
            FROM usage_events
            {since_clause} AND op = 'comparison'
            GROUP BY mode, nCompetitors
            ORDER BY mode, nCompetitors;
        """),
        ("Search effectiveness", f"""
            SELECT kind, resultBucket, count(*) AS searches,
                   round(avg(queryLength), 1) AS avg_query_len
            FROM usage_events
            {since_clause} AND op = 'search'
            GROUP BY kind, resultBucket
            ORDER BY kind, searches DESC;
        """),
        ("OG image variants", f"""
            SELECT variant, count(*) AS renders
            FROM usage_events
            {since_clause} AND op = 'og-render'
            GROUP BY variant ORDER BY renders DESC;
        """),
        ("Shooter dashboard match-count buckets", f"""
            SELECT matchCountBucket, count(*) AS views,
                   sum(case when cacheHit then 1 else 0 end) AS cache_hits
            FROM usage_events
            {since_clause} AND op = 'shooter-dashboard-view'
            GROUP BY matchCountBucket
            ORDER BY views DESC;
        """),
        ("Upstream outcome distribution", f"""
            SELECT operation, outcome, count(*) AS calls,
                   round(avg(ms), 0) AS avg_ms,
                   round(quantile_cont(ms, 0.95), 0) AS p95_ms
            FROM upstream_events
            {since_clause}
            GROUP BY operation, outcome
            ORDER BY operation, calls DESC;
        """),
        ("Error sites", f"""
            SELECT site, errorClass, count(*) AS errors
            FROM error_events
            {since_clause}
            GROUP BY site, errorClass
            ORDER BY errors DESC;
        """),
        ("Daily trend: events by domain", f"""
            SELECT date_trunc('day', ts) AS day,
                   domain,
                   count(*) AS events
            FROM events {since_clause}
            GROUP BY day, domain
            ORDER BY day DESC, events DESC;
        """),
    ]

    print(f"# === USAGE REPORT (env={args.env}, last {args.days} days) ===\n")
    for title, sql in sections:
        print(f"## {title}")
        out = run_sql(args.env, sql.strip(), format_="markdown", strict=False)
        print(out.strip() or "(no rows)")
        print()


# ── Other subcommands ───────────────────────────────────────────────


def cmd_sql(args: argparse.Namespace) -> None:
    sql = args.statement
    if not sql.endswith(";"):
        sql += ";"
    sys.stdout.write(run_sql(args.env, sql, format_=args.format))


def cmd_open(args: argparse.Namespace) -> None:
    refresh_views(args.env)
    print(duckdb_path(args.env))


def cmd_queries(args: argparse.Namespace) -> None:
    print(QUERY_RECIPES.strip())


QUERY_RECIPES = """
-- Useful DuckDB query recipes for SSI Scoreboard telemetry.
-- Open with:  duckdb $(./analyze.py open --env=prod)

-- Top 20 most-viewed matches (telemetry-recorded ct only, no IDs leaked)
SELECT ct, count(*) AS views
FROM usage_events
WHERE op = 'match-view' AND ts >= now() - INTERVAL '7 days'
GROUP BY ct ORDER BY views DESC LIMIT 20;

-- Comparison conversion: how many match-views lead to a comparison?
WITH m AS (
  SELECT date_trunc('day', ts) AS day, count(*) AS views
  FROM usage_events
  WHERE op = 'match-view' AND ts >= now() - INTERVAL '14 days'
  GROUP BY day
), c AS (
  SELECT date_trunc('day', ts) AS day, count(*) AS comparisons
  FROM usage_events
  WHERE op = 'comparison' AND ts >= now() - INTERVAL '14 days'
  GROUP BY day
)
SELECT m.day, m.views, c.comparisons,
       round(100.0 * c.comparisons / m.views, 1) AS pct
FROM m LEFT JOIN c USING (day)
ORDER BY m.day DESC;

-- Upstream p95 latency per day per operation
SELECT date_trunc('day', ts) AS day,
       operation,
       round(quantile_cont(ms, 0.5), 0) AS p50,
       round(quantile_cont(ms, 0.95), 0) AS p95,
       count(*) AS calls
FROM upstream_events
WHERE ts >= now() - INTERVAL '14 days'
GROUP BY day, operation
ORDER BY day DESC, operation;

-- Cache pinning rate over time (how often does TTL=null get set?)
SELECT date_trunc('day', ts) AS day,
       sum(CASE WHEN trulyDone THEN 1 ELSE 0 END) AS pinned,
       count(*) AS total,
       round(100.0 * sum(CASE WHEN trulyDone THEN 1 ELSE 0 END) / count(*), 1) AS pct
FROM cache_events
WHERE op = 'match-ttl-decision' AND ts >= now() - INTERVAL '14 days'
GROUP BY day ORDER BY day DESC;

-- Searches that returned zero results (worth investigating)
SELECT kind, count(*) AS zero_result_searches, avg(queryLength) AS avg_len
FROM usage_events
WHERE op = 'search' AND resultBucket = '0' AND ts >= now() - INTERVAL '7 days'
GROUP BY kind;
""".strip()


# ── Main ────────────────────────────────────────────────────────────


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--env", choices=("prod", "staging"), default="prod")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("sync", help="incremental R2 → local NDJSON cache")
    sp.add_argument("--since", default="7d", help="duration (2h/7d) or YYYY-MM-DD; default 7d")
    sp.set_defaults(func=cmd_sync)

    sp = sub.add_parser("report", help="canned analytics digest")
    sp.add_argument("--days", type=int, default=7, help="window in days; default 7")
    sp.set_defaults(func=cmd_report)

    sp = sub.add_parser("sql", help="run an ad-hoc SQL statement")
    sp.add_argument("statement", help="SQL statement (use single quotes)")
    sp.add_argument("--format", choices=("box", "markdown", "csv", "json"), default="markdown")
    sp.set_defaults(func=cmd_sql)

    sp = sub.add_parser("open", help="print path to the DuckDB file")
    sp.set_defaults(func=cmd_open)

    sp = sub.add_parser("queries", help="print useful query recipes")
    sp.set_defaults(func=cmd_queries)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
