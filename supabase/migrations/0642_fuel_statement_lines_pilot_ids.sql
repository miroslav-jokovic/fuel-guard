-- 0642 — the Vehicle ID and Driver ID Pilot's 2026-11 invoice prints on every line
-- (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §2, Q-PIF6, ruled by the owner 2026-11-24: keep them).
--
-- ── WHAT IS NEW ───────────────────────────────────────────────────────────────────────────────────
-- From the week of 2026-11-16 Pilot bills the weekly direct-bill on a new invoice layout
-- (`Standard_Invoice_Gen_Template_INV-#####.pdf`, read by `packages/shared/src/reconcile/pilotInvoice.ts`).
-- It drops the Auth and P.O. columns and adds two the old statement never had: `Vehicle ID` and `Driver ID` —
-- what the driver keyed at the pump prompt. Measured on INV-59656 (960 lines): Driver ID on all 960; Vehicle ID
-- on 953, of which 53 are literal prompt text (`TEST`, `TESTTR`, `TESTRL`) rather than a number. On reefer
-- lines the Vehicle ID reads like a trailer, which is the reason to keep it: it is the only field on the bill
-- that can tie a reefer fill to its trailer.
--
-- ── WHY TEXT, AND WHY NOT `vehicle_id` / `driver_id` ──────────────────────────────────────────────
-- Everywhere else in this schema `vehicle_id` and `driver_id` are uuid foreign keys to our own rows. These are
-- Pilot's prompt values, unverified, sometimes words — so they are named for whose they are and stored exactly as
-- printed. Resolving one to a `vehicles` or `trailers` row is a reader's job, never a rewrite of this evidence
-- table (`fuel_statement_lines` is pinned in RETENTION_FORBIDDEN with its statement).
--
-- ── SCHEMA ONLY, IN ITS OWN MERGE ─────────────────────────────────────────────────────────────────
-- ⚠ DEPLOY WINDOW: two nullable columns, no default. Nothing names them in this merge
-- (`lint:migration-ordering`); the statement ingest starts writing them in the next one. Old statements' lines
-- read null forever — that layout never printed them.
--
-- Rollback: `alter table public.fuel_statement_lines drop column pilot_vehicle_id, drop column pilot_driver_id`.

alter table public.fuel_statement_lines
  add column if not exists pilot_vehicle_id text,
  add column if not exists pilot_driver_id text;

comment on column public.fuel_statement_lines.pilot_vehicle_id is
  'Vehicle ID as printed on Pilot''s 2026-11 invoice layout (the pump prompt). Unverified; null on the old statement layout.';
comment on column public.fuel_statement_lines.pilot_driver_id is
  'Driver ID as printed on Pilot''s 2026-11 invoice layout (the pump prompt). Unverified; null on the old statement layout.';
