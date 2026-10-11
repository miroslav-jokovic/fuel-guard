-- 0420: which burn rate prices an idle hour — the configured figure or the engines' measured one
-- (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md §4 Q-IE14, owner: "implement as recommended", candidate (a)).
--
-- D-IE5 learns what an idling engine burns per declared equipment × ambient band (IE4, read from 0419's
-- interior idle hours since #1252) and SHOWS it beside the configured `idle_gal_per_hour`; it never
-- switched the money. This is the switch, stored per organisation:
--   'configured' — every idle hour is priced at `idle_gal_per_hour`, as today;
--   'learned'    — each park is priced at its truck's cohort × band rate when that cell is believed
--                  (≥ 5 trucks and a 95% interval within ±10%, `IDLE_BURN_SOURCE_LABELS`), else the nearest
--                  believed level, else the prior.
-- Default 'configured', so adding the column changes no figure anywhere. Flipping it for a carrier is
-- the carrier's own act from the Idling page, under the same safety-manage policy that already guards
-- the comfort band in this table (0300) — never a migration's, and never ours: the default decides what
-- a customer is shown.
--
-- ── MEASURED BEFORE WRITING (production, read-only, 2026-10-03 ~22:20Z) ─────────────────────────────
-- One idle_settings row (org 86d6b3ea, idle_gal_per_hour 0.80, fuel_price_per_gal 4.000); the test org
-- has none. information_schema matches 0044 column for column, so there is no drift to reconcile here.
-- What the switch would move (§7, 2026-10-03): the fleet's measured burn is ≈ 0.66 gal/h (interior hours
-- 0.658 over 941 h and 67 trucks; the learner's fleet level 0.653 ±6.8% over 81 trucks), so 'learned'
-- prices idle about 18% below 0.80 — the figure the owner sees before any carrier is asked to flip it.
--
-- ── WHY TEXT + CHECK, NOT A BOOLEAN ─────────────────────────────────────────────────────────────────
-- A boolean `use_learned` reads true/false where the question has two NAMED answers, and a third
-- (a per-cohort override, say) would need a second column. The check is the enum; the reader's merge
-- names the same two values once, as a union in packages/shared.
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md §the-deploy-window) ─────────────────────────────────
-- A column and its first reader ship in two merges (`lint:migration-ordering`). Nothing reads this yet;
-- the engine's money, the Idling page's control and IE5b read it in the next merge, held until
-- information_schema on production shows it. `idleSync.ts` upserts `idle_settings` with a partial
-- payload (grandfathered, suggestion columns only); a NOT NULL column WITH a default is filled on that
-- insert path, so the upsert keeps working.

alter table idle_settings
  add column idle_burn_source text not null default 'configured'
    constraint idle_settings_idle_burn_source_check check (idle_burn_source in ('configured', 'learned'));

comment on column idle_settings.idle_burn_source is
  'Q-IE14 (0420): ''configured'' prices idle at idle_gal_per_hour; ''learned'' at the engines'' measured rate (IE4). Default configured; the carrier flips it.';
