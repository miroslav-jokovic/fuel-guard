-- 0384: a McLeod load's customer by name, beside `customer_code` (LOADS-MIRROR-PLAN.md Q-LMR5).
--
-- The core half of 0383, which gave the raw mirror `customer_name`; the reasons, the grant and the
-- measurement are there. Here: `loads.customer_name` — what the board and the load page show,
-- written only by the projection from raw (D-LMR4), so it is rebuildable by re-running it.
-- `customer_code` (0366) stays: it is the key McLeod joins on, and a name is not a key (44 distinct
-- names on the 2026-09-29 board, no uniqueness promised).
--
-- Schema only, in its own merge (`lint:migration-ordering`). Nullable, no default: a manual load has
-- no McLeod customer, and a McLeod load reads null until the next sync.

alter table loads
  add column if not exists customer_name text;  -- projected from mcleod_dispatch_movements.customer_name
