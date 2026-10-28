# Maintenance section — redesign and reorganisation proposal (2026-10-27)

Owner's brief, verbatim: *"Annual inspections pages are only good. All other pages are unclear,
confusing, with some unnecessary UI/UX complications. We should have these pages super easy to use
and really optimized for work on tablets and phones. Wording used for items here is not really for
some regular non-technical user. … at the moment we have a bunch of pages without any purpose."*

This document is a proposal, not a plan with steps already agreed. §4 is the recommendation, §6 the
questions only the owner can answer, §7 says which earlier rulings it would replace. Nothing here is
built.

---

## 0. The recommendation in one paragraph

The section is organised by **table** (parts, assets, units, inspectors, work orders, defects…) when
the shop has **three jobs**: *what needs doing today*, *everything about one truck or trailer*, and
*the annual inspection*. Reorganise the sidebar to those three doors — **Shop**, **Trucks &
trailers**, **Annual inspections** — make the Shop home a single worklist of things with a deadline
or a missing piece, make the truck's page the hub that every other fact hangs off (which is what
FleetPal step F10 already describes), rename every data-model word to the word the shop says out
loud, and write the phone/tablet rules the design contract does not yet have (48 px targets, a
bottom action bar, three facts per card, no desk-only screens in the phone nav). Parts stays hidden
until FleetPal supplies the catalogue (owner ruling 2026-10-27, F12). No migration is needed for any
of it; the surface **keys** never change, only their labels and which ones sit in the sidebar.

---

## 1. What exists today (measured on `origin/main` 1533e34 and on staging, 2026-10-27)

### 1.1 Fourteen screens behind six sidebar rows

| Sidebar row (key) | Screens reached from it | Production rows behind it |
|---|---|---|
| **Shop** (`maintenance.repair-spend`) | home · Open work orders · Open defects · Roadside repairs due · Repair spend · Scan · Labels · Count | FleetPal: work orders, 69 open defects, 505 units, 146 k meters, 4.3 k PO invoices · 1,411 roadside inspections, 160 repairs |
| **Parts** (`maintenance.parts`) | list · part page · shelf count | **0 parts, 0 shelves, 0 movements** |
| **Assets** (`maintenance.assets`) | list · asset page · Asset kinds drawer | **0 assets, 0 asset types** |
| **Units** (`maintenance.units`) | list (479 incl. sold) · unit page · Kit rules drawer · unit check | 0 kit expectations · 4 orphan open checks (DE plan §5) |
| **Annual inspections** (`maintenance.inspections`) | list · form · Annual dates to check | **123 inspections, 6,888 checklist items** — the one surface in real use |
| **Inspectors** (`maintenance.inspectors`) | register | 1 inspector |

Roles: `admin` and `fleet_manager` manage, `auditor` views, every other role has no section
(`packages/shared/src/auth.ts`). The user the owner describes — one Chicago maintenance employee —
is a `fleet_manager` or `admin` on a tablet, not a `technician` role.

### 1.2 What a tablet and a phone actually show (staging, fleet-manager login, Playwright)

Method: signed in as the staging fleet manager, every `/shop*` route at 390 × 844 (phone) and
834 × 1194 (tablet), full-page screenshot plus a DOM measurement of every visible button/link/input.
"Small" = shorter or narrower than 40 CSS px (Apple's floor is 44 pt, Android's 48 dp).

| Page (phone) | Visible targets | Under 40 px | Page height | What the screen says |
|---|---|---|---|---|
| Shop home | 9 | 6 | 869 | Two zeros ("Open work orders 0", "Open defects 0"), an empty roadside card, a callout "No parts on the shelves yet" |
| Units | 32 | 31 | **4,435** | 20 cards, each "506 - SOLD · Missing — · Kind Truck · Kit Nothing expected yet · Last checked Never" |
| Labels | 12 | 11 | 1,188 | A greyed Print button, a stock picker, "Nudge right / Nudge down … Points. Negative moves left" |
| Assets | 11 | 10 | 844 | "Set up the kinds of thing under Asset kinds first" |
| Parts | 10 | 9 | 844 | "No parts yet" |
| Scan | 1 | 1 | 908 | "Pull the trigger on the scanner" — correct, and the only phone-shaped screen |
| Work orders / Defects / Inspectors / Annual dates / Repair spend | 6–10 | all but one | 844 | an empty list each |

On the tablet the same pages render the desktop layout with the sidebar collapsed behind a
hamburger: the six rows are invisible, every page shows "Back" **and** a breadcrumb that both go to
Shop, and the home is three cards and a callout above 60 % empty screen (the exact finding of the
2026-09-10 critique, back again because production has no parts).

### 1.3 The words a non-technical user meets

Pulled from the templates (`apps/web/src/pages/*.vue`), these are the nouns and verbs on screen:
*Units · Kit · Kit rules · Short of kit · Nothing expected yet · Assets · Asset kinds · Stock ·
Stock locations · Reorder point · Ledger rows since midnight · Moved today · Register · Reinstate ·
Retire · Qualified by · Label stock · Nudge right · Points. Negative moves left · Avery 22805 ·
Annual dates to check · The board would read it differently · Repair spend is not classified yet:
McLeod AP repair d… · 49 CFR 396.9(d)*. Five of them are table names (`units`, `assets`,
`asset_types`, `stock_locations`, `kit_expectations`) with the underscore removed. "Kit" alone
appears in four different labels and is not a word a driver or a shop manager uses for "the straps
and chains this truck should carry".

### 1.4 Why it got this way (so the fix is to the cause)

- **Built table by table.** INVENTORY-PLAN I4–I10 shipped one screen per table and I4's ruling fixed
  the sidebar at six rows, so each later feature (work orders, defects, roadside repairs, annual
  dates, labels, scan, count) became a non-nav child reached from a tile. Fourteen screens, three jobs.
- **Two inventories on one home.** The owner ruled on 2026-10-27 that shop inventory (parts, from
  FleetPal) and truck inventory (equipment, ours) are separate. The home still gates its four
  inventory tiles and both lists behind "does the org have a part" (`firstRun`), so with zero parts
  the whole truck-inventory half disappears too.
- **The design contract has no phone or tablet section.** `docs/DESIGN-SYSTEM-CONTRACT.md` mentions
  no breakpoint, no target size, no bottom bar; the only phone rule in the product is `DataTable`'s
  card mode below 768 px, which is why Units becomes a 4,435-px column of five-line cards. The shop
  research (`INVENTORY-UX-RESEARCH.md` §5) wrote the rules a year of work ago; none were adopted into
  the contract, so no gate holds them.
- **Copy written from the model's side.** The house voice ("plain word leads, industry term in the
  hover" — the fleet-report register rule) was applied to finance and not here.

---

## 2. What the clean products do the same (research, 2026-10-27)

Looked at: Fleetio Go, Whip Around, Samsara Connected Maintenance, UpKeep, plus the earlier
INVENTORY-UX-RESEARCH (Sortly, Shelf, Cheqroom, Lightspeed, Shopify). The things they agree on:

1. **The home is "what needs doing", with the verbs on top.** Fleetio Go opens on shortcuts —
   *Scan Barcode · Start Inspection · Create Issue* — then widgets by permission: *Inspections
   (Start/Resume) · Repairs in Progress · Work Orders*. UpKeep's home is *past due · high priority ·
   bookmarked* work orders. Nobody shows a counter without the list under it.
2. **The asset page is the hub.** Samsara's Maintenance → Status is one row per asset: open defects,
   active faults, upcoming preventive maintenance, and a work order is created *from* a defect with
   the defect pre-filled. Whip Around: "see all existing defects for each asset in one place".
3. **Three words, used consistently: defect, work order, due.** Whip Around and Samsara both say
   *defect* (what an inspection found), *work order* (the repair), *due* (preventive). None says
   *unit*, *asset kind*, *kit* or *ledger* to a mechanic.
4. **Phone-first means complete, not a subset.** The single most repeated complaint across Fleetio,
   Cheqroom and UpKeep reviews is a mobile app that cannot finish the job the desktop can. Coast's
   review of UpKeep names the opposite: "large buttons and a straightforward layout that doesn't
   overwhelm you with options" is why technicians who "don't use technology often" use it.
5. **A persistent bottom bar, offline inspections, one back.** Fleetio Go's menu "is permanently
   fixed on every page"; inspections complete without signal and submit later.

What they get wrong and we should not copy is already in `INVENTORY-UX-RESEARCH.md` §6
(configuration-first products, forced due dates, status changes that silently change custody).

Sources: [Fleetio Go home screen](https://help.fleetio.com/fleetio-go/navigate-the-fleetio-go-home-screen),
[Fleetio Go release notes](https://help.fleetio.com/en_US/fleetio-go-release-notes),
[Whip Around for mechanics](https://whiparound.com/role/mechanic/),
[Whip Around work orders](https://help.whiparound.com/en/articles/7219995-work-orders-overview),
[Samsara work orders](https://kb.samsara.com/hc/en-us/articles/32504504318989-Work-Orders-for-Maintenance-Management),
[Samsara maintenance status](https://kb.samsara.com/hc/en-us/articles/360042885132-Maintenance-Status),
[UpKeep on Google Play](https://play.google.com/store/apps/details?id=com.onupkeep&hl=en_US),
[Coast's UpKeep review](https://coastapp.com/blog/upkeep-review/),
[Coast's 2026 work-order app roundup](https://coastapp.com/blog/work-order-apps/).

---

## 3. Principles for the rebuild (proposed as D-MX1–D-MX6)

| # | Principle | Why |
|---|---|---|
| **D-MX1** | **Three doors, named for jobs:** Shop · Trucks & trailers · Annual inspections. Everything else is reached from one of them. | Fourteen screens for three jobs is the "overcomplicated for no reason" the root CLAUDE.md describes. Fleetio, Samsara and UpKeep each open on the job, not the table. |
| **D-MX2** | **No counter without its list.** A number on the home is the head of the list under it, or it is not on the home. | The 2026-09-10 critique found the home 60 % blank under three tiles; it is back to that on production today. |
| **D-MX3** | **The truck's page is the hub.** Repairs, defects, PM due, annual inspection and expiry, equipment it carries, roadside violations — one page, sections, no tabs. | FleetPal F10 already specifies this page and the surface exists (`/shop/units/:kind/:id`). Samsara's per-asset status row is the same idea. |
| **D-MX4** | **Plain word leads, model word nowhere.** A screen uses the word the shop says out loud; the data-model word stays in code and comments. One glossary (§4.4) is the source. | The fleet-report register rule, applied to this section. |
| **D-MX5** | **Phone and tablet are the primary size.** 48 px targets, the two verbs in a bottom bar, three facts per card, lists open filtered to what needs attention, and no desk-only screen in the phone navigation. Written into the design contract as a section with a gate. | The owner's brief; the research's platform floors (§5 of INVENTORY-UX-RESEARCH); the contract has no such section today. |
| **D-MX6** | **Surface keys never change.** A rename is a label change in `surfaceCatalogue.ts`; moving a screen out of the sidebar is a `parent:` edit. | A key is the primary key an override is stored against (S3/S4); production carries live denials on `maintenance.repair-spend`. |

---

## 4. The proposal

### 4.1 The sidebar: six rows become three

| Today | Proposed | How |
|---|---|---|
| Shop | **Shop** — the worklist (§4.2) | key unchanged |
| Units | **Trucks & trailers** — every active unit, its page is the hub (§4.3) | label change on `maintenance.units`; sold units (`tractor_status I`) excluded by default |
| Annual inspections | **Annual inspections** — unchanged, it is the reference | — |
| Parts | hidden from the sidebar until FleetPal F12 lands the catalogue; the key stays so a later un-hide restores every override | `parent: "maintenance.repair-spend"`, no sidebar row |
| Assets | **Equipment**, reached from Shop and from a truck's page, not a sidebar row | `parent: "maintenance.units"` |
| Inspectors | **Who can inspect**, a button on the Annual inspections header that opens the register | `parent: "maintenance.inspections"` |

Work orders, Defects, Roadside repairs due, Repair spend, Labels, Scan, Count and Annual dates stay
non-nav exactly as they are keyed; what changes is that each is a row *inside* the Shop worklist or
the truck's page rather than a tile with a number on it.

### 4.2 The Shop home becomes one worklist

One page, one list, grouped by urgency, every row = **unit number · one plain sentence · one
action**. Groups, in order, each present only when it has rows:

1. **Must be fixed by a date** — roadside violations with their 15-day certification deadline
   (today's "Roadside repairs due"; the deadline is the row's sentence: *"654 · brake hose — certify
   by 11/02"*). Action: *Record the repair*.
2. **Found on an inspection, not fixed** — FleetPal's open defects, oldest first. Action: *Open in
   FleetPal* (they are worked there, by the owner's own description on the page).
3. **In the shop now** — FleetPal's open work orders. Same action.
4. **Annual inspection due within 30 days** — from the expiry the annual-inspection feature already
   projects onto the truck (certifications). Action: *Start inspection* — the one verb that is ours.
5. **Equipment not returned** — a tablet held by a terminated driver (D-DE3, derived). Action:
   *Mark returned*.
6. **Checks left open** — the four orphan unit checks (R9's list). Action: *Continue* / *Close*.

Above the list, two verbs only, and on a phone they sit in a bottom bar the thumb reaches: **Scan**
and **Check a truck**. "Count a shelf" moves to Parts and returns with it. The low-stock, moved-today
and kit tiles are retired from the home: low stock and moved-today are shop-inventory facts that
belong on Parts when FleetPal supplies it; "short of kit" becomes rows in group 5's neighbour
("missing equipment", once a unit has been checked) rather than a tile over a table.

An empty group is not drawn, so a quiet day is a short page that says *"Nothing waits on the shop
today"* and two buttons — not three zeros and a callout.

### 4.3 Trucks & trailers: the list and the hub page

**The list** opens filtered to *needs attention* (anything with a row in §4.2) with a one-tap switch
to *all*. On a phone a card is three facts: unit number, the one sentence that put it on the list,
and when it was last checked. Sold units are out by default; "Kind", "Kit" and "Missing —" go.

**The page** is FleetPal step F10, built: sections in this order — *Needs attention* (its rows from
§4.2) · *In the shop / repair history* (FleetPal work orders, cost split, downtime) · *Due* (PM
schedules against the latest meter, F11) · *Annual inspection* (last report, expiry, Start
inspection) · *Equipment it carries* (today's kit card, renamed, with *Check this truck*) · *Papers*
(the unit files UF0–UF3 already provide). No tabs: the driver page's six tabs are the worked example
of what tabs hide.

### 4.4 The glossary (the one place the words are decided)

| On screen today | Proposed | Note |
|---|---|---|
| Units | **Trucks & trailers** | "unit" stays in code and URLs |
| Unit (singular, a row) | **Truck 654** / **Trailer 5312** | the kind in the word, not a column |
| Kit · Kit rules · Nothing expected yet | **Should carry** · **What each truck should carry** · **Not set up yet** | |
| Short of kit · Missing | **Missing equipment** · **Missing: 2 straps** | the thing, not the count |
| Assets · Asset kinds · New asset | **Equipment** · **Types of equipment** · **Add equipment** | "asset" is an accountant's word |
| Stock · Stock locations · Reorder point · Low stock | **Show** (the filter) · **Places** · **Order when below** · **Running low** | "Shelves" was the first draft; a part's stock line was already "a shelf" ("Edit shelf"), so the places the shop keeps things are *Places* |
| Moved today · Ledger rows since midnight | **Moves today** · *(drop the sub-line)* | |
| Inspectors (register) · Reinstate · Retire | **Who can inspect** · **Put back** · **Remove** | "register" and "retire" are statutory words |
| Qualified by | **Trained as** | the register's three qualification kinds get plain names in the drawer |
| Annual dates to check · The board would read it differently | **Dates FleetPal disagrees on** · **Dispatch uses our date** | |
| Repair spend · ledger · not classified yet: McLeod AP… | **Repair bills** · *(hover: "from McLeod accounts payable")* · **Not available yet — waiting on McLeod** | |
| Label stock · Nudge right/down · Points | **Label size** · **Shift print right/down** · **mm** | a shop measures in millimetres or inches, not points |
| 49 CFR 396.9(d) (on the roadside page) | **certify within 15 days** | the house rule keeps citations in comments (D-AVI15); check this page against the inspection-challenge plan's Q-IC16 before removing |
| Count a shelf · Check this unit | **Count a shelf** · **Check this truck** | the first is already right |

### 4.5 Phone and tablet rules — a new §9 for the design contract

Proposed text, to be gated the way §5 is (`lint:ui-adoption` already parses templates):

1. Every tappable thing is at least 48 × 48 CSS px with 8 px between neighbours; row menus and
   chips included. (Today: 31 of 32 targets on the Units phone page are smaller.)
2. A page with one or two primary verbs puts them in a bottom bar below `md`, above
   `env(safe-area-inset-bottom)`; the header keeps them above `md`. `WalkActions.vue` is the
   existing primitive.
3. A card below `md` shows **three facts**: the identifier, the one sentence that explains why the
   row is here, and one date or amount. Everything else is on the row's page. `DataTable` columns
   gain a `card: "title" | "sentence" | "meta" | "none"` marker so the page states which three.
4. A list opens filtered to what needs attention, with the count of the rest one tap away.
5. One way back: the shell's Back **or** the breadcrumb below `md`, not both.
6. Screens that need a printer or a sheet of labels (Labels) are desk screens: reachable, not in a
   phone's navigation.
7. Below `md` the shell draws the three section doors as a bottom tab row (Shop · Trucks &
   trailers · Annual inspections) when the signed-in role has the maintenance section and the route
   is under `/shop`; the hamburger stays for the rest of the product.
8. The staging banner collapses to one line below `md`.

### 4.6 Every screen, and what happens to it

| Screen | Proposal |
|---|---|
| Shop home | Rebuilt as the worklist (§4.2) |
| Open work orders · Open defects · Roadside repairs due | Become groups of the worklist; the full pages stay as "all N" behind each group |
| Repair spend | Stays, renamed *Repair bills*, reached from the worklist footer and the truck's page |
| Units list · unit page | Become *Trucks & trailers* and the hub (§4.3); F10/F11 built here |
| Assets list · asset page · Asset kinds | *Equipment*, reached from Shop and the truck's page; copy per §4.4 |
| Parts · part page · Count · Stock locations | Hidden from navigation until F12; copy per §4.4 when it returns |
| Labels | Desk screen, reached from Equipment and Parts; copy per §4.4 |
| Scan | Unchanged in shape (it is the one phone-shaped screen); the result card's verbs at 48 px |
| Annual inspections · form | Unchanged |
| Inspectors | *Who can inspect*, a header button on Annual inspections |
| Annual dates to check | Stays behind Annual inspections, renamed |
| FleetPal settings | Unchanged (Settings, admin only) |

---

## 5. Steps, if the owner says yes (each its own PR, no migration in any of them)

| Step | What | Depends on |
|---|---|---|
| **M1 — Words** | The glossary (§4.4) applied to every template and `surfaceCatalogue.ts` label; sidebar rows re-parented per §4.1 (keys untouched); sold units excluded from the Units list; the CFR citation moved to a comment after the Q-IC16 check. | Q1, Q3, Q4 |
| **M2 — The worklist** | The Shop home rebuilt per §4.2, reading the six existing endpoints; the two-verb bottom bar on phones. | M1 |
| **M3 — The hub** | FleetPal F10 and F11 on the truck's page (§4.3); the Trucks & trailers list opens on *needs attention*. | M1; F11's roster writer |
| **M4 — The phone rules** | Contract §9 written and gated; `DataTable` card markers; the bottom tab row under `/shop`; 48 px on every shop target. | M2 (so the gate has a page that passes) |
| **M5 — Owner pass** | The owner opens Shop, a truck's page and an annual inspection on the real Android tablet and a phone, in the bay. Findings logged here in §8 before anything is called done. | M2–M4 on staging |
| **M6 — Parts returns** | When F12 lands the catalogue: Parts back in the sidebar with §4.4 words, Count a shelf back on the home. | FleetPal F12 |

M1 and M2 are a week of work together; M3 is the largest because F10 was never built.

---

## 6. Open questions for the owner — ALL ANSWERED 2026-10-27

| # | Question | Owner's answer (2026-10-27, in chat) |
|---|---|---|
| **Q-MX1** | Who holds the tablet? | **The maintenance employee, the in-shop workers, and the inspector** (ours, in maintenance). They use the scanner and the label printer that arrived 2026-10-27. So the verbs lead: Scan, Check what is on board, Start inspection. |
| **Q-MX2** | Hide Parts until FleetPal F12, or keep it? | **Neither — fill it.** *"We have full FleetPal access via API, why are we not populating parts in there?"* Parts stays a sidebar row and FleetPal F12 (the parts catalogue sync) moves up the queue to right after M2. Recorded in `FLEETPAL-INTEGRATION-PLAN.md`'s log. |
| **Q-MX3** | Inspectors off the sidebar? | **Yes — into Settings**, not a button on Annual inspections. It is a Settings card ("Who can inspect") with its own grant; `/shop/inspectors` redirects. |
| **Q-MX4** | The words? | **"Wording proposed is ok."** One amendment made while applying it: stock locations became **Places**, not Shelves, because a part's stock line was already called a shelf ("Edit shelf") and the two would have collided. |
| **Q-MX5** | Annual inspections due within 30 days on the worklist? | **(a) yes.** |
| **Q-MX6** | The phone bottom tab row? | **"As proposed, with the best solution."** Built for the shop section in M4; the design refresh may generalise it. |
| — | Sold trucks on the shop's lists? | No objection raised; they are excluded from Trucks & trailers (M1). |

---

## 7. What this proposal replaces, if accepted

- **INVENTORY-PLAN I4's "six rows" ruling** (Shop, Parts, Assets, Units, Annual inspections,
  Inspectors) → three rows (§4.1). The reasoning I4 gave — one row per table so nothing becomes a
  tab — is kept by making the *truck's page* the home for those tables, not tabs.
- **INVENTORY-PLAN's shop-home design** ("four tiles and two lists", 2026-09-10) → the worklist
  (§4.2). D-MX2 is the rule that stops it drifting back to tiles.
- **FLEETPAL-INTEGRATION-PLAN F10's "no new nav row"** stands; F10 and F11 are pulled forward as M3
  because the hub page is the centre of this design.
- **DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN** is untouched: D-DE1–D-DE8 and DE2–DE4 proceed as written;
  this proposal only renames what their screens say and where they are reached from.
- **D-AVI15** (no citations in visible copy) is applied to the roadside page, subject to Q-IC16.
- Nothing in `MAINTENANCE-MONEY-CONTROL-PLAN.md` changes.

---

## 7a. Second round — the owner's review after M4 (2026-10-28)

After M4 merged, the owner looked at the section again and named five things that are off. This section checks each one against what this plan and its neighbours had already decided (the honest answer is in the second column), then gives the fix. **It replaces two rulings above, said plainly:** D-MX2's *one worklist of stacked groups* (§4.2, M2) and D-MX3's *one page, no tabs* (§4.3, M3) give way to the product's own pattern — **one table per tab, every table paged**. D-MX1 (named doors), D-MX4 (plain words), D-MX5 (phone first, contract §9) and D-MX6 (keys never change) stand.

### 7a.1 What the owner said, and whether it was planned

| # | Owner, 2026-10-28 | Was it planned? (measured on `main` b1927b6) |
|---|---|---|
| R1 | *"Shop doesn't follow our flow from other pages — multiple tables on the same page instead of tabs."* | **The opposite was planned.** M2 built the home as five stacked groups (`MaintenanceHomePage.vue`: five `ShopWorklistSection` tables, no `AppTabs`), and M3 built the truck's page as seven sections on purpose ("no tabs", §4.3). Every other list in the product is tabs over one table: Annual inspections, Roadside repairs, Idling, Dispatch loads, the vehicle and driver pages. The shop is the one place that broke the pattern, and it did so by plan. |
| R2 | *"Tables are without pagination, not standardised."* | **Partly true.** The home's five groups show the first 5 rows (`PREVIEW_ROWS`) with no pager and an "All N" link to a separate page; the truck's page has four tables with no pager (`UnitEquipmentSection` ×2, `UnitRepairsSection`, `UnitPmDueCard`). The full list pages (Work orders, Defects, Parts, Equipment, …) are standard — `DataWorkspace` + `FilterBar` + `TablePagination`. No gate checks that a table is paged outside a `DataWorkspace`. |
| R3 | *"We don't have a separate Truck assignment page where we see the equipment assigned to each truck; a separate tab with the inventory list where we add and manage it; and invoices for this equipment."* | **Not planned as a page.** The pieces exist but are scattered: what each truck carries is a section on the truck's page and a "Missing equipment" filter on Trucks & trailers; the equipment list is `/shop/assets`, which M1 took **out** of the sidebar (`parent: maintenance.units`). **Invoices: not planned anywhere.** An item has `purchasedAt` and `purchaseCost` (`inventoryAssetContract.ts:218`) and nothing else — no vendor, no invoice number, no paper. `documents` cannot hold an equipment invoice (`DOCUMENT_SUBJECT_TYPES` has driver, tractor, trailer, load, organization, roadside_inspection). |
| R4 | *"Parts page not clear to me — is it something FleetPal pulls, or is it for our truck equipment?"* | **Planned, but the page never says so.** Parts is the SHOP's parts catalogue, pulled from FleetPal every hour (FleetPal F12, #1801/#1803; Q-MX2). It has nothing to do with truck equipment — the owner's own ruling of 2026-10-27 keeps the two inventories apart (`DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md`). Production shows 0 parts because the first sync has not run (Settings → FleetPal → Sync now, after the release; ≈3,558 expected). The page's header says "Everything the shop carries, and what is running low" — not where the list comes from, and not that it is managed in FleetPal. The shelf counts and "Running low" on it are ours, and FleetPal sends no quantities (D-FP11), so today they would be empty. |
| R5 | *"When adding tablets as equipment we need to scan the IMEI directly from the tablet's sticker — is it possible to use barcodes?"* | **Not planned.** Equipment has one free-text `serialNumber` and no IMEI. The scanner was built for OUR tags (`SIL1;…`); a stray IMEI barcode was treated as a misread (R3 in the driver-equipment plan). Camera scanning was deferred ("later, not now", `PRINTERS-AND-SCANNERS-PLAN.md`). **It is possible, with what we already own** — see 7a.6. |

### 7a.2 The rule that fixes R1 and R2 (contract §9, a ninth rule)

**One table per tab; every table paged.** A page with more than one list puts each list on its own tab (`AppTabs`, the tab in the URL as `?tab=`, a count in each tab's label). Every `DataTable` gets a `TablePagination` in `#footer`. The only exception is a list that cannot grow — a truck's open work orders, say — and it says so where it stands (`ui-adoption: never-paged — <why>`). Gate: `check-phone-rules.mjs` gains two detectors — more than one `DataTable` on a shop page outside a tab panel, and a `DataTable` with no pager and no marker. Each gets a fixture that must fire.

### 7a.3 The Shop page (R1, R2)

The Shop page becomes tabs, each a standard list (search, filters, pager), most urgent first. Each tab label carries its count.

| Tab | Rows | Was |
|---|---|---|
| **Defects** | Found on an inspection, not fixed (FleetPal) | home group + `/shop/defects` |
| **Work orders** | In the shop now (FleetPal) | home group + `/shop/work-orders` |
| **Roadside repairs** | Violations an officer wrote, repair due | home group + `/shop/roadside-repairs` |
| **Annual due** | Annual inspections due within 30 days or overdue | home group (Q-MX5) |
| **Repair bills** | What the books show was paid | tile + `/shop/repair-spend` |

- It opens on the first tab that has rows. On a quiet day it opens on Defects with its empty sentence.
- Scan stays the header verb (and the phone's bottom bar).
- "Missing equipment" and "Running low" leave the Shop page for the pages they belong to: Equipment (7a.4) and Shop parts (7a.5).
- The old addresses redirect to their tab (`/shop/defects` → `/shop?tab=defects`). Every surface key stays as it is (D-MX6). The four child screens already answer to the Shop's key, so access does not change.

**The truck's page gets the same treatment** (recommended — Q-MX9): a header with the truck's facts and *Needs attention*, then the tabs **Repairs · Service due · Equipment · Inspections · Papers**, each paged. It measured 3,587 px on a phone after M4; one tab at a time is a screen or two.

### 7a.4 Equipment becomes its own door: on trucks, inventory, invoices (R3)

Equipment returns to the sidebar as its own row (surface `maintenance.assets`; the `parent` comes off, the key stays — D-MX6). The doors become **Shop · Trucks & trailers · Equipment · Annual inspections**, plus Shop parts (7a.5). The phone tab row follows by itself, because it reads the sidebar. One page, three tabs:

| Tab | One row per | Shows | Does |
|---|---|---|---|
| **On trucks** (the "truck assignment" view) | truck or trailer | number · what it carries in one sentence (for example *"Tablet A-0412 (Dana Reyes), 2 load bars, fire extinguisher"*) · missing count · last checked. A tablet shows its driver, because tablets follow the driver (owner, 2026-10-27). | Opens the truck's **Equipment** tab; *Check what is on board*; filter *Missing something* / *Never checked* / kind. |
| **Inventory** | item | number · what it is · where it is (truck, driver, place) · status | **Add equipment** (verb bar), edit, move, print label, retire; filter by kind, status, where. This is today's `/shop/assets`, moved in. |
| **Invoices** | purchase | vendor · invoice number · date · total · how many items · the paper | **Add invoice**: vendor, number, date, total, the PDF or a photo, and which items it paid for. An item's page shows its invoice. |

**What the invoice needs (one migration, then its reader in a later merge — `lint:migration-ordering`):**
- A new table `equipment_purchases` (org, vendor, invoice number, invoice date, total, notes, created by), with RLS enabled. It is append-only in the evidence sense: a correction is a new row, and the old one is marked superseded.
- Items get `inventory_assets.purchase_id`, a nullable reference to the purchase; the item's own `purchaseCost` stays.
- The paper is a `documents` row, which means a new subject type `equipment_purchase` and the retention pin.
- One invoice usually covers many items (ten tablets on one bill), so the invoice is its own row rather than three fields copied onto each item.
- Optional, later: match the invoice number to McLeod's AP vouchers, the way FleetPal F9b does, so an invoice shows *"paid in McLeod on 10/02/2026"*.

### 7a.5 Parts says what it is (R4)

- **The name.** The sidebar row and page title become **Shop parts**. The header reads: *"The shop's parts catalogue, pulled from FleetPal every hour. Add and change parts in FleetPal."* A parts row shows *From FleetPal* the way a FleetPal work order does.
- **No editing here.** The page stops offering New part and Edit for anything FleetPal owns. Editing here would make a second source of truth, which the two-inventories ruling exists to prevent.
- **Shelf counting** (our places, counts and "Running low") stays hidden until the shop asks for it — Q-MX8. FleetPal has no quantities to fill it with, so today it can only show empty.
- **The Equipment page never mentions parts, and Shop parts never mentions equipment.**

### 7a.6 Scanning a tablet's IMEI (R5) — yes, with what we already have

What a tablet sticker carries: an Android tablet with a SIM slot has a sticker (on the back or on the box) printing the **IMEI as a Code 128 barcode** — 15 digits, the last one a check digit (Luhn) — and usually the serial number as a second barcode. A Wi-Fi-only tablet has **no IMEI**, only the serial, so the field is optional and the serial is scanned the same way.

1. **The handheld scanner (primary).** The Tera Pro reads Code 128, and it types what it reads like a keyboard (HID). So the *Add equipment* drawer gains an **IMEI** field (tablets only — the type says it carries one). The person clicks the field and pulls the trigger; the 15 digits land, the check digit is verified on the spot, and a bad read is refused (*"That is not an IMEI — scan the barcode marked IMEI"*). The same for **Serial**. This needs no new hardware and no camera. The scan screen also learns that 15 Luhn-valid digits are an IMEI: scanning one finds that tablet, or offers *"Add this tablet"*, instead of the misread message.
2. **The phone or tablet camera (fallback, when no scanner is near).** We already ship a barcode reader: `zxing-wasm` 3.1.4 with a live camera, used on `/apply` to read the licence's PDF417 (`features/apply/capture/`). It reads Code 128 too. A camera button beside the IMEI field opens it. It is loaded only when pressed, like `/apply`'s (≈930 KiB). Because features may not import each other's internals, the camera and reader move to a shared place (`components/` + `lib/`) first; `/apply` keeps working unchanged, and its tests prove it.
3. **Stored:** `inventory_assets.imei` (15 digits, unique per org — two tablets cannot share one), shown on the item, searchable, and printed on its label. The column ships in one merge and its reader and writer in the next.

*A tablet cannot read its own sticker with its own camera — the sticker is on its back or on the box — so the camera path is another device's, or the handheld.*

### 7a.7 The steps (each its own PR)

| Step | What | Migration |
|---|---|---|
| **M6 — Tabs and pagers** | The ninth rule and its gate (7a.2); the Shop page as tabs (7a.3); old addresses redirect; the truck's page as tabs if Q-MX9 is yes. | none |
| **M7 — Equipment door** | Equipment back in the sidebar; *On trucks* and *Inventory* tabs (7a.4); Missing equipment moves here from the Shop page. | none |
| **M8 — Shop parts words** | 7a.5: the name, the header, From FleetPal, no editing of FleetPal's fields; shelf counting per Q-MX8. | none |
| **M9a / M9b — IMEI** | M9a: the `imei` column. M9b: the field, the handheld-scanner flow, the scan screen's IMEI answer, the label line. | M9a |
| **M9c — Camera** | The shared camera reader (promoted from `/apply`); the camera button beside IMEI and Serial. | none |
| **M10a / M10b — Invoices** | M10a: `equipment_purchases`, `purchase_id`, the document subject type. M10b: the *Invoices* tab, Add invoice, the item's invoice line. | M10a |
| **M5 — Owner pass** | Moves after M6–M8, so the owner walks the pages as they will be, not as they are. | — |

### 7a.8 Questions for the owner

| # | Question | Candidates | Recommendation |
|---|---|---|---|
| **Q-MX7** | The sidebar doors: **Shop · Trucks & trailers · Equipment · Annual inspections · Shop parts** — five rows (four tabs on a phone, plus the hamburger)? | (a) five as listed · (b) Shop parts reached from Shop only, four rows | **(a)** — Shop parts is a different thing from everything else on Shop, and a door says so. |
| **Q-MX8** | Shelf counting on Shop parts (our places, counts, "Running low")? | (a) hidden until the shop asks · (b) keep it, counted by hand in our app · (c) drop it | **(a)** — FleetPal has no quantities and nobody counts shelves today; keep the built code, show nothing that cannot be filled. |
| **Q-MX9** | The truck's page as tabs (Repairs · Service due · Equipment · Inspections · Papers) with *Needs attention* above them? | (a) tabs · (b) keep one long page | **(a)** — the same rule as everywhere else, and 3,587 px on a phone. |
| **Q-MX10** | Where are equipment invoices today? | (a) paper or PDF only · (b) also in McLeod AP · (c) bought through FleetPal | Decides whether M10 later matches McLeod (b) or reads FleetPal (c); M10 itself is the same either way. |
| **Q-MX11** | Which tablets — with a SIM (IMEI) or Wi-Fi only? | (a) all with SIM · (b) mixed · (c) Wi-Fi only | If (c), M9 becomes "scan the serial" and the IMEI column is not built. |

---

## 8. Progress log

- **2026-10-27** — Proposal written from a read of `origin/main` 1533e34, production row counts
  (`supabase db query --linked`, `pg_stat_user_tables`), a staging browser pass as the fleet-manager
  test member at 390 and 834 px (26 full-page screenshots + target measurements, kept in the session
  scratchpad, not committed), and the research in §2. Not yet read by the owner.
- **2026-10-27 (evening)** — Owner: *"make these updates as proposed"*; the six questions answered in
  chat (§6). **M1 built** on `claude/maintenance-m1-words`: the glossary applied to 24 files (138
  exact-string replacements, no key changed); Equipment parented to Trucks & trailers; Who can
  inspect is a Settings card at `/settings/inspectors` with `/shop/inspectors` redirecting; sold
  and winding-down trucks excluded from the shop's unit list; the roadside page's citation moved
  into a comment. Queue after M1: M2 (worklist home) → **F12 (parts from FleetPal, pulled forward
  by Q-MX2)** → M3 (hub) → M4 (phone rules) → M5 (owner pass on the tablet).
- **2026-10-27 (night)** — **M2 built** on `claude/maintenance-m2-worklist`: the Shop home is one
  worklist of seven groups drawn only when they have rows (`ShopWorklistSection.vue`; the roadside
  section gained `hide-when-empty`), a quiet-day sentence that waits for every read to answer, Scan
  and Count a shelf rendered once in the header and once as the phone's bottom bar (`WalkActions`),
  the repair-bills figure under the list as the door to its page, and a new read
  `GET /api/maintenance/annual-due` (`readAnnualDue`, `AnnualDueDto`) for the annual group — due
  within 30 days or overdue, by our record, through the same `inspectionExpiry` the roster uses.
  The six tiles, the first-run callout and the "Moved today" count are gone (D-MX2). "Equipment not
  returned" waits for DE2's read. Next: **F12** (parts from FleetPal, Q-MX2), then M3.
- **2026-10-28 (evening)** — **M3 built** on `claude/maintenance-m3-hub`: the truck's page (§4.3) is
  one page of seven sections in the proposal's order, no tabs, with Check what is on board and Start
  inspection as the header verbs and the phone's bottom bar; the Trucks & trailers list opens on
  "needs attention" with a row of three facts (number, the one sentence, last checked) and "every
  truck and trailer" one tap away under Show. The sentence is the server's — `GET
  /api/maintenance/units/attention` derives every unit's reasons once, and the page's first section
  words the same rows (`attentionWords.ts`); roadside repairs due are merged by the unit the officer
  wrote (D-IC7). FleetPal F10 and F11 landed with it (that plan's log, D-FP22: the meter is the
  roster's). The fleet section's truck and trailer pages keep their addresses and now mount the same
  by-id work-orders window. Shot at 390 and 834 px (`screenshots/m3-*.png`): the phone hub runs
  4,115 px and twelve of its targets are under 44 px — the shared controls M4 (§4.5) is for. Next:
  **M4** (contract §9, `DataTable` card markers, the bottom tab row under `/shop`), then **M5**.
- **2026-10-28 (night)** — **M4 built** on `claude/maintenance-m4-phone`: §4.5 is now `docs/DESIGN-SYSTEM-CONTRACT.md` §9, gated. The touch floor (`provideTouchTargets`) rose 44 → 48 and became a getter: `AppShell` holds it on a shop page while the pointer is coarse or the window is below `md`, so a tablet in the bay is 48 px and the office at a desk keeps 36 on the same page; `FilterSelect`, `KebabMenu`, `TablePagination`, `AppTabs`, `DateRangeFilter`, the bell and the card sort control read it. `DataTableColumn.card` (`title`/`sentence`/`meta`/`none`) draws three-fact cards — the title's link stretched over the card — and a touched shop page draws cards at any width; all 29 shop column sets are marked. `WalkActions` moved to `components/`, from `md`, and is the verb bar on Parts, Equipment, Annual inspections and Labels too. `SectionTabBar` is the shop's sidebar rows below `md` (`phoneTabs` over `buildNavGroups`, active tab by catalogue `parent`), the base of the bottom chrome with the verb bar standing on it. Breadcrumb hidden below `md` and on a touched page (one Back); staging banner one line. Gate: `scripts/check-phone-rules.mjs`, chained onto `lint:ui-adoption` — unmarked card column, primary verb in `PageHeader`, hand-sized control; files derived from the `/shop` routes. Rule 4 measured, not changed: Annual inspections stays a register (§4.6 "Unchanged"); Parts and Equipment open on everything because production has 0 counted shelves and 0 equipment today. Pass at 390 × 844 and 834 × 1194 with a touch context, 18 shop routes: **0 targets under 48 px, 0 neighbours closer than 8 px, one Back, 0 breadcrumbs**, tab row on phone shop pages only (`screenshots/m4-*.png`). Next: **M5**, the owner on the real tablet and a phone in the bay.
- **2026-10-28 (night, after M4)** — **Owner review: five findings (R1–R5), §7a.** Checked against the plan: the Shop page's stacked tables and the truck page's no-tabs were *planned* (D-MX2, D-MX3) and are now replaced by "one table per tab, every table paged"; a truck-assignment page, equipment invoices and IMEI scanning were *not planned*; Parts was planned (FleetPal F12) but its page never says it comes from FleetPal. Steps M6–M10 added (two migrations, M9a and M10a); M5 (the owner's pass in the bay) moves after M6–M8. Questions Q-MX7–Q-MX11 open.
