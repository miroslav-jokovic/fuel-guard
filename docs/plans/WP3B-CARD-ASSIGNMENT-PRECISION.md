# WP3b — Card-Assignment Precision Hotfix (169 false alarms)

**Status:** implemented · **Date:** 2026-07-24 · **Trigger:** 169 false "card assigned to a different
truck" reviews after the WP1–WP6 deploy + Rebuild.

## Root cause (confirmed)

WP3's off-assignment trigger judged every fill against the card's **current** `fuel_cards` assignment,
which is learned from the **last 60 days** of fills. A Rebuild re-scores months of history — so:

1. **Era changes**: any card that moved trucks flagged its entire previous era ("fueled wrong truck").
2. **Slip-seat secondaries**: a card with an 80/20 truck split (≥70% dominance → assignment learned)
   flagged every legitimate secondary-truck fill.

Both are the same time-blindness class as the reefer-pairing issue queued for WP8. The WP3 spec had
flagged the era-change FP as "bounded"; 169 alarms proved that judgment wrong — logged here as the
correction.

## Fix (three principles)

1. **As-of-fill-time learning.** The learned assignment is now computed per scored fill — the dominant
   vehicle (≥5 attributed fills, ≥70% share) over the **60 days before that fill**, excluding the fill
   itself (a fill never votes for its own legitimacy). A rebuild judges each fill against the
   assignment that was true THEN. (`dominantVehicle` in shared; `resolveCardContext` feeds it from one
   bounded indexed query — new index in migration 0082.)
2. **Statistical inference never alarms alone.** A learned-assignment mismatch is **evidence-only**:
   it enriches the message/evidence of the classic ≥2-trucks-in-window split-use signal but can never
   fire by itself. Era changes and slip-seat secondaries are structurally incapable of raising a case.
3. **Human ground truth still alarms.** A **manual** `fuel_cards` assignment (assignment_source =
   'manual') fires review-grade on a single mismatched fill — but only for fills within the last 60
   days, since we don't know when the human declaration became true (applying it deep into history
   would recreate the same bug).

Decline-side logic is unchanged and was already safe: its strong (75) verdict requires POSITIVE
telematics evidence that both trucks were elsewhere at the decline instant; the unverified variant is
corroboration-only (45).

## Clearing the 169

After deploying + running **Rebuild (rules-only)**: `reconcileAnomalies` supersedes open rules-source
cases whose signals no longer fire — the false reviews clear themselves; no manual dismissal needed.
Cases a reviewer already moved to investigating/resolved/dismissed are never touched.

## Verification

804 shared / 132 api / 19 web tests. The regression suite includes a test named for the incident
("THE 169 CLASS") asserting a learned-mismatch-alone fill can never fire, plus manual-fires /
manual-matches-silent / split-use-enrichment / no-assignment-silent / unattributed-silent, and the
`dominantVehicle` evidence-bar matrix. Typecheck clean, eslint 0 errors, catalog byte-identical.

## Deploy

1. `supabase/_deploy/apply_0082.sql` (index only, additive).
2. Deploy API.
3. Run **Rebuild** — the 169 false reviews supersede automatically.
