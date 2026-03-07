"""Match deduplication — find the same real-world match stored under multiple sources.

The same L3+ match can exist in both SSI and ipscresults.org. During rating training
we want to count each match only once. This module:

  1. Finds candidate duplicate pairs across sources.
  2. Stores confirmed links in the match_links table.
  3. Provides the skip set used by the training loop.

Heuristics (applied in order):

  auto_name_date — Same (fuzzy) match name AND date within ±3 days.
                   Confidence ≥ 0.90 (exact name+date) or 0.75 (fuzzy name).

  auto_roster    — >60% of competitor fingerprints overlap between two matches
                   on the same date. Most reliable but expensive to compute.
                   Not run by default; use find_duplicate_matches(roster=True).

Only cross-source pairs are considered — we never deduplicate within the same source.

Preferred source: the one with more stages wins, falling back to more competitors,
then SSI over ipscresults (SSI has richer per-field data).
"""

from __future__ import annotations

import difflib
import re
import unicodedata
from dataclasses import dataclass
from datetime import date

from rich.console import Console

from src.data.store import Store

console = Console()

_NAME_SIMILARITY_THRESHOLD = 0.80


@dataclass
class MatchDuplicate:
    """A candidate duplicate pair from two different sources."""

    source_a: str
    ct_a: int
    match_id_a: str
    name_a: str
    date_a: str | None

    source_b: str
    ct_b: int
    match_id_b: str
    name_b: str
    date_b: str | None

    confidence: float
    method: str
    preferred: str   # 'a' or 'b'


def _normalize_match_name(name: str) -> str:
    """Lowercase, strip punctuation and common filler words for name comparison."""
    name = unicodedata.normalize("NFD", name)
    name = name.encode("ascii", "ignore").decode()  # drop non-ASCII after NFD decomposition
    name = re.sub(r"[^\w\s]", " ", name)           # punctuation → space
    name = name.lower()
    # Remove common location/qualifier words that differ between sources
    stop_words = {"open", "cup", "championship", "match", "handgun", "hg", "the"}
    tokens = [t for t in name.split() if t not in stop_words]
    return " ".join(tokens)


def _date_proximity(d1: str | None, d2: str | None, max_days: int = 3) -> bool:
    """Return True if two ISO date strings are within max_days of each other."""
    if d1 is None or d2 is None:
        return False
    try:
        dt1 = date.fromisoformat(d1[:10])
        dt2 = date.fromisoformat(d2[:10])
        return abs((dt1 - dt2).days) <= max_days
    except ValueError:
        return False


def _name_similarity(a: str, b: str) -> float:
    """Return SequenceMatcher ratio on normalized match names."""
    return difflib.SequenceMatcher(None, _normalize_match_name(a), _normalize_match_name(b)).ratio()


def _preferred_source(
    store: Store,
    source_a: str, ct_a: int, match_id_a: str,
    source_b: str, ct_b: int, match_id_b: str,
) -> str:
    """Choose which match copy to keep during training.

    Prefer the match with more stages. On tie, prefer more competitors.
    On tie, prefer 'ssi' over other sources (richer cross-field data).
    """
    stages_a = len(store.get_stage_results_for_match(source_a, ct_a, match_id_a))
    stages_b = len(store.get_stage_results_for_match(source_b, ct_b, match_id_b))
    if stages_a != stages_b:
        return "a" if stages_a > stages_b else "b"

    comps_a = len(store.get_competitor_shooter_map(source_a, ct_a, match_id_a))
    comps_b = len(store.get_competitor_shooter_map(source_b, ct_b, match_id_b))
    if comps_a != comps_b:
        return "a" if comps_a > comps_b else "b"

    return "a" if source_a == "ssi" else "b"


def find_duplicate_matches(
    store: Store,
    *,
    roster: bool = False,
    date_window: int = 3,
) -> list[MatchDuplicate]:
    """Find candidate cross-source duplicate matches not yet in match_links.

    Args:
        store:       The DuckDB store.
        roster:      Also run the roster-overlap heuristic (slower).
        date_window: Maximum days apart to consider two matches as the same event.

    Returns a list of MatchDuplicate candidates. Call apply_dedup() to persist them.
    """
    # Load all matches from all sources (excluding already-linked ones)
    existing_links: set[tuple[str, str]] = set()
    rows = store.db.execute(
        "SELECT match_id_a, match_id_b FROM match_links"
    ).fetchall()
    for r in rows:
        existing_links.add((str(r[0]), str(r[1])))
        existing_links.add((str(r[1]), str(r[0])))

    all_matches = store.db.execute(
        "SELECT source, ct, match_id, name, CAST(date AS VARCHAR) FROM matches"
        " WHERE date IS NOT NULL"
    ).fetchall()

    # Group by source
    by_source: dict[str, list[tuple[str, int, str, str, str | None]]] = {}
    for r in all_matches:
        src = str(r[0])
        if src not in by_source:
            by_source[src] = []
        by_source[src].append((src, int(r[1]), str(r[2]), str(r[3]), r[4]))

    sources = list(by_source.keys())
    duplicates: list[MatchDuplicate] = []

    # Compare each pair of sources (never within the same source)
    for i in range(len(sources)):
        for j in range(i + 1, len(sources)):
            src_a, src_b = sources[i], sources[j]
            for match_a in by_source[src_a]:
                src_a_, ct_a, mid_a, name_a, date_a = match_a
                for match_b in by_source[src_b]:
                    src_b_, ct_b, mid_b, name_b, date_b = match_b

                    # Skip already-linked pairs
                    if (mid_a, mid_b) in existing_links:
                        continue

                    if not _date_proximity(date_a, date_b, date_window):
                        continue

                    sim = _name_similarity(name_a, name_b)
                    if sim < _NAME_SIMILARITY_THRESHOLD:
                        continue

                    confidence = round(0.90 if sim >= 0.95 else 0.75 + sim * 0.15, 3)
                    preferred = _preferred_source(
                        store, src_a_, ct_a, mid_a, src_b_, ct_b, mid_b
                    )
                    duplicates.append(
                        MatchDuplicate(
                            source_a=src_a_, ct_a=ct_a, match_id_a=mid_a,
                            name_a=name_a, date_a=date_a[:10] if date_a else None,
                            source_b=src_b_, ct_b=ct_b, match_id_b=mid_b,
                            name_b=name_b, date_b=date_b[:10] if date_b else None,
                            confidence=confidence,
                            method="auto_name_date",
                            preferred=preferred,
                        )
                    )

    if roster:
        roster_dupes = _find_by_roster_overlap(store, by_source, existing_links)
        # Merge: if a pair is already found, upgrade confidence if roster is higher
        found_pairs = {(d.match_id_a, d.match_id_b) for d in duplicates}
        for rd in roster_dupes:
            if (rd.match_id_a, rd.match_id_b) not in found_pairs:
                duplicates.append(rd)

    return duplicates


def _find_by_roster_overlap(
    store: Store,
    by_source: dict[str, list[tuple[str, int, str, str, str | None]]],
    existing_links: set[tuple[str, str]],
) -> list[MatchDuplicate]:
    """Roster-overlap heuristic: >60% shared competitor fingerprints on same date."""
    from src.data.identity import name_fingerprint, normalize_name

    duplicates: list[MatchDuplicate] = []
    sources = list(by_source.keys())

    for i in range(len(sources)):
        for j in range(i + 1, len(sources)):
            src_a, src_b = sources[i], sources[j]
            for match_a in by_source[src_a]:
                src_a_, ct_a, mid_a, name_a, date_a = match_a
                for match_b in by_source[src_b]:
                    src_b_, ct_b, mid_b, name_b, date_b = match_b

                    if (mid_a, mid_b) in existing_links:
                        continue
                    if not _date_proximity(date_a, date_b, 3):
                        continue

                    # Build fingerprint sets for each match
                    def fingerprints(source: str, ct: int, match_id: str) -> set[str]:
                        rows = store.db.execute(
                            "SELECT name, region FROM competitors"
                            " WHERE source = ? AND ct = ? AND match_id = ?",
                            [source, ct, match_id],
                        ).fetchall()
                        fps: set[str] = set()
                        for r in rows:
                            display = normalize_name(str(r[0]), source)
                            fp = name_fingerprint(display, r[1] or "")
                            fps.add(fp)
                        return fps

                    fps_a = fingerprints(src_a_, ct_a, mid_a)
                    fps_b = fingerprints(src_b_, ct_b, mid_b)
                    if not fps_a or not fps_b:
                        continue

                    overlap = len(fps_a & fps_b) / min(len(fps_a), len(fps_b))
                    if overlap < 0.60:
                        continue

                    confidence = round(min(0.60 + overlap * 0.40, 0.99), 3)
                    preferred = _preferred_source(
                        store, src_a_, ct_a, mid_a, src_b_, ct_b, mid_b
                    )
                    duplicates.append(
                        MatchDuplicate(
                            source_a=src_a_, ct_a=ct_a, match_id_a=mid_a,
                            name_a=name_a, date_a=date_a[:10] if date_a else None,
                            source_b=src_b_, ct_b=ct_b, match_id_b=mid_b,
                            name_b=name_b, date_b=date_b[:10] if date_b else None,
                            confidence=confidence,
                            method="auto_roster",
                            preferred=preferred,
                        )
                    )
    return duplicates


def apply_dedup(store: Store, duplicates: list[MatchDuplicate]) -> int:
    """Persist a list of MatchDuplicate candidates to match_links. Returns count saved."""
    for d in duplicates:
        store.save_match_link(
            source_a=d.source_a, ct_a=d.ct_a, match_id_a=d.match_id_a,
            source_b=d.source_b, ct_b=d.ct_b, match_id_b=d.match_id_b,
            confidence=d.confidence,
            method=d.method,
            preferred=d.preferred,
        )
    return len(duplicates)
