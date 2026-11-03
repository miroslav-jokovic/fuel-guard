-- 0553 — recruiting's lead tables: the hiring profile, the opening, the lead ledger, who contacted a lead,
-- what `leadMatch` said, and which applicant a lead became (ADS-AGENT-BUILD-WORKFLOW.md step D0, §1.2-9;
-- ADS-AGENT-PLAN.md §4.1; RECRUITER-AUTOMATION-PLAN.md 1.1, 1.2, 2.1, 3.1; LEAD-SOURCING-PLAN.md S1, S2).
--
-- ── WHAT GAP ─────────────────────────────────────────────────────────────────────────────────────
-- The ads module (0537) can create a campaign and a Meta Instant Form, but a lead the form collects has
-- nowhere to land: `LeadSink` (packages/shared/src/ads/contracts.ts) has no implementation, because the
-- lead belongs to recruiting (D-AD17) and recruiting has no lead table. B4 (lead intake) may not be
-- mounted before one exists — a lead with nowhere to go is a lost lead (§4R Lead intake: "0 lost").
-- Nor is there anything an ad may advertise: the facts of an opening and the requirements a lead is
-- matched against (the owner's Hiring Profile v1, ruled 2026-10-26, RECRUITER-AUTOMATION-PLAN §3a)
-- live only in a plan. This migration is their store; D1 writes and reads it.
--
-- ── WHAT ALREADY EXISTED, AND WHY NONE OF IT IS THIS ─────────────────────────────────────────────
-- Checked 2026-11-03 against main `c668a9b` (the hiring chat's 0538–0551) before adding anything:
--   · `recruiting_settings` (`required_questions`, `offered_document_slots`, `hidden_hiring_steps`;
--     0545, 0550) is what the APPLICATION asks. The profile is who QUALIFIES — age, verifiable Class A
--     years, endorsements, disqualifiers. Neither restates the other.
--   · `hiring_carrier_steps` (0545) is the checklist after someone has applied.
--   · `sms_outbox` (0376) is the queue of texts to an applicant; a lead has no driver row, and a contact
--     with a lead is a person's act (D-LS6), never a queued send.
--   · `ad_generations` (0537) and `document_reads` (0448) are the ads and document-reading provenance.
-- No requirement constant exists in code either: §3a's 23 / 2 years lives only in the plan.
--
-- ── WHAT IS DELIBERATELY NOT HERE: `recruiting_ai_outputs` ───────────────────────────────────────
-- The workflow's D0 row lists it. Nothing in Stage 1 writes it: a Meta lead arrives structured, and the
-- first recruiting model call is D3's mailbox extractor (`proposed` lead → recruiter confirms), which
-- waits on G15. A new table is exempt from the two-merge rule, so it costs nothing to add with its
-- writer; added now it would be a table on `check-table-producers`' waiver list for weeks.
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
--   configuration, versioned   hiring_profiles (+ _versions) · recruiting_openings (+ _versions)
--   operational, prunable      recruiting_leads (D-LS7, D-RA12) · lead_match_verdicts (go with the lead)
--   evidence, append-only      recruiting_contacts · lead_conversions   (both in RETENTION_FORBIDDEN)
--
-- Every table: RLS on with no client policy (deny-all from a browser; the API reads and writes with the
-- service role and org-filters itself, `expectOrgScoped`). Every reference between these tables, and
-- the conversion's reference to `drivers`, is a composite `(org_id, …)` foreign key, so a row can never
-- cite another carrier's profile, opening, lead or applicant (23503, no trigger needed).
--
-- ── VERSIONS: THE PARENT IS THE IDENTITY, EVERY EDIT IS A ROW ────────────────────────────────────
-- 0537's brand-kit shape. Changing "23" or "2 years" is a new profile version, and every verdict keeps
-- the version it was made under (§3a: "every past verdict keeps the version it was made under"). An
-- opening version pins the profile version it narrows, so an ad's facts and a lead's verdicts name the
-- same requirements. The requirements are jsonb checked for shape only: what a rule means is
-- `leadMatch`'s, in TypeScript (D-RA3), and a CHECK naming rule keys would be a second copy. No v1 is
-- seeded: the defaults live in code and the first save writes version 1 (`recruiting_settings`' way).
--
-- The hiring area is a point, a radius of 15–500 miles and a reason a person wrote, the same bounds as
-- `adAreaSchema`. There is no ZIP column to fill (Illinois HB 3773 treats ZIP as a proxy; Meta's
-- employment category floor is 15 miles).
--
-- ── THE LEAD: ITS ATTRIBUTION NEVER CHANGES ──────────────────────────────────────────────────────
-- `(org_id, channel, external_ref)` is the idempotency key (D-RA7; `LeadSink.accept`: "the same lead
-- twice is stored once"); a lead with no outside id (a paste) has a null ref and no key. The raw payload
-- is kept whole and the projection beside it is re-derivable (D-PSP2). Channel, source, campaign, ref,
-- opening and raw are frozen once written (RL013): they are the attribution a conversion reads, and the
-- report that tells the owner where to spend (D-LS5) must not be rewritten by an edit to the contact
-- details. So the conversion does not copy them — it points at the lead, and the lead cannot be pruned
-- while a conversion points at it (on delete restrict). Name, phone, email, status and assignee are the
-- recruiter's to correct.
--
-- The phone is E.164 and the email lower-case BY CHECK, because D1's dedupe compares them against
-- applicants and drivers, and a lead stored any other way would never match anybody.
--
-- ── CONTACTS AND CONVERSIONS ARE EVIDENCE ────────────────────────────────────────────────────────
-- `recruiting_contacts`: one row per call, text or email a PERSON made (D-LS6, ruled 2026-09-25: "all
-- the contacts will be done by real persons"), so `created_by` is not null and there is no system
-- actor. `lead_conversions`: the lead → applicant act. Both refuse UPDATE and DELETE for every role,
-- the service role included (IV011's shape, 0331), except:
--   · the roster merge moves `lead_conversions.driver_id` to the surviving record (RL011 freezes every
--     other column; the composite FK keeps it inside the carrier) — listed in `DRIVER_REASSIGNMENTS`;
--   · the applicant purge removes a converted lead WHOLE: its contacts, its conversion, its verdicts and
--     the lead itself, through `fuelguard.purging_applicant` (0380), for THIS applicant only.
-- The person columns are a uuid and a name with no FK to auth.users (0537's reason: an `on delete set
-- null` is an UPDATE the guard refuses, so deleting a login would fail).
--
-- `lead_match_verdicts` are recomputed, never edited (RL014): a new computation is a new row, the newest
-- per (lead, profile version, requirement) is the answer, and they go with their lead (on delete cascade).
--
-- ── THE SQLSTATE REGISTER (RL: free on main 2026-11-03) ──────────────────────────────────────────
--   RL010  a contact or a conversion updated or deleted (outside the merge and the purge)
--   RL011  a conversion's merge move changed something other than `driver_id`
--   RL012  a profile or opening version updated or deleted
--   RL013  a lead's attribution (channel, source, campaign, ref, opening, raw, received_at) changed
--   RL014  a match verdict updated
--
-- cross-module-waiver: the applicant purge (`purge_applicant`, recruiting's) is redefined whole to add
-- the lead tables, and its body already deletes from evidence's, psp's and roster's tables as one audited
-- act (0380, 0387, 0535, 0538, 0539, 0545); nothing about those deletes changes here.
--
-- raw-access-waiver: `purge_applicant` is copied whole from 0545 and has always deleted the applicant's
-- `psp_requests` rows itself — the purge is the one audited act that removes everything they wrote.
--
-- ⚠ DEPLOY WINDOW: six new tables (no old reader can trip over them) and a redefined purge that only
-- deletes more. The one code change in the same PR is the merge list, which updates `lead_conversions`;
-- a merge run in the minutes between the code deploying and `migrate-staging` applying this would fail
-- loudly on a missing table, never lose a row. Nothing else reads these tables until D1, a later merge.

-- ── 0. the refusals ──────────────────────────────────────────────────────────────────────────────
create or replace function public.recruiting_refuse_version_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is versioned: save a new version instead of changing one', tg_table_name
    using errcode = 'RL012';
end;
$$;

-- ── 1. the hiring profile, versioned (RECRUITER-AUTOMATION-PLAN 1.1, §3a) ────────────────────────
create table if not exists public.hiring_profiles (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 120),
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, id)
);
alter table public.hiring_profiles enable row level security;

create table if not exists public.hiring_profile_versions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  profile_id      uuid not null,
  version         integer not null check (version >= 1),
  -- Each requirement: its key, hard or preference, its threshold, and the reason shown to recruiters
  -- (LEAD-SOURCING-PLAN §4). Shape: the shared hiring-profile contract (D1).
  requirements    jsonb not null check (jsonb_typeof(requirements) = 'object'),
  created_by      uuid not null,
  created_by_name text not null check (length(btrim(created_by_name)) between 1 and 200),
  created_at      timestamptz not null default now(),
  unique (profile_id, version),
  unique (org_id, id),
  foreign key (org_id, profile_id) references public.hiring_profiles (org_id, id) on delete restrict
);
alter table public.hiring_profile_versions enable row level security;
drop trigger if exists trg_hiring_profile_versions_immutable on public.hiring_profile_versions;
create trigger trg_hiring_profile_versions_immutable before update or delete on public.hiring_profile_versions
  for each row execute function public.recruiting_refuse_version_change();

-- ── 2. the opening, versioned (RECRUITER-AUTOMATION-PLAN 1.2; the plan's "requisition") ──────────
-- The parent carries what moves without changing what was advertised: open, paused, filled, closed
-- (closing one pauses its ads, 1.8). Every edit to what the opening SAYS is a version.
create table if not exists public.recruiting_openings (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  status      text not null default 'open' check (status in ('open', 'paused', 'filled', 'closed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, id)
);
alter table public.recruiting_openings enable row level security;
create index if not exists ix_recruiting_openings_org_status on public.recruiting_openings (org_id, status);

create table if not exists public.recruiting_opening_versions (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  opening_id          uuid not null,
  version             integer not null check (version >= 1),
  profile_version_id  uuid not null,
  title               text not null check (length(btrim(title)) between 2 and 120),
  -- Pay basis and range, home time, equipment, lanes, start date (G4). Shape: the shared opening
  -- contract (D1); every claim an ad makes is checked against these (D-AD1, `adClaims.ts`).
  facts               jsonb not null check (jsonb_typeof(facts) = 'object'),
  headcount           integer check (headcount is null or headcount between 1 and 1000),
  area_label          text not null check (length(btrim(area_label)) between 2 and 120),
  area_latitude       double precision not null check (area_latitude between -90 and 90),
  area_longitude      double precision not null check (area_longitude between -180 and 180),
  area_radius_miles   integer not null check (area_radius_miles between 15 and 500),
  area_reason         text not null check (length(btrim(area_reason)) between 5 and 500),
  created_by          uuid not null,
  created_by_name     text not null check (length(btrim(created_by_name)) between 1 and 200),
  created_at          timestamptz not null default now(),
  unique (opening_id, version),
  unique (org_id, id),
  foreign key (org_id, opening_id) references public.recruiting_openings (org_id, id) on delete restrict,
  foreign key (org_id, profile_version_id) references public.hiring_profile_versions (org_id, id) on delete restrict
);
alter table public.recruiting_opening_versions enable row level security;
drop trigger if exists trg_recruiting_opening_versions_immutable on public.recruiting_opening_versions;
create trigger trg_recruiting_opening_versions_immutable before update or delete on public.recruiting_opening_versions
  for each row execute function public.recruiting_refuse_version_change();

-- ── 3. the lead ledger (RECRUITER-AUTOMATION-PLAN 2.1; D-RA7, D-LS5, D-LS7) ──────────────────────
create table if not exists public.recruiting_leads (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  -- Where it came from: `meta`, `tiktok`, `indeed`, `tenstreet`, `referral`, `paste`… Checked by shape,
  -- not by list (0537's `ad_generations.agent` reason): a new channel is a new collector, not a migration.
  channel             text not null check (channel ~ '^[a-z][a-z0-9_]{1,40}$'),
  -- The channel's own id for the lead (Meta's leadgen id, a job board's lead id); null for a paste.
  external_ref        text check (external_ref is null or length(btrim(external_ref)) between 1 and 200),
  source              text check (source is null or source ~ '^[a-z][a-z0-9_]{1,62}$'),
  campaign_ref        text check (campaign_ref is null or length(btrim(campaign_ref)) between 1 and 200),
  opening_id          uuid,
  platform_created_at timestamptz,
  raw                 jsonb not null default '{}'::jsonb,
  answers             jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  full_name           text check (full_name is null or length(btrim(full_name)) between 1 and 200),
  phone_e164          text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email_lower         text check (email_lower is null or (email_lower = lower(email_lower)
                        and length(email_lower) <= 320 and email_lower ~ '^[^@\s]+@[^@\s]+$')),
  status              text not null default 'new'
                        check (status in ('new', 'contacted', 'qualified', 'not_qualified', 'converted', 'lost')),
  assigned_to         uuid references auth.users(id) on delete set null,
  received_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, opening_id) references public.recruiting_openings (org_id, id) on delete restrict
);
alter table public.recruiting_leads enable row level security;
create unique index if not exists ux_recruiting_leads_external_ref
  on public.recruiting_leads (org_id, channel, external_ref) where external_ref is not null;
create index if not exists ix_recruiting_leads_queue on public.recruiting_leads (org_id, status, received_at desc);
create index if not exists ix_recruiting_leads_phone on public.recruiting_leads (org_id, phone_e164) where phone_e164 is not null;
create index if not exists ix_recruiting_leads_email on public.recruiting_leads (org_id, email_lower) where email_lower is not null;

create or replace function public.guard_recruiting_leads()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.channel <> old.channel
     or new.external_ref is distinct from old.external_ref
     or new.source is distinct from old.source
     or new.campaign_ref is distinct from old.campaign_ref
     or new.opening_id is distinct from old.opening_id
     or new.platform_created_at is distinct from old.platform_created_at
     or new.raw <> old.raw
     or new.received_at <> old.received_at
     or new.created_at <> old.created_at then
    raise exception 'recruiting_leads: a lead''s attribution and raw payload never change' using errcode = 'RL013';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_recruiting_leads on public.recruiting_leads;
create trigger trg_guard_recruiting_leads before update on public.recruiting_leads
  for each row execute function public.guard_recruiting_leads();

-- ── 4. contacts: who reached a lead, how (D-LS6; append-only) ────────────────────────────────────
create table if not exists public.recruiting_contacts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  lead_id         uuid not null,
  direction       text not null check (direction in ('outbound', 'inbound')),
  method          text not null check (method in ('call', 'sms', 'email', 'platform_message', 'in_person')),
  outcome         text check (outcome is null or outcome in ('reached', 'voicemail', 'no_answer', 'wrong_number', 'declined')),
  note            text check (note is null or length(note) <= 2000),
  created_by      uuid not null,
  created_by_name text not null check (length(btrim(created_by_name)) between 1 and 200),
  contacted_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  foreign key (org_id, lead_id) references public.recruiting_leads (org_id, id) on delete restrict
);
alter table public.recruiting_contacts enable row level security;
create index if not exists ix_recruiting_contacts_lead on public.recruiting_contacts (org_id, lead_id, contacted_at desc);

-- ── 5. match verdicts (RECRUITER-AUTOMATION-PLAN 3.1; D-RA3, D-LS3, D-LS4) ───────────────────────
-- `unknown` is not a fail — it is the next question to ask on the call — and for a Meta lead age and
-- the four disqualifiers are `unknown` by design (ADS-AGENT-PLAN §1, "Meta employment rules").
create table if not exists public.lead_match_verdicts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  lead_id            uuid not null,
  profile_version_id uuid not null,
  requirement        text not null check (requirement ~ '^[a-z][a-z0-9_]{1,40}$'),
  verdict            text not null check (verdict in ('meets', 'does_not_meet', 'unknown')),
  evidence           text check (evidence is null or evidence in ('self_reported', 'document', 'verified')),
  detail             jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  computed_at        timestamptz not null default now(),
  -- A verdict that is not `unknown` stands on a fact, and every fact has an evidence level (D-LS4).
  check ((verdict = 'unknown') or evidence is not null),
  foreign key (org_id, lead_id) references public.recruiting_leads (org_id, id) on delete cascade,
  foreign key (org_id, profile_version_id) references public.hiring_profile_versions (org_id, id) on delete restrict
);
alter table public.lead_match_verdicts enable row level security;
create index if not exists ix_lead_match_verdicts_lead
  on public.lead_match_verdicts (org_id, lead_id, profile_version_id, requirement, computed_at desc);

create or replace function public.guard_lead_match_verdicts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'lead_match_verdicts are recomputed, never edited: write a new row' using errcode = 'RL014';
end;
$$;
drop trigger if exists trg_guard_lead_match_verdicts on public.lead_match_verdicts;
create trigger trg_guard_lead_match_verdicts before update on public.lead_match_verdicts
  for each row execute function public.guard_lead_match_verdicts();

-- ── 6. conversions: which applicant a lead became (append-only; the merge and the purge excepted) ─
create table if not exists public.lead_conversions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  lead_id           uuid not null,
  driver_id         uuid not null,
  converted_by      uuid not null,
  converted_by_name text not null check (length(btrim(converted_by_name)) between 1 and 200),
  created_at        timestamptz not null default now(),
  -- One lead becomes one applicant once. Two leads may become the same applicant (the same person on
  -- two platforms), and each keeps its own attribution.
  unique (lead_id),
  foreign key (org_id, lead_id) references public.recruiting_leads (org_id, id) on delete restrict,
  foreign key (org_id, driver_id) references public.drivers (org_id, id) on delete restrict
);
alter table public.lead_conversions enable row level security;
create index if not exists ix_lead_conversions_driver on public.lead_conversions (org_id, driver_id);

create or replace function public.guard_lead_conversions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public.purging_applicant(old.driver_id) then
      return old;
    end if;
    raise exception 'lead_conversions are never deleted' using errcode = 'RL010';
  end if;
  -- The roster merge moves a conversion to the surviving record; nothing else about it changes. The
  -- composite foreign key keeps the new driver inside the carrier.
  if new.id <> old.id or new.org_id <> old.org_id or new.lead_id <> old.lead_id
     or new.converted_by <> old.converted_by or new.converted_by_name <> old.converted_by_name
     or new.created_at <> old.created_at then
    raise exception 'lead_conversions are never edited' using errcode = 'RL011';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_lead_conversions on public.lead_conversions;
create trigger trg_guard_lead_conversions before update or delete on public.lead_conversions
  for each row execute function public.guard_lead_conversions();

create or replace function public.guard_recruiting_contacts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only the purge of the applicant this lead became; a contact with a lead nobody converted is kept
  -- (D-RA12: contacts are evidence, the lead is not).
  if tg_op = 'DELETE' and exists (
       select 1 from public.lead_conversions c
        where c.lead_id = old.lead_id and public.purging_applicant(c.driver_id)) then
    return old;
  end if;
  raise exception 'recruiting_contacts are append-only: a correction is a new row' using errcode = 'RL010';
end;
$$;
drop trigger if exists trg_guard_recruiting_contacts on public.recruiting_contacts;
create trigger trg_guard_recruiting_contacts before update or delete on public.recruiting_contacts
  for each row execute function public.guard_recruiting_contacts();

-- ── 7. the mutable tables: updated_at and an org that never changes ──────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['hiring_profiles', 'recruiting_openings', 'recruiting_leads'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I
                      for each row execute function public.set_updated_at()', t);
  end loop;
  foreach t in array array['hiring_profiles', 'recruiting_openings', 'recruiting_leads', 'lead_conversions'] loop
    execute format('drop trigger if exists trg_%1$s_org_immutable on public.%1$I', t);
    execute format('create trigger trg_%1$s_org_immutable before update on public.%1$I
                      for each row execute function public.forbid_org_change()', t);
  end loop;
end;
$$;

comment on table public.hiring_profiles is
  'D0 (0553), RECRUITER-AUTOMATION-PLAN 1.1: a hiring profile''s identity; what it requires is in hiring_profile_versions. Service-role only.';
comment on table public.hiring_profile_versions is
  'D0 (0553): every save of a hiring profile; leadMatch verdicts cite the version they were made under. Immutable (RL012). Service-role only.';
comment on table public.recruiting_openings is
  'D0 (0553), RECRUITER-AUTOMATION-PLAN 1.2: an opening and its status (open/paused/filled/closed); what it says is in recruiting_opening_versions. Service-role only.';
comment on table public.recruiting_opening_versions is
  'D0 (0553): every save of an opening — title, facts an ad may state, headcount, area (point + 15–500 mi + reason, never ZIP), and the profile version it pins. Immutable (RL012). Service-role only.';
comment on table public.recruiting_leads is
  'D0 (0553), D-RA7: one row per lead, idempotent on (org, channel, external_ref), raw kept whole; attribution frozen (RL013). Operational and prunable (D-LS7), but never while a conversion points at it. Service-role only.';
comment on table public.recruiting_contacts is
  'D0 (0553), D-LS6: one call/text/email a person made to a lead. Append-only (RL010) except the purge of the applicant the lead became; RETENTION_FORBIDDEN. Service-role only.';
comment on table public.lead_match_verdicts is
  'D0 (0553), D-RA3: leadMatch''s verdict per lead × profile version × requirement, with its evidence level. Recomputed, never edited (RL014); goes with its lead. Service-role only.';
comment on table public.lead_conversions is
  'D0 (0553), D-LS5: lead → applicant (drivers row); attribution is read from the frozen lead. Append-only (RL010/RL011) except the roster merge''s driver_id and purge_applicant; RETENTION_FORBIDDEN. Service-role only.';

-- ── grants: no client may call these ─────────────────────────────────────────────────────────────
revoke all on function public.recruiting_refuse_version_change() from public, anon, authenticated;
revoke all on function public.guard_recruiting_leads() from public, anon, authenticated;
revoke all on function public.guard_lead_match_verdicts() from public, anon, authenticated;
revoke all on function public.guard_lead_conversions() from public, anon, authenticated;
revoke all on function public.guard_recruiting_contacts() from public, anon, authenticated;

-- ── 8. the applicant purge removes a converted lead whole ────────────────────────────────────────
-- 0545's body with `lead_conversions` added to PA011's owned list, and the lead the applicant came from
-- deleted with them: its contacts, its conversion, its verdicts and the lead itself. A lead nobody
-- converted is not this applicant's, even if the phone matches (D-LS10: no dossier), and is left alone.
create or replace function public.purge_applicant(p_org uuid, p_driver uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The tables this function deletes from BY `driver_id`. Every other table referencing drivers(id)
  -- must be empty for this driver, or the purge refuses (PA011). `sms_suppressions` is here only so
  -- that its SET NULL is allowed to happen: the row is kept (see the header).
  v_owned constant text[] := array[
    'application_invitations', 'driver_applications', 'driver_authorizations', 'esign_consents',
    'application_drafts', 'application_captures', 'driver_employment_history', 'employer_inquiries',
    'psp_requests', 'qualification_records', 'applicant_dispositions', 'sms_consents', 'sms_outbox',
    'sms_suppressions', 'applicant_notes', 'driver_employment_gaps', 'orientation_video_attestations',
    'orientation_video_opens', 'hiring_carrier_step_records', 'lead_conversions'];
  v_driver record;
  v_invitations uuid[];
  v_leads uuid[];
  v_fk record;
  v_found boolean;
  v_counts jsonb := '{}'::jsonb;
  v_storage jsonb;
  v_n bigint;
begin
  if p_org is null or p_driver is null or p_actor is null then
    raise exception 'purge_applicant: org, driver and actor are all required' using errcode = 'PA020';
  end if;

  -- Admin only (the ruling). The api checks it first; this is the same fact read again at the one
  -- place an irreversible act happens, because the service role bypasses everything else.
  if not exists (select 1 from public.memberships m
                  where m.org_id = p_org and m.user_id = p_actor and m.role = 'admin') then
    raise exception 'purge_applicant_not_admin: only an admin of the carrier may delete an applicant'
      using errcode = 'PA030';
  end if;

  -- Locked, so a hire racing this purge waits for it and then finds no row, rather than the purge
  -- deleting somebody hired a millisecond earlier.
  select d.id, d.status, d.hire_date, d.termination_date, d.user_id, d.mcleod_driver_id,
         d.samsara_driver_id, d.efs_driver_id, d.photo_path, d.created_at
    into v_driver
    from public.drivers d
   where d.id = p_driver and d.org_id = p_org
     for update;
  if not found then
    -- Cross-org lands here too, deliberately in the same words: another carrier's driver id is
    -- indistinguishable from no driver at all.
    raise exception 'purge_applicant_not_found: driver % not found in org %', p_driver, p_org
      using errcode = 'PA020';
  end if;

  if v_driver.status <> 'applicant'
     or v_driver.hire_date is not null
     or v_driver.termination_date is not null
     or exists (select 1 from public.audit_logs a
                 where a.org_id = p_org
                   and a.created_at >= v_driver.created_at
                   and a.action = 'compliance.applicant_hired'
                   and a.entity_id = p_driver)
  then
    raise exception 'purge_applicant_was_hired: driver % was hired; a qualification file is kept for the length of employment plus three years (§391.51)', p_driver
      using errcode = 'PA010';
  end if;

  if v_driver.user_id is not null or v_driver.mcleod_driver_id is not null
     or v_driver.samsara_driver_id is not null or v_driver.efs_driver_id is not null then
    raise exception 'purge_applicant_linked: driver % has a driver-app account or a McLeod, Samsara or EFS id', p_driver
      using errcode = 'PA012';
  end if;

  for v_fk in
    -- By name and schema, not `regclass::text`: under this function's empty search_path that text is
    -- schema-qualified and would never equal a name in v_owned.
    select n.nspname as nsp, r.relname as tbl, a.attname as col
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class r on r.oid = c.conrelid
      join pg_catalog.pg_namespace n on n.oid = r.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'f' and c.confrelid = 'public.drivers'::regclass
     order by 2, 3
  loop
    continue when v_fk.nsp = 'public' and v_fk.tbl = any (v_owned);
    execute format('select exists (select 1 from %I.%I where %I = $1)', v_fk.nsp, v_fk.tbl, v_fk.col)
      into v_found using p_driver;
    if v_found then
      raise exception 'purge_applicant_has_records: driver % has rows in %.%.%, which an applicant''s purge does not own', p_driver, v_fk.nsp, v_fk.tbl, v_fk.col
        using errcode = 'PA011';
    end if;
  end loop;
  if exists (select 1 from public.dq_exports x where x.org_id = p_org and p_driver = any (x.driver_ids)) then
    raise exception 'purge_applicant_has_records: driver % is named in a DQ export', p_driver
      using errcode = 'PA011';
  end if;

  select coalesce(array_agg(i.id), '{}') into v_invitations
    from public.application_invitations i
   where i.driver_id = p_driver and i.org_id = p_org;

  -- Read before the rows go: the paths are the only way P2 can find the objects afterwards.
  select jsonb_build_object(
    'documents', coalesce((select jsonb_agg(x.storage_path order by x.storage_path) from public.documents x
                            where x.org_id = p_org and x.subject_type = 'driver' and x.subject_id = p_driver
                              and x.storage_path is not null), '[]'::jsonb),
    'application_captures', coalesce((select jsonb_agg(x.storage_path order by x.storage_path) from public.application_captures x
                            where x.driver_id = p_driver and x.storage_path is not null), '[]'::jsonb),
    'signature_adoptions', coalesce((select jsonb_agg(x.storage_path order by x.storage_path) from public.signature_adoptions x
                            where x.invitation_id = any (v_invitations) and x.storage_path is not null), '[]'::jsonb),
    'drivers', case when v_driver.photo_path is null then '[]'::jsonb else jsonb_build_array(v_driver.photo_path) end)
    into v_storage;

  perform set_config('fuelguard.purging_applicant', p_driver::text, true);

  -- Children of the invitations first, the RESTRICT edges' order: whatever points at an adoption or
  -- an inquiry goes before it.
  -- 0387: the countersignature points at the application and a document, so it goes before both.
  delete from public.application_packet_countersignatures where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_packet_countersignatures', v_n);
  delete from public.employer_verification_calls where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('employer_verification_calls', v_n);
  delete from public.handbook_marks where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('handbook_marks', v_n);
  delete from public.application_packet_marks where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_packet_marks', v_n);
  -- `revokes` (a self-reference, RESTRICT) needs no ordering: a revocation and the authorization it
  -- revokes go in this one statement, and RESTRICT is checked at the statement's end.
  delete from public.driver_authorizations where driver_id = p_driver or invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('driver_authorizations', v_n);
  delete from public.signature_adoptions where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('signature_adoptions', v_n);
  delete from public.driver_applications where driver_id = p_driver or invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('driver_applications', v_n);
  delete from public.esign_consents where driver_id = p_driver or invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('esign_consents', v_n);
  delete from public.application_edits where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_edits', v_n);
  delete from public.application_intake_licences where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_intake_licences', v_n);
  delete from public.application_intakes where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_intakes', v_n);
  delete from public.drug_test_appointments where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('drug_test_appointments', v_n);
  delete from public.applicant_travel where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('applicant_travel', v_n);
  delete from public.application_screen_events where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_screen_events', v_n);
  delete from public.application_drafts where driver_id = p_driver or invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_drafts', v_n);
  delete from public.application_captures where driver_id = p_driver or invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_captures', v_n);
  delete from public.sms_outbox where driver_id = p_driver or invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('sms_outbox', v_n);

  -- The recruiting record held by the driver.
  delete from public.employer_inquiries where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('employer_inquiries', v_n);
  delete from public.driver_employment_history where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('driver_employment_history', v_n);
  delete from public.psp_requests where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('psp_requests', v_n);
  delete from public.qualification_records where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('qualification_records', v_n);
  delete from public.applicant_dispositions where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('applicant_dispositions', v_n);
  delete from public.sms_consents where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('sms_consents', v_n);
  -- 0535: the office's notes go with the applicant — a purge that left them would leave the person.
  delete from public.applicant_notes where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('applicant_notes', v_n);
  -- 0538: the gaps the office recorded go with the applicant, for the same reason.
  delete from public.driver_employment_gaps where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('driver_employment_gaps', v_n);
  -- 0539: the applicant's "I watched these" and the links they opened go with the applicant. Before
  -- `application_invitations` below: both point at an invitation, on delete restrict.
  delete from public.orientation_video_attestations where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('orientation_video_attestations', v_n);
  delete from public.orientation_video_opens where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('orientation_video_opens', v_n);
  -- 0545: what the office recorded on the carrier's own steps goes with the applicant. Before `documents`
  -- (a document step's record points at the filed paper) and the invitations, both on delete restrict.
  delete from public.hiring_carrier_step_records where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('hiring_carrier_step_records', v_n);

  -- 0553: the lead(s) this applicant came from go with them whole. Contacts first (their guard opens
  -- only while the conversion that names this applicant still exists), then the conversion, then the
  -- verdicts (deleted here rather than by cascade, so the count is reported) and the lead.
  select coalesce(array_agg(c.lead_id), '{}') into v_leads
    from public.lead_conversions c
   where c.driver_id = p_driver and c.org_id = p_org;
  delete from public.recruiting_contacts where org_id = p_org and lead_id = any (v_leads);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('recruiting_contacts', v_n);
  delete from public.lead_conversions where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('lead_conversions', v_n);
  delete from public.lead_match_verdicts where org_id = p_org and lead_id = any (v_leads);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('lead_match_verdicts', v_n);
  delete from public.recruiting_leads where org_id = p_org and id = any (v_leads);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('recruiting_leads', v_n);

  -- Polymorphic references (no FK): after every row that points at a document.
  delete from public.certifications where org_id = p_org and subject_type = 'driver' and subject_id = p_driver;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('certifications', v_n);
  -- `derived_from` is the same: a thumbnail and its original go in one statement.
  delete from public.documents where org_id = p_org and subject_type = 'driver' and subject_id = p_driver;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('documents', v_n);

  delete from public.application_invitations where id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_invitations', v_n);

  delete from public.drivers where id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('drivers', v_n);

  perform set_config('fuelguard.purging_applicant', '', true);

  return jsonb_build_object('counts', v_counts, 'storage', v_storage);
end;
$$;

comment on function public.purge_applicant(uuid, uuid, uuid) is
  'Q-AW40: deletes an applicant who was never hired, and every row their application wrote, as one audited service-role act (the api writes driver.purged). Refuses PA010 ever hired (status, hire/termination date, or a compliance.applicant_hired audit row), PA011 rows in any drivers-referencing table it does not own or a DQ export naming them, PA012 a driver-app account or McLeod/Samsara/EFS id, PA020 not in this org, PA030 actor not an admin. Opens the seven delete guards for THIS driver only, through fuelguard.purging_applicant (transaction-local); 0387 added application_packet_countersignatures; 0535 applicant_notes; 0538 driver_employment_gaps; 0539 orientation_video_attestations and orientation_video_opens; 0545 hiring_carrier_step_records; 0553 lead_conversions, and the converted lead whole (recruiting_contacts, lead_match_verdicts, recruiting_leads). Returns {counts, storage}: the Storage paths the api must remove.';
