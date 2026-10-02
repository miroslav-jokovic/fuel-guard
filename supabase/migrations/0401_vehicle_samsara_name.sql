-- 0401 — keep the name Samsara gives a truck (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md FL2, Q-FL8, D-FL2).
--
-- ── WHY A NAME IS WORTH A COLUMN HERE ───────────────────────────────────────────────────────────
-- The carrier renames a Samsara vehicle record to say what happened to the truck: `NNN - OLD` when its
-- gateway was replaced, `NNN - SOLD` when the truck was sold (owner-stated 2026-09-22, Q-FL2). A sold
-- truck stays Active in McLeod until the buyer collects it (owner, 2026-09-22), so for weeks McLeod,
-- our row and the gateway all say "in the fleet" and only the Samsara NAME says "sold, awaiting
-- pickup". Measured 2026-10-01: 22 Samsara records are named `- SOLD`; nine of them are McLeod-active
-- here (506, 550, 557, 563, 568, 572, 592, 594, 607), and 632–635 are too.
--
-- FL2's parity check must report those units as a KNOWN state, not as a disagreement (Q-FL1, Q-FL4).
-- Today the vehicle sync reads that name every identity cycle and discards it, so the only way to
-- recognise the thirteen would be a list of unit numbers in code — a copy of a fact Samsara already
-- states, which goes stale on the next sale. Owner ruled Q-FL8 (a) on 2026-10-01: store the name.
--
-- ── WHAT IT IS AND IS NOT ───────────────────────────────────────────────────────────────────────
-- A REPORTED label, exactly as Samsara holds it — not identity. It is not added to
-- `trg_claim_vehicle_identity`'s list (0241): McLeod never writes it, so an office edit of it has no
-- sync to be protected from, and claiming a row on it would freeze that row's McLeod refresh for
-- nothing. It decides nothing on its own either: a name is not a measurement
-- (`samsara-old-suffix-is-a-device-swap`), and every rule that reads it says which suffix it reads.
-- It is audited like any other column (`audit_vehicles`), so a rename leaves a trace.
--
-- Ships ALONE (lint:migration-ordering): its writer, `samsaraVehicleSync`, arrives in the next merge.
-- Until then it is null everywhere, which every reader must read as "Samsara has not said".
--
-- Rollback: drop the column. No data is migrated by this file.

alter table public.vehicles add column if not exists samsara_name text;

comment on column public.vehicles.samsara_name is
  'The Samsara vehicle record''s name as Samsara holds it, written by the vehicle sync (FL2, Q-FL8).
   A reported label, not identity: `NNN - SOLD` = sold, awaiting pickup; `NNN - OLD` = a retired
   gateway''s record. Null = Samsara has not said (no linked record, or not synced since 0401).';
