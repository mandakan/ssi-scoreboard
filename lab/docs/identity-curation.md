# Identity Curation Guide

## The problem in plain language

The system draws competition results from two sources:

- **SSI Scoreboard** — Swedish L2+ Regional matches. Every competitor has a stable numeric ID, so the same person is always the same record no matter how their name is spelled.
- **ipscresults.org** — International L3–L5 National, Continental, and World matches. There are no global IDs here — competitors are identified by name and region only.

To compute ratings that span both sources (e.g. a Swedish Open shooter who competes at Nationals AND at the World Shoot), the system must figure out that *"Martin Hollertz (SWE)"* in ipscresults and *shooter_id=1234* in SSI are the same person. This is called **identity resolution**.

For most people it works automatically. For some it doesn't — and those errors must be found and corrected before they affect the ratings.

---

## How automatic matching works

After syncing both sources, `rating link` runs three matching strategies in order:

1. **Exact match** — the normalised name and region match perfectly after stripping diacritics and fixing common formatting (e.g. `"Hollertz, Martin"` → `"martin hollertz"`). Confidence: 1.00.

2. **Alias match** — the competitor's `Alias` field (a short handle set in ipscresults) matches the SSI `icsAlias` for a known shooter. Confidence: 0.95.

3. **Fuzzy match** — the name is compared against all SSI competitors in the same region using character-level similarity. A match is accepted only if the overall similarity is ≥ 0.85 AND both the given name and family name individually score > 0.75. Confidence: 0.85–0.99.

If none of these match, the person is treated as a new identity (ipscresults-only).

**What fuzzy matching catches:** diacritics (`Saša` ↔ `Sasa`), middle-name differences (`Anna Karin Lindqvist` ↔ `Anna Lindqvist`), minor OCR artefacts.

**What fuzzy matching cannot catch:** last-name changes after marriage or divorce (e.g. `Marianne Schön` ↔ `Marianne Hansen`), completely different name romanisations, and nicknames that bear no resemblance to the legal name.

---

## The confidence score

Every fuzzy match is stored with a **confidence score** between 0.85 and 1.00:

| Score | What it means |
|-------|--------------|
| 1.00 | Exact name match after normalisation — essentially certain |
| 0.95–0.99 | Very likely correct — small diacritic or spacing difference |
| 0.90–0.94 | Probably correct — a middle name or one token differs noticeably |
| < 0.90 | Needs careful review — names differ by more than a diacritic |

Low-confidence matches involving **top-ranked competitors** are the most important to review — a wrong link merges two people's results, distorting both of their ratings.

---

## Using the Identity tab

Open the explorer (`rating serve`, then visit `http://localhost:8000`) and click the **Identity** tab.

### What you see

Each row is one fuzzy match between an **ipscresults name** (left) and the **SSI record** it was linked to (right), along with:

- **Conf** — the confidence score (red = below 0.90, amber = 0.90–0.94, grey = 0.95+)
- **Region** — the country/region code
- **Div rank** — this person's best division ranking (red = top 10, amber = top 20) — high-ranked people with uncertain links are the highest priority
- **IPR exposure** — how many ipscresults matches contributed to their rating, and when the most recent one was. A person with 1 old ipscresults match and 40 SSI matches is low risk even if the link is uncertain.
- **Review** — Approve or Reject buttons

By default only **unreviewed** links are shown. Uncheck "Unreviewed only" to see all.

### Deciding whether to approve or reject

Ask yourself: **are these the same real-world person?**

To help decide, you can check:
- Do they compete in the same division?
- Are the regions consistent?
- Is the date range plausible? (Did the ipscresults matches happen when the SSI shooter was active?)
- Are there any known name changes (marriage, divorce) for this person?

If yes → **Approve**. The link is correct; the system records your decision.

If no → **Reject**. The system immediately splits them into two separate identities and creates a permanent manual record so they are never re-merged automatically.

If you are unsure → leave it unreviewed and come back later. Unreviewed links are not wrong — they are simply unconfirmed.

### Priority order for review

Work top-to-bottom through:
1. **High-impact + low confidence** — use the "High-impact only" checkbox together with confidence filter "Below 0.90". These are the rows where an error would most skew team selection results.
2. **Any confidence below 0.90** — even for lower-ranked shooters.
3. **Everything else** — medium-confidence links are usually correct; approve in bulk if the names look right.

### After reviewing

The explorer updates immediately — approved rows turn green, rejected rows fade out.

To apply rejected links to the actual ratings, re-run:

```bash
uv run rating link     # re-resolves identities (rejected links stay as manual overrides)
uv run rating train    # recomputes ratings with corrected identities
uv run rating export   # rebuilds the explorer with the updated data
```

You do not need to do this after every individual click — batch your reviews, then run the pipeline once when you're done.

---

## Manual corrections beyond the UI

The UI handles approve/reject for fuzzy-matched links. For cases the fuzzy matcher cannot catch at all (name changes, aliases), use the CLI:

```bash
# Link two records that the fuzzy matcher did not connect automatically.
# --canonical-id: the SSI shooter_id of the correct person
# --source-key:   the ipscresults fingerprint "normalised name|REGION"
uv run rating link-shooter \
  --canonical-id 1679 \
  --source ipscresults \
  --source-key "marianne hansen|NOR" \
  --name-variant "Marianne Hansen"
```

This creates a `method='manual'` link that is **never** overwritten by automatic re-resolution. Use `rating link` + `rating train` afterwards to apply it.

---

## Frequently asked questions

**Does rejecting a link delete any match results?**
No. Match results are always stored. Rejection only means the ipscresults records will no longer contribute to the SSI shooter's rating — they become a separate (unnamed) identity instead.

**What if I approve a link by mistake?**
Run `uv run rating link-shooter` with the correct `--canonical-id` to create a manual override that supersedes the approval. Or reject it via the UI if a reject button is still visible.

**How often should I run the curation workflow?**
After each major `sync-ipscresults` run that pulls in new international matches. New competitors may trigger new fuzzy links. The progress bar at the top of the Identity tab shows how many links are still unreviewed.

**Do approvals survive a full re-link?**
Yes. Approvals are stored in a separate `identity_reviews` table that is never dropped. Approved links get their reviewed status restored automatically after `rating link` recreates the fuzzy match.

Rejected links persist as `method='manual'` in `shooter_identity_links`, which `rating link` always preserves.
