# Handoff — Maintenance redesign, next step M3 (2026-10-28)

Paste this into a fresh chat. It is also saved at
`docs/plans/maintenance/HANDOFF-2026-10-28-MAINTENANCE-M3.md` (untracked — commit it with M3's PR).

## Where we are

The owner reviewed the Maintenance section on 2026-10-27, I wrote
`docs/plans/maintenance/MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md` (merged #1798), the owner said
"make these updates as proposed" and answered all six questions (proposal §6). Four PRs are MERGED
to main and on staging; production gets them at the next approved nightly release:

| PR | Step | What |
|---|---|---|
| #1799 | M1 | Glossary applied everywhere (Units → Trucks & trailers, Assets → Equipment, Kit → Should carry, Stock locations → Places, Inspectors → Who can inspect, …); sidebar is four rows (Shop, Parts, Trucks & trailers, Annual inspections); Equipment `parent: maintenance.units`; the inspector register is a Settings card at `/settings/inspectors` (`reachedFrom: admin.settings`, `startsOnFor: []`, `group: "admin"`), `/shop/inspectors` redirects; sold/winding-down trucks excluded from the shop's list. No surface KEY changed. |
| #1800 | M2 | Shop home = one worklist: `ShopWorklistSection.vue` groups drawn only with rows (roadside due · defects · work orders · annual due ≤30 d · missing equipment · running low · open checks), quiet-day callout, `WalkActions` header + phone bottom bar for Scan / Count a shelf, repair-bills tile under the list; new `GET /api/maintenance/annual-due` (`readAnnualDue`). |
| #1801 | F12a | Migration 0525: `parts.fleetpal_id` (partial unique per org), `parts.fleetpal_unit`, CHECK admits `'unmapped'`. |
| #1803 | F12b | Hourly FleetPal parts sync through maintenance's `syncFleetpalPart` (`fleetpal/ingest/parts.ts`), unit map `packages/shared/src/fleetpal/units.ts`, screens show "Not mapped — FleetPal says …" and "Comes from: FleetPal". Decisions D-FP18–D-FP21 in the FleetPal plan log. |

Owner rulings in force: three jobs → three doors (D-MX1); no counter without its list (D-MX2); the
truck's page is the hub (D-MX3); plain word leads (D-MX4, glossary §4.4); phone/tablet are the
primary size (D-MX5); surface keys never change (D-MX6). Users = the maintenance employee, in-shop
workers and the inspector, on a tablet/phone with the Tera scanner + MUNBYN label printer.

Two things only the owner does: switch "Who can inspect" on for fleet_manager and the inspector's
role (Settings → Permissions); after the release, Settings → FleetPal → Sync now (expect ≈3,558 parts).

## M3 — the hub page (proposal §4.3; FleetPal F10 + F11)

**Goal.** One page per truck or trailer with, in order: Needs attention (its rows from the worklist)
· In the shop / repair history (FleetPal work orders, cost split, downtime) · Due (PM schedules vs
latest meter — F11) · Annual inspection (last report, expiry, Start inspection) · Equipment it carries
(the kit card, "Check what is on board") · Papers (unit files). **No tabs.** The Trucks & trailers list
opens filtered to "needs attention" with "all" one tap away; phone cards = three facts.

**Decide this FIRST — there are already two pages per truck.** The FLEET section's
`VehicleDetailPage.vue` / `TrailerDetailPage.vue` (`/vehicles/:id`, `/trailers/:id`, section
`equipment`) already mount `UnitFileSection`, `UnitWorkOrdersCard` (FleetPal work orders),
`UnitInspectionsCard`, and the kit card (D-AVI17). The SHOP's `UnitDetailPage.vue`
(`/shop/units/:kind/:id`, section `maintenance`) has only the kit card, open checks and the override
drawer. D-MX3 + the house rule against a second source of truth say: one hub, the cards shared
between the two sections — recommended: make the shop's unit page compose the SAME card components
(they live in `features/roadside`, `features/evidence`, `features/inventory`, `features/maintenance`)
rather than duplicating markup, and keep both addresses because the sections are gated differently
(technician has no `equipment` section). Check `packages/shared/src/auth.ts` for who holds what.

**Facts for F10/F11.** Production FleetPal tables are populated: 270 work orders (n_live_tup),
747 jobs, 723 service history, 69 open defects, 1,185 PM schedules + 1,230 intervals, 146k meters,
505 units. `vehicles.next_pm_due_odometer` / `next_pm_due_at` have had NO writer since 0099 —
F11 computes due from `fleetpal_pm_schedules`/`_intervals` against the latest meter and writes through
a ROSTER-module exported writer (D-FP2; add one to roster in its own PR if none exists). `resolveUnits.ts`
turns `activeOnly` OFF to reach a sold truck that still owns repairs. Eight VINs appear twice in
`fleetpal_units` → per-unit reads must `.in()` over every matching row. VMRS component labels resolve
live (`fleetpal/vmrs.ts`, 1 h cache, null on failure). FleetPal plan F10's done-when: Playwright route
mocks with RAW JSON in `route.fulfill`, screenshots in the PR.

**Then M4** (proposal §4.5): design-contract §9 for phones/tablets with a gate (48 px targets, bottom
bar below `md`, three facts per card via a `DataTable` column `card:` marker, lists open on "needs
attention", one way back, desk-only screens out of phone nav, bottom tab row Shop · Trucks & trailers ·
Annual inspections under `/shop`, staging banner one line). **Then M5**: the owner's pass on the real
tablet in the bay, findings in proposal §8.

## How to work (traps met this week)

- Branch from `origin/main` in a sibling worktree; `pnpm install --frozen-lockfile`,
  `pnpm --filter @silvicom/shared build:rn`, copy `apps/web/.env` and `apps/api/.env` from the main tree.
- PR with the four template headings via `--body-file`; CI ≈ 15 min; merge yourself when green
  (`gh pr merge --merge --delete-branch`). A PR behind main is REFUSED — rebase first; two PRs that
  append to the same plan log conflict (keep both entries). **Never push while a rebase is stopped.**
- Any migration: regenerate and COMMIT `supabase/schema.generated.sql` (`pnpm lint:table-writers`
  does it); next free number is **0526**; column and first reader in two merges.
- Gates to run locally before pushing: lint, filesize (500-line budget — trim comments, e.g.
  `surfaceCatalogue.ts` 499, `inventoryContract.ts` 497), funcsize, surfaces, ui-adoption,
  comment-claims, boundaries (declare edges with a reason in `scripts/check-feature-boundaries.mjs`),
  table-writers (list new writers in `scripts/table-writers.json`), tests, record-id, date-format.
- `MaintenanceHomePage.test.ts`: `RouterLink` is unresolved — assert `to="…"` in html, not `<a>`.
  Work-orders/defects/roadside answer to `maintenance.repair-spend` (deny THAT in tests). FilterBar
  count labels are singularised (`packages/ui/src/lists/plural.ts`, corpus test).
- `listEquipmentIdentities` has `excludeWindingDown`; `isSoldAwaitingPickup` reads "- SOLD".
- Staging browser pass: fleet-manager test member (`staging-test-members` memory), Playwright
  script in the scratchpad, 390 × 844 and 834 × 1194.
- macOS has no `timeout`; the FleetPal key is in `apps/api/.env`; read-only probes via a tsx script
  under `apps/api/src/scripts/` (delete after).

Memory START HERE: `maintenance-section-redesign-position.md`.
