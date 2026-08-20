-- 0223 — the §391.23(c)(2) written record (EMPLOYER-INQUIRY-PLAN E3).
--
-- "The record must include the previous employer's name and address, the date the previous employer
-- was contacted, or the attempts made, and the information received about the driver from the
-- previous employer." (§391.23(c)(2), read 2026-08-20.)
--
-- ── ONE ROW PER ATTEMPT, NOT ONE PER EMPLOYER ──────────────────────────────────────────────────
-- The regulation says "or the attempts made", plural, and §391.23(c)(1) accepts "documentation of
-- good faith efforts" IN PLACE OF a reply. So the attempts ARE the deliverable when nobody answers,
-- and a table that stored one contact per employer would overwrite the evidence every time somebody
-- tried again. A second letter is a second row.
--
-- `driver_employment_history.inquiry_status` stays, and becomes DERIVED from these rows rather than
-- typed by hand — the same move `applicantPipeline` made for the stage column, for the same reason:
-- a status somebody sets separately from the act it describes is a status that goes stale.
--
-- ── WHY THE ADDRESS IS COPIED ONTO THE ROW ─────────────────────────────────────────────────────
-- `employer_address_line1` lives on the employment row and could be joined. It is copied here on
-- purpose: §391.23(c)(2) requires a record of the address the request was SENT TO, and an employment
-- row is editable — somebody correcting a typo in 2027 would silently rewrite where we wrote to in
-- 2026. The same reason `driver_authorizations` stores `disclosure_text` rather than a version
-- pointer.
--
-- Append-only, and pinned in RETENTION_FORBIDDEN with the other evidence: this is what an auditor
-- reads to decide whether the investigation happened.

create table if not exists public.employer_inquiries (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  driver_id      uuid not null references public.drivers(id) on delete cascade,
  employment_id  uuid not null references public.driver_employment_history(id) on delete cascade,

  -- What was asked. 'safety_performance' is §391.23(d); 'drug_alcohol' is §40.25 and applies only to
  -- non-FMCSA DOT safety-sensitive employment — §391.23(e) routes FMCSA carriers to the Clearinghouse.
  kind           text not null default 'safety_performance'
                   check (kind in ('safety_performance','drug_alcohol')),

  -- §391.23(c)(2): the employer's name and address AS CONTACTED, frozen at the moment of contact.
  employer_name  text not null,
  employer_address text,

  method         text not null check (method in ('email','post','fax','phone','portal')),
  -- Where it actually went: an address, a mailbox, a fax number, or who was spoken to.
  sent_to        text not null,
  contacted_on   date not null,

  -- The exact words, and their version. §391.23(i) gives the driver the right to review what was
  -- received, and answering "what did you ask them" needs the question as well as the answer.
  wording_version text not null,
  body_sent      text not null,

  outcome        text not null default 'awaiting'
                   check (outcome in ('awaiting','responded','no_response','undeliverable')),
  -- Set when a reply lands, or when a non-response is documented after a good-faith effort.
  outcome_on     date,
  outcome_note   text,
  -- The reply itself, when there is one to file.
  document_id    uuid,

  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists employer_inquiries_driver_idx
  on public.employer_inquiries (org_id, driver_id, contacted_on desc);
create index if not exists employer_inquiries_employment_idx
  on public.employer_inquiries (employment_id, contacted_on desc);

alter table public.employer_inquiries enable row level security;

-- §391.23(k)(2): "take all precautions reasonably necessary to protect the records from disclosure
-- to any person not directly involved in deciding whether to hire the driver." That is the same
-- population `canReadInvestigationHistory` names and 0211/0217 already enforce for the
-- previous-employer qualification records — mirrored here rather than restated with a new role list.
create policy employer_inquiries_read on public.employer_inquiries
  for select
  using (
    org_id = public.auth_org_id()
    and public.auth_role() in ('admin','safety_manager','recruiter')
  );

-- No client INSERT/UPDATE/DELETE policy, deliberately. Every row is written by the API, which
-- composes the wording server-side and stamps the address as contacted; a browser-authored record of
-- what we asked a former employer is worth nothing in an audit.

-- Append-only. A correction is a new attempt or an outcome the API sets; the history of what was
-- sent and when must not be editable after the fact (the 0071 rule, applied to this evidence).
create or replace function public.guard_employer_inquiry_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.employer_name is distinct from new.employer_name
     or old.employer_address is distinct from new.employer_address
     or old.method is distinct from new.method
     or old.sent_to is distinct from new.sent_to
     or old.contacted_on is distinct from new.contacted_on
     or old.wording_version is distinct from new.wording_version
     or old.body_sent is distinct from new.body_sent
  then
    raise exception 'employer_inquiry_immutable' using errcode = 'EI010';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_employer_inquiry on public.employer_inquiries;
create trigger trg_guard_employer_inquiry
  before update on public.employer_inquiries
  for each row
  execute function public.guard_employer_inquiry_immutable();

comment on table public.employer_inquiries is
  'The §391.23(c)(2) written record: one row per contact ATTEMPT with a previous employer, carrying the name and address as contacted, the date, the exact wording sent, and what came back. Attempts are the deliverable when nobody answers (§391.23(c)(1)).';
