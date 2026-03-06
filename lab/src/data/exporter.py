"""Export DuckDB ratings and match data to a serialisable dict for static site generation."""

from __future__ import annotations

from datetime import date
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
    rows = store.db.execute(
        "SELECT DISTINCT division FROM shooter_ratings"
        " WHERE division IS NOT NULL ORDER BY division"
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
    rows = store.db.execute(
        f"""
        SELECT shooter_id, name, division, region, category,
               algorithm, mu, sigma,
               (mu - {_CONS_Z} * sigma) AS cr,
               matches_played, last_match_date
        FROM shooter_ratings
        ORDER BY shooter_id, algorithm
        """
    ).fetchall()

    shooters: dict[int, dict[str, Any]] = {}
    for row in rows:
        sid = int(row[0])
        algo = str(row[5])
        mu = float(row[6])
        sigma = float(row[7])
        cr = float(row[8])
        matches = int(row[9])
        last_date = str(row[10])[:10] if row[10] else None

        if sid not in shooters:
            shooters[sid] = {
                "id": sid,
                "name": str(row[1]) if row[1] else f"Shooter {sid}",
                "division": str(row[2]) if row[2] else None,
                "region": str(row[3]) if row[3] else None,
                "category": str(row[4]) if row[4] else None,
                "ratings": {},
            }

        shooters[sid]["ratings"][algo] = {
            "mu": round(mu, 3),
            "sigma": round(sigma, 3),
            "cr": round(cr, 3),
            "m": matches,
            "d": last_date,
        }

    return list(shooters.values())


def _export_matches(store: Store) -> list[dict[str, Any]]:
    rows = store.db.execute(
        """
        SELECT ct, match_id, name, date, level, competitor_count
        FROM matches
        WHERE date IS NOT NULL
        ORDER BY date DESC
        """
    ).fetchall()
    return [
        {
            "ct": int(row[0]),
            "id": str(row[1]),
            "name": str(row[2]) if row[2] else None,
            "date": str(row[3])[:10] if row[3] else None,
            "level": str(row[4]) if row[4] else None,
            "competitors": int(row[5]) if row[5] else None,
        }
        for row in rows
    ]
