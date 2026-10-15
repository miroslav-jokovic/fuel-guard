# UI standardization — every page and component on one set of rules

**Status:** IN EXECUTION — US0–US6c merged 2026-10-12/13; US6b browser pass done 10/13, its fixes in batches; US7 (admin) waits on Q-US1.
**Owner ruling:** "proceed as suggested and let's do this properly so we have all pages and components
100% production ready" (2026-10-12).
**Canonical rules it feeds:** `docs/DESIGN-SYSTEM-CONTRACT.md` (what a page must look like) and
`scripts/ui-system-inventory.mjs` (`lint:ui-adoption`, what CI refuses). This file is the decision
log and the work list; when a decision here becomes a rule, the rule lives in those two places and
this file says where.

## 1. Why this document exists

The work started in Codex on 2026-10-10 as a UI audit of the list pages and was finished in Claude
Code on 2026-10-12 across seven PRs. The audit itself was never written down — it survived only in
PR bodies and Codex's history — so on 2026-10-12 answering "where are we with this?" took a sweep
of git, the Codex worktree and the source. That sweep is §3; the plan is §4; the rules are §5.

## 2. What "production ready" means here

A page is done when all of these hold, and each one is either a gate or a named check below:

1. **It is built from the shared pieces** — `PageHeader`, `DataWorkspace` + `FilterBar` + `DataTable`,
   `StatCard`, `BulkActionBar`, `ExportButton`, `AppTabs`, `SlideOver`, `AppCallout`, the badge map.
   No hand-built equivalent of any of them (gate: `lint:ui-adoption`).
2. **Its state survives a reload, a pasted link and Back** — filters, sort and page in the URL (D-US2).
3. **Every state is drawn**: loading, error with retry, empty that says why, and the data (US5).
4. **It reads the same as its neighbours** — the same layout for the same job (list, report, detail,
   drawer, settings), the same words for the same action (contract §11 voice).
5. **It was looked at** in a browser at desktop and phone widths, not only tested in jsdom (US6).

## 3. Where it stood on 2026-10-12 (the audit)

### 3.1 Done and live (v2026.10.12.x)

| PR | Standard |
|---|---|
| claude/ui-standardization | Filters and table in one card on ~20 lists; ~29 card-in-card tables removed; one `ExportButton` with its scope; `ReportScopeBar`; four tab strips onto `AppTabs` |
| claude/ui-standardization-audit-2 | One **Clear filters**, drawn by `FilterBar`, on every filtered list; clearing keeps the sort |
| claude/bulk-action-bar | One `BulkActionBar` on the seven selectable lists |
| claude/stat-card-tiles | One `StatCard` for every summary figure |
| claude/ui-one-offs | Search copy "Search <what>…"; 2–4 primary filters in the row |
| claude/section-headings | Two heading sizes |
| claude/statcard-unit-space | Unit spacing in tiles; crowded filter rows wrap |

The Codex worktree (`~/.codex/worktrees/ui-standardization`) was compared file by file with the
merged result: nothing in it is missing from `main`.

### 3.2 Not yet standard (measured on `origin/main` at aa2bb61)

| # | Gap | Measure |
|---|---|---|
| G1 | List state outside the URL | 33 of 44 filtered lists hold filters in component state; 12 hold sort in a `ref` |
| G2 | Notices drawn by hand | 36 hand-tinted notice blocks (`bg-<tone>-50 … ring-1`) in 24 files, in at least five recipes, where `AppCallout` is the sanctioned piece |
| G3 | A second table primitive | 6 web files use `AppTable`, a bare `<table>` that the raw-table counter cannot see, with five different hand-written header styles |
| G4 | Loading / error / empty outside tables | 28 hand-written "Loading…" lines in six styles; `ErrorState` in 6 files; 20 files read `isError` with no shared error state; no shared empty state |
| G5 | Detail pages | 8 detail pages, no shared anatomy (cards 0–5, tabs on one, facts as `<dl>` on five) |
| G6 | Drawers | 51 files render a `SlideOver`; 8 have no `#footer` — not yet checked which of those carry actions that then scroll away with the body, and which are read-only |
| G7 | Admin console | Built on `@silvicom/ui` primitives only; none of the web list composites |
| G8 | The written rules lag the code | Contract §5.2b still calls the two-card list "valid on existing pages"; `UI-COMPONENT-ADOPTION.md` was a 10/08 snapshot |

## 4. The plan

| Step | What | Status |
|---|---|---|
| US0 | This document; contract §5 brought up to date; adoption baseline regenerated | DONE 2026-10-13 |
| US1 | `useQueryState` grows what every list needs: a default that stays out of the URL, on/off flags, the page, a scope for two lists on one route, and ONE buffer per router (D-US2) | DONE 2026-10-12 |
| US2 | All 33 lists onto the URL; gate rule so a new list cannot skip it (closes G1) | MERGED 2026-10-12 |
| US3 | Every page notice through `AppCallout`, gated (closes G2) | MERGED 2026-10-12 |
| US4 | `AppTable` call sites onto `DataTable` or a labelled exception; the gate counts `AppTable` as a raw table (closes G3) | MERGED 2026-10-12 |
| US5 | One loading / error vocabulary outside tables (`QueryState`), gated (G4) | MERGED 2026-10-12 |
| US5b | The three roster form drawers put Save in the footer; gate (G6) | MERGED 2026-10-13 |
| US6 | Detail-page anatomy (G5): one shared `FactList` for label/value facts, gated | MERGED 2026-10-13 |
| US6c | Every list with a toolbar pages; the product's confirm replaces `window.confirm`; "Failed to" copy gone (D-US7, D-US8) | MERGED 2026-10-13 (#1497) |
| US6b | A browser pass of every routed page at 1280 px and 390 px | PASS DONE 2026-10-13 (§7); fixes in batches |
| US7 | The list composites move into `@silvicom/ui` (web repointed, no shim); every admin page onto them; the gate covers `apps/admin/src` (G7, D-US11) | planned — answered 2026-10-15 |
| US8 | The audit log's page is its cursor in the URL; the route reads backwards too; the pager names the date range (D-US12) | planned — answered 2026-10-15 |
| US9 | One `recordId` schema for every id site (283), and a gate against a bare `z.uuid()` or a hand-written id regex; closes F31 (D-US13) | DONE 2026-10-15 (`claude/ui-us9-record-id`) |

Each step is one PR (large batches, per the release practice), merged on green CI, released by the
train.

## 5. Decisions

**D-US1 — The list-page shell is `DataWorkspace` for every list with a toolbar.** The older two-card
shape (a `FilterBar` card above a `DataTable` card) is no longer "valid on existing pages": after
claude/ui-standardization no list carried it, and a sanctioned shape nobody uses is one the next page
copies anyway. Reports are a different shape (D-US1a). Contract §5.2b updated the same day.

**D-US1a — A report's filter bar stands alone; a report's single period choice is `ReportScopeBar`.**
The 2026-10-12 audit first listed Fuel costs and Buy discipline as "two lists left on the two-card
shape". Read again, neither is a list: one `FilterBar` there governs tiles, a strip and two tables
at once, so it cannot sit inside any one of their cards, and `DataWorkspace` (toolbar + ONE table)
is the wrong shell. `ReportScopeBar` is the wrong one too — it holds one period choice and has no
Clear filters. So the report shape is: a standalone `FilterBar` (with `:active-count`) above the
panels it governs when there are filters; `ReportScopeBar` when the only choice is the period. What
WAS inconsistent on those two pages was their hand-written loading, error and notice lines — G2 and
G4, not G1.

**D-US2 — A filtered list keeps its filters, its sort and its page in the URL.** Reload, a link
pasted into a ticket and Back from a row's detail page all return the same list. Built on
`useQueryState`, with these rules (all in `composables/useQueryState.ts`):

- A list that **opens narrowed** (Vehicles on Active, Recruitment on "Waiting on us") keeps that
  default OUT of the URL, so a plain link opens the list the way everybody expects. "All" is then
  written as `any`, or choosing it would write nothing and snap back.
- A value outside the caller's vocabulary reads as the default — a stale link opens the list the
  way a plain link would. Sort keys are always checked against the table's own sortable columns.
- **Page 1 is absent**; any filter change returns to page 1.
- Two lists on one route take a **scope** (`history.search`), so they do not share `?search=`.
- **One buffer per router**, not per caller: before this, a page and a tab inside it each had their
  own, which re-opened the same-tick race `useQueryState` exists to close.
- **Clear filters** returns filters to their defaults and keeps the sort (unchanged from
  claude/ui-standardization-audit-2).
- A list inside a drawer whose state SHOULD reset when the drawer closes may opt out, in writing:
  `ui-adoption: list-state-local — <why>`. The gate accepts the marker only with a reason.

Gate: `lint:ui-adoption` fails a file with `<FilterBar` that reads no `useQueryState` (directly or
through a composable it imports) or holds sort in a `ref<SortState>`.

**D-US3 — A page notice is `AppCallout`.** The component existed since U4 for exactly this, and 29
hand-tinted blocks had grown back beside it. The gate now refuses `bg-<tone>-50` with `ring-1` on a
`div`/`p`/`section`/`aside`. A save result is still a toast, never a callout.

**D-US5 — Anything that fetches and is not a table draws its states through `QueryState`.** The
table's order — loading, then failure, then content — and the failure always has a Retry. Before:
59 hand-written loading lines in six styles, and failures that said "Reload to try again", which
resets everything else the reader had open. `compact` is the one-line form for a panel or drawer.
The gate refuses a "Loading…" text outside a button's busy label.

**D-US6 — Label/value facts are `FactList`.** One label style, one value style, one grid, and a blank
is an em dash as in a table cell. Hand-written `<dl>`s are refused unless they say why they are not a
fact list.

**D-US5b — A drawer's form puts its submit in the footer.** `form="<id>"` on the footer's button; the
gate counts per drawer.

**D-US7 — "Are you sure?" is the product's dialog.** `useConfirm()` (stores/confirm.ts) returns a promise
of the answer; one `ConfirmHost` in `App.vue` draws it through `BaseModal`, with the act's own verb on
the button and danger in red. The gate refuses `confirm(`, `alert(` and `prompt(` in web code. Before:
21 acts asked through the browser's grey dialog, its buttons always "OK", the page frozen behind it.

**D-US8 — A list with a toolbar pages.** A `DataTable`, or a `*Table` component wrapping one, inside a
`DataWorkspace` renders `TablePagination` in its footer; a cursor-paged list uses its uncounted mode
(so "Load more" is gone too). A list that is honestly bounded says so at the table:
`ui-adoption: unpaged — <why>`. Before: ten toolbar lists rendered every row, the Dispatch board among
them (197 trucks, one table), and Labels' asset list only ever showed the server's first 50.

**D-US9 — A read's failure says the page's own sentence.** The US6b browser pass found ~50 read states
written `error?.message ?? 'Could not load the vehicles.'`, whose fallback only showed when there was
no message: readers got PostgREST's text, an api 500 body, or TanStack's `["dispatch","loads"] data is
undefined`. `QueryState` did the same when a caller left out `error-text`. Now a component's `:error`,
`:error-text` or `:message` binding may not read a `.message`, and a `QueryState` with an `:error`
names its `error-text`. Where the server's words ARE the answer (a scanned code nobody knows, a route
that says why it cannot be drawn) the site says `ui-adoption: server-message — <why>`. An action's
toast still carries the raw text as its detail — that is for the person who just pressed the button.

**D-US10 — A record that does not exist is a fourth state, not a failure.** A record read turns a 404
(or a PostgREST `.maybeSingle()` with no row) into `NotFoundError` (`lib/notFound.ts`, through
`recordOrThrow`); the query client never retries it (`retryUnlessNotFound`, the app default); and
`QueryState` draws `NotFoundState` — the page's `not-found-text` and one way out, "Back to <list>",
read from the route's `meta.parent` (the dashboard when the list does not open for the reader). No
Retry, because asking again cannot conjure the record. Every routed page whose path names a record
gives its `QueryState` a `not-found-text`; a parameter that is not a record says
`ui-adoption: not-a-record — <why>` at the top of the page (US6b F21).

**D-US11 — The list composites live in `@silvicom/ui`, and the admin console is held to the same
rules (answers Q-US1, 2026-10-15).** `DataWorkspace`, `FilterBar`, `DataTable`, `DataTableCards`,
`QueryState`, `BulkActionBar`, `FactList` and the states they draw (`ErrorState`, `NotFoundState`,
`TableSkeleton`) MOVE into `packages/ui` together with the code they stand on (`useQueryState`,
`workspaceTable`, `dataTable`, `sort`, `plural`, `notFound`). They are moved, not copied, and the web
app's 131 importers are repointed — there is no re-export shim left in `apps/web/src/components/ui`,
because a shim is a second address for one component. Nothing in them blocks the move: their only
outside dependencies are `vue-router` (already a peer of `@silvicom/ui`), `@vueuse/core` and
`@floating-ui/vue`, and `QueryState` takes props, not a TanStack query. Then every admin page is
rebuilt on them, and `lint:ui-adoption` runs every D-US rule over `apps/admin/src` as it does over
`apps/web/src`.
Measured on `origin/main` at 97b7ecb: admin's three tables are hand-headed `AppTable`s (Customers,
Customer detail's members, the idle engine's two), its states are hand-written "Loading…" lines, and
every failure prints `e.message` ahead of the page's own sentence — the exact G3/G4/D-US9 findings
the web app has closed. Option (b), "an internal tool with six pages", was rejected because the
reason it gave is the reason against it: this console is where support staff read a customer's data
to answer that customer, so a misread there is a wrong answer given to a customer; and its Customers
list grows with every customer signed, which is the list that most needs paging, sort and a link
that reopens it.

**D-US12 — A page of the audit log is linked by its cursor, never by a page number (answers Q-US2,
2026-10-15).** The audit log is evidence. A link to "what the log showed" has to reopen the same rows
next week, when an auditor or counsel follows it; a page number cannot do that on a log that grows at
its newest end — page 3 today is not page 3 tomorrow — so offset paging, option (a) as written, is
refused for the same reason the current in-memory page number is. The route already pages by a
stable keyset (`created_at`, `id`, `audit.ts`), so the URL carries that keyset: `?before=<cursor>`
opens the page that starts after it, and the route grows the backwards half (`?after=<cursor>`, read
ascending and turned round) so Previous works from a pasted link as well as from a walk. The
in-memory cursor stack is deleted. The pager says what the rows ARE — the date range they span — and
"Newest" returns to the head; it does not say "page 3", which on a keyset is a number nobody can
check. Option (b), "leave it until somebody asks", was rejected: the person who needs the link is
the one auditing us, and they will not ask first.

**D-US13 — One record-id schema, which accepts every id Postgres accepts (answers Q-US3,
2026-10-15).** `packages/shared` exports one `recordId` schema built on `z.guid()` (8-4-4-4-12 hex:
what the `uuid` column type stores), and every one of the 249 `z.uuid()` sites on `origin/main`
(40 files in `packages/shared`, 15 in `apps/api`, 3 in `apps/web`, 1 in `apps/admin-api`) reads it. A
gate refuses a bare `z.uuid()` / `z.guid()` outside that definition, so the next contract cannot
restate it. Option (a), re-keying staging's org, was rejected: it would hide the bug, not remove it.
`docs/11-DEPLOYMENT.md` Stage 2 tells whoever bootstraps a carrier to create the org with the fixed
id `…0000a1`, and the seed, the PGlite matrices and the duty tests all hold it. Our contracts would
then refuse a value our own database issues and our own runbook prescribes. Postgres is the authority
on what an id is. A contract may be stricter about a field's MEANING, but not about the id's
spelling. The id schema exists to turn a malformed id into a 400 before the database turns it into a
500, and `z.guid()` does exactly that (proved on Zod 4.4.3: the staging id passes, `"x"` fails).

## 6. Open questions

Q-US1, Q-US2 and Q-US3 were answered on 2026-10-15 — D-US11, D-US12 and D-US13 above. The questions
are kept as asked.

**Q-US1 — Does the admin console adopt the web list composites?** `DataWorkspace`, `FilterBar` and
`DataTable` live in `apps/web/src/components/ui/`, not in `@silvicom/ui`, so admin cannot import them.
(a) Promote them into `packages/ui` and move admin onto them; (b) leave admin on the primitives as an
internal tool with six pages. Recommendation: (a), after US6 — admin is where support staff read
customer data, and the same list behaving two ways in two consoles is the drift this plan removes.

**Q-US2 — The Audit page's Activity page number.** That list pages by cursor: page 3 is reachable
only by walking pages 1 and 2, and the walked cursors live in memory. A `?page=3` read on reload
would show page 1's rows labelled "page 3", so the page number stays out of the URL (the filters
are in it). (a) Give the audit route a backwards cursor or an offset so a page can be opened
directly; (b) leave it — an audit log is read from the newest end, and the filter is what a pasted
link needs. Recommendation: (b) until somebody asks to link a page of the log.

**Q-US3 — Staging's org id is not an RFC UUID.** `00000000-0000-0000-0000-0000000000a1` has version
nibble 0, and Zod 4's `z.uuid()` refuses it, so any staging request carrying the org id as a validated
UUID answers 400 (found by US6b: Driver Qualification's carrier records). Production's org id is a v4
UUID, so production is unaffected — but staging is where a release is checked. (a) Re-key the staging
org to a v4 UUID; (b) validate ids with `z.guid()` (format only, what Postgres itself accepts) across
the 237 sites. Recommendation: (b) — Postgres is the authority on what an id is, and a contract that
refuses ids the database issues is the narrower bug; (a) only hides it.

## 7. Progress log

**2026-10-12 — US0, US1 built; US2 started.** Audit in §3. `useQueryState` extended and tested (the
shared-buffer test fails when the buffer is made per-caller again). Trailers converted by hand as
the reference (`pages/trailersListInUrl.test.ts`); the other 32 lists converted in four batches.

**2026-10-12 — US2 built.** All 33 lists keep filters, sort and page in the URL; no list used the
`list-state-local` exemption. Along the way: the Fleet report, Fuel planning, Qualification and
Audit pages put their TAB in the URL too, because a link to a tab's filtered list that opened on
another tab was a link that did not work; the qualification page's tiles and table now read one
filter model (the URL) instead of two refs mirrored by four watches; the per-truck table's columns
moved into `cpmTruckColumns.ts` so the tab derives its sort vocabulary instead of restating it; five
pages that reset to page 1 whenever their filtered rows changed now reset only on a filter or sort
change, or a pasted `?page=2` was lost the moment the data arrived. The Odometer, Recruitment and
Truck stops lists open on a default sort, so their third header click ("no sort") writes
`sort=any`, which reads back the same after a reload.

**2026-10-12 — US4 built** on its own branch: the five web `AppTable`s are `DataTable embedded
dense`, and the gate refuses `AppTable` in the web app save the published privacy policy.

**2026-10-12 — G6 measured per drawer, not per file.** A first count by FILE (51 files render a
`SlideOver`, 8 have no `#footer`) was the wrong unit: a file with one footered drawer hid a second
drawer without one. Counted per drawer, by whether a submit button reaches the drawer's scrolling
body — directly or through a `*Form` child — exactly three fail: the roster's new/edit drawers on
Vehicles, Drivers and Trailers, where Save sits at the end of a long form. The sanctioned shape is
already in the repo (`InspectorDrawer.vue`, `NewInspectionDrawer.vue`): the form carries an `id`,
and the footer's submit button names it with `form="…"`. The other footerless drawers host a panel
that owns its own actions or per-row buttons, which is not what the footer rule is for.

**2026-10-12 — G5 measured.** The nine detail pages already share a shape — `PageHeader`, a facts card,
then sections — so the anatomy is not the drift. The facts are: 47 hand-written `<dl>`s across pages
and features, their `<dt>` labels in eight styles (`text-ink-muted` 57×, `text-xs text-ink-muted` 31×,
`text-ink-tertiary` 20×, `text-xs text-ink-tertiary` 15×, and four rarer) and their grids in a dozen
column/gap recipes. US6 is therefore one `FactList` (label, value, an em dash for a blank, one grid)
and a gate on a hand-written `<dl>` — not a page template.

**2026-10-12 — US3 and US5 built.** 59 loading lines and 29 tinted notices across 66 files, plus the
parents that own the queries. What converting them FOUND matters more than the count — a failed read
on these surfaces had been drawing a confident wrong answer:

- **Three settings forms rendered their built-in defaults on a failed read** (Driver performance, Fuel
  planning, Thresholds); saving would have written those defaults over the org's real values. A
  failure now shows a Retry and no form.
- Failures that read as findings: "No reviewed cases yet" (Reports), "No statement on file" (the 7-day
  statement), "Every line is counted" / "Every item has been looked at" (the count and the unit
  check), "The applicant is still filling this in", "Still open. Nothing has been decided", the EFS
  page's "Not configured" setup form, an anomaly's entity history reading as "no history".
- Failures that drew nothing (the handbook panel, an exception's drawer) or said "Reload the page".

Every one now says "Could not …" with a Retry that refetches the read that failed, and each parent
that owns a query is wired to it (tests click Retry and assert the refetch; the wiring was proven by
removing it). `AppCallout`'s slot became a `div` so a notice can carry a list (the import's row
errors). Eight sites match a recipe without being what the rule is about, and say so where they
stand with `ui-adoption: not-a-notice — <why>` / `not-a-page-state — <why>`: a decline's record
panel, an anomaly's score meter, two tinted form-field groups on the trailer form, an upload's
progress line and per-file failure list, and two table cells standing in for a document link.

**2026-10-12 — US5b built, and it found a save that had never worked.** The Vehicles, Drivers and
Trailers drawers now hold Cancel and Save in the footer (`form="vehicle-form"` etc.); the gate refuses
a drawer whose form submit sits in its scrolling body. Writing the test that the footer's Save really
submits the form — through the DOM's form-owner rule, not just an attribute check — showed the TRAILER
form refusing every save of a trailer with no type: "Not set" is `""`, the shared schema's type is an
enum or null, and the Type field displayed no error. A new trailer saved without a type, or ANY edit of
an untyped trailer, did nothing and said nothing. Fixed (`""` is sent as null) and the Type field now
shows its error; the test fails on the old form. The vehicle and driver forms were probed the same way:
the vehicle form's refusal of an empty tank capacity is shown on its field, and the driver form saves.

**2026-10-12 — US6 built.** 41 `<dl>`s in 31 files: 35 onto `FactList`, six marked as not fact lists
(a five-column family table, a three-way split, a bar drawn between two figures, the one-time
password handoff, the dashboard's linked KPI strip, the route summary's icon strip). Blanks that had
been printed as values are gone — a truck with no tank on file read " gal" (test fails on the old
page), and asset, part, card and recall-audit facts that typed their own "—" now leave it to the list.

**2026-10-13 — the owner found the Dispatch board unpaged, and asked for every page still off-standard.**
A second sweep, for what the gate did not yet check, found: ten unpaged toolbar lists (and a "Load
more" beside the Audit log's Previous/Next for the same kind of list); 21 `window.confirm`s; 28
"Failed to …" strings against the voice's "Could not …"; and the anomaly audit's fill time printed by
the browser's locale. Each became a gate rule (D-US7, D-US8, the voice) and the sites were converted.

**2026-10-13 — US6b: the browser pass.** Every routed page (92) was built with the dev bypass and
screenshotted three ways — every read failing (500), every read empty, both at 1280 and 390 — and the
pages a fleet manager can reach were screenshotted again on staging with real data (220 trucks, 178
drivers). A script measured page overflow and elements past the viewport; every screenshot was then
looked at. No page crashed into the error boundary and none overflowed with empty data. What the pass
found, by the standing question — what does this page show when the read fails, the value is blank,
or there are 178 rows:

| # | Page | Width | What is wrong | Rule / component |
|---|---|---|---|---|
| F1 | Shop | both | A failed read shows "0" open work orders and defects and "No parts on the shelves yet. Add the first part" — identical to an empty shop | D-US5 · `ShopPage` |
| F2 | Users | both | Failed members/invitations reads show "0 members · No members match" and "No invitations yet"; the failure is only a toast | D-US5 · `SettingsUsersPage` |
| F3 | Labels | both | A failed read shows "0 labels · Nothing on the shelves yet"; the sheet preview is an empty white card with its hint outside it | D-US5 · `LabelsPage` |
| F4 | Driver Qualification | both | The five tiles read 0 above a table that says "Could not load" | D-US5 · `StatCard` over a failed query |
| F5 | Data & Sync | both | Every job card says "never run" when the last-run read fails; three panels print a red line with no Retry | D-US5 · `JobActionCard`, `DataSyncPage` |
| F6 | Inspectors | both | A failed read shows the red notice "Nobody is on the register yet … no inspection can be started" | D-US5 · `InspectorRegisterPage` |
| F7 | Recall audit | both | A failed read says "No fills checked yet" and "Review batch (0 left)" | D-US5 |
| F8 | Reports | both | A failed odometer-accuracy read says "No verifiable odometer data yet … Run a Backfill" | D-US5 |
| F9 | Vehicle | both | Failed reads say "Not enough data to chart MPG yet", "No fills yet", "No anomalies" | D-US5 |
| F10 | Driver | both | The four qualification tiles say "Blocked" while the driver itself failed to load | D-US5 |
| F11 | Settings | both | Fleet readiness shows "0/0" with a green tick on a failed read and on an empty fleet | D-US5 |
| F12 | Planned Fueling | both | The settings read fails, but "Chain discount rules" still says "No discount rules" with Add rule and Save live — a save would write an empty list | D-US5 |
| F13 | Loads | both | Tab counts read 0 on a failure; the failure names "the dispatch board" | D-US5, voice |
| F14 | Detection coverage | both | With no fills every tile is a red "0%" and one a green "100%" — a zero denominator drawn as a verdict | blank value |
| F15 | Every toolbar list | both | The toolbar count says "0 <things>" while loading and on a failure | D-US5 · toolbar count |
| F16 | Alerts | both | A failed read leaves the skeleton up for good | D-US5 |
| F17 | Fleet report | both | A failed read leaves "Loading the overview…" up for good | D-US5 |
| F18 | ~50 read states | both | The failure text is `error.message` ahead of the page's own sentence: PostgREST's message on Drivers, Vehicles, Trailers, Fuel log, Idling, Reefer coverage, Odometer and Coverage; TanStack's `["…"] data is undefined` on Driver, Loads, Inspectors, Hazmat review, Recall audit and Applicants | D-US5, voice |
| F19 | Fuel cards, Fuel card, Hazmat review | both | A failure says "That did not work" | voice |
| F20 | Fuel problems, IFTA jurisdiction, Buy discipline | both | A red "Couldn't load X: Could not load Y" line with no Retry; Buy discipline says "Reload to try again" | D-US5 |
| F21 | Asset, Part, Unit, Annual inspection, Invoice check, Vehicle, Fuel card, Driver | both | A record that does not exist renders a blank page (five), a vehicle with no data (Vehicle), "Loading the card…" for good (Fuel card), or TanStack's message (Driver) | D-US5 — not found is a state |
| F22 | Fleet report, Applicants tabs | 390 | `AppTabs` wraps each label onto three lines; on Fleet report six tabs push the page 129 px wide | `AppTabs` |
| F23 | Odometer, IFTA | 390 | The Samsara freshness line neither wraps nor truncates (inline `truncate`) and runs 162 / 44 px off the page; it says "1 hours" | `SamsaraFeedLine`, `feedHealth.humanSpan` |
| F24 | Fuel cards | 1280 | The count prints twice ("0 cards  0 cards") — toolbar count and the export button's scope | toolbar |
| F25 | Driver Qualification | 390 | Each phone card opens with an empty row holding only the expand chevron | `DataTable` card mode |
| F26 | Drug & Alcohol | both | "Driving here, not in Med-Stop's random pool" lists 178 drivers unpaged (not a toolbar list, so D-US8 never saw it) | D-US8 |
| F27 | Driver Performance | both | The week reads `2026-10-12 → 2026-10-18` | dates are MM/DD/YYYY |
| F28 | Settings pages | 1280 | Two widths: Organization, Notifications, Thresholds, EFS, FleetPal, Med-Stop are a narrow centred column; Users, Data & Sync, McLeod fleets, Card control, Recruiting are full width | settings layout |
| F29 | Driver application | both | A carrier with no name on file reads "This is 's driver application." | blank value |
| F30 | Messages | both | "New message" is offered when Messages is not in the plan | entitlement |
| F31 | Driver Qualification (staging) | both | Carrier records answer 400: staging's org id `…0000a1` fails Zod 4's strict `z.uuid()` (version nibble 0). Production's id is a v4 UUID. 237 `z.uuid()` sites | Q-US3 |

Fixed in batches; each batch's PR names the rows it closes.

**2026-10-13 — US6b batch 1 (claude/ui-us6b-browser-pass): the systemic rows.** F18 → D-US9, a gate
rule with a self-test fixture (proven by disabling the binding pattern: the fixture fails), 45 read
states moved to their own sentence; two `ui-adoption: server-message` sites (Scan, the dispatch
drawer's route). Nine tests had pinned the raw message — three of them by name ("keeps the API's
sentence") — and now pin the sentence and the message's absence. F19: "That did not work" gone from
ten sites and refused by the gate. F20: Fuel problems, IFTA jurisdiction and Buy discipline's targets
draw their failure through the table / `QueryState` with a Retry wired to the reads that failed.
F22: every horizontal `AppTabs` strip scrolls and no tab wraps (`scrollable` removed; test fails on
the old strip). F23: the Samsara line wraps instead of running off a phone, and a one-hour bound reads
"1 hour" (both tests fail on the old code). F24: Fuel cards prints its count once; the export says
"every card" / "the cards as filtered". Rows F1–F17, F21, F25–F31 are the next batches.


**2026-10-13 — US6b batch 2 (claude/ui-batch2-failed-reads): the pages that drew a failed read as an
answer.** F1–F17 closed; each site's test fails on the old code (proven by restoring the old file with
`cp`, never stash). What the fixes turned on:

- **F12 first, because it could lose data.** The chain discount rules are a replace-set, and the card
  sat outside every read state: a failed rules read left `[]` on screen with Add rule and Save live. The
  card now waits on its own read AND the planner settings' (its brand list comes from that read).
- **Reads that dropped their error.** Vehicle detail's three reads, `useJob`'s last-run read and the
  Users page's two lists read `data` and ignored the refusal, so a 500 was an empty answer — "No fills
  yet", "never run" on a job that runs nightly, "0 members". They throw now, and each panel has a Retry.
- **Disabled is not loading.** A read gated on another (`useDetectionEpoch`) reports `isLoading: false`
  while it waits, so Alerts, Vehicle and Driver drew "Nothing here" / "No anomalies" before asking.
  They use `isPending`. The Fleet report drew nothing while its period was chosen; it says it is loading.
- **F15 is one fix, not 46.** `DataWorkspace` holds its table's loading/failed state
  (`components/ui/workspaceTable.ts`) and `FilterBar` prints its count only once the table has answered.
  Report bars outside a workspace keep passing `null` themselves. The Loads tabs do the same per read.
- **`StatCard` can fail.** `:error` (the page's sentence) draws a dash, the sentence and a Retry, and
  drops the tile's link and toggle so the Retry is the only control in it. Shop's six tiles use it.
  New gate rule: a `StatCard` with `:loading` and no `:error`, or a `:value` falling back to `?? 0`, is
  refused unless `ui-adoption: stat-guarded — <why>` (five sites: Fleet report's headlines, drawn only
  inside the overview's state, and the qualification strip, withheld on a failure). Self-test fixture
  proven by disabling the rule.
- **A share of nothing is a dash** (F14): Coverage's tiles over a zero denominator show "—" and the
  reason, and Fleet readiness reads "None yet" for a row with nothing to count instead of "0/0" ✓ (F11).
- **Labels' Shelves list had never sent its read** (found while re-shooting F3). It called the shelf
  walk's `useStockQuery(ref(undefined))`, which since 2026-09-09 reads an undefined location as "not
  chosen yet" and stays disabled; production holds 0 stock lines today, so nobody saw it. Every shelf is
  `useAllStockQuery()` now.

Re-shot with the failure fixture at 1280 and 390 (16 s settle: Alerts and the Fleet report chain two
reads' retries, ~14 s) and looked at; Coverage and Settings re-shot with the empty fixture.

| # | Page | Width | What is wrong | Rule / component |
|---|---|---|---|---|
| F32 | Labels | both | The shelves are ONE response from `/stock`, capped at 200 lines (`PAGE_MAX`), then searched and paged on the client — a shop past 200 shelf lines would see the first 200 and no sign of the rest. 0 lines in production today | D-US8 · needs server paging with a server search, as the asset list has |

Next: batch 3 (F21, F25–F32).

### 2026-10-14 — US6b batch 3, F21: not-found is its own state (D-US10)

The finding named eight record pages; the gate rule written for it found six more, so fourteen
routed record pages now answer a missing record the same way:

- **One error type, one helper, one retry rule.** `lib/notFound.ts` holds `NotFoundError`,
  `recordOrThrow` (a 404 is `NotFoundError`, any other refusal a plain `Error`) and
  `retryUnlessNotFound`, which `main.ts` installs as the query default. A real 404 used to cost
  three retries — seven seconds of "Loading the asset…" — and then "Could not load" beside a Retry
  that could only fail again. Its own module, not `lib/api.ts`, because 88 test files replace
  `@/lib/api` with a factory that knows `apiFetch` alone.
- **`QueryState` draws it.** A `NotFoundError` renders `NotFoundState` (sentence + "Back to <list>"
  from `meta.parent`, through `useOpens`), and the compact form says the sentence alone.
  `not-found-text` is the page's sentence.
- **The eight pages of F21.** Asset, Part, Unit, Annual inspection and Invoice check give their
  `QueryState` a sentence; Invoice check's `null`-for-404 and its hand-written callout went. Vehicle's
  `.maybeSingle()` with no row is `NotFoundError`, and its kit, MPG, fills and anomalies panels go
  with the truck. Fuel card left `ErrorState` and the header's permanent "Loading the card…" for
  `QueryState`; its card read turns EFS's 404 into `NotFoundError` and its 429 rule folds in
  `retryUnlessNotFound`. Driver had never shown its own read at all: it has a loading line, a
  failure with Retry, and not-found replaces the page (the export button goes too).
- **Vehicle and Driver gained `meta.parent`** (`/vehicles`, `/drivers`), so they now have the
  breadcrumb, the shell's Back and the way back that the other record pages had.
- **Six more, found by the rule.** Roadside inspection, Hazmat load, Load details and Count (their
  reads through `recordOrThrow`), and Applicant record (its `.maybeSingle()`; the checklist,
  disposition and drawers go with the applicant). Count's failure sentence lost "It may not be on
  file", because a missing walk now says so on its own.
- **Gate rule.** `lint:ui-adoption` reads the route table: a page behind a path with a parameter
  (the catch-all aside) has a `not-found-text`, or says `ui-adoption: not-a-record — <why>` — Apply
  (a public token with its own dead-link card) and IFTA jurisdiction (a code, not a record). The
  self-test fixture was proven by disabling the rule. What it cannot see — whether the read really
  throws `NotFoundError` — is `pages/recordNotFound.test.ts`, which mounts all fourteen pages with
  their real hooks, a real query client on the app's defaults and the real route table against an
  API that answers 404, and asks for the sentence, the way back, no Retry, one request, and the
  sections gone. Sixteen mutants (the 404 branch, the retry rule, `QueryState`'s branch, the way
  back, each page's conversion and each page's hiding) all fail it.

Shot at 1280 and 390 against a fixture that answers 404 for every record endpoint, and looked at.
Not covered: a malformed id (not a UUID). A route that queries before it validates — Driver's roster
route is one — meets Postgres's `22P02` and answers 500, so the page says "Could not load" with a
Retry rather than not-found. Recorded, not routed around: what the API accepts as an id is Q-US3's
question, and the answer belongs in the routes, not in a guess the browser makes.

### 2026-10-14 — US6b batch 3, F25–F30 (F31 waits on Q-US3; F32 is its own pair of PRs)

- **F25 — a label-less column is a control, not a field.** `DataTableCards` made the first column the
  card's heading, and the qualification table's first column is its expand chevron (label `""`), so
  every phone card opened with an empty row holding only the chevron. A column with no label now sits
  on the card's top line beside the status, and the heading is the first named column — for every
  table, not one page. Test fails on the old file.
- **F26 — the Drug & Alcohol lists page.** `useClientPage` (`composables/`) pages a list one response
  answers whole; the two roster lists, the results and both medical-card lists use it, with the pager
  only past one page. Their page stays local: no toolbar, nothing for a link to keep (D-US2).
- **F27 — one date range, from `displayDate.ts`.** `formatDisplayDateRange` (`10/12/2026 → 10/18/2026`;
  one day once; an open end in words). The contract's named blind spot — raw ISO interpolated into a
  template — had produced six ranges, not one: Driver Performance's week (three sites), Reports' range,
  the Inspectors register's period, the EFS import preview, Employment history's two windows and its
  gaps, and the export scope beside the Fuel Log's button — whose server twin, the `#` first line of
  every CSV (`csvExport.scopeLine`), now says the same in the same words. Filenames keep ISO, which
  sorts. A gate was tried and not kept: `to` is also an email recipient, `start`/`end` are as often
  clock times, and half the hits were already formatted — a rule that needs a marker on most of what
  it finds is a rule people learn to ignore. The blind spot stays named in the contract (§1.4).
- **F28 — one settings layout** (contract §3.3). Eight settings forms were a centred
  `max-w-2xl|3xl|5xl` column and six were full width, so the header moved 136 px between neighbouring
  entries of one menu. All are the full-width root now; Planned Fueling and Thresholds show a form
  reads well there. Gate rule: a page in `router/routes/settings.ts` whose root carries `mx-auto` or a
  `max-w-*` is refused (fixture proven by disabling the rule; the rule refuses the old Thresholds).
- **F29 — a carrier with no name is "the carrier", and a sentence opens in a capital.** The API's
  `?? "the carrier"` let an empty name through ("This is 's driver application."); it trims first now.
  Sixteen applicant sentences open with the carrier's name and read the fallback in lower case; they go
  through `sentenceCase` (a real name is unchanged). No migration: the Organization form already refuses
  a blank name and nothing else writes one.
- **F30 — Messages waits for the plan.** "New message" showed without Messages in the plan; and while
  the module read waited, or when it failed, the page told a customer who HAD Messages that it was not
  in their plan. The button follows the entitlement, and the entitlement read and the conversations
  read each draw loading / failure with Retry / answer. Four of the five page tests fail on the old page.
- **Found on the way: Messages' two columns never existed.** `lg:grid-cols-[320px,1fr]` — Tailwind 4
  builds nothing for a comma between tracks, so the thread list and the conversation stacked at every
  width. Fixed, and a gate rule refuses a comma before any `(` in an arbitrary grid template (fixture
  proven; the rule refuses the old page). It was the only one.
- **F31** stays open on Q-US3.
- **F32 needs schema.** PostgREST refuses an OR across a row and its embedded tables (measured: "failed
  to parse logic tree" for `parts.part_number…,stock_locations.name…`), so a server search over part
  number, description and location — the three fields Labels searches today — needs a view joining
  them. The view ships in one merge and its reader in the next (`MIGRATION-DISCIPLINE.md`). Production holds 0 parts and 0
  stock lines, so nothing is at risk while the pair lands.

Re-shot at 1280 and 390 with the failure, empty and row fixtures (Driver Qualification with six drivers,
Drug & Alcohol with 178 outside the pool, Messages with the plan and a failed conversations read).

### 2026-10-14 — US6b batch 3, F32: the Labels shelves page and search on the server

Two merges, as `MIGRATION-DISCIPLINE.md` asks of a new relation and its reader:

- **0474 `part_stock_lines`** (claude/labels-server-search): a stock line with its part number,
  description and location name on one row, `security_invoker = on`. PostgREST refuses an OR across a
  row and its embedded tables ("failed to parse logic tree", measured), and those are the three fields
  Labels searches. Matrix `part-stock-lines`: the three names on the row, one `or()` finding a line by
  each, a technician's token seeing only its own org through the view (four checks fail without
  `security_invoker` — the leak is in the output). `migrate-staging` applied it before the reader merged.
- **The reader** (claude/labels-shelf-search): `listStock` reads the view and takes `search` (one quoted
  `or()` over the three names), ordered by part then location so a page boundary cannot move; the view
  row is adapted back to `StockRow`, so `toStockLineDto` stays the one place a line is shaped.
  `useStockPageQuery` asks for one page of 20 with the search; the 200-line browser filter is gone and
  the pager counts the server's total. "No shelf matches that search." when a search finds nothing.
  Ten mutants across the two sides, all killed.

⚠ **A sibling, recorded rather than folded in:** the shelf walk's `useStockQuery(location)` reads the
same route with no `limit`, so a bay past 200 lines would be counted from its first 200. A walk must
count EVERY line — a page is the wrong answer there, as it was for `/low-stock` (which pages to the
end). Measured bays today: 0 lines in production. Fix with the walk's own read-to-the-end, not here.

Batch 3 is complete except F31 (Q-US3). Next: the sweep for what the gate does not check (§ after
batch 3), then US7 once Q-US1 is ruled.

### 2026-10-14 — The sweep after batch 3, part 1: tables that say nothing when empty, and row actions beside each other

Measured across `pages/`, `features/` and `components/` before anything changed (four kinds the gate did
not check):

| Kind | Found | Verdict |
|---|---:|---|
| `DataTable` with no `empty-text` / `#empty` | 17 | 5 reachable, 12 never empty |
| Row `#actions` with 2+ buttons outside a `KebabMenu` | 2 | both moved into a menu |
| `divide-y` lists | 33 | 4 hold records that read as a table (part 2) |
| `<p>`/`<div>`/`<span>` styled as a heading | 30 | ~7 are headings (part 2) |

**This part** (claude/ui-sweep-gate-blind):

- **Empty tables.** Two tables had a hand-written paragraph doing the table's job (the same-card fills
  in a case, the Fuel Log's card assignments); both now say it through `empty-text`. Three could show
  DataTable's bare "No results." — the expense families on a quiet period, the shelf walk's and the
  unit check's review — and now say what is empty. Twelve sit inside a `v-if` on their own rows (or are
  a fixed reference list) and carry `ui-adoption: never-empty — <why>`.
- **Row actions.** The applicant's invitation table (Review, Revoke) and the prior-employer inquiries
  (They answered, Document no reply) put two buttons side by side; both are a `KebabMenu`, Revoke last
  and `kebab-item-danger`.
- **Gate:** `lint:ui-adoption` fails a `DataTable` without `empty-text`/`#empty` (or the marker), and a
  row `#actions` slot with two or more buttons outside a `KebabMenu`. Self-test fixture: bare,
  self-closing, slot-filled, nested-in-`#expanded`, kebab, single-button and `PageHeader #actions`
  cases; four mutants of the checker (each half disabled, `#empty` ignored, `KebabMenu` ignored) all fail
  it. Contract §1 (empty state) and §5.6 (row actions) say so.

**Part 2, recorded for the next merge:** the four lists that are tables — `ActiveOverridesPanel`
(card, unit/driver, uses, scope, read age, two actions), `LocationsDrawer` (name, code, address, state,
three actions), `SignatoryRegister` and `IncidentDetail`'s attempts — and the headings drawn as text
(Messages' conversation title, the live map's unit panel, the load page's reference, the declined
attempt drawer's unit, the assistant's opening prompt). Found on the way and worse than the look:
`LocationsDrawer` and `AssetTypesDrawer` draw nothing while loading and "No locations yet" when the
read FAILS, and `ActiveOverridesPanel` hides itself on a failed read — a failure shown as an empty or
absent answer. Those come first in part 2.

Not gated, on purpose: whether a `divide-y` list "is a table" and whether bold text "is a heading" are
questions about meaning, and every markup rule tried against the 63 candidates flagged figures, list
item titles and button labels as often as real drift. They stay a review item.

Re-shot at 1280 and 390 with the empty fixture: the Fuel Log's card assignments drawer draws the
table's own empty line in the drawer.

### 2026-10-14 — The sweep after batch 3, part 2: failures shown as empty, two lists that were tables, four headings

(claude/ui-sweep-part2)

**Failure states first — each was a failed read showing as an answer:**

- **Asset kinds** (`AssetTypesDrawer`): `empty` was `(types ?? []).length === 0`. It was true while the
  read was in flight and true when it failed. So a shop whose kinds could not be read was offered
  "Set it up", and adopting the standard kit OVERWRITES the fleet's kit rules with the catalogue's
  numbers (the drawer's own header). Empty is now an answered read. Loading, and a failure with Retry,
  come from `QueryState`.
- **Stock locations** (`LocationsDrawer`): a failed read said "No locations yet. Add the shop itself
  first" to a shop that has bays. It now has three answers. The list is a `DataTable` (the code beside
  the name: a separate column pushed the row's menu 30 px past the drawer's 400 px edge, as measured in
  the browser). Edit and Close/Reopen are in the row's menu, and Close is the danger item.
- **Active fuel exceptions** (`ActiveOverridesPanel`): a failed read drew nothing, the same as before
  first data. It now says "Could not load the active fuel exceptions." with Retry. Nothing-before-data
  stays, for the panel's own reason. The rows (card, unit and driver, uses, where, read age) are a
  `DataTable`, and Re-read and Remove exception… are the row's menu. Remove exception… still opens the
  card's drawer with its confirmation.

**Headings drawn as text, now headings:** Messages' open conversation (`h2`, `text-sm`), the live map's
selected unit (`h2`, `text-sm`), the load page's reference (`h2`, `text-lg`, which is the record's own
title) and the declined attempt drawer's unit (`h3`, moved from `text-lg` to `text-sm`, the drawer
size, because it sat larger than the drawer's own title).

**Read and left as they are:**
- `SignatoryRegister` already has its three states, and each row reads as one sentence with one
  action. `IncidentDetail`'s attempts are a time and a source.
- `ScanPage` and `ScanResultCard` set their titles at `text-base` for the scan screen, which is read at
  arm's length in `ShopLayout`. The assistant's opening prompt, the Fleet readiness disclosure label
  (inside a button, where a heading may not go), the trip plan's timeline nodes and list item titles
  are not section headings.

**Seen on the way, not changed here:** on the Fuel Cards page at 390, the cards table's phone sort
picker opens blank, and its failure line "Could not load cards" has no full stop.

Tests that fail on the old code (with a `cp` backup, restored byte for byte):
- `inventoryDrawersReadStates.test.ts`: 3 of 5 fail on the old locations drawer and 1 of 5 on the old
  kinds drawer. The other cases pin behaviour that is kept.
- `ActiveOverridesPanel.test.ts`: 2 of 3 fail on the old panel.
- `DeclinesTab.table.test.ts`: the drill-down heading test fails with the old `div` in place.

Re-shot at 1280 and 390 with the rows, empty and failure fixtures (both drawers and the Fuel Cards
page), and looked at.


### 2026-10-15 — the three owed items from sweep step 2

Q-US1 and Q-US3 are still with the owner, so US7 and F31 wait; this entry closes what sweep step 2
saw and left.

**Shelf walk read a bay's first 200 lines.** `useStockQuery(location)` sent one `/stock` request with
no `limit`, which the route answers with its first 200 lines (`PAGE_MAX`). A bay holding line 201
would have walked as 200 bins and then "Every line is counted". It now reads to the end, 200 a
request, stopping on a short page and failing the whole read if any page fails, as `listLowStock`
does at the API. Every bay held 0 lines on 2026-10-14, so nobody had met it.

**Fuel Cards' phone sort picker opened blank.** The page's default order is `assignment`, which is
no column. `DataTableCards` bound the select straight to `sort.key`, matched no option, and drew a
direction arrow for an order no header shows. The card view now reads a key that is no sortable
column as "Default order", with no arrow. Fixed in the component, so no other page can hit it.

**Read-state sentences without a full stop.** "Could not load cards" was one of 18 table `:error`
sentences without one, beside 50 with. All 18 now end with a full stop, and `lint:ui-adoption` gained
`unstoppedFailureViolations`: a "Could not …" literal in a read state's `error` / `error-text` /
`message` (static or quoted in a binding) must end with one. Its self-test fixture fails with the
rule disabled. It cannot see a sentence built in the script and passed by name; contract §11 records
the rule.

Tests that fail on the old code (with a `cp` backup, restored byte for byte):
- `useInventory.wholeShelf.test.ts`: 2 of 3 fail on the old hook (the 450-line read, the failed
  later page). A mutant that breaks after the first page fails too.
- `DataTable.test.ts`: "reads a default order that is no column as Default order, with no direction
  arrow" fails on the old card view.

Re-shot at 1280 and 390 with the failure, empty and rows fixtures (Fuel Cards), plus the shelf walk
with a 450-line bay (three requests, "0 of 450 counted"), and looked at.

**Seen on the way, not changed here:** on the shelf walk at 390, the Ask AI orb sits over the bottom
bar's "Record count" button.

### 2026-10-15 — the three open questions answered (D-US11, D-US12, D-US13)

The owner asked for each question to be answered for what is right, not for what is cheaper to
build. All three were measured on `origin/main` at 97b7ecb before being answered:

- **Q-US1 → D-US11 (US7).** The composites' imports were read file by file. Nothing outside
  `vue-router`, `@vueuse/core` and `@floating-ui/vue` ties them to the web app, so they can move as
  they are. Admin has 11 `.vue` files: four tables are hand-headed `AppTable`s, and every read state
  is a hand-written "Loading…" with `e.message` ahead of the sentence.
- **Q-US2 → D-US12 (US8).** `GET /api/audit/log` already pages on a `(created_at, id)` keyset with
  `.lt` comparisons, so the cursor itself is the stable address. The recommendation in the question
  was "(b) until somebody asks". It is reversed, because the reader who needs the link is an
  auditor, not a teammate.
- **Q-US3 → D-US13 (US9).** There are 249 `z.uuid()` sites, not 237. The fixed `…0000a1` id is not
  only staging's seed: `docs/11-DEPLOYMENT.md` Stage 2 prescribes it for bootstrapping a real org.
  The id defaults are `gen_random_uuid()` in all 163 migrations that set one. On Zod 4.4.3,
  `z.guid()` accepts the staging id and refuses non-hex input.

Build order: US9 first (it unblocks F31 and every staging check), then US8 (one route and one page),
then US7 (the largest, a move of ~130 imports plus the admin rebuild).

### 2026-10-15 — US9: one record-id schema (D-US13), F31 closed

**The count was 283, not 249.** The 249 was `z.uuid()` alone. Another 31 sites spelled it
`z.string().uuid()` (16 in `packages/shared`, 15 in `apps/api`), and Zod 4 makes that just as
strict. Every one now reads `recordId()` from `packages/shared/src/recordId.ts`, built on `z.guid()`.
`fuel.ts`'s form sentence survives as `recordId("Select a vehicle")`.

**Eleven more copies, found on the way.** Eleven API files each held their own id regex
(`requestMetrics`, `audit`, `findingsAssign`, the fuel-spend statement/report/spend/exceptions
routes, fuel exports, document reading, livemap, applicant employer calls). They now call
`isRecordId()` from the same file. The apply draft's `EMPLOYER_KEY` regex was looser than the
contract's old `z.uuid()`, so it could keep a key the contract would then refuse on submit. It now
asks the contract's schema. `isRecordId` returns `boolean`, not a type guard: a guard narrows a
string that fails it to `never`, which the request-metrics path normaliser tripped on.

**The gate.** `lint:record-id` (`scripts/check-record-id.mjs`, in CI's `gates` job beside
`lint:date-format`) refuses a Zod id check (`z.uuid(` / `z.guid(` / `z.uuidv4|6|7(` / a chained
`.uuid()`) or a hand-written id regex anywhere outside `recordId.ts`. Comments are skipped. Test
files may use a regex to assert a VERSION (`draft.test.ts` checks a minted key is v4), but not a
Zod id check. Its `--self-test` has 14 cases, and planting a regex copy plus a `z.uuid()` in
`audit.ts` failed it.

**Tests that fail on the old code:** `recordId.test.ts`. With `z.guid` mutated back to `z.uuid`,
"accepts an id Postgres stores that is not an RFC 9562 uuid (version nibble 0)" and "lets Driver
Qualification read the carrier's own records on staging (US6b F31)" both fail. The second parses
`certificationListQuerySchema` with the staging org as an `organization` subject: the request
that answered 400.

**Two owed items in the same PR.**
- The Ask AI launcher no longer covers the shelf walk's "Record count" at 390. A fixed bottom bar
  registers its measured height (`composables/bottomChrome.ts`; `WalkActions` is the only such
  bar today), and `clampOffset` keeps the launcher at least that far plus `EDGE_MARGIN` above the
  bottom. The lift applies to what is rendered, never to the stored position, so the launcher is
  not left parked high on every other page. `useLauncherPosition.test.ts`: "keeps the launcher
  above a phone's fixed bottom bar, and leaves one parked higher alone" fails without the clamp.
  Seen in Chromium on the built app at 390 × 844: launcher bottom 775, bar top 783. At 1280 the
  launcher stays in its corner.
- `DeleteInspectionDrawer.vue`'s header no longer says that discarding a draft uses `window.confirm`.

Next: US8 (the audit log's cursor in the URL), then US7.

