"""Export DuckDB ratings and match data to a serialisable dict for static site generation."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from src.data.store import Store

_CONS_Z = 0.5244005122401781


def export_data(store: Store, *, ssi_only: bool = True) -> dict[str, Any]:
    """Return all data needed for the static explorer as a JSON-serialisable dict.

    Args:
        ssi_only: When True (default), exclude shooters whose canonical_id >= 2_000_000
            (ipscresults-only identities with no SSI registration). Their match results
            are still used for calibrating SSI shooters' ratings but their names and
            personal data are not published. Recommended for any public-facing deployment.
            Set to False only for internal/research use.
    """
    return {
        "generated_at": date.today().isoformat(),
        "ssi_only": ssi_only,
        "algorithms": _export_algorithms(store),
        "divisions": _export_divisions(store),
        "regions": _export_regions(store),
        "categories": _export_categories(store),
        "shooters": _export_shooters(store, ssi_only=ssi_only),
        "matches": _export_matches(store),
        "fuzzy_links": _export_fuzzy_links(store),
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


_IPR_ONLY_ID_THRESHOLD = 2_000_000  # canonical_ids >= this are ipscresults-only


def _export_shooters(store: Store, *, ssi_only: bool = True) -> list[dict[str, Any]]:
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
        SELECT COALESCE(CAST(sil.canonical_id AS INTEGER), c.shooter_id) AS cid,
               COUNT(DISTINCT CASE WHEN m.date >= ?
                    THEN c.source || '|' || c.match_id END)     AS m12,
               COUNT(DISTINCT CASE WHEN m.date BETWEEN ? AND ?
                    THEN c.source || '|' || c.match_id END)     AS mcurr,
               COUNT(DISTINCT CASE WHEN m.date BETWEEN ? AND ?
                    THEN c.source || '|' || c.match_id END)     AS mprev
        FROM competitors c
        LEFT JOIN shooter_identity_links sil
          ON sil.source = c.source AND sil.source_key = c.identity_key
        JOIN matches m
          ON m.source = c.source AND m.ct = c.ct AND m.match_id = c.match_id
        WHERE m.date >= ?
          AND COALESCE(CAST(sil.canonical_id AS INTEGER), c.shooter_id) IS NOT NULL
        GROUP BY cid
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
        if ssi_only and sid >= _IPR_ONLY_ID_THRESHOLD:
            continue
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

    _add_percentiles(shooters)
    return list(shooters.values())


def _add_percentiles(shooters: dict[tuple[int, str], dict[str, Any]]) -> None:
    """Add percentile scores (0–100) to each shooter's rating entries.

    Percentile is computed within each (algorithm, division) reference group:
    the best conservative rating (CR = μ − z·σ) in the group gets 100, the
    worst gets 0, and the rest are linearly interpolated between them.

    The score is purely a **presentation layer** — the underlying μ/σ/CR values
    are unchanged. It answers: "what fraction of rated shooters in this division
    are below this shooter?" in plain-language terms.

    Edge cases:
    - Single shooter in a group → pct = 100.0
    - Missing rating for a group → no pct field added
    """
    # Collect CR values per (algo, division) group.
    # group_crs: (algo, div_db) → sorted list of CR values (ascending)
    from collections import defaultdict

    group_crs: dict[tuple[str, str], list[float]] = defaultdict(list)
    for (_sid, div_db), shooter in shooters.items():
        for algo, rating in shooter["ratings"].items():
            group_crs[(algo, div_db)].append(rating["cr"])

    # Sort each group ascending (index 0 = worst, index -1 = best).
    sorted_crs: dict[tuple[str, str], list[float]] = {
        k: sorted(v) for k, v in group_crs.items()
    }

    # Assign percentile to each shooter's rating using linear interpolation.
    for (_sid, div_db), shooter in shooters.items():
        for algo, rating in shooter["ratings"].items():
            crs = sorted_crs.get((algo, div_db))
            if not crs:
                continue
            n = len(crs)
            if n == 1:
                rating["pct"] = 100.0
                continue
            cr = rating["cr"]
            # Binary-search position in sorted list; interpolate for ties.
            lo, hi = 0, n - 1
            while lo < hi:
                mid = (lo + hi) // 2
                if crs[mid] < cr:
                    lo = mid + 1
                else:
                    hi = mid
            # lo is the index of the first element >= cr.
            # Count how many are strictly below cr for a cleaner metric.
            below = lo  # number of shooters with CR < cr
            # Handle ties: count equal entries and distribute evenly.
            eq = sum(1 for v in crs if v == cr)
            # Percentile = fraction of population below this shooter (0–100).
            pct = (below + (eq - 1) / 2) / (n - 1) * 100
            rating["pct"] = round(min(100.0, max(0.0, pct)), 1)


def _export_fuzzy_links(store: Store) -> list[dict[str, Any]]:
    """Return all auto-fuzzy identity links for human review.

    Each entry shows the ipscresults name that was matched to an SSI shooter
    along with the confidence score and the person's best division rank in the
    ratings (so high-ranking competitors with shaky identity links can be
    prioritised for manual review). Sorted by confidence ascending so the most
    dubious matches appear first.
    """
    rows = store.db.execute(
        """
        SELECT
            sil.name_variant   AS ipr_name,
            sil.confidence,
            sil.source_key,
            si.primary_name    AS ssi_name,
            si.canonical_id,
            si.region
        FROM shooter_identity_links sil
        JOIN shooter_identities si ON si.canonical_id = sil.canonical_id
        WHERE sil.source = 'ipscresults' AND sil.method = 'auto_fuzzy'
        ORDER BY sil.confidence ASC, si.region, sil.name_variant
        """
    ).fetchall()

    # Build a rank map: canonical_id → (best_div_rank, division, div_size).
    # Uses whichever algorithm has the most rating rows as a stable reference.
    rank_map: dict[int, tuple[int, str, int]] = {}
    ref_row = store.db.execute(
        "SELECT algorithm FROM shooter_ratings"
        " GROUP BY algorithm ORDER BY COUNT(*) DESC LIMIT 1"
    ).fetchone()
    if ref_row:
        rank_rows = store.db.execute(
            f"""
            WITH ranked AS (
                SELECT shooter_id, division,
                       RANK() OVER (
                           PARTITION BY division
                           ORDER BY (mu - {_CONS_Z} * sigma) DESC
                       ) AS rk,
                       COUNT(*) OVER (PARTITION BY division) AS sz
                FROM shooter_ratings
                WHERE algorithm = ? AND division != ''
            ),
            best AS (
                SELECT shooter_id, division, rk, sz,
                       ROW_NUMBER() OVER (
                           PARTITION BY shooter_id ORDER BY rk ASC, sz DESC
                       ) AS n
                FROM ranked
            )
            SELECT shooter_id, division, rk, sz FROM best WHERE n = 1
            """,
            [str(ref_row[0])],
        ).fetchall()
        for r in rank_rows:
            rank_map[int(r[0])] = (int(r[2]), str(r[1]), int(r[3]))

    # For each fuzzy-matched person: how many ipscresults matches contributed
    # to their rating, and when was the most recent one?
    # ipr_m  — match count from ipscresults (potentially wrong source)
    # ipr_last — ISO date of most recent ipscresults match
    # total_m — total matches across all sources (from shooter_ratings.matches_played)
    # Together these show whether a shaky link has real influence: a person with
    # 1 ipscresults match from 2018 and 40 SSI matches is low risk even if ranked #2.
    ipr_stats: dict[int, tuple[int, str | None]] = {}
    ipr_rows = store.db.execute(
        """
        SELECT sil.canonical_id,
               COUNT(DISTINCT c.source || '|' || c.ct || '|' || c.match_id) AS ipr_m,
               MAX(m.date)                                                    AS ipr_last
        FROM shooter_identity_links sil
        JOIN competitors c
          ON c.source = 'ipscresults' AND c.identity_key = sil.source_key
        JOIN matches m
          ON m.source = 'ipscresults' AND m.ct = c.ct AND m.match_id = c.match_id
        WHERE sil.source = 'ipscresults' AND sil.method = 'auto_fuzzy'
        GROUP BY sil.canonical_id
        """
    ).fetchall()
    for r in ipr_rows:
        ipr_stats[int(r[0])] = (
            int(r[1]),
            str(r[2])[:10] if r[2] else None,
        )

    # Total matches per canonical_id (across all sources, any algorithm).
    total_m_rows = store.db.execute(
        "SELECT shooter_id, MAX(matches_played) FROM shooter_ratings GROUP BY shooter_id"
    ).fetchall()
    total_m_map: dict[int, int] = {int(r[0]): int(r[1]) for r in total_m_rows}

    result = []
    for row in rows:
        cid = int(row[4])
        rank_info = rank_map.get(cid)
        ipr_m, ipr_last = ipr_stats.get(cid, (0, None))
        total_m = total_m_map.get(cid)
        result.append({
            "ipr": str(row[0]),
            "conf": round(float(row[1]), 3),
            "ssi": str(row[3]),
            "id": cid,
            "region": str(row[5]) if row[5] else None,
            # Rating impact — None if this person has no ratings yet
            "rank": rank_info[0] if rank_info else None,
            "div": rank_info[1] if rank_info else None,
            "div_n": rank_info[2] if rank_info else None,
            # ipscresults match exposure
            "ipr_m": ipr_m,          # matches from the fuzzy-linked source
            "ipr_last": ipr_last,    # most recent ipscresults match date
            "total_m": total_m,      # total matches across all sources
        })
    return result


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
