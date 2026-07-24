# WP5 — Volume/Capacity Hardening: Decisions + Implementation Record

**Status:** implemented · **Date:** 2026-07-24 · **Predecessors:** WP1–WP4

## 1. A dead capacity rule is now visible (tank_capacity_gal unset/0)

`exceeds_tank_capacity` is weight-85 — an alert **on its own** — yet for any fuel vehicle with no
capacity entered it was silently dead (`cap > 0` guard) and nothing anywhere said so: "no alerts"
read as "nothing wrong." New `computeCapacityHealth` (shared, pure) surfaces the gap in two places:

- **Coverage page** — "Tank capacity set" tile: % of active fuel trucks with a usable capacity, plus
  the missing unit numbers ("capacity rules dead" is stated in those words).
- **Weekly digest** — a warning line naming the trucks: "No tank capacity set on trucks 099, 102 —
  the over-capacity and tank-space checks are OFF for them until it's entered."

Retired and non-fuel vehicles are excluded; an empty fleet reads 100% (no false alarm on a new org).

## 2. Learned-capacity poisoning hardened (corroboration 2 → 3, ceiling 2.2× → 2.1×)

`learnObservedMaxFill` raises the effective capacity from observed fills — and because it SUPPRESSES
the capacity rules, it must be hard to poison. Before, **two** matching over-size fills within the
30-fill window became the learned capacity: a thief repeating a same-size overfill twice could teach
the system that's the tank. Now:

- **Corroboration floor 3** (was 2): the value must be reached by ≥3 fills in the window. A repeated
  same-size theft has to recur three times before it could start masking itself — and the first two
  occurrences fire the capacity rules at full strength.
- **Physical ceiling 2.1× nameplate** (was 2.2×): a dual saddle-tank's true combined capacity is at
  most ~2× one entered tank; 2.1 leaves ~5% meter margin and cuts the learnable headroom above the
  true combined volume roughly in half.

Direction of change is the SAFE one: learning is stricter → effective capacity stays lower longer →
capacity rules fire MORE, never less. Tests updated to assert the new floors explicitly (two matching
240s no longer raise; three do; a triple 800-gal outlier is rejected by the nameplate ceiling).

## 3. Detection floors documented as product facts (catalog = source of truth)

Two deliberate precision-first floors are now stated in `catalog.yaml` notes so nobody re-discovers
them as "bugs" — and so customer-facing claims can be accurate:

- **cumulative_overfuel**: the window ceiling grants one full empty-to-full tank + 10 gal of slack —
  sustained theft under ~one tank per 48h is invisible to THIS rule by design; the per-fill tank rules
  and tank_fill_short carry that range where sensors allow.
- **tank_fill_short**: tolerance is max(15 gal, 30% of billed) — on a 100-gal bill a ~29-gal skim sits
  inside sensor noise and cannot fire. This is the sensor-bound sensitivity floor; revisit against
  WP9 disposition data before tightening, not before.

No threshold changes here — tightening without ground-truth calibration would trade unknown precision
for unknown recall; WP9's calibration report is the gate for that.

## Verification

792 shared / 132 api / 19 web tests (8 new/updated: capacity-health matrix, hardened learner floors
incl. the two-matching-thefts poisoning case now failing to poison). Typecheck clean, eslint 0 errors,
boundaries clean, generated catalog byte-identical. Remaining pre-existing debt: `routes/fueling.ts` (546).

## Deploy

No migration. Deploy API + web. After deploy, some trucks' learned capacity may re-learn slightly
LOWER on the next nightly learn pass (stricter floors) — expected, and the safe direction; any new
`exceeds_tank_capacity` alerts that appear are fills the looser floor had been absorbing.
