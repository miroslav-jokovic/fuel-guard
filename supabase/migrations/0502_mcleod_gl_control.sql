-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- mcleod_gl_control — McLeod's own answer to "is this month final"
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- TRUCK-DRIVER-PNL-PLAN D-TP5 (defect D4). The fleet report decides whether a month can be reported
-- from two things it can see: the sweep ran after the month ended (G11), and the month carries the
-- modules that earned and spent the most in the month before it (Q10). Both are necessary and
-- neither says the month is FINAL. Measured on lme_analytics 2026-10-19 (restore of 10-09): August
-- 2026 passed both — it had BILL and SET — while its AP held $179k against ~$400k in a normal month
-- and its GJ 64 lines against 120–202. And a month that has been printed still moves: July's P&L was
-- printed 2026-08-20 and July kept receiving postings until 2026-09-29 (+$12.5k revenue, +$33k
-- expense on re-sweep).
--
-- McLeod knows the answer. `gl_control` holds each company's open fiscal period and `prior_post`;
-- with `prior_post = 'N'` McLeod refuses a posting into any period before the open one. TMS read
-- 2026 / period 8 / 'N' — August open, July and earlier closed — and the post dates agree: nothing
-- dated July was posted after the pointer moved, August arrived in one batch on 10-01.
--
-- ── SHAPE ────────────────────────────────────────────────────────────────────────────────────────
-- One row per (org, company), replaced by every financial sweep: the open period describes the
-- present and has no history worth keeping — what a month looked like when it was still open is the
-- ledger rows' own `swept_at`. The period's dates are McLeod's (`fiscal_year_dtl`), never assumed to
-- be a calendar month; `period_end` is exclusive, like every other period bound we stage.
-- `prior_post_allowed` is stored as McLeod's flag means it, not as a verdict: the reader decides that
-- a company which allows prior posting makes no month final.
--
-- A new table, so its readers are new code paths and ship with it (lint:migration-ordering exempts
-- new tables); the writer ships with it too (lint:table-producers).
create table if not exists mcleod_gl_control (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  company_id          text not null,
  fiscal_year         text not null,
  fiscal_period       integer not null check (fiscal_period between 1 and 13),
  prior_post_allowed  boolean not null,
  period_start        date not null,
  period_end          date not null,
  swept_at            timestamptz not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint mcleod_gl_control_period_order check (period_end > period_start)
);

create unique index if not exists uq_mcleod_gl_control_company
  on mcleod_gl_control (org_id, company_id);

create trigger trg_mcleod_gl_control_updated before update on mcleod_gl_control
  for each row execute function set_updated_at();

-- Service-role only, like every mcleod staging table (ARCHITECTURE §6 raw-layer seal). The browser
-- sees the verdict only through the financial module's reports.
alter table mcleod_gl_control enable row level security;

-- raw-access-waiver: this migration CREATES the mcleod raw staging table it names — the owning
-- collector's own DDL, no cross-module read.
