-- 0434: a fuel transaction can only name a truck and a driver of its OWN organisation
-- (DATABASE-AUDIT-2026-10-03-PLAN finding 4, Q-DA5; first table of the tenant-composite-key programme).
--
-- `fuel_transactions.vehicle_id → vehicles.id` and `driver_id → drivers.id` prove the row exists, not
-- that it is this org's. The API writes with the service role, which bypasses RLS, so until now the only
-- thing between a fill of org A and org B's truck was every writer remembering an `org_id` filter.
-- #1299 (2026-10-05) found three scoring writes that did not.
--
-- ── MEASURED (production, 2026-10-05) ────────────────────────────────────────────────────────────
-- 475 foreign keys; 189 join two tenant tables, 182 of them without org_id (the audit's "284 of 473"
-- was wrong). All 180 with under 300k child rows were checked in full: 0 cross-org links. The two
-- largest (scoring_attempts.transaction_id, hos_duty_segments.driver_id) sampled at 1%: 0 of 28,212.
-- So this is prevention, not repair. Sizes: fuel_transactions ~18,201 rows / 32 MB, vehicles 272,
-- drivers 303.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────────────────────────────
-- 1. Unique (org_id, id) on vehicles and drivers — the composite target. Cannot fail: id is already
--    the primary key.
-- 2. Composite keys fuel_transactions (org_id, vehicle_id) and (org_id, driver_id), ON DELETE RESTRICT
--    like the single-column keys they shadow. MATCH SIMPLE: an unattributed fill (NULL vehicle/driver)
--    is still allowed, as today.
-- 3. Added NOT VALID, then VALIDATEd: validation takes SHARE UPDATE EXCLUSIVE on fuel_transactions,
--    which does not block reads or writes.
-- The single-column keys stay. They are redundant once these exist, but dropping them is a separate,
-- reversible decision, not something to bundle with the first composite key.
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md) ─────────────────────────────────────────────────
-- No application change. A write that would now fail is one that already put another org's truck or
-- driver on a fill; none exists today. Rollback: drop the two constraints and two indexes.

create unique index if not exists uq_vehicles_org_id_id on public.vehicles (org_id, id);
create unique index if not exists uq_drivers_org_id_id on public.drivers (org_id, id);

alter table public.fuel_transactions
  add constraint fuel_transactions_vehicle_same_org
  foreign key (org_id, vehicle_id) references public.vehicles (org_id, id) on delete restrict
  not valid;
alter table public.fuel_transactions validate constraint fuel_transactions_vehicle_same_org;

alter table public.fuel_transactions
  add constraint fuel_transactions_driver_same_org
  foreign key (org_id, driver_id) references public.drivers (org_id, id) on delete restrict
  not valid;
alter table public.fuel_transactions validate constraint fuel_transactions_driver_same_org;
