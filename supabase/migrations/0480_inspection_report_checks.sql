-- 0480 — what each officer's report said against the record (INSPECTION-CHALLENGE-PLAN IC10, D-IC13;
-- Q-IC11 (a), owner 2026-10-15).
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────────
-- 0478/0479 put a filed report in front of the document reader. This records the comparison of what it
-- read with the record: is it this inspection (report number), are these its units (VINs), whose licence
-- is it (the roster's `cdl_number`), and does Samsara put that driver on the truck. When every check
-- agrees, the same pass writes the `report` attribution 0479 allowed, and `attribution_id` names it.
--
-- ── ONE ROW PER REPORT PER CHECK VERSION, APPEND-ONLY ────────────────────────────────────────────
-- A check is a reading of evidence, like an attribution: a new rule is a new `check_version` and every
-- report is checked again, beside the old row, never over it. A disagreement found yesterday must still
-- be there when someone asks why a driver was not confirmed.
--
-- ── WHAT IS NOT STORED ───────────────────────────────────────────────────────────────────────────
-- The licence number. The read holds it (`document_reads.result`, service role only); this row keeps the
-- last four characters to show, and `driver_id` — our roster's holder — for what it decided. No FK to
-- `drivers`, for 0473's reason: an append-only row in `merge_driver`'s move list would refuse the merge.
--
-- New table: its writer, the report pass on the FMCSA hourly tick, ships in the same merge.

create table if not exists public.inspection_report_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null,
  document_id uuid not null,
  -- The read compared (document-reading's `document_reads.id`); no FK across modules.
  read_id uuid not null,
  check_version text not null check (length(btrim(check_version)) > 0),
  outcome text not null check (outcome in ('confirmed', 'agrees', 'needs_review', 'unreadable')),
  reasons text[] not null default '{}',
  name_on_report text,
  licence_last4 text check (licence_last4 is null or length(licence_last4) <= 4),
  driver_id uuid,
  -- The `report` attribution this check wrote; set exactly when `confirmed`.
  attribution_id uuid,
  created_at timestamptz not null default now(),
  constraint inspection_report_checks_inspection_fk
    foreign key (inspection_id, org_id) references public.roadside_inspections (id, org_id),
  constraint inspection_report_checks_once unique (org_id, document_id, check_version),
  constraint inspection_report_checks_confirmed_wrote check ((outcome = 'confirmed') = (attribution_id is not null)),
  -- Nothing agrees without a driver to agree on.
  constraint inspection_report_checks_agreement_names check (outcome not in ('confirmed', 'agrees') or driver_id is not null)
);

create index if not exists inspection_report_checks_inspection_idx
  on public.inspection_report_checks (org_id, inspection_id, created_at desc);

drop trigger if exists trg_inspection_report_checks_append_only on public.inspection_report_checks;
create trigger trg_inspection_report_checks_append_only
  before update or delete on public.inspection_report_checks
  for each row execute function public.inspection_evidence_append_only();

alter table public.inspection_report_checks enable row level security;

comment on table public.inspection_report_checks is
  'IC10 (0480): one officer''s report compared with FMCSA, the inspected units, the roster and Samsara — outcome and reasons per check version; `attribution_id` is the report confirmation it wrote. Append-only, service role only.';
