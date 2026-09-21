# Data precision audit — fuel, finance and idling (2026-09-20)

**Status:** audit complete, nothing built. Opened 2026-09-20 after the owner reported that the Fleet
overview dashboard showed **8.6 MPG** on its headline tile while the trend chart beneath it drew
**6.8–7.1**, that some cards did not react to the date filter, and that the Fuel Spend page showed a
third figure (7.28). The owner's framing — *"our architecture should be precise; we have collectors
and we have a harness that should be in charge of all calculations, and the modular monolith should
be respected"* — is the frame this document is written in, because every finding below is a case of
a calculation happening somewhere that could not see what it needed to see.

**Two most important sections, per the owner:** §1 (fuel) and §2 (finance). §3 is the idling
re-audit added 2026-09-20 in the same session.

**Method.** Every figure in this document was measured against the production database
(`supabase db query --linked`) or read out of the Railway logs of `@fleetguard/api`. Nothing is
inferred from code alone. Where a number is a reproduction of what a surface shows, the SQL that
reproduces it is described well enough to re-run.

---

## 0. The one-paragraph summary

The fuel-spend rollup has been throwing on a check constraint since **2026-09-13**, so
`fuel_spend_days` is frozen five days behind the odometer feed. Fleet MPG divides current miles by
stale gallons and reads **8.61** instead of ~6.9, and nothing in the product can see it, because the
only coverage figure the calculation carries answers a question about *trucks* and the failure is
about *time*. Behind that sits a second, older problem the first one hides: two live definitions of
fleet MPG that disagree by 9.3% on August, three different definitions of "a day" on one dashboard
card, and a finance section running on a ledger that stopped on 2026-08-31. The idling section has
the same shape one layer down: 160 trucks a day of clean engine-state data, and a verdict layer that
refuses 200+ of them because a checkbox on the Vehicles page was never ticked.

---

## 1. Fuel

### D-PREC1 — the blocker: `fuel_spend_days` has been frozen since 2026-09-13

Railway, `@fleetguard/api`:

```
[fuel-spend] org 86d6b3ea-4361-4f71-877f-e8373615769b rollup failed: fuel spend rollup write failed:
new row for relation "fuel_spend_days" violates check constraint "fuel_spend_days_miles_pair"
```

The constraint is `supabase/migrations/0244_fuel_spend_days.sql:120`:

```sql
constraint fuel_spend_days_miles_pair check ((miles = 0) = (mpg_gallons = 0)),
```

**Why it leaves a HALF-written table rather than an unchanged one.** `writeRows` upserts in chunks
and `sweepStale` runs after it. The throw happens mid-chunk, so the days before the bad chunk land
and the days after it do not, and the sweep that would have removed the stale remainder never runs.
Measured 2026-09-20:

| Day | rows | gallons | `updated_at` |
|---|---|---|---|
| 2026-09-08 … 09-12 | 165–170 | normal | **2026-09-21 00:01** (today's run) |
| 2026-09-13, 09-14 | 151, 147 | normal | **2026-09-15 08:55** (a week stale) |
| 2026-09-15 | **4** | **431** (against 7,589 in `fuel_transactions`) | 2026-09-15 08:55 |
| 2026-09-16 … 09-20 | — | — | never written |

Meanwhile `fuel_transactions` is canonical and vehicle-attributed through **2026-09-20** (17,211
rows) and `samsara_odometer_readings` runs through **2026-09-21** (48,568 rows, 202 trucks). The
sources are fine. The derivation is dead.

**The exact row.** `deriveFuelSpendRollup` was run over production reads for the window
`2026-09-06 … 2026-09-20` (2,390 fills, 5,062 engine-days, 2,421 derived rows). It produces exactly
one violating row:

```
day=2026-09-13  vehicle=1f8dcd84-c432-475a-b367-75e882aba145  miles=0  mpgGallons=1.565  basis=drive_time
```

**The input is a split fill.** That truck's fills:

```
2026-09-12T16:17  gal=134.39  miles_since_last=857
2026-09-16T01:54  gal=158.06  miles_since_last=0.2     ← this one
2026-09-16T03:11  gal=2.59    miles_since_last=940.5   ← and its partner, odometer mis-paired
```

A 158-gallon fill 0.2 miles after the last one — a second pump, a split ticket, or a driver topping
off. `allocate()` (`packages/shared/src/fuelSpend/rollupDerive.ts` ~L268) spreads that interval
across 2026-09-13 … 09-16 by drive-second weight and rounds the two halves at **different scales**:

```ts
row.miles      = r2(row.miles + miles * share);       // 2 dp
row.mpgGallons = r3(row.mpgGallons + gallons * share); // 3 dp
```

With 09-13's drive-second share of a four-day interval, `0.2 × share` rounds to `0.00` while
`158.06 × share` rounds to `1.565`. `miles <= 0` is already refused upstream (`rollupDerive.ts`
~L203); what is not handled is a miles value small enough to vanish at two decimal places beside
gallons that survive at three.

**One truck-day has held the whole organisation's fuel reporting for a week**, and the only place it
was visible was a log line nobody was reading.

### D-PREC2 — the reported symptom, reproduced exactly

Default dashboard window (see D-PREC6 for why it ends on the 21st), fleet MPG endpoint semantics
reproduced in SQL — bounding odometer readings per truck per counter, 30-day lookback, Samsara's own
source ranking, intersected with trucks that bought tractor fuel:

| Period | MPG | miles | gallons with miles | measured share |
|---|---|---|---|---|
| **TOTAL 08/22 – 09/21** | **8.61** | 1,484,865 | 172,542 | 0.966 |
| wk 08/21 – 08/23 | 6.28 | 161,083 | 25,634 | 0.992 |
| wk 08/24 – 08/30 | 6.83 | 370,057 | 54,171 | 0.991 |
| wk 08/31 – 09/06 | 6.82 | 334,165 | 49,010 | 0.961 |
| wk 09/07 – 09/13 | 7.10 | 345,194 | 48,637 | 0.976 |
| wk 09/14 – 09/20 | **22.82** | 166,958 | **7,318** | 1.000 |

The owner saw 8.6 and 6.8–7.1. Both are on the page and both come from the same endpoint. The last
week holds 167,000 real miles and 7,318 gallons instead of the ~50,000 its neighbours hold, because
of D-PREC1; it exceeds `PLAUSIBLE_FLEET_MPG.high` (12) and is correctly withheld, so it draws as a
gap — but the window TOTAL swallows it whole and is not withheld, because 8.61 is inside the band.

**The weeks are right. The headline is wrong. The true figure is ≈ 6.9.**

### D-PREC3 — `measuredShare` cannot see this, and says so in its own header

The total reports `measuredShare = 0.966` and looks healthy. It is the share of the period's
**fuel** that has a measured distance behind it — a statement about TRUCKS. The failure is a
statement about TIME: five of the window's thirty days have miles and no gallons.
`apps/api/src/modules/fuel-spend/fleetMpg.ts` already says this in as many words —

> `measuredShare` does not detect this — it is a coverage figure, not a timing one — so it is stated
> here rather than papered over.

— and then nothing acts on it. **There is no freshness gate anywhere on the fuel side.** The finance
side already has one (`latestReportableMonth` + a `missing` month list + a "figures as of" line), so
the pattern exists in this repo; it was simply never applied to fuel. That asymmetry is the finding,
not the missing line of code.

### D-PREC4 — two live definitions of fleet MPG, disagreeing by 9.3%

D-MPG1 says one definition and no surface computes an MPG. In practice the *formula* is shared
(`computeFleetMpg`) and the *numerator* is not:

- **Dashboard** → `samsara_odometer_readings`, bounding differences (`milesSource: "measured"`).
- **Fuel Spend page** → `fuel_spend_days.miles`, a fill-to-fill interval spread across days by
  drive-second weight (`milesSource: "allocated"`).

Measured over complete months, so neither is contaminated by D-PREC1:

| Month | measured odometer | allocated | diff | Dashboard MPG | Fuel Spend MPG |
|---|---|---|---|---|---|
| 2026-07 | 1,524,886 | 1,549,942 | +1.6% | **6.84** | **6.98** |
| 2026-08 | 1,559,046 | 1,744,429 | **+11.9%** | **6.88** | **7.52** |

The August allocated drift is FLEET-MPG-CONSOLIDATION-PLAN's open Q3 (+3.78% against IFTA when last
measured) and it has roughly tripled. `lint:mpg` cannot catch this: it looks for division operators,
not for which miles entered the numerator. A gate that checks the arithmetic cannot check the
provenance.

There is also a **third** miles figure on the dashboard itself. The Operating-metrics strip's "Miles
driven · odometer span in range" tile reads `fuel_range_miles_inputs` — a robust max−min span of
**fill odometers** — while the "Avg MPG" tile four columns to its right divides Samsara odometer
readings. Two miles numbers, one card, different sources, neither labelled.

### D-PREC5 — the date boundary is off by one day, proven

`apps/web/src/features/dashboard/widgets/OperatingMetricsWidget.vue:42-43`:

```ts
const fuelRange = computed<FuelFilters>(() => ({
  from: new Date(`${range.value.from}T00:00:00`).toISOString(),
  to:   new Date(`${range.value.to}T23:59:59.999`).toISOString(),
}));
```

`new Date("2026-08-09T00:00:00")` with no `Z` is parsed at the **browser's** midnight. `.toISOString()`
then moves it to UTC. The receiving RPC `fuel_range_totals` declares its parameters as `date` and
filters `business_date` (migration 0312, lines 51–52 and 88–89), so Postgres casts the timestamp
string back to a calendar day — **the wrong one**:

```
'2026-08-10T04:59:59.999Z'::date  →  2026-08-10
```

For a Central-time viewer picking **08/09 → 08/09**:

| | intended | actual |
|---|---|---|
| fills | 45 | **104** |
| gallons | 4,788 | **11,471** |

So Fill-ups and Miles driven cover 08/09–08/10 while Gallons and Fuel spend, on the same card,
correctly cover 08/09 alone. A viewer east of UTC gets the mirror image: the `from` lands a day
early.

The comment above that code claims it uses "the same UTC bounds `useDashboard` uses". That stopped
being true when `business_date` landed (FUEL-T1 / D-FUI11) — `useDashboard.ts:89` even carries the
note recording that this exact bug was fixed there. It was fixed in one of the two places.

**The same shape is still live in four more surfaces:**

| File | What it breaks |
|---|---|
| `DashboardPage.vue:101-102` | Transactions CSV and Summary PDF cover a different window than the screen they were exported from |
| `ReportsPage.vue:30-31` | naive `T00:00:00` sent to the API, parsed in the server's zone |
| `useAnomalies.ts:89-90` | naive timestamp compared to `fueled_at timestamptz` → a UTC day, not a station day |
| `useIdlingPage.ts:28` | naive `T23:59:59` |

Underneath all of it there are **three legitimate but different definitions of "a day"** in play —
the station's business date, the org's operating timezone, and a UTC instant — and no surface says
which one it is using. Each is defensible on its own; together they guarantee that two tiles side by
side answer about different days.

### D-PREC6 — the default window ends tomorrow

`apps/web/src/pages/DashboardPage.vue:44`:

```ts
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
```

Applied to `new Date()`. After 19:00 Central the UTC date has already rolled over, so the default
"last 30 days" runs to **tomorrow** and starts a day late. This is why the window that reproduces
the owner's 8.6 is 08/22 – 09/21 rather than 08/21 – 09/20.

### D-PREC7 — four cards ignore the date filter and none of them says so

`useDashboard.ts` fetches anomalies with **no date predicate at all**. That is deliberate and
documented — the tile must agree with the Alerts page, which shows open cases unfiltered. The
consequence is that **Open cases by severity**, **Top vehicles by risk**, **Top drivers by risk**
and the **Active alerts** hero tile sit underneath a date-range picker and never move.

Not a data bug. A bug in what the page claims: `Where fuel dollars go` writes "· this range" in its
subtitle; these four write nothing. A reader who changes the range and watches four cards stay still
has been given no way to tell "unaffected by design" from "broken".

### D-PREC8 — the dashboard is the one surface that calculates in the browser

This is the architectural root the owner named. `useDashboard.ts` pages **six raw tables** directly
from the browser — `fuel_transactions`, `anomalies`, `vehicles`, `drivers`, `idle_rollup_days`,
`declined_transactions`, plus a coverage RPC — and folds them with `aggregateDashboard`. Every other
reporting surface asks the API, which asks the harness.

That is why D-PREC5 and D-PREC6 live here and only here: a component that builds its own window has
no access to the org's operating timezone, the station's business date, or the freshness of the
tables it is dividing. The collectors are right, the harness is right, and the dashboard is a third
implementation sitting outside both.

### Other collectors currently failing (from the same log sweep)

```
[efs-soap]       org 86d6b3ea… posted: FAILED — EFS getMCTransExtLocV2 request failed
[posted-prices]  pilot FAILED: Completeness gate: 25 station rows < required 700 — refusing a partial batch
```

The second is a gate working correctly and should be read as such; the first is not.

---

## 2. Finance

### D-PREC9 — the ledger stopped on 2026-08-31 and August is empty

| | |
|---|---|
| `org_integrations` provider `mcleod_financial`, last sync | **2026-09-10** (10 days ago) |
| `org_integrations` provider `mcleod`, last sync | 2026-09-17 |
| `mcleod_movements`, last updated | 2026-09-10 |

`mcleod_gl_days` by month:

| Month | rows | distinct days | last day |
|---|---|---|---|
| 2026-06 | 1,206 | 30 | 06-30 |
| 2026-07 | 1,152 | 31 | 07-31 |
| **2026-08** | **23** | **9** | 08-31 |
| 2026-09 | — | — | — |

August's sweep landed 2% of a normal month. The system knows: `finance_month_closes` for
`2026-08-01` reads **`gl_revenue = 0`, status `open`**, swept 2026-09-10. The API's own freshness
scheduler fired the right finding — `[finance-freshness] org 86d6b3ea…: 1 new finding(s) — McLeod
financial sweep is 10 days old`.

**The Fleet report's guard is the good news here.** `latestReportableMonth` (`reportPeriod.ts:145`)
excludes a month that is missing or was swept before it ended, and `fleetProvenanceLine` prints
"figures as of". So the finance section should be opening on **July**, not on an empty August. That
is exactly the mechanism §1 is missing, working. It should be lifted, not re-invented.

### D-PREC10 — every month close is `open`, with six-figure drifts, since March

| Month | GL revenue | billing drift | fuel residual | settlement drift |
|---|---|---|---|---|
| 2026-08 | **0** | — | — | — |
| 2026-07 | 4,828,189 | **+218,579** | −132,913 | 90,441 |
| 2026-06 | 5,107,789 | +137,264 | −174,753 | 127,706 |
| 2026-05 | 4,390,380 | +61,301 | **−381,188** | 77,564 |
| 2026-04 | 4,237,048 | −169,356 | **−649,354** | 5,761 |
| 2026-03 | 4,086,461 | +244,378 | −156,801 | 6,608 |

Against ~$4.8M monthly revenue that is 1.5–5% on billing and 3–15% on fuel. Not one month has ever
reached `hardened`. The report's own tie-out has been saying "the staged sweep and the ledger
disagree" for six consecutive months and nothing consumes that signal.

Note also that the June discrepancy recorded in `finance-go-live-handoff-2026-09-03` is unchanged:
the close's fuel term (−174,753) is still not F12's decomposition (≈ $444). The close's fuel term
and F12 are measuring different things and one of them needs to stop.

### D-PREC11 — the freshness check itself is broken for the second org

```
[finance-freshness] org 07fe4058-cc72-4a69-b3e9-29b4cf1c6a44 failed: canceling statement due to statement timeout
```

The check that exists to warn about D-PREC9 does not complete for one of the two orgs. A
staleness monitor that times out is worse than none, because its silence reads as health.

---

## 3. Idling (re-audit, 2026-09-20)

Opened in the same session on the owner's report: *"we have only 30-35 trucks data for idling"*, and
their proposal to rebuild the model on the high-frequency Samsara feed with a per-truck split of
running / driving / parked-stopped hours and an equipment-aware avoidable term.

### D-IDLE1 — the foundation data is good; it is the verdict layer that is empty

This is the opposite of what "only 30-35 trucks" suggests. Per-day, for 2026-09-13 … 09-19:

| Day | trucks with rows | coverage ≥ 80% of day | avg coverage | drive h | idle h | off h |
|---|---|---|---|---|---|---|
| 09-13 | 164 | 164 | 24.0 h | 710 | 1,086 | 2,140 |
| 09-15 | 163 | 158 | 23.7 h | 1,075 | 1,044 | 1,742 |
| 09-17 | 160 | 152 | 23.4 h | 1,206 | 1,015 | 1,521 |
| 09-19 | 147 | 136 | 23.0 h | 1,006 | 893 | 1,477 |

~160 trucks a day at ~24 hours of engine-state coverage each. `idle_rollup_days` holds 23,792 rows
across **200 trucks**; `idle_events` 224,388 rows across 199; `idle_park_sessions` 77,423 across 197.
**The data is there for the whole fleet.**

### D-IDLE2 — the funnel is a checkbox, and it is unticked for 75% of the fleet

`idleAvoidable.ts`'s stated principle:

> Continuous idle is avoidable ONLY when the truck had a real alternative, and that is established
> **SOLELY** by an admin-confirmed APU / Optimized-Idle flag on the vehicle. […] the LEARNED
> capability is display/cross-check only and never makes idle avoidable.

The flags, across 272 vehicles:

| | true | false | **null (never answered)** |
|---|---|---|---|
| `has_apu` | **17** | 52 | **203** |
| `has_optimized_idle` | **36** | 40 | **196** |

17 + 36 with overlap is at most ~50 trucks, and after `minCoverage` (0.5) and
`minDutyEvidencedShare` (0.8) it lands on the **30–35** the owner sees.

The design decision is defensible in isolation and the header argues it well — a diesel APU is
genuinely invisible to telematics, engine-off at rest looks identical to a plain shutdown. What it
did not anticipate is that **nobody would ever fill the flags in**, and that the product would then
present a 35-truck report as if it were a fleet report. The page shows the trucks it could judge; it
does not show that 203 trucks were never asked about. That is the same failure mode as D-PREC3: a
refusal that is correct per-row and invisible in aggregate.

Cross-check, and it is a good one: the *learned* capability says `apu` for **156** trucks
(`engine_off_observed` for 120). Of the 17 trucks with a confirmed APU flag, learned agrees for 14,
says `unknown` for 2 and `continuous_only` for 1. So the learned signal is not noise — it is being
deliberately and correctly withheld from the verdict, and the result is that 139 trucks that
demonstrably rest engine-off are scored as if they had no alternative.

### D-IDLE3 — the temperature envelope has never been evidenced for a single truck

| Field | Value | Count |
|---|---|---|
| `vehicle_idle_learned.idle_learned_envelope_status` | `not_applicable` | 236 |
| | `insufficient` | 36 |
| | *evidenced* | **0** |
| `idle_rollup_days.optimized_envelope_status` (Sep) | `not_applicable` | 2,888 |
| | `insufficient` | 355 |
| | *evidenced* | **0** |

IDLE-AVOIDABLE-HOS.md §2 rests its whole argument on replacing fixed per-equipment percentages with
a measured, temperature-conditioned envelope. **That envelope has never been measured for any truck.**
The plan is marked DORMANT since 2026-07-18 and this is why: the mechanism it proposed was built and
has never produced an answer.

### D-IDLE4 — `optimized_cycling` never fires

September park sessions by mode:

| Mode | sessions | idle hours |
|---|---|---|
| `apu_or_off` | 5,432 | 1,588 |
| `continuous` | 4,600 | **16,377** |
| `optimized_cycling` | **0** | **0** |

Not one cycling session in three weeks, against **36 trucks flagged `has_optimized_idle = true`**.
Either the classifier's `minCycles = 4` threshold never trips at the engineStates sample density we
fetch, or those 36 trucks are not actually cycling. Both are answerable from the raw samples and
neither has been asked. **91% of park idle is classified `continuous`**, which — combined with
D-IDLE2 — means almost the entire fleet's idle is reported as "unavoidable / unconfirmed".

### D-IDLE5 — HOS duty evidence is sufficient for about a quarter of truck-days

`idle_rollup_days.hos_evidence_status`, September: `not_applicable` 1,202 · `sufficient` **800** ·
`insufficient` 774 · `ambiguous` 467. At session grain it is better — `idle_park_sessions`:
`sufficient` 6,526 · `insufficient` 1,961 · `ambiguous` 1,545 — which suggests the day-grain
aggregation (worst-of-days) is throwing away evidence the sessions have.

`equipment_profile` on September park sessions: **`unknown` 6,382 (62%)**,
`optimized_idle_documented_default` 2,322, `none` 1,256, `battery_hvac_unprofiled` 72.

### D-IDLE6 — the raw totals are believable, which is what makes the verdict layer worth fixing

Fleet, 2026-09-01 … 09-19: **19,079 idle hours** against **19,217 drive hours** — idle is **49.8% of
engine-on time**, annualising to **~2,014 idle hours per truck per year**.

Benchmarks (see §3.3): USDOT puts long-haul at ~6 h/day, **1,830 h/yr**; ATRI's sleeper figure is
~**1,456 h/yr**. So this fleet idles 10–38% *above* published long-haul norms. At the configured
`idle_gal_per_hour = 0.80` and `fuel_price_per_gal = 4.00` that is **~$64,000/month of idle fuel
across the measured fleet** — and the product currently attributes almost none of it, because of
D-IDLE2.

**The measurement is sound. The judgement is what is missing.** That is the correct order to fix
things in and it is the opposite of what the "only 30-35 trucks" symptom suggests.

### 3.1 — a correction to the premise, and it matters for the design

The owner's proposal rests on *"we are pulling data every 3 seconds from Samsara that shows engine
running"*. Measured:

- `samsaraPositionsFeed.ts` polls `GET /fleet/vehicles/stats/feed` every **5 seconds** (the vendor's
  own documented floor), and it requests **`types=gps` only**. It carries no engine state.
- It **keeps no history**: `vehicle_positions` holds exactly **203 rows — one per truck**, overwritten
  in place. Its own header records that as the owner's ruling for migration 0341.
- Engine state comes from a different endpoint entirely:
  `GET /fleet/vehicles/stats/history?types=engineStates&decorations=gps`
  (`apps/api/src/modules/samsara/lib/samsara.ts:216`), pulled on the idle-foundation schedule. Samsara
  returns **state CHANGES**, not a 3-second sample: `sample[i].state` holds until `sample[i+1].t`.

**This is better news than the premise, not worse.** A state-change stream is exactly the right shape
for the split the owner wants — it is lossless between transitions and costs nothing to store — and
Samsara's enum already draws the line the design needs:

| `engineStates` value | Meaning | Bucket |
|---|---|---|
| `On` | engine running **and moving** | **Driving** |
| `Idle` | running, stationary | **Idling** |
| `Off` | shut down | **Parked, engine off** |

`packages/shared/src/idleSessions.ts:208` already documents this and already warns against the trap
of using decorated GPS speed instead: the speed sample fires at the state-flip instant, usually while
the truck is still stationary, which is how an earlier audit (A1.1) found "almost no interval looked
like driving".

So the four buckets the owner asked for — **total engine-on**, **driving**, **parked+stopped**, and
**avoidable** — are all derivable from data we already hold, and three of the four already exist as
`drive_sec` / `idle_sec` / `off_sec` on `vehicle_engine_days` and `idle_rollup_days` with ~24 h/day
coverage. **No new collector is needed.** What is needed is the fourth bucket.

### 3.2 — what the owner's rule ("APU truck, 10 h parked → at least 50% engine off") gets right

It gets the *instrument* right and the *constant* wrong, and the existing plan's §2 already argues
this correctly: a flat percentage is wrong in both directions. In mild weather a working APU carries
essentially the whole hotel load, so a 10-hour sleeper idle is ~100% avoidable, not 50%. At −15 °F
even a good APU cannot hold cab temperature and a real slice of main-engine idle is legitimate.

But the owner's instinct is right about something the current model has lost: **a target the fleet
can be held to is more useful than a verdict the fleet never receives.** The current design would
rather say nothing than say something approximate, and it has been saying nothing for 203 trucks.

The resolution proposed here is to separate the two claims, which are currently fused into one
number:

1. **Measured, always reportable, no equipment knowledge needed:** for every truck, every day —
   engine-on hours, driving hours, idle hours, engine-off hours, and the idle share of engine-on
   time. This is a *measurement* and it is already computable for 160 trucks a day.
2. **Benchmarked, needs a target not a verdict:** how this truck's rest-period idle compares to a
   peer-group or regulatory target. Reportable for every truck, with the equipment flag *sharpening*
   the target rather than gating the figure.
3. **Judged, needs equipment evidence:** dollars of avoidable waste attributable to a specific truck.
   Keep today's strict rule here — this is the number that ends up in a coaching conversation, and
   it should stay unblamable.

Today only (3) exists, so the product has no answer for a truck whose equipment nobody recorded.

### 3.3 — the regulatory and published-benchmark research the owner asked for

**Hours of service — 49 CFR §395.** A property-carrying CMV driver must accumulate **10 hours**
off-duty before a shift. Those 10 hours may be consecutive, or split as **8/2** or (since the 2020
Final Rule, effective 2020-09-29) **7/3** — one period of at least 7 or 8 consecutive hours in the
sleeper berth plus a second of at least 2 or 3 consecutive hours off duty or in the berth, in either
order, totalling at least 10. Other splits (6/4, 5/5) do not qualify. A pilot program allowing
relief from the 7-consecutive-hour requirement was proposed in September 2025 for ~256 drivers; until
a driver holds written approval, only 8/2 and 7/3 are legal. **This is the right frame for "rest
period" in the model** — it is the interval in which hotel-load idle is the coachable behaviour, and
it comes with a regulator's definition rather than ours.

**Anti-idling law.** There is **no federal anti-idling rule**. 19 states plus D.C. set a statewide
commercial limit, most commonly **5 minutes** (California, Maine, Maryland, Massachusetts, New York,
Oregon, Pennsylvania among them). New York's 6 NYCRR Subpart 217-3 sets 5 minutes for vehicles over
8,500 lb GVWR with first-violation fines of $500–$18,000; New York City enforces 3 minutes (1 near
schools). California's CARB rule is 5 minutes statewide with $300–$1,000 fines; South Coast AQMD
enforces 2 minutes in greater Los Angeles. Texas has no statewide rule but Houston and Dallas have
local ordinances. **Common exemptions matter as much as the limits:** EPA-verified or CARB-compliant
idle-reduction technology (which covers most modern APUs), extreme temperature (many jurisdictions
below 40 °F or above 75 °F), sleeper-berth rest in a number of states, PTO operation, safety and
maintenance. City and county ordinances are frequently stricter than the state rule.

⚠ This is a compliance surface, not just an efficiency one, and it is **not currently modelled at
all** — we hold `lat`/`lng` on every park session and never ask which jurisdiction's limit applied.

**Published idle benchmarks.** USDOT: long-haul trucks idle ~6 h/day, **~1,830 h/yr**, ≈ $5,640/truck/yr.
DOE/AFDC: ~**1,800 h/yr** for rest periods alone. ATRI: ~**1,456 h/yr** for long-haul sleepers.
EPA SmartWay: eliminating unnecessary idling saves a typical long-haul combination truck **over 900
gallons/year**, and EPA estimates ~30% of the existing fleet carries some idle-reduction technology.

**Idle fuel rates.** DOE's fuel-cell APU analysis used **0.64 gal/h** main-engine idle against
**0.22 gal/h** for an APU. Industry sources cite up to ~1.0 gal/h main engine against 0.15–0.25 gal/h
for an APU — a **75–85% reduction** in fuel for the same cab-comfort load. Our configured
`idle_gal_per_hour = 0.80` sits mid-range and is defensible; **the APU's own burn is not modelled at
all**, so "avoidable" currently means "all of it" rather than "the 75–85% difference".

**Warm-up, which is not the same as the operational grace period.** OEMs put engine warm-up at
3–5 minutes (PACCAR: "idle 3–5 minutes before operating with a load"; Navistar: "2 to 3 minutes").
The 15-minute On-Duty grace in IDLE-AVOIDABLE-HOS.md §1 is a *work* allowance — pre-trip, paperwork,
short loading — and should keep being described as one. Our `min_idle_minutes = 5` setting is
consistent with the state limits and with OEM warm-up; it is not a work grace.

Sources:
[FMCSA split sleeper berth (Federal Register, 2025 pilot)](https://www.federalregister.gov/documents/2025/09/17/2025-17939/hours-of-service-of-drivers-pilot-program-to-allow-commercial-drivers-to-split-sleeper-berth-time) ·
[EPA Compilation of State, County, and Local Anti-Idling Regulations](https://www.epa.gov/sites/default/files/documents/CompilationofStateIdlingRegulations.pdf) ·
[Truck idling laws by state](https://www.fleetservice365.com/tools/truck-idling-laws-by-state) ·
[NYSDEC heavy duty vehicles](https://dec.ny.gov/environmental-protection/air-quality/controlling-motor-vehicle-pollution/heavy-duty-vehicles) ·
[EPA SmartWay idle reduction](https://www.epa.gov/smartway/idle-reduction) ·
[DOE/AFDC HDV idling fact sheet](https://afdc.energy.gov/files/u/publication/hdv_idling_2015.pdf) ·
[DOE fuel cell APU analysis](https://www.hydrogen.energy.gov/pdfs/9010_fuel_cell_apu_trucks.pdf) ·
[NAS, Engine Idle Reduction](https://www.nationalacademies.org/read/13288/chapter/8) ·
[ATRI Operational Costs of Trucking](https://truckingresearch.org/about-atri/atri-research/operational-costs-of-trucking/)

### 3.4 — the proposed model (for the owner to rule on)

**D-IDLE-A (proposed).** Split the one number into the three claims of §3.2. The day grain becomes:

```
engineOnSec = driveSec + idleSec          (already stored)
parkedSec   = idleSec + offSec            (already stored)
idleShare   = idleSec / engineOnSec       (reportable for every truck with coverage — no equipment needed)
```

Reportable for ~160 trucks/day today. This alone replaces the 35-truck page with a fleet page.

**D-IDLE-B (proposed).** Classify every park session's idle by HOS duty status, which we already
join: `rest` (SB, or OFF long enough to be a qualifying 49 CFR §395.1(g) period), `work` (On-Duty not
driving, beyond the 15-minute operational grace), `driving`, `unknown`. Rest-period idle is the
coachable target; work idle is not blamed. This exists (`hos_rest_sec` / `hos_work_sec` on both
tables) and is `sufficient` on 6,526 of 10,032 September sessions — usable now at session grain.
**Stop aggregating it worst-of-days to the day grain** (D-IDLE5) — aggregate the evidenced seconds,
not the statuses.

**D-IDLE-C (proposed).** Replace the binary "had an alternative" with a **ladder of equipment
evidence**, each rung carrying its own target and its own confidence, none of them blocking the
measurement:

| Rung | Source | Effect |
|---|---|---|
| confirmed | admin flag on the Vehicles page | full verdict, dollars attributable (today's rule) |
| demonstrated | `learned_capability = apu` + `engine_off_observed` over N sessions | benchmark target, flagged "unconfirmed equipment" |
| contradicted | learned says `continuous_only` while the flag says APU | a **data-quality finding**, not a verdict |
| unknown | neither | measurement only, plus a prompt naming the truck |

**The prompt is the point.** 203 trucks have never been asked. A report that names them — "139 trucks
demonstrably rest engine-off but have no equipment recorded; confirm them here" — converts an unticked
checkbox from an invisible gate into a two-minute job.

**D-IDLE-D (proposed).** Model the APU's **own** burn. "Avoidable" should be the **difference**
(0.80 − ~0.22 gal/h ≈ 0.58 gal/h, a 72% reduction), not the whole 0.80. Today's figure overstates the
recoverable saving by roughly a quarter for exactly the trucks it does judge.

**D-IDLE-E (proposed).** Add the jurisdictional limit. Every park session carries `lat`/`lng`; a
session over the local limit in a state that has one is a **compliance** finding independent of
equipment and independent of HOS. This is new capability, not repair, and it is the one item here
that is worth money beyond fuel.

**D-IDLE-F (proposed).** Fix or retire `optimized_cycling` (D-IDLE4). Thirty-six trucks are flagged
for it and it has never fired once; whichever way that resolves, the current state is a flag that
means nothing.

---

## 4. Open questions

- **Q1.** D-PREC1's fix: drop an allocation whose miles round to zero (and its gallons with it), or
  round both at the same scale? The first is safer — it never invents a gallon with no mile — and
  loses a rounding artefact's worth of fuel. **Recommendation: drop the pair.**
- ~~**Q2.** Should `getFleetMpg` **withhold** a window whose fuel data does not reach the window's end,
  or report it with a warning? Finance withholds (`latestReportableMonth`). **Recommendation:
  withhold, for the same reason** — a per-mile figure over part of a period reads plausibly and is
  wrong.~~ **ANSWERED 2026-09-21, and the recommendation above was the wrong half.** Withholding
  declines to report a bias that can simply be removed: the bias exists because the numerator's
  window and the denominator's window are different lengths, so making them the SAME length fixes it
  outright. `resolveFleetMpgWindow` therefore **clamps** `to` to the roll-up's watermark before
  either source is read, and refuses only the two cases a clamp cannot rescue — nothing to clamp to
  (the roll-up never ran, or stops before the window opens), and a clamp that would answer a
  materially different question (below `MIN_WINDOW_COVERED`, 0.5). The clamped case is reported, not
  hidden: `partial`, `requestedTo` and `fuelThrough` travel on the wire and the trend card prints the
  sentence. Built in queue item 2; `fleetMpgWindow.ts` carries the reasoning.
- **Q3.** D-PREC4: does the Fuel Spend page move to measured odometer miles, or does it keep allocated
  miles and label them? Moving it makes one definition true; keeping it means the spend report stays a
  report about its own rollup. **Recommendation: keep allocated, label it on the page, and put the
  cross-source agreement check (`/api/fueling/mileage-agreement`, already built) next to it** — the
  +11.9% August drift is the finding, and hiding it behind a switch of sources would lose it.
- **Q4.** D-PREC7: label the four current-state cards, or range-scope them? **Owner's call** — it is a
  product question, not a defect.
- **Q5.** D-IDLE-C: is the owner willing to let a *demonstrated* (learned, unconfirmed) truck carry a
  benchmark target, given that it can never carry attributable dollars? This is the ruling that
  unblocks 139 trucks.
- **Q6.** D-IDLE-E: is jurisdictional idling compliance in scope for Silvicom 360, or is it a
  separate module? It is a safety/compliance surface, not a fuel one.
- **Q7 (new, 2026-09-21, raised by queue item 4).** The report endpoints
  (`/api/reports/transactions.csv`, `summary.pdf`) filter `fuel_transactions.fueled_at`; the
  dashboard card beside their button filters `business_date`. Item 4 made both windows correct **in
  their own terms** — the exports now carry carrier-zone instants, the card passes calendar days —
  but they are still answering two different questions, so an export can contain a fill the card did
  not count, at a station whose business date fell either side of its own midnight. Moving the
  exports onto `business_date` would make one definition true; it would also change which fills
  appear in a CSV a customer may already have reconciled against. **Owner's call, and deliberately
  NOT taken while shipping item 4** — the same shape as Q3 (D-PREC4), and probably the same answer.

---

## 5. Work queue

Ordered. Items 1–3 are repair; 4–6 are the architecture the owner asked for; 7+ is idling.

| # | Item | Why here |
|---|---|---|
| **1** | Fix `allocate()`'s rounding pair (Q1) + a `rollupDerive.test.ts` case built from the real split fill; re-run the sweep over a widened window to backfill 09-13 → today | Nothing on the fuel side can be judged until `fuel_spend_days` is current |
| **2** | Time-coverage refusal in `getFleetMpg` (Q2), carrying a reason a fleet manager can act on | The fix that makes today's 8.61 impossible rather than merely corrected |
| **3** | Alert on a rollup that throws. A scheduler that fails silently for seven days is the real defect behind #1 | One log line was the only evidence |
| **4** | Retire the browser-side window construction: one day definition per surface, passed as calendar days to endpoints that take calendar days (D-PREC5, D-PREC6) | The off-by-one is a symptom; the window built in the browser is the cause |
| **5** | Move the dashboard's aggregation behind the API (D-PREC8) | Structural cause of #4; also removes six paged table reads from the browser |
| **6** | Re-run the McLeod financial sweep; fix August; fix the `finance-freshness` timeout (D-PREC9, D-PREC11) | The finance section is running on July |
| **7** | Idling: measurement/benchmark/verdict split (D-IDLE-A, D-IDLE-B) | Turns a 35-truck page into a 160-truck page with no new data |
| **8** | Idling: equipment ladder + the "confirm these trucks" prompt (D-IDLE-C) | Unblocks 139 trucks with a two-minute admin job |
| **9** | Idling: APU's own burn in the avoidable term (D-IDLE-D) | Today's dollars are ~25% overstated for the trucks it does judge |
| **10** | Idling: fix or retire `optimized_cycling` (D-IDLE-F) | A flag on 36 trucks that has never once fired |
| **11** | Idling: jurisdictional limits (D-IDLE-E) | New capability; needs Q6 first |

---

## 6. Progress log

Append dated lines at the END of this section. Do not edit rows above.

- **2026-09-20** — Audit opened and completed against production. D-PREC1..D-PREC11 and
  D-IDLE1..D-IDLE6 measured; D-IDLE-A..F proposed. Nothing built. Root cause of the reported
  8.6-vs-6.8 symptom is D-PREC1, reproduced exactly (8.61 total against 6.28/6.83/6.82/7.10 weeks).
  Regulatory research for §3.3 done from primary and secondary sources, cited inline.
- **2026-09-21** — **Queue item 1 merged** (PR #929, `cc1b60a`). `allocate()` now takes a day-slice
  whole or not at all. Verified end to end in production: the sweep ran at 01:41 UTC and rebuilt
  09-13 → 09-20 with `gallons_tractor` matching `fuel_transactions` **to the gallon on every day**
  (09-15 went from 431 to 7,589); the carrier's sweep marker moved for the first time since
  2026-09-15 08:55; and fleet MPG fell from **8.61 to 6.91**, with the 09-14 week going from a
  withheld 22.82 to 6.98. Predicted ~6.9 from the weekly figures before touching anything.
  ⚠ One loose end from §2 closed while watching it: the `last_fuel_sweep_at` of 22:31 quoted in the
  audit belonged to the *FuelGuard EFS QA* org, not to Silvicom — the carrier's own marker had been
  stuck at 2026-09-15 08:55 for **136.6 hours**, which is why no manual backfill was needed.
- **2026-09-21** — **Queue item 2 built.** `resolveFleetMpgWindow` + `fleetMpgWindowNote`
  (`packages/shared/src/fuelSpend/fleetMpgWindow.ts`), read by `getFleetMpg` / `getFleetMpgSeries`
  before either source is fetched. **Q2's recorded recommendation was revised** — see §4: the answer
  is to clamp first and refuse second, not to refuse. `FleetMpgPeriod` gains `requestedTo`, `partial`
  and `fuelThrough`; the trend card prints the sentence and the hero tile's caption gives the dates
  precedence over the coverage percentage (the term that read 0.966 throughout the outage).
  Mutation-checked six ways: clamping the label only, clamping the gallons only (the original bug),
  dropping the refusal override, bucketing over the requested window, removing the floor, and — on
  the web side — a caption that never renders and one that always does.
- **2026-09-21** — **Queue item 3 built.** The sweep no longer fails in private. Three parts, in the
  order they matter:
  1. **The failure became a row.** `runDueFuelSweeps` now runs each org's sweep through the job
     ledger as kind `fuel_spend_rollup` (`sweepThroughLedger`), so a throw leaves a `failed` row
     carrying Postgres's own error text and a `finished_at` — the evidence that did not exist
     between 09-13 and 09-20, when one `console.error` line every six hours was the whole record.
     It also closes the hole `fuelSpendRollupScheduler.ts`'s own header admitted to: the (org, kind)
     slot means a second process is now REFUSED by the database rather than trusted not to exist.
     ⚠ A ledger that cannot be written does NOT stop the rebuild — observability that gates the work
     it observes turns a reporting outage into a data outage, which is worse than the silence.
  2. **The silence became a finding.** `fuelSweepFreshness.ts` is `financialFreshness.ts`'s shape
     (D-FIN3) applied to fuel: a failed attempt is a warning keyed by the job id, a marker older
     than `SWEEP_STALE_AFTER_MS` is a warning keyed by the DAY (so it re-alerts daily while down,
     not every six hours and not once ever), and past 72 hours it is critical. It goes to
     `rolesThatManage("fuel")` — not the accounting office — as `notify()` rows plus ONE email a run.
  3. **The threshold is derived, not chosen.** `fuelSweepCadence.ts` now holds the sweep's promise in
     one place, read by both the scheduler that keeps it and the pass that judges it.
     `SWEEP_STALE_AFTER_MS = SWEEP_DUE_AFTER_MS + 2 × CHECK_INTERVAL_MS` = 32h, which is exactly "the
     sweep came due and then two consecutive attempts did not complete it". A healthy org's marker is
     never older than 26h at a check, so 26h says nothing and a number like "a day" would have been
     a false alarm every night.
  The freshness pass runs for **every** org on every check, not only the swept ones — an org whose
  sweep keeps failing is due at every check and completes none of them, which is precisely the org
  the pass exists for.
  Mutation-checked nineteen ways; eighteen were killed on the first pass and the survivor was real:
  swapping the recipients from `fuel` to `accounting` changed nothing any test could see, because
  `supabaseRecorder` does not apply filters. Pinned by asserting the roles the query actually carried
  against `rolesThatManage("fuel")` — read from the matrix, never re-typed.
  Along the way, `usersWhoManage(admin, orgId, section)` was extracted to org's `memberLookup.ts` and
  the two hand-written copies in `financial/officeRecipients.ts` and `evidence/dqAlertScheduler.ts`
  now call it. Three copies of "a service-role read of someone else's table, paired with a role list
  that has to agree with the section matrix" was one short of a fourth that disagrees.
  ⚠ **Stated rather than discovered later:** the pass rides the fuel scheduler's own timer, so a
  scheduler that is not running cannot report that it is not running. The case it genuinely cannot
  see is `RUN_SCHEDULERS_IN_PROCESS=false` on the `api` service itself; the reader-facing half of
  that is already covered by item 2's window clamp. **Follow-up, not a blocker:** `GET
  /api/org/jobs/failed` now returns these rows and **no page renders that endpoint** — a Data & sync
  card for `fuel_spend_rollup` needs a manual-trigger endpoint the rollup does not have, so it was
  recorded here rather than half-built.
- **2026-09-21** — **Queue item 4 built.** The browser no longer invents instants.
  `packages/shared/src/calendarDay.ts` (which already held `exclusiveEndYmd`) gains the vocabulary
  the five surfaces were missing: `todayInZone`, `dayRangeInstants`, `shiftDay`, `daysInRange`, and
  the zone-parameterised wall-clock pair — `efsTime.ts`'s two-pass DST fixed point, generalised, with
  `efsTime.ts` now calling it so there is one implementation rather than two. **The rule it encodes
  is that the COLUMN decides**, not taste: a `date` column takes the picked `YYYY-MM-DD` untouched,
  a `timestamptz` column takes a half-open instant interval in the CARRIER's zone, and a UTC instant
  is what the old code produced by accident and what nothing should choose on purpose.
  `apps/web/src/composables/useOrgTimezone.ts` is where that zone comes from.
  Fixed: `OperatingMetricsWidget` (passes days through — this is the 104-fills-instead-of-45 card),
  `DashboardPage` (default window + both exports), `ReportsPage`, `useAnomalies`, and the idle four
  (`useIdleBreakdown`, `useIdleDrivers`, `useLongIdles`, `useIdleScores`). `IdleDateFilter` now says
  `CalendarDay`: it used to carry a decorated instant that two of its four readers immediately sliced
  back to a day, which is the round trip D-PREC5 is about, inside one type.
  ⚠ Every zone-dependent query carries the zone in its KEY — it starts at the column's default and
  changes when the org row lands, and a query that did not re-run on that change would keep the
  guess's numbers on screen.
  Mutation-checked: five mutants on the dashboard and the widget, all killed — but only after a
  **surviving** one was fixed. Swapping the carrier's zone for the viewer's changed nothing any test
  could see, because CI runs on America/Chicago; the tests now pin a carrier zone of America/Denver
  precisely so the two cannot coincide. **Q7 opened in §4** and deliberately not answered here.
  ⚠ Two inline `operating_hours` reads remain in `useDashboard.ts` and `useDriverPerformance.ts`.
  They are inside the browser-side aggregation that item 5 moves behind the API, so converting them
  now would be work done twice; `useOrgTimezone`'s header says so rather than leaving it to be found.
- **2026-09-21** — **Queue item 5, step 1 merged** (PR #934, `dba4a4d`): migration 0347's
  `dashboard_summary`, a function with no reader, verified applied in production and present in
  `pg_proc` with the `p_org` + `security invoker` posture D-FC1 asks for.
- **2026-09-21** — **Queue item 5, step 2 built.** The idle cost basis is server-side, and there is
  now ONE of it. `pickIdleCostBasis` (pure, `packages/shared/src/idleCostBasis.ts`) holds the
  three-tier rule; `resolveIdleCostBasis` (`apps/api/src/modules/idle/idleCostBasis.ts`) is the I/O;
  `GET /api/idle/cost-basis` is the door, gated `safety: view` because that is what
  `surfaceCatalogue` gates the Idling surface on. Four things worth writing down, each measured:
  1. **The report and the page disagreed, and the report was the wrong one.** `fuelIdleVerdict`
     resolved its own basis from `idle_settings` alone, so a day with no `fuel_price_days` row was
     charged **$4.000/gal** in the fuel-spend document and the truck-stop median on screen. Against
     production on 2026-09-21 that median is **$5.873/gal**, and what the fleet actually paid those
     days was **$5.79–$6.22** (`fuel_price_days.actual_price_per_gal`, 09-10 → 09-21). So the
     report's unpriced days were understated by about a third, and unifying moves the number toward
     the fact. Priced days are untouched — they were already charged what the fleet paid.
  2. **The board is read through its owner, not through a waiver.** `fuel_prices` is `layer: raw`
     and sealed to `posted-prices` by `check-table-access.mjs`, so the median is computed there
     (`readRecentDieselMedian`) and `idle` calls it across a new `idle -> posted-prices` edge. This
     is §7.2b's declined-attempt ruling applied a second time: all 24 existing `raw-access-waiver`
     lines are an owner acting on its own table, and a foreign reader taking a shortcut would have
     been a new kind. A new arrow instead of a new hole.
  3. **The Idling page's median has never been the window it claims.** The composable asked
     `fuel_prices` for `.limit(5000)`; PostgREST caps a response at 1,000, so the page has been
     taking the median of the 1,000 most recent rows. Measured 2026-09-21: **$5.978 capped against
     $5.873 over the whole 14 days**, a 1.8% difference. The server read pages, so this is a defect
     closed, not a definition changed — and it is the number the page will show once its composable
     is swapped.
  4. **Reading it costs 1,545 ms, so it is cached for five minutes.** 7,503 rows over 14 days is 8
     sequential round trips, measured against production. That is affordable once and unaffordable
     on every Dashboard load, which is what step 3 puts in front of it, so `dieselMedian.ts` holds
     the `liveMapBoardCache` pattern: promise cached per org, failures never cached, TTL of 5
     minutes — the same interval the browser composable refetched on, so no surface becomes staler
     than it was. ⚠ **Its proper home is SQL** (§7.2b: a median over a window is a FACT), and it is
     not there because a function and its first reader cannot ship in one merge — the deploy window
     would serve the reader for ~3 minutes against a schema without the function. That is a
     migration PR of its own, recorded here rather than routed around.
  Mutation-checked: the tier order, the org filter, the paging past the cap, the section gate, and
  `priceSource`'s survival on the wire — each mutant killed a test that named it. Nothing on the web
  changed: `useIdleCostBasis` still computes its own basis until the composable swap, and until then
  the page and the endpoint differ by the 1.8% in (3).

---

## 7. Queue item 5 — survey before the build (2026-09-21)

Measured, not estimated. Nothing below is built; this section exists so the build is mechanical and
so the two decisions in it are taken by the owner rather than by whoever types first.

### 7.1 What the browser actually reads

`useDashboard.ts` is described in §1 as paging "six raw tables". It is **ten reads across six
modules**, and `useIdleCostBasis` — a second composable feeding the same fold — is two of them:

| read | table | owner module | layer | cross-module reader needed? |
|---|---|---|---|---|
| fills, paged | `fuel_transactions` | `fuel` | core | edge exists (`insights -> fuel`) |
| open cases, paged | `anomalies` | `anomalies` | derived | edge exists |
| case → driver, N×100 `.in()` | `fuel_transactions` | `fuel` | core | same edge |
| unit numbers | `vehicles` | `roster` | core | **new edge** `insights -> roster` |
| driver names | `drivers` | `roster` | core | same |
| operating timezone | `organizations` | `org` | core | edge exists |
| idle seconds, paged | `idle_rollup_days` | `idle` | derived | **new edge** `insights -> idle` |
| declined count (head) | `declined_transactions` | `fuel` | **raw** | ⚠ **sealed** — must go through `fuel`'s index |
| all-time coverage | `telematics_coverage_buckets()` | rpc | — | unsealed |
| burn rate + price | `idle_settings`, `fuel_prices` | `idle` / prices | unsealed | new edge covers it |

⚠ **`declined_transactions` is `layer: raw`**, so `check-table-access.mjs` seals it to its collector:
the API may not select it directly the way the browser does. The browser gets away with all ten
because RLS scopes them; **the API reads with the service role and every one of these needs its own
`.eq("org_id")`, proven by `expectOrgScoped`.** That is the single biggest source of new surface
area in this item, and the reason it is not a mechanical copy of the composable.

### 7.2 Two decisions — RULED 2026-09-21

⚠ **Q8's premise was wrong, and it is corrected here rather than quietly dropped.** §7.2 as first
written said the repo holds two contradicting precedents. It does not. **D-FC1 is a SECURITY
contract, not a mechanism preference**: 0246 was `security invoker` and relied on RLS, which is true
for a browser session and false for `apps/api` reading with the service role — so a server-rendered
PDF read every carrier in the database. `coalesce(p_org, auth_org_id())` is the fix for THAT. §1.4
says "if you write a set-based function, give it this contract"; it never says "prefer SQL to an
endpoint". And `telematics_coverage_buckets()` (0322) already replaced a paged browser read **on
this very dashboard** — 16 sequential round trips over 15,948 rows, "which is why the figure could
not live on this page at all" (Q-SAM8). That is the same precedent, not a competing one.

- **Q8 — RULED: all three, at a named seam.** `aggregateDashboard` is three kinds of work wearing one
  name. Roughly 90% is set-based arithmetic — `sum`, `count filter`, `group by` day, `order by
  critical desc limit 5` — and that is the part that pages 1,400+ fills into the browser. The chunked
  `N×100 .in()` lookup for anomaly drivers exists ONLY because the browser cannot join; in SQL it is
  a join and the loop disappears. The remaining ~10% is product judgement its own comments already
  defend: `coveragePct` null rather than 0, `allTimeCoveragePct ?? null` and never `?? 0` ("0%
  corroborated is an alarming claim to make on the strength of a missing argument"), `round2`,
  `movingSpend`'s floor at zero, and zero-filling `spendTrend` so a no-spend day is a real $0 day.
  So: **SQL returns the measurements, TypeScript owns the verdict, the API is the door.** The
  reduction belongs in SQL because that is where the facts are — the org timezone, `business_date`
  and the roll-up watermark are all columns, and D-PREC8's own diagnosis is that the browser "has no
  access to" them. It is reached through the endpoint rather than called from the browser for three
  independent reasons: the browser must stop reading six modules' tables whatever happens to the
  arithmetic; the endpoint is where role and money gating live; and `declined_transactions` is sealed
  `raw`, so something server-side must route through `fuel`'s index regardless.
- **Q9 — RULED: the basis moves, and the Idling page reads the same answer.** Forced, not chosen.
  `movingSpend = max(0, tractorSpend − idleCostUsd)` is a FUEL figure that depends on the IDLE basis,
  so once the fold runs server-side the server cannot produce it without the basis — leaving
  `movingSpend` to be assembled in the browser from server parts, which rebuilds the exact split this
  item exists to remove. The resolver moves into the `idle` module (`idle_settings` is idle's data),
  is exposed through idle's index, and is consumed by BOTH the dashboard endpoint and an idling
  endpoint. One resolver, two readers. ⚠ `priceSource` (`truck_stops | settings | default`) must
  travel on the contract: the Idling page DISPLAYS it, and a contract that drops it silently removes
  an explanation that page gives today.

### 7.2a The trap, written where the SQL is and not where the composable was

**D-PREC7 is an asymmetry, and it is deliberate.** Four cards — severity, top vehicles, top drivers,
active alerts — are NOT range-scoped, so each agrees with the Alerts page it links to; the fills are.
Anyone writing this function "cleanly" against one window will silently range-scope all four and
change what they show, **and no test will fail**. Migration 0347's header says so for that reason.

### 7.2b One more seam the ruling implies: a RULE stays in TypeScript, a FACT moves to SQL

The org timezone moves into SQL: it is a COLUMN — a fact, not a rule — so 0347 reads it itself and
buckets the spend series on the carrier's day.

⚠ **The declined-attempt count went the other way, and the GATE decided it, not me.** The first
draft of 0347 counted declines, taking the window as `p_declined_from` / `p_declined_to` parameters
because EFS prints reject times in a fixed zone whatever the station's own zone is — a rule about a
vendor, already written once in `efsRejectDayWindow` and not one to copy into SQL. `lint:boundaries`
refused the migration: `declined_transactions` is `layer = raw` and sealed to its collector, and
**all 24 existing `raw-access-waiver` lines are the OWNER acting on its own table** — not one is a
foreign reader taking a shortcut. A waiver here would have been the first of a new kind.

So the count stays with `fuel` and the endpoint asks through that module's index. The function is
better for it: those two parameters existed only to carry a window the function could not compute,
which was a wart rationalised rather than removed. **§7.1's "10 reads become 1" is therefore
"10 become 2"** — and that is the honest figure.

### 7.2c Sequence — four steps, none leaving a split state

1. **The migration alone** — the function, with no reader. (`lint:migration-ordering` wants exactly
   this, and a function nothing calls cannot break a deploy window.) ← **step 1, merged, PR #934**
2. **The cost-basis resolver** in `idle`, server-side, plus the idling endpoint. Q9's half FIRST, so
   the dashboard can depend on it rather than race it. ← **step 2, this PR** (what it
   turned out to need is in §6's 2026-09-21 entry)
3. **The dashboard endpoint** — function + `aggregateDashboard`, returning `DashboardSummary`
   **unchanged**.
4. **The web swap** — `useDashboard` becomes one `apiFetch`. Ten reads become one.

Only step 4 changes what anybody sees, and it flips atomically. Because the returned SHAPE is
identical, step 4 is a pure substitution and every existing dashboard test keeps its meaning — which
is the property that makes a move this size safe to attempt at all.

### 7.3 Size, honestly

Four owner modules need exported readers that do not exist yet, two new boundary edges, one sealed
table to route through `fuel`'s index, a contract in `packages/shared`, the endpoint, the web swap,
and org-scoping tests on every new query. **This is not a one-sitting change**, and a half-moved
aggregation — some tiles server-side, some still folded in the browser — is worse than either end
state, because the two halves would disagree exactly like the 8.61-vs-6.8 symptom that opened this
audit. It should be started with the decisions above already taken.
