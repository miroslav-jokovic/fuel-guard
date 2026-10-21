-- Silvicom 360 — 0510 mcleod_tractor_periods: every McLeod tractor's service dates and owner, staged
-- by the financial sweep, so the per-truck P&L can spread lease, insurance and GPS over the days each
-- truck was in service (TRUCK-DRIVER-PNL-PLAN §3 P2, D-TP3, Q-TP2).
--
-- What gap. A month's lease belongs to the trucks the carrier had that month, day by day: a truck
-- bought on the 20th carries twelve days of July, one sold on the 9th carries eight. Nothing we stage
-- can say that. `vehicles` is the roster — the trucks running NOW — and holds no service dates at
-- all; the roster sweep reads `outservice_date` only to retire a truck and then drops it; and a truck
-- sold in March 2026, before the roster was McLeod-mastered, is in no table of ours, though March's
-- lease was paid on it.
--
-- McLeod has the answer on `tractor` itself: `inservice_date`, `outservice_date`, and who owns the
-- truck. Measured on lme_analytics 2026-10-21 (company TMS): those dates place every truck that
-- worked in May, June, July and August 2026 inside its own service period, but one unit a month with
-- no tractor row (`packages/shared/src/tmsCost/truckDays.ts` has the table).
--
-- ── SHAPE ────────────────────────────────────────────────────────────────────────────────────────
-- One row per (org, company, tractor), every tractor the company has (~700, reserved unit numbers and
-- long-sold trucks included), replaced in place by every financial sweep. McLeod's columns verbatim —
-- which rows are trucks (D-FC1's purchase-date-or-model-year predicate) and whose truck it is
-- (`pay_owner`, Q-TP5/Q-TP12) are decided in `truckDays.ts`, not here, so a ruling that moves them is
-- a code change rather than a re-sweep.
--
-- Why a new McLeod staging table rather than columns on `vehicles`. `vehicles` is the roster's: one row
-- per truck the fleet runs, merged from two sources under identity rules (D-FC0, `identity_source`),
-- and it deliberately holds no reserved unit numbers and no truck retired before the merge. History
-- for a P&L needs every tractor McLeod ever ran, as McLeod states it. A new table is also exempt from
-- the deploy window's two-merge rule (MIGRATION-DISCIPLINE §the-deploy-window), so its writer and its
-- reader ship with it.
--
-- `company_id` NOT NULL with an empty-string default, as in 0309: a unit number is unique per McLeod
-- company, not per carrier.
--
-- Deny-all RLS on purpose: McLeod staging is service-role only and read through the mcleod module's
-- interface (D-SEP1, D-SEP7).
--
-- Rollback: drop the table. The financial module reads it only for the per-truck spread.
--
-- raw-access-waiver: this file creates the mcleod raw staging table it names, on behalf of the mcleod
-- collector — the owning collector's own DDL, no cross-module read.
create table if not exists mcleod_tractor_periods (
  id                 uuid        not null default gen_random_uuid() primary key,
  org_id             uuid        not null references organizations(id) on delete cascade,
  company_id         text        not null default '',
  tractor_id         text        not null,
  in_service_on      date,
  out_of_service_on  date,
  purchased_on       date,
  model_year         text,
  service_status     text,
  tractor_status     text,
  owner_id           text,
  pay_owner          text,
  swept_at           timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists mcleod_tractor_periods_identity
  on mcleod_tractor_periods (org_id, company_id, tractor_id);

alter table mcleod_tractor_periods enable row level security;

comment on table mcleod_tractor_periods is
  'Every McLeod tractor''s service dates and owner, verbatim, replaced in place by each financial sweep — the per-truck P&L''s truck-day census (TRUCK-DRIVER-PNL-PLAN P2). Service-role only.';
