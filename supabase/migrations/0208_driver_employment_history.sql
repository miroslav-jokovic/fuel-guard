-- 0208 — driver_employment_history: the §391.21(b)(10) employment list, as ROWS.
--
-- THE GAP. §391.21(b)(10) requires the driver's application to list their employers — three years of
-- them for the safety-history obligation, ten for CDL employment — and §391.23(a)(2)/(d) then
-- requires the carrier to investigate the safety performance history of every DOT-regulated employer
-- in the preceding three years. Until now the product held that list as a SCANNED PDF and nothing
-- else: `employment_application` is a `documents` kind and a `qualification_records` kind, and
-- `previous_employer_inquiry` / `previous_employer_response` are dated events with no idea WHICH
-- employer they concern. So "have we written to everyone we owe an inquiry to" was a question only a
-- human re-reading a scan could answer, and "did this driver list every employer" could not be asked
-- at all.
--
-- WHY NOW, AND WHAT IT UNBLOCKS. PSP returns, per driver, the USDOT number of the carrier whose truck
-- they were in at every roadside inspection in the last three years (PSP-PLAN.md §5b.1). Cross-checked
-- against this table that finds employers the driver did NOT list — which is a §391.21(b)(10) gap AND
-- a §391.23(a)(2) inquiry we did not know we owed. The cross-check is blocked on OUR data model, not
-- on the vendor, exactly as date of birth was (PSP-PLAN.md P0, §5b.4). This table is the missing half,
-- and it earns its place under §391.53(a)(1) whether or not PSP is ever wired up.
--
-- MUTABLE, NOT APPEND-ONLY — and that is the deliberate difference from the evidence tables. The
-- EVIDENCE is the application PDF in `documents` and the inquiry/response rows in
-- `qualification_records`, both append-only and both untouched by this. These rows are a
-- TRANSCRIPTION of that evidence into something queryable, so a typo in a former employer's phone
-- number is a correction, not a new row — and a transcription that could only ever be appended to
-- would accumulate contradictory copies of one employer. Every write is audited
-- (`compliance.employment.*`), which is where the history of the transcription lives.
--
-- NOT RESTRICTED, on purpose. 0205 puts `previous_employer_inquiry` / `previous_employer_response`
-- behind `canReadRestricted` because §391.53(a)(1) limits the INVESTIGATION file to those involved in
-- the hiring decision. The list of where somebody says they have worked is part of the application
-- (§391.51(b)(1)), which carries no such limit, and the inquiry EVIDENCE stays exactly where 0205 put
-- it. Widening the restriction to cover this table would hide the roster's own hiring paperwork from
-- the fleet roles that maintain it; narrowing 0205 to match is not on the table either.
create table if not exists public.driver_employment_history (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  driver_id       uuid not null references public.drivers(id) on delete cascade,
  employer_name   text not null,
  -- The strong join key to a PSP inspection record, and the reason a name match is only ever a
  -- hint (PSP-PLAN.md D-PSP6). Nullable because drivers do not know their former employer's USDOT
  -- number and a guessed one is worse than none; FMCSA's public carrier lookup resolves it later.
  usdot_number    text,
  employer_city   text,
  employer_state  text,
  employer_phone  text,
  employer_email  text,
  position_held   text,
  started_on      date not null,
  -- NULL means "still there" — the current employer on an application under review. The coverage
  -- calculation reads it as "through today", which is why it is not defaulted to a date.
  ended_on        date,
  -- §391.23(a)(2) applies to DOT-REGULATED employers. A driver's summer at a warehouse belongs on the
  -- application for the gap arithmetic and owes no safety-history inquiry, and conflating the two
  -- would have us chasing responses nobody is required to give.
  dot_regulated   boolean not null default true,
  subject_to_fmcsr boolean,
  safety_sensitive boolean,
  reason_for_leaving text,
  -- The §391.23(a)(2)/(d) inquiry state, per employer. 'not_required' is for dot_regulated = false;
  -- 'no_response' is the documented non-response §391.23(d) explicitly allows a carrier to rely on,
  -- and it is a RESULT, not a failure to act — the catalogue item accepts it.
  inquiry_status  text not null default 'pending'
                    check (inquiry_status in ('not_required','pending','sent','responded','no_response')),
  inquiry_sent_on date,
  inquiry_response_on date,
  -- Where this row came from. 'application' = transcribed from the driver's paperwork; 'psp_discovery'
  -- = an employer PSP found that the application never listed, added by a human who confirmed it.
  -- Never inferred from the row's shape: a discovered employer and a declared one must never be
  -- confused, and a nullable column would make "unknown" indistinguishable from "declared".
  source          text not null default 'application'
                    check (source in ('application','psp_discovery','manual')),
  notes           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint driver_employment_history_dates_ordered
    check (ended_on is null or ended_on >= started_on)
);

-- The read this table exists for: one driver's history, newest first, which is the order an
-- application lists it and the order the gap arithmetic walks it.
create index if not exists idx_driver_employment_history_driver
  on public.driver_employment_history (org_id, driver_id, started_on desc);

-- The PSP cross-check's read: every employer USDOT number this org has on file, to match inspection
-- records against. Partial, because most rows will not carry one.
create index if not exists idx_driver_employment_history_usdot
  on public.driver_employment_history (org_id, usdot_number) where usdot_number is not null;

alter table public.driver_employment_history enable row level security;

drop policy if exists driver_employment_history_select on public.driver_employment_history;
create policy driver_employment_history_select on public.driver_employment_history
  for select using (org_id = public.auth_org_id());

-- A driver may read their OWN history and no one else's — the same restrictive shape 0129 uses, so
-- the driver app can show somebody what the office recorded about them without exposing the roster.
drop policy if exists driver_employment_history_driver_scope on public.driver_employment_history;
create policy driver_employment_history_driver_scope on public.driver_employment_history
  as restrictive for select using (
    public.auth_role() <> 'driver' or driver_id = public.auth_driver_id()
  );

drop policy if exists driver_employment_history_write on public.driver_employment_history;
create policy driver_employment_history_write on public.driver_employment_history
  for all using (
    org_id = public.auth_org_id()
    and public.auth_role() = any (array['admin','fleet_manager','safety_manager'])
  ) with check (
    org_id = public.auth_org_id()
    and public.auth_role() = any (array['admin','fleet_manager','safety_manager'])
  );

comment on table public.driver_employment_history is
  'The §391.21(b)(10) employment list as rows, with the §391.23(a)(2) inquiry state per employer.
   Transcription, not evidence — the application PDF and the inquiry records stay append-only
   elsewhere. Joined to PSP inspection records on usdot_number to find employers a driver did not
   list (PSP-PLAN.md §5b).';
