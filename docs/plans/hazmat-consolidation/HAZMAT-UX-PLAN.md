# HazmatGuard — UI/UX audit and consolidation plan (2026-08-30)

Triggered by the product owner's review: the hazmat pages read as their own little product rather than
part of Silvicom 360, the component usage drifts from the design contract, and the placard calculator
has flow-breaking DOM defects. This document is the audit and the execution plan; it continues
`HAZMAT-IA-PLAN.md` (D-H1…D-H14) and does not restate it.

**Method.** Every claim below was checked against the source, the gates, or a running browser
(`pnpm --filter @silvicom/web preview:local`, public calculator at `/placard-calculator`, 1440×900).
Measured figures are labelled MEASURED; anything not measured is labelled as latent or as a judgement.
All 4 relevant gates are GREEN today (`lint:ui-adoption`, `lint:boundaries`, web `lint:tokens`,
`lint:filesize`) — **every finding in this document is unguarded**, which is why it survived.

---

## 1. The information architecture: a hub of four cards, one of which is a destination

`/hazmat` (`HazmatPage.vue`) is a link menu of four cards. Taken one at a time:

| Card | Where it goes | Verdict |
| --- | --- | --- |
| Placard Calculator | `/hazmat/calculator` | **The only real destination.** A hazmat-only tool with no other home. |
| Hazmat Loads | `/hazmat/loads` | A second load board. Dispatch already has one, with more of the load on it. |
| Hazmat Review | `/hazmat/review` | The same table filtered to `needs_review`, with four different columns. A saved filter. |
| Tank Equipment | `/trailers` | A card whose whole function is to send the user somewhere else. |

The owner's instinct — "I don't see a reason for a separate hazmat loads page… same for review… the
trailers link is not logical" — is right on all three, and the code is more emphatic than the instinct.

### 1.1 The hazmat loads board is a worse view of a load

`HazmatLoadsPage.vue` columns: Status · Products · Tank state · Planned pickup · Created. There is
**no load reference, no truck, no driver, no lane**. A dispatcher cannot recognise their own load on
it; the only human-readable cell is "2 products". `DispatchLoadsPage` already carries a hazmat state
chip per row (`hazmatChipLabel`, H-C1) and a **"Hazmat — not cleared"** filter, on a board that also
shows ref, driver, equipment, first stop and the readiness checklist.

### 1.2 `/hazmat/loads/new` creates records that can never reach the dispatch load — MEASURED

`buildCreateLoadRequest` (`loadFormModel.ts:62-77`) builds `HazmatCreateLoadRequest` with **no
`loadId`**, and the page never calls `POST /api/hazmat/loads/:id/link`. So a record created here:

* never appears in the dispatch board's hazmat column (that column reads the 0148 link);
* leaves `HazmatPanel` on the dispatch load still saying *"This load is marked hazmat but its record
  has not been started"* — and still offering **Start hazmat record**, which creates a **second**
  record, linked, while the first stays orphaned;
* has no UI anywhere that can link it afterwards. `startRecord()` in `HazmatPanel.vue` is the only
  caller of the link endpoint, and it only runs when no record exists.

This is not a cosmetic duplicate. It is a path that silently produces two hazmat records for one
physical load, on a feature whose entire premise is that the record is the evidence.

### 1.3 The review queue is a filter wearing a page

`HazmatReviewPage.vue` and `HazmatLoadsPage.vue` are the same `FilterBar` + `DataTable` over the same
rows; the review page filters to the review queue server-side and swaps in Truck/Driver/Waiting
columns. Those are columns the loads board should have had. D-H8 already decided the *nav item* goes
away and the route stays testable; the page itself was never re-examined.

### 1.4 The Tank Equipment card is a tombstone

H-C2 deleted the cargo-tank page and left `/hazmat/settings/equipment → /trailers` as a redirect. The
hub card is a second tombstone for the same deletion. It teaches the user that hazmat lives on the
hub, then ejects them into Fleet. Trailers is already one click away in the sidebar.

### 1.5 What must NOT be deleted

`hazmat_loads` is deliberately separable (D-H2): a customer who buys HazmatGuard **without** Dispatch
has no `loads` rows at all, so for them the hazmat board and the standalone create form are the only
way in. The consolidation must therefore be **module-conditional**, not unconditional — which is what
makes this an entitlement question, not a page-deletion question.

---

## 2. Component usage against the contract

`apps/web/CLAUDE.md`: *"One primitive per job, always reused, never re-styled."* The hazmat feature
breaks it in seven distinct ways. None is caught by a gate.

### 2.1 `ProductPicker` is a hand-rolled combobox

`AppCombobox` exists and is the primitive for this job. `ProductPicker.vue` reimplements it, badly:

* `<BaseButton role="option">` inside a `<div role="listbox">` — a button is not a valid `option`,
  and there is no `aria-selected`, no `aria-activedescendant`, no `id` linkage.
* **No keyboard support at all.** ↑/↓ do nothing, Enter does nothing, Escape does not close. Every
  other select in the app is fully keyboard-operable (`AppCombobox.onKeydown`).
* No `blur` close; the list closes only on choose or on the click-catcher below.
* Its own 200 ms debounce, its own loading/error/empty states — three more states to keep in sync
  with the primitive that already has them.

The genuinely different requirement here is only **async, server-backed options** (HMT search).
That is one prop on `AppCombobox`, not a second component.

### 2.2 The click-away catcher is a 1440×36 button pinned to the top of the screen — MEASURED

```
<BaseButton v-if="open" class="fixed inset-0 z-sticky cursor-default" … />
```

`AppButton`'s size classes include `h-9`, and an explicit `height` beats `inset-0`'s `bottom: 0`.
Measured in the browser with the picker open:

```
rect: { x: 0, y: 0, w: 1440, h: 36 }        viewport: 1440×900
classes: … bg-surface ring-1 ring-inset ring-edge-control hover:bg-surface-subtle h-9 … fixed inset-0
```

Three consequences, all live:

1. **Click-away does not work.** Clicking anywhere below the top 36 px never closes the dropdown —
   so the list stays open over the fields beneath it, and with two product lines both lists can be
   open at once.
2. **A visible white bar with a border is painted across the top of the page** whenever the picker is
   open — it carries `AppButton`'s full secondary styling. On the public calculator it covers the
   "Add product" row (screenshot taken); in the app it lands on the top bar.
3. It is a focusable `<button>` that is `aria-hidden="true"` — an a11y contradiction, mitigated only
   by `tabindex="-1"`.

### 2.3 The z-index tokens for this job exist and are not the ones used

`tokens.css` defines `--z-index-scrim: 60` (*"the click-catcher behind an open dropdown"*) and
`--z-index-popover: 70` (*"dropdowns, menus, flyouts"*). `ProductPicker` uses `z-sticky-lead` (20,
*"a sticky header cell"*) for the list and `z-sticky` (10, *"a sticky table header"*) for the catcher.
`--z-index-chrome` is 40, so **inside the authenticated app the product list paints under the top
bar.** `AppCombobox` shares the `z-sticky-lead` mistake, so this is a fix in `packages/ui` as well as
in the feature.

### 2.4 Latent clipping: dropdowns inside an `overflow-hidden` line

Each product line is `<div class="overflow-hidden rounded-dialog …">`, and neither `AppCombobox` nor
`ProductPicker` teleports its list. MEASURED at 1440×900: the worst case today clears the clipper by
**40 px** — it does not clip yet. It is one added field, one shorter line variant or one narrower
viewport away from clipping, and nothing tests it. Recorded as latent, not as a live defect.

### 2.5 A segmented control built out of two ghost buttons

"From my fleet" / "Other equipment" in `HazmatCalculatorForm.vue` is two `BaseButton`s inside a
`role="group"` with hand-toggled active classes — no `aria-pressed`, no roving focus, no arrow-key
movement. `AppTabs` and `AppRadioGroup` both exist and both ship the semantics.

### 2.6 `!important` overrides on a shared primitive, to fake a link

Twice — `HazmatCalculatorForm` ("Change") and `HazmatProductLines` ("use it"):

```
class="!h-auto !px-0 !text-xs !font-medium !text-brand-700 hover:!bg-transparent hover:!underline"
```

Six `!important`s to turn a button into a text link. The app already has a link idiom
(`text-link hover:text-link-hover`, used in `CitationText`, `RequirementTable`, `DataTable` and ~10 other places). Either use it or
give `AppButton` a `link` variant — the one thing that must not stay is the override.

### 2.7 `!capitalize` re-breaks the bug `badges.ts` documents

`badges.ts` removed `capitalize` from `BADGE_BASE` on 2026-08-20 (recruiting R0b) precisely because it
title-cased sentence-case labels — *"No response" became "No Response"*. Five hazmat call sites add it
straight back:

* `LoadStatusBadge.vue` — renders `HAZMAT_LOAD_STATUS_LABELS`, which are already sentence case, so
  **"Needs review" ships as "Needs Review"** on the loads board and everywhere the chip appears.
* `FindingRow.vue`, `ReviewPanel.vue` (×2) — labels that are already capitalised; harmless, but they
  are the same mistake and they make the real one look intentional.
* `VerdictPanel.vue` — `'capitalize'` on the load-profile chips renders **"Bulk Load"**, **"Mixed
  Packaging — Bulk + Packages"**, **"Hazmat Only"**.

The doc comment in `badges.ts` says a `capitalize` at a call site marks *"a vocabulary that has not
been mapped yet"*. Every one of these five is mapped. They are the opposite of what the class means.

### 2.8 The roadside packet link on the dispatch load is a guaranteed 401

`HazmatPanel.vue` renders the packet as a raw anchor:

```
<a :href="`/api/hazmat/loads/${id}/packet`" target="_blank" …>Roadside packet (PDF)</a>
```

`apps/api/src/modules/hazmat/routes/index.ts:55` is `router.use(requireAuth, …)` and
`middleware/auth.ts:12-18` accepts **only** an `Authorization: Bearer` header. A new tab sends no
header, so this link cannot ever work. `HazmatLoadDetailPage.downloadPacket()` does the same job
correctly (session token → `fetch` → blob). One feature, two implementations, one of them dead.

### 2.9 Page-skeleton drift

* `HazmatLoadDetailPage` / `HazmatLoadFormPage`: mutation failures render as inline
  `<p class="text-danger-600">` in five places; the contract says **toast**.
* `HazmatLoadDetailPage` uses a raw `<label>` + `BaseInput` for the cancel reason instead of
  `FormField`, and inline `Loading…` / error text instead of the shared states.
* `HazmatLoadFormPage`'s per-line **Remove** and **Change** are raw `BaseButton`s with hand-written
  link classes, while `HazmatProductLines` uses `variant="ghost" size="sm"` + `XMarkIcon` for the
  identical control. Two visual languages for one control, in one feature.
* Both pages carry a `← Loads` ghost button in `#actions` although `route.meta.parent` already drives
  breadcrumbs — a second back affordance, in the slot reserved for actions.
* `CertManager.vue` lives in `features/hazmat/` and is imported by `CompliancePage`. It is a
  compliance component; `lint:boundaries` allows it because a page may import any feature, so nothing
  catches the mis-filing.

---

## 3. The placard calculator

Beyond §2.1–2.6, which all land on it:

* **The step numbers are 1, 3, 4 — and 2 lives in another file.** `HazmatCalculatorForm` renders
  cards numbered 1, 3 and 4; `HazmatProductLines` hard-codes its own "2". The numbering implies a
  wizard the form is not, and it is split across two components, so adding or reordering a card
  silently breaks the sequence. Nothing asserts it.
* **The verdict is ten equal-weight cards in a 26 rem column.** `VerdictPanel` stacks up to ten
  `BaseCard`s — What goes on the truck · Identification numbers · Weight & packaging · Permitted,
  not required · Substitutions · Prohibited · Marks · ERG · Eligibility · Segregation · Rule trace.
  The answer and the audit trail are given the same visual weight, in the narrower half of a
  two-column grid, sticky. The one thing a driver at a dock needs — *which diamonds go on the truck* —
  has no privileged treatment.
* **The empty state occupies half the page** on `xl` (`xl:grid-cols-2`) to say "Results will appear
  here".

**Precision that must survive any rework** (the owner's explicit constraint): the derived
bulk/non-bulk badge and its stated source; the per-package sanity check; the gross-weight suggestion
being one click and never silent; the tri-state other-freight question; every CFR citation in the
results; the provisional-dataset chip; the reproducibility card; and the review attestation gate.
None of these is a layout concern and none of them should be touched by this work.

---

## 4. Proposed decisions (owner's call — nothing below is executed yet)

| # | Decision | Rationale |
| --- | --- | --- |
| D-H15 | **`/hazmat` stops being a hub and becomes the placard calculator.** One nav item, landing on the only hazmat-only tool. | Three of the four hub cards are duplicates or redirects; a menu of four to reach one tool is the confusion the owner is describing. Amends D-H11, which kept the hub as the module's front door before the dispatch surfaces existed. |
| D-H16 | ~~The review queue becomes a view of the dispatch loads board.~~ **REVISED by the owner 2026-08-30: the review queue STAYS a page.** It stops being a hub card and stops being a mystery table — it gains Load #, driver and truck so a reviewer can recognise the load, and is reached from the nav badge, the load's hazmat panel and the notification. | It is a task queue with a legal function, not a second loads board. `HAZMAT_REVIEW_ROLES` is a tighter role set than dispatch (separation of duties, D6) and the queue works oldest-first, which a general board does not. Folding it in would have made a dispatcher and a §172.704-trained reviewer share one surface. |
| D-H24 | **The sidebar carries TWO hazmat entries** — Placard calculator and Hazmat review — not one hub. The badge sits on Review. | H-C4 cut five items to one because four DUPLICATED Loads, Trailers and Compliance; that reasoning retires the duplicates, not the surfaces. These two duplicate nothing, and routing both through a hub cost a click each and pointed the review badge at a menu instead of at the work. |
| D-H17 | ~~Module-gate the hazmat board for orgs without Dispatch.~~ **SUPERSEDED by the owner 2026-08-30: there is ONE loads page. `/hazmat/loads` and `/hazmat/loads/new` are deleted outright.** Dispatch Loads carries the hazmat determination, which McLeod will supply once the TMS integration lands. | The module gate was hedging against a standalone HazmatGuard customer who does not exist. Hedging cost a whole second board, a second create path, and the orphan defect in §1.2. |
| D-H23 | **The workspace gains the product declaration editor.** `PATCH /api/hazmat/loads/:id` already accepts `declaredLines`, is validated and audited, and has **no caller in `apps/web`**. | Without it, D-H17 removes the only surface where products can be declared — and the H-C1 flow the owner asked for is already a dead end: *Start hazmat record* creates `declaredLines: []`, the toast says "declare the products in the workspace", and the workspace renders them read-only. **This is a blocking functional gap, not a polish item.** |
| D-H18 | **The workspace `/hazmat/loads/:id` stays** as the deep evidence surface (runs, documents, review, reproducibility) and is reached only from a load. | It is not a duplicate of anything; it is where the audit trail lives. |
| D-H19 | **The Tank Equipment card is deleted.** | Fleet → Trailers is already in the sidebar; a card that only redirects is a nav item in disguise. |
| D-H20 | **`AppCombobox` gains async options; `ProductPicker` becomes a thin wrapper over it and stops owning a dropdown.** | One primitive per job. The only real difference is server-backed search. |
| D-H21 | **Overlay layering moves to its own tokens** — list at `z-popover`, catcher at `z-scrim` — and the list is teleported, in `AppCombobox` itself. | The tokens were defined for this and are unused; fixing it in the primitive fixes §2.3 and §2.4 for every caller, not only hazmat. |
| D-H22 | **A page-composition fitness check is added** once the rework lands, asserting no `!important` on a shared primitive, no `capitalize` on a mapped-label badge, and no raw `<a href="/api/…">`. | `HAZMAT-IA-PLAN.md` §5 deferred exactly this check until after the visual rework, "so its grandfather list starts near empty". That moment is now. |

---

## 5. Execution steps (revised 2026-08-30 after the owner's one-loads-page ruling)

One step per branch (`claude/<topic>`), PR to `main`, merge after CI. Re-ordered from the first draft:
**the workspace editor comes first**, because D-H17 deletes the only other place products can be
declared, and the IA consolidation comes before the polish so no effort is spent on files that are
about to be removed.

### H-U1 — Declare products in the workspace (D-H23) — **DONE 2026-08-30** (prerequisite for the rest)
The workspace gains a draft-only product editor calling the existing `PATCH /api/hazmat/loads/:id`,
reusing `HazmatProductLines` and `buildEngineLines` rather than growing a third product form. Editing
is closed the moment the record leaves `draft` (`canEditLoad` already says so server-side).
**Done when:** a record started from a dispatch load can be taken from zero products to a green
analysis without leaving the load; a draft's lines round-trip through PATCH; the editor is absent on
every non-draft status; `pnpm --filter @silvicom/web test` green.

**What shipped:** `DeclaredProductsCard.vue` (read-only on every status, editable on `draft`,
reusing `HazmatProductLines` rather than growing a third product form); `useUpdateLoad` — the first
caller `PATCH /api/hazmat/loads/:id` has ever had; and `declaredLines.ts`, the recovery half of the
round trip. **Found on the way:** `declared_lines` stored only the engine's DERIVED answer, so a
re-opened draft lost the package type and the per-package size — the two inputs the §171.8 derivation
runs on — and could flip bulk/non-bulk on the next save. `buildEngineLine` now writes a
`declaredProduct`/`declaredPackageType`/`declaredPerPackage` snapshot that the engine's plain
`z.object` strips, so the evidence column states the declaration in the words the paper used without
any rule ever seeing it. Also fixed: every hazmat lifecycle mutation now invalidates the `dispatch`
query keys, so `HazmatPanel` stops rendering the state before the move it just made.
**Verified by:** `pnpm --filter @silvicom/web typecheck`, the web suite (80 files / 721 tests),
`lint`, `lint:comment-claims`, `lint:ui-adoption`, `lint:filesize`, web `lint:tokens`; the
round-trip test was mutated to prove it fails.

### H-U2 — One loads page (D-H15, D-H17, D-H19, D-H24) — **DONE 2026-08-30**
Delete `HazmatLoadsPage.vue`, `HazmatLoadFormPage.vue`, `loadFormModel.ts` and their routes and tests.
`/hazmat` becomes the placard calculator; the Tank Equipment card goes with the hub. `/hazmat/loads`
and `/hazmat/loads/new` redirect to the dispatch board. `useHazmatLoadsQuery` loses its only caller.
**Done when:** exactly one load board exists; a hazmat record cannot be created unlinked; the old
routes still resolve (as redirects) so notification links and `routeTable.test.ts` keep their promise;
`lint:filesize`, `lint:ui-adoption`, `nav.test.ts`, `breadcrumbs.test.ts` green.

**What shipped:** `HazmatPage`, `HazmatLoadsPage`, `HazmatLoadFormPage` and `loadFormModel` deleted;
`/hazmat` → the calculator, `/hazmat/loads` and `/hazmat/loads/new` → `/loads`; the workspace's
breadcrumb parent is `/loads`; the sidebar's one hub item became the two of D-H24;
`useHazmatLoadsQuery` and `useCreateHazmatLoad` removed with their last callers.

**Found on the way — the deletion would have stranded three regulatory inputs.** The create form
owned tank state, carrier relationship, planned pickup, DOT-SP permits and the shipper's
no-placards claim, and `HazmatPanel.startRecord` hard-codes only two of them. `special_permit_numbers`
is what raises the reviewer's §173.315 acknowledgement (`gate.requiresSpAttestation`),
`claimed_no_placards` is the assertion the engine is asked to contradict, and `carrier_relationship`
is the §172.506 fact deciding who placards the vehicle. `LoadDeclarationCard` moves all eight fields
onto the workspace under the same draft-only PATCH gate as the products, so nothing was narrowed.

**Also found:** the G2 breadcrumb gate caught `/dispatch/loads` being an alias redirect with no
title of its own — the workspace's parent is `/loads`. And deleting the board removed the app's only
depth-3 breadcrumb chain, so `breadcrumbs.ts`'s `MAX_DEPTH` comment, `breadcrumbs.test.ts`'s "the
real three-level chain" and the design lab's deep-trail specimen were all describing an IA that no
longer exists; each now says what is true.

**Verified by:** web suite 79 files / 715 tests, `typecheck`, `lint:ui-adoption`, `lint:filesize`,
`lint:comment-claims`, web `lint:tokens`; the redirect destinations are pinned by a new test, and
reordering the route file was tried to confirm the assertion pins behaviour rather than file order.

### H-U3 — The review queue stops being a mystery table (D-H16 as revised)
The queue gains the load's identity — Load #, driver, truck — so a reviewer can recognise what they
are being asked to clear. Today its columns are Products / Truck / Driver / Waiting / Created with no
load reference at all, because it was built as a sibling of a board that no longer exists.
**Done when:** a row names the dispatch load it belongs to; oldest-first ordering is preserved; the
badge count still comes from `/hazmat/review-count`; the queue is reachable from the nav badge, the
load's hazmat panel and the notification.

### H-U4 — Overlay primitives (D-H20, D-H21)
`AppCombobox` teleports its list at `z-popover` with a `z-scrim` catcher and gains async options;
`ProductPicker` becomes a thin wrapper and stops owning a dropdown.
**Done when:** the 36 px top-of-screen bar is gone; click-away and Escape close the list; ↑/↓/Enter
select; the list paints over the app top bar and escapes the `overflow-hidden` product line; the
async path has unit tests; every existing `AppCombobox` caller still passes.

### H-U5 — The design-contract sweep
`!capitalize` off the five badges; the two `!important` link overrides replaced; the segmented control
becomes `AppTabs`; inline mutation errors become toasts; the raw `<label>` becomes `FormField`; the
packet download becomes one shared token-authenticated composable.
**Done when:** no `!` override on a shared primitive and no raw `<a href="/api/…">` remains in
`apps/web/src`; the board reads "Needs review"; a test pins a mapped-label chip against title-casing.

### H-U6 — Calculator and verdict composition — **DONE 2026-08-30**
Kill the 1/3/4 numbering or derive it from one place. Give the verdict a lead answer — the required
display — with the audit sections behind progressive disclosure; fix the empty state's width.
**Done when:** the required placards are the first and dominant thing in the results, and §3's
precision list is intact with its tests passing.

**What shipped:** the verdict reads in three moves instead of ten equal cards — THE ANSWER
(eligibility, load shape, the diamonds at 112px), THE CHECK (§172.504(c) arithmetic and the lawful ID
formats, deliberately not behind a click — "a verdict a dispatcher cannot check is a verdict they
will not trust" is why that card exists), then findings/segregation and the long tail closed in
`VerdictDetails`. The three threshold rows are derived rather than written three times; their state
expressions had already drifted, with the 1,001 lb row reading the engine's `thresholdMet` while the
other two recomputed the comparison inline. Step badges 1/3/4 are gone (the form is not a sequence,
and its "2" lived in another file), the two hand-rolled notice banners became `AppCallout`, and the
empty state no longer fills half the page to say nothing happened yet.

**Found on the way — a live defect on the public marketing calculator.** `HazmatProductLines.vue`
uses `<BaseCard as="section">` and has NEVER imported it, so "Regulated products" rendered as an
unresolved `<basecard>` custom element with no background: the one section of the calculator that is
not a card, on both the public and the internal page. `vue-tsc` does not resolve template components,
so nothing caught it. A repo-wide scan of every `.vue` file found no second instance; the scan is
worth keeping as part of H-U7.

**Verified by:** a real end-to-end calculation against a locally-run API (UN1203, 40 drums, 12,000 lb
on a dry van) rendered and screenshotted; mobile (390px) and dark theme checked in the same round
with no horizontal overflow; the impeccable design detector returns clean; web suite 80 files / 715
tests, `typecheck`, `lint`, `lint:ui-adoption`, `lint:filesize`, `lint:comment-claims`, web
`lint:tokens`.

### H-MP — Marine pollutants, §172.322 (owner-reported gap) — **DONE 2026-08-30**
Research first, verbatim from the eCFR versioner API:
`docs/plans/hazmat-consolidation/MARINE-POLLUTANT-RESEARCH.md`. The engine's `marks` union had
declared `"MARINE_POLLUTANT"` since it was written and never emitted it; the dataset had carried
appendix B (554 entries, 178 severe) with one consumer, the §172.203(l) shipping-paper words.
**Done when:** the mark fires exactly on the loads §172.322 requires it for, and on no others.

**Two counterintuitive rules drive it**, and a from-memory implementation gets both wrong in the
direction that trains people to ignore the mark. §171.4(c)(1) — on a highway-only move the
marine-pollutant requirements do not apply to non-bulk packagings **at all**. §172.322(d)(3) — a
domestic bulk marine pollutant on an **already-placarded** vehicle needs no mark, which is the
ordinary tanker. The mark is required in one narrow band: bulk packaging on a vehicle bearing no
subpart E label and no subpart F placard — precisely the load a placarding tool otherwise hands back
as "no placards required" with nothing else to say.

**Found on the way, three things the tests caught rather than the code:**
1. `resolved` DROPS a line whose class takes no placard, and `compute` returns early when nothing is
   placardable — so the load that needs the mark most was invisible to any rule keyed on it. The
   resolution now carries a `recognized` list, and the rule runs on the early-exit path too.
2. Appendix B lists SUBSTANCES: only **132 of 2,479** HMT entries match it by shipping name. UN3077 /
   UN3082 are the other door and no name match can ever find them. They are recognised by identity on
   SP 441's own words ("For marine pollutants transported under UN3077… or UN3082…"), UN-only and
   name-checked so NA3082 "Hazardous waste" does not sweep in.
3. An early `if (appendixB.length === 0) return []` guard would have silently switched the SP-441
   route off for every dataset cut before appendix B was imported.

**Also:** `evaluateLoad` keeps only conditional/violation findings, so an `info` finding never leaves
the engine — `computeAdvisories`' comment claims otherwise. The rule's user-facing channels are the
mark and the trace note; the info findings are written for whoever gives them a channel later.
The calculator gained the vessel-leg question, because the conditional this rule raises must be
answerable. Engine 0.11.0 → **0.12.0**.

**Verified by:** 13 new engine tests (121 total), mutation-tested by breaking (d)(3) — 3 fail; and
all five decision-table branches exercised against the REAL shipped dataset through a locally-run
API, including a non-bulk aniline load with a vessel leg that takes no placard and does need the mark.

### H-U7 — The fitness check (D-H22)
The gate, with a grandfather list that should be empty by the time it lands.
**Done when:** it fails on a reintroduced override and passes on `main`.

## 6. Open questions

1. ~~Does D-H15 reverse D-H11?~~ **Answered by the owner 2026-08-30:** yes — one loads page, and the
   hub goes with it.
2. ~~Is standalone HazmatGuard still a real commercial intention?~~ **Answered 2026-08-30:** no. The
   loads determination comes from Dispatch, sourced from McLeod once the TMS integration lands, so
   the module gate is dead weight and the second board is deleted rather than conditioned.
3. ~~Do the orphaned records of §1.2 need a backfill?~~ **Answered 2026-08-30 by measuring:**
   `select count(*) … from hazmat_loads` against production returns **0 rows, 0 unlinked**. The
   feature has never carried a real record, so closing the path is the whole fix and no backfill
   migration is owed.
4. **Verdict disclosure (H-U6)** — tabs, or a lead card with collapsed sections? A roadside user wants
   one screen; an auditor wants all ten.
