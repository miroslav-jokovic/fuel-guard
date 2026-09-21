# HANDOFF — data precision, 2026-09-21

Where the 2026-09-20 precision audit stands, what shipped since, and what the next session should
pick up. **The plan is `DATA-PRECISION-AUDIT-2026-09-20.md`; read its §6 progress log from the END,
not this file, for the per-step record.** This is the orientation, not the queue.

---

## 0. Why this exists

The owner reported, on 2026-09-20: the Fleet overview showed **8.6 MPG** on its headline tile while
the trend chart beneath it drew **6.8–7.1**; some cards did not react to the date filter; and the
Fuel Spend page showed a third figure (7.28). Their framing was architectural — *"we have collectors
and we have a harness that should be in charge of all calculations, and the modular monolith should
be respected"* — and it turned out to be the right frame: every finding is a calculation happening
somewhere that could not see what it needed to see.

Everything below was measured against the production database or read from the Railway logs of
`@fleetguard/api`. Nothing is inferred from code alone.

---

## 1. What shipped, and what it is worth

| PR | Item | Effect |
|---|---|---|
| **#928** | The audit itself | `DATA-PRECISION-AUDIT-2026-09-20.md`, plus a SUPERSEDED-IN-PART banner on `IDLE-AVOIDABLE-HOS.md` |
| **#929** `cc1b60a` | Queue item 1 — the rollup constraint | `fuel_spend_days` unblocked; MPG **8.61 → 6.91** |
| **#930** | Queue item 2 — the MPG window clamp | A stalled sweep can no longer inflate the figure, and says so on the card |

### Item 1, verified end to end in production

`fuel_spend_days` had been frozen **2026-09-13 → 2026-09-20** for the whole carrier. Every rollup run
threw on `fuel_spend_days_miles_pair` (`supabase/migrations/0244_fuel_spend_days.sql:120`,
`check ((miles = 0) = (mpg_gallons = 0))`), and because `writeRows` upserts in **chunks** the throw
left the table half written and skipped `sweepStale` entirely.

One truck-day did it — a **split fill**, 158.06 gallons taken 0.2 miles after the previous one:

```
2026-09-12T16:17  gal=134.39  miles_since_last=857
2026-09-16T01:54  gal=158.06  miles_since_last=0.2     ← this one
2026-09-16T03:11  gal=2.59    miles_since_last=940.5   ← its partner, odometer mis-paired
```

Spread over four days by drive time, the 13th's share of 0.2 miles rounded to `0.00` at 2dp while its
share of 158.06 gallons survived as `1.565` at 3dp. `allocate()` now takes a slice **whole or not at
all**. Cost: 1.565 gallons of 100,481 — 0.0016% — and zero miles.

After the deploy the sweep ran at 01:41 UTC on 09-21 and rebuilt 09-13 → 09-20 with `gallons_tractor`
matching `fuel_transactions` **to the gallon on every day** (09-15 went from 431 to 7,589). Fleet MPG:

| Period | before | after |
|---|---|---|
| **08/22 – 09/21** | **8.61** | **6.91** |
| wk 09/14 – 09/20 | 22.82, withheld, drawn as a gap | 6.98 |

### Item 2, and the ruling it revised

⚠ **The plan's own Q2 recommended *refusing* a window whose gallons do not reach its end. That was
the wrong half, and §4 now records the revision.** The bias is a property of the numerator's window
and the denominator's window being different lengths — so making them the same length removes it
outright. `resolveFleetMpgWindow` (`packages/shared/src/fuelSpend/fleetMpgWindow.ts`) **clamps** `to`
to `max(day)` in `fuel_spend_days` **before either source is read**, and refuses only:

- the roll-up has never derived a day;
- it stops before the window opens — blaming the **feed**, never `computeFleetMpg`'s *"no tractor
  fuel was purchased in this period"*, which is true about the table, false about the fleet, and
  sends a reader to check their fuel cards;
- the clamp leaves under `MIN_WINDOW_COVERED` (0.5 — and its doc comment says plainly that it is the
  one threshold here with no measurement behind it, and what would change it).

`FleetMpgPeriod` gained `requestedTo`, `partial` and `fuelThrough`; the trend card prints the
sentence and the hero caption gives the dates precedence over the coverage percentage.

---

## 2. The five traps this work found

Each of these cost time or nearly produced a wrong conclusion. They are the reason to read this file.

1. **`measuredShare` cannot see a stale feed.** It read **0.966** throughout the outage. It is the
   share of the period's FUEL with a measured distance behind it — a statement about TRUCKS, where
   the failure was about TIME. `fleetMpg.ts` had said exactly that in its header since the module was
   written, and nothing acted on it. A term nothing acts on is documentation, not a guard.
2. **`last_fuel_sweep_at` is the health signal, and there are TWO orgs.** `markFuelSweepComplete`
   stamps only on success, so a stuck marker IS a dead sweep — the carrier's had been stuck at
   2026-09-15 08:55 for 136 hours. The audit's first pass quoted a healthy 22:31 marker, which
   belonged to the *FuelGuard EFS QA* org: `max()` over `organizations` hid the failure.
3. **`railway logs` returns a BUFFER, not a tail.** Grepping it re-emits pre-deploy failures as if
   they were new; I raised a false alarm that way. Gate any log check on `/api/version` reporting the
   expected commit first.
4. **Run suites with the EXACT CI command.** Root `npx vitest run packages/` fails on `.vue` files
   and `@/` aliases and looks exactly like a real regression — it reported 13 failing files that were
   all green under `pnpm -r --filter '!@silvicom/api' --filter '!@silvicom/web' test`.
5. **Adding a query in front of an existing one silently re-points positional assertions.** The
   watermark read became `forTable("fuel_spend_days")[0]`, and three assertions quietly became
   assertions about it. One in the route test would have stayed green while the gallons read vanished
   entirely, because the watermark query also carries `org_id` and no `vehicle_id`. They select by
   query SHAPE now.

---

## 3. What is still wrong (nothing below is built)

### Fuel

- **D-PREC4 — two live MPG definitions.** Dashboard uses measured odometer; Fuel Spend uses allocated
  `fuel_spend_days.miles`. Jul **6.84 vs 6.98** (+1.6% miles); Aug **6.88 vs 7.52** (+11.9%). The
  August allocated drift is the consolidation plan's open Q3 and has roughly tripled. `lint:mpg`
  cannot catch it — it checks arithmetic, not provenance. **Q3 recommends keeping allocated, labelling
  it, and putting `/api/fueling/mileage-agreement` (already built) beside it.**
- **D-PREC5 / D-PREC6 — the date boundary.** `OperatingMetricsWidget.vue:42` builds
  `new Date(\`${from}T00:00:00\`).toISOString()` at the BROWSER's midnight and hands it to an RPC
  whose params are `date`. For a CDT viewer picking 08/09–08/09 the `to` casts to **08/10**: 104
  fills instead of 45, on the same card whose neighbouring tiles are correct. Same shape live in
  `DashboardPage.vue:101` (exports), `ReportsPage.vue:30`, `useAnomalies.ts:89`,
  `useIdlingPage.ts:28`. And `DashboardPage.vue:44`'s `isoDay(new Date())` is UTC, so after 19:00
  Central the default window ends **tomorrow**.
- **D-PREC7 — four cards ignore the date filter** (severity, top vehicles, top drivers, active
  alerts) by design, and none of them says so. **Owner's call, Q4.**
- **D-PREC8 — the dashboard computes in the browser**, paging six raw tables and folding with
  `aggregateDashboard`. It is the structural cause of the two above.

### Finance

- **D-PREC9** — `mcleod_financial` last synced **2026-09-10**. `mcleod_gl_days`: Jun 1,206 rows/30
  days, Jul 1,152/31, **Aug 23 rows/9 days**, Sep none. August's `finance_month_closes` reads
  **`gl_revenue = 0`**.
- **D-PREC10** — every month Mar–Jul is `open` with six-figure drifts (Jul: billing $218,579, fuel
  −$132,913, settlements $90,441; Apr fuel −$649,354). Never once `hardened`.
- **D-PREC11** — `[finance-freshness]` **times out** for org `07fe4058`, so the check that would warn
  about D-PREC9 is itself broken for one of the two orgs.
- ✅ The Fleet report's own guard (`latestReportableMonth` + `missing` + "figures as of") is **working**
  and should be opening on July. That is the pattern the fuel side was missing, and item 2 lifted it.

### Idling — see `[[idling-verdict-layer-refuses-75pct]]` and plan §3

The symptom ("only 30–35 trucks") is backwards from the cause. Data is good for **~160 trucks/day at
~24 h coverage**; the verdict layer scores 30–35 because `has_apu` is **null on 203 of 272** vehicles
and `idleAvoidable.ts` grants avoidability *solely* by that flag. The temperature envelope is
`evidenced` for **zero** trucks; `optimized_cycling` has fired **zero** times against 36 trucks
flagged for it. Learned capability says `apu` for **156** trucks, so ~139 demonstrably rest
engine-off and are scored as if they had no alternative.

⚠ **Correct the premise before designing.** There is no 3-second engine feed: the 5-second feed is
`types=gps` only and keeps **no history** (`vehicle_positions` is 203 rows, one per truck,
overwritten). Engine state already arrives from
`/fleet/vehicles/stats/history?types=engineStates&decorations=gps` as **state changes**, whose enum
splits `On` (driving) / `Idle` (stationary, running) / `Off`. **No new collector is needed.**

---

## 4. Start here next session

**Queue item 3 — alert on a rollup that throws.** Items 1 and 2 removed a cause and stopped its
effect being invisible on one card; the scheduler can still die quietly for a week, and that silence
is what turned a one-line bug into a seven-day outage found by eye. `[fuel-spend] … rollup failed:`
goes to `console.error` and nowhere else.

Then items 4–6 in plan §5.

### Two rulings owed by the owner, both blocking work

- **Q5 (idling)** — may a *demonstrated* (learned, unconfirmed) truck carry a **benchmark target**,
  given it can never carry attributable dollars? **This one ruling unblocks 139 trucks.**
- **Q6 (idling)** — is jurisdictional anti-idling compliance in scope for Silvicom 360, or a separate
  module? We store `lat`/`lng` on every park session and never ask which limit applied.

### An owner ACTION, not a code change

Re-run the McLeod financial sweep and fix August. Nothing in the repo can do this; the finance
section is running on July until it happens.
