# Load rates on Loads and the Dispatch board — plan

Owner request, 2026-11-19: show the price of every load on the Loads page and the Dispatch board.
Admins always see it. Every other role starts OFF and is switched on in Settings → Permissions.
The price comes from McLeod through the Board VM's connector.

Owner rulings, 2026-11-19:
- **No request to Alex.** The connector's login already reads `orders` (`SILVICOM-GRANTS.sql` header:
  "Already granted on LME … orders"), and we administer the VM. The update is ours to install. This
  deliberately sets aside the review step Alex asked for on 2026-09-24 (`docs/plans/mcleod/mail.md`,
  "send the new SQL file before it goes live") for this change; recorded here so nobody re-asks.
- Admin sees rates always; every other role is off by default and switchable in Settings.

Build starts 2026-11-20. Every fact below was measured or read in code on 2026-11-19/20; the source is
named beside each one. Nothing in this plan is open: §6 lists the two places where we chose and why.

---

## 1. What is true today (measured)

### 1.1 McLeod has the price, and fills it on every load

Read on `lme_analytics` (a restore dated 2026-10-09 per `msdb.dbo.restorehistory`), company `TMS`:

| Fact | Count |
|---|---|
| Open movements (status P/A) joined to an order | 151 |
| … with `orders.total_charge` > 0 | 151 / 151 |
| … where `total_charge = freight_charge + otherchargetotal` (±$0.01) | 151 / 151 |
| … where `freight_charge = rate × rate_units` | 151 / 151 |
| … `rate_type` | `F` (flat) 151 / 151 |
| … `total_charge_c` (currency) | `USD` 151 / 151 |
| `total_charge` range on open loads | $150 – $11,000, mean $4,580 |
| `otherchargetotal` > 0 on open loads | 21 / 151 (max $2,000) |
| Delivered movements in the 30 days before the restore with a charge | 2,998 / 2,998 |
| Loaded movements, last 90 days: `bill_distance_um` | `MI` 4,248 / 4,248 |
| … `bill_distance` missing or 0 | 84 / 4,248 |

So: **total = linehaul + other charges**, all US dollars, all flat-rated.

### 1.2 The price belongs to the ORDER, and one order has several movements

Our load = one McLeod **movement**. The connector joins movement → `movement_order` → `orders`, so every
movement of an order would carry that order's whole charge.

Last 90 days, 4,403 orders, by number of loaded (`L`) and empty (`E`) non-void movements:

| Loaded | Empty | Orders |
|---|---|---|
| 1 | 1 | 3,631 |
| 1 | 2 | 294 |
| 1 | 0 | 144 |
| 1 | 3–7 | 89 |
| 2 | 1–5 | 45 |
| 0 | 1 | 1 |

- **Empty movements repeat the order's charge.** All 3 open `E` movements on 2026-10-09 belonged to
  orders whose loaded movement was already delivered (statuses `D:L, D:E, P:E`). Showing a price on an
  empty movement would count the same freight twice.
- **45 orders (1.0%) have two loaded movements** (one order split across two trucks/legs). Examples:
  order 0132143, $3,620, billed 836 mi, legs of 377 + 513 mi. McLeod keeps one total for the order.

### 1.3 Where load data lives in Silvicom 360 (read in code)

- Connector: `DISPATCH_LOADS_SELECT` (`tools/mcleod-agent/queries.mjs`) is the ONE select behind the
  open board (`DISPATCH_LOADS`), the delivered backfill (`DISPATCH_LOADS_DELIVERED`) and the close read
  (line ~1246). Adding columns there brings them to all three.
- `mapDispatchMovement` (`tools/mcleod-agent/loads.mjs`) → `POST /api/tms/dispatch-movements` →
  `tmsDispatchMovementSchema` (`packages/shared/src/tmsDispatchMirror.ts`) → `ingestDispatchMovements`
  writes the raw `mcleod_dispatch_movements` (0364) → `projectDispatchMovements` →
  `applyMirroredLoads` (`apps/api/src/modules/loads/mirrorLoads.ts`) writes `loads`.
- The schema is a plain `z.object` (zod 4.6.7). It **drops unknown keys**, so a newer connector that
  sends rate keys to an older API is accepted and the keys are lost. That matters for the order in §5.
- The connector posts a movement only when its hash changed (`state.mirrored`, `loadHash`, agent.mjs
  ~891). If it sends rates before the API stores them, those movements are marked sent and **do not
  resend** until something else on them changes.
- **`loads` is readable column-by-column by every member of the org from the browser**: policy
  `loads_select … using (org_id = auth_org_id())` (0085), and a driver reads their own loads
  (`loads_driver_scope`, 0087/0371). **So a rate must never be a column on `loads`.**
  `mcleod_dispatch_movements` has RLS on and no policy (0364), so it is deny-all.
- API readers that put a load in front of an office user:
  `GET /api/dispatch/loads` (`listLoads`, `dispatchLoads/queries.ts`), `GET /api/dispatch/loads/:id`
  (`getLoadDetail`, `detail.ts`), `GET /api/livemap/dispatch-board` (`readDispatchBoard`,
  `livemap/dispatchBoard.ts`). The board's rows are cached per ORG for 20 s (`rowsCache`) and shared
  with the ETA recorder (`readBoardRows`). Reader-specific parts are added after the cache, in
  `readDispatchBoard` (driver warnings, note mentions), so rates go there too.
- The web app never reads `loads` directly (no `from("loads")` in `apps/web` or `apps/driver`).

### 1.4 The permission mechanism already exists

`EDITABLE_PERMISSIONS` (`packages/shared/src/rolePermissions.ts`) + `org_role_permissions` (0564):

- One switch per role, stored sparse. `effectivePermission` answers **admin = always true**, driver =
  always false, else the org's row, else the catalogue's `shippedRoles`.
- `shippedRoles: []` = admin only. That is exactly how `notes.manage_all` ships.
- Settings → Permissions → **"Other permissions"** (`NamedPermissionsCard.vue`) draws every catalogue
  entry with no per-entry code. Changes are written by `write_access_cell` with an audit row.
- API: `holdsNamedPermission(req, key)` (`org/namedPermissionGate.ts`) is read per request, never from
  the token. A failed read answers closed (admin still on). Web: `session.hasPermission(key)`, served
  by `/api/me`.
- It is **per role**, not per person (0564 has no user column). That matches the request.
- No migration is needed for a new key: 0564 checks only its shape `area.name`.

---

## 2. Decisions

**D-RATE1 — What we read.** Add to `DISPATCH_LOADS_SELECT`, all from `orders` (already granted) except
the count:
`total_charge`, `freight_charge`, `otherchargetotal`, `total_charge_c` (currency),
`bill_distance`, `bill_distance_um`, and
`order_loaded_movements` = count of non-void (`status <> 'V'`) movements with `loaded = 'L'` on the
same order and company (a correlated subquery on `movement_order` + `movement`, both granted).
Company is matched on every join (Alex's standing rule).
Not read (corrected 2026-11-20, R1): `rate`, `rate_units`, `rate_type`. On a flat-rated order (F on
13,453 of 13,478 loaded orders since 2026-01-01) the linehaul already IS rate × units, and no screen
reads them; a column nothing reads reads null forever (0383's rule).

**D-RATE2 — Where it is stored.**
- Raw: the same columns on `mcleod_dispatch_movements` (deny-all). Core is rebuilt from raw (D-LMR4).
- Core: a **new table `load_charges`**, one row per load, owned by the `loads` module. RLS on, **no
  policies** (deny-all from the browser), written only by the mirror projection with the service role.
  Columns (as built in 0639): `load_id` (PK, FK `loads` on delete cascade), `org_id`,
  `total_charge` numeric(16,2) NOT NULL, `linehaul` numeric(16,2), `other_charges` numeric(16,2),
  `currency`, `billed_miles` numeric(10,1), `order_loaded_movements`, `updated_at`. McLeod's own
  precision; no sign CHECK, because McLeod records negative other charges (10 orders since
  2026-01-01, as low as −$1,000). A row exists only when McLeod stated a total.
- Never on `loads` (§1.3: every org member and drivers can read `loads` columns).

**D-RATE3 — Which loads get a price.** Only loaded movements (`loaded = 'L'`). An empty movement gets
no `load_charges` row (§1.2: it repeats the order's charge). A movement whose `loaded` is null gets
no row either. **A voided movement (`V`, our `canceled`) gets no row** (added 2026-11-20, measured): all
622 voided loaded movements on orders since 2026-01-01 belong to orders McLeod voided too
(`orders.status = 'V'` on 622 / 622), so the price was never earned. A row a load already has is
deleted when McLeod voids it, turns it empty, or stops stating a total.

**D-RATE4 — Split orders.** When `order_loaded_movements > 1`, each loaded leg shows the order's full
total with the note "Order total · split over N trips". We do not divide it: McLeod does not divide it,
and an even split (or one by miles) would be a number McLeod never stated.

**D-RATE5 — Rate per mile** = `total_charge / bill_distance` (the order's billed miles, `MI` on every
row measured). Shown as "—" when `bill_distance` is missing or 0 (84 / 4,248). Not `loads.total_miles`
(the movement's distance): on a split order the leg's miles would inflate the rate.

**D-RATE6 — The switch.** A new catalogue entry in `EDITABLE_PERMISSIONS`:
key `dispatch.load_rates`, label "See load rates", description "See what each load pays — total,
linehaul, other charges and rate per mile — on Loads, the Dispatch board and a load's page. Without it
those figures are not sent to this person at all.", `shippedRoles: []`. Admin = always (resolver).
Every other role = off until an admin switches it on.

**D-RATE7 — Withheld by the server, not hidden by the screen.** The API adds a `charges` object to a
load only when `holdsNamedPermission(req, "dispatch.load_rates")` is true. Otherwise the key is
**absent** from the JSON. Readers that add it:
`GET /api/dispatch/loads`, `GET /api/dispatch/loads/:id`, `GET /api/livemap/dispatch-board` (current
and next load of each truck, added in `readDispatchBoard` after the org cache; `readBoardRows` stays
reader-independent). Readers that **never** add it: driver app (`/api/me/loads`), hazmat loads, ⌘K
load search, Exceptions, Activity, Ask AI, the live map's positions.

**D-RATE8 — What the screens show** (only when `session.hasPermission("dispatch.load_rates")`;
for anyone else the columns do not exist, so the picker does not list them):
- **Loads page:** two columns, "Rate" (total, `$4,580`) and "Per mile" (`$2.31`), visible by default,
  sortable, in the existing `dispatch.loads` column picker. Empty movements show nothing.
- **Dispatch board:** one column "Rate" (the current load's total), width `sm` (96 px), visible by
  default. Default columns sum to 976 px today (`dispatchBoardView.ts` header). +96 = 1,072 ≤ the
  1,104 px budget. Checked in a browser at 1440 px in the build.
- **Load page and truck drawer:** a "Rate" block with total, linehaul, other charges, per mile, and the
  split note when it applies.
- Money is formatted with the existing currency formatter used by Finance (located in the build; no
  new formatter).

**D-RATE9 — The contract during the switchover.** The new keys on `tmsDispatchMovementSchema` are
**optional**: absent = this connector does not read rates, and the ingest then leaves stored rate
values as they are; `null` = McLeod has none. This is a recorded exception to the file's
"every key is required" rule: the VM's connector runs the old code until it is updated, and a required
key would refuse the whole board at the door. **Removed by** step R5: once the VM runs the new
connector, the keys become required.

**D-RATE10 — Logs.** The connector logs counts only (Alex's 09-24 log rule): "N movements with a
rate", never an amount.

---

## 3. Build — PRs, in order

Each PR is one merge; the migration goes alone first (`lint:migration-ordering`: a column and its first
reader/writer in separate merges).

**R1 — migrations `0638_mcleod_dispatch_order_charges.sql` and `0639_load_charges.sql`** (two files
because the two tables belong to two modules, `lint:table-modules`, as 0383/0384 did).
- 0638: `alter table mcleod_dispatch_movements add column` × 7 (D-RATE1), all nullable, no default.
- 0639: `create table load_charges` (D-RATE2), `enable row level security`, no policies,
  `forbid_org_change` trigger as 0564 does.
- The table's owner (`loads`, layer core, budget 150 rows/day from 47/day measured) in
  `scripts/table-modules.json` and `docs/ARCHITECTURE.md`; a producer waiver in
  `check-table-producers.mjs` naming R2. The writer goes into `scripts/table-writers.json` in R2,
  with the writer.
- PGlite matrix `supabase/tests/load-charges.test.mjs`: an authenticated office user and a driver both
  read **zero** rows from `load_charges`; the service role reads them. Must print `RESULT`.

**R2 — data path, no screen** (after R1 is merged).
- `tmsDispatchMirror.ts`: the seven optional keys (D-RATE9).
- Remove `load_charges` from `check-table-producers.mjs`'s waivers; add its writer to
  `scripts/table-writers.json`.
- `dispatchMovementIngest.ts`: write the raw columns when the batch carries them; leave them untouched
  when it does not (the batch's rows either all carry them or none do — refuse a mixed batch with 400).
- `mcleodLoadProjection.ts` (pure) + `dispatchProjection.ts` (`MOVEMENT_COLUMNS`): project a charge
  for loaded movements only (D-RATE3).
- `loads` module: `applyMirroredCharges` beside `applyMirroredLoads` writes/deletes `load_charges`
  (complete rows, `lint:upserts`). A movement that turns empty or loses its order loses its row.
- Tests: the projection (L gets a row, E none, null `loaded` none, split count kept); the ingest
  (absent keys keep stored values; null clears; mixed batch refused); org filter asserted with
  `expectOrgScoped`.

**R3 — the switch, the readers, the screens.**
- `rolePermissions.ts`: `LOAD_RATES_PERMISSION = "dispatch.load_rates"` + catalogue entry (D-RATE6).
  `rolePermissions.test.ts`: admin true; each editable role false by default; true after a grant.
- Shared contract: a `LoadCharges` Zod type in the loads contract (one definition for api + web).
- API: one reader `readLoadCharges(admin, orgId, loadIds)` in `loads` (chunked `.in()`, org-filtered).
  Called by the three routes in D-RATE7 only after `holdsNamedPermission` says yes. Route tests: a
  dispatcher with no grant gets no `charges` key on any of the three; with a grant, gets it; an admin
  always gets it; the driver route never does.
- Web: the columns and blocks of D-RATE8 behind `session.hasPermission`. Tests for: column absent for
  a non-holder, present for a holder; split note; "—" per mile.
- Browser pass at 1440 px (board width), with an admin and a dispatcher fixture.

**R4 — the connector.**
- `queries.mjs` `DISPATCH_LOADS_SELECT` (D-RATE1); `loads.mjs` `mapDispatchMovement` carries the keys
  (numbers via `num()`, text trimmed); dry-run reports "movements with a rate: N of M".
- `loads.test.mjs`, `queries.test.mjs` updated; `npm run routine` regenerates
  `review/SILVICOM-READ-ROUTINE.sql` (`review.test.mjs` fails CI if stale).
- `node tools/mcleod-agent/windows/manifest.mjs` regenerates `update-connector.ps1`'s SHA-256 list
  from the final commit; commit the result.

---

## 4. Release and the VM

1. R1–R4 merged → staging. The VM posts only to the `FUELGUARD_INGEST_URL` in its `connector.env`,
   so staging rates cannot be assumed: the staging check is the permission switch and the screens'
   behaviour (with and without the grant), plus the ingest and projection tests. Real figures are
   checked in production (§7).
2. **Owner approves the release** carrying 0638, 0639 and R2–R4. `release.yml` applies them to production,
   then the code.
3. **Only after production serves R2** (`pnpm verify:live` shows the release tag) and a test post
   with rate keys is stored there: update the VM. Before that, rates sent to an older API are dropped
   and never re-sent (§1.3, hash rule).
4. **The VM steps, with every command, are in [`LOAD-RATES-VM-UPDATE.md`](LOAD-RATES-VM-UPDATE.md).**
   Facts it rests on (read in `update-connector.ps1` and `agent.mjs`, 2026-11-20):
   - The script carries the files' SHA-256 list inside itself, so the VM must first download the
     script from R4's commit and check the script's own fingerprint.
   - `-RosterMode` is required to be `identity` or `create` and is written into `connector.env`. The
     value passed is the one the VM already has, read on the VM first (not assumed).
   - The script reports `PROBLEM` if a loads cycle fails in the first 120 s (`loads: cycle failed`
     matches its check; the loads job runs every 60 s), but it does not roll back after the restart.
     Rollback is the previous script with the previous commit, after renaming that commit's old
     `backup-<7>` folder, which the script otherwise refuses to overwrite.
   - Every open movement's hash changes (new keys), so the whole board is re-sent once.
5. **History** ("all loads"): delivered loads already in the mirror get rates only when re-read. The
   10-21 backfill ran from the owner's Mac against `lme_analytics`, which stops at 10/09/2026. So this
   one runs on the VM against live `lme`, with the service stopped (one of our reads at a time), in
   17 two-week slices from 03/15 (earliest delivery stored: 03/27/2026) to 12/01. A re-run over held
   movements is a no-op rewrite, per agent.mjs's backfill header. Commands: VM guide Part C.

**R5 — after the VM is verified:** make the seven keys required in `tmsDispatchMovementSchema`
(D-RATE9's removal), one small PR.

---

## 5. Why this order

- R1 before R2: on staging, Railway can serve code before `migrate-staging` applies the migration; an
  ingest writing a column that does not exist yet would fail the whole board post.
- Production API before the VM: §1.3 — the hash rule would strand the rates of unchanged movements.
- Optional keys before required: the VM runs old code until step 4.

## 6. Choices we made (each reversible)

- **Empty movements show no price** (D-RATE3). The alternative, the order's total on every movement,
  double-counts on 3,631 of 4,403 orders.
- **Split orders show the full order total on each leg, labelled** (D-RATE4) rather than a divided
  figure McLeod never stated (45 of 4,403 orders).

### 6.1 Open question — Q-RATE1: the columns do not fit at 1440 px (measured in R3)

D-RATE8's width sum was wrong. "976 + 96 = 1,072 ≤ 1,104" left out the board's **Notes** column
(UNIT-NOTES-PLAN D-UN12, `sm` = 96 px, shown by default to every reader who holds `notes`, which a
dispatcher does by default). Measured in Chromium at 1440 × 900, sidebar open, the table's box 1,104 px
wide (R3 browser pass, 2026-11-20):

| Table | Without rates | With rates as D-RATE8 says | Over by |
|---|---|---|---|
| Board, column minimums, a notes holder | 976 + 96 = 1,072 | 1,168 | 64 px whatever the content |
| Loads, In transit (default tab), realistic cells¹ | ≈ 944 | ≈ 1,146 | ≈ 42 px |
| Loads, Delivered / All (Delivered column), realistic cells¹ | ≈ 1,072 | ≈ 1,274 | ≈ 170 px |

¹ Load # holds the customer at `max-w-32`, so it draws 168 px, not its 96 px minimum; Pickup/Delivery 185/179.
Rate and Per mile draw 101 px each with the split note wrapping (it first drew 189 px on one line).

Overflow scrolls the table sideways: the board's Notes (and part of Warnings) and the Loads row menu go
off-screen at 1440 for every holder, and the admin is always one.

Candidates:
- **(a) As D-RATE8:** both tables' rate columns visible by default; accept the sideways scroll above.
- **(b) Loads gets ONE visible "Rate" column, the per mile on its second line** (Per mile still in
  Columns, hidden): In transit ≈ 1,045 fits; Delivered/All over ≈ 69 px. The board as (a) or (c).
- **(c) Hidden by default on both tables**, listed in Columns for a holder (one click, remembered per
  browser); the load page and the truck drawer show the Rate block by default. Nothing moves for anyone.

**Recommendation: (b) for Loads + (c) for the board.** The Loads page is where a price is read load by
load and its default tab then fits; on the board every visible option pushes Notes off-screen, and the
price is one click away there in the truck drawer. R3 ships D-RATE8 as written until the owner rules; the
ruling is a column-default change in `loadListColumns.ts` / `AssignmentsPage.vue`, no API change.

## 7. Done means

- Production: an admin sees Rate on Loads, on the board and on a load page, and the figure equals
  McLeod's `orders.total_charge` for 5 loads checked by hand against McLeod.
- A dispatcher (no grant) gets **no `charges` key** in the three responses (checked in the browser's
  network tab), and sees no Rate column.
- After an admin switches "See load rates" on for Dispatcher, the dispatcher sees it on the next page
  load, and the Audit page shows the change.
- Open loaded movements with a `load_charges` row = open loaded movements on the board (count both in
  production SQL).

## Progress log

- 2026-11-20 — plan written (branch `claude/load-rates-plan`).
- 2026-11-20 — R1 built (branch `claude/load-rates-r1-schema`): 0638 + 0639 + matrix
  `load-charges.test.mjs` (32 checks; a planted browser-read policy fails 10 of them). Measured before
  writing them, on lme_analytics: McLeod's declared types (money decimal(16,2), miles decimal(10,1)),
  negative other charges on 10 orders, $0 totals on 10, total = linehaul + other on 13,478 / 13,478.
  Corrections to this plan from those measurements: seven columns, not ten (D-RATE1); two migration
  files, not one (R1); exact core columns (D-RATE2).
- 2026-11-20 — R2 built (branch `claude/load-rates-r2-data-path`): the seven keys optional on the mirror
  contract and refused unless all-or-none per movement and per batch (`orderChargeProblem`); the ingest
  names the seven raw columns only when the batch carries them; the pure `projectLoadCharge` (loaded, not
  voided, a stated total; miles only in `MI`); `loads/mirrorLoads.ts` `writeCharges` writes priced loads
  whole and deletes the price of a load the projection no longer prices. Tests: 14 projection, 9 contract,
  4 ingest, 2 projection-over-the-wire; seven mutants (empty priced, void priced, miles in any unit, mixed
  batch accepted, absent written as null, stale price kept, delete unscoped) all killed. Producer waiver
  removed; writer registered in `scripts/table-writers.json`.
- 2026-11-20 — R3 built (branch `claude/load-rates-r3`): `dispatch.load_rates` in `EDITABLE_PERMISSIONS`
  ("See load rates", D-RATE6 wording, `shippedRoles: []`). `LoadCharges` lives in its own
  `loadChargesContract.ts` (not `loadsContract.ts`: that file is the driver app's contract, and a driver is
  never sent a price), with `loadRatePerMile` and `loadChargeSplitNote` — one rule for every screen.
  API: `readLoadCharges` (chunked `.in()`, org-filtered, numeric strings → numbers, throws on a failed
  read); the Loads list and one load add `charges` in the route after `holdsNamedPermission`; the board
  adds it in `readDispatchBoard` after the 20 s org cache (`readsRates`, beside `readsNotes`). A holder gets
  `charges: null` on a load McLeod states no price for; a non-holder gets no key. A source-scan test pins
  the files that may name `load_charges`. Web: `LoadRateCell.vue` (both tables) and `LoadRateFacts.vue`
  (load page card, truck drawer), `usd2` exact cents. Tests: 11 route, 3 board composition, 3 contract,
  2 permission, 10 web unit, 7 page/drawer. Mutants: 9 API + 12 web/shared, all killed by assertions.
  Browser pass at 1440 (admin, dispatcher off, dispatcher on): withholding holds on all three screens;
  the widths do not fit — Q-RATE1 (§6.1).
