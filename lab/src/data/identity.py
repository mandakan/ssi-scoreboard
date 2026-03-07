"""Cross-source shooter identity resolution.

The lab ingests data from multiple sources (SSI, ipscresults.org) that each identify
competitors differently:
  - SSI: stable integer shooter_id (globally unique within SSI)
  - ipscresults: no global ID — name + region only

This module resolves identities into a single canonical_id per real-world person.

Usage::

    from src.data.identity import IdentityResolver
    from src.data.store import Store

    store = Store()
    resolver = IdentityResolver()
    report = resolver.resolve_all(store)
    print(report)

Name variants that slip through automatic resolution (low confidence, name changes,
nicknames) should be corrected via the `rating link-shooter` CLI command, which creates
a manual override that is never overwritten by subsequent auto-resolution runs.
"""

from __future__ import annotations

import difflib
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from typing import TYPE_CHECKING

from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    SpinnerColumn,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
    track,
)

if TYPE_CHECKING:
    from src.data.store import Store

# ---------------------------------------------------------------------------
# Pure name-normalization helpers (importable by other modules without side effects)
# ---------------------------------------------------------------------------

_PLACEHOLDER_TOKENS = frozenset({"notknown", "unknown", "noname"})


def strip_diacritics(s: str) -> str:
    """Remove combining diacritical marks, e.g. 'Sjöberg' → 'Sjoberg'."""
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def normalize_name(raw: str, source: str) -> str:
    """Return a display-ready normalized name.

    ipscresults format: "Last, First Middle" → "First Middle Last"
    SSI format: already "First Last" — returned stripped.
    """
    raw = raw.strip()
    if source == "ipscresults" and "," in raw:
        last, _, first = raw.partition(",")
        first = first.strip()
        last = last.strip()
        return f"{first} {last}".strip() if first else last
    return raw


def name_fingerprint(display_name: str, region: str) -> str:
    """Return a stable cross-source identity key.

    Format: ``"normalized_name|REGION"``

    Normalization: lowercase, strip diacritics, remove placeholder tokens.
    The display_name should already be in "First Last" format (via normalize_name).

    Examples::

        name_fingerprint("Martin Hollertz", "SWE") → "martin hollertz|SWE"
        name_fingerprint("Saša Petrović",   "SRB") → "sasa petrovic|SRB"
        name_fingerprint("Adrian H",        "NOR") → "adrian h|NOR"
    """
    normalized = strip_diacritics(display_name).lower().strip()
    tokens = [t for t in normalized.split() if t not in _PLACEHOLDER_TOKENS]
    return f"{' '.join(tokens)}|{region.upper()}"


# ---------------------------------------------------------------------------
# Resolver
# ---------------------------------------------------------------------------

# Minimum similarity ratio (difflib) to auto-link as fuzzy.
# 0.85 ≈ Levenshtein distance ≤ 2 on typical 8–15 char names.
_FUZZY_THRESHOLD = 0.85


@dataclass
class ResolveReport:
    """Summary of one resolve_all() run."""

    ssi_bootstrapped: int   # SSI shooter_id entries created / refreshed
    exact_matched: int      # ipscresults competitors linked via exact fingerprint
    fuzzy_matched: int      # ipscresults competitors linked via fuzzy name match
    new_identities: int     # ipscresults competitors with no SSI match → new canonical_id

    def __str__(self) -> str:
        return (
            f"SSI bootstrap: {self.ssi_bootstrapped} | "
            f"Exact: {self.exact_matched} | "
            f"Fuzzy: {self.fuzzy_matched} | "
            f"New: {self.new_identities}"
        )


class IdentityResolver:
    """Links source-specific identities to canonical shooter IDs.

    Steps:
    1. Bootstrap SSI — each SSI shooter_id becomes a canonical_id. All name
       variants for that shooter_id are registered as fingerprints.
    2. Link ipscresults — for each unique (name, region) in ipscresults
       competitors, try exact fingerprint match, then fuzzy match within the
       same region, then create a new canonical identity.

    Manual links (created via 'rating link-shooter') are stored with
    method='manual' and are never overwritten by automatic resolution.
    """

    def resolve_all(self, store: Store) -> ResolveReport:
        """Run full identity resolution. Safe to call multiple times (idempotent)."""
        ssi_count = self._bootstrap_ssi(store)
        exact, fuzzy, new = self._link_ipscresults(store)
        return ResolveReport(
            ssi_bootstrapped=ssi_count,
            exact_matched=exact,
            fuzzy_matched=fuzzy,
            new_identities=new,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _bootstrap_ssi(self, store: Store) -> int:
        """Create canonical identities and links for all SSI shooter_ids.

        Groups all name variants per shooter_id, picks the best display name
        (longest non-placeholder name), and registers all variants as fingerprints.
        Returns the number of distinct shooter_ids processed.
        """
        rows = store.get_all_ssi_competitors()  # [(shooter_id, name, region)]

        # Group name variants by (shooter_id, region)
        by_shooter: dict[tuple[int, str], list[str]] = defaultdict(list)
        for sid, name, region in rows:
            key = (sid, region or "")
            by_shooter[key].append(name)

        items = list(by_shooter.items())
        for (sid, region), names in track(
            items,
            description="Bootstrapping SSI identities…",
        ):
            primary = _pick_primary_name(names)
            store.ensure_canonical_identity(sid, primary, region or None)

            for name in names:
                fp = name_fingerprint(name, region)
                store.save_identity_link(
                    source="ssi",
                    source_key=str(sid),
                    canonical_id=sid,
                    name_variant=primary,
                    confidence=1.0,
                    method="auto_exact",
                )
                # Also register the fingerprint so ipscresults can find it by name
                # We re-use the identity link table with a special source key.
                # Only do this if not already manually set.
                existing = store.get_identity_link("ssi_fp", fp)
                if existing is None:
                    store.save_identity_link(
                        source="ssi_fp",
                        source_key=fp,
                        canonical_id=sid,
                        name_variant=name,
                        confidence=1.0,
                        method="auto_exact",
                    )

        return len(by_shooter)

    def _link_ipscresults(
        self, store: Store
    ) -> tuple[int, int, int]:
        """Link unlinked ipscresults competitors to canonical identities.

        Returns (exact_count, fuzzy_count, new_count).
        """
        unlinked = store.get_unlinked_ipscresults_competitors()
        if not unlinked:
            return 0, 0, 0

        # Build region-indexed lookup of SSI fingerprints for fuzzy matching.
        # ssi_fp_by_region: region → list of (normalized_name_part, fingerprint, canonical_id)
        ssi_fp_rows = store.db.execute(
            "SELECT source_key, canonical_id FROM shooter_identity_links WHERE source = 'ssi_fp'"
        ).fetchall()
        ssi_fp_by_region: dict[str, list[tuple[str, str, int]]] = defaultdict(list)
        for fp, canonical_id in ssi_fp_rows:
            fp_str = str(fp)
            if "|" in fp_str:
                name_part, _, region = fp_str.partition("|")
                ssi_fp_by_region[region].append((name_part, fp_str, int(canonical_id)))

        exact_count = fuzzy_count = new_count = 0

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            MofNCompleteColumn(),
            TextColumn("[cyan]{task.fields[stats]}[/cyan]"),
            TimeElapsedColumn(),
            TextColumn("ETA"),
            TimeRemainingColumn(),
        ) as progress:
            task = progress.add_task(
                "Linking ipscresults…",
                total=len(unlinked),
                stats="",
            )

            for name, raw_region in unlinked:
                region = raw_region or ""
                display = normalize_name(name, "ipscresults")
                fp = name_fingerprint(display, region)

                # 1. Exact fingerprint match against SSI fingerprints
                canonical_id = store.get_identity_link("ssi_fp", fp)
                if canonical_id is not None:
                    store.save_identity_link(
                        source="ipscresults",
                        source_key=fp,
                        canonical_id=canonical_id,
                        name_variant=display,
                        confidence=1.0,
                        method="auto_exact",
                    )
                    exact_count += 1
                    progress.advance(task)
                    progress.update(
                        task,
                        stats=f"exact={exact_count} fuzzy={fuzzy_count} new={new_count}",
                    )
                    continue

                # 2. Fuzzy match within same region
                candidates = ssi_fp_by_region.get(region.upper(), [])
                best_ratio = 0.0
                best_canonical: int | None = None
                normalized_name_part = fp.partition("|")[0]

                for ssi_name_part, _ssi_fp, ssi_canonical in candidates:
                    ratio = difflib.SequenceMatcher(
                        None, normalized_name_part, ssi_name_part
                    ).ratio()
                    if ratio > best_ratio:
                        best_ratio = ratio
                        best_canonical = ssi_canonical

                if best_ratio >= _FUZZY_THRESHOLD and best_canonical is not None:
                    store.save_identity_link(
                        source="ipscresults",
                        source_key=fp,
                        canonical_id=best_canonical,
                        name_variant=display,
                        confidence=round(best_ratio, 3),
                        method="auto_fuzzy",
                    )
                    fuzzy_count += 1
                    progress.advance(task)
                    progress.update(
                        task,
                        stats=f"exact={exact_count} fuzzy={fuzzy_count} new={new_count}",
                    )
                    continue

                # 3. No match — create a new canonical identity
                new_canonical = store._next_canonical_id()
                store.ensure_canonical_identity(new_canonical, display, region or None)
                store.save_identity_link(
                    source="ipscresults",
                    source_key=fp,
                    canonical_id=new_canonical,
                    name_variant=display,
                    confidence=1.0,
                    method="auto_exact",
                )
                new_count += 1
                progress.advance(task)
                progress.update(
                    task,
                    stats=f"exact={exact_count} fuzzy={fuzzy_count} new={new_count}",
                )

        return exact_count, fuzzy_count, new_count


# ---------------------------------------------------------------------------
# Name-picking helpers
# ---------------------------------------------------------------------------

def _pick_primary_name(names: list[str]) -> str:
    """Select the best display name from a list of variants for the same shooter.

    Preference order:
    1. Names with no placeholder tokens
    2. Longer names (more complete)
    3. First alphabetically as tiebreaker
    """
    def score(name: str) -> tuple[int, int, str]:
        tokens = name.lower().split()
        has_placeholder = any(t in _PLACEHOLDER_TOKENS for t in tokens)
        return (0 if has_placeholder else 1, len(name), name)

    return max(names, key=score)
