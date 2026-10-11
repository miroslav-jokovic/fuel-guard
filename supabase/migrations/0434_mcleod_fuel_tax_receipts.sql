-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- mcleod_fuel_tax_receipts — the fuel the office keys into McLeod's IFTA module BY HAND
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- IFTA-PRECISION-PLAN IP6. The carrier's IFTA "fuel bought" side has two halves and we held one: the
-- EFS card fills (`fuel_transactions`). The other half is the receipts a driver paid in cash or on an
-- own card, which the office types into McLeod's fuel-tax module after each quarter closes. Measured on
-- `lme_analytics` 2026-10-05: they are `dbo.fuel_tax_history` rows with `source = 'F'` — 1,255 ever,
-- 116 in 2026 (Q1 5,427 gal, Q2 3,499 gal), every one carrying a tractor and a state, none voided, ids
-- unique. Without them a jurisdiction where a truck fuelled on a paper receipt reads as owed more tax
-- than it is, and unit 512 — an owner-operator with no card fills at all — looks as if it bought nothing.
--
-- ── WHY ITS OWN TABLE, NOT ROWS IN `fuel_transactions` ───────────────────────────────────────────
-- A receipt row has a date, a state, a tractor and gallons — no card, no price, no time of day, no
-- station. `fuel_transactions` is read by fraud scoring, MPG intervals and the spend report, all of
-- which assume a card transaction; a receipt there would be scored as a fill with no card and break the
-- interval chain. IFTA needs gallons per state per quarter, which is exactly what this row has, so it
-- joins the IFTA reads and nothing else (D-IP6, revised).
--
-- ── WHAT IS STORED, AND WHAT IS NOT DECIDED HERE ─────────────────────────────────────────────────
-- Verbatim, in McLeod's units (US gallons): `fuel_volume` → `gallons`, `source_date` → `receipt_date`.
-- 2 of 2026's 116 rows duplicate a card fill McLeod already imported (same tractor, state, day,
-- gallons within 0.5). They are stored as McLeod has them; dropping the duplicate is the IFTA reader's
-- rule, against OUR card fills, where it can be tested and changed without a re-sweep.
--
-- Operational and refreshable, not evidence: McLeod's office can correct or void a receipt, and the
-- nightly sweep re-reads two years of them (they are ~70 a quarter), so the row follows the source.
create table if not exists mcleod_fuel_tax_receipts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  external_id     text not null,                       -- fuel_tax_history.id
  company_id      text,

  tractor_unit    text not null,
  jurisdiction    text not null,                       -- fuel_tax_history.state, upper-cased
  receipt_date    date not null,                       -- fuel_tax_history.source_date
  gallons         numeric(10,3) not null check (gallons >= 0),
  processed_at    timestamptz,                         -- when the office keyed it
  is_void         boolean not null default false,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists uq_mcleod_fuel_tax_receipts_external
  on mcleod_fuel_tax_receipts (org_id, external_id);
-- The IFTA reads ask "this jurisdiction, this quarter".
create index if not exists idx_mcleod_fuel_tax_receipts_period
  on mcleod_fuel_tax_receipts (org_id, receipt_date, jurisdiction);

create trigger trg_mcleod_fuel_tax_receipts_updated before update on mcleod_fuel_tax_receipts
  for each row execute function set_updated_at();

-- Service-role only, like every mcleod staging table (ARCHITECTURE §6 raw-layer seal). The browser
-- sees these only through the ifta module's API.
alter table mcleod_fuel_tax_receipts enable row level security;

-- raw-access-waiver: this migration CREATES the mcleod raw staging table it names — the owning
-- collector's own DDL, no cross-module read.
