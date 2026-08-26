# Samsara IFTA mileage — pull it, store it, calculate somewhere else

**Opened 2026-08-26 against `main` @ e99cc87.** The dependency `FUEL-SPEND-RELIABILITY-PLAN.md` named
three times and never had: **the miles, by jurisdiction.** Q-FX4 answered "can we net IFTA?" with *no,
nothing pairs miles with a jurisdiction*; F10 shipped purchase-state tax behind a seam built for this;
F11 was abandoned because the route actually driven is unknown; F13's carried-fuel figure is a floor
because a tank level is only on a quarter of fills.

Miki's shape, and this plan is built to it: **pull the data and calculate nothing on the way in.** What
Samsara returns is stored verbatim, in Samsara's own units, and every derived number is computed by a
separate pure module over the stored rows. The data is then reusable by anything — the IFTA return, the
landed-cost seam, the carried-fuel analysis, a future audit — instead of being welded to whichever
question happened to be asked first.

---

## 0. Ground truth (measured 2026-08-26, not recalled)

**We already have half of an IFTA return and cannot see the other half.** Computed from
`fuel_transactions` and F10's tax table for the last complete quarter, **2026 Q2**:

    439,153 gallons of tractor diesel across 45 jurisdictions
    $150,678 of fuel tax PAID AT THE PUMP — the credit side of the return

    IL   18,355 gal × $0.7380 = $13,546      CA    7,002 gal × $0.9710 = $6,798
    TX   51,214 gal × $0.2000 = $10,243      AZ   25,284 gal × $0.2600 = $6,574
    OH   20,842 gal × $0.4700 = $ 9,796      FL   14,531 gal × $0.4097 = $5,953
    IN   14,473 gal × $0.6300 = $ 9,118      MO   16,778 gal × $0.2950 = $4,950
    PA   12,021 gal × $0.7410 = $ 8,908      GA   19,585 gal × $0.3730 = $7,305

At roughly $600k a year of fuel tax, the product can see every dollar paid and not one dollar owed.
The **liability** side — taxable miles per jurisdiction — is the whole of what is missing, and it is
the thing Samsara already computes for this carrier every quarter.

**The integration is live and the mapping is complete.** All **195** vehicles carry a
`samsara_vehicle_id` (5 flagged `samsara_missing_since` on Samsara's side). `apps/api/src/lib/samsaraHttp.ts`
is a mature client — per-token rate limiting, 429/5xx retry with jitter, a request deadline, a
two-tier live/backfill RPS split — and thirteen sync kinds already run through the job queue. Nothing
about this plan needs new plumbing; it needs a new endpoint, a new table and a new module.

**No IFTA endpoint is called today.** The client currently touches `/fleet/vehicles`,
`/fleet/vehicles/stats/history`, `/fleet/hos/*`, `/idling/events`, `/fleet/drivers`, `/fleet/trailers`
and the driver-scores endpoints. The IFTA family is untouched, and its **token scope is not enabled**
(see Q-IF1).

---

## 1. The architecture this must end in

### 1.1 Ingest stores; it does not decide

The table holds what the API returned, in the units the API returned it, with the period it describes
and the moment it was fetched. **No conversion, no rounding, no netting, no MPG, no rates.** A row is a
statement about what Samsara said, and it stays true even when every downstream rule changes.

This is not a stylistic preference. Every derived quantity here has a policy embedded in it — which
miles are taxable, what the fleet's MPG is, which quarter's rate applies, whether to use `taxableMeters`
or `totalMeters` — and each of those has been wrong somewhere in this codebase before. Freezing one of
them into stored data means a corrected rule cannot be applied to history without a re-fetch, and a
re-fetch of a quarter Samsara has since restated is not the same data.

    Samsara  ──▶  samsara_ifta_jurisdiction_miles   (meters, litres, verbatim, per fetch)
                            │
                            ▼
              packages/shared/src/ifta/   (pure: units, apportionment, the return)
                            │
              ┌─────────────┼─────────────────────────────┐
              ▼             ▼                             ▼
        the IFTA position   F10's apportionment      F13's carried fuel
        (owed vs paid)      (landedCostPerGal)       (a measurement, not a floor)

### 1.2 The monthly jurisdiction summary is not an approximation — it is the arithmetic

This deserves stating plainly because it changes the order of the work. An IFTA return does not
attribute a *particular gallon* to a *particular state*. It computes, per jurisdiction per quarter:

    gallons consumed in J  =  taxable miles in J ÷ fleet MPG
    liability              =  gallons consumed in J × J's rate
    credit                 =  gallons PURCHASED in J × J's rate
    net                    =  liability − credit

So per-vehicle-per-jurisdiction-per-month miles, which is exactly what
`GET /fleet/reports/ifta/vehicle` returns, are **sufficient and authoritative** for the tax question.
Per-segment detail is not a better version of this number; it is the answer to a *different* question
(which fill, which road), and it is scheduled accordingly.

### 1.3 Two independent readings of one quarter, and they tie out

Samsara's response also carries `taxPaidLiters` — its own view of tax-paid fuel, assembled from its
fuel-card integration. We have our own, from `fuel_transactions`. **Those are two independent readings
of the same quarter and they must agree**, exactly as `pilotStatementTieOut` makes the vendor's printed
totals prove our parse. A disagreement means one of the two is wrong about which vehicle, which fuel
type, or which purchases — and the response's own `troubleshooting` block
(`noPurchasesFound`, `unassignedFuelTypePurchases`, `unassignedVehiclePurchases`,
`unassignedFuelTypeVehicles`) names which. Storing that block is not optional.

### 1.4 A filed quarter is evidence; an open one is not

A quarter that has been filed with the jurisdictions is a record of what the carrier asserted, and it
must not change afterwards — the `fuel_statements` argument verbatim. An open quarter is operational:
Samsara restates the most recent 72 hours, and a re-fetch of last week is expected to differ.

So the table is **operational and re-fetchable**, and filing takes a **snapshot** (§5, S3). Freezing
the operational table instead would make ordinary re-fetching impossible; leaving a filed quarter
mutable would make the filing unprovable.

### 1.5 The display is a jurisdiction ledger, not another tab on Fuel Spend

Fuel Spend answers "what did fuel cost and why". This answers "what do we owe whom, and where are we
buying against where we drive". They share a tax table and nothing else. Fuel Spend already carries
eight tabs; a ninth about a quarterly tax filing would be the wrong home for the carrier's controller,
who is not the same reader as the dispatcher.

---

## 2. Decisions

**D-IF1 — Store verbatim, in Samsara's units, and convert nowhere but in shared.** `taxableMeters`,
`totalMeters` and `taxPaidLiters` land as `numeric` columns with those names. Meters are not miles and
litres are not gallons, and a column called `miles` holding a converted metre count is a lie that
survives every future reader. Conversion is one tested function (`metersToMiles`, `litersToGallons`) in
`packages/shared/src/ifta/units.ts`. This is Miki's instruction of 2026-08-26 and it is also what F10's
tax table does — IFTA's own four-decimal rate, stored as published.

**D-IF2 — `taxableMeters` and `totalMeters` are both stored and never conflated.** They differ: some
jurisdictions exempt toll miles or off-highway travel, and the return is computed on the taxable
figure. Storing only one forecloses the other, and storing them merged forecloses both. Which one a
calculation uses is the calculation's decision, stated at its call site.

**D-IF3 — Start with `/fleet/reports/ifta/vehicle`, not the detail CSV.** Per §1.2 the summary is the
authoritative answer to the tax question, it is a plain paginated GET, and it is small: 195 vehicles ×
~15 jurisdictions × 12 months is ~35,000 rows a year. The detail CSV is an async job producing gzipped
files behind expiring URLs, capped at a month and 1,000 vehicles per job — worth building for the
questions that need it (S4), and the wrong thing to start with.

**D-IF4 — Our IFTA position is computed from OUR fuel and SAMSARA's miles, and tied out against
Samsara's own fuel figure.** Not "read Samsara's answer": we hold the fuel purchases at line level with
brand, station and price, which is what makes the position actionable rather than merely filable. The
tie-out is what stops a silent disagreement (§1.3).

**D-IF9 — The tie-out is on MILES, not on fuel — and it has already paid for itself.** D-IF4 assumed
Samsara's `taxPaidLiters` was a second reading of our purchases; S0 measured it at 668 gallons a
quarter against our 439,153, because 187 vehicles carry no fuel type in Samsara. So the two readings
that actually exist are **Samsara's jurisdiction miles and our odometer-derived miles**, and their
ratio implies an MPG that either is or is not physically possible. That check, run once by hand before
any of this was built, found a missing month of fuel worth about a million dollars. It ships as a
first-class part of the ingest rather than as a diagnostic somebody might run: **any period whose
implied fleet MPG falls outside a plausible band is flagged, loudly, on the surface.**

**D-IF5 — Fleet MPG for the liability calculation is derived from the same two sources, per quarter,
and is never a constant.** Gallons consumed in J = taxable miles in J ÷ MPG, and MPG = total miles ÷
total gallons over the quarter, both of which we will hold. `vehicles.baseline_mpg` is a per-truck
prior for other purposes and is not this; the return uses fleet-level actuals, and the surface states
the MPG it used because the whole liability scales with it.

**D-IF6 — An open quarter is re-fetchable; a filed one is snapshotted.** §1.4. The snapshot is a
separate append-only table, so the operational table stays prunable and the filing stays provable.

**D-IF7 — Jurisdiction codes are normalised to the same two-letter uppercase vocabulary the rest of the
product uses**, and a code F10's tax table cannot price is recorded as unpriceable rather than dropped
(D-FX7's rule). Samsara reports Canadian provinces and Mexican states for carriers that run them; this
fleet's fills are 46 U.S. states and no Canadian province (measured), and the tax table deliberately
excludes Canada because its U.S.-column rate is an exchange-rate conversion. A Canadian mile will
therefore arrive priced-at-null, and must appear as a gap rather than as zero tax.

**D-IF8 — The 72-hour exclusion is a property of the fetcher, not a caveat in a comment.** Samsara
states the most recent 72 hours are still processing. The scheduler never requests a period whose end
is inside that window, and a period fetched while still open is marked `provisional` so a surface can
say so — the same flag F10's tax table carries for a quarter IFTA has not finalised.

---

## 3. Facts the design is bound by (verified 2026-08-26; none recalled)

1. **`GET /fleet/reports/ifta/vehicle`** takes `year` plus either `month` or `quarter` (mutually
   exclusive), with optional `jurisdictions`, `fuelType`, `vehicleIds`, `tagIds`, `parentTagIds` and an
   `after` cursor. It returns `data.vehicleReports[]` of
   `{ vehicle: { id, name, externalIds }, jurisdictions: [{ jurisdiction, taxableMeters, totalMeters,
   taxPaidLiters }] }` plus `data.troubleshooting` and `pagination { endCursor, hasNextPage }`.
   **25 requests/sec.**
2. **`GET /fleet/reports/ifta/jurisdiction`** is the same data summed across vehicles — no pagination,
   **5 requests/sec**. Useful as a cheap cross-check on our own per-vehicle sum, and for nothing else.
3. **Scope: "Read IFTA (US)" under Compliance** must be enabled on the API token for both. The detail
   CSV additionally needs **"Write IFTA (US)"**. The existing token's scopes are unknown (Q-IF1).
4. **Units are metres and litres.** Not miles, not gallons.
5. **Data is returned in the organisation's Samsara timezone**, and **the most recent 72 hours may
   still be processing** and is explicitly not recommended to request.
6. **The IFTA Detail CSV** (`POST /ifta-detail/csv`, `GET /ifta-detail/csv/{id}`) is per **segment**:
   `device_id`, `jurisdiction`, `distance_meters`, `start_odo_meters`, `end_odo_meters`, `start_ms`,
   `end_ms`, `start_lat/lng`, `end_lat/lng`, `toll`, `leg_end`. Job statuses `Requested | Processing |
   Completed | Failed`; files arrive as gzipped CSV behind a `downloadUrl` with an expiry, refreshable
   by re-requesting the job. **≤1 month per job; ≤5,000 vehicles, ≤1,000 when the range exceeds 24
   hours; 100 requests/min.**
7. **All 195 vehicles carry a `samsara_vehicle_id`**; 5 are flagged `samsara_missing_since`.
8. **The Samsara client already enforces** per-token pacing (`SAMSARA_MAX_RPS`, default 20), retry with
   jitter (`SAMSARA_MAX_RETRIES`, default 4), a request deadline (`SAMSARA_REQUEST_TIMEOUT_MS`, default
   120s) and a live/backfill RPS split (`SAMSARA_LIVE_RPS_FRACTION`, default 0.6). A new fetcher uses
   it; it does not call `fetch` itself.
9. **Tokens are per-org and sealed at rest** (`lib/samsaraToken.ts`, secretBox `v1.` envelopes bound to
   the org), with a single-tenant `SAMSARA_API_TOKEN` env fallback. A new fetcher resolves through
   `loadSamsaraToken` and never reads the env directly.
10. **Job kinds are registered in `services/queue/handlers/index.ts`** and schedulers in
    `src/schedulers.ts`; a scheduler must run in exactly ONE process fleet-wide
    (`docs/WORKER-DEPLOYMENT.md`) — this is not optional and is checked before any new one is added.
11. **F10's `landedCostPerGal` already takes a `BurnApportionment` parameter** defaulting to
    `PURCHASE_STATE_APPORTIONMENT`. Wiring real miles in is a second argument at a call site; the
    signature does not change.
12. **The fleet's fills touch 46 U.S. states and no Canadian province** (measured, 11,373 fills), and
    F10's tax table covers 48 U.S. jurisdictions for 1Q–3Q 2026, excluding Canada by decision (D-FX12).

---

## 4. Execution protocol

Same as `FUEL-SPEND-RELIABILITY-PLAN.md` §4, which is not restated here. The parts that bite hardest on
this plan:

- **One step per PR**, branched from `origin/main` explicitly, the full gate list, the step marked
  **DONE** in this document in the same commit, PR → CI → merge. **Gates are checked by exit code**, not
  by grepping their output.
- **Migrations are flagged before merging** — `migrate.yml` auto-applies them.
- **Measure before claiming.** `supabase db query --linked`, reads only. Every figure in this document
  was measured on 2026-08-26 and carries its date.
- **Prove a test can fail** before keeping it.
- ⚠ **A vendor call in a test is a mock.** `samsaraHttp` is the seam; the recorder pattern in
  `apps/api/src/testing/` is how the other Samsara syncs are tested and this follows it.

---

## 5. Steps

### S0 · Confirm the token scope and see one real response — DONE 2026-08-26 (spike, no PR)

**It worked, and it found a hole in production worth about a million dollars.**

`GET /fleet/reports/ifta/vehicle?year=2026&quarter=Q2` → **HTTP 200**. Q-IF1 answered: the token
carries `Read IFTA (US)`. One page, `hasNextPage: false`, **172 vehicleReports**, a mean of 30.6
jurisdictions per vehicle across 50 distinct jurisdictions, **4,611,351 taxable miles** for the
quarter. Every one of the 172 matched a `samsara_vehicle_id` in `vehicles` — **the mapping is
complete and needs no work**.

**Q-IF2 answered: Samsara sees essentially none of this carrier's fuel.** `troubleshooting` came back
`{ noPurchasesFound: false, unassignedFuelTypeVehicles: 187, unassignedFuelTypePurchases: 0,
unassignedVehiclePurchases: 0 }` and `taxPaidLiters` totalled **2,530 litres — about 668 gallons —
for the whole quarter** against the 439,153 gallons we hold. 187 vehicles have no fuel type set in
Samsara, so nothing can be attributed to them. This confirms Miki's 2026-08-26 statement that
purchases are pulled from the EFS API directly: **the credit side of the return is ours, and only
ours.** D-IF4's fuel tie-out has nothing to tie against and is replaced by D-IF9 below.

**⚠ THE MILES DID NOT TIE OUT, AND CHASING THAT IS THE MOST VALUABLE THING IN THIS DOCUMENT.**

    2026 Q2, 172 trucks        our vetted odometer miles   2,754,740
                               Samsara taxable miles       4,611,351      ×1.66

Not a unit error and not a definition difference: the ratio is **per vehicle and scattered** — min
1.00, median 1.63, p75 1.85, **max 7.93**. Six trucks agree almost exactly (unit 770: 2,492 against
2,504). Two are off by nearly eightfold (unit 719: 4,180 against 33,060).

The discriminator is fuel, not miles. Implied MPG by ratio band:

    ratio band   trucks   mpg if Samsara's miles are right   mpg if ours are
    1.00–1.15         6                              7.26                6.68
    1.15–1.50        37                              9.14                6.55
    1.50–2.00        87                             10.73                6.42
    2.00+            27                             11.94                4.71

Where the two sources AGREE, the implied MPG is **7.26** — a plausible Class-8 figure. Where Samsara
runs higher, it climbs to 11.94, which no tractor achieves. So the excess miles are real miles with
**no fuel behind them**, and the question became: where is the fuel?

**It is a 31-day hole in our own data: `efs_transactions` holds ZERO rows for 2026-04-18 →
2026-05-18.** Confirmed day by day; both `efs_transactions` and `fuel_transactions` are empty across
exactly that span and dense on either side. At the rate of the 31 days that follow it (62.8 fills,
7,304 gallons, $33,288 a day) the hole is worth roughly:

    ~1,947 fills   ~226,424 gallons   ~$1,031,928

**And that closes the arithmetic exactly.** 439,153 recorded gallons plus the ~226,424 missing is
~665,577, against Samsara's 4,576,334 miles for the same trucks — **6.88 mpg**, against
`baseline_mpg`'s 6.92 and the 7.08 observed in F13's validation. **Samsara's miles are right and our
fuel data has a month missing.**

**Not a second hole:** the run from 2026-01-01 to 2026-02-03 is the data's START (first fill
2026-02-04; every row was written on 2026-08-03 by one backfill), not a gap.

**What this does and does not touch.** The Fuel Spend page's default 90-day window is
2026-05-28 → 2026-08-26 and does **not** overlap the hole, so F10's $19,858 California premium and
F13's $13,629 carried-fuel floor are computed on clean data and stand. Any window reaching into
April or May is understated by up to a third.

**Do (Miki):** re-run the EFS fetch for 2026-04-18 → 2026-05-18. The data is at EFS, not lost —
nothing here suggests otherwise, and the surrounding days prove the pipeline works.

<!-- The original brief for this step, kept because its questions are what produced the above: -->

### S0 (original brief) · Confirm the token scope and see one real response

**Blocking, and cheap.** Everything below assumes `Read IFTA (US)` is enabled on this carrier's token,
and nobody has checked. One authenticated call to
`/fleet/reports/ifta/vehicle?year=2026&quarter=Q2` answers it, and the response answers four more
questions no documentation can:

- do the returned `vehicle.id` values match our `samsara_vehicle_id` values, and does `externalIds`
  carry anything better;
- what does `troubleshooting` say for a carrier whose fuel cards Samsara may not see at all — if
  `noPurchasesFound` is true then `taxPaidLiters` is zero everywhere and D-IF4's tie-out has nothing to
  tie against, which is *fine* and must be known before it is built;
- how many jurisdictions per vehicle actually come back, which sizes the table;
- whether the summed `taxableMeters` is plausible against the fleet's own odometer miles for the same
  quarter, which is the first sanity check anybody will ask for.

**Do.** Miki enables the scope; the call is made against production read-only and its (redacted)
shape recorded here. **Deliverable:** Q-IF1 and Q-IF2 answered in place. **No PR.**

**Done when:** S1 can be written without a guess about the response.

---

### S1 · Pull the miles and store them verbatim — DONE 2026-08-26 (migration 0255)

**What shipped.**
- **`samsara_ifta_jurisdiction_miles` + `samsara_ifta_fetches` (0255)** — metres and litres under those
  names, one row per (truck, month, jurisdiction), unique on that key so a re-fetch refreshes rather
  than doubles a tax liability. The fetch row holds Samsara's `troubleshooting` block, the period it
  *said* it answered, the unmapped-vehicle count and the provisional flag. Operational and prunable by
  design (§1.4); a filed quarter's snapshot is S3's.
- **`packages/shared/src/samsara/ifta.ts`** — pure parser. Converts nothing.
- **`apps/api/src/lib/samsaraIfta.ts`** — the fetcher, through `samsaraFetch` so it inherits per-token
  pacing, retry and the deadline. It does NOT use `listAllPages`: that helper merges `json.data` as an
  ARRAY and this endpoint returns `data` as an OBJECT, so it would push one useless element per page.
- **`services/samsaraIftaSync.ts`** + job kind `sync_ifta` + a daily scheduler tier gated on
  `SAMSARA_IFTA_SYNC_HOURS` (0 disables). Three months per run, because a carrier files a QUARTER and
  the month a quarter opens is still being restated when the next one starts.

**D-IF10 — the period is a MONTH, and it was measured rather than assumed.** April + May + June returns
**4,611,351** taxable miles; Q2 returns **4,611,351**. A difference of **0.0 miles**. So monthly
reconstructs the quarter exactly *and* gives F10 a month-level apportionment; the quarter is derived
and never stored, because two rows that can disagree about one fact is worse than an extra sum.

**The RLS matrix had to be taught to seed these tables**, which is the gate working: `rls.test.mjs`
discovers every RLS table from the live catalogue and **fails** on one it cannot seed rather than
skipping it, and 0255's `period_year between 2015 and 2100` check refuses the generic seeder's
placeholder. A real year in `handSeed` was cheaper than loosening a constraint that exists to stop a
month landing in year zero. Coverage went 100 → 102 tables, 0 unseedable.

**Verified by:** the new `samsara-ifta-miles` matrix (**20 passed**), 14 shared parser tests, 13
service tests with `expectOrgScoped`, and `rls.test.mjs` at **421 passed**. Every test was made to
fail first: dropping an unrecognised jurisdiction (1 red), converting metres to miles at parse time
(1 red), silently skipping an unmapped vehicle (1 red), never marking a month provisional (2 red).
Removing the unique constraint takes the matrix down entirely — `on conflict` has nothing to match, so
it dies without a `RESULT` line, which the runner treats as a build failure. Full suite,
`pnpm typecheck`, `lint:migrations`, `lint:rls`, `lint:upserts`, `lint:filesize`, `lint:funcsize`,
`lint:comment-claims`, `lint:boundaries`, `lint:tests`, `lint:secrets` — all by exit code.

**Not done here, on purpose:** the backfill of 2026 Q1–Q3 is a one-command run against production once
this is deployed, not a migration. And nothing yet *reads* these rows — that is S2, and it is where
every conversion and every rate lives.

**Prerequisites:** S0.

**Build.**
- Migration: **`samsara_ifta_jurisdiction_miles`** — `org_id`, `vehicle_id` (our uuid),
  `samsara_vehicle_id`, `period_year`, `period_month` *or* `period_quarter`, `jurisdiction`,
  `taxable_meters`, `total_meters`, `tax_paid_liters`, `fuel_type`, `provisional boolean`,
  `fetched_at`, `source` — plus a `samsara_ifta_fetches` row per fetch holding the `troubleshooting`
  block, the cursor count and the response's own period echo. Unique on
  `(org_id, vehicle_id, period, jurisdiction, fuel_type)`; a re-fetch UPDATEs (never a partial
  `.upsert()` — `lint:upserts`; 0174/0175 the pattern). RLS on, read for org members, no client write.
  **Operational, not evidence** (§1.4), with the reason in the header.
- Service: `services/samsaraIfta.ts` — pages the endpoint through `samsaraHttp`, resolves the token
  through `loadSamsaraToken`, maps `vehicle.id` → our vehicle, and writes. **No arithmetic.** A vehicle
  Samsara reports that we cannot map is recorded and counted, never dropped silently.
- Job kind `sync_ifta` registered in `queue/handlers/index.ts`; scheduler monthly, plus on demand.
  **The 72-hour rule is enforced in the fetcher** (D-IF8), and a period still open is written
  `provisional = true`.
- Backfill: 2026 Q1–Q3, so F10 and F13 have the same window the fuel data has.

**Verify:** a PGlite matrix (`samsara-ifta-miles`) — RLS deny-all for a client write, org scope failing
closed, a re-fetch updating rather than duplicating, a provisional period marked. Service tests with
`expectOrgScoped` and a mocked `samsaraHttp` covering: cursor pagination across two pages, a vehicle we
cannot map, an empty `vehicleReports`, and a 429 surfacing as a job failure rather than a silent zero.
**Done when:** a quarter of jurisdiction miles is in the database in metres, and nothing has been
calculated.

---

### S2 · The IFTA position — a separate module over the stored rows

**Prerequisites:** S1.

**Build.** `packages/shared/src/ifta/` — pure, no clock, no I/O:
- `units.ts` — `metersToMiles`, `litersToGallons`, and nothing else. Tested against the exact
  conversion constants.
- `position.ts` — given jurisdiction miles + our fuel purchases + F10's rate table, compute per
  jurisdiction: taxable miles, gallons consumed (at the quarter's measured fleet MPG, D-IF5), liability,
  gallons purchased, credit, and **net**. Report the MPG used and the share of miles it could price.
- `tieOut.ts` — our purchased gallons against Samsara's `taxPaidLiters` per jurisdiction, with the
  `troubleshooting` block's explanation attached when they disagree (§1.3).

**Verify:** unit tests per jurisdiction with a known MPG; a test that a jurisdiction the tax table
cannot price is reported unpriceable rather than at zero liability (D-IF7); a tie-out test where
Samsara has no purchases at all and the module says so rather than reporting a 100% discrepancy.
**Done when:** the net position for 2026 Q2 can be computed and compared against what the carrier filed.

---

### S3 · The jurisdiction ledger — a surface, and a filing snapshot

**Prerequisites:** S2.

**Build.** A page (not a Fuel Spend tab — §1.5): per quarter, a jurisdiction table of miles, gallons
consumed, liability, gallons purchased, credit and net, with the fleet MPG and the coverage stated
beside it; the tie-out against Samsara's own fuel figure; and the `troubleshooting` block rendered in
words rather than as four integers. Plus **"mark this quarter filed"**, which writes the append-only
snapshot D-IF6 requires.

**Done when:** a controller can open the quarter, see what is owed and what was paid per jurisdiction,
and file from it — and a filed quarter can be reopened months later unchanged.

---

### S4 · Per-segment detail — the second source, for the questions the summary cannot answer

**Prerequisites:** S1 (the mapping and the client work), and a reason. Do not build this until one of
the two consumers below is actually being built.

The detail CSV is per-segment with jurisdiction, distance, odometer, timestamps and endpoints (§3.6).
It answers two questions the monthly summary cannot:

- **F10, per fill rather than per month.** Segments between fill *N* and fill *N+1*, matched on vehicle
  and time or odometer, are the true burn jurisdictions for those gallons. That turns
  `landedCostPerGal`'s apportionment from a monthly distribution into the actual one.
- **F11, which is blocked on exactly this.** The spike measured that constraining a cheaper-station
  recommendation to the segment between two fills removes 96% of the naive saving, and that the
  straight line between two fuel stops is not a road. Segment endpoints are a real trail;
  `stationsAlongRoute` (`smartFueling/corridor.ts`) already consumes one.

**Shape:** an async job kind that creates the Samsara job, polls to a terminal status, downloads the
gzipped CSV, parses and stores segments verbatim — same discipline as S1. ⚠ Volume is a different
order: a month of segments for 195 trucks is not 35,000 rows, and the retention rule must be decided
before the first backfill, not after.

---

### S5 · Close the loop on F10 and F13

**Prerequisites:** S2 (monthly) or S4 (per fill).

`landedCostPerGal` gains a real apportionment at its call sites and the surfaces stop saying
"purchase-state tax, not net of IFTA" because it no longer is. F13's carried-fuel figure stops being a
floor for the pairs the miles can reach. **Nothing in either module changes** — that was the point of
the seam.

---

## 6. Prerequisites register

| Id | Question | Owner | Fallback until answered |
|---|---|---|---|
| **Q-IF1** | ~~Is `Read IFTA (US)` enabled on this carrier's token?~~ | — | **ANSWERED 2026-08-26: YES.** Miki confirmed full access and S0's call returned HTTP 200. |
| **Q-IF2** | ~~Does Samsara see this carrier's fuel purchases?~~ | — | **ANSWERED 2026-08-26: effectively no.** 187 vehicles have no fuel type set, and `taxPaidLiters` totals 668 gallons a quarter against our 439,153. Purchases come from the EFS API directly (Miki, 2026-08-26). The credit side is ours alone; the tie-out moves to MILES (D-IF9). |
| **Q-IF6** | **The 31-day hole: 2026-04-18 → 2026-05-18 has zero `efs_transactions` rows**, worth ~1,947 fills / ~226,424 gallons / ~$1,031,928. Re-running the EFS fetch for that window is the fix; whether EFS still serves it is not known. | Miki | Every figure over a window touching April–May is understated by up to a third and no surface says so. The default 90-day window does not reach it. |
| **Q-IF3** | **Which quarters has the carrier already filed, and with what numbers?** The first useful test of S2 is whether our computed position matches a return that has been filed and accepted. | Miki | S2 ships with the position computed and unverified against any filing, and says so. |
| **Q-IF4** | **Retention for segment data (S4).** A month of per-segment rows for 195 trucks is a different order of volume from the monthly summary. | Miki | S4 is not started. |
| **Q-IF5** | **Does the carrier want to FILE from this, or only to manage it?** Filing makes the snapshot (D-IF6) load-bearing and raises the bar on the tie-out; managing does not. | Miki | S3 ships the ledger and the snapshot; the filing workflow is not built. |

---

## 7. What this plan deliberately does not do

- **It does not calculate at ingest.** Miki's instruction, and §1.1's argument: every derived quantity
  embeds a policy that has been wrong before, and stored data outlives the rule that produced it.
- **It does not replace Samsara's IFTA report.** Samsara can already file. What this adds is the fuel
  side at line level — brand, station, price — which is what turns a filing into a buying decision.
- **It does not start with the detail CSV.** The monthly summary is the authoritative answer to the tax
  question (§1.2), and the per-segment source is a different question with an order more data.
- **It does not add a ninth tab to Fuel Spend.** A quarterly tax filing and a dispatcher's fuel report
  have one reader in common and one table in common, and neither is a reason to share a page.
