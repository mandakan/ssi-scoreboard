# Coaching Features Research

Research notes for the next round of coaching-oriented features in SSI Scoreboard.

Scope: post-match and pre-match analysis. **Live mode is treated as optional** —
many matches in 2026 either disable live scores or have spotty connectivity at
the range, so the coaching experience is anchored around what's available
before and after a match, not during.

This is a research document, not a spec. It proposes features grouped by user
mode (coach / self-coach) and by match phase (pre / post), grounded in the
data we already have and the scientific literature on motor skill and
performance coaching. Every proposal lists the raw inputs it needs so we can
filter out anything we can't actually compute.

---

## 1. What the app already does

A separate exploration of `app/match/[ct]/[id]/match-page-client.tsx`,
`app/shooter/[shooterId]/`, `app/api/compare/logic.ts`,
`lib/achievements/definitions.ts`, and `lib/types.ts` mapped the existing
analysis surface. Summary so the rest of this doc doesn't accidentally
re-propose something that ships today:

**Match-page analytics** (9 chart sections, each with an info popover):

1. Stage results comparison table (HF, points, time, penalties per stage)
2. Hit factor by stage — bar chart with field leader / median benchmarks
3. HF% vs stage winner — color bands (green ≥95%, amber 85–95%, red <85%)
4. Division position — Q1–Q3 band + median per division
5. Speed vs. accuracy — scatter with iso-HF lines
6. Stage balance — per-stage HF% radar
7. Shooter style fingerprint — accuracy vs speed percentiles, archetype quadrants
8. Shooter style profile — 4-axis radar (Speed / Accuracy / Composure / Consistency)
9. Stage degradation — Spearman r of shooting order vs HF%

Plus a coaching-mode collapsible: Course length summary, Constraint summary
(strong/weak hand, moving targets, unloaded start), Archetype performance,
and a Stage Simulator (what-if at ≥80% scoring).

**Shooter dashboard:** aggregate cards (total stages/matches, avg HF, match %,
A%, CV consistency, HF trend slope), match history table (50 most recent),
upcoming matches, and achievements (15 types across Milestone / Accuracy /
Variety / Recurring categories, persisted in `shooter_achievements`).

**Already-shipped coaching surfaces:**

- AI **coaching tip** per competitor on the match page (`components/coaching-tip.tsx`) —
  Coach / Roast modes, gated on consent dialog. Prompt is built in
  `lib/coaching-prompt.ts` (versioned at `COACHING_PROMPT_VERSION = 3`).
  Route at `app/api/coaching/[ct]/[id]/[competitorId]/route.ts` is
  match-complete-gated (needs field stats to give grounded advice).
- AI **pre-match brief** (`app/api/pre-match/brief/[ct]/[id]/route.ts`) —
  uses a *different* gate from the coaching tip; available pre-scoring.
- An **availability pre-flight** at `app/api/coaching/availability/route.ts`
  returns `{ available: isAIConfigured() }` so the UI can hide AI surfaces
  when the binding is missing. Reuse this pattern for new AI features.
- **Stage Simulator** what-if (≥80% scoring) — `components/stage-simulator.tsx`,
  calls `/api/simulate`, persists adjustments to **sessionStorage** per
  match/competitor.
- **Achievements** with tier ladders and progress indicators.
- **"My Shooter" identity + tracked-shooter list** — `lib/shooter-identity.ts`
  is a fully-formed client-side identity layer: `useSyncExternalStore`
  subscriptions, cross-tab sync via `storage` events, same-tab sync via
  custom events, snapshot caching. Keys: `ssi-my-shooter`,
  `ssi-tracked-shooters`. This is the foundation new coaching artifacts
  can sit on without building anything new — see §5.

**Raw data per stage we can compute over:** `hit_factor`, `points`, `time`,
`a_hits / c_hits / d_hits / miss_count / no_shoots / procedurals`, `dq`,
`zeroed`, `dnf`, `incomplete`, `shooting_order`, plus the derived
`stageClassification` (solid / conservative / over-push / meltdown),
`hitLossPoints`, `penaltyLossPoints`. We have division and field context.

**Raw data we do NOT have** (this is the most important constraint for any
coaching feature): no per-shot splits, no draw time, no transition time, no
reload time, no video, no audio, no body data. SSI's GraphQL exposes
hit-zone totals and stage time but not the underlying timer string.

---

## 2. Two user modes, two unmet needs

### 2a. The self-coaching shooter

Today the app tells a shooter *what happened*. It does not tell them
*what to work on next* in a prioritized, repeatable form. Charts are read
once after a match and then the page is closed. There is no continuity
between matches and no place to record the shooter's own observations.

### 2b. The coach helping others

Today, a coach has to either screen-share the match page or screenshot the
charts and annotate them in WhatsApp / Discord. There is no concept of a
coach-shooter relationship, shared notes, or a multi-shooter "students"
view. There is also no way for a coach to leave a comment on a stage that
the shooter sees later.

These are different products, but they share a backbone: persistent,
shooter-scoped artifacts (notes, goals, plans) that survive between
matches. Building that backbone once unlocks both modes.

---

## 3. Scientific grounding

The literature converges on a small number of evidence-supported levers that
generalize across closed-skill precision sports (which IPSC mostly is — open
courses still reduce to a sequence of closed shooting problems).

**Self-regulated learning (SRL) — Zimmerman & Schunk's three-phase cycle.**
Forethought → Performance → Self-reflection. High SRL scores correlate with
elite performance and with the ability to translate awareness of strengths
and weaknesses into action ([Frontiers, 2023](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1089110/full),
[Bartulovic et al., 2018](https://pubmed.ncbi.nlm.nih.gov/29569522/)). The
forethought and self-reflection phases map directly onto our pre-match and
post-match surfaces.

**After-Action Review (AAR).** Military / EMS framework: *intended vs.
actual, what worked, what didn't, what we change next time*. Forward-looking,
non-blaming, time-boxed. Widely adopted in sports debriefs
([Asana template](https://asana.com/resources/after-action-review-template),
[Wikipedia](https://en.wikipedia.org/wiki/After-action_review)). The
structure is short enough to ship as a guided form.

**Mental Management (Lanny Bassham, *With Winning in Mind*).** Olympic gold
medallist's framework — goal setting, mental rehearsal, the "three phases of
a task" (preparation / action / reinforcement), and the principle that
performance is driven by what you *picture*, not what you *say*
([overview](https://www.lucasballasy.com/posts/blt-no-134-7-mental-management-principles-from-with-winning-in-mind-by-lanny-bassham)).
Stoeger's *Match Mentality* and Steve Anderson's coaching apply the same
principles specifically to USPSA/IPSC.

**Imagery / visualization meta-analyses.** Combined physical + mental
practice consistently outperforms equivalent physical practice alone.
Effective dose: ~10 min × 3/week ([PMC meta-analysis, 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12109254/),
[mixed-methods study, 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12021890/)).
Multi-sensory rehearsal (sight, sound, kinesthetic feel) beats pure visual.

**Quiet Eye (Vickers).** A long final fixation (>100 ms, within 3° of target,
beginning before motor initiation) reliably distinguishes experts from
non-experts and trains in 5–6 sessions
([Wikipedia](https://en.wikipedia.org/wiki/Quiet_eye), [Frontiers, 2021](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.676591/full)).
Relevant to pre-shot routines and to per-target visualization during stage
planning. We can't measure QE, but we can prompt for it in a pre-match
checklist.

**IZOF (Individual Zones of Optimal Functioning, Hanin).** Each athlete
performs best at their own arousal level — there is no universal "stay calm"
prescription. The intervention is to log subjective arousal + emotion against
performance, find the personal zone, then learn to enter it
([Sportlyzer summary](https://academy.sportlyzer.com/wiki/arousal-and-performance/individual-zones-of-optimal-functioning-izof/),
[review, 2014](https://www.researchgate.net/publication/276831504_The_individual_zones_of_optimal_functioning_IZOF_model_1978-2014_Historical_overview_of_its_development_and_use)).
A 1-tap pre/post arousal rating gives us the data to surface this.

**Deliberate practice (Ericsson).** Targeted, effortful, feedback-rich
practice on specific weaknesses. The shorthand "drill the weakest thing" is
a coaching cliché but operationally it requires (a) identifying the weakest
thing reliably and (b) prescribing a drill that actually trains it. The app
is currently good at (a) — Constraint summary, Archetype performance, Stage
degradation — and silent on (b).

---

## 4. Prior art / competitor scan

| App | What it does well | What it doesn't do |
|---|---|---|
| **hitfactor.app** | Offline-first calculator, "What If" / "Dream Score" sandboxes for personal scorecards, training tracker | No match-import, no coach view, no narrative coaching, no field context |
| **Shotlog** | Tagged practice sessions, gear tracking, time-series stats, par-timer presets, free + Pro tier | Single-shooter only, no field benchmarking, no IPSC stage model, no coach link |
| **PractiScore Competitor** | Imports match results from PractiScore matches, compare shooters, ranks | Read-only, no journaling, no goals, no plan, no coaching |
| **Hit Factor Genie** | HHF-aware stage math: "how many points can you afford to drop" | Stage-planning aid only, no persistence |
| **Brass / LaserHIT / MantisX / Drill** | Dry-fire / live-fire rep tracking, drill prescription, hardware-paired | Disconnected from match data — no closed loop between range work and competition results |
| **Shooting Diary for Coach** | Coach-of-many model: paperless scoring for a training group | Air-rifle / Olympic discipline focus; not IPSC; not match-import driven |
| **CoachNow** (generic) | Coach-student channels, video, share notes, assignments | Not shooting-specific, no auto-pulled performance data |

The gap nobody is filling: **match-data-driven coaching that closes the loop
between competition results, between-match training, and the next match's
pre-shoot mindset**. We already own the left side of that loop (match data).
The coaching backbone — notes, goals, drill mapping, coach-shooter link —
would let us own the rest.

---

## 5. Constraint: identity & persistence

Most of the proposals below require **persistent, shooter-scoped storage**.
Today the app is unauthenticated and shooter dashboards are keyed by the
global shooter ID encoded in the URL. There *is* however a fully-formed
**localStorage "My Shooter" identity layer** (`lib/shooter-identity.ts`) —
the "this is *my* dashboard" question is already answered for personal
use. Three viable paths, with increasing investment:

- **A. localStorage only** (zero backend, **foundation already exists**).
  Goals, notes, AAR responses, and journal entries live on one device,
  keyed by `MyShooterIdentity.shooterId`. The `lib/shooter-identity.ts`
  module already gives us snapshot caching, cross-tab sync, and a
  `useSyncExternalStore` pattern — new artifacts (e.g. `ssi-match-goals`,
  `ssi-match-aar`) plug into the same shape with ~30 lines of helper
  code per artifact type. Pros: ships in days, no auth, no privacy
  review, no DB migration. Cons: no cross-device, no coach sharing,
  lost on cache clear. Good enough for v0 self-coaching.

- **B. Magic-link claim + AppDatabase.** Shooter "claims" their dashboard
  via email magic-link, claim is stored in a new `shooter_claims` table.
  Server-side notes and goals tied to claim. Enables cross-device and is
  the prerequisite for any coach-shooter link. Pros: lightweight, fits
  the existing SQLite/D1 model. Cons: introduces auth surface, deliverability
  hassle, claim disputes (what if someone claims a shooter that isn't them).

- **C. SSO via SSI account.** Lets users log in with the same credentials
  they use on shootnscoreit.com, identity verified by SSI. Pros: high trust.
  Cons: requires SSI cooperation; the bot account we use today is a service
  account, not an OAuth provider.

Path **A → B** is the natural progression. Any feature below that needs
storage should be designed so it can start on **A** and graduate to **B**
without a data migration nightmare (i.e., the localStorage and DB schemas
should be the same shape).

**Privacy note.** `CLAUDE.md` commits us to "never log shooter IDs / specific
competitor IDs / raw search text" in telemetry. Coaching artifacts
(notes, goals) are by nature personal. They go in AppDatabase, not in
telemetry. The coaching-tip and pre-match-brief AI endpoints already accept
this and we should extend the same posture: AI prompt bodies for coaching
features must not be logged with raw user text, only with bucketed
metadata.

---

## 6. Pre-match coaching features

Pre-match is the **forethought** phase: stage planning, goal-setting,
arousal preparation, mental rehearsal. Today the app's pre-match view shows
squad rotation, weather, registered field, and (if AI consent is given) an
AI brief. That's a strong base, but it's read-only.

### 6.1 Goal-setting wizard (per match)

**What.** Before a match, the shooter sets 1–3 *process* goals (not outcome
goals). Process goals are things the shooter controls: "call my shots,"
"never start a stage faster than my plan," "no procedurals on weak-hand
sections." Outcome goals ("top 10 in division") are deliberately
de-emphasized per Mental Management research — they invite outcome anxiety
and are weakly under the athlete's control on any given day.

**Inputs.** Shooter's last 5 matches' weak areas (from existing
`stageClassification`, penalty rates, constraint summary, archetype).
The wizard pre-fills 3–5 candidate goals from those weaknesses; the
shooter picks 1–3. AI can phrase them, but the candidates come from data,
not from the model.

**Output.** Stored as `match_goals[shooter_id][match_id]`. Surfaced again
in the post-match AAR (§7.1) for the "did you do what you said you'd do"
loop.

**Why it matters.** SRL forethought without explicit goals is just hope.
The goals are what the reflection phase compares against — without them,
post-match analysis has no anchor.

### 6.2 Stage plan workspace

**What.** Per stage in the pre-match view, a free-text "my plan" field
plus a structured checklist:

- Start position confirmed (loaded / unloaded / table-start)
- First target / first array / movement
- Reload point(s)
- Mandatory shooting position(s) — strong/weak hand, prone, port shots
- Last shot / last position
- "Anchor cue" — Bassham's reinforcement: one word/image that the shooter
  associates with their best version of this stage

**Inputs.** Stage briefing PDF link if SSI exposes one (currently it
doesn't reliably). Otherwise pure user input. Field context: what HF the
top 10% put up on similar stages (course length, archetype) — this
calibrates "what does success look like here."

**Output.** Stored locally per match. Survives until the match ends.
Optional post-match annotation: "did I execute this plan?" (yes / partial /
abandoned).

**Why.** Stoeger's central thesis: by B-class level, the bottleneck is
*programming* a stage so the conscious mind doesn't have to make decisions
mid-run. A typed plan with explicit reload and movement points forces the
programming step. Many shooters do this on a notes-app today; we can do it
better because we know the stage list and the field context.

### 6.3 Visualization timer

**What.** A simple in-app timer based on the imagery meta-analysis dose
(10 min × 3/week is the *cumulative* target, but per-stage rehearsal is
much shorter — 30–90 seconds, eyes closed, running the stage at real
speed in first-person). The timer prompts:

- Eyes closed
- Real-time speed (not slow-motion)
- Full sensory: see the front sight, hear the timer beep, feel the
  recoil rhythm, feel the reload
- 3 reps per stage

This is not gee-whiz AR/VR. It's a guided 90-second drill the shooter
does on a phone in the staging area between calls.

**Inputs.** The shooter's stage plan from §6.2 — the prompt text is
generated from it ("now picture the draw to T1, your first split, the
move to position 2...").

**Why.** This is the single most under-implemented feature in shooting
apps despite the literature being unambiguous about effect size.

### 6.4 Arousal check-in

**What.** One slider, 1–7: "How activated do you feel right now?" Plus
a second slider for "How confident do you feel?" Pre-stage or pre-match.

**Inputs.** Nothing. Stored against shooter + match + stage timestamp.

**Output.** Logged. After ~10 stages of data, the dashboard can plot
arousal vs. HF% and show the shooter's IZOF — the arousal range where
they actually perform best. This is the data IZOF *requires* and that
no shooting app currently collects.

**Why.** Personalized arousal feedback beats generic "stay calm" advice.
The slider is cheap; the longitudinal payoff is large.

### 6.5 Pre-match brief, evolved

The existing AI brief is good but it's a one-shot summary. Two
enhancements:

- **Use the shooter's goal list** (§6.1) and prior weaknesses to
  personalize the brief: "Last match you bled 12% on weak-hand sections.
  Stage 3 here is weak-hand only — plan it deliberately."
- **Squad-aware tips**: who else is squadded, where they're squad-order
  relative to you, and whether earlier shooters in your squad tend to
  benefit or suffer from going early (we have shooting-order data and
  the stage-degradation correlation already).

---

## 7. Post-match coaching features

Post-match is the **self-reflection** phase. The app's 9 charts give the
*what*; the missing piece is *so what* and *now what*.

### 7.1 Guided AAR (After-Action Review)

**What.** A 4-prompt structured form, exposed on the match page once
scoring is ≥80%:

1. **What was your intent?** (auto-filled with the goals from §6.1)
2. **What actually happened?** (auto-filled with the chart highlights:
   archetype shift, biggest hit-loss stage, biggest penalty cost,
   div % vs. expectation)
3. **What worked, what didn't?** (free text, with 4–6 chip prompts:
   "first stage," "transitions," "movement," "weak hand," "mindset,"
   "gear")
4. **What changes for next time?** (free text + tag picker: turns into
   a candidate goal for the *next* match's §6.1 wizard)

**Inputs.** Match data (already computed), goals from §6.1, free text.

**Output.** Stored. Renders on the shooter dashboard as a chronological
"learning log" — the longitudinal view that converts isolated match
notes into trajectory. This is the **single highest-leverage coaching
artifact** we don't currently produce.

**Why.** AAR's evidence base in high-stakes, time-pressured environments
is decades old. The fixed structure prevents the rumination that
unstructured "how did I feel about that match" generates; the comparison
to *intent* is what makes it improvement-oriented rather than
score-oriented.

### 7.2 Prioritized "focus areas"

**What.** A new section near the top of the match page (above the charts)
that takes the existing analytics and reduces them to **a ranked list of
3 things to work on**, with confidence.

Mechanic: each "focus area" candidate is generated from a rule:

- *Penalty cost ≥ 10% match-pct loss* → "Mistake reduction"
- *Weak-hand constraint stages average ≥8% below normal stages* → "Weak hand"
- *Course-length-Long stages average ≥10% below Short stages* → "Long stages / endurance"
- *Speed percentile < 30 AND accuracy percentile > 70* → "Tempo / commit"
- *Speed percentile > 70 AND accuracy percentile < 30* → "Sight discipline / call shots"
- *Composure percentile drops vs. shooter's career median by ≥15* → "Match nerves"
- *Stage degradation correlation < −0.3 (declines through the day)* → "Stamina / hydration / focus management"
- *DQs / DNFs / Zeros present* → "Safety / sequence" (highest priority, always)

Each rule has a **sample size guard** (e.g., needs N≥3 stages of that
type) and a **confidence score** (binomial CI). The output is at most
3 items, sorted by estimated match-% recoverable. Each item links to a
short explanation, the underlying chart, and 1–3 drill suggestions
(§7.3).

**Why.** Today the analytics page is a dashboard. A coach reads it and
sums it into 2–3 sentences for the shooter. The shooter without a coach
has to do that synthesis themselves and usually doesn't, because the
charts don't impose a ranking. This feature *is* the synthesis.

This is the single most "coach-replacing" feature we can ship, and it's
deterministic — the AI is not in the loop. AI optionally generates the
prose around the deterministic output (cf. coaching-tip's existing
pattern).

**Implementation note.** The `CompareResponse` shape in `lib/types.ts`
already exposes every input the rules above need: `penaltyStats`,
`constraintPerformance`, `courseLengthPerformance`, `archetypePerformance`,
`stageDegradationData`, `styleFingerprintStats`, `consistencyStats`,
`lossBreakdownStats`. No new API call, no new query — the focus-area
generator is a pure function over the existing `CompareResponse`. It
belongs in a new `lib/coaching-rules.ts` next to `lib/match-ttl.ts` so
the same unit-test pattern applies (input fixtures → expected focus
areas, no I/O).

### 7.3 Drill library

**What.** A curated set of 15–30 drills, each tagged with what skill
they train: `draw`, `transitions`, `reload`, `weak-hand`, `strong-hand`,
`movement`, `entry-exit`, `stage-programming`, `mindset`, `call-shots`.
Drill cards have name, equipment, par time targets per class, video link
(YouTube external), 3-line description.

**Inputs.** Focus areas from §7.2; class / division. Suggested drills
filter to the shooter's focus areas first, then by class-appropriate
par times.

**Output.** Drill detail page. Optional "log this rep" → ties into a
practice-session journal (§7.5).

**Why.** Closes the loop between match analysis and between-match
practice. Drills are well-documented in the public domain — Brian Enos,
Stoeger, Anderson, USPSA classifiers, Pistol-Mastery. We curate, we
don't author. The unique value is that *the app picks the right drills*
based on real match data.

**Risk.** Drill prescription that doesn't actually fit can be net
negative ("training the wrong thing"). Two mitigations: (a) every drill
suggestion is opt-in, presented as "consider," not "do," and (b) the
shooter can mark a drill as "not relevant" so it stops being suggested.

### 7.4 Compare-to-self overlay

**What.** Wherever the match page currently shows "vs field" or "vs
division," add an optional **"vs your last 5 matches at this level"**
overlay. Concretely: ghost lines on the stage-balance radar, a "career
median HF%" reference on the hit-factor chart, and an "is this match
above or below your trend" marker on the dashboard's HF-trend slope.

**Inputs.** Existing aggregates from the shooter dashboard. No new data.

**Why.** Field benchmarking measures *standing*; self benchmarking
measures *progress*. Both matter, and the literature on intrinsic
motivation (task vs. ego orientation) shows self-comparison drives
sustained training behaviour better than peer-comparison alone.

### 7.5 Practice journal

**What.** A lightweight log of between-match practice sessions: date,
duration, drill(s), rep count, notes, perceived effort. No timer
integration in v1 — that's a different product surface.

**Inputs.** Shooter + manual entry. Drill picker pulls from §7.3.

**Output.** On the dashboard, a strip-chart of practice volume per
week, segmented by skill tag, overlaid against match performance.
This is the single best diagnostic for "is my practice actually
improving the things I care about" — a question shooters chronically
guess at.

**Why.** Deliberate-practice tracking with a feedback loop to
competition outcome is the explicit recommendation from the SRL
literature. It also reveals when practice volume is high but
*scattered* — the most common failure mode for self-coached
intermediate shooters.

### 7.6 Coach-shooter view (requires §5 path B)

**What.** A coach can list "my shooters." For each, they get the
shooter dashboard plus a private notes pane and the ability to leave
comments on specific stages of specific matches. Comments appear on
the shooter's match page in a "Coach said" panel.

**Constraints.** Requires identity (path B). The shooter explicitly
opts in to a coach via a one-time pairing token. Either party can
break the link.

**Why.** The unmet need is real (see §2b) and the product moat is
real: no shooting app today combines auto-imported match analytics
with a coach-student channel. But it's a *much* bigger build than
§7.1–7.5; it requires identity, an authorization model, a multi-user
permission story, and a notifications channel. Recommend as v2, after
the self-coach features prove out.

---

## 8. Cross-cutting features

### 8.1 Year-end review / season summary

**What.** A "your year in IPSC" page, generated end-of-season, that
rolls up: matches shot, division splits, archetype evolution
(did the shooter become more accurate or faster over the year?),
best/worst match by match-%, achievements unlocked, focus areas
trending up or down. Optionally shareable as an image.

**Inputs.** All existing data, aggregated by year.

**Why.** Closes the longest feedback loop. Cheap to build on top of
existing aggregates. Strong "what's new" / social-share value.

### 8.2 Achievement gaps as nudges

**What.** Existing achievements show "earned" and "in progress." Add
a tier-aware nudge: "you're 2 matches away from Competitor Silver."
Show 1–3 *near* achievements on the dashboard above the fold. The
data is already there in `shooter_achievements`; this is a UI change.

### 8.3 Anchor stage / "your best ever stage"

**What.** Mental Management's reinforcement phase. After every match,
the dashboard highlights the shooter's single highest-HF% stage of
their entire history (already computable) and frames it as the
**anchor**: "your real ceiling looks like this." Linked to the
visualization timer (§6.3) — the shooter can re-rehearse their own
best stage as a confidence cue before a new match.

### 8.4 Squad / club comparison

**What.** A new "my training partners" group on the shooter dashboard
— the shooter picks 2–5 frequent squadmates and the dashboard shows
their parallel trends side-by-side. Optional, opt-in.

**Why.** Real-world coaching often happens between squadmates more than
between formal coach-student pairs. Surfacing their parallel data
accelerates the "wait, you got 95% on stage 3, how?" conversation that
already happens at the range.

---

## 9. What we should *not* build

A research doc has to be willing to say no. Things that look like
coaching features but probably aren't worth it for this app:

- **Per-shot / split analysis.** We don't have the data. Building
  it would require Mantis/Bluetooth-timer integration on a phone the
  shooter holds, which is a different product. Defer indefinitely.
- **Video analysis.** Same reason. Plus storage and bandwidth costs
  are prohibitive on Cloudflare Pages.
- **Outcome goal tracking.** "Make GM by Christmas." Research is clear
  that outcome goals correlate weakly with performance and strongly
  with anxiety. We can let users write them in free text but we
  shouldn't surface them as a first-class object.
- **Generic motivational content / quotes.** Adds noise. Distracts
  from the data-driven coaching the app uniquely provides.
- **Heart rate / HRV / "readiness" import.** Too far from our domain;
  too much UX cost for marginal gain.

---

## 10. Prioritization

Ranked by `(impact_on_user × likelihood_of_adoption) / build_cost`,
informed by §5 (storage path) and §1 (existing surfaces).

### Tier 1 — ship next (high impact, low cost, no auth required)

1. **§7.2 Prioritized focus areas** — pure synthesis over existing data.
   Deterministic core + optional AI prose. Probably the most
   "is this the same app" change we can ship in a single PR.
2. **§7.4 Compare-to-self overlay** — additive to existing charts.
   No new data. High signal-to-noise.
3. **§8.2 Achievement nudges** — pure UI on existing data.
4. **§8.3 Anchor stage card** — pure UI on existing data.
5. **§6.5 Brief evolution** — extend existing AI brief with goals +
   prior weaknesses. Needs §6.1 to be most valuable.

### Tier 2 — needs localStorage / path A (no auth, but new state)

Path A's foundation (`lib/shooter-identity.ts`) is already in place, so
the cost of "new state" is much lower than it would be in a greenfield
project. Each artifact below is roughly a `lib/<artifact>-storage.ts`
module modelled on the existing identity module + a React hook.

6. **§6.1 Goal-setting wizard** + **§7.1 Guided AAR** — together they
   form the SRL forethought→reflection loop. Build them together
   or neither works.
7. **§6.2 Stage plan workspace** — most-asked-for from shooters in
   adjacent products; cheap if scoped to free-text + checklist.
8. **§6.4 Arousal check-in** — one slider, large longitudinal payoff
   once N is high.
9. **§6.3 Visualization timer** — small, well-bounded, evidence-backed.
10. **§7.5 Practice journal** — useful with §7.3 below; either is
    weak without the other.

### Tier 3 — needs storage + drill content (path A is OK; coach view needs path B)

11. **§7.3 Drill library** — moderate content-curation cost. High
    payoff once §7.2 is shipping.
12. **§8.1 Year-end review** — annual cadence; ship in November.
13. **§8.4 Squad / club comparison** — opt-in; small scope.

### Tier 4 — requires identity (path B)

14. **§7.6 Coach-shooter view** — biggest feature, biggest unlock for
    the "coach" half of the audience. Designed last in this doc
    because it builds on everything above.

---

## 11. Open questions for the next session

- Do we want to commit to identity (path B) or keep the self-coach
  features local-only for now? This decision gates §7.6 and shapes
  the §6.1/§7.1 schema.
- Tier 1's focus-area generator — should the rules live in
  `lib/coaching-rules.ts` as pure deterministic logic (so we can
  unit-test like `lib/match-ttl.ts`) and let AI only narrate? My
  strong recommendation is yes; the same split keeps `lib/compare/logic.ts`
  fully testable.
- Drill library content: do we license / partner (e.g., Stoeger,
  Anderson, Pistol-Mastery) or curate from public-domain USPSA
  classifiers + our own descriptions?
- Does any of this conflict with the planned MCP surface? The MCP
  tools (`get_shooter_dashboard`, `compare_competitors`) could trivially
  be extended with a `get_focus_areas` once §7.2 ships — worth
  considering when designing the rule output shape.

---

## 12. References

Selected sources, grouped by theme.

**Self-regulated learning & deliberate practice**
- [Self-regulation of sport practice, Frontiers 2023](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1089110/full)
- [Bartulovic et al., "Can athletes' reports of SRL distinguish deliberate practice…", J Sports Sci 2018](https://pubmed.ncbi.nlm.nih.gov/29569522/)
- [Modes of self-reflection in physical education instruction, Frontiers 2025](https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2025.1645817/full)

**Imagery / visualization**
- [Effects of Imagery Practice on Athletes' Performance — multilevel meta-analysis, PMC 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12109254/)
- [Benefits of guided imagery on athletic performance — mixed methods, PMC 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12021890/)
- [Visualisation techniques in sport — the mental road map for success, ResearchGate](https://www.researchgate.net/publication/344587632_Visualisation_techniques_in_sport_-_the_mental_road_map_for_success)

**Quiet eye**
- [Quiet eye, Wikipedia overview](https://en.wikipedia.org/wiki/Quiet_eye)
- [Quiet Eye and computerized precision tasks in FPS esports, Frontiers 2021](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.676591/full)
- [Quiet eye training improves accuracy in basketball field goal shooting, ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0079612317300730)

**Arousal / IZOF**
- [Hanin's IZOF model, Sportlyzer Academy](https://academy.sportlyzer.com/wiki/arousal-and-performance/individual-zones-of-optimal-functioning-izof/)
- [Does the IZOF model discriminate between successful and less successful performances?, PubMed](https://pubmed.ncbi.nlm.nih.gov/10585167/)
- [IZOF historical overview 1978–2014, ResearchGate](https://www.researchgate.net/publication/276831504_The_individual_zones_of_optimal_functioning_IZOF_model_1978-2014_Historical_overview_of_its_development_and_use)

**Mental Management**
- [Lanny Bassham, *With Winning in Mind*, 3rd ed.](https://www.amazon.com/Winning-Mind-3rd-Ed/dp/1934324264)
- [7 Mental Management principles, Lucas Ballasy summary](https://www.lucasballasy.com/posts/blt-no-134-7-mental-management-principles-from-with-winning-in-mind-by-lanny-bassham)
- [Ben Stoeger, *Match Mentality*](https://www.skyhorsepublishing.com/9781510779426/match-mentality/)
- [Steve Anderson, Mental Management certified instructor — Anderson Shooting](https://www.andersonshooting.com/)

**After-Action Review**
- [Wikipedia: After-action review](https://en.wikipedia.org/wiki/After-action_review)
- [How to Conduct an AAR, Policing Institute / COPS](https://www.policinginstitute.org/wp-content/uploads/2020/02/How-to-Conduct-an-AAR.pdf)
- [Asana AAR template & 4-phase process](https://asana.com/resources/after-action-review-template)

**IPSC scoring / hit factor**
- [Hit Factor scoring guide, ShootNTrain](https://shootntrain.com/ipsc-scoring-and-hit-factor-explained-a-comprehensive-guide/)
- [Travis Tomasie — Hit Factors and USPSA/IPSC scoring](http://www.travistomasie.com/hit-factors-and-uspsa-ipsc-scoring.html)
- [Austin Practical Shooting Club — match results tutorial](https://austinpracticalshooting.com/match-results-tutorial/)

**USPSA classifiers & drills**
- [USPSA classifier index](https://uspsa.org/classifiers/)
- [Pistol Mastery — classifier analysis 20-01](https://pistolmastery.com/blog/classifier-analysis-20-01)
- [KR Training — IPSC training tips](https://www.krtraining.com/IPSC/Information/Training.html)
- [Top 3 performance pistol shooting drills, Tier Three Tactical](https://www.tierthreetactical.com/top-3-performance-pistol-shooting-drills-free-pdf/)

**Prior-art apps**
- [hitfactor.app — Tools for USPSA, IPSC, and Steel Challenge shooters](https://hitfactor.app/)
- [Shotlog — Professional shooting journal](https://shotlog.app/)
- [Hit Factor Genie](https://hit-factor-genie.netlify.app/)
- [PractiScore Competitor on the App Store](https://apps.apple.com/us/app/practiscore-competitor/id1191380081)
- [Shooting Diary for Coach, Google Play](https://play.google.com/store/apps/details?id=com.shooting.shootingcoach)
- [Brass App](https://brassapp.io/)
- [LaserHIT mobile app](https://www.laserhit.com/laserhit-mobile-app)
- [MantisX](https://mantisx.com/)
