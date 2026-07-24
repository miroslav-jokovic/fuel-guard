# WP3 — Card & Attribution Integrity: Decisions + Implementation Record

**Status:** implemented · **Date:** 2026-07-24 · **Predecessors:** WP1 (declines), WP2 (correlation)

## Problem 1 — card_multi_vehicle conflated DRIVER identity with CARD identity

The rule's window count was keyed on the EFS Control ID — a **driver** identity — so a slip-seat
driver legitimately fueling two trucks raised a "card misuse" review, while a real card's cross-report
identity (full PAN on one export, masked last-4 on another) was never matched.

**Fix.** The count is now a true CARD count everywhere: candidate fills are matched with
`sameCardFill` — digit-tolerant ref matching (full PAN ↔ its own last-4) with control-id
disambiguation (same last-4 + different control ids = two different drivers' cards, never merged).
A bare last-4 with no control id stays uncounted — surfaced as blindness (Problem 3), never guessed.
The identical identity test now backs all three consumers: the scorer's count
(`scoring/cardContext.ts`), the Samsara auto-clear (`cardMultiReconcile`), and decline matching (WP1).

**New trigger — off-assignment use.** With `fuel_cards` populated (WP1), the rule also fires on a
SINGLE fill whose truck differs from the card's assigned truck ("card assigned to X fueled Y") —
the audit's "card used on the wrong truck" alert, now on approvals too. Cards with **no** assignment
(floating/slip-seat/insufficient history) keep only the classic ≥2-vehicles trigger, and Samsara's
driver-assignment reconcile continues to auto-clear one-driver-moved-trucks cases. Weight stays 60
(review alone); catalog note documents the redefinition.

Known bounded FP: a card **permanently moved** to a new truck fires review-level until the 60-day
learner re-learns the assignment (≤ a few weeks of fills). Accepted: review, not alert, and the
learner self-heals; a manual assignment fixes it instantly.

## Problem 2 — chronic unattribution had no escalation

Unattributed fills are correctly not anomalies — but they also disable every vehicle-keyed rule, so
clusters of them are exactly where misuse hides. New `computeAttributionHealth` (shared, pure):
groups the window's unattributed fills by card identity; **≥3 on one card escalates** into the weekly
digest ("Chronic unattribution: •••• 7521 × 4 — fix the unit/driver mapping"), masked labels only.

## Problem 3 — masked-card blindness was invisible

`detectionCoverage` now counts card-identity coverage: of fills carrying a card, how many are
UNIDENTIFIABLE (bare masked last-4, no control id) — those are invisible to every card rule. Surfaced
as a fifth stat tile on the Coverage page ("Card identity … N unidentifiable").

## Structural

- `rules.ts` split: Tier-4 behavioral + reefer rule bodies moved to `rulesBehavioral.ts` (same
  private-rule contract; `runAllRules` unchanged) — keeps the engine under the 500-line budget with
  headroom for WP4–7.
- `scoreTransaction.ts` card block extracted to `scoring/cardContext.ts` — clears that file's
  **pre-existing** budget violation (511 → under 500). Remaining debt: `routes/fueling.ts` (546),
  untouched smart-fueling domain.
- `lookupCardAssignment` centralized in `cardAssignments.ts` (was inlined in declinedScoring).

## Verification

773 shared / 132 api / 19 web tests (13 new: assignment-aware rule variants, sameCardFill matrix,
attribution clustering, card-blindness coverage; cardMultiReconcile fixture upgraded to realistic
PAN + identity columns). Workspace typecheck clean, eslint 0 errors, boundaries clean, generated
catalog byte-identical.

## Deploy

No migration. Deploy API + web (after WP1's 0079 and WP2's 0080 are applied). Run a Rebuild +
Rescore so historical card counts re-key onto true card identity.
