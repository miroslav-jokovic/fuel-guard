# FleetGuard — Samsara × EFS Odometer Reconciliation (corrected design)

> Supersedes the cross-source design in `09-DETECTION-REVIEW.md §2`. There is **no driver app**.
> The ±5-mile odometer check compares the **EFS pump odometer** (driver-entered at fueling) against
> the **Samsara telematics odometer at the fueling timestamp** (the independent truth).

---

## 1. What changed

| | Before (wrong) | Now (corrected) |
|---|---|---|
| Reference for "correct odometer" | a second human entry in a FleetGuard app | **Samsara GPS/OBD odometer** (telematics) |
| How it arrives | drivers double-enter | **Samsara API pull** + **EFS daily report upload** |
| Driver app | assumed | **does not exist** — drivers never touch FleetGuard |

The *concept* (cross-source ±5 reconciliation) was right; the *source* was wrong. Good news: the
engine is reusable — the `odometer_mismatch` rule, the `crossSourceOdometer` context field, and the
`odometer_tolerance_miles` (=5) threshold all stay. We only swap **where the comparison number comes
from**: instead of "find the matching manual entry," we "fetch the Samsara odometer at the EFS
fueling time."

This is also how industry does it (driver-entered vs telematics), and Samsara is a far stronger
reference than a second human ever could be.

---

## 2. Data sources

- **EFS** — daily report **upload** (already built). Provides: gallons, cost, pump location
  (city/state), **driver-entered odometer**, fueling **timestamp**, card #, unit, driver.
- **Samsara** — pulled via **API** (`GET /fleet/vehicles/stats/history`). Provides, for any time
  range and vehicle: **`obdOdometerMeters`** (dash-accurate, preferred), `gpsOdometerMeters`
  (fallback), and **GPS location**. (Odometer is in **meters** → ÷ 1609.344 = miles.)

---

## 3. The ±5 check (corrected)

For each EFS fuel transaction:
1. Map EFS **Unit** → the **Samsara vehicle id**.
2. Query Samsara for that vehicle's odometer **at the EFS fueling timestamp** (nearest stat within a
   tight window, e.g. ±5 min).
3. Convert meters → miles.
4. Fire **`odometer_mismatch`** when `|EFS_odometer − Samsara_odometer| > tolerance` (default **5 mi**).

All deterministic, in our system. Reuses the existing rule + `crossSourceOdometer` + threshold —
the only new code is the Samsara fetch that supplies that number.

---

## 4. Strongly recommended: make Samsara the mileage backbone

Since the **driver-entered pump odometer is exactly what we're auditing**, it shouldn't also be the
basis for our other mileage math. Samsara gives us trustworthy mileage, so:

- **MPG / baselines from Samsara**: miles between fuels = Samsara odometer delta (not the pump
  entry). MPG = Samsara miles ÷ EFS gallons. Far more reliable than today, and immune to a driver
  padding the pump odometer.
- **Real GPS location at fuel time** → finally populates `location_lat/lng` → enables the **AI
  location-plausibility** check and **`card_geo_impossible`** (previously impossible without
  coordinates). Bonus: we can verify the truck was actually *at the fuel station* when the card was
  used (a strong card-theft signal).

This makes the whole engine materially more precise — the deterministic system gets a ground-truth
mileage source, and the EFS pump odometer becomes purely a *thing to validate*.

---

## 5. Hard dependency — EFS fueling TIME

The ±5 check needs the fueling **time** (to a few minutes), not just the date: a truck at highway
speed moves ~5 miles in ~5 minutes, so a date-only timestamp can't be reconciled to ±5. **The sample
EFS Transaction Report had date only** (the Reject report had time). We must confirm the EFS
transaction **time** is available (in the daily report, or via the EFS data feed). Without it, the
best we can do is a wider tolerance or a per-day plausibility band.

---

## 6. New integration pieces (Phase 9-prep)

- `integration_credentials`: per-org **Samsara API token** (server-only secret).
- `vehicles.samsara_vehicle_id`: mapping EFS Unit / FleetGuard vehicle → Samsara vehicle.
- A **Samsara client** (`/fleet/vehicles/stats/history`) + a **reconciliation service** that, after
  each daily EFS upload, fetches Samsara odometer + location at each new transaction's time and runs
  the engine. (Daily batch aligned with the EFS upload; on-demand also possible.)

---

## Sources
- [Samsara — Historical vehicle stats (`/fleet/vehicles/stats/history`)](https://developers.samsara.com/reference/getvehiclestatshistory)
- [Samsara — Vehicle Stat APIs (recent / history / feed)](https://developers.samsara.com/changelog/vehicle-stat-apis)
- [Samsara — Mileage and distance (obdOdometerMeters / gpsOdometerMeters)](https://developers.samsara.com/docs/mileage-and-distance)
- [Samsara — Historical locations](https://developers.samsara.com/reference/getvehiclelocationshistory)
