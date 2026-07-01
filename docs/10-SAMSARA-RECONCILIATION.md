# FuelGuard — Samsara × EFS Odometer Reconciliation (corrected design)

> Supersedes the cross-source design in `09-DETECTION-REVIEW.md §2`. There is **no driver app**.
> The ±5-mile odometer check compares the **EFS pump odometer** (driver-entered at fueling) against
> the **Samsara telematics odometer at the fueling timestamp** (the independent truth).

---

## 1. What changed

| | Before (wrong) | Now (corrected) |
|---|---|---|
| Reference for "correct odometer" | a second human entry in a FuelGuard app | **Samsara GPS/OBD odometer** (telematics) |
| How it arrives | drivers double-enter | **Samsara API pull** + **EFS daily report upload** |
| Driver app | assumed | **does not exist** — drivers never touch FuelGuard |

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
- `vehicles.samsara_vehicle_id`: mapping EFS Unit / FuelGuard vehicle → Samsara vehicle.
- A **Samsara client** (`/fleet/vehicles/stats/history`) + a **reconciliation service** that, after
  each daily EFS upload, fetches Samsara odometer + location at each new transaction's time and runs
  the engine. (Daily batch aligned with the EFS upload; on-demand also possible.)

---

---

## 7. Implemented (matching algorithm)

The location+time match is built and tested (`packages/shared/src/samsara.ts`):

1. Pull the truck's Samsara **GPS history with the OBD odometer decorated** onto each point
   (`types=gps&decorations=obdOdometerMeters`) for a ±30h window around the EFS date.
2. `parseSamsaraSamples` → unified samples `{time, lat, lng, speedMph, address, odometerMiles}`.
3. `matchFuelingMoment` → the **stopped** sample whose reverse-geocoded **address is in the EFS
   station's city** (the truck parked there to fuel). That one sample yields:
   - **`samsaraOdometerMiles`** → the ±5 reference (`reconcileOdometerMiles` → `odometer_mismatch`),
   - **`matchedAt`** → the recovered fueling time (scoring overwrites the EFS date-only `fueled_at`
     and switches the row to `instant` precision, so off-hours/rapid rules work),
   - **location confirmation** → if Samsara never placed the truck in the EFS city that day,
     `matchFuelingMoment` returns null → the engine fires **`location_mismatch`** (card used but
     truck wasn't there).
4. The HTTP call + token (per-org `integration_credentials`, else `SAMSARA_API_TOKEN`) + vehicle
   mapping (`vehicles.samsara_vehicle_id`) live in the API; the call is best-effort and never blocks
   the deterministic rules. Verified end-to-end on a simulated day trace: it recovers the 14:25 stop
   and odometer 438795 (matching the real EFS line).

> Setup to go live: add the Samsara API token + map each vehicle's `samsara_vehicle_id`.

---

## 8. Tank-fill reconciliation (advisory — Phase 8.8)

A second, independent use of the same Samsara pull: did the fuel actually go **into the truck**?
Alongside GPS we request `fuelPercents` (tank level). Around the matched fueling moment we read the
tank level just **before** the stop and the **post-fill peak** in the next few hours, convert the rise
to gallons (`Δ% × tank capacity`), and compare to the gallons billed (`reconcileTankFill`). A
**shortfall** — far less fuel entered the tank than was paid for — is a possible siphon / fill-into-a-
container and fires the **`tank_fill_short`** rule.

This is deliberately a **low-confidence, advisory** signal, by design:

- Samsara's OBD tank reading is **coarse and noisy**, so the check uses a **generous tolerance** (the
  larger of 15 gal or 30% of the bill) and only ever flags a **shortfall**, never an exact match.
- The rule is **low severity** and fuel-vehicle-only — a "worth a look", not proof. The odometer ±5
  and location checks remain the high-confidence detectors.

Stored per transaction: `samsara_tank_observed_gal`, `samsara_tank_short_gal` (migration 0013).
Verified on a simulated trace: a full 21%→95% fill on a 120-gal tank reads ~89 gal (≈ the bill, no
flag); a 21%→40% rise on a 90-gal bill reads ~23 gal → ~67 gal short → flags.

---

## 9. Fleet vehicle sync (Samsara → `vehicles`, Phase 8.9)

Rather than hand-typing each truck (and its Samsara ID), admins can **Sync from Samsara** on the
Vehicles page. It calls `POST /api/integrations/samsara/sync-vehicles`, which pages through Samsara
**`GET /fleet/vehicles`** and upserts each vehicle.

- **Trucks only, never trailers.** `/fleet/vehicles` returns *powered* vehicles; trailers and other
  unpowered assets live in the separate (beta) `/assets` API, so this endpoint can't pull them.
- **Matching precedence:** `samsara_vehicle_id` → VIN → unit number. A match refreshes identity
  (make/model/year/plate/VIN) and stamps `samsara_vehicle_id`, but **never overwrites** user-owned
  fields (unit number, **tank capacity**, **baseline MPG**, fuel type).
- **Auto-links telematics.** The Samsara `id` becomes `samsara_vehicle_id`, so odometer/location/tank
  reconciliation works without anyone copying IDs.
- **Fields Samsara doesn't have** — tank capacity and baseline MPG — are left for the admin. New
  trucks are created with tank capacity 0 / no baseline and returned in `needsCompletion` so the UI
  can prompt "set these before importing fuel."
- Cursor pagination (`after` → `pagination.endCursor`/`hasNextPage`, 512/page); token from
  `integration_credentials` or the `SAMSARA_API_TOKEN` fallback; admin-only + audited.

> Note the unit-number tie-in: EFS fuel lines link to a truck by **Unit**, so a synced vehicle's
> `unit_number` (from Samsara's `name`) must match the EFS "Unit" value for fuel to attribute.

### What the sync fills — and what stays manual (Phase 8.10)

| Field | Source |
|-------|--------|
| unit number, make, model, year, plate, VIN, `samsara_vehicle_id` | Samsara `/fleet/vehicles` |
| **current odometer** | Samsara `/fleet/vehicles/stats` (`obdOdometerMeters` → GPS fallback, meters→miles) |
| **tank capacity**, **baseline MPG** | **manual** — Samsara has no API field for these; they're vehicle specs |

Because tank capacity and baseline MPG drive the over-capacity and efficiency detectors, the Vehicles
table flags fuel vehicles missing them with a **"Set tank" / "Set MPG"** badge after a sync. Odometer
is only written when Samsara actually returns a reading (never overwritten with 0).

### Driver sync

`POST /api/integrations/samsara/sync-drivers` (**Sync from Samsara** on the Drivers page) pulls the org's
drivers from `GET /fleet/drivers`, upserting by `samsara_driver_id` → phone → name. It fills name, phone,
and `samsara_driver_id` (migration 0015); `employee_id` and status stay user-owned. Admin-only + audited.

### Driver ↔ vehicle assignment

The vehicle sync also pulls **current driver assignments** from
`GET /fleet/driver-vehicle-assignments?filterBy=vehicles` (defaults to "now") and sets each truck's
`assigned_driver_id`. It matches Samsara vehicle id → `samsara_vehicle_id` and Samsara driver id →
`samsara_driver_id`, so **drivers must be synced first**. Best-effort: any failure leaves the identity +
odometer sync intact.

### Required Samsara token scopes

The **Sync from Samsara** buttons need these read scopes on the API token:
**Read Vehicles**, **Read Vehicle Statistics** (odometer), **Read Drivers**, **Read Assignments**
(driver↔vehicle). A token missing a scope makes only that part of the sync fail (Samsara returns 403).

---

## Sources
- [Samsara — List all vehicles (`GET /fleet/vehicles`, powered vehicles only)](https://developers.samsara.com/reference/listvehicles)
- [Samsara — Assets: Vehicles, Trailers, and Equipment (why trailers are separate)](https://developers.samsara.com/docs/assets-vehicles-trailers-equipment)
- [Samsara — Pagination (`after` / `endCursor` / `hasNextPage`)](https://developers.samsara.com/docs/pagination)
- [Samsara — Historical vehicle stats (`/fleet/vehicles/stats/history`)](https://developers.samsara.com/reference/getvehiclestatshistory)
- [Samsara — Vehicle Stat APIs (recent / history / feed)](https://developers.samsara.com/changelog/vehicle-stat-apis)
- [Samsara — Mileage and distance (obdOdometerMeters / gpsOdometerMeters)](https://developers.samsara.com/docs/mileage-and-distance)
- [Samsara — Historical locations](https://developers.samsara.com/reference/getvehiclelocationshistory)
