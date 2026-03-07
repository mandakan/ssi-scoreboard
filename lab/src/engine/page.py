"""Static site generator — produces a self-contained HTML explorer from rating data."""
# ruff: noqa: E501  — HTML template lines cannot be wrapped to 100 chars

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from rich.console import Console

_MANIFEST_VERSION = 1

console = Console()

# Human-readable names for the dropdown and About tab.
# _mpct suffix = trained on total match points (one event per match)
# instead of per-stage hit factor (one event per stage).
ALGO_DISPLAY: dict[str, str] = {
    "elo": "ELO (classic baseline)",
    "openskill": "Bayesian — full ranking",
    "openskill_bt": "Bayesian — pairwise",
    "openskill_bt_lvl": "Bayesian — pairwise + level weighting",
    "openskill_pl_decay": "Bayesian — full ranking + activity decay",
    "openskill_bt_lvl_decay": "Bayesian — pairwise + level weighting + activity decay",
    # match_pct variants — same models trained on total match points per official IPSC scoring
    "elo_mpct": "ELO (classic baseline) · match %",
    "openskill_mpct": "Bayesian — full ranking · match %",
    "openskill_bt_mpct": "Bayesian — pairwise · match %",
    "openskill_bt_lvl_mpct": "Bayesian — pairwise + level weighting · match %",
    "openskill_pl_decay_mpct": "Bayesian — full ranking + activity decay · match %",
    "openskill_bt_lvl_decay_mpct": "Bayesian — pairwise + level weighting + activity decay · match %",
}

ALGO_DESCRIPTION: dict[str, str] = {
    "elo": (
        "Classic chess-style rating. Each stage is broken into head-to-head comparisons: "
        "beating a higher-rated competitor earns more points. Simple and well-understood, "
        "but treats all matches equally and has no concept of confidence — a shooter with "
        "2 matches is weighted the same as one with 200."
    ),
    "openskill": (
        "A modern statistical model that tracks both an estimated skill level (μ) and a "
        "confidence measure (σ). The more matches a shooter has, the lower their σ and the "
        "more reliable their rating. Uses the Plackett-Luce model which scores the full "
        "finishing order at once; tends to be less accurate at finding top performers in "
        "large mixed-division fields."
    ),
    "openskill_bt": (
        "Same statistical framework as Bayesian (full ranking) but uses pairwise comparisons "
        "internally — every possible pair of competitors on each stage. Significantly better "
        "at identifying the very top shooters. Recommended as the base model if level "
        "weighting is not needed."
    ),
    "openskill_bt_lvl": (
        "BradleyTerry pairwise model with match-level scaling. A World Shoot result "
        "(large field, high variance) changes ratings more conservatively than a regional "
        "match where results are more predictable. Best at reliably identifying top "
        "performers in our benchmark tests. Recommended for team selection."
    ),
    "openskill_pl_decay": (
        "Bayesian full-ranking model with an inactivity penalty: a shooter who has not "
        "competed in months gains extra uncertainty. When they return, a few good results "
        "will quickly reduce that uncertainty. Prevents retired shooters from permanently "
        "blocking active ones in the ranking."
    ),
    "openskill_bt_lvl_decay": (
        "The most complete model: pairwise comparisons + match-level scaling + inactivity "
        "penalty. Highest overall ranking quality (best Kendall τ in benchmark tests). "
        "Slightly lower top-5 accuracy than plain BradleyTerry because elite shooters "
        "who compete less frequently accumulate extra uncertainty between events."
    ),
    # match_pct variants — same description prefixed with the key difference
    "elo_mpct": (
        "Trained on total match points (official IPSC scoring) rather than per-stage hit "
        "factor. One ranking event per competition instead of one per stage — fewer data "
        "points but aligns with how IPSC officially declares results."
    ),
    "openskill_mpct": (
        "Bayesian full-ranking model trained on total match points (official IPSC scoring). "
        "Each match is one ranking event ordered by total points. Fewer data points than the "
        "stage_hf variant but scores align exactly with official IPSC result sheets."
    ),
    "openskill_bt_mpct": (
        "BradleyTerry pairwise model trained on total match points (official IPSC scoring). "
        "Better at identifying top performers than the Plackett-Luce variant; "
        "one ranking event per match."
    ),
    "openskill_bt_lvl_mpct": (
        "BradleyTerry pairwise model with match-level scaling, trained on total match points "
        "(official IPSC scoring). Combines the accuracy of pairwise comparisons with the "
        "fairness of level-weighted updates. One event per match — useful for comparing "
        "stage_hf vs match_pct scoring approaches side-by-side."
    ),
    "openskill_pl_decay_mpct": (
        "Bayesian full-ranking model with inactivity penalty, trained on total match points "
        "(official IPSC scoring). Inactive shooters accumulate uncertainty; returning "
        "to competition restores confidence quickly. One ranking event per match."
    ),
    "openskill_bt_lvl_decay_mpct": (
        "The most complete model trained on total match points (official IPSC scoring): "
        "pairwise comparisons + match-level scaling + inactivity penalty. "
        "Use this alongside openskill_bt_lvl_decay to compare how the choice of "
        "scoring method (hit factor vs match points) affects the final ranking."
    ),
}

# Short, non-technical model names for the two-step picker dropdown.
BASE_ALGO_DISPLAY: dict[str, str] = {
    "openskill_bt_lvl":       "Recommended — pairwise + match level",
    "openskill_bt_lvl_decay": "Recommended + activity decay",
    "openskill_bt":           "Pairwise (simpler)",
    "openskill_pl_decay":     "Basic Bayesian + activity decay",
    "openskill":              "Basic Bayesian",
    "elo":                    "Classic ELO",
}

# Preferred display order — recommended algorithms first, _mpct variants after their base.
_ALGO_ORDER: list[str] = [
    "openskill_bt_lvl",
    "openskill_bt_lvl_mpct",
    "openskill_bt_lvl_decay",
    "openskill_bt_lvl_decay_mpct",
    "openskill_bt",
    "openskill_bt_mpct",
    "openskill_pl_decay",
    "openskill_pl_decay_mpct",
    "openskill",
    "openskill_mpct",
    "elo",
    "elo_mpct",
]

_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IPSC Rating Explorer</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js"></script>
  <style>[x-cloak]{display:none!important}</style>
</head>
<body class="bg-gray-100 min-h-screen text-gray-900">
<div x-data="app" x-cloak class="max-w-6xl mx-auto px-4 py-8">

  <!-- Header -->
  <header class="mb-6">
    <h1 class="text-2xl font-bold text-gray-900">IPSC Rating Explorer</h1>
    <p class="text-sm text-gray-500 mt-1">
      Generated <span x-text="D.generated_at"></span>
      &nbsp;·&nbsp; <span x-text="D.shooters.length"></span> shooters
      &nbsp;·&nbsp; <span x-text="D.algorithms.length"></span> algorithms
      &nbsp;·&nbsp; <span x-text="D.matches.length"></span> matches
    </p>
  </header>

  <!-- Tab bar -->
  <nav class="flex gap-1 mb-6 bg-white rounded-xl shadow-sm p-1 w-fit">
    <template x-for="t in [{id:'team',l:'Team Selection'},{id:'rankings',l:'Rankings'},{id:'matches',l:'Matches'},{id:'about',l:'About'}]" :key="t.id">
      <button
        @click="tab=t.id"
        :class="tab===t.id ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'"
        class="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
        x-text="t.l">
      </button>
    </template>
  </nav>

  <!-- ── TEAM SELECTION ── -->
  <section x-show="tab==='team'">

    <div class="bg-white rounded-xl shadow-sm p-4 mb-4">
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <div class="col-span-2 sm:col-span-3 lg:col-span-2">
          <label class="block text-xs font-medium text-gray-500 mb-1">Scoring method</label>
          <div class="flex rounded-lg border border-gray-200 overflow-hidden">
            <button @click="ts.scoring='hf'" :class="ts.scoring==='hf'?'bg-blue-600 text-white':'bg-white text-gray-600 hover:bg-gray-50'" class="flex-1 px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap">Hit factor / stage</button>
            <button @click="ts.scoring='mpct'" :class="ts.scoring==='mpct'?'bg-blue-600 text-white':'bg-white text-gray-600 hover:bg-gray-50'" class="flex-1 px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap border-l border-gray-200">Match % (IPSC)</button>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Model</label>
          <select x-model="ts.base" class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <template x-for="a in baseAlgos" :key="a.v">
              <option :value="a.v" x-text="a.l"></option>
            </template>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Region</label>
          <select x-model="ts.region" class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All regions</option>
            <template x-for="r in D.regions" :key="r">
              <option :value="r" x-text="r"></option>
            </template>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Sort by</label>
          <select x-model="ts.sort" class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="conservative">Reliability score</option>
            <option value="mu">Raw rating (μ)</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Min. matches</label>
          <input type="number" x-model.number="ts.minM" min="0" max="50"
            class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Active since</label>
          <input type="date" x-model="ts.since"
            class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Top N per group</label>
          <input type="number" x-model.number="ts.topN" min="1" max="20"
            class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        </div>
      </div>

      <!-- Sub-nav: Division / Category view -->
      <div class="flex flex-wrap items-center gap-2">
        <button @click="ts.view='div'"
          :class="ts.view==='div' ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'"
          class="px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors">
          By Division
        </button>
        <button @click="ts.view='cat'"
          :class="ts.view==='cat' ? 'bg-purple-100 text-purple-700 border-purple-300' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'"
          class="px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors">
          By Category
        </button>
        <!-- Category filter only in division view -->
        <div x-show="ts.view==='div'" class="ml-auto">
          <select x-model="ts.cat" class="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All categories</option>
            <template x-for="c in D.categories" :key="c">
              <option :value="c" x-text="c"></option>
            </template>
          </select>
        </div>
      </div>
    </div>

    <!-- By Division results -->
    <div x-show="ts.view==='div'">
      <p x-show="teamByDiv.length===0"
        class="text-center py-12 text-gray-400 bg-white rounded-xl shadow-sm">
        No shooters match the current criteria.
      </p>
      <div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <template x-for="[div, shooters] in teamByDiv" :key="div">
          <div class="bg-white rounded-xl shadow-sm overflow-hidden">
            <div class="bg-blue-600 px-4 py-2.5 flex items-center justify-between">
              <span class="text-white font-semibold text-sm" x-text="div"></span>
              <span class="text-blue-200 text-xs" x-text="shooters.length + ' shooters'"></span>
            </div>
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-gray-50 text-xs text-gray-400 uppercase">
                  <th class="px-3 py-2 text-left w-6">#</th>
                  <th class="px-3 py-2 text-left">Name</th>
                  <th class="px-3 py-2 text-right" title="Reliability score (conservative rating)">Score</th>
                  <th class="px-3 py-2 text-right" title="Matches played">M</th>
                </tr>
              </thead>
              <tbody>
                <template x-for="(s, i) in shooters" :key="s.id">
                  <tr class="border-t border-gray-100"
                    :class="i===0 ? 'bg-yellow-50' : 'hover:bg-gray-50'">
                    <td class="px-3 py-2 text-gray-400 text-xs" x-text="i+1"></td>
                    <td class="px-3 py-2">
                      <span :class="i===0 ? 'font-semibold' : ''" x-text="s.name"></span>
                      <span x-show="s.category"
                        class="ml-1 text-xs text-gray-400"
                        x-text="'(' + s.category + ')'"></span>
                    </td>
                    <td class="px-3 py-2 text-right font-mono text-xs"
                      x-text="scoreVal(s).toFixed(2)"></td>
                    <td class="px-3 py-2 text-right text-gray-400 text-xs"
                      x-text="s.ratings[tsAlgo].m"></td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </template>
      </div>
    </div>

    <!-- By Category results -->
    <div x-show="ts.view==='cat'">
      <p x-show="teamByCat.length===0"
        class="text-center py-12 text-gray-400 bg-white rounded-xl shadow-sm">
        No category shooters match the criteria.
        <span class="block text-xs mt-1">(Shooters with no registered category are excluded from this view.)</span>
      </p>
      <div class="grid sm:grid-cols-2 gap-4">
        <template x-for="[cat, shooters] in teamByCat" :key="cat">
          <div class="bg-white rounded-xl shadow-sm overflow-hidden">
            <div class="bg-purple-600 px-4 py-2.5 flex items-center justify-between">
              <span class="text-white font-semibold text-sm" x-text="cat"></span>
              <span class="text-purple-200 text-xs" x-text="shooters.length + ' shooters'"></span>
            </div>
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-gray-50 text-xs text-gray-400 uppercase">
                  <th class="px-3 py-2 text-left w-6">#</th>
                  <th class="px-3 py-2 text-left">Name</th>
                  <th class="px-3 py-2 text-left">Division</th>
                  <th class="px-3 py-2 text-right">Score</th>
                  <th class="px-3 py-2 text-right">M</th>
                </tr>
              </thead>
              <tbody>
                <template x-for="(s, i) in shooters" :key="s.id">
                  <tr class="border-t border-gray-100"
                    :class="i===0 ? 'bg-yellow-50' : 'hover:bg-gray-50'">
                    <td class="px-3 py-2 text-gray-400 text-xs" x-text="i+1"></td>
                    <td class="px-3 py-2">
                      <span :class="i===0 ? 'font-semibold' : ''" x-text="s.name"></span>
                    </td>
                    <td class="px-3 py-2 text-gray-500 text-xs" x-text="s.division||'—'"></td>
                    <td class="px-3 py-2 text-right font-mono text-xs"
                      x-text="scoreVal(s).toFixed(2)"></td>
                    <td class="px-3 py-2 text-right text-gray-400 text-xs"
                      x-text="s.ratings[tsAlgo].m"></td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </template>
      </div>
    </div>
  </section>

  <!-- ── RANKINGS ── -->
  <section x-show="tab==='rankings'">
    <div class="bg-white rounded-xl shadow-sm p-4 mb-4">
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
        <div class="col-span-2 sm:col-span-3 lg:col-span-2">
          <label class="block text-xs font-medium text-gray-500 mb-1">Scoring method</label>
          <div class="flex rounded-lg border border-gray-200 overflow-hidden">
            <button @click="rk.scoring='hf'" :class="rk.scoring==='hf'?'bg-blue-600 text-white':'bg-white text-gray-600 hover:bg-gray-50'" class="flex-1 px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap">Hit factor / stage</button>
            <button @click="rk.scoring='mpct'" :class="rk.scoring==='mpct'?'bg-blue-600 text-white':'bg-white text-gray-600 hover:bg-gray-50'" class="flex-1 px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap border-l border-gray-200">Match % (IPSC)</button>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Model</label>
          <select x-model="rk.base" class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <template x-for="a in baseAlgos" :key="a.v">
              <option :value="a.v" x-text="a.l"></option>
            </template>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Division</label>
          <select x-model="rk.div" class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All divisions</option>
            <template x-for="d in D.divisions" :key="d">
              <option :value="d" x-text="d"></option>
            </template>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Region</label>
          <select x-model="rk.region" class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All regions</option>
            <template x-for="r in D.regions" :key="r">
              <option :value="r" x-text="r"></option>
            </template>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Category</label>
          <select x-model="rk.cat" class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All categories</option>
            <template x-for="c in D.categories" :key="c">
              <option :value="c" x-text="c"></option>
            </template>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Search name</label>
          <input type="text" x-model="rk.q" placeholder="Type to search..."
            class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        </div>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs font-medium text-gray-500">Sort by:</span>
        <button @click="rk.sort='conservative'"
          :class="rk.sort==='conservative' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
          class="px-3 py-1 rounded-lg text-sm font-medium transition-colors">
          Reliability score
        </button>
        <button @click="rk.sort='mu'"
          :class="rk.sort==='mu' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
          class="px-3 py-1 rounded-lg text-sm font-medium transition-colors">
          Raw rating (μ)
        </button>
        <span class="ml-auto text-sm text-gray-400" x-text="ranked.length + ' shooters'"></span>
      </div>
    </div>

    <div class="bg-white rounded-xl shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
            <tr>
              <th class="px-4 py-3 text-right w-12">#</th>
              <th class="px-4 py-3 text-left">Name</th>
              <th class="px-4 py-3 text-left">Division</th>
              <th class="px-4 py-3 text-left">Category</th>
              <th class="px-4 py-3 text-left">Region</th>
              <th class="px-4 py-3 text-right">Rating (μ)</th>
              <th class="px-4 py-3 text-right">Reliability</th>
              <th class="px-4 py-3 text-right">Matches</th>
              <th class="px-4 py-3 text-right">Last match</th>
            </tr>
          </thead>
          <tbody>
            <template x-for="(s, i) in ranked" :key="s.key">
              <tr class="border-t border-gray-100 hover:bg-gray-50">
                <td class="px-4 py-2.5 text-right text-gray-400 text-xs" x-text="i+1"></td>
                <td class="px-4 py-2.5 font-medium" x-text="s.name"></td>
                <td class="px-4 py-2.5 text-gray-500 text-xs" x-text="s.division||'—'"></td>
                <td class="px-4 py-2.5 text-gray-400 text-xs" x-text="s.category||'—'"></td>
                <td class="px-4 py-2.5 text-gray-500 text-xs" x-text="s.region||'—'"></td>
                <td class="px-4 py-2.5 text-right font-mono text-xs"
                  x-text="s.ratings[rkAlgo].mu.toFixed(2)"></td>
                <td class="px-4 py-2.5 text-right font-mono text-xs font-semibold text-blue-700"
                  x-text="s.ratings[rkAlgo].cr.toFixed(2)"></td>
                <td class="px-4 py-2.5 text-right text-gray-500 text-xs"
                  x-text="s.ratings[rkAlgo].m"></td>
                <td class="px-4 py-2.5 text-right text-gray-400 text-xs"
                  x-text="s.ratings[rkAlgo].d||'—'"></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <!-- ── MATCHES (transparency) ── -->
  <section x-show="tab==='matches'">
    <div class="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 text-sm text-blue-800">
      <strong>Transparency:</strong>
      These <span x-text="D.matches.length"></span> competitions were used to train all rating
      algorithms, processed in chronological order.
      Algorithms without a suffix use <strong>hit factor per stage</strong> (each stage is a
      separate ranking event). Algorithms marked <strong>· match %</strong> use
      <strong>total match points</strong> per official IPSC scoring (one ranking event per match).
    </div>
    <div class="bg-white rounded-xl shadow-sm overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
          <tr>
            <th class="px-4 py-3 text-left">Match</th>
            <th class="px-4 py-3 text-left">Date</th>
            <th class="px-4 py-3 text-left">Level</th>
            <th class="px-4 py-3 text-right">Competitors</th>
          </tr>
        </thead>
        <tbody>
          <template x-for="m in D.matches" :key="m.ct+'_'+m.id">
            <tr class="border-t border-gray-100 hover:bg-gray-50">
              <td class="px-4 py-2.5 font-medium" x-text="m.name||('Match '+m.id)"></td>
              <td class="px-4 py-2.5 text-gray-500" x-text="m.date||'—'"></td>
              <td class="px-4 py-2.5">
                <span class="px-2 py-0.5 rounded-full text-xs font-medium"
                  :class="{
                    'bg-yellow-100 text-yellow-800': m.level==='l2',
                    'bg-orange-100 text-orange-800': m.level==='l3',
                    'bg-red-100 text-red-800':       m.level==='l4',
                    'bg-purple-100 text-purple-800': m.level==='l5',
                    'bg-gray-100 text-gray-600':     !m.level
                  }"
                  x-text="({'l2':'Level 2 – Regional','l3':'Level 3 – National','l4':'Level 4 – Continental','l5':'Level 5 – World'})[m.level]||m.level||'Unknown'">
                </span>
              </td>
              <td class="px-4 py-2.5 text-right text-gray-500" x-text="m.competitors||'—'"></td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </section>

  <!-- ── ABOUT ── -->
  <section x-show="tab==='about'" class="space-y-6">

    <div class="bg-white rounded-xl shadow-sm p-6">
      <h2 class="text-lg font-bold mb-4">How to read the scores</h2>
      <div class="grid md:grid-cols-3 gap-4">
        <div class="bg-blue-50 rounded-xl p-4">
          <div class="font-semibold text-blue-900 mb-1">Rating (μ)</div>
          <div class="text-sm text-blue-800">
            The algorithm's best estimate of skill. Higher means the system thinks this shooter
            is better. Not reliable on its own — a shooter with one lucky result will have an
            inflated rating.
          </div>
        </div>
        <div class="bg-green-50 rounded-xl p-4">
          <div class="font-semibold text-green-900 mb-1">Reliability score</div>
          <div class="text-sm text-green-800">
            Rating minus an uncertainty penalty. A shooter with 15 matches and rating 28 scores
            higher than one with 2 matches and rating 30. Use this for team selection — it
            rewards consistent performance over time.
          </div>
        </div>
        <div class="bg-gray-50 rounded-xl p-4">
          <div class="font-semibold text-gray-800 mb-1">Matches (M)</div>
          <div class="text-sm text-gray-700">
            Number of competitions included. More matches means lower uncertainty and a
            reliability score that is closer to the raw rating. Shooters with few matches are
            penalised until they have proven themselves consistently.
          </div>
        </div>
      </div>
      <div class="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-900">
        <strong>Example:</strong> Alice has rating 28 from 20 matches → reliability score ≈ 26.2.
        Bob has rating 30 from 2 matches → reliability score ≈ 25.3.
        Bob looks better by raw rating, but Alice is the safer pick — she has demonstrated
        consistent excellence across 20 competitions.
      </div>
    </div>

    <div class="bg-white rounded-xl shadow-sm p-6">
      <h2 class="text-lg font-bold mb-1">Algorithms</h2>
      <p class="text-sm text-gray-500 mb-4">
        All algorithms use the same underlying data. Switching between them lets you see how
        sensitive the ranking is to the choice of model.
      </p>
      <div class="space-y-3">
        <template x-for="a in algoOpts" :key="a.v">
          <div class="border border-gray-100 rounded-xl p-4">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-semibold text-gray-900" x-text="a.l"></span>
              <code class="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded"
                x-text="a.v"></code>
            </div>
            <div class="text-sm text-gray-600" x-text="ALGO_DESC[a.v]||''"></div>
          </div>
        </template>
      </div>
    </div>

    <div class="bg-white rounded-xl shadow-sm p-6 text-sm text-gray-700 space-y-3">
      <h2 class="text-lg font-bold text-gray-900">How the ratings are calculated</h2>
      <p>
        Competitions are processed in <strong>chronological order</strong>. Two scoring modes
        are available and can be compared side-by-side by selecting different algorithms:
      </p>
      <ul class="list-disc pl-5 space-y-1">
        <li>
          <strong>Hit factor per stage</strong> (algorithms without suffix) — each stage is a
          separate ranking event. Competitors are ranked by hit factor (points ÷ time).
          A 10-stage match produces 10 data points, giving faster convergence.
        </li>
        <li>
          <strong>Match % (· match % suffix)</strong> — the whole match is one ranking event,
          ordered by total match points. This aligns exactly with how IPSC officially declares
          results. Fewer data points per competition, but scores match the official scoresheet.
        </li>
      </ul>
      <p>
        Disqualified or zeroed competitors are ranked last. Competitors who did not fire a
        stage (DNF) are excluded from that stage result.
      </p>
      <p>
        After each ranking event the algorithm updates its belief about each competitor's skill.
        Over many competitions a shooter's rating converges towards their true skill level
        and the uncertainty decreases.
      </p>
      <p>
        The <strong>Matches tab</strong> lists every competition included in the calculation.
        The <strong>reliability score</strong> is the 70th-percentile lower bound of the rating:
        we are 70% confident the shooter's true skill is at least that high.
      </p>
    </div>

  </section>
</div>

<script>
const D                 = DATA_PLACEHOLDER;
const ALGO_DISPLAY      = ALGO_DISPLAY_PLACEHOLDER;
const ALGO_DESC         = ALGO_DESC_PLACEHOLDER;
const BASE_ALGO_DISPLAY = BASE_ALGO_DISPLAY_PLACEHOLDER;

const _BASE_ORDER = ['openskill_bt_lvl','openskill_bt_lvl_decay','openskill_bt','openskill_pl_decay','openskill','elo'];

document.addEventListener('alpine:init', () => {
  Alpine.data('app', () => ({
    D,
    tab: 'team',
    ts: {
      base:    'openskill_bt_lvl',
      scoring: D.algorithms.some(a => a.endsWith('_mpct')) ? 'mpct' : 'hf',
      region: '',
      sort:   'conservative',
      minM:   3,
      since:  '2024-01-01',
      topN:   6,
      view:   'div',
      cat:    '',
    },
    rk: {
      base:    'openskill_bt_lvl',
      scoring: D.algorithms.some(a => a.endsWith('_mpct')) ? 'mpct' : 'hf',
      div: '', region: '', cat: '', sort: 'conservative', q: '',
    },

    _resolveAlgo(base, scoring) {
      const full = scoring === 'mpct' ? base + '_mpct' : base;
      if (this.D.algorithms.includes(full)) return full;
      if (this.D.algorithms.includes(base)) return base;
      return this.D.algorithms[0] ?? '';
    },
    get tsAlgo() { return this._resolveAlgo(this.ts.base, this.ts.scoring); },
    get rkAlgo() { return this._resolveAlgo(this.rk.base, this.rk.scoring); },

    get baseAlgos() {
      const bases = [...new Set(this.D.algorithms.map(a => a.replace(/_mpct$/, '')))];
      bases.sort((a, b) => {
        const ia = _BASE_ORDER.indexOf(a), ib = _BASE_ORDER.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1; if (ib === -1) return -1;
        return ia - ib;
      });
      return bases.map(v => ({ v, l: BASE_ALGO_DISPLAY[v] ?? v }));
    },

    // Full algo list used only in the About tab.
    get algoOpts() {
      return this.D.algorithms.map(a => ({ v: a, l: ALGO_DISPLAY[a] ?? a }));
    },

    scoreVal(s) {
      const r = s.ratings[this.tsAlgo];
      if (!r) return 0;
      return this.ts.sort === 'conservative' ? r.cr : r.mu;
    },

    _eligible(s) {
      const { base, scoring, region, minM, since } = this.ts;
      const r = s.ratings[this._resolveAlgo(base, scoring)];
      if (!r) return false;
      if (region && s.region !== region) return false;
      if (r.m < minM) return false;
      if (since && r.d && r.d < since) return false;
      return true;
    },

    _sorted(list) {
      const algo = this.tsAlgo;
      const { sort } = this.ts;
      return [...list].sort((a, b) => {
        const ra = a.ratings[algo], rb = b.ratings[algo];
        return sort === 'conservative' ? rb.cr - ra.cr : rb.mu - ra.mu;
      });
    },

    get teamByDiv() {
      const { cat, topN } = this.ts;
      const buckets = {};
      for (const s of this.D.shooters) {
        if (!s.division) continue;
        if (cat && s.category !== cat) continue;
        if (!this._eligible(s)) continue;
        (buckets[s.division] ??= []).push(s);
      }
      for (const d of Object.keys(buckets))
        buckets[d] = this._sorted(buckets[d]).slice(0, topN);
      return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b));
    },

    get teamByCat() {
      const { topN } = this.ts;
      const buckets = {};
      for (const s of this.D.shooters) {
        if (!s.category) continue;
        if (!this._eligible(s)) continue;
        (buckets[s.category] ??= []).push(s);
      }
      for (const c of Object.keys(buckets))
        buckets[c] = this._sorted(buckets[c]).slice(0, topN);
      return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b));
    },

    get ranked() {
      const algo = this.rkAlgo;
      const { div, region, cat, sort, q } = this.rk;
      const lq = q.toLowerCase();
      const list = this.D.shooters.filter(s => {
        const r = s.ratings[algo];
        if (!r) return false;
        if (div    && s.division !== div)    return false;
        if (region && s.region   !== region) return false;
        if (cat    && s.category !== cat)    return false;
        if (lq     && !s.name.toLowerCase().includes(lq)) return false;
        return true;
      });
      list.sort((a, b) => {
        const ra = a.ratings[algo], rb = b.ratings[algo];
        return sort === 'conservative' ? rb.cr - ra.cr : rb.mu - ra.mu;
      });
      return list.slice(0, 300);
    },
  }));
});
</script>
</body>
</html>
"""


def _build_manifest(data: dict[str, Any]) -> dict[str, Any]:
    """Return a small provenance manifest for reproducibility checking."""
    dates = [m["date"] for m in data["matches"] if m.get("date")]
    return {
        "manifest_version": _MANIFEST_VERSION,
        "generated_at": data["generated_at"],
        "match_count": len(data["matches"]),
        "shooter_count": len(data["shooters"]),
        "date_range": {
            "from": min(dates) if dates else None,
            "to": max(dates) if dates else None,
        },
        "algorithms": data["algorithms"],
    }


def generate_site(data: dict[str, Any], output_dir: Path) -> None:
    """Write the static explorer to output_dir/index.html and manifest.json."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # Sort algorithms by preferred order; unknowns go to the end alphabetically.
    order = {a: i for i, a in enumerate(_ALGO_ORDER)}
    data["algorithms"] = sorted(
        data["algorithms"],
        key=lambda a: (order.get(a, len(_ALGO_ORDER)), a),
    )

    sep = (",", ":")
    html = _HTML
    # Replace longer/prefixed placeholders first so partial matches don't corrupt them.
    # (ALGO_DISPLAY_PLACEHOLDER is a substring of BASE_ALGO_DISPLAY_PLACEHOLDER)
    html = html.replace("DATA_PLACEHOLDER",              json.dumps(data,             separators=sep))
    html = html.replace("BASE_ALGO_DISPLAY_PLACEHOLDER", json.dumps(BASE_ALGO_DISPLAY, separators=sep))
    html = html.replace("ALGO_DISPLAY_PLACEHOLDER",      json.dumps(ALGO_DISPLAY,     separators=sep))
    html = html.replace("ALGO_DESC_PLACEHOLDER",         json.dumps(ALGO_DESCRIPTION, separators=sep))

    out = output_dir / "index.html"
    out.write_text(html, encoding="utf-8")

    manifest = _build_manifest(data)
    manifest_out = output_dir / "manifest.json"
    manifest_out.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    size_kb = out.stat().st_size // 1024
    console.print(f"[green]Site written to {out}[/green] ({size_kb} KB)")
    console.print(
        f"  {len(data['shooters'])} shooters · "
        f"{len(data['algorithms'])} algorithms · "
        f"{len(data['matches'])} matches"
    )
    console.print(f"[dim]Manifest: {manifest_out}[/dim]")
