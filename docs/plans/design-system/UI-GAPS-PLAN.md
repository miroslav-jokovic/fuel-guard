# Four gaps the Hope UI comparison found · 2026-08-25

This is an **execution document**: decisions are made, not surveyed; every step in §5 carries its
prerequisites, its build, its verification and its done-when. Unknowns are not assumed anywhere —
each lives in §6 with the fallback the code takes until the answer arrives.

**Provenance.** On 2026-08-25 the owner asked whether FuelGuard's dashboard should be redesigned to
match `iqonicdesignofficial/hope-ui-html-admin-dashboard` (MIT, 33 stars, last push 2023-09-26,
Bootstrap 5.2.3 + jQuery 3.6 + Gulp + Handlebars). The answer was **no** — §3 records why, so the
question is not re-opened every time somebody finds a free template. But the comparison was not
wasted: mapping Hope UI's 126 SCSS partials against our 21 primitives surfaced **four things it has
that we genuinely do not.** This plan is those four, and nothing else.

**✅ COMPLETE 2026-08-25.** All four steps shipped, plus #263 answering the two questions G1 left
open. Three of the five §6 questions are now closed; Q-UI3 (should `apps/admin` get any of this?)
and Q-UI4 (does anything show the maintenance page automatically?) remain open with their fallbacks
standing. Eight PRs for the steps themselves:
#250 + #251 (G1, which needed the route table split first), #253, #255 + #256 (G2), #258 + #259
(G3), #260 (G4). The step records in §5 carry what each one corrected, and those corrections are the
reason to keep reading this document rather than the diff. The short version, for anyone starting
something adjacent:

- **`router.resolve()` matches everything now** (G1's catch-all), so `matched.length` no longer
  proves a route exists — check the resolved name. This nearly produced a G2 test that passed on a
  deleted route.
- **`toneClass` is for pills, not for dots.** Pale `bg-*-50` plus an inset ring is invisible at 8px.
  G3 shipped that way first because §5 said to.
- **Every surface worth looking at is behind the auth wall.** G2, G3 and G4 all answered this the
  same way: keep the component prop-driven and router-free, then give `/__design-system` a specimen.
- **Check what the enclosing control already announces** before naming a decorative primitive (G4).
- **§5 was written before its consumers were read**, and said so three times over. A plan is a
  decision record, not a specification to follow past the point where the code disagrees.

**This plan is deliberately small.** It is additive component work. It is *not* part of
`DESIGN-SYSTEM-2026.md`'s D-DS1–15 sequence and does not renumber, reorder or block any phase of
it. It appends decisions **D-DS16–D-DS19** to that document's series so there is one decision
namespace, not two.

⚠ **Reka UI safety (D-DS11).** `DESIGN-SYSTEM-2026.md` phase 6 replaces Headless UI with Reka UI.
Every step below was chosen partly because **none of them needs a headless behaviour library**:
breadcrumbs are `RouterLink`s, the timeline is a static `<ol>`, the avatar is a `<span>`, the error
pages are static. Nothing here creates D-DS11 rework. Do not "improve" any of them into a
Headless UI component — that is the one change that would make this plan cost something later.

---

## 0. Ground truth, measured 2026-08-25 at `83907b1` (schema `0248`)

Counted, not recalled:

| Fact | Value | How it was measured |
|---|---|---|
| Routes in `apps/web/src/router/index.ts` | **64** | `grep -c 'path:'` |
| Routes carrying `meta.parent` | **24** | `grep -c 'parent:'` |
| Distinct `parent` targets | 6 — `/settings` (15), `/hazmat` (3), `/recruitment` (2), `/hazmat/loads` (2), `/loads` (1), `/fuel-cards` (1) | `grep -oE 'parent: "[^"]+"'` |
| Every `parent` target resolves to a real route | **yes**, all 6 | checked against `path:` declarations |
| Deepest real chain | **3 levels** — `/hazmat` → `/hazmat/loads` → `/hazmat/loads/:id` | two routes carry `parent: "/hazmat/loads"`, which itself carries `parent: "/hazmat"` |
| Catch-all / 404 route | **none exists** | no `:pathMatch`, no `/*`, no `NotFound` anywhere in the router |
| `.vue` files in `apps/web/src` | 198 | `find` |
| Barrel exports in `@fuelguard/ui` | 21 components | `packages/ui/src/index.ts` |
| Avatar implementations | **1, written twice in one file** | `SidebarProfileMenu.vue:54` and `:65`, both `.sidebar-avatar` from `style.css:168` |

⚠ **§0 was measured at `83907b1` and G1 has since changed three of its rows** (2026-08-25): there
IS a catch-all now, `router/index.ts` is ~87 lines rather than 480 because #250 split the table into
`routes/*.ts`, and the route count is 67. The rest still holds. The paragraph below is kept in the
past tense as the record of what G1 fixed.

**The 404 was a live defect, not a cosmetic gap.** `App.vue` selects `AppShell` for any route whose
`meta.layout` is unset. An unmatched path has no matched record at all, so `meta.layout` is
undefined, `AppShell` is chosen, and `<RouterView />` inside it renders **nothing**. A typo'd URL
today produces the full application chrome — sidebar, header, notification bell — wrapped around an
empty white content area, with no message and no way to tell a broken link from a broken app.

**⚠ The timeline gap is far smaller than the first pass claimed, and the plan is smaller for it.**
The initial comparison asserted that our audit and history surfaces "are naturally timelines."
Reading them disproved it. `AssignmentHistory.vue`, `CardChangeLog.vue`, `PlanHistory.vue`,
`CertificationHistory.vue`, `EmployerInquirySection.vue` and `EmploymentHistorySection.vue` are all
**filterable `DataTable`s with `FilterBar` above them** — search, date range, status facets,
pagination. They are correct as tables and this plan does not touch them. A timeline is the right
shape only where the rows are a *short, unfiltered, causally-ordered narrative about one entity*.
Exactly **one** such surface exists today, and its data already ships (§5, G3).

**⚠ A stale comment, in the gate script itself.** `scripts/ui-system-inventory.mjs:108–110` justifies
`ApplyPage.vue`'s header exception with "`PageHeader` carries the app's breadcrumb and route-title
chrome." `PageHeader` carries no breadcrumb — it never has. G2 makes that sentence true rather than
deleting it. A second stale comment, `AppShell.vue:93` ("Avatar initials from email (first char,
uppercased)"), sits above unrelated code; the initials logic moved to `SidebarProfileMenu.vue`. G4
removes it.

---

## 1. Decisions

### D-DS16 — A missing route gets a real page, and the router always matches something.
A catch-all route rendering `NotFoundPage.vue` is added last in the route table. It is
`requiresAuth: false`/`public: true` so an unauthenticated typo lands on "no such page" rather than
being bounced to a login form that will not explain itself. Two sibling pages ship with it:
`ServerErrorPage.vue` for a caught render failure and `MaintenancePage.vue` for the planned-downtime
case. **`PlaceholderPage.vue` is not reused and not deleted** — it says "this module is scaffolded
and built in a later phase," which is a true and different sentence from "this page does not exist."

**Why a page rather than a redirect to the dashboard.** A silent redirect destroys the evidence. The
user cannot tell whether they mistyped, whether a link in an email rotted, or whether the deploy
dropped a route — and neither can we, because there is nothing to report. The page names the path
it could not find.

### D-DS17 — Breadcrumbs derive from `meta.parent`; no route declares a trail by hand.
`meta.parent` already exists, is already correct on 24 routes, and already drives the back chevron.
Breadcrumbs walk that chain to its root and render it in `PageHeader`. **No `meta.breadcrumb` array
is introduced.** A hand-written trail is a second copy of the route graph that goes stale silently —
the same argument D-REC1 makes about derived state, applied to navigation.

**The back chevron stays.** It is in the header bar next to the sidebar toggle and it is a *control*
— one tap, thumb-reachable, always the same place. The breadcrumb is *orientation* — it says where
you are in a hierarchy three levels deep. They answer different questions and the app is not
crowded enough for one to have to lose. ⚠ Do not delete the chevron as "redundant" — that was
considered and rejected (§3).

### D-DS18 — The timeline ships as a local feature component, and is promoted to `@fuelguard/ui` only when a second consumer exists.
D-DS8 is enforced, not aspirational: `lint:ui-adoption` **fails the build on a barrel export with
no caller**, and four components were deleted on 2026-08-23 for exactly that. A primitive with one
consumer is a primitive whose API was designed by guessing. It is built where its one consumer
lives, and promoted when — and only when — a second one arrives, at which point the second consumer
is the evidence for what the shared API should be.

### D-DS19 — `AppAvatar` is an extraction, not a new capability, and ships only with its call site.
The avatar exists twice inside `SidebarProfileMenu.vue` and nowhere else in the product. There are
no avatars on drivers, applicants, assignments or audit rows, and this plan **does not add any** —
adding them is a product decision about whether a name plus a photo-less coloured circle helps
anyone scan a table, and nobody has asked for it. G4 therefore dedupes one file and registers one
primitive. If that reads as barely worth a PR, that is the correct reading: it is ranked last and
§7 says when to skip it.

---

## 2. Sequence

**One step per branch (`claude/<topic>`), PR to `main`, merge after CI.** `main` is branch-protected;
there is no other path. Ordered by defect-severity first, then by how much orientation the change
buys:

| Order | Step | Why here | Rough size |
|---|---|---|---|
| 1 | **G1 — error pages** ✅ DONE 2026-08-25 | The only one fixing a live defect. Cost two PRs, not one — the 500-line budget bit here rather than at G2. | shipped as #250 + #251 |
| 2 | **G2 — breadcrumbs** ✅ DONE 2026-08-25 | Highest orientation gain; 24 routes benefit with no per-route work. | shipped as #255 |
| 3 | **G3 — timeline** ✅ DONE 2026-08-25 | One consumer, whose data already shipped unrendered. | shipped as #258 |
| 4 | **G4 — avatar** ✅ DONE 2026-08-25 | Smallest, and §7 was right that it fixes nothing. | shipped as #260 |

G1 and G2 both touch `apps/web/src/router/index.ts` and will conflict textually if run in parallel.
Ship G1 first; rebase G2 on it.

---

## 3. Why the Hope UI redesign was rejected — so this is not re-litigated

Recorded once, with the measurements, so a future session finds the answer instead of the template.

- **Dead upstream.** Last commit 2023-09-26, 33 stars, 14 forks. The sibling `hope-ui-design-system`
  repo is larger (182 stars) and deader — last push 2022-02-07. There is **no Vue version on
  GitHub** under that org (`hope-ui-vue-admin-dashboard` returns 404); the Vue, React and Laravel
  variants the README advertises are paid Iqonic products, not the MIT repo.
- **Incompatible stack.** Bootstrap 5.2.3 + jQuery 3.6 + Gulp 4 + Handlebars, against our Vue 3.5 +
  Tailwind 4.3 + Vite. Its `DataTables.net`, offcanvas, dropdowns and sidebar toggles are all
  jQuery/Bootstrap-JS. In a Vue SPA there is no import path, only a port — and the port's output is
  what we already have.
- **It is a weaker system, not a stronger one.** Ours is three token layers in oklch with
  `light-dark()` dark mode and 20 machine-enforced gates. Hope UI is 126 hand-maintained SCSS
  partials including roughly 20 gradient variants. Adopting it would delete `lint:tokens`,
  `lint:tokens-parity`, `lint:light-dark`, `lint:ui-contrast` and `lint:chart-colors` — a quarter of
  the gate list — because none of them has anything left to check.
- **It would cost the domain.** Hope UI's dashboard shows generic e-commerce widgets. Ours shows
  gallon-weighted fleet MPG, idle waste in dollars, telematics corroboration coverage and
  severity-bucketed anomalies, each tile drilling into its detail page. That is the product.

**Also considered and rejected, within this plan:**

- *Delete the back chevron once breadcrumbs exist.* Rejected: the chevron is a fixed-position
  control and the breadcrumb is variable-width orientation text. On a narrow viewport the trail
  truncates; a truncated trail is a bad tap target and the chevron is the fallback.
- *A `meta.breadcrumb: string[]` per route.* Rejected under D-DS17 — 64 routes' worth of hand-copied
  hierarchy with no gate able to tell when it drifts.
- *Build `AppTimeline` in `@fuelguard/ui` now, "since we'll want it."* Rejected under D-DS8 and
  D-DS18. `lint:ui-adoption` would fail the PR outright.
- *Hope UI's form wizard, kanban, calendar, pricing and credit-card components.* Rejected: no
  product need. Multi-step onboarding is the only plausible future consumer and it is not scheduled.
- *RTL support.* Rejected for now: no market demand, and it is a whole-app concern rather than a
  four-component one. Recorded here so it is a decision and not an oversight.

---

## 4. Execution protocol — read before executing anything, every session

**Resume ritual (a fresh chat starts here):**

1. Read this document top to bottom, then `DESIGN-SYSTEM-2026.md` §1 (D-DS1–15) and §7 (the gate
   list), then the `CLAUDE.md` of the root and of `apps/web`.
2. ⚠ **The gates outrank the contract.** `docs/DESIGN-SYSTEM-CONTRACT.md` has drifted. Read
   `scripts/ui-system-inventory.mjs` and `apps/web/scripts/check-design-tokens.mjs` and trust those.
3. Establish reality: `git log --oneline -15`, then confirm the §0 measurements still hold before
   relying on any of them. If a count has moved, fix §0 in place in the same PR.
4. Find the first §5 step not marked **DONE**. Check its prerequisites against §6; a missing
   prerequisite means *run the fallback written next to it* — it never means guess.
5. When a step ships, mark it **— DONE `<date>`** in place with a "What shipped" list and a
   "Verified by:" line naming the gates actually run. **This document is the memory between
   sessions; the chat is not.**

**Rules every step below must keep (gate names verified against root `package.json` on 2026-08-25):**

- `pnpm --filter web lint:tokens` after **any** template or style change. Semantic roles only.
  No raw palette utilities, no hex, no inline colour styles. Only the seven text sizes
  (`2xs, xs, sm, base, lg, 2xl, 3xl`) — the gate reads them from `TEXT_SIZES` at
  `check-design-tokens.mjs:92`. Only the named elevations the gate reads out of
  `tokens.generated.css` at `check-design-tokens.mjs:54` — today `shadow-card`,
  `shadow-card-raised`, `shadow-overlay`, `shadow-dialog`, `shadow-sticky-edge`. Anything else
  fails, including a future `shadow-3xl`.
  `ring|border|divide|outline-neutral-*` is banned. `text-ink-subtle` is banned outright.
- `pnpm lint:ui-adoption` — and know its five relevant failure modes before writing UI:
  1. a routed page in `apps/web/src/pages/` **without `<PageHeader`** fails unless it is in
     `allowedHeaderExceptions` (`ui-system-inventory.mjs:104`);
  2. a raw `<button>`, `<input>` or `<select>` anywhere under `pages/` or `features/` fails —
     use `AppButton` / `AppIconButton` / `AppInput` / `AppSelect`;
  3. a visible raw `<table>` fails — use `DataTable`;
  4. a local clone named `BaseButton.vue`, `BaseCard.vue`, `BaseInput.vue`, `BaseCheckbox.vue`,
     `BaseSwitch.vue`, `ComboSelect.vue`, `FormField.vue` under `components/ui/`, or
     `components/SearchInput.vue`, fails;
  5. **a `@fuelguard/ui` barrel export with no caller fails** (D-DS8). A component used only inside
     `packages/ui` counts as alive.
- Primitives are imported aliased at the import site:
  `import { AppCard as BaseCard, AppButton as BaseButton } from "@fuelguard/ui"`.
- Every badge is `[BADGE_BASE, toneClass(...)]` from `@/lib/badges`. No local tone maps, no status
  string literals in templates.
- Icons come from `@fuelguard/ui/icons`; a new one is added to `packages/ui/src/icons.ts` first.
  Never import `@hugeicons/core-free-icons` directly from an app.
- 500-line file budget (warn 450), 200-line function budget (`lint:filesize`, `lint:funcsize`).
  `AppShell.vue` is at **365** and `router/index.ts` at **480** — G2 must not push the router past
  500. If it would, the route table splits by area before the feature lands, not after.
- A comment claiming test coverage ("proves", "pinned by") must quote a **real** test title —
  `lint:comment-claims` checks the string against the suite. Write the test first, then the comment.
- **To see a change:** `pnpm --filter @fuelguard/web preview:local` (builds, serves :4173, design
  lab on, no login). ⚠ `pnpm dev` crashes on some machines with
  `WebAssembly.Memory.grow(): Maximum memory size exceeded` inside vite's rolldown optimiser. That
  is environmental, happens before your code is touched, and is **not** a regression from the change
  (D-DS13).
- Gates before any PR: `pnpm test`, `pnpm typecheck`, `pnpm lint`, plus the step's named extras.

**No step in this plan touches the database.** There is no migration, no RLS policy, no PGlite
matrix, no API route. If a step starts to need one, stop — it has grown past what was decided here.

---

## 5. The steps

### G1 — The router always matches something — DONE 2026-08-25 (PRs #250, #251)

**The defect, precisely.** No catch-all route exists (§0). `App.vue` falls through to `AppShell` for
any route without `meta.layout`, and an unmatched path has no matched record, so `meta.layout` is
undefined. Result: full app chrome around an empty `<main>`. Silent.

**Prerequisites:** none.

**Build:**
- `apps/web/src/pages/NotFoundPage.vue` — states the path that was not found (from
  `route.fullPath`), offers one primary action back to `/` and one secondary to the previous entry
  in history. Uses `<PageHeader>`; see the gate note below.
- `apps/web/src/pages/ServerErrorPage.vue` — for the caught-render case. Shows a correlation handle
  the user can quote. ⚠ **Open question Q-UI1 (§6) governs what that handle is** — take the fallback
  until it is answered.
- `apps/web/src/pages/MaintenancePage.vue` — planned downtime. Static; no data fetch, because the
  reason it is shown may be that fetching does not work.
- Route record appended **last** in `routes`, `path: "/:pathMatch(.*)*"`, `name: "not-found"`,
  `meta: { public: true, title: "Page not found" }`.
- `ServerErrorPage` and `MaintenancePage` get named routes (`/error`, `/maintenance`) so they are
  reachable and testable; both `public: true`.

**⚠ Two gate traps in this step:**
1. All three land in `apps/web/src/pages/`, so `lint:ui-adoption` demands `<PageHeader>` on each.
   Use it — do **not** add them to `allowedHeaderExceptions`. An error page with the app's own
   header is the honest rendering: the chrome is fine, the page is what is missing.
   ⚠ But `NotFoundPage` is reachable **unauthenticated**, and `PageHeader` renders inside whichever
   layout `App.vue` picks. Verify in the browser that the unauthenticated 404 is legible; if the
   shell around it is wrong for a signed-out visitor, the fix is a `meta.layout` on the route, not
   an exception entry.
2. Back/home actions are `AppButton` or `RouterLink` — a raw `<button>` in `pages/` fails the gate.

**Verification:**
- New `apps/web/src/router/notFound.test.ts`: resolving `/nope/nope` yields the `not-found` record;
  resolving each of the 64 declared paths does **not**.
- Browser, via `preview:local`: `/nope` signed out, `/nope` signed in, `/error`, `/maintenance`.
- `pnpm --filter @fuelguard/web test`, `pnpm --filter web lint:tokens`, `pnpm lint:ui-adoption`,
  `pnpm typecheck`.

**Done when:** an unknown URL renders a page that names the path, in both signed-in and signed-out
states; `PlaceholderPage.vue` is untouched; the router test passes.

**What shipped.** `NotFoundPage.vue`, `ServerErrorPage.vue`, `MaintenancePage.vue`, a shared
`components/ErrorPanel.vue` for their common body, `router/routes/system.ts` holding the two operator
routes plus the catch-all exported separately, `lib/layout.ts` + its test, and the three route
records. `PlaceholderPage.vue` untouched, as specified.

**Verified by:** `pnpm --filter @fuelguard/web test` (68 files, 600 tests) including
`router/notFound.test.ts` and `lib/layout.test.ts`; `typecheck`; `lint:ui-adoption`, `lint:tokens`,
`lint:filesize`, `lint:comment-claims`, `lint:boundaries`, eslint; CI `build` green on both PRs.
Browser-checked signed-out at `/nope`, `/error`, `/maintenance` via `preview:local`.

**Three corrections a later step should not have to re-derive:**

1. ⚠ **The budget bit at G1, not G2.** §4 predicted `router/index.ts` would survive until G2. Three
   route records took it 480 → **514**, a hard `lint:filesize` failure. #250 split the table into
   nine area modules first, with snapshots captured against the unsplit table as the equivalence
   proof; index.ts is ~87 lines now and the budget is no longer near. **G2's budget warning in §4 is
   therefore spent** — it has room.
2. ⚠ **A public route needed two layouts, not one.** §4's gate note anticipated `meta.layout` might
   be the fix and it was not quite: the choice depends on the *session*, not the route. `AppShell`
   calls `useModulesQuery()` unconditionally, so rendering it signed-out fires a guaranteed 401
   behind the page. The mechanism is `meta.layoutWhenSignedOut`, resolved by `resolveLayout()` in
   `lib/layout.ts` — a pure function, so **G2's `breadcrumbs.ts` has a precedent to copy** for
   keeping router-adjacent rules testable without mounting anything.
3. The equivalence snapshots from #250 **failed on G1's own routes**, which is the harness working.
   Updating them was deliberate and the diff was 40 insertions, 0 deletions. Any step adding a route
   from here on must expect that failure and read the diff rather than reflexively passing `-u`.

---

### G2 — Breadcrumbs derived from `meta.parent` — DONE 2026-08-25 (PR #255)

**Prerequisites:** G1 merged (both edit the router; rebase rather than parallelise).

**Build:**
- `apps/web/src/lib/breadcrumbs.ts` — a **pure** function
  `buildTrail(path: string, resolve: (p: string) => RouteMeta | null): Crumb[]`. Walks `meta.parent`
  to the root, returns `[{ label, to }]` root-first with the current page last. Two hard
  requirements, both from the fact that this walks a graph:
  - **cycle-safe** — a `Set` of visited paths; on a repeat, stop and return what is built so far;
  - **depth-capped** at 5, so a future mistake degrades instead of hanging the render.
  Pure and dependency-free so it is unit-testable without mounting a router.
- `PageHeader.vue` renders the trail above the `<h1>` when it has ≥2 entries, as
  `<nav aria-label="Breadcrumb"><ol>`, the last crumb carrying `aria-current="page"` and rendering
  as text rather than a link. Below `sm`, show only the immediate parent — the chevron is the
  full-trail fallback on narrow screens (D-DS17).
- `AppPageHeader.vue` in `packages/ui` is **not** changed. ⚠ Not for the reason it is tempting to
  write down: `lint:boundaries` (`check-feature-boundaries.mjs`) does **not** police `packages/ui`
  at all, and `packages/ui` already imports `vue-router` — `AppButton.vue:3` pulls in `RouterLink`
  (undeclared in its `package.json`, which is a real but separate problem; do not fix it here).
  The actual reason is the **other consumer**: `apps/admin` renders `AppPageHeader` and carries
  `meta.parent` on none of its routes (Q-UI3). The parent-chain convention is a web-app convention,
  so the walk lives in the web app. `AppPageHeader` already exposes a `#back` slot, which is the
  seam if admin ever wants a trail.
- ⚠ Update the now-true comment at `ui-system-inventory.mjs:108–110`.
- ⚠ `router/index.ts` is at 480 of a 500-line budget. G2 should add ~1 line; if it adds more,
  split the route table by area first, in its own PR.

**Verification:**
- `apps/web/src/lib/breadcrumbs.test.ts` — the real 3-level chain
  (`/hazmat/loads/:id` → `/hazmat/loads` → `/hazmat`); a 1-level route returns a single crumb and
  renders nothing; an unknown parent truncates rather than throwing; a synthetic cycle terminates;
  depth cap holds.
- A test asserting **every** `meta.parent` in the router resolves to a declared route. All 6 do
  today (§0); this keeps it true. ⚠ This is the test the breadcrumb feature is actually worth —
  without it, a renamed route silently produces a dead crumb.
- `axe-core` check on a 3-level page — the suite already uses it
  (`components/ui/accessibilityPrimitives.test.ts`).
- Browser: `/hazmat/loads/<id>`, a `/settings` child, and a top-level page (which must show none).

**Done when:** the 24 `parent`-carrying routes show a trail; top-level pages show none; the back
chevron still works; the parent-resolution test passes.

**What shipped.** `lib/breadcrumbs.ts` (pure walk), `components/ui/BreadcrumbTrail.vue`
(presentational), `PageHeader.vue` wiring the two, three test files, a permanent specimen in the
design lab, and the `ui-system-inventory.mjs:108` comment made true.

**Verified by:** 622 tests — `lib/breadcrumbs.test.ts` (8), `components/ui/PageHeader.test.ts` (6,
including an axe-core run on a three-level trail), `router/breadcrumbTargets.test.ts` (4);
typecheck; `lint:ui-adoption`, `lint:tokens`, `lint:filesize`, `lint:comment-claims`,
`lint:boundaries`, `lint:codegen`, eslint; CI `build` green. Browser at 1200px and 390px.

**Four things a later step should not re-derive:**

1. ⚠ **G1's catch-all changed what `router.resolve` proves.** It now matches *everything*, so
   `matched.length > 0` is no longer evidence that a route exists — the obvious way to write the
   parent-resolution test would have passed on a deleted route. Both the test and `PageHeader` ask
   whether the resolved name is `not-found`. **Any future code asking "does this path exist?" has
   the same trap.**
2. **The plan predicted the render, not the split.** G2 shipped `BreadcrumbTrail.vue` as a separate
   presentational component, which §5 did not call for. The reason is D-DS13: every page that grows
   a trail is behind the auth wall, so without a router-free, session-free component there is no way
   to look at this in the browser. **G3 has the same problem** — `EntityHistory` needs an anomaly —
   and the same answer is available.
3. A design-lab specimen pointing at the route it renders on makes `RouterLink` stamp
   `aria-current="page"` on it, which reads as a component bug and is not one. Point specimens at
   real, other paths.
4. `vue/multi-word-component-names` is on: `Breadcrumbs.vue` failed eslint and became
   `BreadcrumbTrail.vue`. A one-word component name will not land.

---

### G3 — A timeline, where there is one — DONE 2026-08-25 (PR #258)

**Prerequisites:** none. ⚠ Read §0's timeline note first — the six filterable history tables are
**out of scope** and must not be converted.

**The one consumer.** `apps/web/src/features/anomalies/EntityHistory.vue` declares
`nearThresholdTimeline: { fueledAt: string; score: number; signals: string[] }[]` in its
`PatternAnalysis` interface. The API returns it. **The template never renders it.** It is a short,
unfiltered, causally-ordered narrative about one entity — the exact shape a table serves badly and a
timeline serves well — and shipping it costs no backend work at all.

**Build:**
- `apps/web/src/features/anomalies/CaseTimeline.vue` — local to the feature, per D-DS18. A static
  `<ol>`: a rail, a marker per entry toned by severity, timestamp, and the signal labels via
  `formatRuleId` (already imported in `EntityHistory.vue`).
- Render it inside the existing Phase-2 pattern-report block, collapsed by default if it exceeds ~8
  entries, using `AppButton variant="ghost"` for the toggle.
- Marker tones come from `@/lib/badges` `toneClass`. **No local tone `Record`** — that is the
  R0b/A1 rule and `InquiryQueuePage.vue` and `ApplicationInviteCard.vue` were both fixed for it.
- ⚠ **Do not export it from `packages/ui`.** `lint:ui-adoption` would fail on a single-consumer
  barrel export, and D-DS18 says the second consumer designs the shared API.

**Verification:**
- `CaseTimeline.test.ts`: renders in `fueledAt` order; empty array renders nothing (not an empty
  rail); the collapse threshold works; severity tone comes from `badges.ts`.
- Browser: an anomaly with a pattern report. ⚠ If no seeded case has a non-empty
  `nearThresholdTimeline`, that is **Q-UI2** (§6) — take the fallback, do not fabricate one.
- `pnpm --filter web lint:tokens`, `pnpm lint:ui-adoption`, `pnpm --filter @fuelguard/web test`.

**Done when:** `nearThresholdTimeline` is visible on a real case; nothing under `features/` outside
`anomalies/` changed; no barrel export was added.

**What shipped.** `features/anomalies/CaseTimeline.vue` + its 10-case test, wired into
`EntityHistory.vue`'s Phase-2 block, `nearMissMarker()` in `lib/badges.ts`, and a specimen in the
design lab. No barrel export; nothing under `features/` outside `anomalies/` touched.

**Verified by:** `CaseTimeline.test.ts` (10); typecheck; `lint:ui-adoption`, `lint:tokens`,
`lint:filesize`, `lint:comment-claims`, `lint:boundaries`, eslint; CI `build` green. Browser at
`/__design-system`.

**Four corrections:**

1. ⚠ **§5's `toneClass` instruction was wrong and the browser proved it in one look.** Those are
   pill classes — pale `bg-*-50` plus `ring-1 ring-inset` — right behind 11px of text and
   **invisible as an 8px dot**. Markers need a solid fill; they take one from a small map in
   `badges.ts`, so the mapping still lives in one place. Neutral uses the `edge-strong` ROLE, not a
   `neutral-*` ramp. **Any future dot, rail marker or status pip has this trap.**
2. **The payload is truncated and the plan did not say so.** `entityRisk.ts` sends
   `nearThreshold.slice(-20)` while `nearThresholdTotal` counts the whole window, so
   `entries.length` is not the total. The component says "most recent 20 of 35" when they differ.
3. **Ordering was under-specified.** "In `fueledAt` order" fixes no direction. Shipped newest-first
   and sorted in the component, so an upstream change to `analyzeFills` cannot silently reverse it.
4. The marker breakpoint is `CORRELATION_THRESHOLDS.review`, exported from `@fuelguard/shared` —
   not a number chosen for the UI. A `clear` fill whose signals SUM past the lone-review weight is
   one the engine deliberately let through.

**Q-UI2 was open at ship time and is now answered** (2026-08-25, §6): no seeded case had been
confirmed, so the fallback was taken — fixtures plus a design-lab specimen, no fabricated case.
Production has since confirmed it decisively: **36 of 36** pattern reports carry a non-empty vehicle
timeline, 281 entries in all, and the truncation notice and collapse threshold both fire on real
data (4 and 8 reports respectively).

---

### G4 — `AppAvatar`, extracted — DONE 2026-08-25 (PR #260) · *was* skippable, see §7

**Prerequisites:** none.

**Build:**
- `packages/ui/src/components/AppAvatar.vue` — props `label: string`, `size?: "sm" | "md"`. Derives
  its letters from `label`; renders a `<span>` with `aria-hidden` on the glyph and the full label as
  the accessible name. Carries the `.sidebar-avatar` treatment as component styles.
- Export from `packages/ui/src/index.ts`.
- **Replace both instances in `SidebarProfileMenu.vue` in the same PR** — that is the call site
  `lint:ui-adoption`'s dead-export rule requires, and there is no other today.
- Move `.sidebar-avatar` out of `apps/web/src/style.css:168` once nothing references it (D-DS9's
  direction: the sidebar stops being CSS).
- ⚠ Delete the stale comment at `AppShell.vue:93`.
- Register it in the lab's "Shipped primitives" section (`apps/web/src/dev/DesignSystemLabPage.vue`)
  — and drop the hand-rolled `.prototype-avatar` at line 169 while there.

**Scope fence:** this adds avatars to **no** driver, applicant, assignment or audit surface. Doing
so is a separate product decision nobody has asked for.

**Verification:** `AppAvatar.test.ts` (initials from one word and from two; accessible name is the
full label, not the letters); `pnpm lint:ui-adoption`; visual check of the sidebar collapsed and
expanded, in both colour schemes.

**Done when:** one implementation exists, the sidebar uses it twice, `lint:ui-adoption` is green,
and both stale comments are gone.

**What shipped.** `packages/ui/src/components/AppAvatar.vue` + an 8-case test, the barrel export,
both `SidebarProfileMenu.vue` instances replaced, `.sidebar-avatar` deleted from `style.css`, the
stale `AppShell.vue` comment removed, and a lab specimen. No avatars added to any product surface.

**Verified by:** `AppAvatar.test.ts` (8); typecheck; `lint:ui-adoption` (the gate that would have
failed on a caller-less barrel export), `lint:tokens`, `lint:filesize`, `lint:comment-claims`,
`lint:boundaries`, `lint:ui-contrast`, `lint:codegen`, eslint; CI `build` green. Browser at
`/__design-system` in both colour schemes.

**Three corrections — all of them §5 describing a consumer it had not read:**

1. ⚠ **It contributes NO accessible name**, against §5's instruction. Both call sites are inside a
   `KebabMenu` whose trigger already announces "Account menu for <email>"; naming the avatar too
   makes a screen reader read the address **twice**. An avatar is decoration for a label that is
   already present. **This generalises**: before giving any decorative primitive a name, check what
   the enclosing control already announces.
2. **The initials rule is one rule, not two.** §5 asked for "one word and two words"; the only data
   the product has is an *email*, where two initials are meaningless. Split on whitespace, take the
   first and last word's first letter — `M` for an address, `MR` for a name, no `@` special-casing.
3. **The lab's `.prototype-avatar` stays**, against §5. It belongs to the A/B mock that deliberately
   uses the `--prototype-*` vocabulary rather than real components; converting it would break the
   comparison that section exists for. ⚠ Nothing in the `prototype-*` block should be migrated to a
   shipped primitive for the same reason.

---

## 6. Open questions — with the fallback the code takes until answered

- ~~**Q-UI1 — what correlation handle does `ServerErrorPage` show?**~~ **ANSWERED 2026-08-25
  (PR #263).** A Sentry event id is reachable, but *only* behind a `getClient()` check. Measured on
  `@sentry/vue` 10.69.0 with no `Sentry.init` — the state of every dev and preview build, since the
  DSN is optional: `getClient()` returns undefined, `lastEventId()` returns undefined, and
  **`captureException()` still returns a plausible 32-hex id for an event that went nowhere.** A
  reference built from that return value would have a carrier quoting an identifier matching nothing
  in Sentry — worse than none, because it looks authoritative. `lib/errorReference.ts` holds the rule
  and the measurement; `ServerErrorPage` and `ErrorBoundary` share it so they cannot drift.
- ~~**Q-UI2 — does any non-production-seeded anomaly carry a non-empty `nearThresholdTimeline`?**~~
  **ANSWERED 2026-08-25 against production** (`supabase db query --linked`, read-only): **yes,
  overwhelmingly.** Of 36 `case_pattern_reports`, **36/36** carry a non-empty vehicle timeline and
  35/36 a driver one — 281 entries in total, scores spanning 40–95.
  ⚠ Both behaviours G3 added that §5 never asked for fire on real data: **4 of 36 reports exceed the
  20-entry payload cap** (largest window 29, so 9 near misses would have gone unmentioned without the
  "most recent 20 of 29" line), and **8 of 36 exceed the 8-entry collapse threshold**. The marker
  split is not degenerate either: **75 of 281 entries (26.7%) score ≥ 60** and take the warning
  fill.
- **Q-UI3 — should `apps/admin` get any of this?** It has 8 `.vue` files, a 90-line `AppShell`, no
  `meta.parent` on any route, and no 404 either. *Fallback:* out of scope. Nothing here is written
  in a way that blocks a later port; `breadcrumbs.ts` is pure and would move as-is. Revisit only if
  the admin console grows past ~15 pages.
- ~~**Q-UI5 — should a global error boundary route to `/error`?**~~ **ANSWERED 2026-08-25
  (PR #263): yes, but it renders in place rather than routing.** The gap is narrower than it sounds
  and therefore real — vue-query's `isError` already handles a failed *query* in 61 places, with a
  retry; a failed *render* had nothing. A redirect would discard the URL, which is the one thing
  making the failure reproducible, so `components/ErrorBoundary.vue` renders the explanation where
  the page was, and `/error` stays the route an operator sends somebody to.
  ⚠ Two findings worth carrying: `onErrorCaptured` **must** return `false`, or the throwing child is
  re-patched and throws again — the first cut did not, and contained nothing. And only the `AppShell`
  branch is wrapped, because `/__design-system` is a dev surface where an error should be loud.
- **Q-UI4 — does the maintenance page ever get shown automatically?** Nothing sets it today, so it
  is a manually-visited URL. *Fallback:* ship it as a reachable route and leave the trigger for
  whoever needs it. ⚠ Do not add a health-check poll to the SPA for this — that is a new background
  behaviour and it is not decided here.

---

## 7. When to skip G4 — *retained; it was right*

**Executed anyway on 2026-08-25 (#260) after G1–G3 landed and the cost was an hour.** The judgement
below stands unaltered and was accurate: G4 fixed no defect and added no capability. It is kept as
written because the reasoning is the reusable part — a primitive whose whole effect is that one
letter is rendered by a component instead of a `<span>` is tidying, and tidying is what gets cut
when a plan meets a deadline. What it *did* buy, unforeseen here, was the removal of the last
`.sidebar-avatar` stylesheet rule (D-DS9) and a third specimen in the design lab.

### The original argument

If the four steps are being executed under time pressure, **G4 is the one to drop.** It fixes no
defect, adds no capability, and its entire user-visible effect is that one letter in the sidebar is
rendered by a component instead of by a `<span>`. G1 fixes a live defect. G2 improves orientation on
24 routes. G3 renders data we already pay to compute and currently throw away. G4 is tidying.

It is written up anyway because leaving it undocumented means the next session re-discovers the
duplication, re-argues it, and possibly builds the speculative `AppAvatar` that D-DS19 and
`lint:ui-adoption` exist to prevent.

---

## 8. The gate list these four steps must keep green

`pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm lint:ui-adoption` ·
`pnpm --filter web lint:tokens` · `pnpm lint:tokens-parity` · `pnpm lint:light-dark` ·
`pnpm lint:ui-contrast` · `pnpm lint:boundaries` · `pnpm lint:filesize` · `pnpm lint:funcsize` ·
`pnpm lint:comment-claims`

Not applicable to any step here, and their absence from a PR is expected rather than an omission:
`lint:migrations`, `lint:rls`, `lint:upserts`, `lint:chart-colors`, `lint:codegen`, `lint:wsdl`,
`lint:mcleod-recon`, `lint:secrets`, `lint:cli-streams`, `lint:token-schema`, `lint:tests`.

---

## 9. Sources

- `iqonicdesignofficial/hope-ui-html-admin-dashboard` — repo metadata and full recursive file tree
  read via `gh api` on 2026-08-25: MIT, 33 stars, 14 forks, last push 2023-09-26, 2,419 tracked
  paths, 126 SCSS partials, 59 HTML pages, 7 shell layouts. Dependencies read from its
  `package.json`: bootstrap 5.2.3, jquery 3.6, apexcharts 3.27, datatables.net-bs5, flatpickr,
  nouislider, swiper 6, smooth-scrollbar, fslightbox, waypoints, counterup2, popper.
- `iqonicdesignofficial/hope-ui-design-system` — 182 stars, last push 2022-02-07.
  `hope-ui-vue-admin-dashboard` — **404, does not exist.**
- FuelGuard measurements: the tree at `83907b1`, schema `0248`, all counts in §0 taken by command
  on 2026-08-25.
- Canon not superseded by this plan: `DESIGN-SYSTEM-2026.md` (D-DS1–15),
  `docs/DESIGN-SYSTEM-CONTRACT.md` (⚠ drifted — the gates outrank it),
  `docs/MIGRATION-DISCIPLINE.md` (not engaged: no step here touches the schema).
