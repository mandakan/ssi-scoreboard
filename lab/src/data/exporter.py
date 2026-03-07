"""Export DuckDB ratings and match data to a serialisable dict for static site generation."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from src.data.store import Store

_CONS_Z = 0.5244005122401781


def export_data(store: Store) -> dict[str, Any]:
    """Return all data needed for the static explorer as a JSON-serialisable dict."""
    return {
        "generated_at": date.today().isoformat(),
        "algorithms": _export_algorithms(store),
        "divisions": _export_divisions(store),
        "regions": _export_regions(store),
        "categories": _export_categories(store),
        "shooters": _export_shooters(store),
        "matches": _export_matches(store),
    }


def _export_algorithms(store: Store) -> list[str]:
    rows = store.db.execute(
        "SELECT DISTINCT algorithm FROM shooter_ratings ORDER BY algorithm"
    ).fetchall()
    return [str(r[0]) for r in rows]


def _export_divisions(store: Store) -> list[str]:
    # Exclude '' sentinel (cross-division / global ratings)
    rows = store.db.execute(
        "SELECT DISTINCT division FROM shooter_ratings"
        " WHERE division != '' ORDER BY division"
    ).fetchall()
    return [str(r[0]) for r in rows]


def _export_regions(store: Store) -> list[str]:
    rows = store.db.execute(
        "SELECT DISTINCT region FROM shooter_ratings"
        " WHERE region IS NOT NULL ORDER BY region"
    ).fetchall()
    return [str(r[0]) for r in rows]


def _export_categories(store: Store) -> list[str]:
    rows = store.db.execute(
        "SELECT DISTINCT category FROM shooter_ratings"
        " WHERE category IS NOT NULL ORDER BY category"
    ).fetchall()
    return [str(r[0]) for r in rows]


def _export_shooters(store: Store) -> list[dict[str, Any]]:
    # Precompute recent match participation counts per canonical shooter.
    # Source: competitors + shooter_identity_links + matches — always available after sync.
    # rating_history is not used here: it is only populated by the serve scheduler,
    # not by `rating train`.
    # Three windows computed in one pass using conditional aggregation:
    #   m12:   rolling last 12 months from today
    #   mcurr: current calendar year (Jan 1 – Dec 31)
    #   mprev: previous calendar year
    # Keyed by canonical_id only (division-agnostic): "has this shooter been active
    # recently?" is independent of which division they entered in each match.
    today = date.today()
    since_12m = (today - timedelta(days=365)).isoformat()
    curr_year_start = date(today.year, 1, 1).isoformat()
    curr_year_end = date(today.year, 12, 31).isoformat()
    prev_year_start = date(today.year - 1, 1, 1).isoformat()
    prev_year_end = date(today.year - 1, 12, 31).isoformat()

    recent_rows = store.db.execute(
        """
        SELECT sil.canonical_id,
               COUNT(DISTINCT CASE WHEN m.date >= ?
                    THEN c.source || '|' || c.match_id END)     AS m12,
               COUNT(DISTINCT CASE WHEN m.date BETWEEN ? AND ?
                    THEN c.source || '|' || c.match_id END)     AS mcurr,
               COUNT(DISTINCT CASE WHEN m.date BETWEEN ? AND ?
                    THEN c.source || '|' || c.match_id END)     AS mprev
        FROM competitors c
        JOIN shooter_identity_links sil
          ON sil.source = c.source AND sil.source_key = c.identity_key
        JOIN matches m
          ON m.source = c.source AND m.ct = c.ct AND m.match_id = c.match_id
        WHERE m.date >= ?
        GROUP BY sil.canonical_id
        """,
        [since_12m, curr_year_start, curr_year_end,
         prev_year_start, prev_year_end, prev_year_start],
    ).fetchall()
    # Maps canonical_id → (m12, mcurr, mprev)
    recent_counts: dict[int, tuple[int, int, int]] = {
        int(r[0]): (int(r[1]), int(r[2]), int(r[3]))
        for r in recent_rows
    }

    rows = store.db.execute(
        f"""
        SELECT shooter_id, name, division, region, category,
               algorithm, mu, sigma,
               (mu - {_CONS_Z} * sigma) AS cr,
               matches_played, last_match_date
        FROM shooter_ratings
        ORDER BY shooter_id, division, algorithm
        """
    ).fetchall()

    # Key: (shooter_id, division_db) — one entry per (shooter, division) combination.
    # division_db is '' for cross-division/global ratings.
    shooters: dict[tuple[int, str], dict[str, Any]] = {}
    for row in rows:
        sid = int(row[0])
        div_db = str(row[2]) if row[2] else ""
        algo = str(row[5])
        mu = float(row[6])
        sigma = float(row[7])
        cr = float(row[8])
        matches = int(row[9])
        last_date = str(row[10])[:10] if row[10] else None
        m12, mcurr, mprev = recent_counts.get(sid, (0, 0, 0))

        key = (sid, div_db)
        if key not in shooters:
            shooters[key] = {
                "id": sid,
                # Unique key for use as x-for :key in the static explorer
                "key": f"{sid}|{div_db}",
                "name": str(row[1]) if row[1] else f"Shooter {sid}",
                # '' sentinel → None for display; real division string otherwise
                "division": div_db if div_db else None,
                "region": str(row[3]) if row[3] else None,
                "category": str(row[4]) if row[4] else None,
                "ratings": {},
            }

        shooters[key]["ratings"][algo] = {
            "mu": round(mu, 3),
            "sigma": round(sigma, 3),
            "cr": round(cr, 3),
            "m": matches,
            "m12": m12,      # rolling last 12 months from export date
            "mcurr": mcurr,  # current calendar year
            "mprev": mprev,  # previous calendar year
            "d": last_date,
        }

    return list(shooters.values())


def _export_matches(store: Store) -> list[dict[str, Any]]:
    rows = store.db.execute(
        """
        SELECT source, ct, match_id, name, date, level, competitor_count
        FROM matches
        WHERE date IS NOT NULL
        ORDER BY date DESC
        """
    ).fetchall()
    return [
        {
            "source": str(row[0]),
            "ct": int(row[1]),
            "id": str(row[2]),
            "name": str(row[3]) if row[3] else None,
            "date": str(row[4])[:10] if row[4] else None,
            "level": str(row[5]) if row[5] else None,
            "competitors": int(row[6]) if row[6] else None,
        }
        for row in rows
    ]
