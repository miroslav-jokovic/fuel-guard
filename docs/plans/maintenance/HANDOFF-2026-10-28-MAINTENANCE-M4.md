# Handoff — Maintenance redesign, next step M4 (2026-10-28)

Paste this into a fresh chat. It is also saved at
`docs/plans/maintenance/HANDOFF-2026-10-28-MAINTENANCE-M4.md` (untracked — commit it with M4's PR).

Read `docs/plans/maintenance/MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md` (§3 principles, §4.5 the
phone rules, §8 the log), `docs/DESIGN-SYSTEM-CONTRACT.md` (§5 tables, §8 anti-patterns — §9 does
not exist yet; M4 writes it) and the memory file `maintenance-section-redesign-position.md` first,
then build M4.

## Where we are

Owner brief 2026-10-27: Maintenance must be "super easy, optimized for tablets and phones". The
proposal merged (#1798), the owner said "make these updates as proposed" and answered all six
questions (§6). Five PRs are MERGED to main and on staging; production gets them at the next approved
nightly release:

| PR | Step | What |
|---|---|---|
| #1799 | M1 | Glossary (Units → Trucks & trailers, Assets → Equipment, Kit → Should carry, Stock locations → Places, Inspectors → Who can inspect); four sidebar rows; Who can inspect is a Settings card; sold trucks off the shop's lists. No surface KEY changed (D-MX6). |
| #1800 | M2 | Shop home = one worklist (`ShopWorklistSection.vue`, groups drawn only with rows, quiet-day callout, `WalkActions` header + phone bottom bar for Scan / Count a shelf, repair-bills tile under the list); `GET /api/maintenance/annual-due`. |
| #1801 + #1803 | F12 | Parts fill from FleetPal (migration 0525; hourly `ingestParts` through `syncFleetpalPart`). |
| **#1806** | **M3** | **The truck's page is the hub** (`pages/UnitDetailPage.vue`): Needs attention · In the shop / Found on an inspection / Repair history (+ one repair-bills line through F9b, printed only with its "at least N%" bound) · Due (every FleetPal PM schedule, `pmStatus`) · Annual inspection (+ Start inspection, drawer preset) · Equipment it carries (`features/inventory/UnitEquipmentSection.vue`, the old page's controls) · Roadside inspections · Papers. No tabs; Check what is on board + Start inspection in the header and the phone's bottom bar. **Trucks & trailers** (`pages/UnitsPage.vue`) opens on `?show=attention` (default), rows = number · one sentence · last checked; `?show=short` (home's link) and `?show=all`. Reads: `GET /api/maintenance/units/attention` (`maintenance/unitAttention.ts`, one derivation for list + page) and `GET /api/maintenance/units/:kind/:id/shop-file` (`routes/unitHub.ts`). F11: `projectPmDue` after every FleetPal sweep writes `vehicles.next_pm_due_*` through roster's `recordVehiclePmDue`. **D-FP22**: PM judged on the roster's (Samsara) odometer, FleetPal's meter shown beside it (median gap 109 mi, measured 10/28). Screenshots: `docs/plans/maintenance/screenshots/m3-*.png`. |

Rulings in force: D-MX1 three doors (Shop · Trucks & trailers · Annual inspections); D-MX2 no counter
without its list; D-MX3 the truck's page is the hub; D-MX4 plain word leads; **D-MX5 phone/tablet are
the primary size**; D-MX6 keys never change. Users: the maintenance employee, in-shop workers and the
inspector, on tablet/phone with the Tera scanner + MUNBYN label printer (Q-MX1).

Owner still owes: switching "Who can inspect" on for fleet_manager and the inspector's role (Settings
→ Permissions); after the release, Settings → FleetPal → Sync now (expect ≈3,558 parts).

## M4 — the phone rules (proposal §4.5; owner Q-MX6 "as proposed, with the best solution")

Write **§9 Phone and tablet** into `docs/DESIGN-SYSTEM-CONTRACT.md` and GATE it, then apply it to
every `/shop*` screen. The eight rules, with what is measured today:

1. **48 × 48 px targets, 8 px apart**, row menus and chips included. M3's pass measured the hub on a
   phone at 4,115 px with 12 targets under 44 px, all SHARED controls: `AppButton` default (36 px),
   `FilterSelect` triggers (32), `KebabMenu` triggers (28), `TablePagination` Prev/Next (32), table
   sort headers (20), inline "See below"/link text (18–20), breadcrumb links (16). Fix the primitives
   below `md` (or a `size="touch"` the shop pages opt into — `AppButton` already has `touch`), not
   the pages one by one.
2. **Primary verbs in a bottom bar below `md`** — `features/inventory/WalkActions.vue` is the
   primitive (header row from `sm`, fixed bar below; `useBottomChrome` tells the shell its height so
   the Ask AI orb parks above it). Home and hub use it; make it the rule, not the exception.
3. **A card below `md` is three facts.** `DataTable` (`apps/web/src/components/ui/DataTable.vue`,
   `DataTableCards.vue` renders below 768 px via `useMediaQuery`) — add a `card: "title" | "sentence"
   | "meta" | "none"` marker on `DataTableColumn` (`DataTable.vue` line ~50) so a page STATES which
   three; the cards renderer draws those and nothing else; the gate refuses a `/shop` table whose
   columns carry no markers. The home's groups and the Trucks & trailers list already chose their
   three — mark them.
4. **A list opens filtered to what needs attention** — Trucks & trailers does (M3); check Parts,
   Equipment, Annual inspections against it.
5. **One way back below `md`**: the shell's Back (`layouts/AppShell.vue` ~line 421, `meta.parent`)
   OR the breadcrumb (`lib/breadcrumbs.ts`, drawn by `components/ui/PageHeader.vue`), not both.
   §1.2 measured both on every tablet page.
6. **Desk screens out of phone navigation**: Labels (needs a printer) stays reachable from Equipment
   and Parts, not in a phone's nav.
7. **Bottom tab row under `/shop`** below `md`: Shop · Trucks & trailers · Annual inspections, drawn
   only when the role holds `maintenance` and the route is under `/shop`; hamburger stays for the
   rest. Read the rows from `surfaceCatalogue.ts` (`group: "maintenance"`, no `parent`), never a
   hand list ("Surfaces start at call sites" — sidebar = NAV_SURFACES; `layouts/SidebarNavSection.vue`
   is how the sidebar derives its rows). It must coexist with `WalkActions`' bar (stack: verbs above
   the tab row) and with `useBottomChrome`.
8. **Staging banner one line below `md`** — `components/EnvironmentBanner.vue` (today two lines on a
   phone: "UAT — PSP orders reach the FMCSA test account…").

**The gate.** `lint:ui-adoption` is `scripts/ui-system-inventory.mjs --check` +
`scripts/check-template-integrity.mjs` (template parsers already exist — extend one, `--self-test`
must prove each new detector fires). Candidates: unmarked `DataTable` columns under `apps/web/src/pages`
for `/shop` routes; a page under `/shop` with a `PageHeader #actions` and no `WalkActions` bar;
Back + breadcrumb both rendered below `md` (a shell rule — may be a unit test rather than a template
scan). Add anything new to `ci.yml`'s `gates` job or chain it onto `lint:ui-adoption` and say so in
the `"//lint:ui-adoption"` comment (CLAUDE.md: a gate in neither list is not a gate).

**Done when:** every `/shop*` route at 390 × 844 and 834 × 1194 has zero targets under 48 px
(measure with the M3 script's method: `document.querySelectorAll("main button, main a[href]")`
bounding boxes), the hub is one scroll with one Back, the tab row shows on a phone under `/shop` and
nowhere else, the contract has §9 and a gate that fails on a regression; screenshots in the PR.

**Then M5**: the owner opens Shop, a truck's page and an annual inspection on the real Android
tablet and a phone, in the bay; findings logged in proposal §8 before anything is called done.

## How to work (traps met this week)

- Branch from `origin/main` in a sibling worktree (`git worktree add -b claude/<topic>
  ../FuelGuard-<name> origin/main`); `pnpm install --frozen-lockfile`, `pnpm --filter @silvicom/shared
  build:rn`, copy `apps/web/.env` and `apps/api/.env` from the main tree.
- PR with the four template headings (`.github/pull_request_template.md`) via `--body-file`;
  screenshots committed under `docs/plans/maintenance/screenshots/` and linked by raw URL; CI ≈ 15
  min; merge yourself when green (`gh pr merge --merge --delete-branch`). A PR behind main is
  REFUSED — rebase first; two PRs appending to the same plan log conflict (keep both entries).
  **Never push while a rebase is stopped.**
- Gates to run locally before pushing (check `$?`): `pnpm -r typecheck` (⚠ run the ROOT one — M3's
  CI failed on test-file type errors a per-package `vue-tsc` run had missed), lint, filesize (500-line
  budget; `surfaceCatalogue.ts` 499, `inventoryContract.ts` 497 — trim comments, not code), funcsize,
  surfaces, ui-adoption, comment-claims, boundaries (web features may NOT import sibling features —
  `WEB_ALLOW` is empty; promote shared pieces to `components/` or compose from a page), table-writers,
  record-id, date-format, tests (`CI=true` so a local timeout does not write snapshots).
- Web test traps: `vi.mock("vue-router")` must re-export `RouterLink`; `RouterLink` is unresolved in
  the home test (assert `to="…"` in html); a `<dl>` fails ui-adoption (use `FactList` + `#value-<key>`
  slots); a `DataTable` inside a `BaseCard` needs `embedded`; a prop named like a `ref` is
  `vue/no-dupe-keys`; jsdom has no width so `DataTable` renders cards — open rows via the component's
  `row-click` emit; `supabaseRecorder` writes are `w.write.payload`.
- Browser pass: `cd apps/web && VITE_DEV_BYPASS=true node scripts/preview-local.mjs --port 43xx`
  (read the port from the END of the log; it listens on IPv6 `localhost` only — `127.0.0.1` refuses),
  Playwright from `apps/web` with ONE `ctx.route` on `/\/(api|rest\/v1|auth\/v1|storage\/v1)\//`, RAW
  JSON (`{data: …}` for hooks that read `r.data.data`; `{units,total}`, `{sessions,total}`,
  `{inspections,total}` for the rest), 390 × 844 and 834 × 1194. The M3 script is the pattern.
- macOS has no `timeout`; prod reads via `supabase db query --linked "<sql>"` from the main tree;
  read-only probes as a tsx script under `apps/api/src/scripts/`, deleted after.

Memory START HERE: `maintenance-section-redesign-position.md` (M3 traps and D-FP22 recorded there).
