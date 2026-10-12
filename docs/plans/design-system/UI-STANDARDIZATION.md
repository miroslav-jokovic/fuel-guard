# UI standardization — every page and component on one set of rules

**Status:** IN EXECUTION — US0–US2 and US4 merged (2026-10-12); US3+US5 building; US6–US7 planned.
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
| US0 | This document; contract §5 brought up to date; adoption baseline regenerated | DONE 2026-10-12 |
| US1 | `useQueryState` grows what every list needs: a default that stays out of the URL, on/off flags, the page, a scope for two lists on one route, and ONE buffer per router (D-US2) | DONE 2026-10-12 |
| US2 | All 33 lists onto the URL; gate rule so a new list cannot skip it (closes G1) | MERGED 2026-10-12 |
| US3 | Every page notice through `AppCallout`, gated (closes G2) | BUILT 2026-10-12 with US5 (claude/ui-std-states) |
| US4 | `AppTable` call sites onto `DataTable` or a labelled exception; the gate counts `AppTable` as a raw table (closes G3) | MERGED 2026-10-12 |
| US5 | One loading / error vocabulary outside tables (`QueryState`), gated (G4) | BUILT 2026-10-12 |
| US5b | The three roster form drawers put Save in the footer; gate (G6) | planned, after US3+US5 |
| US6 | Detail-page anatomy (G5): one shared `FactList` for label/value facts, gated; then a browser pass of every routed page at 1280 px and 390 px | planned |
| US7 | Admin console onto the same list composites (G7) — after US6, its own decision | planned, Q-US1 |

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

## 6. Open questions

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
