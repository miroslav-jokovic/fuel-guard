-- 0421: `idle_engine_burn_inputs` (0409) is dropped — nothing has called it since #1252.
--
-- 0409 measured idle burn per PARK (a park's fuel delta over its running hours). The 2026-10-03 research
-- pass (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md §7) found every park carries its arrival and departure
-- minutes — the engine running while the truck creeps in and out, plus ~350 mL a park — so 0409 read
-- ~0.78 gal/h where whole interior idle hours read 0.658. 0419 (`idle_engine_burn_hours`) measures those
-- hours instead, and #1252 moved the learner (`IDLE_BURN_RPC` in packages/shared) onto it.
--
-- ── NOTHING CALLS IT (checked 2026-10-03 ~22:15Z) ───────────────────────────────────────────────────
-- Code: no TypeScript or SQL body on main names it (its matrix, idle-engine-burn-inputs.test.mjs, goes
-- with it). Served: Railway's `@fleetguard/api`, `@fleetguard/web` and `platform-console` all run
-- 5a08dee (#1252), the first commit whose office reader and console reader both call 0419. Production's
-- pg_proc holds both functions until this applies.
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md §the-deploy-window) ─────────────────────────────────
-- Order-independent: every served build already calls 0419, so no request can reach the dropped
-- function before or after this applies. A rollback to a build before #1252 would call it, so a rollback
-- that far restores 0409's function with it.

drop function if exists public.idle_engine_burn_inputs(uuid, timestamptz, timestamptz, integer[]);
