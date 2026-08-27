-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- mcleod_deductions — money taken OUT of settlements: escrow, insurance, advances, equipment rent
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 0257 shipped the settlement staging without this table, and financialIngest.ts has carried the
-- honest marker ever since ("Deductions have NO staging table yet"); program-plan open question 12
-- named landing them as follow-up work. This closes it. The extraction has existed the whole time —
-- `SETTLEMENT_DEDUCTIONS` in the agent's queries.mjs, mapped by settlements.mjs and validated by
-- `tmsDeductionFactSchema` — it just had nowhere to land.
--
-- Its own table, never columns on mcleod_settlements, for the reason the contract states: a
-- deduction is money moving the OTHER way, and the two have different void states — a settlement
-- can stand while one of its deductions is reversed. June 2026: 1,342 live rows, $378,247.90.
--
-- Attribution is partial and stored honestly so: 317 of June's 699 type-'D' rows carry a tractor,
-- the rest are payee-level (escrow and advances follow the person, not the truck). A NULL
-- tractor_unit is the source's own statement, kept as such — the harness's allocation rules decide
-- what payee-level deductions mean for a truck's cost, never this table (D-FS5, D-MC12).
--
-- ⚠ `deduct_code` values are stored verbatim but the code→meaning vocabulary has NOT been
-- enumerated against dbo.code yet (recorded gap, 2026-08-27 sandbox analysis). Reports may group by
-- the raw code; naming the codes is a recon question for a later sweep, not a guess made here.
create table if not exists mcleod_deductions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  external_id     text not null,                       -- drs_deduct_hist.id

  payee_id        text,
  payee_type      text not null default 'other'
                    constraint mcleod_deductions_payee_type_check
                    check (payee_type in ('company_driver', 'owner_operator', 'other')),
  tractor_unit    text,

  deduct_code     text,
  deduction_type  text,

  transacted_at   timestamptz,
  amount          numeric(14,2) not null default 0,

  is_void         boolean not null default false,
  accrual_key     text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists uq_mcleod_deductions_external
  on mcleod_deductions (org_id, external_id);
create index if not exists idx_mcleod_deductions_tractor
  on mcleod_deductions (org_id, tractor_unit, transacted_at desc);
create index if not exists idx_mcleod_deductions_payee
  on mcleod_deductions (org_id, payee_id, transacted_at desc);

create trigger trg_mcleod_deductions_updated before update on mcleod_deductions
  for each row execute function set_updated_at();

-- Service-role only, like every mcleod staging table (ARCHITECTURE §6 raw-layer seal).
alter table mcleod_deductions enable row level security;

-- raw-access-waiver: this migration CREATES the mcleod raw staging table it names — the owning
-- collector's own DDL, no cross-module read.
