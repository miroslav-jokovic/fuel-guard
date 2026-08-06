-- 0127 — Hazmat compliance master data: the TEMPORAL `certifications` table (PLAN §3.1 / §5 / §10.1).
-- ADDITIVE + hazmat-scoped. FuelGuard KEEPS its existing current-value driver/compliance model
-- (0098/0101) for fuel; this table is the source of truth for the HAZMAT qualification gate (§5) only.
-- Nothing here drops or alters 0098/0101 — the two models coexist. Written via the roster API (M2);
-- until populated, the §5 gate fail-closes every hazmat load (a qualified driver cannot be shown),
-- which is the correct safe default.

create table if not exists public.certifications (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  subject_type      text not null check (subject_type in ('organization','driver','tractor','trailer')),
  subject_id        uuid not null,
  kind              text not null check (kind in (
                      'cdl','medical_card','endorsement','hazmat_training','twic',
                      'registration','annual_inspection','insurance','ifta','irp',
                      'phmsa_registration','hazmat_safety_permit','security_plan',
                      'financial_responsibility','operating_authority')),
  qualifier         text,
  -- §172.704(a): hazmat training is FIVE distinct requirements, not one.
  training_type     text check (training_type is null or training_type in (
                      'general_awareness','function_specific','safety',
                      'security_awareness','in_depth_security')),
  identifier        text,
  issuing_authority text,
  issued_at         date,
  effective_from    date not null,
  expires_at        date,
  -- §172.704(d) training fields — required, and only meaningful on kind='hazmat_training'.
  training_provider_name    text,
  training_provider_address text,
  training_materials        text,
  training_certified        boolean,
  superseded_by     uuid references public.certifications(id) on delete set null,
  superseded_at     timestamptz,
  document_id       uuid,            -- FK added with the documents table (M1 roster); column reserved now
  notes             text,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint cert_training_fields check (
    kind <> 'hazmat_training'
    or (training_provider_name is not null
        and training_certified is not null
        and training_type is not null)
  )
);

create index if not exists idx_cert_current on public.certifications (org_id, subject_type, subject_id, kind)
  where (superseded_by is null);
create index if not exists idx_cert_expiry on public.certifications (org_id, expires_at)
  where (superseded_by is null and expires_at is not null);
-- §10.1: at most one CURRENT certification per (org, subject, kind, qualifier) — enforced, not by convention.
create unique index if not exists uq_cert_current on public.certifications
  (org_id, subject_type, subject_id, kind, coalesce(qualifier, ''))
  where superseded_by is null;

drop trigger if exists trg_certifications_updated on public.certifications;
create trigger trg_certifications_updated before update on public.certifications
  for each row execute function public.set_updated_at();

alter table public.certifications enable row level security;

drop policy if exists certifications_select on public.certifications;
create policy certifications_select on public.certifications for select using (org_id = public.auth_org_id());

drop policy if exists certifications_driver_scope on public.certifications;
create policy certifications_driver_scope on public.certifications as restrictive for select using (
  public.auth_role() <> 'driver'
  or (subject_type = 'driver' and subject_id = public.auth_driver_id())
);

drop policy if exists certifications_write on public.certifications;
create policy certifications_write on public.certifications using (
  org_id = public.auth_org_id() and public.auth_role() = any (array['admin','fleet_manager','safety_manager'])
) with check (
  org_id = public.auth_org_id() and public.auth_role() = any (array['admin','fleet_manager','safety_manager'])
);

-- Atomic supersede+insert (§10.1): the prior current row is parked pointing at itself (exits the
-- partial-unique predicate), the new row inserted, then the prior row repointed at it. One
-- transaction; never deletes (retention law, §3.1).
create or replace function public.insert_certification(
  p_id                        uuid,
  p_org_id                    uuid,
  p_subject_type              text,
  p_subject_id                uuid,
  p_kind                      text,
  p_qualifier                 text default null,
  p_training_type             text default null,
  p_identifier                text default null,
  p_issuing_authority         text default null,
  p_issued_at                 date default null,
  p_effective_from            date default null,
  p_expires_at                date default null,
  p_training_provider_name    text default null,
  p_training_provider_address text default null,
  p_training_materials        text default null,
  p_training_certified        boolean default null,
  p_document_id               uuid default null,
  p_notes                     text default null,
  p_created_by                uuid default null
) returns table (id uuid, superseded_id uuid)
language plpgsql
as $$
declare
  v_prior uuid;
begin
  select c.id into v_prior
    from public.certifications c
   where c.org_id = p_org_id
     and c.subject_type = p_subject_type
     and c.subject_id = p_subject_id
     and c.kind = p_kind
     and coalesce(c.qualifier, '') = coalesce(p_qualifier, '')
     and c.superseded_by is null
   for update;

  if v_prior is not null then
    update public.certifications c
       set superseded_by = v_prior, superseded_at = now()
     where c.id = v_prior;
  end if;

  insert into public.certifications
    (id, org_id, subject_type, subject_id, kind, qualifier, training_type, identifier,
     issuing_authority, issued_at, effective_from, expires_at,
     training_provider_name, training_provider_address, training_materials, training_certified,
     document_id, notes, created_by)
  values
    (p_id, p_org_id, p_subject_type, p_subject_id, p_kind, p_qualifier, p_training_type, p_identifier,
     p_issuing_authority, p_issued_at, coalesce(p_effective_from, current_date), p_expires_at,
     p_training_provider_name, p_training_provider_address, p_training_materials, p_training_certified,
     p_document_id, p_notes, p_created_by);

  if v_prior is not null then
    update public.certifications c
       set superseded_by = p_id
     where c.id = v_prior;
  end if;

  return query select p_id, v_prior;
end;
$$;
