-- 0591 — the seven-day statement signed on the application's page 21 is also the driver's §395.8(j)(2)
-- record (APPLICATION-FIX-PLAN item 4; owner rulings Q-AM4, 2026-11-11, and Q-AM21 (a), 2026-11-12).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
-- Page 21 returns to the signing packet (Q-AM4, reversing the 2026-08-23 move, D-PKT7): the driver fills
-- it at signing, after the office has corrected it (usually to zeros). Its answers are then a signed
-- §395.8(j)(2) statement, and the owner ruled (Q-AM21 (a)) that it is ALSO a row of
-- `seven_day_statements` — the list dispatch reads before a first load — rather than a second place to
-- look. The roster's own form stays, for a start date too long after signing.
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────────────────────────
-- · `source`: who took the statement — `office` (the roster form, every row before 0591) or
--   `application` (page 21, written at filing). Defaulted, so the roster form's insert is unchanged.
-- · `application_id`: the filed application a page-21 row came from, and a partial unique index on it,
--   so a retried filing cannot record the same statement twice.
-- · `record_application_seven_day_statement`: the one writer of a page-21 row, called by filing with
--   the service role. It checks the application is this org's and this driver's, and writes nothing a
--   second time. The office's own form keeps its RLS-checked insert.
-- · The immutability guard (SD010) now covers the two new columns too: a signed statement's origin is
--   part of what was signed.
--
-- ── WHY IT CAN MERGE ALONE ──────────────────────────────────────────────────────────────────────
-- Two new columns nothing reads yet (one defaulted, one nullable) and a new function nothing calls
-- yet; the filing that calls it ships in a later merge (`lint:migration-ordering`).
alter table public.seven_day_statements
  add column if not exists source text not null default 'office'
    constraint seven_day_statements_source_check check (source in ('office', 'application')),
  add column if not exists application_id uuid references public.driver_applications(id) on delete cascade;

-- A page-21 row names its application, and an office row never does.
alter table public.seven_day_statements
  drop constraint if exists seven_day_statements_source_application_check;
alter table public.seven_day_statements
  add constraint seven_day_statements_source_application_check
    check ((source = 'application') = (application_id is not null));

create unique index if not exists seven_day_statements_application_key
  on public.seven_day_statements (application_id) where application_id is not null;

comment on column public.seven_day_statements.source is
  'Q-AM21 (0591): office = taken on the roster form; application = signed on the application''s page 21 and written at filing.';
comment on column public.seven_day_statements.application_id is
  'Q-AM21 (0591): the filed application a page-21 statement came from (unique). Null for an office row.';

-- ── The guard, as 0236 wrote it, plus the two columns ───────────────────────────────────────────
create or replace function public.guard_seven_day_statement_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.org_id is distinct from new.org_id
     or old.statement_date is distinct from new.statement_date
     or old.days is distinct from new.days
     or old.last_relieved_at is distinct from new.last_relieved_at
     or old.signed_name is distinct from new.signed_name
     or old.signed_on is distinct from new.signed_on
     or old.recorded_by is distinct from new.recorded_by
     or old.created_at is distinct from new.created_at
     or old.source is distinct from new.source
     or old.application_id is distinct from new.application_id then
    raise exception 'seven_day_statement_immutable: a correction is a new statement' using errcode = 'SD010';
  end if;
  return new;
end;
$$;

-- ── The writer of a page-21 statement ───────────────────────────────────────────────────────────
-- ⚠ `on delete cascade`, not `set null`: a page-21 statement is part of its application, and the only
-- act that deletes a filed application is the applicant purge (`purge_applicant`), which removes the
-- person's whole record. `set null` would have tripped the guard and the source CHECK mid-purge.
create or replace function public.record_application_seven_day_statement(
  p_org              uuid,
  p_application      uuid,
  p_statement_date   date,
  p_days             jsonb,
  p_last_relieved_at timestamptz,
  p_signed_name      text,
  p_signed_on        date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver uuid;
  v_id     uuid;
begin
  select driver_id into v_driver
    from public.driver_applications
   where id = p_application and org_id = p_org;
  if v_driver is null then
    raise exception 'application_not_found' using errcode = 'SD020';
  end if;

  insert into public.seven_day_statements
    (org_id, driver_id, statement_date, days, last_relieved_at, signed_name, signed_on, recorded_by, source, application_id)
  values
    (p_org, v_driver, p_statement_date, p_days, p_last_relieved_at, p_signed_name, p_signed_on, null, 'application', p_application)
  on conflict (application_id) where application_id is not null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.seven_day_statements where application_id = p_application and org_id = p_org;
  end if;
  return v_id;
end;
$$;

revoke all on function public.record_application_seven_day_statement(uuid, uuid, date, jsonb, timestamptz, text, date)
  from public, anon, authenticated;
grant execute on function public.record_application_seven_day_statement(uuid, uuid, date, jsonb, timestamptz, text, date)
  to service_role;

comment on function public.record_application_seven_day_statement(uuid, uuid, date, jsonb, timestamptz, text, date) is
  'Q-AM21 (0591): writes the §395.8(j)(2) statement signed on a filed application''s page 21 (source = application), once per application. Refuses SD020 when the application is not this org''s. Returns the row''s id, the existing one on a retry.';
