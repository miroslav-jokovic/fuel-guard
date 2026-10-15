-- 0475: `vehicles.co_driver_id` — the second driver of a team truck (seats audit, 2026-10-15).
--
-- ── WHY ──────────────────────────────────────────────────────────────────────────────────────────
-- The Operations tab's "Drivers without a truck" read 8 on 2026-10-15. Checked against the carrier's
-- McLeod and Samsara, three of the eight were driving that day: Krystal Dixon on 697, Manuel Garza on
-- 717 and Christopher Sital on 729 — each the second driver of a TEAM truck. `assigned_driver_id`
-- holds one driver (DRIVER-APP-PLAN D50), so the seat sync (`planDriverSeats`) gives the truck to
-- whoever of the team started last and the teammate is on no truck at all. The sync already knows
-- the teammate — `parseDriverCurrentTrucks` places every driver, teams included — it has nowhere to
-- write them.
--
-- ── WHAT IT IS ───────────────────────────────────────────────────────────────────────────────────
-- Current state, written by the same sync that writes `assigned_driver_id` and re-derived on every
-- identity pass: the other driver Samsara currently places in this truck. Null = a solo truck, or one
-- no sync has placed a second driver in. `on delete set null`, as `assigned_driver_id` has since 0003.
-- NOT identity: it is not in 0241's claim list, so writing it never claims a row from McLeod.
--
-- ── SCHEMA ONLY. NO READER, NO WRITER ────────────────────────────────────────────────────────────
-- The sync's write and the seat count's read ship in the next merge (`lint:migration-ordering`).
--
-- ── NOT IN THE MERGE'S MOVE LIST, ON PURPOSE ─────────────────────────────────────────────────────
-- `check-driver-references` exempts it, for 0467's reason: it is a placement the sync rewrites every
-- pass, not a fact anybody recorded. A merge clears it (`on delete set null`) and the next identity
-- pass seats the canonical driver. Moving it instead could carry a duplicate's stale placement onto
-- the canonical row, where nothing would notice until the next pass anyway.
--
-- cross-module-waiver: one nullable column on roster's `vehicles`, written by samsara's seat sync
-- beside `assigned_driver_id`, which it already writes. No existing column, row or behaviour changes.
alter table vehicles
  add column if not exists co_driver_id uuid references drivers(id) on delete set null;

comment on column vehicles.co_driver_id is
  'The second driver of a team truck, as the Samsara seat sync last placed them (assigned_driver_id holds the first). Current state, re-derived every identity sync. Null = solo or not placed.';
