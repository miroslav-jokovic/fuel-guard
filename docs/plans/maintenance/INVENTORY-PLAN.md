# Shop inventory and truck inventory — the maintenance section's second and third features (2026-09-08)

Two features, one module, one shared spine:

- **Shop inventory** — the parts and tools the repair shop holds, counted, located, and consumed.
- **Truck inventory** — the equipment that belongs to a unit: tablet, tablet holder, straps, fridge,
  chains, load bars. What should be on unit 654, what actually is, and what left when.

They are one plan because they share the thing that makes either work: a single tag namespace and a
single scan that resolves it. A technician holding a phone does not know, and must not need to know,
whether the code on the object in their hand belongs to "shop inventory" or "truck inventory". One
scan, one answer.

Both land inside the EXISTING `maintenance` module (`apps/api/src/modules/maintenance/`), under the
EXISTING `maintenance` section, in the EXISTING sidebar group, read by the EXISTING `technician` role.
Nothing about the permission surface is new; §1.1 is the measurement that says so.

Canon this plan answers to: `docs/ARCHITECTURE.md` (ownership, D-ARC3), `docs/SILVICOM-360.md`
(product scope, D-S360), `docs/MIGRATION-DISCIPLINE.md` (the deploy window),
`docs/DESIGN-SYSTEM-CONTRACT.md` + `apps/web/CLAUDE.md` (UI), `ANNUAL-INSPECTION-PLAN.md` beside this
file (the register and the execution protocol), and `INVENTORY-UX-RESEARCH.md` beside this file (how
the leading products do this work, every claim cited — §2.5 and D-INV17–25 rest on it).

**Provenance.** First draft 2026-09-08 morning; audited against the tree the same afternoon (every
file:line re-executed, six claims corrected, twelve reliability gaps closed); research sweep the same
evening (≈400 pages, four product families). §8 is the dated record of what each pass changed. This
is the third revision and the first one written to be executed.

---

## 1. Measured reality (2026-09-08, `origin/main` at `4cf7d97`, migrations through 0330)

### 1.1 What already exists and must NOT be rebuilt

| Fact | Where | Consequence |
|---|---|---|
| `maintenance` is one of the 12 `AppSection`s | `packages/shared/src/auth.ts:76` | No new section. No `SECTION_ACCESS` edit. |
| The `technician` role holds `maintenance: manage`, `equipment: view`, all else `none` | `auth.ts:183` (D-AVI11, 0279) | **No new role.** The person who scans a part is modelled, has web access, and is narrowed to the shop floor. |
| The Maintenance sidebar group holds three nav surfaces (`/shop`, `/shop/inspections`, `/shop/inspectors`) and one detail surface, all `section("maintenance")` | `packages/shared/src/surfaces.ts:226-228, 248`; group at `:89` | New screens are new rows in an existing group. Icons live apart in `apps/web/src/lib/navIcons.ts:96-98` because shared is RN-compiled; `lint:surfaces` checks both directions. |
| The `maintenance` API module owns **four** tables: `maintenance_inspectors`, `vehicle_inspections`, `vehicle_inspection_items`, `maintenance_print_profiles` (0283) | `scripts/table-modules.json`; `docs/ARCHITECTURE.md:131` still says three | New tables join an existing owner. `modules/maintenance/index.ts:4` still reads "Owns no tables yet" — corrected in I0. |
| The existing shop routes live in `router/routes/finance.ts:32-54`, with the reason at `:4-6` (`/maintenance` was taken by the downtime page) | `apps/web/src/router/routes/finance.ts` | I4 moves them into a new `maintenance.ts` so one section is not split across two files. |
| Maintenance's drawer idiom is a `*Drawer.vue` that owns its own `SlideOver` (`InspectorDrawer.vue:20-21` records the refactor from bare forms) | `apps/web/src/features/maintenance/` | New forms follow it. Not page-owned `SlideOver` + `*Form.vue`. |
| Two PDF stacks, chosen by job: `pdf-lib` **stamps** an existing template (`render/report.ts:41-45` says why); `lib/pdfDraw.ts` on pdfkit **authors** documents | `apps/api/src/modules/maintenance/inspections/render/`, `apps/api/src/lib/pdfDraw.ts` | A label sheet is authored, so I10 draws with `pdfDraw`. |
| The repo's only startup registry is the queue fabric: `registerHandler(kind, handler)` in `queue/registry.ts`, populated by `queue/handlers/index.ts`, called from `app.ts:306`; `org`'s header disclaims owning it | `apps/api/src/queue/registry.ts`, `modules/org/index.ts:11-12` | The tag-resolver registry is a sibling fabric, `apps/api/src/tags/`, not a room in `org` (D-INV7). |
| `vehicles` and `trailers` are **two tables** (0030); `trailers` carries `is_reefer`, `trailer_type`, `assigned_vehicle_id`; `vehicles` has no unit-type column | `supabase/schema.generated.sql:5178, 5541` | Every equipment reference is two nullable FKs, as `duty_equipment_segments` and `equipmentInspection.ts:71-75` already do. |
| `vehicles.assigned_driver_id` (office record) and `duty_equipment_segments` (driver's confirmed check-in) both exist | `schema.generated.sql:1231-1255` | Two truths about who has a truck. D-INV3 reads neither as a holder. |
| Roster exports `getEquipmentIdentity` (one row) and `getEquipmentIdentities(admin, orgId, subjectType, ids)` (explicit ids); nothing lists equipment; the bulk path hardcodes `isReefer: null` | `apps/api/src/modules/roster/equipmentInspection.ts:40-45, 76-92` | I9 adds `listEquipmentIdentities` to roster first (B2). |
| The web SPA's only responsive machinery is `DataTable` → `DataTableCards` below 768 px and an `lg:` sidebar drawer; the maintenance pages have zero breakpoints; the only phone-first page is the public `/apply/:token` under `layout: "apply"` outside `AppShell` | `apps/web/src/components/ui/DataTable.vue:255`, `layouts/AppShell.vue:125`, `router/routes/auth.ts:40-43`, `layouts/ApplyLayout.vue` | The scan and count screens are the first phone-first pages inside the authenticated app. They get their own layout (D-INV17). |
| **There is no live camera stream in this codebase.** `webImageIo.ts:98` is a comment saying the `getUserMedia` provider was deliberately not built (D-APP11); the implementation is `<input type="file" capture="environment">`, feature-internal to `apply`, and `lint:boundaries`' web allow-list is empty | `apps/web/src/features/apply/capture/webImageIo.ts:92-107`; `scripts/check-feature-boundaries.mjs:70-73` | The scanner is the first camera stream this product opens. I6 begins with a spike on real phones. |
| `CaseTimeline.vue` is local to anomalies by D-DS18 and promotes "when a second consumer exists and can argue for the shape"; `StatCard`, `SettingsSection` (used in settings AND roster), `FileDropzone` are shared | `apps/web/src/features/anomalies/CaseTimeline.vue:11-17`, `components/ui/` | I8's asset history is the second consumer. |
| Badges are `[BADGE_BASE, toneClass(...)]` from `@/lib/badges`; the newer `DqBadge`-returning helpers carry label + tone and import their label maps from shared | `apps/web/src/lib/badges.ts:5-15, 86-91` | Status vocabularies live in `inventoryContract.ts`; `badges.ts` gains one helper per enum. |
| The driver app already has `NumericField`, `ChoiceSheet`, `ConfirmSheet`, `ActionBar` (with `haptic`), `OfflineBanner`, `SyncStatus`, `Progress`, `TaskStepper`, `ListRow`, `GroupedList`, `EmptyState`; Home carries a "Your rig" card (D-DB17) | `apps/driver/src/components/`, `DRIVER-APP-DIRECTION-B-PLAN.md:149` | I13 is composition, not new components; the kit lives on Your rig. |
| Two mail-sending schedulers exist: the weekly theft digest (`modules/org/digest.ts`) and DQ expiry (`modules/evidence/dqAlertScheduler.ts`, "env flag, ~6h interval, stateless per-run"), both started from `apps/api/src/schedulers.ts` | `apps/api/src/schedulers.ts:45` | Neither reaches a shop audience. I12 is read-time first; an email, if asked for, copies the DQ shape. |
| `esign_consents` (0227) is the precedent for a signed acknowledgement: `disclosure_version`, `intent_statement`, `consented_at`, column-wise immutable by trigger, SQLSTATE `EC010` | `supabase/migrations/0227_esign_consents.sql:52-110` | Q7's revisit path if custody is ever disputed. |

### 1.2 What does not exist — measured, so the greenfield claim is checked rather than asserted

- **No inventory schema.** `grep -il 'inventory|part_stock|stock_location|purchase_order|asset_tag'` over all
  330 migrations returns only prose and one text passthrough column, `financial_entries.purchase_order_no`
  (0257:242). No dead columns to adopt or drop.
- **No place concept.** `terminals` was created at 0097 and dropped at 0259 after zero rows, zero producers,
  zero readers were measured against production. D-INV1 rules.
- **No barcode reader anywhere.** `apps/driver/package.json` carries `expo-image-picker` and the in-house
  document capture engine, no camera or barcode dependency. `apps/web` has none. Nothing in the repo
  depends on `uqr`, `qrcode`, `zxing` or `jsqr`.
- **No `BarcodeDetector` on iOS.** Safari has not shipped it: caniuse lists "disabled by default in 26.6",
  WebKit bug 281848 ("Shape Detection API doesn't work on iOS") is open and uncommented as of July 2026,
  and the 26.6 release post does not mention it. Every iPhone in the shop decodes in WebAssembly.
- **`documents.subject_type` cannot name an item.** CHECK `in ('driver','tractor','trailer','load',
  'organization')` at `0146_compliance_documents.sql:34`; `documents` is evidence-owned and append-only.
  D-INV8 rules.
- **No work-order table.** `work_order` appears nowhere in the schema or the API. D-INV5 rules.
- **No `merge_vehicle` and no application delete path for `vehicles` or `trailers`.** Measured: no
  `.from("vehicles").delete(` or `.from("trailers").delete(` in `apps/api/src`; neither table is named in a
  retention rule; `vehicles` is in `RETENTION_FORBIDDEN`.

### 1.3 The gates, as they actually behave — read before writing a migration

Each was read, not assumed. The differences from the first draft cost a red build each.

| Gate | What it does | What this plan must do |
|---|---|---|
| `lint:table-producers` (`scripts/check-table-producers.mjs:13-19`) | A table needs `.from("<table>")` in non-test app source **or** DML (`insert into`/`update`/`delete from`) inside a migration-defined function body. FK references, policies, indexes are NOT evidence. `.rpc(...)` calls are NOT evidence. Tables are discovered from migrations. The waiver map is empty and nothing validates waiver text. | Schema and service ship in one PR. The RPC's own `insert into part_movements` satisfies the gate; the read service's `.from()` satisfies it twice. |
| `lint:migration-ordering` (`check-migration-ordering.mjs:186, 234-239, 246, 254`) | Parses `add column` / `rename column` only. A table created in the same migration contributes no pending columns ("a new table is exempt", self-tested). **`create function` is never read** — a `.rpc()` caller merged with its function is served for ~2m44s against a schema that lacks it. | New tables ship with readers. A new RPC ships with its caller **only** while no user can reach the feature (I2, I7); every later signature change is two merges, checked by hand against `pg_proc`. |
| `lint:section-policies` (`check-section-policies.mjs:67, 151, 165`) | `maintenance` is in `MODULE_SECTIONS`; both `auth_role() in (…)` and `= any (array[…])` are read; role lists are compared to `SECTION_ACCESS`. **`on storage.objects` reduces to the bare name `objects`, which maps to no section and is reported as an ERROR.** 0146's bucket policy sits below `SQL_BOUNDARY = 260` and was never exercised. | Role lists verbatim (§5 I2). **No `storage.objects` policy** (D-INV8). |
| `lint:table-access` (`check-table-access.mjs:97-99`) | Guards `layer=raw` tables only (28 of 141). `vehicles` is `core`; 67 cross-module `.from("vehicles")` sites exist. | Permitted, and still not what we do — D-ARC3 says readers go through the owner's interface. |
| `lint:boundaries` (`check-feature-boundaries.mjs:70-73, 116-118, 237-246, 283-313`) | Web feature allow-list is empty since 2026-08-26. API edges `maintenance -> evidence|roster|org` exist. Package boundaries are an **anonymous inline array**; the determinism scan is **hardcoded to `packages/hazmat-engine/src`** under a comment "Scope is @hazmat/engine ONLY". | I1b restructures the scan into a loop over package roots, with a self-test. That is work, not a list entry. |
| `lint:filesize` (`check-file-size.mjs:55-56, 122`) | 500 hard / 450 warn; `.ts .tsx .vue` in scope. | Forms extracted from the first commit. |
| `rls.test.mjs` → `tenantIsolation.mjs:297-303, 384-390` | Unseedable tables are collected and then **asserted empty** — a red matrix, not a skip. `handSeed` (`table: (orgId) => sql`) is the escape hatch for multi-column CHECKs. `supabase/CLAUDE.md:34` is right. | `part_stock` (composite PK) and `inventory_assets` (holder CHECK) get a `handSeed`. |
| `lint:surfaces` (`check-surfaces.mjs:44-46, 149-198`) | Reads the `route table 1` snapshot **by key** (second block in the file); every path must exist in the router; nav surfaces ↔ icons both directions; `requireSurface("key")` must name a catalogued key. | New rows + icons + regenerated snapshot in I4. |
| `lint:shared-contracts` (`check-shared-contracts.mjs:15-23, 37`) | Fails an app-side `…Schema|Dto|Contract|Payload` symbol that shadows or duplicates shared. **No filename rule.** | Contracts in shared by convention; the gate catches copies. |
| `lint:upserts` (`check-partial-upserts.mjs:19-32`) | Inline upsert payloads must set every required column; a non-literal payload on `onConflict: "id"` is banned. | The ledger has no upsert in it. |
| `lint:table-writers` (`package.json:110`) | Freezes `(table → file)` pairs in `scripts/table-writers.json`; the chain also runs `check-table-modules` and `git diff --exit-code -- supabase/schema.generated.sql`. | Pairs and the regenerated snapshot in the same PR. |
| `check-rls.mjs:5-12` | Every `create table` needs `enable row level security` in the same or a later migration. Does not strip comments. No policy is required. | Present on every table. |
| `lint:comment-claims` (`check-comment-claims.mjs:15-19`) | A "proves"/"pinned by" comment must name a `*.test.ts` file and quote a real `it()` title. `.test.mjs` citations are invisible to it. | Matrix claims are worded as facts, not proofs, or cite a `.test.ts`. |
| `docs/ARCHITECTURE.md` §3 ownership | Hand-maintained; **no gate reads it**. | I0 edits §3 (not §4). |

### 1.4 Production measurements (2026-09-08)

| Fact | Value | Bearing |
|---|---|---|
| Active trailers / tractors / reefers | **234 / 207 / 46** | Trailers are the majority (D-INV12). |
| GL `30230000 Shop Parts` | **$270,670.22** | Parts spend is already in Finance (D-INV11). |
| Maintenance GL family, 10 accounts | **$1,420,366.93**; `40160000 Tires` $332,215.60; `30240000 OTR >$1000` $282,626.06; `30350000 Trailer Repair` $264,021.87; `30250000 OTR <$1000` $123,101.58 | Same. |
| `financial_entries` rows / `category='maintenance'` | **49,873 / 0** | The `/shop` page's honest message is about the projection, not Finance. |
| AP vouchers carrying a PO number | **5 of 1,464 (0.34 %)** | No purchase orders (D-INV14). |

---

## 2. The findings that decide the shape

### 2.1 Stock is fungible; an asset has an identity

A case of oil filters is *stock*: eleven of them, interchangeable, the only questions are "how many" and
"where". A tablet is an *asset*: A-0412, serial number, in truck 654, was in 611 before, and when it goes
missing the question is which one and from where. They need different tables because they answer
different questions. The market confirms the split: Fleetio models stock and only stock (part at a
location with aisle/row/bin, per-location quantity, reorder point); Snipe-IT models assets and only
assets (unique tags, check-out to a person, a location, **or another asset**). "Check out to another
asset" is the whole of truck inventory.

So: `parts` + `part_stock` + `part_movements` for consumables; `inventory_assets` + `asset_movements`
for anything with a serial number, whether it lives in the tool crib or in a truck. Truck inventory is
the asset table with a unit as the holder.

### 2.2 A quantity is a measurement, not a field

`part_stock.quantity_on_hand` is never typed and never patched. Every change is a `part_movements` row —
received, issued, adjusted, transferred, counted, returned — and the quantity is the projection of that
ledger, maintained inside one RPC. Three reasons: it is the house rule (D-S360-6, `sql-returns-measurement`);
`lint:upserts` exists because a typed quantity is exactly the write it forbids; and "where did the
eleventh filter go" is the only question anyone asks about inventory, which a stored integer cannot
answer. Cycle counting is a *movement with a variance*, never an edit to a number — and because the
delta is taken at count time, a delivery received during a count is not overwritten, the failure
Limble's own docs warn about.

### 2.3 The driver app is drivers-only by construction, and the role split already solves this

`SessionProvider.tsx:130-142` reads `user_role` off the JWT and routes every non-driver to `wrong-app`.
Driver logins are synthetic, non-deliverable emails derived from `drivers.app_username`
(`driverAuthContract.ts:11-28`); a technician is a `memberships` row with a real address. RLS driver
scopes key on `auth_driver_id()`. `driver_app_features.feature_key` is CHECK-constrained to ten values,
**on two tables** (`0134:38-41` and `:56-59`). And all three driver release lanes sit at `action_required`.

The role split answers the question better than either option: a driver does not scan shop parts; a
technician does, and the technician is a web user. A driver *is* the right person to confirm the fridge
and the straps are in the truck — and for that they need a list and two answers, not a scanner. **The
shop scans on the web (I6); the driver confirms the kit in the app (I13), last, without scanning.**

### 2.4 What goes on the tag, and what the tag is made of

Encode a short opaque identifier, never a URL: a URL bakes a hostname into five hundred labels and
publishes the org's vendor to anyone holding the object. Print the human-readable code beside the
symbol: it is "the only path when a laminate has fogged". Use ECC-H (30 %) for a tag that gets grease,
keep the payload short enough for a version-4 symbol, and a 1-inch QR then has ~0.69 mm modules,
comfortably above the 0.4 mm phone floor. Adhesive paper fails in 60–90 days in washdown and heat;
thermal-transfer polyester with a matte laminate survives on bins and shelves; photo-anodized aluminium
survives on the truck, near exhaust and under a pressure washer ("more than 20 years outdoors", matte
finish "eliminates glare" — Camcode). Not our code, but the difference between the feature working and
being abandoned in a quarter, so the label screen says it (I10).

### 2.5 The bar is Sortly's ease, and the research says where the leaders stop

The bar: a technician receives a delivery, issues a part to a unit, and counts a shelf without reading
documentation; printing labels is a screen, not an export. `INVENTORY-UX-RESEARCH.md` measured how
Fleetio, MaintainX, Limble, UpKeep, Fullbay, Shelf, Cheqroom and Reftab do each of those. What every
good one does the same, and this plan copies: a scan resolves to a part **at a location**; an unknown
code offers "attach or create"; quantity is a stepper plus keypad taking an absolute total; a manual
decrease needs a reason; the best two count **blind** by default; a count saves per row and a variance
above a threshold triggers a recount, not a silent commit; a kit is type + quantity rules filled by
scanning; an audit is expected list + session + three buckets, and "missing" is a verdict at close.

What none of the fleet products do, and this plan does: continuous scan with a tally, decode feedback,
manual entry as a first-class fallback, a scan trigger sized for a gloved thumb. Those live only in the
count-app and SDK tier, and Scandit's published research supplies the spec (research §4). That is the
leapfrog, and it is cheap because the scanner is one screen.

### 2.6 The truck-inventory record has a legal edge, and the owner has ruled on it

Deductions for unreturned equipment are a live dispute area in trucking, and what turns a deduction into
a claim is an unexplained settlement line. The owner ruled (D-INV3): inventory belongs to the truck, the
driver is the holder by inference, no signed handover. The best-designed asset product made the same
choice — Shelf: "Shelf does not have PDF custody agreements or e-signatures" — and the reviewers' verdict
on Cheqroom's pad is "quite poor". A missing item will have a dated movement history showing which unit
it was in and when it left, and no signature. Q7 carries the revisit path. One benefit falls out: no
table in this plan gains a `drivers` FK, so `merge_driver_v2` (0264) needs no change.

### 2.7 FleetPal is operational, not financial — and two canon locations still say otherwise

`FINANCE-FLEET-REPORT-PLAN.md` §0 (owner, 2026-09-03) deleted FleetPal from Finance: "Maintenance is a
ledger line"; D-FLEET2 makes McLeod's GL the entire financial input. So next week's FleetPal integration
is work orders, PM schedules and DVIR defects — not money. Two places still instruct otherwise and are
corrected in I0: `modules/maintenance/index.ts:6-12` ("THE FLEETPAL DEDUP CONTRACT") and
`docs/ARCHITECTURE.md:75`. Authority then splits by **fact**, not system: the shelf is ours (on-hand,
location, reorder, counts, asset identity, truck kits); the repair job and what it consumed are
FleetPal's; the tie-out is a nullable `work_order_ref` on the issue row, not a sync (D-INV10).

### 2.8 Parts spend is already in the fleet report, so it must never arrive again

§1.4: `30230000 Shop Parts` carries $270,670.22, inside a $1.42 M maintenance family, already tied to the
printed income statement. Three rulings independently forbid a second arrival: D-FS1 (the canonical
index `(org_id, dedup_key) where is_canonical and not is_void` refuses double-counting structurally),
D-FLEET1 (no per-truck cost), D-FLEET8 (nothing allocated). A part issue is not a spend event: the money
left when the part was bought, and that purchase is already an AP voucher. Inventory measures the shelf;
Finance measures the money (D-INV11).

### 2.9 Trailers are the majority of the fleet, so they cannot be phase two

234 active trailers against 207 tractors, and the straps, chains and load bars live in trailers. The
schema carries both from I7 and every screen shows both (D-INV12).

### 2.10 The QR concern is bigger than inventory, so it does not live inside inventory

Later tags, each real: `vehicle`/`trailer` (the digital truck file, `SILVICOM-360.md` §3), `inspection`
(the printed §396.17 report), `document` (a DQ binder cover), `location` (a shelf), `invite` (a printed
driver invitation — invitation links are opened by Proofpoint before the driver sees them). If the tag
format is invented inside `inventoryContract.ts`, every one of those re-invents it or imports inventory's
internals. So: the **vocabulary** (`SIL1:<kind>:<id>`) is a contract in shared; the **encoder** is a pure
package with no product knowledge; the **resolver registry** is a fabric beside the modules (D-INV7,
D-INV16). A UPC can never parse as a tag because the version prefix is alphabetic and a UPC is digits.

### 2.11 The scanner, on the phones the shop actually owns

Measured (research §4.4), and each is a test before it is a line of code:

- Every iPhone decodes in WASM (§1.2). The WASM is self-hosted; the default CDN fetch is blocked by CSP
  and unreachable from a bay with no signal.
- **An installed (home-screen) web app re-asks for the camera on every route change** (WebKit 215884,
  still reported on iOS 18.5+). The scan page therefore hosts the whole scan → resolve → act loop on one
  route. That is also the better product: the technician never leaves the camera to finish the job.
- Torch works on iOS ≥ 17.5.1, gated on `getCapabilities().torch`; `zoom` is exposed but not applied, so
  small labels get crop-zoom; `ImageCapture` does not exist; the track mutes on background and must be
  re-acquired on `visibilitychange`.
- **iOS web has no vibration.** Decode feedback is tone + flash. The driver app has haptics; the web
  scanner does not pretend to.
- Torch on a laminated label adds glare; the hint is "tilt 10–15°".
- Background Sync will never ship on Safari. The write is queued in IndexedDB *before* the network call,
  keyed by a client UUID the server treats as idempotent, and replayed on `online` and on foreground.
  Installed apps are exempt from Safari's seven-day storage purge; a tab is not — which is why the shop
  installs, and why the one-route rule above matters.

### 2.12 Reliability is decided in the RPC, not the screen

Four failures a shop finds in week one, each closed in I2 and I7 before any screen exists:

1. **A retried write duplicates.** A request that times out after the server committed, then is retried,
   issues the part twice. Every movement carries a client-generated UUID primary key; the RPC inserts
   `on conflict (id) do nothing` and returns the existing row. Exactly-once under retry.
2. **Two technicians oversell a shelf.** The RPC runs the guarded UPDATE first
   (`quantity_on_hand + delta >= 0`), inserts the movement only when `row_count = 1`, and raises a named
   SQLSTATE otherwise. Written the other way round, a lost race leaves a ledger row the projection never
   applied.
3. **A projection drifts and nothing notices.** `rebuild_part_stock(p_org)` recomputes from
   `sum(quantity_delta)`; the matrix asserts it is a no-op after a mixed sequence — the assertion that
   catches a future writer bypassing the RPC. The count screen is the human-facing drift detector.
4. **"Append-only" is a claim until a trigger exists.** Each ledger gets its own guard function on
   `0220_driver_applications.sql:82-99`'s shape (blanket refusal, fires for the service role too, its own
   SQLSTATE). The matrix mutates a row to prove it fires.

---

## 3. Decisions

| ID | Decision | Source |
|---|---|---|
| **D-INV1** | **Stock locations are a table, built now.** `stock_locations` (maintenance-owned: name, code unique per org, address, active); stock is held per part per location with aisle/row/bin. Rejected: one implicit shop — multi-location is a paid tier in MaintainX and UpKeep and the top review complaint when missing. Rejected: reviving `terminals` — broader than this feature; `stock_locations` points at it if ever built. | Owner 2026-09-08; research §2.13 |
| **D-INV2** | **The shop scans on the web; the driver confirms the kit in the app, last, without a scanner.** Decoding is WASM on every iPhone and native only where Android Chrome offers it. I13 waits on the release lanes. | §2.3, §2.11 |
| **D-INV3** | **Truck inventory belongs to the unit.** The holder of an asset is a vehicle, a trailer, or a stock location — never a person. The driver is the holder by inference from `vehicles.assigned_driver_id` at read time, never stored. No handover, no signature. | Owner 2026-09-08; §2.6 |
| **D-INV4** | **A quantity is derived from a movement ledger, never typed.** `part_movements` is the truth; `part_stock.quantity_on_hand` is a projection maintained by the RPC; counts are movements with a variance taken at count time. | §2.2 |
| **D-INV5** | **A part is issued to a vehicle or trailer with a reason code.** No work-order table. Issue rows carry unit, reason, date, cost and a nullable `work_order_ref` so a future work order adopts them by join. | Owner 2026-09-08 |
| **D-INV6** | **We build our own shop inventory although FleetPal has one; the bar is that ours is easier to use.** The overlap is resolved by D-INV10. | Owner 2026-09-08 |
| **D-INV7** | **A tag carries a short opaque id, and one product-wide resolve endpoint answers for every kind.** `GET /api/tags/resolve?code=` parses with `parseTag`, dispatches to the resolver the owning module registered, returns a discriminated union; if the text is not a tag, it is tried as a UPC. The registry is `apps/api/src/tags/` on the queue fabric's model (`registry.ts` + `resolvers.ts` importing each module's resolver + `routes.ts` mounted in `app.ts`). Not in `org`: the allow-list has three `org ->` edges already and `org`'s header disclaims owning the one existing registry. Adding `VEH` later is one import line in `tags/resolvers.ts`. | §2.10, §1.1 |
| **D-INV8** | **Inventory photos are NOT `documents` rows. They get a private bucket, `inventory-photos`, created in I2's migration on 0146's `insert into storage.buckets` pattern, with NO `storage.objects` policy.** Uploads go through the API route (service role); bytes come back as signed URLs (`modules/evidence/compliance.ts:186`, TTL 300 s, `createSignedUrls` batched for lists). A client policy would trip `lint:section-policies` (§1.3) and buys nothing the API route does not. | §1.2, §1.3 |
| **D-INV9** | *(merged into D-INV11)* | |
| **D-INV10** | **Silvicom owns the shelf; FleetPal owns the repair job.** Authority by fact: on-hand, location, reorder, counts, asset identity, kits are ours; the work order and what it consumed are FleetPal's; `work_order_ref` ties them by reference. | §2.7; answers Q1 |
| **D-INV11** | **Parts cost never reaches Finance — not now, not later.** GL `30230000` already carries it; D-FS1, D-FLEET1, D-FLEET8 close the other doors. | §2.8; answers Q2 |
| **D-INV12** | **Trailers are in scope from I7.** 234 against 207. | §2.9; answers Q6 |
| **D-INV13** | **No custom fields, no jsonb bag.** Fixed fields plus a notes column; recurring notes become columns. A jsonb bag is invisible to Zod, to `lint:shared-contracts`, to indexes and to gates — and "configuration-first" is the reviewers' most repeated complaint about Asset Panda and Snipe-IT. | Answers Q4 |
| **D-INV14** | **No vendors, no purchase orders.** 5 of 1,464 vouchers carry a PO number. Receiving takes a supplier name and a cost. | Answers Q5 |
| **D-INV15** | **Last cost, not moving average, not configurable.** With D-INV11 closing every finance door, no reader can tell the two apart. | Answers Q8 |
| **D-INV16** | **The QR concern is two reusable pieces, neither of them inventory code.** `packages/shared/src/tagContract.ts` owns the vocabulary; `packages/qr` (`@silvicom/qr`) owns encoding and label-sheet geometry, pure, zero workspace deps, on the `@hazmat/engine` model. Decoding is platform-specific and lives with the scanner. | §2.10 |
| **D-INV17** | **The scan page and the count session are a standalone shop layout, and the scan route never changes while the camera is open.** `layout: "shop"` on `ApplyLayout`'s model: no sidebar, full-height viewport, `overscroll-behavior-y: contain`, sticky bottom action bar with `env(safe-area-inset-bottom)`, in-content back. Scan → resolve → verb sheet → write all happen on `/shop/scan`. Every other inventory screen stays a desk screen in `AppShell`. The shop installs the web app to the home screen, which is safe only because of this rule. | §2.11; research §1, §5.1 |
| **D-INV18** | **An asset has two identifiers and no identifier setting.** `tag_code` — the opaque Crockford base32 id in the QR, assigned once, never reprinted. `display_no` — a per-org sequence (`A-0412`), auto-assigned, printed in text under the QR, spoken aloud. Shelf's model: the QR id and the human number do different jobs. No prefix or format setting. | Research §3.4 |
| **D-INV19** | **A shelf count and a unit check are one session shape.** `stock_count_sessions` (org, location or unit, started_by, blind, status, opened/closed_at). Each entry commits at once — a `counted` movement or an `asset_movements` row carrying the session id — so a dropped connection loses one bin, not forty. Buckets Found / Not yet / Unexpected while open; Short / Over / Missing are verdicts at close. One session component serves parts (I5) and units (I9). | Research §2.7, §3.3 |
| **D-INV20** | **Counts are blind by default.** The expected figure is hidden until the count is typed; a supervisor can reveal; the mode is recorded on the row. Limble ships this on by default "to reduce bias"; MaintainX offers it; Fleetio and UpKeep do not. | Research §2.6 |
| **D-INV21** | **A variance above max(5, 5 %) or a zero against non-zero gets a consequence-labelled confirm; above 10 % the row is flagged for a second counter, and the movement still commits.** The recount is a second `counted` row; the ledger records both. Never "Are you sure". | Research §2.8 |
| **D-INV22** | **Decode feedback is tone + aimer flash on the web, haptic in the driver app.** | §2.11 |
| **D-INV23** | **The WASM is self-hosted and the still-image path is first class.** `vue-qrcode-reader` on `barcode-detector`/`zxing-wasm` (MIT, reader-only WASM ≈1.04 MiB, `prepareZXingModule({ locateFile })` at our origin, lazy-loaded on `/shop/scan` only). `<input type="file" capture="environment">` and typed entry are rendered on the scan page as the two fallbacks, not as error states. Rejected: `html5-qrcode` (maintenance mode, last release April 2023), Quagga2 (1D only), Scandit/Dynamsoft/STRICH (paid; revisit only if the pilot fails on greasy supplier 1D codes — Scandit is the one whose engine is service-worker-cacheable). | Research §4.6 |
| **D-INV24** | **`in_repair` does not clear the holder.** A tablet in repair is still unit 654's tablet, missing from it. Snipe-IT's opposite rule is its most-hated behaviour. | Research §3.9 |
| **D-INV25** | **Label presets are Avery 22805 (1½"), 22816 (2"), 5160, weatherproof 5520, and a roll single; a start position and an X/Y nudge; no designer.** ECC-H, payload ≤ version 4, `display_no` in text beside the symbol. The label screen names the materials in plain words. | §2.4; research §3.10, §5.15 |
| **D-INV26** | **Negative stock is refused, always; there is no setting.** `check (quantity_on_hand >= 0)` is the second wall behind the RPC's guard. A shelf that has gone negative has a counting problem, and the count movement is the fix. | §2.12 |
| **D-INV27** | **Every movement is idempotent by a client-generated UUID.** Part and asset movements alike; the RPC inserts `on conflict (id) do nothing` and returns the existing row. This is the server half of the offline queue (§2.11). | §2.12 |

| **D-INV28** | **The shop scanner is the web app, not a native technician app — ruled 2026-09-08.** What a native app buys is one screen's camera layer (VisionKit/ML Kit decoding, persistent permission, haptics); everything else in this plan is identical. What it costs here: the driver app is drivers-only by construction (§2.3), so it would be a second Expo app with its own identity path; all three release lanes sit at `action_required`; the Apple account is Individual (internal TestFlight admits only the owner); there is no iOS CI job. The web scanner ships with the API in the Railway window, behind the same login as the desk. **If the shop buys devices, buy Android** — Chrome there has the native `BarcodeDetector`, a persistent permission and a working vibration API with no code change. **Revisit if** (a) the I6 spike fails on supplier 1D codes with both the free decoder and a paid web SDK, (b) technicians reject the installed web app after a real week for camera reasons, or (c) the release lanes are unblocked and a second app becomes a config change. | Owner 2026-09-08 |

---

## 4. Execution protocol

Same protocol as the annual-inspection plan, because it worked, plus the rules the audits added.

1. **One step per PR.** PR → CI → merge commit. Never direct-merge main.
2. **Branch from `origin/main`**, and re-check `git branch --show-current` before every commit and push —
   this working tree is shared with parallel sessions.
3. **Migration numbers are never pinned in advance.** Next-numbered at execution (0331 is free at time of
   writing). Steps below say "next-numbered".
4. **Run the full gate list before pushing.** A new table means, every time: `enable row level security`;
   an entry in `scripts/table-modules.json`; writer pairs in `scripts/table-writers.json`; the regenerated
   `supabase/schema.generated.sql` committed; a `handSeed` if the generic seeder cannot build the row; and
   a PGlite matrix that prints its `RESULT` line, closes the db, and **has no SKIP branch** — the 0175
   matrix silently skips its RPC call on a wrong signature and has never run it.
5. **New tables are exempt from `lint:migration-ordering`**, so a new-table step ships migration and
   reader in one PR. A new column on an existing table is two merges. A new RPC ships with its caller only
   while the feature is unreachable, stated in the PR.
6. **Named SQLSTATEs, not 500s.** The `IV` prefix is unused. The API maps them through the pattern in
   `modules/maintenance/inspections/serviceError.ts`; the recorder can script them to prove the mapping.
7. **Security-definer RPCs take `p_actor`.** The JWT-based triggers see null through the service role.
8. **Prove a test can fail.** Mutate the assertion; a fixture too uniform to discriminate has passed ten
   assertions proving nothing before.
9. **Every phone flow has a usability sentence in its done-when**, checked by a person, named as such —
   there is no CI for a camera or a thumb.
10. **Mark progress as dated lines in §9**, never by editing step text.

---

## 5. Steps

Sequenced so each step's prerequisites exist before it opens. The scanner (I6) precedes assets (I7)
because the count flow and the unit check both stand on it.

### I0 — Governance and the stale canon — *no migration*

`SILVICOM-360.md` §4: "a feature not listed here needs a D-S360 decision before its plan starts".

- Add **D-S360-7 — Inventory** to `SILVICOM-360.md` §3, naming both features, D-INV6/D-INV10, and this plan.
- `docs/ARCHITECTURE.md` **§3** (table ownership, D-ARC3; `:79`, not §4): add the eight tables and
  `stock_count_sessions` to the `maintenance` row; correct "three tables" to four.
- `docs/ARCHITECTURE.md:75`: rewrite the `fleetpal` row — the collector is operational (D-INV10), the
  financial contract is deleted (D-FLEET2), parts cost never arrives (D-INV11).
- `apps/api/src/modules/maintenance/index.ts:1-12`: replace "Owns no tables yet" and "THE FLEETPAL DEDUP
  CONTRACT" with the four tables it owns and a pointer to D-INV10/11.
- `docs/ARCHITECTURE.md` §6: `.vue` IS covered by `lint:filesize` (`SOURCE_EXT`); the "gap" line is stale.
- Commit this document and `INVENTORY-UX-RESEARCH.md`.

**Done when:** both canon documents name the feature, the two stale instructions are gone, and this plan
is on main.

### I1 — The contracts — *no migration*

**`packages/shared/src/inventoryContract.ts`** — the only home for what api, web and driver must agree on.

- Zod schemas: part, stock line, part movement, count session, asset type, asset, asset movement, kit
  expectation.
- Closed vocabularies as `as const` arrays, with label maps (badges import them):
  - part movement reason: `received`, `issued`, `adjusted`, `transferred`, `counted`, `returned`;
  - adjust reason (D-INV21, research §2.5): `damaged`, `lost`, `found`, `expired`, `correction`;
  - asset status: `in_service`, `in_repair`, `spare`, `lost`, `retired` — with the invariant in a comment
    that `in_repair` keeps its holder (D-INV24);
  - asset movement reason: `assigned`, `removed`, `transferred`, `reported_missing`, `reported_damaged`,
    `found`, `retired`;
  - holder kind: `location`, `vehicle`, `trailer`, `unassigned`; condition: `good`, `worn`, `damaged`;
  - count session status: `open`, `closed`.
- Pure functions with tests: `isLowStock(stock)`; `deriveKitStatus(expected, held)` → complete /
  short-by-N / extra; `countVarianceTier(expected, counted)` → none / confirm / recount (D-INV21);
  `nextDisplayNo(seq)` → `A-0412`; the `ScanResult` discriminated union D-INV7 returns
  (`stock_line | asset | part_by_upc | unknown_tag | malformed`).

**`packages/shared/src/tagContract.ts`** — a separate file, because it is not inventory's (D-INV16).

- `TAG_VERSION = "SIL1"`; the `SIL1:<kind>:<id>` grammar; `TAG_KINDS` with two entries now — `AST` (asset)
  and `BIN` (stock line: part at a location, research §2.1) — and the five in §2.10 added later, one line each.
- `formatTag(kind, id)`, `parseTag(text) → { version, kind, id } | null`; Crockford base32 (drops I, L, O, U).
- Tests: a UPC-A, an EAN-13 and a Code 128 supplier string can never parse as a tag; `parseTag` round-trips
  `formatTag`; a lower-case or `0`/`O`-confused read normalises.

**Done when:** `pnpm --filter @silvicom/shared test` passes; `lint:shared-contracts` is green; one
`deriveKitStatus` assertion has been mutated to prove the suite can fail.

### I1b — `@silvicom/qr`: the reusable encoder — *no migration*

`packages/qr`, on the `@hazmat/engine` model: pure, deterministic, zero workspace dependencies, ignorant
of inventory.

- `encode(text, { ecc })` → `QrMatrix { size, modules }`; `toSvg(matrix, opts)`; `toSvgPath(matrix)` for
  callers placing it in their own `<svg>` or drawing it natively.
- `labelSheet(count, preset, { startPosition, nudge })` → pure geometry in PDF points for the D-INV25
  presets (`avery-22805`, `avery-22816`, `avery-5160`, `avery-5520`, `roll-single`). The api draws the
  placements with `pdfDraw`; the web previews the same numbers in SVG; neither can drift because there is
  one source of the numbers.
- Dependency: `uqr` 0.1.3, pinned exactly — MIT, zero runtime deps, ESM + types, 79 KB unpacked, runs
  identically in Node and the browser. Rejected: `qrcode` (pulls `yargs`), `qrcode-generator` (no ESM, no
  types).
- Decoding is NOT here (D-INV16).

**Gate work, in this PR, stated as work:** add `packages/qr` to the inline boundary array in
`scripts/check-feature-boundaries.mjs:283-287`; **restructure the determinism scan** (`:298-313`,
currently a single hardcoded `packages/hazmat-engine/src` path under "Scope is @hazmat/engine ONLY") into
a loop over `[hazmat-engine, qr]`, rewrite the comment, and extend the self-test so a planted
`Math.random()` in `packages/qr` fires. This chains onto `lint:boundaries`, already in CI by name; the
script comment says so.

**Done when:** `encode` reproduces committed golden matrices at each ECC level (the `@hazmat/golden`
pattern); `labelSheet` geometry is pinned for every preset and for `startPosition`; the determinism gate
has been shown to fire on `packages/qr`; `lint:boundaries` proves the package cannot import a workspace.

### I2 — Schema AND service: locations, parts, stock, the movement ledger — *next-numbered migration*

⚠ Schema and service ship in ONE PR (§1.3, `lint:table-producers`). New tables are exempt from
`lint:migration-ordering`. The RPC ships with its caller in the same merge because nothing can reach the
feature yet — stated in the PR.

**Four tables**, all `module=maintenance`, `layer=core`:

- `stock_locations` — id, org_id, name, code (unique per org), address, active.
- `parts` — id, org_id, part_number (unique per org), description, manufacturer, category, unit of
  measure, upc (indexed, nullable), image_path, last_cost (D-INV15), active, notes.
- `part_stock` — pk (org_id, part_id, location_id); quantity_on_hand `check (>= 0)` (D-INV26),
  reorder_point, reorder_quantity, aisle, row, bin, tag_code (the `BIN` tag, unique per org, nullable until
  a label is issued), active.
- `part_movements` — **append-only**; `id uuid primary key` (client-generated, D-INV27), org_id, part_id,
  location_id, reason, adjust_reason (nullable), quantity_delta, counted_total (nullable; the absolute
  figure typed on a count), count_session_id (nullable; the FK arrives with I5's table — see I5),
  unit_cost, vehicle_id / trailer_id (nullable, for issues), work_order_ref, note, actor_user_id,
  occurred_at (the client's clock — the offline queue supplies it), received_at (server `now()`),
  blind (bool, nullable; D-INV20).

**The bucket**, on `0146_compliance_documents.sql:118-120`'s pattern: `insert into storage.buckets
('inventory-photos', private, 10 MiB) on conflict do nothing`. **No `storage.objects` policy** (D-INV8).

**The RPC** — `record_part_movement(p_org uuid, p_actor uuid, p_row jsonb) returns part_movements`,
`security definer set search_path = ''`, `service_role` only, on the 0174 shape:

1. `insert into part_movements … on conflict (id) do nothing returning *`; if nothing was returned, select
   and return the existing row (the retry case) **without** touching the projection;
2. otherwise `update part_stock set quantity_on_hand = quantity_on_hand + delta where … and
   quantity_on_hand + delta >= 0`; if `row_count = 0`, `raise exception 'insufficient_stock' using errcode
   = 'IV010'` (the insert rolls back with it);
3. on a `counted` row, `delta` is computed inside the RPC as `counted_total − quantity_on_hand` at that
   instant, never trusted from the caller.

Plus `rebuild_part_stock(p_org)` (set-based from `sum(quantity_delta)`), and
`guard_part_movements_append_only()` on `0220:82-99`'s shape, `errcode 'IV011'`, firing for the service
role too.

**SQLSTATEs minted here:** `IV010 insufficient_stock`, `IV011 part_movements_append_only`,
`IV012 unknown_location`, `IV013 part_inactive`, `IV014 occurred_at_out_of_range` (more than 24 h from
`now()` — a phone with a wrong clock, refused rather than recorded).

**RLS, role lists verbatim** (`lint:section-policies` compares them to `SECTION_ACCESS`):

- write: `('admin','fleet_manager','technician')`
- read: `('admin','fleet_manager','auditor','accountant','technician')`

**FKs:** `vehicle_id` and `trailer_id` both `ON DELETE RESTRICT` — a ledger's job is to say where
something was, and neither table has an application delete path (§1.2). `location_id` RESTRICT.

**No `audit_row_change` trigger** (it exists on `vehicles` and `drivers` alone; a ledger is its own
audit). **Not in `RETENTION_FORBIDDEN` and given no prune rule** — operational counts, no personal data —
stated in the migration header.

**The read service**, `apps/api/src/modules/maintenance/inventory/`: `listParts`, `getPart`,
`listStock`, `listMovements` (paginated — PostgREST caps every response at 1,000 rows and
`part_movements` passes that within weeks), `recordMovement` (calls the RPC), each org-filtered and
mapped to `serviceError`.

**Done when:** `supabase/tests/inventory-stock.test.mjs` proves, with a fixture varied enough to
discriminate: the projection equals the ledger sum after a mixed sequence; the same `p_row` twice yields
one row and moves the projection once; a concurrent-shape sequence (two issues against one remaining)
refuses the second with `IV010`; a count records the variance rather than overwriting; `rebuild_part_stock`
is a no-op after the sequence; an UPDATE and a DELETE on `part_movements` raise `IV011` as the service
role; cross-tenant isolation holds. The four tables appear in `rls.test.mjs`'s `covered` list
(`handSeed` for `part_stock`). One assertion mutated to prove the matrix can fail.

### I3 — API: the parts routes — *no migration*

Routes under `/api/maintenance/inventory/…`: locations CRUD, parts CRUD, stock reads, the movement verbs
(`receive`, `issue`, `adjust`, `transfer`, `return` — `count` arrives with I5's session), the low-stock
query. Writes `rolesThatManage("maintenance")`, reads `rolesThatCanView("maintenance")`. Creating or
deactivating a part or a location writes an `audit_logs` row with the row UUID as `entityId` (A10). The photo route:
multipart upload through the API into `inventory-photos/<org>/<part>/…`, signed URL on read (D-INV8).

Every ledger read paginates server-side. Every query org-filters itself — the API bypasses RLS — and
`supabaseRecorder`'s `expectOrgScoped` asserts it; function fixtures, not flat arrays. `IV0xx` codes map to
`409`/`422` answers with the code in the body, never a 500.

**Done when:** route tests pass; `expectOrgScoped` covers every query; the recorder scripts `IV010` and
the route answers 409; `lint:table-writers` accepts the new pairs; one assertion mutated.

### I4 — Web: the shop home and Parts — *no migration*

**The shop home replaces "Repair spend" at `/shop`.** Measured: the largest nav group today is Safety at
6; Maintenance at 3 would reach 8 with every inventory surface as a row — the six-tab failure
`CLAUDE.md`'s worked example describes. So the group stays at six: **Shop** (home), Parts, Assets, Units,
Annual inspections, Inspectors. Scan is a button on the home and every inventory page; settings is a gear
on Parts; repair spend is one `StatCard` on the home with its existing honest message.

- `/shop` — `MaintenanceHomePage.vue`: `StatCard`s for low-stock count, kit shortfalls (from I9; hidden
  until then), today's movements; a Scan `AppButton size="lg"`; the repair-spend card. First-run empty
  state, three tiles: "Add a part · Import CSV · Print first labels" (research §5.16).
- `/shop/inventory`, `/shop/inventory/:id` — `PageHeader` → `DataWorkspace` (embedded `FilterBar` +
  `DataTable` + `TablePagination` in `#footer`), the shape of `AnnualInspectionsPage.vue:157-222`. Part
  detail: stock by location, the movement ledger as a paginated `DataTable`, the photo.
- Surface rows in `packages/shared/src/surfaces.ts` (group `maintenance`, `section("maintenance")`,
  detail rows with `parent`); **the existing key `maintenance.repair-spend` is kept and relabelled "Shop"**
  — org overrides are stored against the key (A8), and a rename would orphan them; icons in `navIcons.ts`; **routes in a new `router/routes/maintenance.ts`,
  with the three existing shop routes moved from `finance.ts:32-54` in the same PR**; both route-table
  snapshots regenerated.
- Badges: `stockLevelBadge()` in `@/lib/badges` (the `DqBadge` form), labels from shared.

**Done when:** `lint:surfaces`, `lint:tokens`, `lint:ui-adoption`, `lint:filesize` green; the six-row
group renders; the empty state renders under `preview:local` (`vite dev` crashes in this repo).

### I5 — Receive, issue, adjust, transfer; the count session — *next-numbered migration, two PRs*

**PR 1 — migration:** `stock_count_sessions` — id, org_id, kind (`location` | `unit`), location_id /
vehicle_id / trailer_id (nullable, exactly one set — the header cites 0092:137 and 0153:1-7: this is a
session about one place, not a parallel registry), started_by, blind, status, opened_at, closed_at, note;
its read service in the same PR. **And** the FK from `part_movements.count_session_id` (a column that
already exists from I2, so no new column — only a constraint on a table nobody reads yet).

**PR 2 — the screens.** Desk drawers (`*Drawer.vue` owning its `SlideOver`, actions in `#footer`,
`ComboSelect` for the unit):

- **Receive** — quantity, unit cost, supplier (free text), location; optional photo.
- **Issue** — to a vehicle or trailer, reason, note, nullable `work_order_ref` (D-INV5/10).
- **Adjust** — signed delta, adjust reason from the closed list (mandatory), note.
- **Transfer** — from location, to location, quantity.

**The count flow on the phone** — `/shop/count/:sessionId` under `layout: "shop"` (D-INV17), the session
component D-INV19 shares with I9:

- Start: pick a location (or arrive from the scanner with a bin already in hand); the session opens
  `blind` by default (D-INV20); any `manage` role may reveal, and the reveal is recorded on the row (A4); wake lock requested in the tap handler, re-requested on `visibilitychange`.
- Sticky header: "12 of 40 · 3 short" chips — counts, not percent.
- Per bin: scan the `BIN` tag or pick from the list → the expected figure is hidden → `QuantityStepper`
  (56 dp −/+, 12 dp gap, a 48 dp "0" chip, tapping the numeral opens `inputmode="numeric"` with the value
  selected; never `type=number`) → commit = one `counted` movement at once → undo toast "Counted 12 ·
  Undo", one action, ~6 s → next bin.
- A variance above the D-INV21 tier gets a `window.confirm` whose text carries the consequence ("Record 0
  of 12 / Keep counting"); above 10 % the row is badged "recount by someone else" and still commits.
- Close: review table sorted by variance, Short/Over/Match/Uncounted as badges not row tints
  (`danger` "−3", `warning` "+2", `success`, `neutral`); uncounted bins are a choice — zero or skip —
  never silently zeroed; Close is irreversible and says so.
- Connectivity strip in plain words ("Saving on this phone — will sync when connected") with the queued
  count; the IndexedDB queue + client UUID (D-INV27) behind it.

**Done when:** each desk verb writes exactly one ledger row and the projection follows; the count path is
proven to record variance (mutated); a receive and an issue can be completed with the keyboard alone; a
count of a 20-bin location can be completed on a phone with one thumb, blind, and the review shows the
right buckets — a named person did it and says so in §9.

### I6 — The scanner and the tag fabric — *no migration*

**First task: the spike.** Before any screen: `getUserMedia` + `barcode-detector`/`zxing-wasm`
(self-hosted, D-INV23) on one iPhone in Safari, the same iPhone installed to the home screen, and one
Android Chrome, decoding a printed `SIL1:BIN:…` at ECC-H on a 1" label and a supplier UPC. Record on
each: permission prompts across a route change, torch capability, behaviour after backgrounding, and
decode time. The results go in §9 before the second task starts. The camera helper lives in
`@/composables/useCameraStream.ts`, never in a feature.

**The fabric** — `apps/api/src/tags/{registry.ts,resolvers.ts,routes.ts}` (D-INV7): `registerTagResolver
(kind, resolver)`; `resolvers.ts` imports maintenance's `BIN` resolver now and `AST` in I7;
`GET /api/tags/resolve?code=` → `parseTag` → registered resolver → `ScanResult`; if not a tag, look up
`parts.upc`; an unregistered kind returns `unknown_tag`, a malformed string `malformed` — never a 500.

**The screen** — `/shop/scan` under `layout: "shop"`, one route for the whole loop (D-INV17):

- A 64 dp trigger in the bottom bar centre; tap = single scan, hold = continuous; a centre-weighted
  aimer, decode only inside it; centre-most code wins, tap picks another.
- On decode: tone + aimer flash, the decoded code shown for 150 ms before the sheet opens (Scandit's
  measured number); 800 ms same-symbol debounce.
- **The verb sheet** — a `SlideOver` from the bottom edge, ≤ 4 verbs at 56 dp, item card on top, first
  verb = last used. Stock line: on-hand here, then **Issue** (default), Receive, Count, Adjust. Asset
  (I7): where it is and since when, then **Move**, Report. Part by UPC: the stock lines it has, or
  "Attach this UPC to a part / Create a part with it" with the code kept in the form. Unknown: "Not
  recognised — create a part / an asset". A blocked action (an asset held elsewhere, an inactive part) is
  a named banner with the one-tap answer, never a silent skip.
- Torch button only when `getCapabilities().torch`; crop-zoom, no slider; on `visibilitychange` stop and
  re-acquire the stream; a "tilt 10–15° for shiny labels" hint in the empty state.
- The two fallbacks, always rendered: a still photo (`<input type="file" capture="environment">` → the
  same decoder) and a text field for the six Crockford characters printed under the QR.

**Done when:** the resolve route returns the union for a stock line, a UPC, an unknown kind and a
malformed code, and a test registers a fake kind to prove the registry is open; the scanner decodes a
printed sheet on both phones and the installed-app prompt count is recorded; a technician can scan a bin
and issue two of it to unit 654 without leaving the camera — named person, §9.

### I7 — Schema AND service: asset types, assets, movements, kit expectations — *next-numbered migration*

Same rule as I2: tables and service in one PR.

- `asset_types` — id, org_id, name, category, serialized, default_kit_quantity, image_path. The catalogue:
  Tablet, Tablet holder, Strap, Fridge, Chain, Load bar.
- `inventory_assets` — id, org_id, `tag_code` (unique per org, D-INV18), `display_no` (unique per org,
  sequence per org), asset_type_id, name, serial_number, model, manufacturer, status, condition,
  purchased_at, purchase_cost, warranty_expires_at, image_path, notes; holder as explicit nullable FKs
  `location_id` / `vehicle_id` / `trailer_id` with `check (num_nonnulls(location_id, vehicle_id,
  trailer_id) <= 1)`. **The migration header cites 0092:137 and 0153:1-7**: the only prior `num_nonnulls`
  was dropped because a 1:1 profile child was "a parallel equipment registry for what is simply a property
  of the trailer"; an asset is not a property of a unit — it moves between them, which is the feature.
- `asset_movements` — append-only; `id` client UUID (D-INV27), org_id, asset_id, from/to holder columns,
  reason, condition, note, actor_user_id (nullable for a driver's report, with `actor_driver_id` beside it
  — the only place a driver appears, and it is an actor, not a holder), count_session_id, occurred_at.
- `kit_expectations` — org-wide default per asset type per unit kind (`tractor` | `trailer` |
  `reefer_trailer`), plus a per-unit override row. Held-vs-expected is derived, never stored.

**The RPC** — `move_asset(p_org, p_actor, p_row jsonb)`: idempotent by id; writes the movement and updates
the holder columns in one transaction; `in_repair` and `reported_*` leave the holder as it is (D-INV24);
`raise 'IV020' asset_already_held` when the target already holds a serialized asset of a type whose
expectation is one — surfaced to the scanner as a blocker with "move it here". `rebuild_asset_holders
(p_org)` from the last movement per asset. `guard_asset_movements_append_only()`, `IV021`.

**SQLSTATEs:** `IV020 asset_already_held`, `IV021 asset_movements_append_only`, `IV022 duplicate_tag`,
`IV023 asset_retired`.

RLS lists verbatim as I2. FKs: all three holders RESTRICT. Register the `AST` resolver in
`tags/resolvers.ts`. No `drivers` FK anywhere (D-INV3), stated in the header so the next reader does not
re-derive it. `actor_driver_id` is NOT an FK for that reason — it is the driver's auth id, recorded as
text, as the audit log records actors.

**Done when:** `supabase/tests/inventory-assets.test.mjs` proves the CHECK rejects two holders; an asset
cannot be in two units; the holder reconstructed from movements equals the columns and `rebuild_asset_
holders` is a no-op; `in_repair` keeps the holder; a retry is one row; `IV020` fires; all four tables in
`covered` (`handSeed` for `inventory_assets`). One assertion mutated.

### I8 — API + Web: Assets — *no migration*

`/shop/assets`, `/shop/assets/:id`. The detail answers "where is tablet A-0412": holder, since when, the
current driver by inference, the photo, and the history as a **timeline** — sticky day headers, an icon
per reason, headline + delta + actor — by promoting `CaseTimeline.vue` to `@/components/` as the second
consumer D-DS18 asked for. On desktop the same history is also a `DataTable`. `assetStatusBadge()` in
`@/lib/badges`. Asset drawers: New asset (assigns `tag_code` and `display_no`), Move, Report.

**Done when:** `lint:ui-adoption` accepts the promoted timeline (it has two callers); the detail renders
a 30-movement history; a Move from the drawer and a Move from the scanner produce identical rows.

### I9 — Truck inventory: units and the unit check — *no migration*

**First task: roster cannot list equipment.** Add `listEquipmentIdentities(admin, orgId, kind,
{ activeOnly })` to `apps/api/src/modules/roster/equipmentInspection.ts`, exported from `roster/index.ts`,
as D-AVI9/D-AVI10 did for the inspection. It selects `is_reefer`/`trailer_type` properly (the bulk path at
`:87-92` does not — 46 reefers would get a dry-van kit) and paginates (441 units today, inside the
1,000-row cap; not assumed to stay there).

- `/shop/units` — every active tractor and trailer with `deriveKitStatus`: complete, short by N, extra.
  Kit shortfalls feed the home `StatCard`.
- `/shop/units/:kind/:id` — expected against held, assign and remove, the current driver's name derived
  at read time (D-INV3).
- **The unit check on the phone** — the I5 session component with `kind: "unit"`: walk the truck, scan
  each item; buckets Found / Not yet / Unexpected; an item recorded elsewhere offers "it's here now" as a
  one-tap `move_asset`; close → Short / Missing verdicts as `asset_movements` rows.
- Kit expectations: org-wide default per type per unit kind; per-unit override; a settings drawer on Units.
- The vehicle and trailer detail pages get a **read-only kit card** (D-AVI17: "the truck file adds a
  page, never a store"), gated `maintenance: view`, reading `GET /api/maintenance/inventory/units/:kind/:id`,
  holding nothing, with no edit affordance — a card that grew an edit button would be the workaround
  `CLAUDE.md`'s worked example describes.

**Done when:** kit status is computed by the one shared function on api and web; a fleet-wide default and
a per-unit override both take effect; a reefer gets the reefer kit; a unit check of a trailer with eight
items can be completed on a phone with one thumb — named person, §9.

### I10 — Tags and labels — *no migration*

Consumes I1b and I1; owns no QR logic.

- Issuance: `tag_code` from Crockford base32, `formatTag("AST"|"BIN", code)`, uniqueness by the index;
  `display_no` from the sequence.
- The sheet: `labelSheet()` gives the placements for the D-INV25 presets with a start position;
  `encode` + `toSvgPath` give the symbol at ECC-H; **`lib/pdfDraw.ts`** draws it (authored, not stamped —
  `report.ts:41-45`); the label carries the symbol, `display_no` in text, the part number or asset name.
- A web preview of the same sheet from the same numbers, with an X/Y nudge and the printed instruction
  "Scale 100 % / Actual size, media = Labels"; the diagnostic copy: uniform shift → nudge, progressive
  drift → scaling.
- The label screen states, in plain words, which stock survives where (§2.4): polyester + matte laminate
  on bins and shelves; anodized aluminium on the truck, near exhaust, under a washer.

**Done when:** a printed 22805 sheet scans back through I6 on both phones; a sheet started at position 7
prints at position 7; the preview and the PDF are pixel-compared for one preset.

### I11 — Settings — *next-numbered migration*

`inventory_settings`, one row per org on `idle_settings`' shape (`primary key (org_id)`, every tunable
`not null` with a default, `forbid_org_change` trigger): default location, low-stock recipients (a list
of member ids — per-user subscription, research §2.10), cycle-count cadence days. **No** costing setting
(D-INV15), **no** negative-stock setting (D-INV26), **no** tag prefix or format (D-INV18). Rendered with
`SettingsSection` in a drawer behind the gear on Parts — shop configuration, in the maintenance section.

### I12 — Low stock — *no migration*

Read-time first: the home `StatCard` and the Parts filter already show it after I4. An email, if asked
for, is a per-recipient daily digest on `dqAlertScheduler`'s shape (env flag, ~6 h, stateless), started
from `schedulers.ts`, after reading `docs/WORKER-DEPLOYMENT.md` — a scheduler runs in exactly one
process fleet-wide and `RUN_SCHEDULERS_IN_PROCESS` defaults to true.

### I13 — Driver app: the truck's kit — *next-numbered migration*

Migration: add `inventory.truck` to `driver_app_features.feature_key`'s CHECK **and** to
`driver_app_feature_overrides`' (`0134:38-41` and `:56-59` — two constraints).

The kit lives on Home's "Your rig" card (D-DB17): the expected items for this driver's unit(s) with
status. Tapping opens a screen of `ListRow`s; each opens a `ChoiceSheet` — Present / Missing / Damaged —
one tap to open, one to answer; one "Confirm kit" `ActionBar` with `haptic`. A Missing or Damaged answer
writes an `asset_movements` row (`reported_missing` / `reported_damaged`, `actor_driver_id`, holder
unchanged) through a driver-scoped route, and surfaces as a kit shortfall on `/shop/units` for a
technician to resolve. `OfflineBanner` and `SyncStatus` already cover the queue.

**Blocked on** the three driver release lanes (`action_required`, no APK, no OTA). Sequenced last; nothing
else waits on it.

### I14 — FleetPal reconciliation — *deferred, see Q1*

Not built here. Whatever the integration does with parts arrives through the D-SEP8 gate and states its
contract before it lands a row; the only open item is whether FleetPal has an export path at all.

---

## 6. Questions — answered 2026-09-08, kept as the record

| # | Question | Answer | Decision |
|---|---|---|---|
| Q1 | Which system is authoritative for parts once FleetPal lands? | Neither wholesale — authority splits by fact. The money half was already closed by the 2026-09-03 fleet ruling. | D-INV10 |
| Q2 | Does parts cost ever reach the fleet report? | No, permanently. GL `30230000` already carries $270,670.22. | D-INV11 |
| Q3 | Does the vehicle page get a read-only inventory card? | Yes — D-AVI17 already ruled the shape. | I9 |
| Q4 | Custom fields? | No. | D-INV13 |
| Q5 | Vendors and POs? | No. 0.34 % of vouchers carry a PO number. | D-INV14 |
| Q6 | Do trailers get kits? | Yes, from I7. | D-INV12 |
| Q7 | Who answers for a missing tablet? | Nobody signs (D-INV3). If a dispute occurs, the fix is an `esign_consents`-shaped acknowledgement on the existing movement row — Snipe-IT's asynchronous acceptance model — not a new table. | D-INV3 stands |
| Q8 | Moving average or last cost? | Last cost; the setting is deleted. | D-INV15 |

### 6.1 Assumptions still open — answer before the step that needs them

A plan is not assumption-free; an execution-grade one names its assumptions and the step that retires
each. Every row below is a fact nobody has measured yet. The step may not close while its row stands.

| # | Assumption | Retired by | Recommended answer, if none arrives |
|---|---|---|---|
| **A1** | The free decoder reads a printed ECC-H `SIL1:` label and a greasy supplier UPC on the shop's own phones, in Safari, installed, and on Android. | **I6 spike**, results in §9 before I6's second task | If it fails, Scandit's web engine (D-INV23); if that fails, D-INV28's revisit clause. |
| **A2** | **The shop has been measured.** Nobody has counted its locations, parts, bins per shelf, technicians, or their phones, or checked wifi in the bays. The session header ("12 of 40"), the offline queue, and the 1,000-row cap arithmetic all assume a small shop with patchy wifi. | **Before I2** — a one-hour visit; the numbers go in §1.4 | — |
| **A3** | **An initial parts list exists to import.** I4's "Import CSV" tile assumes a spreadsheet or a FleetPal export. Seeding five hundred parts by hand is the real go-live blocker, not code. | **Before I4** — obtain the file and its columns | If FleetPal has no export, the locked-header CSV template + error report (research §5.16) and one afternoon. |
| **A4** | **Who may reveal a blind count.** D-INV20 says "a supervisor"; there is no supervisor role — `technician`, `fleet_manager` and `admin` all hold `maintenance: manage`, and a role list is a gate only if it EQUALS a derived set. | **I5** | Blind is a **default, not a lock**: any `manage` role may reveal, and the reveal is recorded on the row (`blind=false`). A per-user narrowing, if ever wanted, is a surface entitlement, not a role list. |
| **A5** | **Kit contents per unit kind.** The catalogue (tablet, holder, strap, fridge, chain, load bar) is the owner's first description; quantities per tractor / dry van / reefer are unspecified. | **I9** — owner supplies the three default lists | Ship the defaults empty and let the first unit check populate them; the screen must not pretend to a kit nobody defined. |
| **A6** | **The label printer.** The presets are from the research, not from the shop; nobody knows what printer or stock it owns. | **I10** — ask before printing | Avery 22805 on a laser with polyester stock for bins; aluminium plates ordered from a vendor for truck items (§2.4). |
| **A7** | **`occurred_at` on a queued write is the phone's clock.** The offline queue means the client supplies it; the plan did not say so. | **I2** | The RPC stores the client `occurred_at` and its own `received_at`; the ledger shows `occurred_at`; a client time more than 24 h off is refused with `IV014`. |
| **A8** | **The `maintenance.repair-spend` surface key has org overrides stored against it** (the entitlement ledger, D-SURF*). I4 turns `/shop` into the home; renaming the key orphans those rows. | **I4** | Keep the key, relabel it "Shop"; the path stays `/shop`. A denial an org already recorded for repair spend now denies the home — and that is the honest reading of "technician sees only inspections". |
| **A9** | **Photos are served full-size.** There is no thumbnail pipeline for `inventory-photos` (`document_derive` is for compliance documents). | **I3/I4** | Lists show no photo; the detail shows one signed URL. A derive job is a later step with its own contract. |
| **A10** | **Acts outside the ledger are unaudited.** Creating or deactivating a part or location is not a movement. | **I3** | Those routes write `audit_logs` rows with the row UUID as `entityId`, the recruiting §4 rule. |
| **A11** | **FleetPal has an export path** for work orders. | Q1, not blocking | `work_order_ref` typed by hand. |
| **A12** | **`uqr` is deterministic and correct at every ECC level.** Verified only from npm metadata. | **I1b** golden fixtures | — |

**Still open, and not blocking:** whether FleetPal has an export path. If yes, D-INV10's tie-out becomes
automatic; if not, `work_order_ref` is typed. The schema is the same either way.

---

## 7. Deliberately out of scope — named, not silently dropped

- Purchase orders, vendor management, approvals, work orders (D-INV5/14).
- Preventive-maintenance scheduling — `vehicles.next_pm_due_*` exist as dead columns; a separate plan.
- Tyre tracking, core returns, warranty claims, RFID.
- Barcode scanning in the driver app (D-INV2). Decoding inside `@silvicom/qr` (D-INV16). Symbologies other
  than QR from our encoder — reading a supplier's UPC is the scanner's job.
- A shared org-wide `terminals` concept (D-INV1). Signatures on custody (D-INV3, Q7).
- A paid scanning SDK (D-INV23) unless the pilot fails on supplier 1D codes.
- An in-app label designer (D-INV25) — "a frustrating version of excel" is the reviewers' verdict on the
  one that ships.

---

## 8. Audit log — what each pass changed, dated

**2026-09-08, pre-implementation audit (first draft → second).** B1: a schema-only PR fails
`lint:table-producers`; schema and service ship together. B2: nothing lists equipment; I9 adds it. B3:
photos had no bucket. G1–G10: `isReefer: null` hardcoded; RLS role lists written verbatim; PostgREST's
1,000-row cap; `.vue` is covered by `lint:filesize`; FK delete behaviour; no `audit_row_change`;
retention stated; UPC/tag non-collision; the route snapshot.

**2026-09-08, second audit (every claim re-executed; second → third).** Six claims corrected: D-INV8's
storage policy would trip `lint:section-policies`, not be checked by it; the tenant-isolation test fails
on unseedable tables rather than skipping them; `PACKAGE_BOUNDARIES` did not exist and the determinism
scan is hardcoded; there was no live `getUserMedia` in the codebase and the helper is feature-internal;
the registry precedent is the queue fabric, not `org`; the ordering gate cannot see functions. Twelve
reliability gaps closed (§2.12, D-INV26/27, `IV` SQLSTATEs, `p_actor`, append-only triggers, RESTRICT on
both FKs, no SKIP in matrices, manual entry, the driver's report having a row). Citations corrected:
ARCHITECTURE §3 not §4; four tables not three; `pdfDraw` for authored PDFs; routes live in `finance.ts`;
`*Drawer.vue`; `merge_driver_v2`; the feature CHECK on two tables; 0153's rejection addressed in I7's header.

**2026-09-08, research (third).** `INVENTORY-UX-RESEARCH.md`. D-INV17–25 added; steps re-sequenced so
the scanner precedes assets; the count became a session; the home replaced repair spend as the group's
first row; the asset got two identifiers (reversing the second audit's "one identifier"); decode feedback
lost its haptic on the web. Step numbers changed: old I6–I13 → new I7, I8, I9, I10 (labels), I6 (scanner +
fabric, absorbing old I9b), I11, I12, I13.

---

## 9. What shipped

*(Append dated lines here as steps land — never by editing step text; parallel PRs editing adjacent rows
conflict every time. Each phone flow's usability sentence is signed here by the person who did it.)*
