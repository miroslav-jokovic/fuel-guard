-- 0462: `vehicles.winding_down` — the TMS says this truck is being taken out of service
-- (DISPATCH-BOARD-PLAN D-DB11; owner ruled 2026-10-12).
--
-- ── WHY ──────────────────────────────────────────────────────────────────────────────────────────
-- The owner asked why 506, 552 and others show on the Dispatch board as if running. Measured that day
-- against the carrier's McLeod, read-only: all 27 trucks that had sent Samsara nothing for 7+ days and
-- bought no fuel carry `service_status = 'A'` (so P4 keeps them in the roster, D-FC0) but
-- `tractor_status = 'I'`, home fleet '1' (the parked pool) and an `outservice_date` in September or
-- October 2026 — dates the office set this autumn, not the years-stale ones D-FC2 refused to read.
-- Samsara names nine of them "- SOLD". They are sold or being retired and wait for pickup (Q-FL4):
-- still the carrier's, still on the Vehicles page, but not work anybody can dispatch.
--
-- McLeod already says so. Nothing here carries it: D-FC9 reads `tractor_status` only to turn 'S' into
-- `in_shop`, so the board had no way to tell a truck being wound down from a running one.
--
-- ── WHAT IT IS, AND WHAT IT IS NOT ───────────────────────────────────────────────────────────────
-- A FACT the TMS reports, sent by the agent as a neutral boolean (the letter stops in roster.mjs, the
-- rule `in_shop` follows). NOT membership — the truck stays `active`, keeps its inspections and stays
-- in the census until McLeod sets `service_status = 'I'` at pickup (D-FC0, Q-FL4 unchanged) — and NOT
-- a new `vehicle_status` value, which would have to be restated in the 17 places that enumerate it.
-- Readers decide what it means for their surface; the dispatch board hides it unless the truck is on
-- a load.
--
-- Nullable: null = no sweep has reported it yet (an older agent, or a truck the sweep has not placed).
-- A reader treats null as "not winding down" — the state every truck was shown in until today.
--
-- ── SCHEMA ONLY. NO READER, NO WRITER ────────────────────────────────────────────────────────────
-- The roster sweep's write and the board's read ship in the next merge (`lint:migration-ordering`).
--
-- raw-access-waiver: CREATES DDL
-- cross-module-waiver: one nullable column on roster's `vehicles`, written by mcleod's roster sweep
-- through roster's interface, beside the fleet code (0450) and the fuel-tax fact (0433) it already
-- records. No existing column, row or behaviour of any module changes.
alter table vehicles add column if not exists winding_down boolean;

comment on column vehicles.winding_down is
  'The TMS reports this truck as being taken out of service (McLeod tractor_status I) while it is still in service. A fact, not membership: status stays active until the TMS deactivates the truck (D-FC0). Null = not reported yet.';
