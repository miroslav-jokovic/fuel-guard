-- 0628 — A truck's next-PM VERDICT beside its due point, so the Vehicles list can say "overdue" the
-- way the truck's page does (FLEETPAL-INTEGRATION-PLAN.md Q11, answered (d) by the owner 2026-11-17).
--
-- ── WHAT GAP ─────────────────────────────────────────────────────────────────────────────────────
-- F11 (`fleetpal/projectPmDue.ts`) writes `next_pm_due_odometer` / `next_pm_due_at` — the due POINT
-- only. The verdict `pmStatus` gives (overdue / due / ok) needs FleetPal's warning window, which is
-- not stored on `vehicles`, and a truck whose schedules cannot be judged is written NULL exactly like
-- a truck with no schedule. A list column built on the two due columns would need a second,
-- overdue-only rule beside `pmStatus` and would show a truck inside its warning window as fine.
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- One nullable text column, written by the same F11 pass from the same judged schedules
-- (`truckPmVerdict` in @silvicom/shared, over `judgeSchedule`'s per-schedule verdicts):
--   overdue · due · ok — `pmStatus`'s verdict, worst across the truck's non-annual schedules;
--   unknown           — a schedule exists that cannot be judged and none is overdue or due:
--                        "can't tell" is never "ok";
--   NULL              — no FleetPal schedule (or no FleetPal unit) — "no schedule", as the due
--                        columns already mean.
--
-- ⚠ DEPLOY WINDOW: a new nullable column with no writer or reader in this merge. The writer and the
-- list column follow in the next merge, once staging reports this schema current
-- (`lint:migration-ordering`).
--
-- Rollback: drop the column.

alter table public.vehicles
  add column if not exists next_pm_verdict text
    constraint vehicles_next_pm_verdict_check check (next_pm_verdict in ('overdue', 'due', 'ok', 'unknown'));

comment on column public.vehicles.next_pm_verdict is
  'F11/Q11: pmStatus''s verdict on the truck''s next PM, worst across its non-annual FleetPal schedules; unknown = a schedule that cannot be judged and nothing worse; NULL = no schedule. Written by fleetpal/projectPmDue.ts through roster''s recordVehiclePmDue.';
