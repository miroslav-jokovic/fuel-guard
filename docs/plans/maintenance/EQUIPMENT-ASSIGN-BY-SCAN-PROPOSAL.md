# Equipment: assign by scan, from the truck or the driver (proposal, 2026-10-30)

Owner brief 2026-10-30: tablets belong to drivers, everything else belongs to trucks, and the
current screens are "not natural for usage". Proposed by the owner: an **Assign equipment** button on
the truck and driver pages that opens a scanner — scan the QR, confirm, done; the Equipment page lists
trucks and drivers (separate tabs) with what each holds; the printed QR labels exist so that anything
can be scanned to assign it and to inspect.

This document checks that idea against what is built and measured, and recommends how to do it.
It is truck inventory only (§0 of `DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md`): shop parts are
FleetPal's and are not touched.

## 1. Verdict

**The idea is right, and the database already supports it.** `inventory_assets` already has one
holder out of bay / truck / trailer / driver, `asset_types.held_by` already says "a driver holds
this" (0524), and `move_asset` already writes every change to the ledger. Nothing needs a
migration. What is wrong is the **direction of the screens**: every flow today starts from the
*item* and ends in a 400-row destination list. The owner's idea flips it so the flow starts from
the *holder* — which is how the work is actually done (a person stands at truck 654 with a box of
straps, or hands a tablet to a new driver).

Production today (measured 2026-10-30): 1 type (Tablet, driver-held), 2 items, 0 on trucks,
0 with drivers, 0 "should carry" rules, 0 movements, 1 bay, 211 active trucks. **Nothing has to
be migrated or retrained — this is the cheapest moment the change will ever have.**

## 2. What is confusing today (measured on `origin/main` 2cd5f96)

| # | Finding | Where |
|---|---|---|
| 1 | **Assigning starts from the item.** Find it on Equipment › Inventory or scan it on `/shop/scan`, then *Move it somewhere*, then pick from one list that mixes the bay, every truck and every trailer. | `AssetMoveDrawer.vue` |
| 2 | **A truck has three pages**, and equipment appears on all three differently: `/vehicles/:id` (read-only `UnitKitCard`), `/trailers/:id` (same), `/shop/units/:kind/:id` (`UnitEquipmentSection` — the only one with controls). The fleet card is read-only *on purpose* (D-AVI17) and links away to the shop's page. | `VehicleDetailPage.vue:233`, `TrailerDetailPage.vue:123`, `UnitDetailPage.vue` |
| 3 | **The driver page shows a tablet but cannot give one.** `DriverEquipmentCard` is a list; giving is done from the tablet's own page through the Give / Return / Retire drawer. | `DriverEquipmentCard.vue` |
| 4 | **"Should carry" (kit rules) is a second concept every screen has to explain** — "missing", "short", per-unit overrides, three resolution layers — and production has zero rules. | `KitRulesDrawer`, `UnitOverrideDrawer`, `EquipmentOnTrucksPanel` |
| 5 | **The inspection walk does not use the scanner.** The unit check is tap-per-row; the labels and the Tera Pro scanner, which are the reason the labels exist, are not part of it. | `UnitCheck.vue` (no `useScanInput`) |
| 6 | **Trucks and trailers have no QR of their own yet** (`TAG_KINDS = ["AST", "BIN"]`; `VEH`/`TRL` are DE3–DE4, parked behind the exterior-plate order). So "scan the truck, then scan the items" cannot work today — the truck has to be chosen on screen. | `tagContract.ts:54` |

## 3. The recommended design

### 3.1 One verb, two doors: **Assign equipment**

A single `AssignEquipmentDrawer` (new, in `features/inventory`) opened from:

- **Truck page** and **trailer page** (`/vehicles/:id`, `/trailers/:id`) → holder = that unit.
- **Driver page** (`/drivers/:id`) → holder = that driver.

The drawer is a scan list:

1. It opens already listening — the Tera Pro (HID, `useScanInput`) types into it; a **Camera**
   button uses the M9c camera (`BarcodeCamera.vue`) when the handheld isn't nearby; a typed code
   field covers a smudged label (`A-0412` or the printed code — the resolver already reads both).
2. **Every scan adds one line** and the drawer keeps listening, so a whole box of straps is
   scanned in one go. Each line says what it is and what will happen:
   - *Ratchet strap A-0412 — in the shop* → ✓ will be assigned.
   - *Load bar A-0398 — on truck 702* → ⚠ **will move from 702** (allowed; said out loud).
   - *Tablet A-0101 — with Dana Reyes* → ⚠ will move from Dana Reyes (driver page only).
   - Scanned twice → ignored, line flashes (the 800 ms same-symbol rule already exists).
3. **Confirm** writes one `move_asset` per line (each with its own id minted when the line was
   added, D-INV27, so a retry on bad signal never double-moves). One toast: *"5 items assigned to
   truck 654."*

**The rule that makes it simple — the drawer refuses the wrong holder instead of asking:**

| Scanned on… | Item is… | Answer on the line |
|---|---|---|
| Truck / trailer | truck equipment | ✓ assign |
| Truck / trailer | a tablet (`held_by = driver`) | ✕ *"Tablets go to drivers."* If the truck has an assigned driver, one button: **Give to Dana Reyes instead.** |
| Driver | a tablet | ✓ give |
| Driver | truck equipment | ✕ *"This goes on a truck."* If the driver has an assigned truck: **Put on truck 654 instead.** |
| Either | retired / lost | ✕ *"Retired — not in use."* |
| Either | unknown label or IMEI | *"Not in inventory"* + **Add it** (opens `AssetDrawer` with the M9b sticker prefill, then lands back on the list) |

The rule is already in the database (`IV025`) and in `driverHeldMove.ts`; the drawer reads
`heldBy` from the type, it does not restate it.

### 3.2 Taking things off

On the same card, each row has one button: **Return to shop**. With one bay (production today)
there is nothing to choose; with more, the drawer asks which. A second kebab item keeps
**Report missing** (the existing report verb — the item stays the truck's, flagged). Nothing is
ever deleted, as today.

### 3.3 The card on the truck / trailer / driver page

One shared `HolderEquipmentCard` replaces `UnitKitCard` (vehicle + trailer pages) and
`DriverEquipmentCard`:

- Header: **Equipment (5)** · **Assign equipment** · **Check equipment** (§3.5).
- Rows: name, label number, since when, Return.
- On a truck, the assigned driver's tablet shows as a read-only row *"Tablet A-0101 — with driver
  Dana Reyes"* (D-DE4 already counts it), so the truck's list is complete.
- Driver page: the tablet row carries *Not returned* when the driver has left (D-DE3, unchanged).
- Buttons are shown to people who can manage the shop section; everyone with `maintenance: view`
  sees the list (today's gate, unchanged).

The shop's truck page (`/shop/units/:kind/:id`) Equipment tab renders the **same card**, so there is
one spelling of "what this truck carries" and one way to change it.

### 3.4 The Equipment page: three tabs

| Tab | One row per… | Shows |
|---|---|---|
| **Trucks & trailers** | unit holding anything | unit number, items (comma list), count, last checked · filter kind / search |
| **Drivers** | driver holding a tablet | driver, tablet, since, *Not returned* filter (the count already exists) |
| **In the shop** | item not assigned | name, label, type · **Add equipment**, **Print labels** |

Clicking a row opens that truck's or driver's page, where Assign / Return live. The **In the shop**
tab is the owner's two tabs plus the one place an unassigned item can be found — without it, a
returned strap has no screen. It is the current Inventory tab, renamed and filtered to the bay.

### 3.5 Inspection = scan everything you see

**Check equipment** on the truck card opens the same scan list, in check mode: the truck's items
are listed; every scan ticks one off; a scanned item that belongs elsewhere shows *"Belongs to
truck 702 — move here?"*; **Finish** marks the unticked ones as *Not found* (the existing
`reported_missing` write) and stamps *last checked*. This is the existing unit check
(`UnitCheck.vue`, D-INV19) given the scanner; its session and offline queue stay.

### 3.6 `/shop/scan` stays as "what is this?"

Scan anything → card says what it is and **where it is** → buttons **Open truck 654** /
**Return to shop**. It no longer offers a destination list.

## 4. What this replaces (decisions it overrules — owner to confirm)

- **D-AVI17** (fleet truck card is read-only, decisions only on the shop's page) → the Assign /
  Return buttons live on the fleet truck, trailer and driver pages.
- **M7 "On trucks" tab** (kit-worded rows, *Missing something* filter) → *Trucks & trailers* tab
  listing what is held.
- **"Should carry" / kit rules** (I9, `KitRulesDrawer`, `UnitOverrideDrawer`, *short* counts) →
  **hidden behind one flag** (the `SHELF_COUNTING_SHOWN` pattern), code kept and tested. Zero rules
  exist in production; the inspection in §3.5 answers "is it still there" without them. Bring it
  back only if the owner later wants "every truck must carry 4 straps" alerts.
- **The asset-first Move drawer** stays only on the item's own page, for the rare correction.

## 5. Steps (each its own PR, no migration in any of them)

| Step | What | Size |
|---|---|---|
| **EA1** | `AssignEquipmentDrawer` (scan list, holder rules, camera, typed code, batch confirm) + `HolderEquipmentCard` with Return; mounted on vehicle, trailer, driver and shop unit pages. API: a resolve-for-holder answer per scan (reuses `tags/resolve` + `heldBy`); confirm loops `move_asset` server-side in one request. | largest |
| **EA2** | Equipment page → Trucks & trailers / Drivers / In the shop tabs; kit wording + Should carry behind the flag. | medium |
| **EA3** | Check equipment = scan-driven unit check. | medium |
| **EA4** | `/shop/scan` card: *where it is* + Open holder / Return. | small |
| later | Truck/trailer QR (`VEH`/`TRL`, DE3–DE4) once the plates are ordered: scanning a truck's plate opens its Assign drawer — the yard flow becomes scan truck → scan items → Confirm. | parked |

Browser pass for each: tablet 834 px and phone 390 px, touch targets ≥ 48 px (contract §9),
Tera Pro simulated by `keyboard.type` + Enter.

## 6. Questions for the owner — ANSWERED 2026-10-30: "as recommended, plan it and build it"

| # | Question | Recommendation |
|---|---|---|
| **Q-EA1** | Trailers get the same Assign button (straps, chains and load bars usually live on the trailer)? | **Yes** — same card, the schema already has trailer holders. **RULED yes.** |
| **Q-EA2** | Scanning an item that is on another truck: move it automatically (with the warning on the line), or refuse? | **Move with the warning** — refusing makes the person walk to the other truck's page first. **RULED: move with the warning.** |
| **Q-EA3** | Hide "Should carry" rules for now? | **Yes, behind a flag** (§4). **RULED yes (EA2).** |
| **Q-EA4** | Which truck page is *the* truck page? There are three today (fleet, trailer, shop hub). This proposal puts one shared card on all of them; folding the shop hub into the fleet page is a separate plan. | Shared card now; merge pages in the truck/trailer pages plan the owner is writing (Q-DE3). **RULED: shared card now.** |
| **Q-EA5** | When a driver is assigned to a truck in McLeod, should the app offer *"Give the tablet too?"* | **Not now** — record it; the Assign drawer's "Give to Dana Reyes instead" covers the common case. **RULED: not now.** |

## 7. Progress log

- 2026-10-30 — proposal written from a measurement of `origin/main` 2cd5f96 and production.
- 2026-10-30 — the owner: "as recommended, plan it and build it" — Q-EA1..Q-EA5 ruled as recommended (§6).
  §4's overrulings stand: D-AVI17 (read-only fleet card), M7's On trucks tab, Should carry (EA2).
- 2026-10-30 — **EA1 built** (`claude/equipment-assign-ea1`). No migration, no API change.
  - `features/inventory/assignLine.ts` — the one judgement of a scan against a holder (`judgeScan`,
    `holderPartner` off `vehicles.assigned_driver_id`, co-driver's team truck included); reason
    `assigned` from the shelf, `transferred` from a holder, as the move drawer writes them.
  - `AssignEquipmentDrawer.vue` — the scan list. Tera Pro via `useScanInput`, typed field, M9c camera
    kept open for many reads, Add it through `AssetDrawer` (M9b's sticker seed). A line stores the
    API's answer and its holder; the verdict is derived on every render, so a line scanned before the
    types load is re-judged when they do. One item by two codes is one line.
  - **Deviation from §5's row: Confirm loops the existing `POST /assets/move` per line, client-side,
    instead of a new server batch endpoint.** Each line carries its own movement id minted at scan
    (D-INV27), so a half-failed Confirm re-sends exactly the failed lines with their ids, and each
    line shows its own refusal in the API's words. A batch route would have added a second door to
    `move_asset` for no behaviour the loop lacks.
  - `HolderEquipmentCard.vue` replaces `UnitKitCard` (vehicle + trailer pages) and `DriverEquipmentCard`
    (driver page), and the shop truck page's On board table. Truck card lists the assigned driver's
    tablet read-only (D-DE4). Return to shop = one tap when the org has exactly one bay
    (`defaultReturnBay`), the move drawer otherwise; Report missing or damaged in the kebab.
  - The drawer calls `provideTouchTargets(useTouchedWindow())`: the fleet pages are not phone-first, and
    the browser pass measured 10 controls under 44 px at 390 and 834 px; after, 0.
  - Browser pass (built app, dev bypass, Tera simulated by keyboard bursts) at 390×844 and 834×1194:
    four scans → strap from shelf, load bar moving from 702 (warning), tablet refused with "Give to
    Dana Reyes instead", misread IMEI refused; duplicate scan flashed the existing line; Confirm sent 3
    and closed; driver card shows IMEI …43809 + since; no console errors. Screenshots
    `screenshots/ea1-*.png`.
  - Tests: `assignLine.test.ts` (16), `AssignEquipmentDrawer.test.ts` (5), `HolderEquipmentCard.test.ts` (8);
    5 mutants (tablet allowed on a truck, id per Confirm, no de-dupe, Return to nowhere, verbs for a
    viewer) each failed a test and were reverted byte-identical.
  - Next: EA2 (Equipment tabs; Should carry behind a flag), EA3 (scan-driven check), EA4 (Scan page card).
- 2026-10-30 — **EA2 built** (`claude/equipment-assign-ea2`). No migration.
  - **Measured on the way in:** production's one type, Tablet, has `default_kit_quantity = 200` — typed
    into "how many a truck or trailer carries by default", read as how many the shop owns. With Should
    carry live, every truck's first check would have put it on the worklist as "Missing 199 pieces of
    equipment". The value is left as the owner entered it (an edit of the type still sends it back);
    hiding the layer makes it inert. Resetting it to 0 is the owner's call.
  - `KIT_RULES_SHOWN = false` in `@silvicom/shared` (`inventoryKitShown.ts`) — shared, not web-only like
    `SHELF_COUNTING_SHOWN`, because `unitAttention.ts` reads it too and stops reading the kit, so no unit
    is on the worklist for "missing equipment". Hidden behind it: the kit card, badge and Should carry
    table on the truck's Equipment tab, "What this one should carry", Equipment's "What each truck should
    carry" and "Missing something", the default-quantity field and the standard-kit button on Types of
    equipment. Tests flip it with a live getter so the kept code stays tested.
  - Equipment's tabs: **Trucks & trailers** (`trucks`; opens on units carrying something; Show › Every
    truck and trailer / Never checked), **Drivers** (`drivers`; new `EquipmentDriversPanel`, a row per
    thing a driver holds, driver first, opens the driver's page; the Tablets not returned callout and
    Returned filter moved here), **In the shop** (`shop`; Where › In the shop / Anywhere). M7's
    `?tab=on-trucks|inventory` redirect in `routes/maintenance.ts`; `/shop/units?show=short` lands on
    `trucks`.
  - API: `GET /assets?holder=shop|driver` — `shop` = no truck/trailer/driver and not retired unless a
    status is asked; `driver` = `driver_id is not null`.
  - Tests: EquipmentPage (11), assets.test (+2), unitAttention (+1), read-states (+1), UnitDetailPage (+1);
    5 mutants each failed a test and were reverted byte-identical.
- 2026-10-30 — **EA3 built** (`claude/equipment-assign-ea3`). No migration, no API change.
  - The unit check takes the scanner (`useCheckScan.ts`): a label of something this unit holds ticks it
    off and writes nothing (as *It's here* does) — the truck's driver's tablet included (D-DE4), which
    is why the check's own list is asked before `judgeScan`, whose answer for a tablet on a truck is
    "goes to a driver"; something recorded elsewhere says where and offers *Move it here* (the `found`
    move *One turned up* writes); anything else gets the Assign list's sentence. One answer line,
    replaced per scan. Camera kept open for many reads.
  - **Close reports what nobody scanned or ticked as not found** (`reported_missing`, holder unmoved,
    D-INV24), after a dialog that names how many ("Report 2 not found and close?"). Until EA3 those
    were left as they were. Close returns to the truck's Equipment tab, not the Trucks & trailers list.
  - *Check equipment* on the truck's and trailer's equipment card (`useStartUnitCheck`, now the one
    starter the shop's header verb uses too); not on a driver's card, nor on the shop truck page whose
    header has it.
  - Tests: UnitCheck (+6), HolderEquipmentCard (+2); 4 mutants each failed a test — the fourth (drop the
    "is it this unit's" lookup) first SURVIVED, which found the untested driver's-tablet case, now pinned.
  - **Found in EA3's browser pass:** the check page still showed Should carry's own sections — "Not on the
    list · Ratchet strap · 2 carried" (every carried thing, with no rules), the "Missing" kinds with
    *One turned up*, and "Short" rows at review — which EA2 had missed. Now behind `KIT_RULES_SHOWN`; a
    stray is moved on by scanning it instead (*Move it here*). Pass at 390/834 px: scan ticked the strap
    and the driver's tablet, the stray read "recorded on Truck 702" and moved with `found`, close asked
    "Report 1 not found and close?" and wrote one `reported_missing`, then landed on the truck's
    Equipment tab; 0 controls under 44 px, no console errors. Screenshots `screenshots/ea3-*.png`.
- 2026-10-30 — **EA4 built** (`claude/equipment-assign-ea4`). No migration, no API change.
  - The Scan page's card for a thing: where it is (unchanged sentence), then **Open** its holder's page
    (truck, trailer or driver — gated by `useOpens`) and **Return to shop**; *Report* stays. The
    destination list (*Move*) is gone from this card; a thing in the shop shows how to assign it ("open
    that truck or driver and press Assign equipment — then scan it there").
  - `useReturnToShop.ts` — the one Return: one tap with exactly one bay, `false` otherwise so the caller
    opens the move drawer to ask which. The equipment card (EA1) and the Scan page both use it, so both
    doors write the same `removed` row, with the per-item movement id kept until it lands (D-INV27).
  - Tests: ScanPage +4 (open the driver / the truck, one-tap return, two bays ask, in-shop hint).
  - Browser pass at 390/834 px (Tera simulated): a truck's load bar → *Open Truck 654* (`/vehicles/…`) and
    *Return to shop* wrote one `removed` into the only bay; a shelf item showed the assign hint and no
    Return; no console errors. Screenshots `screenshots/ea4-*.png`.
