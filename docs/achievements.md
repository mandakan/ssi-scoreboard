# Achievement System

The shooter dashboard shows tiered achievements that track cross-match progress. Each
achievement has a progressive unlock ladder -- multiple tiers from beginner milestones to
elite goals. Unlocked tiers are persisted in AppDatabase (`shooter_achievements` table)
so they survive the 200-match pruning window.

## Achievement categories (10 achievements, 35 tiers)

- **Milestone:** Competitor (1-100 L2+ matches), Stage Warrior (10-500 L2+ stages), Championship (1-5 L4+ matches), World Shoot (1 Level V match), DQ Club (1 DQ)
- **Accuracy:** Sharpshooter (60-85% A-zone), Bullseye (1-25 perfect stages), Clean Sheet (1-10 clean matches)
- **Variety:** Globe Trotter (2-5 countries), Versatile (2-5 divisions)

**Evaluation flow:** on each dashboard load (cache miss), `evaluateAchievements()` compares
computed stats against tier thresholds, diffs against stored tiers, and persists new unlocks
(fire-and-forget). The function is pure (no I/O) and fully unit-tested.

**Adding a new achievement:** add one `AchievementEntry` object to `ACHIEVEMENT_ENTRIES` in
`lib/achievements/definitions.ts` (id, name, description, category, icon, tiers, evaluator).
No schema changes or migrations needed -- the composite PK `(shooter_id, achievement_id, tier)`
handles new achievements and tiers automatically.

## Key files

- `lib/achievements/definitions.ts` -- define achievements here
- `lib/achievements/evaluate.ts` -- pure evaluation logic
- `lib/achievements/types.ts` -- interfaces
- `app/api/shooter/[shooterId]/route.ts` -- calls evaluator, persists unlocks
- `app/shooter/[shooterId]/shooter-dashboard-client.tsx` -- `AchievementsSection` UI
- `tests/unit/achievements.test.ts` -- unit tests
