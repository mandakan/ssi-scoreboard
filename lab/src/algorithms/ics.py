"""ICS 2.0 — Swedish federation team selection algorithm.

Reference: https://ics2.pages.dev/

Background
----------
ICS 2.0 is the method used by the Swedish IPSC federation for 2026 national
team selection. It is implemented here as a benchmark baseline so it can be
evaluated head-to-head against the Bayesian approaches using the same metrics
(Kendall tau, top-k accuracy, MRR).

Unlike every other algorithm in this lab, ICS 2.0 is NOT a skill model.
It does not maintain a running skill estimate that updates with every match.
Instead it is a batch peer-comparison system that asks, for each match:

    "How would this shooter have performed at the World Shoot, based on
     how they did here relative to World Shoot participants who competed
     in the same match?"

The final ranking score is the average of a shooter's best N such estimates.

How it works — plain language
------------------------------
1. ANCHOR EVENT
   The most recent L4 or L5 match (World/Continental Championship) is the
   "anchor". Every competitor at that event receives a reference score
   representing their normalised performance. This is the "gold standard"
   against which all future results are measured.

2. DIVISION WEIGHTING
   Different IPSC divisions produce different score levels by design.
   An Open shooter hitting 85% is not the same as a Production shooter
   hitting 85% because the divisions use different equipment.

   To compare them fairly, ICS normalises each competitor's score against
   their division's typical level at the anchor event. The "division weight"
   is the 67th percentile of all competitors' scores in that division:

       Example: if Production shooters typically score around 78% at the
       World Shoot, the Production weight = 78. A Production shooter who
       scores 78% at any match gets a normalised "comb" score of 100.
       A stronger shooter scoring 90% gets comb = 90/78 * 100 = 115.

3. PEER COMPARISON AT EACH MATCH
   At a regular ranking match, some competitors were also at the anchor
   event (they have a known reference score). For each such reference
   competitor B, one "contribution" estimate is computed:

       contrib(A, B) = (A's comb here / B's comb here) * B's comb at anchor

   Plain language: if A outperformed B by 10% at this match, and B scored
   the equivalent of 112 at the World Shoot, then A would have scored
   approximately 112 * 1.10 = 123 at the World Shoot. Each reference
   competitor B gives one such estimate; they are averaged to produce A's
   "match weighted score".

4. FINAL RANKING
   A shooter's ICS score is the average of their best top_n (default: 3)
   match weighted scores. One exceptional performance at a major event can
   carry a shooter — only your best results count.

Mathematical formulation
------------------------
Division weight:

    weight(D) = pth percentile of {avg_overall_percent of all competitors
                                   in division D at the anchor event}

Default p = 67 (the ICS 2.0 specification; tunable to 50, 60, 75, 80).

Normalised combined score ("comb"):

    comb(competitor, match) = avg_overall_percent / weight(division) * 100

Peer contribution:

    contrib(A, B) = comb(A, this_match) / comb(B, this_match) * comb(B, anchor)

Match weighted score:

    weighted(A, match) = mean of contrib(A, B) for all reference competitors
                         B present in this match who have an anchor score

Final ICS score (the number used for ranking):

    ICS(A) = mean of top top_n values of {weighted(A, match) for all matches}

Fallbacks
---------
- No anchor yet: the normalised comb score is used directly as the match score.
  This applies to all matches before the first L4/L5 event is processed.
- No reference competitors in a match: same fallback — comb is used directly.
  This happens when none of the anchor-event participants compete in a given match.

Special case — the anchor event itself:
At the anchor event, each competitor's current-match comb equals their anchor
comb, so the formula simplifies to contrib(A, B) = comb(A, anchor) for every B.
The match score equals the shooter's own normalised score. This is mathematically
consistent and exactly what ICS intends.

Operating modes
---------------
This class supports two distinct modes selected by the ``anchor_match_id``
constructor parameter:

**Benchmark mode** (``anchor_match_id=None``, the default)
    Used for head-to-head algorithm comparison across the full 2004–2026 history.
    Differs from the official ICS 2.0 in three ways:

    1. *Rolling anchor* — every L4/L5 match becomes the new anchor as it is
       processed chronologically, replacing the previous one. Required because
       the benchmark spans multiple World Shoots.
    2. *All L2+ matches* — every match in the dataset feeds the algorithm, not
       a curated list of 11 federation-approved events.
    3. *Online processing* — matches are processed one-by-one in time order
       rather than as a single batch calculation at the end of the season.

    These adaptations are necessary for a fair comparison but mean benchmark ICS
    results are an approximation of the official method, not an exact replica.

**Faithful mode** (``anchor_match_id="<ws2025_match_id>"``)
    Reproduces the official Swedish federation ICS 2.0 for 2026 team selection.
    Close all three gaps by combining this parameter with CLI flags:

    - Gap 1 (fixed anchor): pass ``anchor_match_id`` — the anchor is frozen
      after the designated match is processed; subsequent L4/L5 events use the
      fixed WS2025 reference pool instead of refreshing the anchor.
    - Gap 2 (date window): use ``--date-from`` / ``--date-to`` to restrict
      training to the selection period (e.g. 2024-10-01 → 2026-06-30).
    - Gap 3 (curated match list): use ``--match-ids-file`` with a text file
      listing the 11 approved match IDs; all others are silently skipped.

    Example CLI invocation::

        uv run rating train --algorithm ics --scoring match_pct \\
          --date-from 2024-10-01 --date-to 2026-06-30 \\
          --ics-anchor-match-id <ws2025_match_id> \\
          --match-ids-file data/ics2026_match_ids.txt \\
          --label ics2026
        # → stored as ics_mpct_ics2026

    The WS2025 match ID can be looked up with::

        SELECT match_id, name, date
        FROM matches
        WHERE level = 'l5' AND date >= '2025-01-01';

Full documentation: docs/algorithms.md — section "ICS 2.0"
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from src.algorithms.base import (
    DivKey,
    RatingAlgorithm,
    compute_division_weights,
    decode_div_key,
    encode_div_key,
)
from src.data.models import Rating

# ICS produces a percentage score, not a (mu, sigma) pair.
# Sigma is fixed so that the conservative ranking in the sweep framework
# treats ICS the same as the base score (no uncertainty penalty).
_FIXED_SIGMA: float = 1.0
_DEFAULT_SCORE: float = 0.0


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


class ICSAlgorithm(RatingAlgorithm):
    """ICS 2.0 — Swedish federation team selection benchmark.

    Parameters
    ----------
    anchor_percentile:
        Percentile used to derive division weight factors from the anchor
        event. The ICS 2.0 specification uses 67 (default). Higher values
        raise the bar, producing lower normalised scores overall. Tunable
        range in the sweep: {50, 60, 67, 75, 80}.
    top_n:
        Number of best match results to average for the final ranking score.
        ICS 2.0 specification uses 3 (default). More results dampens the
        impact of a single exceptional performance. Tunable range: {2, 3, 4, 5}.
    anchor_match_id:
        Pin the anchor to a single fixed match ID (e.g. the World Shoot 2025
        match ID from the database). When set, the anchor state is updated
        **only** when this exact match_id is processed; all subsequent L4/L5
        events are treated like regular matches (using the fixed reference pool
        rather than refreshing the anchor). This faithfully reproduces the
        official ICS 2.0 behaviour where WS2025 is the sole anchor event.

        When ``None`` (default), the rolling-anchor benchmark mode is used:
        every L4/L5 event replaces the previous anchor, which is appropriate
        for evaluating ICS across a multi-year history with many World Shoots.
    """

    def __init__(
        self,
        anchor_percentile: float = 67.0,
        top_n: int = 3,
        anchor_match_id: str | None = None,
    ) -> None:
        self.anchor_percentile = anchor_percentile
        self.top_n = top_n
        self.anchor_match_id = anchor_match_id

        # Shooter metadata (name, region, category) — updated as matches are processed.
        self._names: dict[int, str] = {}
        self._regions: dict[int, str | None] = {}
        self._categories: dict[int, str | None] = {}
        # Match count per (shooter_id, None) key — ICS is cross-division so division=None.
        self._matches: dict[DivKey, int] = defaultdict(int)
        # Idempotency guard: skip matches already processed.
        self._seen_matches: set[str] = set()

        # Fixed-anchor guard: True once the pinned anchor_match_id has been processed.
        # Subsequent L4/L5 events are skipped for anchor updates but still generate
        # match scores using the fixed reference pool from the pinned event.
        self._anchor_locked: bool = False

        # Division weight factors derived from the most recent anchor (L4/L5) event.
        # Keys are division strings (e.g. "Production") or None if no division was recorded.
        # A weight of 100.0 is the fallback before any anchor has been processed.
        self._div_weights: dict[str | None, float] = {}

        # Reference scores from the most recent anchor event.
        # shooter_id → their normalised comb score at that event.
        # Used as "b_vm" (B's World Shoot level) in the peer-comparison formula.
        self._anchor_perf: dict[int, float] = {}

        # All weighted match scores ever computed for each shooter (unsorted).
        # The final score is derived by taking the top top_n entries.
        self._match_scores: dict[int, list[float]] = defaultdict(list)

        # Final ranking scores: shooter_id → average of best top_n match scores.
        # This is the number displayed and used for predict_rank().
        self._scores: dict[int, float] = {}

    @property
    def name(self) -> str:
        return "ics"

    @property
    def per_division(self) -> bool:
        return False

    def _normalize(self, pct: float, division: str | None) -> float:
        """Scale a percentage by the division weight for the current anchor.

        Returns the "combined score" (comb) used throughout the ICS formula:

            comb = avg_overall_percent / division_weight * 100

        A value of 100 means the shooter performed at exactly the anchor
        percentile for their division. Values above 100 mean above that bar.

        Falls back to weight=100 (no normalisation) if the division was not
        observed at the anchor event or no anchor has been processed yet.
        """
        w = self._div_weights.get(division, 100.0)
        if w <= 0:
            return pct
        return pct / w * 100.0

    def process_match_data(
        self,
        ct: int,
        match_id: str,
        match_date: str | None,
        stage_results: list[tuple[int, int, float | None, bool, bool, bool]],
        competitor_shooter_map: dict[int, int | None],
        *,
        name_map: dict[int, str] | None = None,
        division_map: dict[int, str | None] | None = None,
        region_map: dict[int, str | None] | None = None,
        category_map: dict[int, str | None] | None = None,
        match_level: str | None = None,
    ) -> None:
        match_key = f"{ct}:{match_id}"
        if match_key in self._seen_matches:
            return  # Idempotency: never process the same match twice.
        self._seen_matches.add(match_key)

        # ── Step 1: collect each competitor's average score across all stages ──
        # In match_pct scoring mode (the recommended mode for ICS) the sweep
        # framework passes a single stage_id=0 entry per competitor whose
        # hit_factor field is already their avg_overall_percent for the whole
        # match. In stage_hf mode there are multiple stage entries; averaging
        # them produces a reasonable proxy for the overall match percentage.
        # DQ and zeroed competitors count as 0 (ranked last, not excluded).
        # DNF competitors are excluded entirely — they did not complete the match.
        comp_pcts: dict[int, list[float]] = defaultdict(list)
        dnf_set: set[int] = set()

        for comp_id, _stage_id, hf, dq, dnf, zeroed in stage_results:
            if dnf:
                dnf_set.add(comp_id)
                continue
            if dq or zeroed:
                comp_pcts[comp_id].append(0.0)
            elif hf is not None:
                comp_pcts[comp_id].append(hf)

        # Build the list of valid entries: (shooter_id, avg_pct, division).
        # Only competitors with a resolved shooter_id and at least one score
        # are included. DNF competitors are dropped.
        CompEntry = tuple[int, float, str | None]  # type alias for readability
        entries: list[CompEntry] = []
        for comp_id, pcts in comp_pcts.items():
            if comp_id in dnf_set or not pcts:
                continue
            sid = competitor_shooter_map.get(comp_id)
            if sid is None:
                continue  # Unresolved identity — cannot assign a rating.
            div = division_map.get(comp_id) if division_map else None
            entries.append((sid, _mean(pcts), div))

        if not entries:
            return

        # ── Step 2: update anchor state (L4/L5 events only) ──
        # The anchor provides two things:
        #   a) Division weights — the Nth-percentile score for each division,
        #      used to normalise all future (and current) match scores.
        #   b) Reference scores (anchor_perf) — each competitor's normalised
        #      score at this event, stored as their "World Shoot level" (b_vm).
        #
        # IMPORTANT: the anchor is updated BEFORE computing match scores so
        # that anchor participants are immediately available as references
        # within the same match. At the anchor event itself this causes each
        # competitor's match score to equal their own comb (see module docstring
        # for the mathematical proof).
        #
        # Fixed-anchor mode: when anchor_match_id is set, only the designated
        # match triggers an anchor update. Subsequent L4/L5 events are processed
        # normally (match scores computed, reference pool used) but the anchor
        # reference scores and division weights remain frozen.
        if match_level in ("l4", "l5"):
            if self.anchor_match_id is not None:
                # Fixed-anchor: update only if this is the pinned event and it
                # has not been processed yet.
                should_update_anchor = (
                    match_id == self.anchor_match_id and not self._anchor_locked
                )
            else:
                # Rolling-anchor (benchmark default): every L4/L5 replaces the anchor.
                should_update_anchor = True

            if should_update_anchor:
                # Collect raw scores by division to compute percentile weights.
                pcts_by_div: dict[str | None, list[float]] = defaultdict(list)
                for _sid, avg_pct, div in entries:
                    pcts_by_div[div].append(avg_pct)
                # compute_division_weights returns the Nth percentile per division.
                self._div_weights = compute_division_weights(
                    dict(pcts_by_div), self.anchor_percentile
                )
                # Store each competitor's normalised score as their anchor reference.
                for sid, avg_pct, div in entries:
                    self._anchor_perf[sid] = self._normalize(avg_pct, div)
                if self.anchor_match_id is not None:
                    # Lock the anchor so no further L4/L5 events change it.
                    self._anchor_locked = True

        # ── Step 3: compute each competitor's normalised combined score here ──
        # comb = avg_pct / division_weight * 100
        # e.g. Production shooter scoring 90% with weight 78 → comb = 115.4
        norm_scores: dict[int, float] = {
            sid: self._normalize(avg_pct, div) for sid, avg_pct, div in entries
        }

        # ── Step 4: peer comparison — compute each competitor's match score ──
        for sid, _avg_pct, _div in entries:
            a_comb = norm_scores[sid]  # This competitor's normalised score here.

            # Find reference competitors B: must be present in THIS match (so
            # we know their b_comb) AND must have an anchor score (so we know
            # their b_vm = what they scored at the World Shoot).
            refs: list[tuple[float, float]] = []  # (b_comb, b_vm)
            for other_sid, b_comb in norm_scores.items():
                if other_sid == sid:
                    continue  # Don't compare A against themselves.
                if b_comb <= 0:
                    continue  # DQ'd reference competitor — skip to avoid division by zero.
                b_vm = self._anchor_perf.get(other_sid)
                if b_vm is not None:
                    refs.append((b_comb, b_vm))

            if refs:
                # For each reference competitor B, estimate what score A would
                # have achieved at the World Shoot:
                #   contrib(A, B) = (a_comb / b_comb) * b_vm
                # e.g. A scored 10% better than B here; B scored 112 at WS
                # → A would have scored 112 * 1.10 = 123 at WS.
                contribs = [(a_comb / b_comb) * b_vm for b_comb, b_vm in refs]
                weighted = _mean(contribs)  # Average across all reference pairs.
            else:
                # Fallback: no reference competitors available (no anchor yet,
                # or none of the anchor participants competed here).
                # Use the normalised score directly — it is still meaningful
                # as a cross-division metric even without peer calibration.
                weighted = a_comb

            # Accumulate this match score and recompute the top-N average.
            self._match_scores[sid].append(weighted)
            top = sorted(self._match_scores[sid], reverse=True)[: self.top_n]
            self._scores[sid] = _mean(top)  # This is the final ICS ranking score.

        # ── Step 5: update metadata ──
        participated_sids = {sid for sid, _, _ in entries}
        for comp_id, sid in competitor_shooter_map.items():
            if sid is None:
                continue
            key: DivKey = (sid, None)  # ICS is cross-division → division=None always.
            if sid in participated_sids:
                self._matches[key] += 1
            if name_map and comp_id in name_map:
                self._names[sid] = name_map[comp_id]
            if region_map and comp_id in region_map:
                self._regions[sid] = region_map[comp_id]
            if category_map and comp_id in category_map:
                self._categories[sid] = category_map[comp_id]

    def get_ratings(self) -> dict[DivKey, Rating]:
        result: dict[DivKey, Rating] = {}
        for sid, score in self._scores.items():
            key: DivKey = (sid, None)
            result[key] = Rating(
                shooter_id=sid,
                name=self._names.get(sid, f"Shooter {sid}"),
                division=None,
                region=self._regions.get(sid),
                category=self._categories.get(sid),
                mu=score,
                sigma=_FIXED_SIGMA,
                matches_played=self._matches.get(key, 0),
            )
        return result

    def predict_rank(
        self, shooter_ids: list[int], division: str | None = None
    ) -> list[int]:
        scored = [
            (sid, self._scores.get(sid, _DEFAULT_SCORE)) for sid in shooter_ids
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
        return [sid for sid, _ in scored]

    def save_state(self, path: Path) -> None:
        state = {
            "anchor_percentile": self.anchor_percentile,
            "top_n": self.top_n,
            "anchor_match_id": self.anchor_match_id,
            "anchor_locked": self._anchor_locked,
            "names": {str(k): v for k, v in self._names.items()},
            "regions": {str(k): v for k, v in self._regions.items()},
            "categories": {str(k): v for k, v in self._categories.items()},
            "matches": {
                encode_div_key(s, d): v for (s, d), v in self._matches.items()
            },
            "seen_matches": list(self._seen_matches),
            # None key serialised as "" (mirrors encode_div_key convention)
            "div_weights": {
                (k if k is not None else ""): v
                for k, v in self._div_weights.items()
            },
            "anchor_perf": {str(k): v for k, v in self._anchor_perf.items()},
            "match_scores": {str(k): v for k, v in self._match_scores.items()},
            "scores": {str(k): v for k, v in self._scores.items()},
        }
        path.write_text(json.dumps(state))

    def load_state(self, path: Path) -> None:
        state = json.loads(path.read_text())
        self.anchor_percentile = float(
            state.get("anchor_percentile", self.anchor_percentile)
        )
        self.top_n = int(state.get("top_n", self.top_n))
        self.anchor_match_id = state.get("anchor_match_id")
        self._anchor_locked = bool(state.get("anchor_locked", False))
        self._names = {int(k): v for k, v in state.get("names", {}).items()}
        self._regions = {int(k): v for k, v in state.get("regions", {}).items()}
        self._categories = {
            int(k): v for k, v in state.get("categories", {}).items()
        }
        self._matches = defaultdict(
            int,
            {decode_div_key(k): v for k, v in state.get("matches", {}).items()},
        )
        self._seen_matches = set(state.get("seen_matches", []))
        self._div_weights = {
            (k if k else None): v
            for k, v in state.get("div_weights", {}).items()
        }
        self._anchor_perf = {
            int(k): v for k, v in state.get("anchor_perf", {}).items()
        }
        self._match_scores = defaultdict(
            list,
            {int(k): v for k, v in state.get("match_scores", {}).items()},
        )
        self._scores = {int(k): v for k, v in state.get("scores", {}).items()}
