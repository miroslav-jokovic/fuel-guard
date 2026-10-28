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
