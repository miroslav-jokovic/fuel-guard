# Handoff — Maintenance: finish tablets (M9c camera → DE2 driver-held tablets), then M10 (2026-10-29)

**The owner's instruction (2026-10-29): "finish everything related to tablets first."** The shop has a
connected **Tera Pro handheld scanner (HID keyboard, Code 128)** and a **label printer (2" direct
thermal roll, 203 dpi)**. Every tablet has an AT&T SIM and an IMEI barcode sticker on the back (Q-MX11).

Read first, in this order:
1. This file. It is not committed yet, so it sits in the main tree; commit it with M9c's PR.
2. The memory file `maintenance-section-redesign-position.md` (M7–M9b entries at its end).
3. `docs/plans/maintenance/MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md`: §7a.6 (IMEI) and the progress log at the END of §8.
4. `docs/plans/maintenance/DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md`: §0 (two inventories), D-DE1–D-DE4, and **§3 step DE2**.
5. `docs/DESIGN-SYSTEM-CONTRACT.md` §9 (phone and tablet rules 1–9).

## Where we are (main `0ccc16e`; everything below is merged and on staging)

| PR | Step | What shipped |
|---|---|---|
| #1819 | M7 | Equipment is its own sidebar row again. The order is Shop · Trucks & trailers · Equipment · Annual inspections · Shop parts. `/shop/assets` has two tabs: `?tab=on-trucks` (`EquipmentOnTrucksPanel`, words from `onBoardWords.ts`) and `?tab=inventory` (`EquipmentInventoryPanel`). `UnitKitLineDto.heldBy`. `/shop/units?show=short` redirects to On trucks › Missing something. |
| #1822 | M8 | Parts becomes **Shop parts** (FleetPal's, read-only, no New part; Edit only for parts typed by hand before F12). Shelf counting is hidden by one constant, `apps/web/src/lib/shelfCounting.ts`. |
| #1823 | M9a | Migration **0527**: `inventory_assets.imei` (CHECK 15 digits; unique `(org_id, imei)` where not null; index `idx_inventory_assets_imei_unique`). |
| #1824 | M9b | The sticker scan. Details below. |

**M9b in detail (the files you will touch next):**
- `packages/shared/src/deviceSticker.ts`: `isImei` (15 digits + Luhn), `luhnValid`, `IMEI_REFUSAL`, and `readStickerCode(raw)`. The last sorts one barcode into `imei | bad_imei | sim (ICCID) | box_barcode (EAN/UPC) | model (SM-/TB- prefixes) | serial | unknown`.
- `apps/web/src/features/inventory/StickerScanField.vue`: the "Scan the sticker" field. It swallows Enter and Tab, and also listens on the document through `useScanInput` while the drawer is open.
- `stickerFill.ts`, `fillFromSticker`: puts each read in its field, in any order, and never overwrites. It picks the type only when **exactly one** type has `heldBy: "driver"`. The name follows the sticker ("Samsung SM-T575") until the person types their own.
- `AssetForm.vue`:
  - the IMEI field shows for a serialized type;
  - Enter in an input never submits;
  - an `initial` seed (exported type `AssetFormSeed`) goes through the same sticker rules once the types arrive.
- `AssetDrawer.vue`:
  - **Save and add another**: keeps type, model, maker, place and purchase details; clears IMEI, serial, name and notes;
  - accepts `initial`;
  - the toast names `A-0412`.
- API:
  - `assets.ts`: `imei` in `ASSET_COLUMNS` / `AssetRow` / DTO, and IMEI in the search;
  - `assetsWrite.ts`: writes `imei`; maps 23505 on the IMEI index to `duplicate_imei`;
  - `assetTypes.ts`: reads `held_by` into `AssetTypeDto.heldBy`;
  - `labels.ts`: the label's 2nd line is `IMEI …`; it fits the roll and the 1½" sheet;
  - `tagResolvers.ts` `resolveAssetByDevice`: IMEI or serial, called in `tags/routes.ts` before the UPC lookup.
- `/shop/scan` (`ScanResultCard.vue`, `ScanPage.vue`):
  - an unknown IMEI offers **Add this tablet**, opening `AssetDrawer` with the IMEI;
  - `bad_imei` and `sim` are named;
  - **"Create a part with this barcode" was removed** (M8).
- **A production bug, fixed in #1824:** the Scan page opened no drawer in a built app. `ShopLayout` draws `#shop-action-bar` after its slot, so the page's `<Teleport>` mounted into nothing and the next re-render threw "reading 'emitsOptions'". The fix is `<Teleport defer>`. A test now mounts `ScanPage` inside the real `ShopLayout`. **Any new Teleport into a layout target needs `defer`.**

## The gap that decides the order: nothing can mark a type "held by driver"

`asset_types.held_by` ('unit' | 'driver') came in with 0524 (DE1). DE2 was meant to add the screens and was never built:
- no screen sets `held_by`;
- the standard kit's "Tablet" (`packages/shared/src/inventoryKitCatalogue.ts`) has no `heldBy`;
- `move_asset` can move to `driver_id`, but no API route or UI does.

So two things built in M7/M9b don't do anything yet:
- the type prefill (it needs exactly one driver-held type);
- M7's "Tablet (Dana Reyes)" wording (it reads `heldBy` on the kit line).

⚠ **Do not just flip Tablet to `driver`.** `move_asset` would then refuse a truck as a tablet's holder (`IV025`), and with no give/return verb a new tablet could only sit on a shelf. DE2 must ship the setting **and** the give/return verbs together.

## The steps, each its own PR

### M9c — Camera fallback (no migration)
For when the handheld isn't near. A tablet can't scan its own back, so this camera is a phone's or another tablet's.
- Move `apps/web/src/features/apply/capture/liveCamera.ts` and `licenceBarcodeReader.ts` to shared homes: `components/` for UI and `lib/` for the reader. They use zxing-wasm 3.1.4 and read PDF417 today. Check `useLiveScan.ts` and `liveFrame.ts` too: decide what is apply-specific (AAMVA parsing stays in apply) and what is generic.
- Add **Code 128** to the formats. `lint:boundaries` forbids a feature importing another feature's internals.
- **Keep the dynamic import** (≈930 KiB WASM loads only when the camera opens). `/apply`'s tests must stay green, and `pnpm --filter @silvicom/web e2e:apply` too (it needs a built `dist`; see memory `e2e-apply-in-dot-worktree-needs-web-dist`).
- Add a **camera button in `StickerScanField`**. Each decoded barcode goes through the same `take()`, so it lands exactly like a handheld read; keep scanning until closed. Also add a camera button on `/shop/scan`.
- iOS asks for camera permission again on navigation (the D-INV17 note in `ScanPage.vue`), so keep the camera as an overlay and never a route.

### DE2 — Driver-held tablets: API and screens (no migration; 0524 has the schema)
Per `DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md` §3 DE2 and D-DE1–D-DE4:
- **Types of equipment drawer** (`AssetTypesDrawer.vue`): a *Held by: truck or trailer / driver* setting, written through `assetTypes.ts`.
  - `IV025` refuses the change while assets contradict it; word that refusal.
  - Add `heldBy` to `assetTypeInputSchema`.
  - The standard kit's Tablet should become `driver` (decide: the catalogue default, or the owner flips it once — the plan says "set to driver once, by the owner").
- **Verbs** through `move_asset`:
  - **Give to driver** (an active or on-leave driver only), offered only for a `held_by = 'driver'` type;
  - **Return to shop** (to a stock location).
  - In the API this means `toDriverId` in `assetMovementInputSchema` and the movement route.
  - In `AssetMoveDrawer`, a driver picker.
  - `merge_driver` already lists the `driver_id` columns (0524 / `DRIVER_REASSIGNMENTS`); verify.
- **The round trip owed since DE1** (plan §5 log): `driverId` and the driver's name on `AssetDto.holder` (holder kind `driver`), and `fromDriverId`/`toDriverId` on the movement DTO. Update `holderOf` in `assets.ts`, the scan card's holder line ("Dana Reyes's tablet"), and the On trucks sentence.
- **Driver page:** an Equipment card showing the tablet, its tag, since when, and a *Not returned* badge when the driver is terminated or inactive (derived at read time, D-DE3). Mind the feature boundary: the driver page reaches inventory through an API or a shared component, never `features/inventory` internals.
- **Shop › Equipment:** a *Tablets not returned* count, counted server-side and never a page total.
- **Kit check (D-DE4):** a truck's kit counts its assigned driver's tablet. Look at `units.ts` `listUnitKits` / `getUnitKit` and `deriveKitStatus`.
- `/shop/scan`: a driver-held tablet's card names the driver and offers *Return to shop*.
- After DE2, check that the M9b type prefill and the M7 "Tablet (driver)" wording come alive. Both already have tests.

### M10 — Equipment invoices (after tablets)
- **M10a**, migration **0528** (check the NAME on main first; parallel chats take numbers):
  - `equipment_purchases` (org, vendor, invoice number, invoice date, total, notes, created by, nullable `fleetpal_purchase_order_id`, superseded-by), with RLS on, append-only, pinned in `RETENTION_FORBIDDEN`;
  - `inventory_assets.purchase_id`;
  - document subject type `equipment_purchase` in `DOCUMENT_SUBJECT_TYPES`;
  - `scripts/table-writers.json`; the merge_driver cascade (memory `merge-driver-cascade-trap`);
  - regenerate and **commit** `supabase/schema.generated.sql`.
- **M10b:** an **Invoices** tab on Equipment.
  - Add invoice takes vendor, number, date, total, a PDF or photo, and which items it paid for. This fits "Save and add another": a box of 10 tablets is one invoice.
  - An item's page shows its invoice.
  - FleetPal-bought items link the PO (33 POs ≈ $13.5k for straps and chains).
  - No McLeod matching until accounting answers about `ATTAUIL`.

### M5 — the owner's pass
On the real Android tablet and a phone, in the shop, with the Tera scanner and the printer. It can start now: M7, M8 and M9b are on staging. Findings go in proposal §8.

## How to work (traps met in M7–M9b)

**Setup**
- `git worktree add -b claude/<topic> ../FuelGuard-<name> origin/main`
- `pnpm install --frozen-lockfile && pnpm --filter @silvicom/shared build:rn`
- copy `apps/web/.env` and `apps/api/.env` from the main tree
- Re-run `build:rn` after editing shared, before web tests.

**Gates (check `$?` for each one; `printf "%s=%s " $g $?` in a loop)**
- `typecheck lint lint:ui-adoption lint:filesize lint:funcsize lint:surfaces lint:comment-claims lint:boundaries lint:table-writers lint:record-id lint:date-format lint:migration-ordering lint:upserts`, plus `pnpm --filter @silvicom/web lint:tokens`.
- `lint:table-writers` ends with `git diff --exit-code` on `schema.generated.sql`. It fails until the regenerated file is committed, then passes.
- `lint:tokens` reads `#1801` in a comment as a hex colour; write "PRs 1801 and 1803" instead.
- `vuejs-accessibility`: no `autofocus` prop name (use e.g. `focusFirst`). A keydown on a `<form>` needs `<!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->` (precedent: the chat files).

**Tests**
- Run `CI=true npx vitest run` in packages/shared, packages/ui, apps/api and apps/web, **one at a time and never alongside a vite build**. Running them alongside a build makes files fail with "Timeout starting forks runner"; rerun those files alone.
- `roadsideRepairCertify.test.ts` › "the filed PDF…" flaked once in the full api run and passed 3/3 alone. It's unrelated.
- A new FilterBar `count-label` needs its singular in `packages/ui/src/lists/plural.test.ts`.
- nav snapshots: every `navEquivalence` snapshot change needs a dated reason in the test file's header. Read the diff line by line before `-u`.
- `vitest run -u <file>` from apps/web can run the whole suite; check `git status` for stray snapshot writes.
- Prove every new test can fail: mutate the source, see it fail, `cp` the bytes back, and check with grep.
- `supabaseRecorder` does not filter. Use function fixtures (`onlyWhen(col,val,row)`); writes are `rec.writes()` → `.write.payload`.
- A supabase-js conditional `.select(a ? X : Y)` types as an error, so use one literal. An untyped to-one embed infers an ARRAY; type it as `obj | obj[] | null`.

**Browser pass (do one for every UI PR; it found the Teleport bug)**
- `cd apps/web && VITE_DEV_BYPASS=true node scripts/preview-local.mjs --port 44xx` (run in the background). Read the port from the END of the log; it serves IPv6 `localhost` only.
- Playwright from apps/web: copy the script in as a temp file, run it, and delete it. Use ONE `ctx.route` on `/\/(api|rest\/v1|auth\/v1|storage\/v1)\//` returning raw JSON. Use `hasTouch:true, isMobile:true` at 390×844 and 834×1194, a fresh page per route, and measure before any screenshot (a full-page screenshot resets touch emulation).
- **To simulate the Tera:** `page.keyboard.type(code, { delay: 5 }); page.keyboard.press("Enter")`.
- **Attach `page.on("console")` and `page.on("pageerror")`.** The app's error boundary hides the first error, and a dead button shows nothing else.
- To look at a label: a temporary tsx script calling `renderLabelBitmap` (roll, 203 dpi) and writing a PNG, plus `renderLabelSheet` → `pdftoppm`.
- Commit screenshots under `docs/plans/maintenance/screenshots/` and link them by raw URL in the PR.

**PRs**
- Use the four template headings via `--body-file`. The title is an office-reader sentence.
- Append to the proposal's §8 log at the END.
- Merge yourself when green: `gh pr merge --merge --delete-branch`, then `git worktree remove`.
- Update memory `maintenance-section-redesign-position.md` + the `MEMORY.md` line.
- Never `git stash pop` (it can take another session's stash); never push during a stopped rebase.
- Production reads: `supabase db query --linked "<sql>"` from the main tree. Production has 0 assets today.

## The owner still owes
- Turning "Who can inspect" on for fleet_manager and the inspector's role.
- After the release: Settings → FleetPal → Sync now (≈3,558 parts).
- Asking accounting where device bills (`ATTAUIL`, ≈$622 a month) are booked.
- With DE2: confirming Tablet is driver-held (D-DE1 says yes; flip it once).
- M5: the pass in the shop with the Tera and the printer.

**Start with M9c.**
