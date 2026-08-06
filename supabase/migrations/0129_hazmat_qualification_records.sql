-- 0129 — qualification_records: §3.2 dated driver-qualification events (DQF completeness, §391.51).
-- Append-only (no UPDATE/DELETE policy — a correction is a new row). ADDITIVE + compliance-scoped;
-- complements 0127's certifications. NOT read by the §5 gate (that reads certifications) — this is
-- the DQF event history a DOT auditor asks for: MVR, road test, clearinghouse, drug/alcohol tests,
-- previous-employer inquiries, accidents.
create table if not exists public.qualification_records (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  driver_id     uuid not null references public.drivers(id) on delete cascade,
  kind          text not null check (kind in (
                  'employment_application','mvr','annual_mvr_review','road_test',
                  'cdl_equivalency','previous_employer_inquiry','previous_employer_response',
                  'clearinghouse_full','clearinghouse_limited','eldt','spe_certificate',
                  'medical_registry_verification','drug_test','alcohol_test','accident')),
  occurred_on   date not null,
  covers_until  date,
  result        text,
  performed_by  text,
  reference     text,
  document_id   uuid,
  detail        jsonb not null default '{}',
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_qual_driver on public.qualification_records (org_id, driver_id, kind, occurred_on desc);
alter table public.qualification_records enable row level security;
drop policy if exists qualification_records_select on public.qualification_records;
create policy qualification_records_select on public.qualification_records for select using (org_id = public.auth_org_id());
drop policy if exists qualification_records_driver_scope on public.qualification_records;
create policy qualification_records_driver_scope on public.qualification_records as restrictive for select using (
  public.auth_role() <> 'driver' or driver_id = public.auth_driver_id()
);
drop policy if exists qualification_records_insert on public.qualification_records;
create policy qualification_records_insert on public.qualification_records for insert with check (
  org_id = public.auth_org_id() and public.auth_role() = any (array['admin','fleet_manager','safety_manager'])
);
-- No UPDATE/DELETE policy: append-only (§3.2).
