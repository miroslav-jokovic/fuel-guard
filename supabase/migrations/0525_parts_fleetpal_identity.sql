-- 0525 — the parts catalogue learns its FleetPal identity (FLEETPAL-INTEGRATION-PLAN.md step F12;
-- D-FP11; owner 2026-10-27, MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md Q-MX2: "We have full FleetPal
-- access via API, why are we not populating parts in there?").
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────────────────────────
-- Three additive things on `parts`, a maintenance-owned table (D-ARC3), and nothing on any shelf:
--
--   1. `fleetpal_id` — the vendor's own id for the catalogue entry. FleetPal's `number` is unique per
--      company but a part can be RENUMBERED, and the sync must then update the row in place rather
--      than create a second part with the old one's history orphaned under it. Unique per org where
--      set (a partial index, so the parts the shop typed by hand before the sync are untouched).
--   2. `fleetpal_unit` — the unit of measure exactly as FleetPal sent it. FleetPal has 23 values and
--      metric-heavy ones (`bx`, `cs`, `disp`, `ea`, `m`, `L`, `hr`, `cm`, …) against this table's
--      eleven; the mapping lives in `shared` with an explicit `unmapped` outcome, and the raw word is
--      kept so a person can see WHAT was unmapped and decide, rather than reading a silent `each`.
--   3. `unit_of_measure` admits `'unmapped'`. The plan's done-when is that an unmappable unit
--      "surfaces as unmapped on the part rather than as each", and the CHECK is where `each` would
--      otherwise be forced. Nothing writes the value until the sync ships (the next merge, per
--      MIGRATION-DISCIPLINE.md §the-deploy-window), so no reader meets it before it understands it.
--
-- ── WHAT DOES NOT CHANGE ────────────────────────────────────────────────────────────────────────
-- No quantity and no location arrive from FleetPal: its `Part` has neither (D-FP11, measured F4), so
-- `part_stock` and the count session stay the only source of what is on a shelf. The owner's
-- 2026-10-27 ruling that shop inventory "will be pulled from FleetPal" is satisfied by the CATALOGUE
-- arriving; the opening balance is still a count, as D-FP11 says.
--
-- No RLS change: the table's policies are unchanged and the new columns are read under them.

alter table public.parts
  add column fleetpal_id text check (length(fleetpal_id) between 1 and 64),
  add column fleetpal_unit text check (length(fleetpal_unit) <= 32);

comment on column public.parts.fleetpal_id is
  'FleetPal''s id for this catalogue entry (F12). Null for a part the shop entered by hand. Unique per org where set, so a renumbered part updates in place.';
comment on column public.parts.fleetpal_unit is
  'FleetPal''s unit of measure as sent, kept beside the mapped unit_of_measure so an ''unmapped'' one can be read and decided by a person.';

create unique index parts_org_fleetpal_id_key
  on public.parts (org_id, fleetpal_id)
  where fleetpal_id is not null;

-- The inline CHECK 0331 wrote carries Postgres's default name for a column check.
alter table public.parts drop constraint parts_unit_of_measure_check;
alter table public.parts add constraint parts_unit_of_measure_check
  check (unit_of_measure in ('each','pair','set','case','box','roll','foot','gallon','quart','litre','pound','unmapped'));
