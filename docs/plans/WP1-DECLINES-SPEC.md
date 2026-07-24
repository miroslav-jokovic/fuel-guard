# WP1 — Declines Pipeline Hardening: Audit & Spec

**Status:** awaiting approval · **Date:** 2026-07-24
**Goal:** every EFS decline is classified correctly, attributed to a vehicle/driver, cross-checked against telematics, and scored so that a proximity-validation failure can never again score "Clear." No assumptions; every claim below was verified against code or real EFS files.

---

## Part 1 — Audit results (verified)

### F1 · CONFIRMED — Proximity decline reasons score zero
`packages/shared/src/declined.ts:47-50` — `isRestrictedDeclineReason` matches
`/site|location|geofence|product|restrict|not allowed|unauthor|outside|limit exceed/`.

Verified against the real reject file `data-samples/RejectTransactionReport-260707092249.xlsx`:

| Error Code | Error Description (verbatim) | Current classification |
|---|---|---|
| 1 | `INVALID TRUCKSTOP IN53790\|Failed restrictions\|` | matches "restrict" → weight 30 (clear alone) ✓ reasonable |
| 1 | `INVALID TRUCKSTOP …\|Merchant Position Too Far\|` (the 0851226257 case) | **matches nothing → weight 0 → Clear** ✗ |
| 3 | `INACTIVE CARD …\|Non-Active Card\|` | matches nothing → 0 (acceptable, but should be a named category) |
| 17 | `INVALID INFORMATION\|ODOMETER\|8757…` | matches nothing → 0 (pump-prompt error, data-quality) |

**Key nuance the original audit doc missed:** `INVALID TRUCKSTOP` appears in BOTH benign
network restrictions (`|Failed restrictions|`) and proximity fraud (`|Merchant Position Too Far|`).
Treating "invalid truckstop" itself as alert-level (audit doc Rec. #1) would false-alarm on every
out-of-network attempt. **The qualifier decides, not the header.**

### F2 · CONFIRMED — Declines never attributed → location check is dead code
- Schema has had `declined_transactions.vehicle_id` and `driver_id` since migration `0007_imports.sql:76-78`.
- `apps/api/src/services/efsIngest.ts` `ingestReject()` (lines 408-425): the insert sets **neither**.
- `apps/api/src/services/declinedScoring.ts:54`: the entire Samsara location check is gated on `if (d.vehicle_id)` → never runs for imported declines.
- The data to attribute is present in every reject row: `Unit` (e.g. 667), `Driver ID` (e.g. 1995), `Driver Name`.

### F3 · CORRECTED — The standard reject export has NO "Truck" column
The audit doc (Bug A) claimed the raw EFS file carries a card-assigned **Truck** column we drop.
**Verified false for the standard export**: `RejectTransactionReport-260707092249.xlsx` has exactly 15
columns — Date, Time, Card Number, Invoice, Location ID, Location Name, Location City, State/Prov,
Error Code, Error Description, Unit, Driver ID, Driver Name, Policy, Policy Name. No Truck, no
proximity miles, no truck-location-time. Those values (572 / 644.26 mi / 15:33) live in EFS's **alert**
(portal/email), not in this report.

**Consequence:** the fix cannot depend on parsing a Truck column. The card→truck ground truth must be
built on our side (`fuel_cards`, F4) — with tolerant, optional parsing of Truck/proximity columns in
case some EFS export variant or the alert-email path carries them later.

### F4 · CONFIRMED — `fuel_cards` exists and is completely unused
Table created in `0007_imports.sql:13-28` with `card_ref → vehicle_id, driver_id` and full RLS.
Repo-wide grep: only migrations reference it. Nothing writes, nothing reads.

### F5 · NEW FINDING — Card-identity matching between declines and approvals is fragile
- Reject report carries the **full 19-digit PAN** (`7083050030485867142`).
- Transaction exports sometimes carry the full PAN (verified in `transexport-1.xlsx`) but per migration
  `0075_driver_control_id.sql`, EFS has also shipped exports masked to the **last 4** — which is why
  `control_id` was added.
- `declinedScoring.ts` matches `fuel_transactions.card_ref` with `.eq(..., d.card_ref)` (exact string).
  Full-PAN decline vs masked-last-4 fill → **`approved_elsewhere` and the corrective-fill exoneration
  both silently never match.**

### F6 · NEW FINDING — Stable cross-report driver key exists and is unused; trailer number too
`transexport-1.xlsx` (52-column variant) carries `DriverId` (numeric, e.g. 1981) that matches the
reject report's `Driver ID` (e.g. 1995) — a stable EFS driver identity across both report types.
Today declines store it as `driver_ext_id` and never resolve it. The same export also carries
`TrailerNumber` (pump-keyed trailer!) — not needed for WP1, but it is ground truth for WP8
(reefer pairing history). The faithful store (`efs_transactions`) does not capture `DriverId`,
`TrailerNumber`, `Hubometer`, `Trip`, or `SubFleet` from this variant.

---

## Part 2 — Design

### D1. Decline-reason taxonomy (new shared module `declineReason.ts`)
Replace the single regex with a classified taxonomy. Pure, exhaustively tested against every
real phrase observed. **Unknown reasons are never silently benign** — they get
`category: "unknown"` and are surfaced (D6).

| Category | Match (case-insensitive, on code+description) | Weight | Rationale |
|---|---|---|---|
| `proximity_failure` | `position too far`, `failed proximity`, `proximity validation`, `merchant position` | **85** | EFS's telematics geofence says the card is not with its truck — alert-level alone (OVERWHELMING=75). This flips the 0851226257 case Clear→Alert. |
| `site_restriction` | `failed restrictions`, `invalid truckstop` (without a proximity qualifier), `site`, `location`, `geofence`, `not allowed`, `unauthor`, `outside`, `product` | 30 | Preserves current behavior for genuine restrictions; benign out-of-network attempts stay sub-review alone. |
| `limit` | `limit exceed` | 30 | unchanged |
| `card_not_active` | `inactive card`, `non-active card`, `expired` | 10 | Named + visible; repeated retries still escalate via `repeated_declines`. |
| `invalid_info` | `invalid information` + prompt names (`odometer`, `driver id`, `trip`, `pin`) | 0 | Pump-prompt typo — data-quality, not theft. |
| `unknown` | anything else | 0 | Stored + counted; reviewed periodically (D6). |

Ordering: proximity is checked **first** (an `INVALID TRUCKSTOP … Merchant Position Too Far` row must
classify as proximity, not restriction). `isRestrictedDeclineReason` stays as a thin wrapper for
back-compat; scoring switches to the taxonomy.

### D2. Attribute declines at ingest (revives the dead location check)
In `normalizeRejectRows`/`ingestReject`:
- `vehicle_id` ← `unitMatchKeys(unit)` against `vehicles.unit_number` (same matcher, same
  ambiguity rule as fuel lines: collision → null, never guess).
- `driver_id` ← `drivers.efs_driver_id` (new learned mapping, D5) → else `driverMatchKey(driver_name)`.
- Backfill: one-off admin job re-attributes ALL existing declined rows with the same matcher
  (SQL-only backfill rejected — it can't reproduce `unitMatchKeys` semantics).
- `scoreDeclinedAttempt` then runs its existing Samsara reconciliation unchanged — Bug C closes with
  zero new scoring logic.

### D3. Optional capture of EFS alert fields (tolerant, no dependency)
Add optional picks — `Truck`/`Tractor`/`Vehicle`/`Truck Number`, `Proximity`/`Distance`/`Miles`,
`Truck Location Time`/`Truck Position Time` — into new nullable columns
`card_assigned_unit`, `efs_proximity_miles`, `efs_truck_position_at`. Nothing depends on their
presence (F3). If a variant carries them, we keep them faithfully and show them on the Rejections page.

### D4. `fuel_cards` population + card/truck-mismatch signal
- **Learner** (nightly + post-import): per card identity over a trailing 60-day window of
  `fuel_transactions`, if ≥5 fills and ≥70% land on one vehicle → upsert
  `fuel_cards.vehicle_id` with `source='learned'`. Manual rows (`source='manual'`) are never
  overwritten. Ambiguous → leave unassigned (match-don't-guess).
- **Card identity key**: full PAN when ≥8 digits, else `last4 + control_id` (handles F5 masking).
- **New decline signal** `card_assigned_mismatch` (weight 75): the pump-entered unit resolves to a
  vehicle ≠ the card's assigned vehicle. With telematics: if the assigned truck **was** at the
  station → downgrade to `stale_card_assignment` (weight 0, exonerating, actionable message
  "reassign card"); if **neither** truck was there → the signal stands and combines with
  `proximity_failure`/`location_mismatch` → alert. This is the audit doc's stale-vs-fraud decision
  tree, automated.
- Approved-side rule ("card used on a truck it isn't assigned to" for successful fills) is
  deliberately deferred to WP3 so WP1 stays shippable; `fuel_cards` built here is its foundation.

### D5. Cross-report identity hardening (F5/F6)
- `drivers.efs_driver_id` (nullable, unique per org): learned from transaction reports
  (`DriverId` ↔ matched driver), then used for decline attribution and as the fallback
  match key for `approved_elsewhere`/corrective-fill.
- Card matching in `declinedScoring.ts` switches from exact `card_ref` equality to the
  normalized card key (full-PAN OR last4) with `efs_driver_id` fallback.
- Faithful store: add `driver_ext_id`, `trailer_number`, `hubometer`, `trip`, `subfleet` columns to
  `efs_transactions` capture (faithful-store completeness; `trailer_number` feeds WP8).

### D6. Observability — unknown reasons can't hide
- Store `reason_category` on every scored decline.
- Digest + detection-coverage surface counts per category, with `unknown > 0` highlighted.
- Test asserts a never-seen phrasing lands in `unknown` and is counted — not dropped, not benign-by-default.

### D7. Re-score history
After deploy: backfill attribution (D2) → `scoreDeclinedOrg` per org → verify in the UI that
historical proximity declines (incl. invoice 0851226257 if still in DB) now read **Alert** with the
named reason.

---

## Part 3 — Test plan (all must pass before "done")

1. **Classifier**: every verbatim phrase from the real sample + the audit case + mixed-qualifier
   `INVALID TRUCKSTOP` rows (proximity beats restriction); unknown phrasing → `unknown`.
2. **Golden file test**: run `RejectTransactionReport-260707092249.xlsx` through
   `normalizeRejectRows` + scoring: 2 site-restriction rows (clear), 2 inactive-card (clear,
   categorized), odometer invalid-info (clear, categorized) — plus a synthetic
   `Merchant Position Too Far` row → **alert**.
3. **Attribution**: unit `667`/`0667`/`Unit 667` all resolve; ambiguous unit → null; DriverId
   resolution; backfill idempotency.
4. **fuel_cards learner**: hysteresis (4 fills → no assignment), 70% share boundary, manual-wins,
   masked-card identity, reassignment after a real card move (window slides).
5. **card_assigned_mismatch**: mismatch+truck-elsewhere → fires; assigned-truck-present →
   `stale_card_assignment` downgrade; no assignment → silent.
6. **F5 regression**: full-PAN decline matches last-4 fill in `approved_elsewhere` and
   corrective-fill exoneration.
7. **Idempotency**: re-ingesting the same reject file is a no-op (external_ref semantics unchanged).
8. Full existing suite green; no change to fuel-transaction scoring behavior.

## Part 4 — Migration
`0079_decline_hardening.sql`: `declined_transactions` + `reason_category`, `card_assigned_unit`,
`efs_proximity_miles`, `efs_truck_position_at`; `drivers` + `efs_driver_id` (unique per org, nullable);
`efs_transactions` + `driver_ext_id`, `trailer_number`, `hubometer`, `trip`, `subfleet`;
indexes for the card-key lookups. All additive — zero downtime, no backfill required for correctness
(backfill job is additive re-attribution).

## Part 5 — Decisions needed from you
1. **Proximity weight 85** (auto-alert alone) — confirm.
2. **fuel_cards learner defaults**: 60-day window, ≥5 fills, ≥70% share — confirm or adjust.
3. **Cards UI**: expose learned assignments on a Cards/settings page now, or defer UI to a later WP
   (recommend: minimal read-only list now on Rejections/Settings, full management UI later)?
4. **EFS alert-email parsing** (the path that actually carries 644.26 mi): defer (recommended) or
   include in WP1?
