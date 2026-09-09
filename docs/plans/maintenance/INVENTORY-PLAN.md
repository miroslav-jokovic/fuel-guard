# Shop inventory and truck inventory — the maintenance section's second and third features (2026-09-08)

Two features, one module, one shared spine:

- **Shop inventory** — the parts and tools the repair shop holds, counted, located, and consumed.
- **Truck inventory** — the equipment that belongs to a unit: tablet, tablet holder, straps, fridge,
  chains, load bars. What should be on unit 654, what actually is, and what left when.

They are one plan because they share a single tag namespace and a single scan that resolves it. A
technician holding a phone does not know, and must not need to know, whether the code on the object in
their hand belongs to "shop inventory" or "truck inventory". One scan, one answer.

Both land inside the existing `maintenance` module (`apps/api/src/modules/maintenance/`), under the
existing `maintenance` section, in the existing sidebar group, used by the existing `technician` role.
Nothing about the permission surface is new (§1.1).

Canon this plan answers to: `docs/ARCHITECTURE.md` (ownership, D-ARC3), `docs/SILVICOM-360.md`
(product scope, D-S360), `docs/MIGRATION-DISCIPLINE.md` (the deploy window),
`docs/DESIGN-SYSTEM-CONTRACT.md` + `apps/web/CLAUDE.md` (UI), `ANNUAL-INSPECTION-PLAN.md` beside this
file (the register and the execution protocol), and `INVENTORY-UX-RESEARCH.md` beside this file (how
the leading products do this work, every claim cited — §2.5 and D-INV17–25 rest on it).

---

## 1. Measured reality (2026-09-08, `origin/main` at `4cf7d97`, migrations through 0330)

### 1.1 What exists and is reused

| Fact | Where | Use |
|---|---|---|
| `maintenance` is one of the 12 `AppSection`s | `packages/shared/src/auth.ts:76` | No new section, no `SECTION_ACCESS` edit. |
| `technician` holds `maintenance: manage`, `equipment: view`, all else `none` | `auth.ts:183` (D-AVI11, 0279) | No new role. |
| The Maintenance sidebar group: three nav surfaces (`/shop`, `/shop/inspections`, `/shop/inspectors`) and one detail surface, all `section("maintenance")` | `packages/shared/src/surfaces.ts:226-228, 248`; group `:89` | New screens are rows in this group; icons in `apps/web/src/lib/navIcons.ts:96-98` (shared is RN-compiled; `lint:surfaces` checks both directions). |
| The `maintenance` API module owns four tables: `maintenance_inspectors`, `vehicle_inspections`, `vehicle_inspection_items`, `maintenance_print_profiles` | `scripts/table-modules.json` | New tables join this owner. |
| The shop routes live in `router/routes/finance.ts:32-54` (`/maintenance` was taken by the downtime page, `:4-6`) | `apps/web/src/router/routes/finance.ts` | I4 moves them into `maintenance.ts`. |
| Maintenance's drawer idiom: a `*Drawer.vue` owns its own `SlideOver`, actions in `#footer` | `apps/web/src/features/maintenance/InspectorDrawer.vue:20-21` | New forms follow it. |
| Two PDF stacks by job: `pdf-lib` stamps an existing template; `lib/pdfDraw.ts` on pdfkit authors documents | `modules/maintenance/inspections/render/report.ts:41-45`, `apps/api/src/lib/pdfDraw.ts` | Label sheets are authored → `pdfDraw` (I10). |
| The startup registry precedent: `registerHandler(kind, handler)` in `queue/registry.ts`, populated by `queue/handlers/index.ts`, called from `app.ts:306` | `apps/api/src/queue/registry.ts` | The tag-resolver registry is a sibling fabric, `apps/api/src/tags/` (D-INV7). |
| `vehicles` and `trailers` are two tables; `trailers` carries `is_reefer`, `trailer_type`, `assigned_vehicle_id` | `supabase/schema.generated.sql:5178, 5541` | Every equipment reference is two nullable FKs, as `duty_equipment_segments` does. |
| `vehicles.assigned_driver_id` (office record) and `duty_equipment_segments` (driver check-in) both exist | `schema.generated.sql:1231-1255` | D-INV3 reads neither as a holder; the driver is shown by inference. |
| Roster exports `getEquipmentIdentity` (one row) and `getEquipmentIdentities(admin, orgId, subjectType, ids)` (explicit ids); nothing lists equipment; the bulk path hardcodes `isReefer: null` | `apps/api/src/modules/roster/equipmentInspection.ts:40-45, 76-92` | I9 adds `listEquipmentIdentities` to roster first. |
| The SPA's responsive machinery is `DataTable` → `DataTableCards` below 768 px and an `lg:` sidebar drawer; the only phone-first page is the public `/apply/:token` under `layout: "apply"` outside `AppShell` | `components/ui/DataTable.vue:255`, `layouts/AppShell.vue:125`, `router/routes/auth.ts:40-43`, `layouts/ApplyLayout.vue` | The scan and count screens get their own layout on the apply model (D-INV17). |
| No live camera stream exists; `webImageIo.ts` uses `<input type="file" capture="environment">` (D-APP11), feature-internal to `apply`; the web feature allow-list is empty | `apps/web/src/features/apply/capture/webImageIo.ts:92-107`; `scripts/check-feature-boundaries.mjs:70-73` | The camera helper is new and lives in `@/composables` (I6). |
| `CaseTimeline.vue` is local to anomalies by D-DS18 and promotes on a second consumer; `StatCard`, `SettingsSection`, `FileDropzone` are shared | `features/anomalies/CaseTimeline.vue:11-17`, `components/ui/` | I8 promotes the timeline. |
| Badges: `[BADGE_BASE, toneClass(...)]` from `@/lib/badges`; `DqBadge`-returning helpers carry label + tone with labels from shared | `apps/web/src/lib/badges.ts:5-15, 86-91` | One helper per inventory enum. |
| Driver app components: `NumericField`, `ChoiceSheet`, `ConfirmSheet`, `ActionBar` (`haptic`), `OfflineBanner`, `SyncStatus`, `Progress`, `ListRow`, `GroupedList`, `EmptyState`; Home has a "Your rig" card (D-DB17) | `apps/driver/src/components/`, `DRIVER-APP-DIRECTION-B-PLAN.md:149` | I13 composes these. |
| Two mail schedulers exist: the weekly theft digest (`modules/org/digest.ts`) and DQ expiry (`modules/evidence/dqAlertScheduler.ts`: env flag, ~6 h, stateless) | `apps/api/src/schedulers.ts:45` | I12 copies the DQ shape if an email is ever built. |
| `esign_consents` (0227): `disclosure_version`, `intent_statement`, `consented_at`, column-wise immutable, SQLSTATE `EC010` | `supabase/migrations/0227_esign_consents.sql:52-110` | Q7's revisit path. |

### 1.2 What does not exist

- **No inventory schema.** Across 330 migrations the only match is the text column
  `financial_entries.purchase_order_no` (0257:242).
- **No place concept.** `terminals` was created at 0097 and dropped at 0259 after zero rows, producers and
  readers were measured in production.
- **No barcode reader.** `apps/driver` carries `expo-image-picker` and the document capture engine only;
  `apps/web` has none; nothing depends on `uqr`, `qrcode`, `zxing` or `jsqr`.
- **No `BarcodeDetector` on iOS.** Safari has not shipped it (caniuse: "disabled by default in 26.6";
  WebKit bug 281848 open, uncommented, July 2026). Every iPhone decodes in WebAssembly.
- **`documents.subject_type` cannot name an item** — CHECK `in ('driver','tractor','trailer','load',
  'organization')` (`0146_compliance_documents.sql:34`), and `documents` is evidence-owned, append-only.
- **No work-order table.**
- **No `merge_vehicle`, no application delete path for `vehicles` or `trailers`**, no retention rule
  naming either; `vehicles` is in `RETENTION_FORBIDDEN`.

### 1.3 The gates — what each requires of this plan

| Gate | Rule (as implemented) | Requirement |
|---|---|---|
| `lint:table-producers` (`scripts/check-table-producers.mjs:13-19`) | A table needs `.from("<table>")` in non-test app source, or DML inside a migration-defined function body. FK references, policies, indexes and `.rpc()` calls are not evidence. | Schema and its service ship in one PR. |
| `lint:migration-ordering` (`check-migration-ordering.mjs:186, 234-239`) | Parses `add column` / `rename column` only; a table created in the same migration is exempt; `create function` is not read. | New tables ship with readers. A new RPC ships with its caller only while the feature is unreachable, stated in the PR; a later signature change is two merges, checked against `pg_proc`. |
| `lint:section-policies` (`check-section-policies.mjs:67, 151, 165`) | Role lists in both SQL spellings are compared to `SECTION_ACCESS`; `on storage.objects` reduces to `objects`, maps to no section, and errors. | Role lists verbatim (I2). No `storage.objects` policy (D-INV8). |
| `lint:table-access` (`check-table-access.mjs:97-99`) | Guards `layer=raw` tables only. | Equipment is read through roster's interface anyway (D-ARC3). |
| `lint:boundaries` (`check-feature-boundaries.mjs:70-73, 116-118, 283-313`) | Empty web allow-list; API edges `maintenance -> evidence\|roster\|org`; package boundaries are an inline array; the determinism scan is hardcoded to `packages/hazmat-engine/src`. | I1b restructures the determinism scan into a loop over package roots, with a self-test. |
| `lint:filesize` (`check-file-size.mjs:55-56, 122`) | 500 hard / 450 warn; `.ts .tsx .vue`. | Forms extracted from the first commit. |
| `rls.test.mjs` → `tenantIsolation.mjs:297-303, 384-390` | Unseedable tables fail the matrix; `handSeed` (`table: (orgId) => sql`) seeds multi-column CHECKs. | `handSeed` for `part_stock` and `inventory_assets`. |
| `lint:surfaces` (`check-surfaces.mjs:44-46, 149-198`) | Reads the `route table 1` snapshot by key; every path must exist; nav surfaces ↔ icons both ways; `requireSurface` keys must be catalogued. | Rows, icons and regenerated snapshot in I4. |
| `lint:shared-contracts` (`check-shared-contracts.mjs:15-23, 37`) | An app-side `…Schema\|Dto\|Contract\|Payload` symbol that shadows or duplicates shared fails. | Contracts in shared. |
| `lint:upserts` (`check-partial-upserts.mjs:19-32`) | Partial upsert payloads and `onConflict: "id"` non-literals are banned. | The ledger has no upsert. |
| `lint:table-writers` (`package.json:110`) | Freezes `(table → file)` pairs; the chain regenerates and diffs `supabase/schema.generated.sql`. | Pairs and snapshot in the same PR. |
| `check-rls.mjs:5-12` | Every `create table` needs `enable row level security`. | On every table. |
| `lint:comment-claims` (`check-comment-claims.mjs:15-19`) | A "proves"/"pinned by" comment must name a `*.test.ts` and quote a real `it()` title; `.test.mjs` is invisible. | Matrix claims are stated as facts. |
| `docs/ARCHITECTURE.md` §3 | Hand-maintained ownership table; no gate reads it. | I0 edits §3. |

### 1.4 Production measurements (2026-09-08)

| Fact | Value | Bearing |
|---|---|---|
| Active trailers / tractors / reefers | **234 / 207 / 46** | D-INV12 |
| GL `30230000 Shop Parts` | **$270,670.22** | D-INV11 |
| Maintenance GL family, 10 accounts | **$1,420,366.93** (`40160000 Tires` $332,215.60; `30240000 OTR >$1000` $282,626.06; `30350000 Trailer Repair` $264,021.87; `30250000 OTR <$1000` $123,101.58) | D-INV11 |
| `financial_entries` rows / `category='maintenance'` | **49,873 / 0** | The `/shop` message is about the projection, not Finance. |
| AP vouchers carrying a PO number | **5 of 1,464 (0.34 %)** | D-INV14 |
| Shelf addressing in the shop | **None — there are no aisle, row or bin numbers** (owner, 2026-09-09) | `part_stock.aisle/row/bin` are nullable and nothing requires them; `tag_code` is what addresses a shelf here |

---

## 2. The findings that decide the shape

### 2.1 Stock is fungible; an asset has an identity

A case of oil filters is *stock*: eleven of them, interchangeable; the questions are "how many" and
"where". A tablet is an *asset*: A-0412, a serial number, in truck 654, in 611 before that; when it goes
missing the question is which one and from where. Fleetio models stock and only stock (part at a
location, per-location quantity, reorder point); Snipe-IT models assets and only assets (unique tags,
check-out to a person, a location, or another asset). "Check out to another asset" is truck inventory.

`parts` + `part_stock` + `part_movements` for consumables; `inventory_assets` + `asset_movements` for
anything with a serial number, in the tool crib or in a truck. Truck inventory is the asset table with a
unit as the holder.

### 2.2 A quantity is a measurement

`part_stock.quantity_on_hand` is never typed. Every change is a `part_movements` row — received, issued,
adjusted, transferred, counted, returned — and the quantity is the projection of that ledger, maintained
inside one RPC. It is the house rule (D-S360-6, `sql-returns-measurement`); a typed quantity is the write
`lint:upserts` forbids; and "where did the eleventh filter go" is the only inventory question anyone asks.
A count is a movement whose delta is taken at count time, so a delivery received mid-count is not
overwritten.

### 2.3 The shop scans on the web; the driver confirms in the app

The driver app is drivers-only by construction: `SessionProvider.tsx:130-142` routes every non-driver
role to `wrong-app`; logins are synthetic emails from `drivers.app_username`
(`driverAuthContract.ts:11-28`); RLS keys on `auth_driver_id()`; `driver_app_features.feature_key` is
CHECK-constrained on two tables (`0134:38-41`, `:56-59`); all three release lanes are at
`action_required`. A technician is a web user with a real email. A driver is the right person to confirm
the fridge and the straps are in the truck, and needs a list and two answers, not a scanner. So: the shop
scans on the web (I6); the driver confirms the kit in the app (I13), last, without scanning.

### 2.4 The tag

The QR encodes a short opaque id, never a URL — a URL bakes a hostname into five hundred labels and
publishes the org's vendor to anyone holding the object. The human-readable code is printed beside the
symbol. ECC-H (30 %) for a tag that gets grease; a payload short enough for a version-4 symbol, which
gives a 1-inch QR ~0.69 mm modules against a 0.4 mm phone floor. Materials: thermal-transfer polyester
with matte laminate on bins and shelves; photo-anodized aluminium on the truck, near exhaust and under a
pressure washer. Adhesive paper fails in 60–90 days in that environment; the label screen says so (I10).

### 2.5 The bar, and what the leaders do

A technician receives a delivery, issues a part to a unit, and counts a shelf without reading
documentation; labels are a screen, not an export. `INVENTORY-UX-RESEARCH.md` measured Fleetio,
MaintainX, Limble, UpKeep, Fullbay, Shelf, Cheqroom and Reftab. What every good one does, and this plan
copies: a scan resolves to a part **at a location**; an unknown code offers "attach or create"; quantity
is a stepper plus keypad taking an absolute total; a manual decrease needs a reason; counts are **blind**
by default; a count saves per row; a variance above a threshold triggers a recount; a kit is type +
quantity rules filled by scanning; an audit is expected list + session + three buckets, with "missing" a
verdict at close. What none of the fleet products do, and this plan does: continuous scan with a tally,
decode feedback, manual entry as a fallback, a scan trigger sized for a gloved thumb — Scandit's
published research supplies the spec (research §4).

### 2.6 Custody has a legal edge, and the ruling is no signature

Deductions for unreturned equipment are a live dispute area in trucking. The owner ruled (D-INV3):
inventory belongs to the unit, the driver is the holder by inference, no signed handover. Shelf, the
best-designed asset product, made the same choice. A missing item has a dated movement history showing
which unit it was in and when it left. Q7 carries the revisit path. No table gains a `drivers` FK, so
`merge_driver_v2` (0264) is untouched.

### 2.7 FleetPal is operational, not financial

The 2026-09-03 fleet ruling (`FINANCE-FLEET-REPORT-PLAN.md` §0, D-FLEET2) deleted FleetPal from Finance;
McLeod's GL is the entire financial input. The FleetPal integration is work orders, PM schedules and DVIR
defects. Authority splits by fact: the shelf is ours (on-hand, location, reorder, counts, asset identity,
kits); the repair job and what it consumed are FleetPal's; a nullable `work_order_ref` on the issue row
ties them by reference (D-INV10). Two canon locations still carry the superseded financial contract and
are rewritten in I0.

### 2.8 Parts spend is already in the fleet report

`30230000 Shop Parts` carries $270,670.22 inside a $1.42 M maintenance family tied to the printed income
statement. D-FS1 (the canonical index `(org_id, dedup_key) where is_canonical and not is_void`),
D-FLEET1 (no per-truck cost) and D-FLEET8 (nothing allocated) each forbid a second arrival. A part issue
is not a spend event; the money left when the part was bought (D-INV11).

### 2.9 Trailers are the majority

234 active trailers against 207 tractors, and the straps, chains and load bars live in trailers. Both
from I7 (D-INV12).

### 2.10 The QR concern is product-wide

Later tags: `vehicle`/`trailer` (the digital truck file), `inspection` (the printed §396.17 report),
`document` (a DQ binder cover), `location` (a shelf), `invite` (a printed driver invitation). The
vocabulary (`SIL1:<kind>:<id>`) is a contract in shared; the encoder is a pure package; the resolver
registry is a fabric beside the modules (D-INV7, D-INV16). A UPC cannot parse as a tag: the version
prefix is alphabetic, a UPC is digits.

### 2.11 The scanner on the phones the shop owns

- Every iPhone decodes in WASM; the WASM is self-hosted (the default CDN fetch is CSP-blocked and
  unreachable from a bay with no signal).
- An installed (home-screen) web app re-asks for the camera on every route change (WebKit 215884, iOS
  18.5+ reports in 2026). The scan page hosts scan → resolve → act on one route.
- Torch works on iOS ≥ 17.5.1, gated on `getCapabilities().torch`; `zoom` is exposed but not applied, so
  small labels get crop-zoom; `ImageCapture` does not exist; the track mutes on background and is
  re-acquired on `visibilitychange`.
- iOS web has no vibration; decode feedback is tone + flash. The driver app has haptics.
- Torch on a laminated label adds glare; the hint is "tilt 10–15°".
- Background Sync will not ship on Safari. Writes are queued in IndexedDB before the network call, keyed
  by a client UUID the server treats as idempotent, replayed on `online` and on foreground. Installed
  apps are exempt from Safari's seven-day storage purge; the shop installs.

### 2.12 Reliability rules

1. **Idempotent writes.** Every movement has a client-generated UUID primary key; the RPC inserts
   `on conflict (id) do nothing` and returns the existing row.
2. **Guarded UPDATE first.** The RPC updates the projection with `quantity_on_hand + delta >= 0`, inserts
   the movement only when `row_count = 1`, and raises a named SQLSTATE otherwise.
3. **Rebuildable projections.** `rebuild_part_stock(p_org)` and `rebuild_asset_holders(p_org)` recompute
   from the ledgers; the matrices assert both are no-ops after a mixed sequence.
4. **Enforced append-only.** Each ledger has its own guard trigger on `0220_driver_applications.sql:82-99`'s
   shape, firing for the service role, with its own SQLSTATE; the matrix mutates a row to prove it.

---

## 3. Decisions

| ID | Decision | Source |
|---|---|---|
| **D-INV1** | **Stock locations are a table.** `stock_locations` (maintenance-owned: name, code unique per org, address, active); stock is held per part per location with aisle/row/bin. Multi-location is a paid tier in MaintainX and UpKeep and the top complaint when missing. `stock_locations` points at `terminals` if that is ever rebuilt. | Owner 2026-09-08 |
| **D-INV2** | **The shop scans on the web; the driver confirms the kit in the app, last, without a scanner.** WASM decoding on every iPhone; native only where Android Chrome offers it. I13 waits on the release lanes. | §2.3, §2.11 |
| **D-INV3** | **Truck inventory belongs to the unit.** An asset's holder is a vehicle, a trailer, or a stock location — never a person. The driver is shown by inference from `vehicles.assigned_driver_id` at read time. No handover, no signature. | Owner 2026-09-08 |
| **D-INV4** | **A quantity is derived from the ledger.** `part_movements` is the truth; `part_stock.quantity_on_hand` is a projection maintained by the RPC; a count is a movement with a variance taken at count time. | §2.2 |
| **D-INV5** | **A part is issued to a vehicle or trailer with a reason.** No work-order table. Issue rows carry unit, reason, date, cost and a nullable `work_order_ref`. | Owner 2026-09-08 |
| **D-INV6** | **Silvicom builds its own shop inventory; the bar is that it is easier to use than FleetPal's.** | Owner 2026-09-08 |
| **D-INV7** | **One opaque id per tag; one product-wide resolve endpoint.** `GET /api/tags/resolve?code=` parses with `parseTag`, dispatches to the resolver the owning module registered, returns a discriminated union; a non-tag string is tried as a UPC. The registry is `apps/api/src/tags/` (`registry.ts`, `resolvers.ts` importing each module's resolver, `routes.ts` mounted in `app.ts`) on the queue fabric's model. Adding a kind is one import line. | §2.10 |
| **D-INV8** | **Inventory photos are a private bucket, `inventory-photos`, with no `storage.objects` policy.** Created in I2's migration on 0146's `insert into storage.buckets` pattern. Uploads go through the API (service role); reads are signed URLs (`modules/evidence/compliance.ts:186`, TTL 300 s, `createSignedUrls` batched). | §1.2, §1.3 |
| **D-INV10** | **Silvicom owns the shelf; FleetPal owns the repair job.** On-hand, location, reorder, counts, asset identity and kits are ours; the work order and what it consumed are FleetPal's; `work_order_ref` ties them by reference. | §2.7; Q1 |
| **D-INV11** | **Parts cost never reaches Finance.** GL `30230000` already carries it; D-FS1, D-FLEET1 and D-FLEET8 close the other doors. Inventory holds `last_cost` for "what is this shelf worth" and nothing else. | §2.8; Q2 |
| **D-INV12** | **Trailers are in scope from I7.** | §2.9; Q6 |
| **D-INV13** | **No custom fields, no jsonb bag.** Fixed fields plus a notes column; recurring notes become columns. | Q4 |
| **D-INV14** | **No vendors, no purchase orders.** Receiving takes a supplier name and a cost. | Q5 |
| **D-INV15** | **Last cost; not configurable.** | Q8 |
| **D-INV16** | **The QR concern is two reusable pieces.** `packages/shared/src/tagContract.ts` owns the vocabulary; `packages/qr` (`@silvicom/qr`) owns encoding and label-sheet geometry — pure, zero workspace deps, on the `@hazmat/engine` model. Decoding lives with the scanner. | §2.10 |
| **D-INV17** | **The scan page and the count session use a standalone shop layout, and the scan route does not change while the camera is open.** `layout: "shop"` on `ApplyLayout`'s model: no sidebar, full-height viewport, `overscroll-behavior-y: contain`, a sticky bottom action bar with `env(safe-area-inset-bottom)`, in-content back. Scan → resolve → verb sheet → write all happen on `/shop/scan`. Every other inventory screen is a desk screen in `AppShell`. The shop installs the web app to the home screen. | §2.11; research §1, §5.1 |
| **D-INV18** | **An asset has two identifiers and no identifier setting.** `tag_code`: the opaque Crockford base32 id in the QR, assigned once, never reprinted. `display_no`: a per-org sequence (`A-0412`), auto-assigned, printed in text under the QR, spoken aloud. | Research §3.4 |
| **D-INV19** | **A shelf count and a unit check are one session shape.** `stock_count_sessions` (org, location or unit, started_by, blind, status, opened/closed_at). Each entry commits at once — a `counted` movement or an `asset_movements` row carrying the session id. Buckets Found / Not yet / Unexpected while open; Short / Over / Missing at close. One session component serves parts (I5) and units (I9). | Research §2.7, §3.3 |
| **D-INV20** | **Counts are blind by default.** The expected figure is hidden until the count is typed; any `manage` role may reveal; the mode is recorded on the row. | Research §2.6 |
| **D-INV21** | **Variance tiers.** Above max(5, 5 %) or a zero against non-zero: a consequence-labelled confirm. Above 10 %: the row is flagged for a second counter; the movement still commits, and the recount is a second `counted` row. Never "Are you sure". | Research §2.8 |
| **D-INV22** | **Decode feedback is tone + aimer flash on the web, haptic in the driver app.** | §2.11 |
| **D-INV23** | **The decoder is `vue-qrcode-reader` on `barcode-detector`/`zxing-wasm`, self-hosted; the still-image path is first class.** MIT; reader-only WASM ≈1.04 MiB via `prepareZXingModule({ locateFile })` at our origin; lazy-loaded on `/shop/scan`. `<input type="file" capture="environment">` and typed entry are rendered on the scan page as fallbacks. Paid SDKs (Scandit first) only if the I6 spike fails on supplier 1D codes. | Research §4.6 |
| **D-INV24** | **`in_repair` does not clear the holder.** A tablet in repair is still unit 654's tablet, missing from it. | Research §3.9 |
| **D-INV25** | **Label presets: Avery 22805 (1½"), 22816 (2"), 5160, weatherproof 5520, roll single; a start position and an X/Y nudge; no designer.** ECC-H, payload ≤ version 4, `display_no` beside the symbol; the label screen names the materials. | §2.4; research §3.10, §5.15 |
| **D-INV26** | **Negative stock is refused; there is no setting.** `check (quantity_on_hand >= 0)` behind the RPC's guard. A shelf that has gone negative has a counting problem; the count movement is the fix. | §2.12 |
| **D-INV27** | **Every movement is idempotent by a client-generated UUID.** The server half of the offline queue. | §2.12 |
| **D-INV28** | **The shop scanner is the web app, not a native technician app.** A native app changes one screen's camera layer; the driver app cannot host it (§2.3), so it would be a second Expo app behind blocked release lanes, an Individual Apple account and no iOS CI. The web scanner ships with the API behind the desk's login. If the shop buys devices, buy Android (native `BarcodeDetector`, persistent permission, vibration API). Revisit if the I6 spike fails with the free decoder and a paid web SDK, if technicians reject the installed app for camera reasons after a real week, or if the release lanes unblock. | Owner 2026-09-08 |

---

## 4. Execution protocol

1. **One step per PR.** PR → CI → merge commit. Never direct-merge main.
2. **Branch from `origin/main`**; re-check `git branch --show-current` before every commit and push — the
   working tree is shared with parallel sessions.
3. **Migration numbers are next-numbered at execution**, never pinned (0331 is free at time of writing).
4. **Every new table:** `enable row level security`; an entry in `scripts/table-modules.json`; writer
   pairs in `scripts/table-writers.json`; the regenerated `supabase/schema.generated.sql`; a `handSeed`
   where the generic seeder cannot build the row; a PGlite matrix that prints `RESULT`, closes the db,
   and has no SKIP branch.
5. **New tables ship with their readers in one PR.** A new column on an existing table is two merges. A
   new RPC ships with its caller only while the feature is unreachable, stated in the PR.
6. **Named SQLSTATEs.** Prefix `IV`. The API maps them through `modules/maintenance/inspections/
   serviceError.ts`'s pattern; the recorder scripts them to prove the mapping.
7. **Security-definer RPCs take `p_actor`.**
8. **Prove a test can fail** by mutating one assertion per step.
9. **Every phone flow's done-when has a usability sentence**, checked by a named person and signed in §8.
10. **Progress is dated lines in §8**, never edits to step text.
11. **Run the full gate list before pushing.**

---

## 5. Steps

Ordered by dependency. The scanner (I6) precedes assets (I7) because the count flow and the unit check
both use it.

### I0 — Governance — *no migration*

- `docs/SILVICOM-360.md` §3: add **D-S360-7 — Inventory**, naming both features, D-INV6/D-INV10 and this plan.
- `docs/ARCHITECTURE.md` §3 (`:79`): add the nine inventory tables to the `maintenance` row; state four
  existing tables.
- `docs/ARCHITECTURE.md:75`: the `fleetpal` row becomes operational (D-INV10); the financial contract is
  deleted (D-FLEET2); parts cost never arrives (D-INV11).
- `apps/api/src/modules/maintenance/index.ts:1-12`: the header lists the four tables it owns and points
  at D-INV10/11; the dedup contract paragraph is removed.
- `docs/ARCHITECTURE.md` §6: `.vue` is covered by `lint:filesize`.

**Done when:** both canon documents name the feature and no document instructs a FleetPal financial
projection.

### I1 — The contracts — *no migration*

**`packages/shared/src/inventoryContract.ts`**

- Zod schemas: part, stock line, part movement, count session, asset type, asset, asset movement, kit
  expectation.
- Closed vocabularies as `as const` arrays with label maps:
  - part movement reason: `received`, `issued`, `adjusted`, `transferred`, `counted`, `returned`;
  - adjust reason: `damaged`, `lost`, `found`, `expired`, `correction`;
  - asset status: `in_service`, `in_repair`, `spare`, `lost`, `retired` (`in_repair` keeps its holder, D-INV24);
  - asset movement reason: `assigned`, `removed`, `transferred`, `reported_missing`, `reported_damaged`,
    `found`, `retired`;
  - holder kind: `location`, `vehicle`, `trailer`, `unassigned`; condition: `good`, `worn`, `damaged`;
  - count session status: `open`, `closed`.
- Pure functions with tests: `isLowStock(stock)`; `deriveKitStatus(expected, held)` → complete /
  short-by-N / extra; `countVarianceTier(expected, counted)` → none / confirm / recount (D-INV21);
  `nextDisplayNo(seq)` → `A-0412`; the `ScanResult` union
  (`stock_line | asset | part_by_upc | unknown_tag | malformed`).

**`packages/shared/src/tagContract.ts`**

- `TAG_VERSION = "SIL1"`; the `SIL1:<kind>:<id>` grammar; `TAG_KINDS` = `AST` (asset), `BIN` (stock line);
  later kinds are one line each.
- `formatTag(kind, id)`, `parseTag(text) → { version, kind, id } | null`; Crockford base32 (no I, L, O, U).
- Tests: UPC-A, EAN-13 and Code 128 strings never parse as a tag; `parseTag` round-trips `formatTag`;
  lower-case and `0`/`O`-confused reads normalise.

**Done when:** `pnpm --filter @silvicom/shared test` passes; `lint:shared-contracts` is green; one
`deriveKitStatus` assertion mutated.

### I1b — `@silvicom/qr` — *no migration*

`packages/qr`: pure, deterministic, zero workspace dependencies.

- `encode(text, { ecc })` → `QrMatrix { size, modules }`; `toSvg(matrix, opts)`; `toSvgPath(matrix)`.
- `labelSheet(count, preset, { startPosition, nudge })` → geometry in PDF points for `avery-22805`,
  `avery-22816`, `avery-5160`, `avery-5520`, `roll-single`. The api draws it with `pdfDraw`; the web
  previews the same numbers in SVG.
- Dependency: `uqr` 0.1.3, pinned (MIT, zero runtime deps, ESM + types, 79 KB).
- No decoding.

**Gate work in this PR:** add `packages/qr` to the inline boundary array in
`scripts/check-feature-boundaries.mjs:283-287`; restructure the determinism scan (`:298-313`) into a
loop over `[hazmat-engine, qr]`, rewrite its comment, and extend the self-test so a planted
`Math.random()` in `packages/qr` fires. Chains onto `lint:boundaries`.

**Done when:** `encode` reproduces committed golden matrices at each ECC level; `labelSheet` geometry is
pinned per preset and for `startPosition`; the determinism gate fires on `packages/qr`;
`lint:boundaries` proves the package imports no workspace.

### I2 — Schema and service: locations, parts, stock, the movement ledger — *next-numbered migration*

Schema and service in one PR. The RPC ships with its caller; the feature is unreachable.

**Tables** (`module=maintenance`, `layer=core`):

- `stock_locations` — id, org_id, name, code (unique per org), address, active.
- `parts` — id, org_id, part_number (unique per org), description, manufacturer, category, unit of
  measure, upc (indexed, nullable), image_path, last_cost, active, notes.
- `part_stock` — pk (org_id, part_id, location_id); quantity_on_hand `check (>= 0)`, reorder_point,
  reorder_quantity, aisle, row, bin, tag_code (unique per org, nullable until a label is issued), active.
- `part_movements` — append-only; `id uuid primary key` (client-generated), org_id, part_id, location_id,
  reason, adjust_reason (nullable), quantity_delta, counted_total (nullable), count_session_id (nullable;
  its FK arrives in I5), unit_cost, vehicle_id / trailer_id (nullable), work_order_ref, note,
  actor_user_id, occurred_at (client clock), received_at (server `now()`), blind (nullable bool).

**Bucket:** `insert into storage.buckets ('inventory-photos', private, 10 MiB) on conflict do nothing`
(0146's pattern). No `storage.objects` policy.

**RPC** `record_part_movement(p_org uuid, p_actor uuid, p_row jsonb) returns part_movements`,
`security definer set search_path = ''`, `service_role` only:

1. `insert … on conflict (id) do nothing returning *`; if nothing returned, select and return the
   existing row without touching the projection;
2. else `update part_stock set quantity_on_hand = quantity_on_hand + delta where … and
   quantity_on_hand + delta >= 0`; on `row_count = 0`, `raise 'insufficient_stock' using errcode 'IV010'`;
3. on a `counted` row, delta = `counted_total − quantity_on_hand` computed inside the RPC;
4. `occurred_at` more than 24 h from `now()` → `IV014`.

Plus `rebuild_part_stock(p_org)` and `guard_part_movements_append_only()` (`IV011`, fires for the
service role).

**SQLSTATEs:** `IV010 insufficient_stock`, `IV011 part_movements_append_only`, `IV012 unknown_location`,
`IV013 part_inactive`, `IV014 occurred_at_out_of_range`.

**RLS, verbatim:** write `('admin','fleet_manager','technician')`; read
`('admin','fleet_manager','auditor','accountant','technician')`.

**FKs:** `vehicle_id`, `trailer_id`, `location_id` all `ON DELETE RESTRICT`. No `audit_row_change`
trigger (a ledger is its own audit). Not in `RETENTION_FORBIDDEN`, no prune rule — stated in the header.

**Service** `apps/api/src/modules/maintenance/inventory/`: `listParts`, `getPart`, `listStock`,
`listMovements` (server-paginated; PostgREST caps responses at 1,000 rows), `recordMovement`; every query
org-filtered; errors mapped through `serviceError`.

**Done when:** `supabase/tests/inventory-stock.test.mjs` proves, with a discriminating fixture: projection
= ledger sum after a mixed sequence; the same `p_row` twice → one row, projection moved once; two issues
against one remaining → the second raises `IV010`; a count records variance; `rebuild_part_stock` is a
no-op; UPDATE and DELETE on `part_movements` raise `IV011` as the service role; cross-tenant isolation
holds; all four tables in `rls.test.mjs`'s `covered` list (`handSeed` for `part_stock`). One assertion
mutated.

### I3 — API: parts routes — *no migration*

`/api/maintenance/inventory/…`: locations CRUD, parts CRUD, stock reads, the movement verbs (`receive`,
`issue`, `adjust`, `transfer`, `return`), the low-stock query. Writes `rolesThatManage("maintenance")`,
reads `rolesThatCanView("maintenance")`. Creating or deactivating a part or location writes an
`audit_logs` row with the row UUID as `entityId`. Photo route: multipart upload into
`inventory-photos/<org>/<part>/…`; signed URL on read.

Every ledger read paginates server-side. Every query is asserted org-scoped by `supabaseRecorder`'s
`expectOrgScoped`, with function fixtures. `IV0xx` map to 409/422 with the code in the body.

**Done when:** route tests pass; `expectOrgScoped` covers every query; a scripted `IV010` answers 409;
`lint:table-writers` accepts the pairs; one assertion mutated.

### I4 — Web: the shop home and Parts — *no migration*

The nav group stays at six: **Shop** (home, at `/shop`), Parts, Assets, Units, Annual inspections,
Inspectors. Scan is a button on the home and every inventory page; settings is a gear on Parts; repair
spend is one `StatCard` on the home with its existing message.

- `/shop` — `MaintenanceHomePage.vue`: `StatCard`s for low stock, kit shortfalls (hidden until I9),
  today's movements; a Scan `AppButton size="lg"`; the repair-spend card. First-run empty state with three
  tiles: "Add a part · Import CSV · Print first labels".
- `/shop/inventory`, `/shop/inventory/:id` — `PageHeader` → `DataWorkspace` (embedded `FilterBar` +
  `DataTable` + `TablePagination` in `#footer`), the shape of `AnnualInspectionsPage.vue:157-222`. Detail:
  stock by location, the ledger as a paginated `DataTable`, the photo.
- Surface rows in `packages/shared/src/surfaces.ts`; the existing key `maintenance.repair-spend` is kept
  and relabelled "Shop" (org overrides are stored against the key); icons in `navIcons.ts`; routes in a
  new `router/routes/maintenance.ts` with the three existing shop routes moved from `finance.ts:32-54`;
  both route-table snapshots regenerated.
- `stockLevelBadge()` in `@/lib/badges`, labels from shared.

**Done when:** `lint:surfaces`, `lint:tokens`, `lint:ui-adoption`, `lint:filesize` green; the six-row
group and the empty state render under `preview:local`.

### I5 — Receive, issue, adjust, transfer; the count session — *next-numbered migration, two PRs*

**PR 1:** `stock_count_sessions` — id, org_id, kind (`location` | `unit`), location_id / vehicle_id /
trailer_id (exactly one set), started_by, blind, status, opened_at, closed_at, note; the FK from
`part_movements.count_session_id`; the session read service. The header cites 0092:137 and 0153:1-7: a
session is about one place, not a parallel registry.

**PR 2 — desk drawers** (`*Drawer.vue`, `ComboSelect` for the unit):

- **Receive** — quantity, unit cost, supplier (free text), location, optional photo.
- **Issue** — vehicle or trailer, reason, note, `work_order_ref`.
- **Adjust** — signed delta, adjust reason (mandatory, closed list), note.
- **Transfer** — from, to, quantity.

**PR 2 — the count on the phone**, `/shop/count/:sessionId` under `layout: "shop"`:

- Start: pick a location or arrive from the scanner; `blind` by default; any `manage` role may reveal,
  recorded on the row; wake lock requested in the tap handler, re-requested on `visibilitychange`.
- Sticky header: "12 of 40 · 3 short" — counts, not percent.
- Per bin: scan the `BIN` tag or pick → `QuantityStepper` (56 dp −/+, 12 dp gap, a 48 dp "0" chip; the
  numeral opens `inputmode="numeric"` with the value selected; never `type=number`) → one `counted`
  movement committed at once → undo toast "Counted 12 · Undo" (one action, ~6 s) → next.
- D-INV21 tiers: a `window.confirm` whose text carries the consequence ("Record 0 of 12 / Keep
  counting"); above 10 % the row is badged "recount by someone else".
- Close: review sorted by variance; Short / Over / Match / Uncounted as badges (`danger` "−3", `warning`
  "+2", `success`, `neutral`); uncounted bins are a choice, zero or skip; Close is irreversible and says so.
- Connectivity strip: "Saving on this phone — will sync when connected", with the queued count; IndexedDB
  queue + client UUID behind it.

**Done when:** each desk verb writes one ledger row and the projection follows; the count path records
variance (mutated); a receive and an issue complete with the keyboard alone; a 20-bin count completes on
a phone with one thumb, blind, with the right buckets at review — named person, §8.

### I6 — The scanner and the tag fabric — *no migration*

**Spike first.** `getUserMedia` + the D-INV23 decoder on one iPhone in Safari, the same iPhone installed
to the home screen, and one Android Chrome; decode a printed `SIL1:BIN:…` at ECC-H on a 1" label and a
supplier UPC. Record per device: permission prompts across a route change, torch capability, behaviour
after backgrounding, decode time. Results in §8 before the next task. The camera helper is
`@/composables/useCameraStream.ts`.

**Fabric** `apps/api/src/tags/{registry.ts,resolvers.ts,routes.ts}`: `registerTagResolver(kind, resolver)`;
`resolvers.ts` imports maintenance's `BIN` resolver (and `AST` from I7); `GET /api/tags/resolve?code=`
→ `parseTag` → resolver → `ScanResult`; non-tag strings → `parts.upc`; unregistered kind →
`unknown_tag`; malformed → `malformed`.

**Screen** `/shop/scan` under `layout: "shop"`, one route for the whole loop:

- A 64 dp trigger in the bottom bar centre; tap = single, hold = continuous; centre-weighted aimer,
  decode only inside it; centre-most code wins, tap picks another.
- On decode: tone + aimer flash; the code shown 150 ms before the sheet opens; 800 ms same-symbol
  debounce.
- **Verb sheet** — a `SlideOver` from the bottom edge, ≤ 4 verbs at 56 dp, item card on top, first verb =
  last used. Stock line: on-hand here, then **Issue**, Receive, Count, Adjust. Asset: where and since when,
  then **Move**, Report. Part by UPC: its stock lines, or "Attach this UPC to a part / Create a part with
  it" with the code kept. Unknown: "Not recognised — create a part / an asset". A blocked action is a named
  banner with its one-tap answer.
- Torch button only when `getCapabilities().torch`; crop-zoom; stop and re-acquire on `visibilitychange`;
  "tilt 10–15° for shiny labels" in the empty state.
- Two fallbacks always rendered: still photo (`<input type="file" capture="environment">` → the same
  decoder) and a text field for the six Crockford characters.

**Done when:** the resolve route returns the union for a stock line, a UPC, an unknown kind and a
malformed code, and a test registers a fake kind; the scanner decodes a printed sheet on both phones and
the installed-app prompt count is recorded; a technician scans a bin and issues two of it to unit 654
without leaving the camera — named person, §8.

### I7 — Schema and service: asset types, assets, movements, kit expectations — *next-numbered migration*

Tables and service in one PR.

- `asset_types` — id, org_id, name, category, serialized, default_kit_quantity, image_path.
- `inventory_assets` — id, org_id, `tag_code` (unique per org), `display_no` (unique per org, sequence),
  asset_type_id, name, serial_number, model, manufacturer, status, condition, purchased_at,
  purchase_cost, warranty_expires_at, image_path, notes; holder FKs `location_id` / `vehicle_id` /
  `trailer_id` with `check (num_nonnulls(location_id, vehicle_id, trailer_id) <= 1)`. The header cites
  0092:137 and 0153:1-7: an asset moves between units, which is the feature, and is not a property of one.
- `asset_movements` — append-only; `id` client UUID, org_id, asset_id, from/to holder columns, reason,
  condition, note, actor_user_id (nullable), actor_driver_id (text, not an FK), count_session_id,
  occurred_at, received_at.
- `kit_expectations` — org-wide default per asset type per unit kind (`tractor` | `trailer` |
  `reefer_trailer`), plus per-unit override rows. Held-vs-expected is derived.

**RPC** `move_asset(p_org, p_actor, p_row jsonb)`: idempotent by id; writes the movement and the holder
columns in one transaction; `in_repair` and `reported_*` leave the holder; `IV020 asset_already_held`
when the target already holds a serialized asset of a type whose expectation is one.
`rebuild_asset_holders(p_org)`. `guard_asset_movements_append_only()` (`IV021`).

**SQLSTATEs:** `IV020 asset_already_held`, `IV021 asset_movements_append_only`, `IV022 duplicate_tag`,
`IV023 asset_retired`.

RLS as I2. All holder FKs RESTRICT. Register `AST` in `tags/resolvers.ts`. No `drivers` FK; stated in the
header.

**Done when:** `supabase/tests/inventory-assets.test.mjs` proves: the CHECK rejects two holders; an asset
cannot be in two units; holder columns equal the last movement and `rebuild_asset_holders` is a no-op;
`in_repair` keeps the holder; a retry is one row; `IV020` fires; all four tables in `covered`
(`handSeed` for `inventory_assets`). One assertion mutated.

### I8 — API and web: Assets — *no migration*

`/shop/assets`, `/shop/assets/:id`. Detail: holder, since when, the current driver by inference, the
photo, the history as a timeline (sticky day headers, an icon per reason, headline + delta + actor) by
promoting `CaseTimeline.vue` to `@/components/`; the same history as a `DataTable` on desktop.
`assetStatusBadge()` in `@/lib/badges`. Drawers: New asset (assigns `tag_code` and `display_no`), Move,
Report.

**Done when:** `lint:ui-adoption` accepts the promoted timeline; the detail renders a 30-movement history;
a Move from the drawer and from the scanner produce identical rows.

### I9 — Units and the unit check — *no migration*

**First:** `listEquipmentIdentities(admin, orgId, kind, { activeOnly })` in
`apps/api/src/modules/roster/equipmentInspection.ts`, exported from `roster/index.ts`, selecting
`is_reefer`/`trailer_type` and paginating.

- `/shop/units` — every active tractor and trailer with `deriveKitStatus`; shortfalls feed the home.
- `/shop/units/:kind/:id` — expected against held; assign and remove; the driver's name by inference.
- **Unit check on the phone** — the I5 session with `kind: "unit"`: walk the truck, scan each item;
  Found / Not yet / Unexpected; an item recorded elsewhere offers "it's here now" (one-tap `move_asset`);
  close → Short / Missing rows.
- Kit expectations: org-wide default per type per unit kind; per-unit override; a settings drawer on Units.
- Vehicle and trailer detail pages get a read-only kit card (D-AVI17), gated `maintenance: view`,
  reading `GET /api/maintenance/inventory/units/:kind/:id`, with no edit affordance.

**Done when:** kit status comes from the one shared function on api and web; a fleet default and a
per-unit override both take effect; a reefer gets the reefer kit; an eight-item trailer check completes
on a phone with one thumb — named person, §8.

### I10 — Tags and labels — *no migration*

- Issuance: `tag_code` from Crockford base32, `formatTag("AST"|"BIN", code)`; `display_no` from the sequence.
- Sheet: `labelSheet()` placements with a start position; `encode` + `toSvgPath` at ECC-H; drawn with
  `lib/pdfDraw.ts`; each label carries the symbol, `display_no`, and the part number or asset name.
- Web preview from the same numbers, with an X/Y nudge and the instruction "Scale 100 % / Actual size,
  media = Labels"; diagnostic copy: uniform shift → nudge, progressive drift → scaling.
- The label screen states which stock survives where (§2.4).

**Done when:** a printed 22805 sheet scans back through I6 on both phones; a sheet started at position 7
prints at position 7; the preview and the PDF are pixel-compared for one preset.

### I11 — Settings — *next-numbered migration*

`inventory_settings` on `idle_settings`' shape (`primary key (org_id)`, every tunable `not null` with a
default, `forbid_org_change` trigger): default location, low-stock recipients (member ids), cycle-count
cadence days. No costing, negative-stock or tag-format settings. Rendered with `SettingsSection` in a
drawer behind the gear on Parts.

### I12 — Low stock — *no migration*

Read-time: the home `StatCard` and the Parts filter (I4). An email, if asked for, is a per-recipient daily
digest on `dqAlertScheduler`'s shape, started from `schedulers.ts`, after `docs/WORKER-DEPLOYMENT.md`.

### I13 — Driver app: the truck's kit — *next-numbered migration*

Migration: add `inventory.truck` to the `feature_key` CHECK on `driver_app_features` and
`driver_app_feature_overrides` (`0134:38-41`, `:56-59`).

The kit lives on Home's "Your rig" card: expected items for the driver's unit(s) with status. Tapping
opens `ListRow`s; each opens a `ChoiceSheet` — Present / Missing / Damaged; one "Confirm kit" `ActionBar`
with `haptic`. Missing or Damaged writes an `asset_movements` row (`reported_missing` /
`reported_damaged`, `actor_driver_id`, holder unchanged) through a driver-scoped route and surfaces as a
kit shortfall on `/shop/units`. `OfflineBanner` and `SyncStatus` cover the queue.

**Blocked on** the driver release lanes. Sequenced last.

### I14 — FleetPal reconciliation — *deferred*

Arrives through the D-SEP8 gate with its own contract. The only open item is whether FleetPal has an
export path (Q1).

---

## 6. Questions and assumptions

### 6.1 Questions — answered 2026-09-08

| # | Question | Answer | Decision |
|---|---|---|---|
| Q1 | Which system is authoritative for parts once FleetPal lands? | Authority splits by fact; the money half was closed by the 2026-09-03 fleet ruling. | D-INV10 |
| Q2 | Does parts cost reach the fleet report? | No. GL `30230000` already carries it. | D-INV11 |
| Q3 | Does the vehicle page get a read-only inventory card? | Yes (D-AVI17). | I9 |
| Q4 | Custom fields? | No. | D-INV13 |
| Q5 | Vendors and POs? | No. | D-INV14 |
| Q6 | Do trailers get kits? | Yes, from I7. | D-INV12 |
| Q7 | Who answers for a missing tablet? | Nobody signs. If a dispute occurs, an `esign_consents`-shaped acknowledgement on the existing movement row. | D-INV3 |
| Q8 | Moving average or last cost? | Last cost. | D-INV15 |

Open, not blocking: whether FleetPal has an export path. Either way the schema is the same.

### 6.2 Assumptions — retired by the step that needs them

A step may not close while its row stands.

| # | Assumption | Retired by | Default answer |
|---|---|---|---|
| **A1** | The free decoder reads a printed ECC-H `SIL1:` label and a greasy supplier UPC on the shop's phones — Safari, installed, Android. | I6 spike, results in §8 | Scandit's web engine; then D-INV28's revisit clause. |
| **A2** | The shop has been measured: locations, parts, technicians, phones, wifi in the bays. | ~~Before I2~~ → I4 (the parts list) and I6 (the phones and the bay wifi). **Re-scoped 2026-09-09, see §8** — I1's merged contracts pin every I2 column, so a shop visit can no longer change that migration. The shelving half is ANSWERED: there are no shelf numbers (§1.4). | — |
| **A3** | An initial parts list exists to import (a spreadsheet or a FleetPal export). | Before I4 — the file and its columns | The locked-header CSV template with an error report, and one afternoon. |
| **A4** | Kit contents per unit kind — quantities per tractor, dry van, reefer. | I9 — owner supplies three default lists | Ship empty; the first unit check populates them. |
| **A5** | The label printer and stock the shop owns. | I10 | Avery 22805 on a laser with polyester stock for bins; aluminium plates from a vendor for truck items. |
| **A6** | FleetPal has an export path for work orders. | Q1 | `work_order_ref` typed by hand. |
| **A7** | `uqr` is deterministic and correct at every ECC level. | I1b golden fixtures | — |

---

## 7. Out of scope

- Purchase orders, vendor management, approvals, work orders (D-INV5/14).
- Preventive-maintenance scheduling (`vehicles.next_pm_due_*` are dead columns; a separate plan).
- Tyre tracking, core returns, warranty claims, RFID.
- Barcode scanning in the driver app (D-INV2); decoding inside `@silvicom/qr` (D-INV16); symbologies
  other than QR from our encoder.
- A shared org-wide `terminals` concept (D-INV1); signatures on custody (D-INV3, Q7).
- A paid scanning SDK (D-INV23) unless the I6 spike fails; an in-app label designer (D-INV25).
- Thumbnails for `inventory-photos` — lists show no photo; the detail shows one signed URL; a derive job
  is a later step.

---

## 8. What shipped

*(Dated lines appended as steps land — never edits to step text. Each phone flow's usability sentence is
signed here by the person who did it. I6's spike results go here before its second task.)*

- **I0 — governance — DONE 2026-09-08 (PR #684).** Both canon documents now name the feature:
  `SILVICOM-360.md` §3 carries **D-S360-7**, and `ARCHITECTURE.md` §3's maintenance row states the
  four tables the module owns today and the ten that arrive at I2–I11. Three corrections were made
  that the step text did not anticipate, each because the thing it described had stopped being true:
  (a) the maintenance row hedged `maintenance_print_profiles` as "only if the office keeps printing
  onto pre-printed stock — plan step A8 is optional", but A8 was ruled against and then reversed and
  0283 shipped, so the module owns four tables and not three-and-a-maybe; (b) a **third** location
  carried the superseded FleetPal financial contract beyond the two §2.7 named — the maintenance
  routes header, which described repair dollars arriving "from exactly two doors, both dedup-keyed
  (D-SEP8)"; this step's done-when is that no document instructs a FleetPal financial projection, and
  it would not have been met with that comment standing, so it now describes one door and states that
  inventory does not open a third; (c) `ARCHITECTURE.md` §6 recorded `lint:filesize` as
  "live (gap: no `.vue`/`.tsx`/shared coverage)" — re-measured, `check-file-size.mjs:57` scans
  `["apps","packages"]` and `:122` covers `.ts`/`.tsx`/`.vue`, so the gap had closed without the row
  being updated. That correction has a consequence for I4 rather than being tidying: the inventory
  forms are extracted from the first commit because `.vue` really is inside the 500/450 budget.
  The count in this plan's I0 step text — "the nine inventory tables" — is the count through I7; the
  tenth is I11's `inventory_settings`, and the architecture row states both rather than leaving the
  discrepancy to be discovered. `SEPARATION-PROGRAM-PLAN.md` and `ANNUAL-INSPECTION-PLAN.md` still
  cite the dedup contract and were deliberately left alone: they are decision logs of what was true
  on 2026-08-27, and this repo appends to plans rather than rewriting them.
  **Verification:** all 38 `lint:*` scripts in root `package.json` pass (the full list, not only the
  28 CI runs by name) and `pnpm typecheck` passes. **No assertion was mutated at this step and none
  was owed** — I0 ships no test and its done-when is documentary; protocol §4.8 resumes at I1 against
  `deriveKitStatus`. Assumptions A1–A7 all still stand; none of them gates I0.

- **I1 — the contracts — DONE 2026-09-08 (PR #685, merged 528fca5).** `tagContract.ts` owns the
  `SIL1:<kind>:<id>` grammar; `inventoryContract.ts`, `inventoryAssetContract.ts` and
  `inventoryScanContract.ts` own the vocabularies, the DTOs and the movement payloads;
  `inventoryRules.ts` owns `isLowStock`, `deriveKitStatus`, `countVarianceTier` and `nextDisplayNo`.
  **Mutation proof:** flipping `deriveKitStatus` so extra beats short failed exactly one test, "calls
  a trailer short when it is both short and carrying a spare" (`expected 'extra' to be 'short'`),
  24 others green.
  **A contradiction inside D-INV21 had to be settled to write `countVarianceTier`.** Its two
  thresholds — a confirm above max(5, 5 %) and a recount above 10 % — were written independently and
  cross each other on small numbers: twelve expected against ten counted is 16.7 %, over the recount
  line, but a variance of 2, which the floor of 5 has already forgiven. Applied literally a
  technician would be told a second person must recount a bin nobody asked them to confirm. Settled
  by making `recount` the higher rung of ONE ladder rather than a parallel test, and by stopping the
  zero-against-non-zero rule at `confirm`. No constant was invented. **The consequence is pinned by
  its own test and the count screen (I5) must expect it: below about fifty expected there is no
  numeric `confirm` rung at all**, because both rungs share the floor of 5 and confirm's 5 % is lower
  than recount's 10 %; on smaller bins the only route to `confirm` is the zero rule.
  Three deviations. (a) The step names one file; four exist, because `lint:filesize`'s 500-line
  budget is a hard gate — the seam is §2.1's own, stock against identity, so the files map to I2/I5,
  I7 and I6. (b) Unit of measure is a closed vocabulary where the step's table implies free text:
  D-INV13 forbids custom FIELDS, not vocabularies inside the fields that exist, and `ea`/`EA`/`each`
  from four people makes "12" on a stock line unsayable. (c) One assertion was rewritten after being
  measured — zod STRIPS unknown keys rather than rejecting them, so a test that looked like it
  proved a stray `quantityOnHand` is refused was really only proving `countedTotal` is required. It
  now proves what holds: the key is dropped at the edge and cannot reach the RPC.
  **Verification:** 194 shared test files / 2757 tests, 38 lint gates, `pnpm typecheck`, and the RN
  build of `@silvicom/shared` all pass.

- **I1b — `@silvicom/qr` — DONE 2026-09-08 (PR #686, merged 4b316b9).** `encode`, `toSvg`,
  `toSvgPath`, `labelSheet` and the five presets, on `uqr@0.1.3` pinned. 48 tests.
  **Mutation proof:** transposing the placement derivation to fill down-then-across failed exactly
  two tests, both about where a label physically lands, 17 green.
  **The gate work found a live defect.** The step said to extend the boundaries self-test; there was
  no self-test on `check-feature-boundaries.mjs` to extend, so one was written — and its first run
  failed on its own sample, because the node-builtin determinism rule was
  `(?:node:|fs|os|…)` anchored to a closing quote. It matched a bare `from "fs"` and **never matched
  `from "node:fs"`** — the spelling this repo uses at the top of the file the rule lives in. The
  purity guarantee on `@hazmat/engine` had been blind to the likeliest way of breaking it since the
  rule was written. Fixed; every rule now carries a sample it must catch; `lint:boundaries` chains
  `--self-test` as `check-table-access` and `check-shared-contracts` already did.
  **Two measured numbers correct the plan.** Both real payloads encode to **version 2 (25 × 25) at
  ECC-H**, not the version 4 §2.4 budgeted — about 0.77 mm per module on a 1-inch label against a
  0.4 mm floor, so the grammar has room for a longer kind. And research §4.7's "~0.69 mm at 1 inch"
  is a version-3 symbol measured WITH its quiet zone; `moduleSizeMm` reproduces that convention so
  the figures are comparable.
  **The presets were verified against published vendor geometry, not recalled**, and each one's
  arithmetic is asserted: margin + used width = sheet, with opposite margins equal. That check
  resolves a real ambiguity — several vendor tables report "across" and "down" transposed, and only
  one orientation both fits and centres. **22805 is 24 to a sheet in 4 × 6**, not the 12 its label
  size suggests. `roll-single` is our own definition rather than a vendor template and is the one
  preset **A5** can invalidate.
  **A correction to this session's own first draft:** a comment claimed the two-branch slot
  calculation exists because "a naive modulo gets it wrong". Mutating it into that modulo failed no
  test — the two are algebraically identical, since the first sheet's capacity is
  `perSheet − (start − 1)` and the modulo cancels it exactly. The comment now says why the branches
  are kept rather than warning about a bug that is not there.
  **A7 is only PARTLY retired.** The golden fixtures pin determinism at every ECC level, and
  structural facts are asserted independently against the QR specification (size = 17 + 4 × version,
  the 7 × 7 finder in three corners and not the fourth, alternating timing patterns, a different
  matrix for a one-character change). None of that establishes that a real scanner reads a real
  printed label, which is I10's done-when. **A7's row stands until then**, and no step that depends
  on a physically scannable label may close against this evidence alone.

- **Owed and paid late:** the §8 lines for I1 and I1b were written after both had merged rather than
  in their own PRs, which is a deviation from protocol §10's intent even though the lines are
  accurate. I0's line shipped inside its PR and that is the shape the remaining steps follow.

- **I9's prerequisite — `listEquipmentIdentities` — DONE 2026-09-08 (PR #688, merged 3493c3f),
  TAKEN OUT OF ORDER.** I2 is blocked on A2 and everything downstream of it inherits that block —
  I3 reads I2's tables, I5's `count_session_id` is an FK into `part_movements`, I6's resolver
  returns a `stock_line`, and I7's `inventory_assets.location_id` references `stock_locations`. This
  was the only piece of the plan that A2 does not gate, being roster's own work, so the owner agreed
  to take it early. **The rest of I9 is NOT done** and its row in §5 stands.
  **Three things the file asserted were wrong, and I9 would have inherited all three.** (a) The
  `EquipmentIdentity` comment said `isReefer` is null "for a trailer whose type nobody has
  recorded"; `trailers.is_reefer` is `not null default false`, so an unrecorded trailer reads
  `false` and null means tractor and nothing else. (b) `getEquipmentIdentities` hardcoded
  `isReefer: null` while the single-row reader derived it — two readers returning one type with two
  meanings for a field. Harmless so far, because `inspectionList` is its only caller and reads unit
  numbers, but **D-INV12's reefer kits would have been told all 46 reefers are dry vans**. Both now
  route through one `toIdentity`. (c) The measurement below.
  **MEASURED IN PRODUCTION 2026-09-08, AND IT DECIDES HOW I9 DERIVES `unitKind`.** Of 234 active
  trailers: 46 carry `is_reefer` with `trailer_type = 'reefer'`, 13 are `false` with `'dry_van'`,
  and **175 are `false` with no `trailer_type` at all**. The two columns never contradict each
  other. So **`reefer_trailer` must be derived from `is_reefer`, never from `trailer_type`** —
  deriving it the other way silently classifies three quarters of the active fleet as unknown.
  `trailer_type` is carried as the finer fact where it exists and typed as a string, because the
  `trailers_trailer_type_check` CHECK is its authority and a hand-copied TypeScript union is a
  second source of truth with a delay fuse. Tractor and trailer counts (207 / 234) match §1.4, so
  the fleet has not moved since the plan was written.
  **The derivation itself is deliberately NOT in roster.** The function returns equipment facts;
  inventory decides what kit a kind gets. Putting `UNIT_KINDS` behind a roster call would make
  roster depend on an inventory vocabulary.
  **Mutation proofs, three, each restored:** re-introducing the hardcoded `isReefer: null` failed 2
  tests; replacing the paging loop with a single `.range(0, 999)` failed 2, including the 1001-row
  read driven through the recorder's page queue; flipping the `activeOnly` default failed 1.
  **Verification:** 13 new tests, every query asserted org-scoped, 38 lint gates, `pnpm typecheck`,
  and CI green on all eight jobs.
  ⚠ **Noted in passing, not fixed:** two full local API runs each failed exactly one unrelated test
  with `SocketError: other side closed` — `savedViews` on one run, `publicInvites` on the next, both
  in `modules/org/routes`, each passing in isolation, and `test-api` green in CI. A failure that
  moves between files is the documented transport flake rather than a regression, but it hit 2 of 2
  local runs against the ~1-in-4 previously recorded, always exactly one per run. That shape
  suggests a teardown race or port exhaustion rather than randomness, and it deserves its own look.

- **I2 — schema and service: locations, parts, stock, the movement ledger — DONE 2026-09-09
  (PR #691).** Migration 0331 ships `stock_locations`, `parts`, `part_stock` and
  `part_movements`, the `inventory-photos` bucket, `record_part_movement`, `rebuild_part_stock` and
  the append-only guard; `apps/api/src/modules/maintenance/inventory/` ships `listParts`, `getPart`,
  `findPartsByUpc`, `listLocations`, `listStock`, `listMovements` and `recordMovement`. 42 matrix
  assertions and 11 service assertions.

  **A2 DID NOT GATE THIS STEP, and the reason is a measurement rather than an argument.** §6.2 said a
  shop visit came before I2, on the risk that real shelving would change the tables. That risk was
  already spent: I1 merged as #685 and its contracts pin every column this migration creates —
  `stockLocationDtoSchema` and `partDtoSchema` match field for field, and `stockLineDtoSchema` extends
  `binAddressSchema`, whose own comment settles the shelving question. A visit could still overturn
  those shapes; it would then be overturning a merged contract, which is a different PR from this one.
  A2's row is re-scoped to I4 and I6 rather than retired — the parts list, the phones and the bay wifi
  are still unmeasured and still gate those steps.

  **The shelving half of A2 IS answered, by the owner on 2026-09-09: this shop has no shelf numbers.**
  Recorded in §1.4. `aisle`, `row` and `bin` are three nullable fragments that nothing requires — no
  NOT NULL, no default, no sort, no filter — and `listStock` never asks for them. What addresses a
  shelf here is `tag_code` and D-INV7's resolver, which inverts the usual order deliberately: nobody
  reads an address off a shelf and types it, they point a camera at it and the row arrives. The
  columns stay for a shop that someday numbers its shelves, because three fragments sort by aisle
  where one string does not (`binAddressSchema`'s reasoning, unchanged).

  **§2.12 rule 2 and step I2's numbered list contradict each other, and only one of them is safe.**
  Rule 2 says guarded UPDATE first, insert only when `row_count = 1`; the step says insert first. The
  step is right. The movement id is the client's idempotency key, so if the projection moved before
  the insert discovered the conflict, every offline replay would move the shelf again and the ledger
  would disagree with the shelf by exactly the number of times the network was bad. Nothing is lost
  by the reversal, because the function is one transaction: when the guarded UPDATE raises `IV010`
  the INSERT above it rolls back with it, and the matrix asserts precisely that — *"a refused
  movement writes no ledger row"*. The "guard" rule 2 was naming is the `>= 0` predicate ON the
  update, not its position.

  **Four deviations, each because the step text did not describe something the merged contract needs.**
  (a) `supplier` is a column: D-INV14 says "receiving takes a supplier name and a cost" and
  `receiveStockSchema` accepts one, but I2's column list omitted it — storing nothing would have
  silently dropped a field the contract accepts, which is the trap I1 already hit once with zod's
  key-stripping. (b) `parts.last_cost` is maintained by the RPC from a `received` row's unit cost;
  the step says the column exists and never says who writes it, and D-INV15 is meaningless if nothing
  does. (c) A transfer is TWO ledger rows written by one call, because the projection is per (part,
  location) and one row cannot move it in two places; the inbound leg's id is derived as
  `md5(id || ':in')` so a replayed transfer is as idempotent as any other movement, and a
  `transfer_group_id` column makes the pair recoverable. The alternative — two API calls — can
  half-fail, which destroys stock at the source and never delivers it. (d) Two SQLSTATEs beyond the
  step's five: `IV015` for a malformed payload, which a `jsonb` argument cannot be typed out of, and
  `IV016` for a concurrent duplicate mid-insert. **`IV016`'s branch is NOT exercised by the matrix** —
  PGlite runs on one connection, so the race cannot be staged there — and it is named here rather
  than left as an untested claim.

  **One assertion was rewritten after being measured, and the correction is the finding.** It asserted
  that a technician's browser UPDATE of `part_movements` raises `IV011`, on the reasoning that the
  append-only trigger fires for everybody. It does not fire, and the ledger is safe anyway: the table
  carries a SELECT policy and an INSERT policy and no UPDATE policy, so the UPDATE matches zero rows
  and returns success having done nothing. Two separate guarantees, and the test now names the one
  that is actually running — pinning `IV011` there would have pinned a mechanism that is not reached.
  A second assertion was fixed for a duller reason worth recording too: the service-role UPDATE and
  DELETE ran in one transaction, so the DELETE came back `25P02` — the UPDATE's exception still
  standing, not the trigger refusing the delete. An assertion that accepts the wrong code for the
  right reason keeps passing after the trigger is dropped.

  **`rls.test.mjs` needed `handSeed` for three of the four tables**, and not for a schema reason:
  `stock_locations.code` is the short code somebody says across a bay, capped at 24 characters, and
  the generic synthesiser's placeholder is longer than that. `part_stock` and `part_movements` build
  a location on the way to their own row and inherit the failure; `part_movements` could not have been
  seeded generically in any case, because its primary key has no default on purpose. Widening the
  column to suit the harness would have deleted the reason the cap exists. Coverage went from 131 to
  **134 tables, 0 unseedable, 0 leaking**.

  **Mutation proofs, four, each restored:** writing a count's absolute total instead of the delta
  taken at commit time failed 2 matrix assertions; removing the RPC's idempotency early-return failed
  1; dropping `listStock`'s `.eq("org_id")` failed the `expectOrgScoped` assertion; handing `numeric`
  through as the string PostgREST actually sends failed the cost conversion.
  **Verification:** 42 + 11 new assertions, `pnpm test` green across every unit suite and all 40
  matrices, all **38** `lint:*` gates (the full list, not only the 28 CI runs by name), and
  `pnpm typecheck`. The feature is unreachable — no routes are mounted until I3 — which is the
  condition under which an RPC may ship with its caller, and `lint:migration-ordering` cannot check
  it because it never reads `create function`.

- **I3 — API: parts routes — DONE 2026-09-09 (PR #692).** `/api/maintenance/inventory/…` is
  mounted: `parts` (list, by-upc, one, create, patch, photo), `locations` (list, create, patch),
  `stock`, `low-stock`, `movements`, and the six verbs `receive` / `issue` / `adjust` / `transfer` /
  `return` / `count`. Reads take `requireSection("maintenance", "view")`, writes take its manage
  roles. 20 route assertions. **The feature is now reachable** — I2's caveat is discharged.

  **The `IV0xx` split is 409 against 422, and the line between them is a sentence a technician can
  tell apart.** 409 means the payload is fine and the SHELF refuses it — one filter left not two
  (`IV010`), the ledger is not editable (`IV011`), an identical movement is already landing
  (`IV016`); there is nothing to fix in the form. 422 means the payload NAMES something unusable — a
  closed or foreign location (`IV012`), a retired part (`IV013`), a clock a day out (`IV014`), a body
  missing the quantity for its own reason (`IV015`). A 500 is kept for what it means everywhere else,
  and the tests pin that too: an unmapped `42P01` is still a 500 rather than being swept into the
  table.

  **Three deviations.**
  (a) **The photo route signs an upload URL rather than accepting multipart**, which the step text
  named. D-INV8's actual words are "uploads go through the API (service role); reads are signed
  URLs", and a signed upload URL IS the service role authorising the write — the client never holds a
  key and the bucket still has no `storage.objects` policy. It is also the route
  `modules/evidence/compliance.ts:117` already established, `apps/api` has no multipart middleware at
  all, and a signed URL can be retried by an offline client against Storage directly where a
  multipart POST cannot be retried without re-sending the bytes through the process that also runs
  the schedulers. **The org prefix is built from `req.auth.orgId` and never from the request**, which
  is load-bearing precisely because the bucket has no RLS to fall back on.
  (b) **Six verb routes, not one `POST /movements` with a reason.** `partMovementInputSchema` is a
  discriminated union so the shapes ARE the rules; one endpoint taking the union would let a screen
  built for receiving send `reason: "adjusted"`. Pinned: a receipt posted to `/adjust` is a 400 and
  reaches no RPC.
  (c) **Movements are NOT written to `audit_logs`**, and this is the opposite of the parts and
  locations routes beside them. `part_movements` IS the audit — append-only by trigger, carrying its
  actor, both clocks and the reason — so a second row per issue would double the busiest table in the
  module to record what the first says better. Creating or retiring a PART is audited, because the
  catalogue is not itself a ledger, and retirement gets its own action rather than an update with a
  flag buried in a `changed` list: it is the event somebody searches for when a part stops appearing
  in the issue picker.

  **A comment claimed a hazard that measurement says does not exist, and it is worth recording
  because the mutation is what caught it.** `/parts/by-upc/:upc` carried a note saying it had to be
  mounted above `/:id` or a barcode would fall into the id route. Moving it below `/:id` **failed no
  test** — `/by-upc/:upc` is two path segments and `/:id` is one, so Express can never confuse them
  whatever the order. Both the comment and the test's name now say what is actually being pinned:
  that a barcode is queried as a `upc` and never as an id, which is D-INV7's whole fall-through. A
  warning about a hazard that is not there is worse than no comment, because the next person routes
  around it.

  **Mutation proofs, three, each restored:** dropping `IV010` from the status map failed the 409
  assertion; making the transfer route call the RPC twice failed *"sends a transfer to the RPC as ONE
  call"* — the half-failure that would destroy stock at the source and never deliver it; and the
  route-order mutation above failed nothing, which is why the comment changed instead of the code.
  **Verification:** 20 route assertions, `pnpm test` green across every unit suite and all 40
  matrices, all 38 `lint:*` gates, `pnpm typecheck`. `lint:table-writers` accepts the two new pairs —
  `parts ← inventory/partsWrite.ts` and `stock_locations ← inventory/locationsWrite.ts` — which are
  the module's own tables, not a cross-module write.

- **REVIEW OF I0–I3 — 2026-09-09 (PR #PENDING4).** An audit of everything merged so far, against the
  code rather than against these progress lines. **Five defects and one stale document**, four of
  them in shipped code and one of them a gap in this PLAN. All fixed here.

  **1. `supplier` was WRITE-ONLY.** 0331 stored the column, `record_part_movement` wrote it,
  `MovementRow` read it — and `partMovementDtoSchema` did not carry it, so `toMovementDto` never
  returned it. A technician could record who the parts came from and nothing in the product could
  ever read it back. The irony is exact: I2's §8 line added that column specifically because "storing
  nothing would have silently dropped a field the contract accepts", and then dropped it one layer
  further out. **This is the same defect class I1 recorded about zod stripping unknown keys, and it
  survived because nothing tested the DTO at all** — `inventoryContract.test.ts` tested the INPUT
  shapes, which are the rules, and no DTO.

  **2. `transferGroupId` was not on the DTO either.** 0331 wrote it so "the pair is recoverable from
  the ledger"; recoverable by somebody writing SQL, not through the API. A transfer rendered in the
  movements list as two unexplained rows, one negative and one positive, with nothing tying them.

  **3. `actorName` was always null.** The field has been in the contract since I1 and
  `toMovementDto`'s parameter defaulted to `null` with no caller ever passing one. The ledger — the
  screen whose entire job is "who took the eleventh filter" — could only have shown a UUID or
  nothing. Now wired to `lib/memberLabels`, one directory call per page and never one per row, which
  is the shape that helper exists to enforce. `user_profiles` joins the `expectOrgScoped` exemption
  for the reason `modules/org/routes/members.test.ts:190` already documents.

  **4. `/low-stock` UNDER-REPORTED past the first page — the worst of the five.** It was a flag on
  `listStock`, which reads ONE page, so the filter ran over at most 200 rows and `total` counted only
  those. A shop with more stock lines than a page would have been told "nothing to order" and
  believed it. Now `listLowStock`, its own reader, paging to the end; the query narrows to lines that
  HAVE a reorder point — the rule's own null branch, not its threshold — and `isLowStock` still
  decides, in one place. The route takes no `limit`/`offset` at all, because this answer is complete
  or it is misleading. ⚠ **I2's §8 line defended the old behaviour** ("filtering the page is honest,
  until the shop has more stock lines than one page"), which rested on A3 — unmeasured then and
  unmeasured now. A correctness argument standing on an open assumption is not a correctness argument.

  **5. Nothing in the product could set a `reorder_point`, and that is a gap in THIS PLAN.**
  `stockLineSettingsSchema` shipped in I1 with zero consumers; no step assigns the write; and I12 is
  "Low stock", which READS the column. Followed literally the programme would have shipped a
  low-stock screen reading a column nothing could ever set — permanently empty, for a reason no
  screen could explain. Closed with `PATCH /stock/:partId/:locationId` and `inventory/stockSettings.ts`.
  The quantity is absent from both, deliberately: it is the ledger's projection and
  `record_part_movement` is its only writer. The row may not exist when a reorder point is first set,
  so it is a guarded UPDATE then an INSERT with every not-null column — the 0174/0175 pattern, never
  `.upsert()` with the patch.

  **6. `ARCHITECTURE.md`'s maintenance row was stale.** I0 wrote "Four tables today … ten more arrive
  with inventory"; four of the ten arrived at I2 and the row still said four. It now says eight, names
  which six remain, and states that `part_movements` is append-only with one writer.

  **Mutation proofs, three, each restored:** stopping `listLowStock` after one page failed *"pages to
  the end, so a low line on the second page is still found"*; dropping `supplier` on the way out
  failed the route assertion; removing `supplier` from the DTO schema failed the new contract
  assertion. That last one is the guard the review's first finding needed and did not have.

  **What the audit did NOT find, checked explicitly:** no `TODO`/`FIXME`/unlabelled workaround in any
  inventory file; contract fields and schema columns agree for `parts`, `part_stock` and
  `stock_locations`; all four tables covered by `rls.test.mjs` with 0 unseedable and 0 leaking; the
  routers are reached through `/api/maintenance`'s mount and each carries `router.use(requireAuth)`,
  so `routeAuth.test.ts` covers them; §6.1's eight questions all remain answered; §6.2's A1, A3–A7
  stand and are each assigned to the step that retires them.

  ⚠ **One pre-existing repo-wide characteristic, noted and NOT changed here.** `listParts`'
  search interpolates the term into a PostgREST `.or()` filter without escaping, so a comma or a
  parenthesis in the search box produces a malformed filter. It is the house pattern — `financial/
  reads.ts:69`, `efs/efsCardExport.ts:67` and `efs/routes/read.ts:192` all do exactly the same — so
  fixing it here would fix one of four and leave the other three looking correct by comparison. It
  belongs in its own change across all four call sites, and it is recorded here rather than in a
  comment nobody would find.
