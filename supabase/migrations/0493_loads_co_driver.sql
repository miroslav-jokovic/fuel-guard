-- 0493 — the second driver of a team load (LOADS-ACTIVITY-PLAN.md LA1, D-LA2).
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────────
-- McLeod names every driver on a movement (`mcleod_dispatch_movements.driver_codes`, text[]), and the
-- projection keeps only the first (`mcleodLoadProjection.ts`, "— X shown"). Measured on production
-- 2026-10-19: 28 of 942 movements are team runs, the largest has 2 drivers, and every second driver
-- (MHOUSTON, WILLKENO, MGARZA, LFEAGIN…) read as having hauled NO load since the mirror began, while
-- HOS had two of them driving at that moment. An activity view built on `loads.driver_id` alone
-- would name exactly the drivers who are working hardest as the idle ones.
--
-- One nullable column, not a `load_drivers` table: McLeod's own maximum is two, the projection writes
-- both on every sync (D-LMR4: core is rebuildable from raw), and every reader that already asks
-- "whose load is this" asks it of one row. A third driver would be a new table and a new ruling.
--
-- ── NO FOREIGN KEY, ON PURPOSE ───────────────────────────────────────────────────────────────────
-- `loads` has ONE reference to `drivers` (`driver_id`, 0085), and every reader embeds the driver as
-- `drivers(full_name)`: `LOAD_COLUMNS` behind the Loads page, the exceptions feed, the truck plan
-- read. A second reference makes that embed ambiguous, and PostgREST then refuses the whole query
-- (PGRST201) rather than guess. In a release this schema serves the OLD code for the deploy minutes,
-- so an FK here would have taken the Loads page down at 01:07 on release night. (`vehicles` could
-- take a co-driver FK in 0475 because it already had two driver references, so its readers already
-- named theirs.)
--
-- What an FK would have given is covered by the writer. The projection writes only an id its roster
-- resolver produced, never one it was handed. `drivers` refuses DELETE except inside `merge_driver`
-- (0235). After a merge, the relink pass (D-LA3) finds the load whose stored co-driver differs from
-- what McLeod's code resolves to now, the canonical driver, and re-projects it. Readers resolve the
-- name by a lookup, so an id the roster no longer holds reads as no name, not as an error.
--
-- ── SCHEMA ONLY, AND IN ITS OWN MERGE ────────────────────────────────────────────────────────────
-- A new column on a table written every sync (`lint:migration-ordering`): the projection that writes
-- it and the pages that read it follow once staging reports this schema. Nullable, no default: every
-- existing load reads null until its next projection, which is the truth — nobody has written the
-- second driver yet.

alter table loads
  add column if not exists co_driver_id uuid;

-- The activity read asks "every load this driver was on", as driver OR co-driver: the co-driver half
-- gets the index `idx_loads_org_driver_status` (0085) gives the driver half.
create index if not exists idx_loads_org_co_driver
  on loads (org_id, co_driver_id)
  where co_driver_id is not null;
