# Driver equipment, truck and trailer tags, and the hardware that arrived (2026-10-27)

A companion to `INVENTORY-PLAN.md`, in the same way `FLEETPAL-INTEGRATION-PLAN.md` is: the inventory
plan stays the record of I0–I13, and this document owns the three things the owner asked for on
2026-10-27, the day the label printer and the handheld scanner arrived and a batch of Android tablets
came in to be tagged.

1. **Tablets follow the driver.** Every other piece of equipment stays with the truck or trailer.
2. **Trucks and trailers carry a QR label too**, scanned through the same `/shop/scan` as everything else.
3. **The hardware is answered** — A5 (printer and stock) and the scanner model — so I10 and §0 of the
   I6 runbook can finally close on real devices.

The owner's bar, recorded verbatim because every step below is measured against it: *"this system is
user friendly and simple to use, but precise and reliable."*

**This plan is TRUCK inventory only.** §0 says what that excludes; read it before anything below.

---

## 0. Two inventories, kept apart (owner ruling 2026-10-27)

`INVENTORY-PLAN.md` built two features in one module and named the reason (one tag namespace, one
scan). That stays true of the *scanner*. It is not true of the *work*: on 2026-10-27 the owner ruled
that they are two separate inventories with two separate sources, and this plan had mixed them —
§5's first draft listed "no way to load the parts catalogue" as a truck-inventory readiness blocker
and asked the owner how parts should get in. Owner, verbatim: *"We have Shop inventory that will be
pulled from FleetPal, but we are now working on Truck inventory that will be separate from Shop
inventory, and also this is part of our system only."*

| | **Truck inventory** — this plan | **Shop inventory** — not this plan |
|---|---|---|
| What | The equipment a truck or trailer carries — straps, chains, load bars, fridge, tablet holder — and the **tablets, which follow the driver** (D-DE1) | The parts on the shop's shelves |
| Source of truth | **Silvicom only.** Entered, tagged, moved and checked here; no FleetPal sync, no import | **FleetPal.** Pulled in by the FleetPal integration (`FLEETPAL-INTEGRATION-PLAN.md`, F12 onward) |
| Tables | `asset_types`, `inventory_assets`, `asset_movements`, `kit_expectations`, `stock_count_sessions` where `kind = 'unit'`, and later `unit_tags` (D-DE5) | `parts`, `part_stock`, `stock_locations`, `part_movements`, `stock_count_sessions` where `kind = 'location'` |
| Tags | `AST` (equipment); `VEH`/`TRL` (trucks and trailers, DE3–DE4) | `BIN` (shelves); supplier UPCs |
| Screens | Assets, Units, a unit's page, the kit check, Labels → Assets | Parts, a part's page, the shelf count, Labels → Shelves |

**What the two still share, deliberately:** `/shop/scan` (one trigger pull, whichever label it is —
D-INV7's resolver registry decides), the label printer and the `/shop/labels` screen, and the
Maintenance section's permissions. Those are the hardware and the doorway, not the data.

**How to apply it.** A step in this plan touches only the truck column. A finding about the shop
column is filed in the FleetPal integration plan, never answered here. Where a shared screen is
fixed (the scanner, the label screen), the fix is recorded here only for its truck-inventory half.

**Superseded by this ruling:** `INVENTORY-PLAN.md` D-INV6 (*"Silvicom builds its own shop
inventory"*). How much of the shop's inventory FleetPal supplies — the catalogue only, or quantities
and locations too, and therefore what remains of D-INV10 — is a question for the FleetPal plan, not
this one.

---

## 1. Measured reality (2026-10-27, `origin/main`, migrations through 0521)

| Fact | Where | Consequence |
|---|---|---|
| An asset's holder is a stock location, a vehicle or a trailer — three nullable FKs and a `<= 1` CHECK; **no `drivers` column anywhere** | `0333_inventory_assets.sql:15-22`, `:219` | Tablets need a fourth holder. D-INV3 is amended, not reinterpreted (D-DE1). |
| `inventory_holder_is_ours(org, location, vehicle, trailer, active)` is the ONE org guard for every holder column, called from three triggers | `0333:79-107`, `:123`, `:300`, `:413` | A driver holder extends that function's question; it must not grow a second, parallel guard (D-DE2). |
| `merge_driver_v2` reads its move list from `DRIVER_REASSIGNMENTS` in TypeScript, validated against `information_schema` before it writes | `apps/api/src/modules/roster/mergeDriver.ts:23`, `0264` | A `drivers` FK on `inventory_assets`/`asset_movements` is one list entry each, in the same PR as the column — `0234` is why: nine tables once lost their rows to a merge because nobody added them. |
| `drivers.status` ∈ `applicant, active, inactive, on_leave, terminated` | `0240_driver_status_vocabulary.sql:23` | "Not returned" is derivable at read time from the holder's status; nothing is stored (D-DE3). |
| **The standard tractor kit expects one Tablet** | `packages/shared/src/inventoryKitCatalogue.ts:81` | Moving tablets to drivers would make every tractor's kit check report its tablet missing. D-DE4 resolves it. |
| `TAG_KINDS = ["AST", "BIN"]`; `tagContract.ts:46-48` already names `vehicle`/`trailer` as the next kinds; adding a kind is one resolver import (D-INV7) | `packages/shared/src/tagContract.ts:54`, `apps/api/src/tags/resolvers.ts` | Truck and trailer tags are a planned extension, not a new fabric (D-DE5). |
| The QR encoder, label geometry, tag issuance, PDF sheet and `/shop/labels` screen are BUILT (I10 PR 1 + 2, #713/#715) | `packages/qr/`, `apps/api/src/modules/maintenance/inventory/labelPdf.ts`, `apps/web/src/pages/LabelsPage.vue` | "We may not have a QR generator" — we do. What is missing is units on it. |
| The `roll-single` preset is a 2" × 2" label, one per feed — **exactly the stock bought** — but its `material` sentence says "photo-anodized aluminium" | `packages/qr/src/labelSheet.ts:148-158` | The geometry was a guess that turned out right; the sentence describes stock the shop does not own (D-DE7). |

### 1.1 The hardware (A5 answered, 2026-10-27)

| Item | What it is | What it means here |
|---|---|---|
| **MUNBYN Bluetooth thermal label printer** (4×6 class, grey) | **Direct thermal** — no ribbon; prints by darkening heat-sensitive paper. Bluetooth + USB; drivers for Windows, Mac, Android, iOS. | Prints the `roll-single` PDF from the office PC at **Scale 100 % / Actual size, paper 2 × 2 in**. |
| **2" × 2" direct thermal labels, 1" core, 750/roll ×4** | Paper face, permanent adhesive | Right for shelves, bins, tool crib, the tablets' backs. **Wrong for a truck's or trailer's exterior** (D-DE7). |
| **Tera Pro handheld, with screen** — 1D + 2D (QR), charging cradle | Connects by **Bluetooth**, a **2.4 GHz USB dongle**, or a **USB cable** — all three present as a keyboard (HID) | `/shop/scan` works unchanged on all three (#711's wedge reader). **It never uses Wi-Fi**; "same network" is not a mode it has. One host at a time. |
| **Android tablets (new batch)** | — | The first Android run of the I6 runbook §0. Drivers' tablets (D-DE1). |

**Which connection where.** Office PC → the **2.4 GHz dongle**: plug in, no pairing, survives a PC
restart. Android tablet or phone in the shop → **Bluetooth**, paired in Android Settings as a keyboard.
The cable is the fallback when a battery is flat.

---

## 2. Decisions

| # | Decision | Source |
|---|---|---|
| **D-DE1** | **A tablet is held by a driver; every other asset is held by a unit or a location.** Amends D-INV3 for one class of thing and leaves it standing for everything else. Which assets may be held by a driver is a property of the **asset type** (`asset_types.held_by` ∈ `unit`, `driver`; default `unit`), not a list of names in code — the shop's own "Tablet" type is set to `driver`, and a second driver-issued thing later (a phone, a fuel-card holder) is a setting rather than a release. A driver-held asset can never also sit in a truck: the holder CHECK stays "at most one". | Owner 2026-10-27 |
| **D-DE2** | **`inventory_holder_is_ours` learns a driver.** Re-issued with a `p_driver_id` argument (old signature dropped in the same migration, every caller re-issued), so "is the named holder this org's" keeps exactly one spelling. A DESTINATION driver must be `active` or `on_leave`; a `from_` driver need only be ours — the same asymmetry `p_active` already draws for bays. `move_asset` refuses a driver holder for a `held_by = 'unit'` type and a unit holder for a `held_by = 'driver'` type (`IV025`). | Follows from D-DE1 |
| **D-DE3** | **"Not returned" is derived, never stored.** A driver-held asset whose holder's status is `terminated` or `inactive` reads as *not returned* — on the asset, on the driver's page, and as a count on the shop home. Returning it is an ordinary movement back to a stock location, which clears the flag by construction. No scheduler, no status column, nothing to fall out of date. `on_leave` keeps the tablet and is not flagged. | Owner 2026-10-27 ("flag not returned") |
| **D-DE4** | **A tractor's kit counts its driver's tablet.** The kit check (I9) counts assets held by the unit, **plus** driver-held assets held by the unit's `vehicles.assigned_driver_id` — the same inference D-INV3 already uses to show the driver. So truck 654's "Tablet 1 of 1" stays true when the tablet is the driver's, and goes short when the truck has no driver or its driver has none. The kit catalogue line stays; nothing about kit expectations is migrated. | Resolves §1's conflict |
| **D-DE5** | **Trucks and trailers get tag kinds `VEH` and `TRL`.** Codes live in a new maintenance-owned table, `unit_tags` (org, `vehicle_id` xor `trailer_id`, `tag_code`, issued_at) — **not** a column on `vehicles`/`trailers`, whose writers are the Samsara and McLeod syncs and whose `status` is already restated 17 times. A new table is exempt from the migration-ordering split, needs no `merge_driver` entry, and keeps the immutability rule `inventory_assets.tag_code` has (re-stamp refused, `IV022`). Scanning one opens the unit's page with its kit card — the "digital truck file" §2.10 named. | Owner 2026-10-27 ("trucks and trailers will have QR codes") |
| **D-DE6** | **A unit's label reads as its unit number.** Big `654`, the QR, the six-character code below it. The unit number is what a person says out loud in the yard; the code is for the radio when the symbol is fogged (D-INV18's reasoning, applied to units). | D-INV18 |
| **D-DE7** | **The label screen states what each stock survives.** `roll-single` is renamed for what the shop bought (*Roll — 2" square, direct thermal*) and its material sentence becomes the truth: indoor only — fades in sunlight, darkens in a closed cab's heat, so not on a cab dash or a trailer's skin. Units' labels default to a preset that warns until Q-DE2 is answered. | §1.1; A5 |
| **D-DE8** | **Every action is one scan and at most one choice.** Give a tablet: scan → *Give to driver* → pick the driver → saved. Take one back: scan → *Return to shop* → saved. Truck: scan → its page. The owner's bar ("simple to use, but precise and reliable") is held by the same machinery the shop's verbs already use — client-generated movement ids (D-INV27) so a retried tap never moves a tablet twice, and the ledger as the only truth (D-INV4) so "who has tablet A-0412" always has a dated answer. | Owner 2026-10-27 |

---

## 3. Steps

Numbered on from the inventory plan's I13; I14 moved to its own plan.

### DE0 — Hardware check and the label fix — *no migration*
- `roll-single` → name and material per D-DE7 (`labelSheet.ts`); the 2 × 2 geometry is unchanged.
- I6 runbook §0 gains an **Android** column: the on-screen keyboard is hidden while a HID keyboard is
  paired (Android: Settings → keyboard → *Show on-screen keyboard while physical keyboard is active*);
  Chrome on Android does deliver keydown to an unfocused page, which is the question iOS left open.
- **Done when (a person):** a 2 × 2 roll printed from `/shop/labels` on the MUNBYN scans back through
  `/shop/scan` on the office PC (dongle) and on an Android tablet (Bluetooth), the tablet installed to
  the home screen; §0's seven answers signed. **This also closes I10.**

### DE1 — Driver-held assets: schema — *next-numbered migration*
- `asset_types.held_by` (`unit`|`driver`, `not null default 'unit'`).
- `inventory_assets.driver_id`, `asset_movements.from_driver_id` / `to_driver_id` → `drivers(id)`;
  holder CHECKs widened to four columns, still `<= 1`.
- `inventory_holder_is_ours` re-issued with the driver (D-DE2); `move_asset`, `rebuild_asset_holders`
  and the three guards re-issued to pass it; `IV025` raised for the wrong kind of holder.
- `DRIVER_REASSIGNMENTS` gains the three columns **in the same PR** — `lint:driver-references`
  requires it. (This line first said "so it ships in DE2"; the two halves contradicted each other,
  and so did the two gates — see the 0524 entry in §6.)
- Matrix: a tablet given, returned, refused to a truck, refused to another org's driver, refused to a
  terminated driver; a chain refused to a driver; append-only still holds.

### DE2 — Driver-held assets: API and screens — *no migration*
- Verbs `give` (to an active driver) and `return` (to a stock location) through `move_asset`; the
  Assets drawer offers *Give to driver* only for a `held_by = 'driver'` type (read from the type,
  never from the name).
- Driver page: an **Equipment** card — the tablet, its tag, since when, and the *Not returned* badge.
- Shop home: a *Tablets not returned* tile, counted server-side (never a page total — the I0–I3
  audit's third defect).
- `/shop/scan`: a driver-held tablet's card names the driver and offers *Return to shop*.
- Kit check counts the assigned driver's tablet (D-DE4).
- Asset Types drawer: the *Held by* setting; the Tablet type set to `driver` once, by the owner.

### DE3 — Unit tags: schema — *next-numbered migration (new table)*
- `unit_tags` per D-DE5, RLS enabled, no client policy; immutable `tag_code`; one tag per unit.

### DE4 — Unit tags: issuance, resolver, labels — *no migration*
- `VEH`/`TRL` in `TAG_KINDS`; two resolvers; issuance on `tagIssuance.ts`'s model.
- `/shop/labels`: a third segment, **Trucks & trailers**, picking by unit number; the face per D-DE6.
- Scanning a unit tag opens the vehicle page (trailers: Q-DE3).

---

## 4. Open questions

| # | Question | Candidates | Recommendation |
|---|---|---|---|
| **Q-DE1** | Does a driver sign when given a tablet? | (a) No signature — Q7 stands; a dispute gets an `esign_consents`-shaped acknowledgement on the movement row. (b) A tap-to-acknowledge in the driver app at handover. (c) A paper form scanned into the driver file. | **RULED 2026-10-27: none in the product.** Drivers already sign a paper hand-receipt for a tablet; the paper is the signature and the dated movement row is ours. No signature step is built. |
| **Q-DE2** | What goes on the OUTSIDE of a truck or trailer? | (a) Inside the cab (door jamb) on the direct-thermal roll — cheapest, fades within months. (b) **Pre-printed vinyl or aluminium QR plates from a vendor**, printed from our PDF, priced per plate for ~450 units (not yet quoted). (c) A thermal-TRANSFER printer with polyester labels (~$300 printer + ribbon). | **DEFERRED 2026-10-27: (b), ordered later by the owner.** Nothing is built for it: a vendor prints from the same PDF DE4 produces. Until then no unit label goes outside. |
| **Q-DE3** | Where does a scanned trailer land? There is **no trailer detail page** (`/trailers` is a list — inventory plan, I9 findings). | (a) A trailer detail page with its kit card. (b) The trailer list filtered to it. | **DEFERRED 2026-10-27: (a), planned separately later.** The owner will plan the truck and trailer pages on their own; DE3–DE4 wait for that plan. |
| **Q-DE4** | ~~How does the parts catalogue get in?~~ | — | **MOVED OUT 2026-10-27 — a shop-inventory question, asked here by mistake (§0).** The owner's answer: shop inventory is pulled from FleetPal (`FLEETPAL-INTEGRATION-PLAN.md` F12). Truck inventory is entered here and nowhere else. |

---

---

## 5. Production readiness of truck inventory and the shared devices (audit 2026-10-27)

Production on 2026-10-27: **0 asset types, 0 assets, 0 tags printed**, and **4 unit checks left open
on one truck** (opened 09-10 ×2, 10-15, 10-19, none closed). Permissions are right
(`admin`/`fleet_manager`/`technician` manage; `auditor`/`accountant` view) and every movement is
idempotent (one client id per drawer, D-INV27). The tablet path works end to end.

⚠ The audit was first written over both inventories (§0). The **Inventory** column now says which one
each finding is about: **Truck**, **Shared** (the scanner or the label screen — the devices both
inventories use), or **Shop**. Shop findings were fixed where a shared PR already touched them, and
are filed with the FleetPal plan from here on; R1 moved there outright.

| # | Inventory | Finding | Evidence | Fix | Step |
|---|---|---|---|---|---|
| **R1** | Shop | ~~No way to load a parts catalogue except one part at a time.~~ **Moved out (§0):** shop parts come from FleetPal. | `PartsPage.vue:72` | `FLEETPAL-INTEGRATION-PLAN.md` F12 | — not this plan |
| **R2** | Shared | **Scanning the same label twice does nothing** — the query key is the code, so an unchanged code never asks again; the second scan shows the old quantity, and after a wifi failure a re-scan leaves the error up. Contradicts `useScan.ts:16-21`'s own promise. | `ScanPage.vue:66-68`, `useScan.ts:25` | A scan counter in the key | PR-R1 |
| **R3** | Shared | **A misread tag offers "Create a part with this barcode"** — a colon lost to a keyboard layout (`SIL1;BIN;…`) or a tablet's IMEI barcode becomes a part's UPC. | `ScanResultCard.vue`, `PartForm.vue` `initialUpc` | Never offer create for a `SIL1`-shaped string; say "label misread — check the scanner's keyboard layout" | PR-R1 |
| **R4** | Shared | **Typing the code printed under a QR finds nothing** — the resolver takes only a full `SIL1:` tag or a UPC, so a fogged label read aloud is "Not recognised". | `tags/routes.ts:58-87` | Resolve a bare 6-character code and an `A-0412` display number | PR-R1 |
| **R5** | Shared | **A database error during a scan reads as "not our label".** | `tagResolvers.ts:13,25` → `routes.ts:70` | An error with Retry, never `unknown_tag` | PR-R1 |
| **R6** | Shared | **The Labels screen forgets the stock and defaults to Avery 22805** — a forgotten switch sends a Letter page to the thermal printer; for the roll it still shows "Start at position 1 to 1" and sheet advice. | `LabelsPage.vue:65`, `LabelStockControls.vue:89-131` | Remember the choice; hide sheet-only controls for a one-label stock | PR-R2 |
| **R7** | Truck | **No "Print label" on an asset's page**, though the Labels screen already takes `?asset=`. | `LabelsPage.vue:149-159` | The button | PR-R2 |
| **R8** | Truck | **The same serial number can be entered twice** — two records, two labels, one tablet. | `0333:234` (plain index) | Partial unique index per org on a non-empty serial | PR-R3 (migration) |
| **R9** | Truck | **Open checks can't be found or closed**; "Check this unit" always opens a new one. | `UnitDetailPage.vue:75-83`; `useCountSessionsQuery` unused | Resume the open check for that unit; an "Open counts" list with Close | PR-R2 |
| **R10** | Truck | **Adopting the standard kit marks every unit "short"** for weeks while tagging is under way. | `inventoryRules.ts:122`, `inventoryKitCatalogue.ts:78-95` | Count only units checked at least once, and say so on the tile | PR-R2 |
| **R11** | Shared | Tab-terminated scans into the "Type a code" field are lost; the keyboard hint is iOS-only. | `ScanPage.vue:149` | Submit on Tab; Android wording | PR-R1 |
| **R12** | Shared | Issue/Receive/Create show to view-only roles, who then get a 403. | `ScanResultCard.vue` | Gate on the section's manage | PR-R1 |
| **R13** | Shop | `part_stock.tag_code` has no immutability trigger (owed since I10). | `0331:188`; `tagIssuance.ts:116` | The trigger `inventory_assets` has | PR-R3 (migration) |

**Order:** PR-R1 (scan) and PR-R2 (labels, checks, kit tile) need no migration and make the devices
reliable; PR-R3 is one migration. **All three are merged (§6); every truck and shared finding is
closed.** There is no PR-R4 — it was R1, which is the shop's. **DE0's physical check** (§3) is the
proof none of this replaces — the scanner on an Android tablet, and a printed roll label scanned back.

## 6. Progress log

- **2026-10-27 — plan written.** Owner rulings: tablets follow the driver, everything else the truck;
  a departed driver's tablet is flagged *not returned*; the tablets are Android; trucks and trailers
  get QR labels; everything is tagged. Hardware per §1.1.
- **2026-10-27 — owner answered Q-DE1–3 and set the order.** Q-DE1: drivers already sign a paper
  receipt, so nothing is built. Q-DE2 and Q-DE3: deferred — exterior plates are ordered later, and
  the truck and trailer pages get their own plan. **DE3–DE4 are parked behind that plan.** The order
  now: **DE0** (the printer and scanner working on the PC and the Android tablets), then a
  production-readiness pass over the inventory section as built (I0–I10), then **DE1–DE2** (tablets
  held by drivers). The owner's words: *"focus on implementing these devices and making sure our
  inventory is 100 % production ready."*
- **2026-10-27 — production-readiness audit (§5).** R1–R13: tablets work end to end, a parts
  catalogue cannot be loaded at scale, and the scan screen has four reliability defects. Next: PR-R1,
  then PR-R2.
- **2026-10-27 — PR-R1 merged (#1782):** R2, R3, R4, R5, R11, R12.
- **2026-10-27 — PR-R2 split in two.** **PR-R2a** (web only): R6 — the Labels screen opens on the
  stock this browser last chose, else the 2" roll, and checks a remembered id against what the API
  offers; for a one-label stock the start position and the sheet advice are gone, the dialog advice
  names the paper size, and a start position the new stock lacks goes back to 1 (it was a 422).
  R7 — "Print label" on an asset's page, gated on the Labels screen opening (SP5). **PR-R2b** carries
  R9 and R10, which touch the API.
- **2026-10-27 — PR-R2b (R9, R10).**
  - **R9:** "Check this unit" asks the server, which hands back the unit's open check (newest, 200 +
    `resumed`) instead of inserting another; the screen says "Continuing the open check". Shelf walks
    are not folded (a D-INV21 recount is a second person's walk of the same bay). The shop home and
    each unit's page list the open walks (`OpenCountsList`) with Continue and Close; Close asks first.
    The four orphaned production checks are reachable from the home now.
  - **R10:** `UnitKitDto.lastCheckedAt` = newest closed unit check. The home's "Short of kit" counts
    only short units with one, says so, and links to the Units page's new "Short, and checked" filter;
    the Units list gets a "Last checked" column and the unit page "Never checked — …".
  - **Owed to PR-R3:** resume is a read then an insert, so two people pressing at the same instant can
    still open two. R3's migration adds a partial unique index on the open unit check per vehicle and
    per trailer — and must first close all but the newest of any duplicates already open (production
    holds four on one truck unless they are closed from the list before the release).
- **2026-10-27 — R2a #1787 and R2b #1789 merged.**
- **2026-10-27 — PR-R3 (migration 0522: R8, R13, the R9 race).**
  - **R8:** unique `(org_id, lower(btrim(serial_number)))` where the serial is non-blank. The API
    maps its 23505 to `duplicate_serial` (409) by the index name. Production had 0 duplicates.
  - **R13:** `trg_part_stock_tag_once` refuses changing or clearing a shelf line's `tag_code` once
    set (`IV022`, the asset rule).
  - **The R9 race:** one open unit check per vehicle and per trailer (two partial unique indexes); a
    losing insert's 23505 is answered with the winner's walk. Before the index, the migration closes
    every older duplicate open unit check — never deletes — keeping the newest, with a note saying
    why. Production: one truck, four open checks → the three older close.
  - Matrix `inventory-integrity.test.mjs` applies 0522 AFTER seeding duplicates on 0521's schema.
- **2026-10-27 — PR-R3 merged (#1790).**
- **2026-10-27 — owner ruling: two separate inventories (§0).** Shop inventory (parts) is pulled from
  FleetPal; truck inventory (equipment, and tablets held by drivers) is ours alone. This plan had
  mixed them: it listed R1 (bulk parts loading) as a truck-inventory blocker and asked Q-DE4. R1 and
  Q-DE4 are moved to the FleetPal plan; §5 gains an Inventory column; `INVENTORY-PLAN.md` D-INV6 is
  marked superseded. Of what shipped today, R13 and the Labels screen's shelf half were shop-side
  fixes riding shared PRs — harmless, and not a precedent. **Next: DE1** (tablets held by drivers,
  schema), then DE2.
- **2026-10-27 — DE1 (migration 0524, schema only; no reader ships).** `asset_types.held_by`
  (`unit` default | `driver`); `inventory_assets.driver_id`, `asset_movements.from_driver_id` /
  `to_driver_id`, all `on delete restrict`; the three holder CHECKs widened to four columns.
  `inventory_holder_is_ours` re-issued with `p_driver` (five-argument signature dropped) and all five
  callers re-issued onto it — 0333's three guards, 0332's count-session guard, 0334's FleetPal unit
  match. `move_asset` and `rebuild_asset_holders` carry the driver. Matrix
  `inventory-driver-held.test.mjs` (49 checks; 16 mutants of the migration, every one killed by an
  assertion). Three things the step text did not say:
  - **The asset row asks "ours"; only a creation and the movement ask "open".** 0333's asset guard
    asked "ours and open" on every write, which would have refused a note on a not-returned tablet
    (its driver has left — D-DE3's own row) and a roster merge onto a terminated surviving record.
    Every holder change still meets "open" through the ledger row's guard in `move_asset`.
  - **IV025 is raised once, by the asset guard**, plus a guard on `asset_types` refusing a `held_by`
    switch while the type's assets sit with the other kind of holder. Not a third copy in
    `move_asset`: it could never change an outcome.
  - **The ledger's append-only guard lets a merge move the two driver columns** (0236's model,
    compared as jsonb minus those two so later columns are frozen by default), and only to a driver
    of the same org. The matrix drives the REAL `DRIVER_REASSIGNMENTS`: with the entries the tablet
    and its history follow the surviving record; without them the merge aborts (`23001`).
  - **Two gates had no order that satisfied both.** `lint:driver-references` requires a new driver
    FK in `DRIVER_REASSIGNMENTS` in the same merge; `lint:migration-ordering` refused the same merge
    because the list names the new columns. The list is not a read — `merge_driver_v2` validates each
    name and refuses the whole merge (`MD020`) before writing — so the ordering gate now skips
    `mergeDriver.ts` (cost: a roster merge refused for the minutes of a staging deploy; none in
    production, where migrations go first). Also fixed: the driver-references parser ran each
    `alter table` match past its own `;`, which reported `asset_types.driver_id`; its self-test now
    pins that.
  - **Owed to DE2:** the round trip of every new column — `driverId` on the asset DTO, the movement's
    `fromDriverId`/`toDriverId`, `heldBy` on the type — per the I0–I3 audit's first defect.
- **2026-10-29 — DE2 split in two, and DE2a built (API only; no migration, no screen).** DE2 is the
  setting, the verbs, the driver card, the count and the kit rule at once — too much for one review — so
  **DE2a** is everything below the screens and **DE2b** is the screens. Nothing in DE2a is reachable
  from the UI, so no dead end ships: the *Held by* setting and *Give to driver / Return to shop* arrive
  together in DE2b, as this plan's DE2 line requires. DE2a:
  - **The round trip owed since DE1.** `HOLDER_KINDS` gains `driver` (D-INV3's pin test rewritten to the
    amended rule); `ASSET_COLUMNS` reads `driver_id` + `drivers(full_name, status)`; `holderOf` makes a
    `driver` holder named for the driver; movements read `from_driver_id`/`to_driver_id` as `driver` ends.
  - **D-DE3** as `holder.notReturned`, from `driverHasLeft` (`DRIVER_LEFT_STATUSES` = inactive,
    terminated — said once in the contract). `GET /assets?notReturned=true&limit=1` → `total` is the
    *Tablets not returned* count, made by the database; `?driverId=` is the driver card's list.
  - **Verbs:** `toDriverId` on `assetMovementInputSchema` (one holder at a time now counts four);
    `move_asset` already read it (0524). `IV025` and a driver-worded `IV012` are sentences, 409/422.
  - **Setting:** `heldBy` on `assetTypeInputSchema`; `updateAssetType` writes `held_by` and words 0524's
    `guard_asset_type_held_by` refusal as what to move first (`held_by_conflict`, 409).
  - **D-DE4:** `listUnitKits` counts each truck's assigned driver's driver-held things
    (`driverHeld.ts`: two fleet-wide reads, chunked); `getUnitKit` lists them among what the truck carries.
  - Found on the way, fixed: `duplicate_imei` (M9b) was missing from `httpStatus.ts`, so a tablet scanned
    in twice answered **500**; `?unassigned=false` meant true (`z.coerce.boolean`), now a strict flag; and
    `unassigned` was three IS NULLs, which would have called every driver's tablet loose.
  - Tests: `driverHeld.test.ts` (16; 16 mutants, all killed). **Next: DE2b** — the screens.
- **2026-10-29 — owner: "proceed as proposed"** on DE2's open point. **The Tablet type is driver-held**
  (D-DE1 confirmed), set once through DE2b's *Held by* setting, not by a migration or a catalogue
  change — `inventoryKitCatalogue.ts`'s Tablet line stays a kit line (D-DE4 counts it through the
  driver). The owner wants the tablet PRs (M9c, DE2a, DE2b) released as soon as DE2b merges.
