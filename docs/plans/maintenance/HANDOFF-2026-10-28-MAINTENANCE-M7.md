# Handoff — Maintenance redesign, next steps M7 → M10 (2026-10-28)

Read first: `docs/plans/maintenance/MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md` **§7a** (the second
round: R1–R5, steps M6–M10, the owner's answers in §7a.9), `docs/DESIGN-SYSTEM-CONTRACT.md` **§9**
(phone and tablet, rules 1–9), and the memory file `maintenance-section-redesign-position.md`. Then
build **M7**, then M8, M9, M10, each as its own PR.

## Where we are (main 6be7cc0)

All merged to main and on staging. Production gets them at the next nightly release the owner approves:

| PR | Step | What |
|---|---|---|
| #1799 · #1800 · #1801/#1803 · #1806 | M1–M3, F12 | Glossary; worklist; FleetPal parts sync (migration 0525); the truck's page as the hub |
| #1812 | M4 | Contract §9 rules 1–8 + gate `scripts/check-phone-rules.mjs` (chained third in `lint:ui-adoption`). Touch floor is 48 px and a getter (`provideTouchTargets(when)`, set by `composables/usePhoneFirst.ts` in `AppShell`: shop page AND (coarse pointer OR < md)). `DataTableColumn.card` = `title`/`sentence`/`meta`/`none` (three-fact cards, drawn at any width under the floor). `components/WalkActions.vue` = verb bar from `md`. `layouts/SectionTabBar.vue` = the phone tab row, read from the sidebar's `buildNavGroups` via `lib/phoneFirst.ts`. |
| #1814 | plan | §7a — the owner's review after M4 |
| #1818 | M6 | **Shop page = five tabs** (`?tab=roadside\|defects\|work-orders\|annual\|bills`), panels in `features/maintenance/Shop*Panel.vue` + `features/roadside/RoadsideRepairsPanel.vue` (Open/Recorded is a `show=` filter). The old list routes are **redirects**: surface keys are unchanged, and each tab is gated by `useOpens(<old path>)`. **Truck page = Needs attention + five tabs** (`?tab=repairs\|due\|equipment\|inspections\|papers`, `UNIT_TABS` in `attentionWords.ts`). Contract §9 **rule 9 "one table per tab, every table paged"**, gated: an unpaged `DataTable` needs `ui-adoption: never-paged — <why>`; a page may not stack two tables, imported table components included, drawers excepted. |

Removed from the Shop page in M6, and waiting for their new homes:
- **Missing equipment** → M7
- **Running low** and **Count a shelf** → M8 (hidden, Q-MX8)

## The owner's answers (§7a.9 — "proceed as recommended")

- **Q-MX7 (a):** five sidebar rows — **Shop · Trucks & trailers · Equipment · Annual inspections · Shop parts**.
- **Q-MX8 (a):** shelf counting on Shop parts is hidden until the shop asks for it. The code stays.
- **Q-MX9 (a):** the truck page is tabs. Done in M6.
- **Q-MX10, measured:**
  - Shop parts are bought through FleetPal.
  - FleetPal also holds 33 purchase orders (≈ $13.5k) for truck equipment bought as stock: straps and chains (`fleetpal_purchase_orders.description`).
  - Tablets are NOT in FleetPal, and McLeod AP has no tablet purchase.
  - Vendor `ATTAUIL` bills ≈ $622 monthly with no GL account. It is probably the AT&T line service; this is **unconfirmed — ask accounting**.
  - So M10 records our own invoice for tablets and anything else bought outside FleetPal, and links the FleetPal PO for FleetPal-bought items. No McLeod matching until accounting answers.
- **Q-MX11 (a):** **every tablet has an AT&T SIM and an IMEI, with a barcode sticker on the back.**

## The steps (each its own PR)

### M7 — Equipment door (no migration)

`maintenance.assets` gets its sidebar row back: remove `parent: "maintenance.units"` in `packages/shared/src/surfaceCatalogue.ts`.
- **The key stays** (D-MX6).
- The order becomes Shop · Trucks & trailers · Equipment · Annual inspections · Shop parts.
- Watch the 500-line budget: `surfaceCatalogue.ts` is ~492 lines; trim comments, not code.
- The phone tab row follows by itself. Check that five tabs fit at 390 px (labels wrap; ≥ 48 px each).

`/shop/assets` becomes one page with two tabs:
- **On trucks** — one row per truck or trailer:
  - shows: number · what it carries in one sentence (a tablet with its driver — tablets follow the driver, D-DE rulings) · missing count · last checked;
  - filters: missing something / never checked / kind;
  - a row opens `/shop/units/:kind/:id?tab=equipment`;
  - the data comes from `useUnitsQuery` (`UnitKitDto` has `lines`, `shortBy`, `lastCheckedAt`, `inferredDriverName`) — check whether the line list is enough for the sentence before adding an endpoint.
- **Inventory** — today's assets list, moved in as is. **Add equipment** is the verb bar (`WalkActions`).

Also:
- Missing equipment lives here now. Re-point every link that used `/shop/units?show=short` and check what still uses `show=short` on Trucks & trailers.
- Update the plan's §7a log at the END of §8.

### M8 — Shop parts words (no migration)

- Sidebar label and page title become **Shop parts**.
- New header: *"The shop's parts catalogue, pulled from FleetPal every hour. Add and change parts in FleetPal."*
- Rows show *From FleetPal*.
- No New part, and no Edit for FleetPal-owned fields.
- Shelf counting, Running low and Count a shelf are hidden (Q-MX8). Keep the code; say it is hidden, and why, in a comment.
- Words come from the glossary (§4.4). Surface keys never change.

### M9 — Tablet IMEI

**M9a** — migration `inventory_assets.imei`:
- 15 digits, unique per org on non-blank values (same shape as 0522's serial index);
- the column alone — the reader ships in a later merge (`lint:migration-ordering`).

**M9b** — the IMEI field and its readers:
- **Add/Edit equipment** drawer gains an IMEI field for tablets (the asset type says it carries one).
- The **Tera Pro is HID**, so the person focuses the field and scans the sticker's Code 128. The field validates 15 digits plus the Luhn check digit and refuses a bad read (*"That is not an IMEI — scan the barcode marked IMEI"*).
- Serial is scanned the same way.
- `/shop/scan`: 15 Luhn-valid digits are an IMEI → find the tablet, or offer *"Add this tablet"*. Today it is treated as a misread (R3 in the driver-equipment plan).
- IMEI is shown on the item, searchable, and printed on its label.
- Put a pure `isImei()` in `packages/shared` with tests.

**M9c** — camera fallback:
- Promote `apps/web/src/features/apply/capture/liveCamera.ts` and `licenceBarcodeReader.ts` (zxing-wasm 3.1.4, PDF417 today) to shared `components/` and `lib/`, adding Code 128. Features may not import each other's internals (`lint:boundaries`).
- Keep the dynamic import (~930 KiB WASM).
- `/apply`'s tests must stay green.
- A camera button sits beside IMEI and Serial.

### M10 — Equipment invoices

**M10a** — migration:
- `equipment_purchases`: org, vendor, invoice number, invoice date, total, notes, created by, nullable `fleetpal_purchase_order_id`, superseded-by.
- **RLS enabled.** Append-only: a correction is a new row. Pin it in `RETENTION_FORBIDDEN`.
- `inventory_assets.purchase_id` (nullable FK).
- A new document subject type `equipment_purchase`, extending `DOCUMENT_SUBJECT_TYPES` in `complianceContract.ts`.
- Check `scripts/table-writers.json`, `merge_driver` cascades (memory `merge-driver-cascade-trap`), and regenerate and COMMIT `supabase/schema.generated.sql` (`pnpm lint:table-writers` does it).

**M10b** — the **Invoices** tab on Equipment:
- **Add invoice**: vendor, number, date, total, PDF or photo, and which items it paid for.
- An item's page shows its invoice.
- FleetPal-bought items link the PO rather than being retyped.

**Then M5** — the owner's pass on the real Android tablet and a phone, in the bay, after M7 and M8 are on staging. Findings go in proposal §8.

**Next free migration number: 0527.** A parallel chat may take it: check the NAME on main before merging (memory `migration-number-race-with-parallel-chat`).

## How to work (traps met this week)

**Setup**
- Branch from `origin/main` in a sibling worktree: `git worktree add -b claude/<topic> ../FuelGuard-<name> origin/main`.
- Then run `pnpm install --frozen-lockfile` and `pnpm --filter @silvicom/shared build:rn`.
- Copy `apps/web/.env` and `apps/api/.env` from the main tree.

**PRs**
- Use the four template headings via `--body-file`.
- Commit screenshots under `docs/plans/maintenance/screenshots/` and link them by raw URL.
- Merge yourself when green: `gh pr merge --merge --delete-branch`.
- A PR behind main is refused — rebase first. Never push during a stopped rebase.

**Gates — run before pushing and check `$?`**
- Root: `pnpm typecheck`, `lint`, `lint:ui-adoption`, `lint:filesize`, `lint:funcsize`, `lint:surfaces`, `lint:comment-claims`, `lint:boundaries`, `lint:table-writers`, `lint:record-id`, `lint:date-format`; plus web `lint:tokens`.
- Tests with `CI=true` in **apps/web AND packages/ui AND packages/shared** (and apps/api for M9/M10). M6's CI failed on `packages/ui/src/lists/plural.test.ts`: every new FilterBar `count-label` needs its singular added to `EXPECTED`.

**§9 rules on every shop file**
- Every `DataTableColumn` carries `card:`.
- A primary verb goes in `WalkActions`, never in `PageHeader` with `variant="primary"`.
- Hand-written controls under 48 px need a touch branch.
- Every `DataTable` is paged or says `ui-adoption: never-paged — <why>`.
- A page with several lists uses `AppTabs` with `?tab=`.
- The gate derives the shop's files from the `/shop…` routes.

**Web test traps**
- `vi.mock("vue-router")` must keep `RouterLink`.
- A `<dl>` fails ui-adoption — use `FactList`.
- A `DataTable` inside a `BaseCard` needs `embedded`.
- jsdom has no `matchMedia`, so DataTable renders cards — stub a desk viewport for column tests.
- A RoadsideRepairDueDto fixture needs `proposal`.

**Browser pass**
- Start the app: `cd apps/web && VITE_DEV_BYPASS=true node scripts/preview-local.mjs --port 44xx`. Read the port from the END of the log; it listens on IPv6 `localhost` only.
- Use Playwright with `hasTouch: true, isMobile: true`, and ONE `ctx.route` on `/\/(api|rest\/v1|auth\/v1|storage\/v1)\//` returning raw JSON.
- **Open a fresh page per route and measure BEFORE the screenshot.** A full-page screenshot resets device emulation, and later loads then boot with `(pointer: coarse)` false. Tablet shots must be viewport captures.
- The M4/M6 pass scripts were in the session scratchpad and are gone. Rebuild from this description: measure `header/main button, a[href], select, input, nav a[href], .walk-bar button`; count a link stretched over its card as the card; skip 1-px inputs; let segments of one tablist abut; don't compare a fixed bar against scrolling content.

**Data and shell**
- Read production with `supabase db query --linked "<sql>"` from the main tree.
- Inventory tables are `inventory_assets`, `asset_types`, `asset_movements`, `parts`, `part_stock_lines`, `stock_locations`. Production has **0 parts, 0 assets** (the FleetPal Sync now is still owed after the release).
- macOS has no `timeout`. For non-trivial generators use the Write tool, not shell heredocs: a heredoc tripped the shell safety check once.

**Owner still owes:**
- Turn "Who can inspect" on for fleet_manager and the inspector's role.
- After the release: Settings → FleetPal → Sync now (≈ 3,558 parts).
- Ask accounting where device bills (`ATTAUIL`) are booked.

Memory START HERE: `maintenance-section-redesign-position.md`.
