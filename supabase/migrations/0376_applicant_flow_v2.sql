-- 0376 — the schema for the applicant flow v2: Part 1's own tables, signatures adopted once, a
-- versioned packet mark, the office's screening records, and an SMS queue that holds instead of
-- dropping (APPLICATION-FLOW-V2-PLAN.md §8.2, "M1"; D-AW1, D-AW3, D-AW4, D-AW6..D-AW8, D-AW12,
-- D-AW14, D-AW15; audit findings A-5, A-10, A-11, G-9, G-13).
--
-- ── THE GAP ──────────────────────────────────────────────────────────────────────────────────────
-- The owner's order (plan §1.1) splits the applicant's link into three visits: Part 1 ("get
-- started": identity, phone, address, every licence held in three years, documents, a selfie, two
-- screening questions, the FCRA summary and the six permissions), the office's screening, then Part
-- 2 (the §391.21 form) and signing on the driver's own phone. Today every one of those facts lives
-- in the half-typed draft (`application_drafts.payload`), which is operational, prunable after 90
-- days, and read only at certification — so the office screens against something that can vanish,
-- and PSP/MVR read a licence list the applicant can still retype. §2.3 of the plan lists the seven
-- assumptions this breaks; this migration is the schema half of the fix and nothing else.
--
-- ── WHAT IS HERE, BY DECISION ────────────────────────────────────────────────────────────────────
--   D-AW1/D-AW3  `application_intakes` + `application_intake_licences`, written by ONE function,
--                `record_applicant_intake`, which calls `record_applicant_identity` (0365) for the DOB
--                and licence number/state so the draft patch keeps its single writer (D-AF8);
--                `complete_applicant_intake` stamps `intake_completed_at` and promotes Part 1's
--                photographs (D-AW4) — never the selfie.
--   D-AW15       `signature_adoptions` (append-only; the row IS the registration of the PNG in the
--                evidence bucket) and `adoption_id` on all three mark tables; `record_packet_mark`
--                and `record_driver_release` gain overloads that check it (DR038).
--   A-5          `application_packet_marks.packet_version`; DR037 refuses a packet whose text changed
--                between two marks on the same link.
--   A-10         `application_invitations.handbook_filing_claimed_at` and two partial unique indexes
--                on `qualification_records`, so a double press cannot file twice.
--   D-AW6..D-AW8 `drug_test_appointments`, `applicant_travel`, `employer_verification_calls`; the
--                third is copied into `employer_inquiries` by the new `submit_driver_application`.
--   A-11/D-AW12  `sms_outbox` + `sms_suppressions`.
--   D-AW14       `unlock_failures` and `sign_link_expires_at` on the invitation.
--   D-AW5        the `clearinghouse_portal_consent` kind, restricted like every testing record.
--   AW10         `application_drafts.revision` and a revision-checked `save_application_draft`.
--   AW14         `application_screen_events`.
--   G-9          `driver_authorizations.signed_on` (added at C0c's request, 2026-09-26): the calendar
--                day a paper permission was signed.
--
-- ── OVERLOADS, NOT REPLACEMENTS — AND NO DEFAULTS ────────────────────────────────────────────────
-- Four functions change shape: `submit_driver_application`, `record_driver_release`,
-- `record_packet_mark`, `save_application_draft`. Each gains a NEW signature beside the old one,
-- because the TypeScript that calls the old one is still served for ~2m44s after this applies
-- (docs/MIGRATION-DISCIPLINE.md §the-deploy-window) and for as long after that as C2 takes to ship.
-- PostgREST picks a function by the NAMES of the keys in the call; a defaulted new parameter would
-- make the old call match both and fail as ambiguous (PGRST203 — this repo met it in 0258 and 0312).
-- So every new parameter is required, the old key set matches only the old function, the new key set
-- only the new one, and M2 (0377) drops each old signature once `pg_stat_user_functions` shows no
-- caller. Every new signature carries its own revoke/grant (0339's lines 195–196).
--
-- ⚠ No reader in this merge. Not one TypeScript line reads a column or calls a function added here
-- (`lint:migration-ordering` checks columns only; the functions are held by hand, as 0369 and 0374
-- were). C2 and C3 are the readers, each after this is verified applied in production (§8.1).
--
-- ⚠ Deliberately NOT here (M2, after `d61557dc` is filed): HB022, and
-- `application_invitations_handbook_order_check`. Both stay exactly as 0374 wrote them.
--
-- cross-module-waiver: one plan's schema, and it is the applicant's file end to end — recruiting's
-- tables, the §391.51 evidence it files into (`qualification_records`, `documents`), the roster row
-- Part 1 fills (`drivers`), and the evidence module's kind vocabulary. Split
-- across migrations it would ship a writer before the table it writes.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 1. The invitation: four stamps
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.application_invitations
  add column if not exists intake_completed_at        timestamptz,
  add column if not exists handbook_filing_claimed_at timestamptz,
  add column if not exists unlock_failures            smallint not null default 0,
  add column if not exists sign_link_expires_at       timestamptz;

alter table public.application_invitations drop constraint if exists application_invitations_unlock_failures_check;
alter table public.application_invitations add constraint application_invitations_unlock_failures_check
  check (unlock_failures >= 0);

comment on column public.application_invitations.intake_completed_at is
  'D-AW1: Part 1 ("get started") finished — identity, contact, licences, documents, FCRA summary. Distinct from releases_completed_at (the six permissions). Stamped once by complete_applicant_intake (0376).';
comment on column public.application_invitations.handbook_filing_claimed_at is
  'A-10: the countersign''s claim, taken BEFORE the handbook PDF and record are filed, so a second press finds the claim and files nothing. handbook_filed_at still says the filing finished.';
comment on column public.application_invitations.unlock_failures is
  'D-AW14: wrong date-of-birth answers at the sign link''s unlock screen. Five revoke the link; the office re-sends. The DOB is printed on the CDL photographed in Part 1, so it cannot be the only secret once a link travels by text.';
comment on column public.application_invitations.sign_link_expires_at is
  'D-AW14: the sign link''s own 72-hour life from the office''s "Send for signing". Separate from expires_at, which is the whole invitation''s.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 2. Part 1's facts (D-AW3)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Their own tables and NOT keys in the draft, because the draft is the wrong kind of store for them
-- in three ways the plan measured (§2.3.1–2): it is pruned at 90 days while screening outlives that;
-- it is a free-form payload the applicant retypes, while PSP and the MVR must read the licence list
-- they were ordered against; and it is validated only at certification, after the office has acted
-- on it. A working record — the applicant corrects a typo, the office corrects a licence — so UPDATE
-- is allowed (0230's guard, not an append-only one), and never pruned: it is what screening read.
create table if not exists public.application_intakes (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  invitation_id          uuid not null unique references public.application_invitations(id) on delete cascade,
  -- US numbers only, in E.164: the SMS provider is US-only (C2's "US-only numbers").
  phone                  text constraint application_intakes_phone_check check (phone ~ '^\+1[2-9][0-9]{9}$'),
  address_line1          text,
  address_line2          text,
  city                   text,
  state                  text constraint application_intakes_state_check check (state ~ '^[A-Z]{2}$'),
  postal_code            text constraint application_intakes_postal_check check (postal_code ~ '^[0-9]{5}$'),
  -- §40.25(j): a positive test or refusal in the two years before applying to a DOT employer.
  -- Required by record_applicant_intake (AI009, D-AW13), never by the draft's refinement.
  prior_positive_2y      boolean,
  dot_program_30d        boolean,
  dot_tested_6m          boolean,
  dot_random_12m         boolean,
  -- Which FCRA "Summary of Your Rights" text was shown, and when (the server's clock).
  fcra_summary_version   text,
  fcra_summary_shown_at  timestamptz,
  -- D-AW4: "I don't have a medical card yet" is an answer, and lets Part 1 finish without one.
  medical_card_pending   boolean not null default false,
  -- The endorsements the applicant DECLARES (0098's letters). Kept here and projected nowhere: the
  -- `driver_endorsements` table §8.2 names was retired by 0147, and the live store is `certifications`
  -- kind 'endorsement', whose rows need an `effective_from` an applicant's claim does not have. Whether
  -- a declaration becomes a certification is C2's question (the PR's "Readings taken"), not a guess here.
  endorsements           text[] constraint application_intakes_endorsements_check
                           check (endorsements is null or endorsements <@ array['H','N','X','T','P','S']::text[]),
  -- D-AW10 phase 1: a person compares the selfie with the licence photograph.
  selfie_verdict         text constraint application_intakes_selfie_verdict_check
                           check (selfie_verdict in ('matches','does_not_match','unclear')),
  selfie_verdict_by      uuid references auth.users(id) on delete set null,
  selfie_verdict_at      timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint application_intakes_selfie_verdict_pair_check
    check ((selfie_verdict is null) = (selfie_verdict_at is null))
);

create index if not exists idx_application_intakes_session
  on public.application_intakes (org_id, invitation_id);

alter table public.application_intakes enable row level security;

comment on table public.application_intakes is
  'D-AW3: Part 1''s facts for one invitation — contact, address, the four drug-and-alcohol screening answers, the FCRA summary shown, the selfie verdict. A working record (the service may UPDATE), never pruned: it is what screening read. Written only by record_applicant_intake (0376); the selfie verdict by the office.';

-- Every licence held in the three years before applying (§391.21(b)(4)); position 0 is the current
-- CDL. The MVR jurisdictions are READ from here (D-AW3), which is why it is a table and not a list in
-- a payload: "which states must the MVR cover" becomes a query instead of a parse.
-- ⚠ `state_code` is shape-checked here and validated against `JURISDICTION_CODES`
-- (`packages/shared/src/jurisdictions.ts`) in TypeScript — 0339's reasoning for not enumerating a
-- vocabulary in SQL that TypeScript owns.
create table if not exists public.application_intake_licences (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  invitation_id   uuid not null references public.application_invitations(id) on delete cascade,
  position        smallint not null constraint application_intake_licences_position_check check (position >= 0),
  state_code      text not null constraint application_intake_licences_state_check check (state_code ~ '^[A-Z]{2}$'),
  -- The issuing authority's name, for a licence that is not a US state's. 80 is the application's own
  -- ceiling (`applicationLicenceSchema.issuing_authority`); A-3's shared constant (C0c) is ≤ that.
  agency          text constraint application_intake_licences_agency_check check (agency is null or length(agency) between 1 and 80),
  licence_number  text not null constraint application_intake_licences_number_check check (length(btrim(licence_number)) between 1 and 40),
  expires_on      date,
  -- `legacy_draft`: C2 copies the two mid-flight drafts' licence lists here before their prune date.
  source          text not null default 'intake'
                    constraint application_intake_licences_source_check check (source in ('intake','legacy_draft')),
  created_at      timestamptz not null default now(),
  constraint application_intake_licences_position_key unique (invitation_id, position),
  constraint application_intake_licences_licence_key unique (invitation_id, state_code, licence_number)
);

create index if not exists idx_application_intake_licences_session
  on public.application_intake_licences (org_id, invitation_id);

alter table public.application_intake_licences enable row level security;

comment on table public.application_intake_licences is
  'D-AW3: every licence the applicant held in three years (§391.21(b)(4)), position 0 = the current CDL. The MVR reads its jurisdictions from here. Replaced whole by record_applicant_intake until intake_completed_at, then only by the office. Never pruned.';

-- ── The guards: 0230's, one errcode each ─────────────────────────────────────────────────────────
-- `auth_role() is null` is the service role; any JWT-bearing writer is refused. RLS with no policies
-- already refuses a browser outright — this is the second lock and the statement of intent.
create or replace function public.guard_application_intakes_client_writes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.auth_role() is not null then
    raise exception 'application_intakes is written only by the application API' using errcode = 'AI010';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_guard_application_intakes on public.application_intakes;
create trigger trg_guard_application_intakes
  before insert or update or delete on public.application_intakes
  for each row execute function public.guard_application_intakes_client_writes();

create or replace function public.guard_application_intake_licences_client_writes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.auth_role() is not null then
    raise exception 'application_intake_licences is written only by the application API' using errcode = 'AI011';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_guard_application_intake_licences on public.application_intake_licences;
create trigger trg_guard_application_intake_licences
  before insert or update or delete on public.application_intake_licences
  for each row execute function public.guard_application_intake_licences_client_writes();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 3. Captures: the selfie slot, server verification, and promotion at Part 1 (D-AW4, D-AW9)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.application_captures drop constraint if exists application_captures_slot_check;
alter table public.application_captures add constraint application_captures_slot_check
  check (slot in (
    'cdl_front','cdl_back','medical_card','ssn_card','signature_mark','initials_mark','selfie','other'));

-- `on delete restrict`: a filed document is evidence, and nothing may take it out from under the
-- capture that became it. Promotion at Part 1 is why this column exists — 0231 promotes at filing,
-- keyed `documents.id = capture.id`, and would hit a primary-key collision on a capture already
-- promoted; the new `submit_driver_application` below skips any capture this names.
alter table public.application_captures
  add column if not exists promoted_document_id uuid references public.documents(id) on delete restrict,
  add column if not exists server_sha256        text,
  add column if not exists metrics              jsonb,
  add column if not exists verified_at          timestamptz;

alter table public.application_captures drop constraint if exists application_captures_server_sha256_check;
alter table public.application_captures add constraint application_captures_server_sha256_check
  check (server_sha256 is null or server_sha256 ~ '^[0-9a-f]{64}$');
alter table public.application_captures drop constraint if exists application_captures_metrics_check;
alter table public.application_captures add constraint application_captures_metrics_check
  check (metrics is null or jsonb_typeof(metrics) = 'object');

comment on column public.application_captures.promoted_document_id is
  'D-AW4: the documents row this capture became when Part 1 completed (complete_applicant_intake). Never set for the selfie, which is never promoted.';
comment on column public.application_captures.server_sha256 is
  'D-AW9: the SHA-256 the API computed from the stored object — the server''s own evidence beside the browser''s claim in sha256.';
comment on column public.application_captures.metrics is
  'D-AW9: the server''s image metrics (sharpness, glare, size). Advisory until thresholds exist (D-SCAN10).';

-- The server's half of a capture: it read the object back, hashed it and measured it. Only fills —
-- a capture is replaced by re-staging (0230), never by re-confirming a different object.
create or replace function public.confirm_application_capture(
  p_org           uuid,
  p_invitation    uuid,
  p_capture       uuid,
  p_server_sha256 text,
  p_bytes         bigint,
  p_metrics       jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.application_captures
     set server_sha256 = p_server_sha256,
         bytes         = coalesce(p_bytes, bytes),
         metrics       = p_metrics,
         verified_at   = now()
   where id = p_capture and invitation_id = p_invitation and org_id = p_org
   returning id into v_id;
  if v_id is null then
    raise exception 'application_capture_not_found' using errcode = 'DA042';
  end if;
end;
$$;

revoke all on function public.confirm_application_capture(uuid, uuid, uuid, text, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.confirm_application_capture(uuid, uuid, uuid, text, bigint, jsonb)
  to service_role;

comment on function public.confirm_application_capture(uuid, uuid, uuid, text, bigint, jsonb) is
  'D-AW9: record the server''s hash, byte count and metrics for one staged capture of this invitation. DA042 when no such capture.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 4. record_applicant_intake — the one writer of Part 1 (D-AW3, amends D-AF8)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- `p_intake` is an object whose PRESENT keys are written and whose absent keys keep what is stored,
-- so Part 1's screens can post what they collected without resending the rest. The DOB and the
-- current licence's number and state go through `record_applicant_identity` (0365), called from
-- here, so the drivers row and the draft keep ONE writer between them (D-AF8's reason: the licence
-- PSP ran against must be the licence on the filed application). Contact and CDL class/expiry go to
-- `drivers` by 0365's rule: fill-only for the applicant (`coalesce(existing, new)` — the office's
-- correction or a rehire's record wins), overwrite for the office.
--
-- Refusals, in 0365's AI range:
--   AI001  no such invitation for this org and driver
--   AI002  revoked; or expired, on the applicant's path only (0365's reading, unchanged)
--   AI003  already submitted
--   AI004  a malformed payload (not an object, a licence without a position/state/number)
--   AI008  Part 1 is complete and the caller is the applicant — only the office corrects it now
--   AI009  the §40.25(j) answer is missing (D-AW13): judged on the row as it stands after the write
create or replace function public.record_applicant_intake(
  p_org          uuid,
  p_invitation   uuid,
  p_driver       uuid,
  p_intake       jsonb,
  p_licences     jsonb,
  p_endorsements text[],
  p_overwrite    boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in        jsonb := coalesce(p_intake, '{}'::jsonb);
  v_expires   timestamptz;
  v_revoked   timestamptz;
  v_submitted timestamptz;
  v_completed timestamptz;
  v_intake    uuid;
  v_prior     boolean;
  v_count     int;
  v_cdl       record;
  v_dob       date;
  v_identity  jsonb;
  v_before    record;
  v_after     record;
begin
  if p_overwrite is null or jsonb_typeof(v_in) <> 'object'
     or (p_licences is not null and jsonb_typeof(p_licences) <> 'array') then
    raise exception 'applicant_intake_invalid' using errcode = 'AI004';
  end if;

  select expires_at, revoked_at, submitted_at, intake_completed_at
    into v_expires, v_revoked, v_submitted, v_completed
    from public.application_invitations
   where id = p_invitation and org_id = p_org and driver_id = p_driver
   for update;

  if v_expires is null then
    raise exception 'application_invitation_not_found' using errcode = 'AI001';
  end if;
  if v_revoked is not null or (not p_overwrite and v_expires <= now()) then
    raise exception 'application_invitation_unusable' using errcode = 'AI002';
  end if;
  if v_submitted is not null then
    raise exception 'application_already_submitted' using errcode = 'AI003';
  end if;
  if v_completed is not null and not p_overwrite then
    raise exception 'intake_frozen' using errcode = 'AI008';
  end if;

  -- ── The intake row: UPDATE first, INSERT only if absent (lint:upserts, 0174) ──────────────────
  update public.application_intakes
     set phone                 = case when v_in ? 'phone' then nullif(btrim(v_in ->> 'phone'), '') else phone end,
         address_line1         = case when v_in ? 'address_line1' then nullif(btrim(v_in ->> 'address_line1'), '') else address_line1 end,
         address_line2         = case when v_in ? 'address_line2' then nullif(btrim(v_in ->> 'address_line2'), '') else address_line2 end,
         city                  = case when v_in ? 'city' then nullif(btrim(v_in ->> 'city'), '') else city end,
         state                 = case when v_in ? 'state' then nullif(btrim(v_in ->> 'state'), '') else state end,
         postal_code           = case when v_in ? 'postal_code' then nullif(btrim(v_in ->> 'postal_code'), '') else postal_code end,
         prior_positive_2y     = case when v_in ? 'prior_positive_2y' then (v_in ->> 'prior_positive_2y')::boolean else prior_positive_2y end,
         dot_program_30d       = case when v_in ? 'dot_program_30d' then (v_in ->> 'dot_program_30d')::boolean else dot_program_30d end,
         dot_tested_6m         = case when v_in ? 'dot_tested_6m' then (v_in ->> 'dot_tested_6m')::boolean else dot_tested_6m end,
         dot_random_12m        = case when v_in ? 'dot_random_12m' then (v_in ->> 'dot_random_12m')::boolean else dot_random_12m end,
         -- The version and the instant move together, and the instant is the server's.
         fcra_summary_version  = case when v_in ? 'fcra_summary_version' then v_in ->> 'fcra_summary_version' else fcra_summary_version end,
         fcra_summary_shown_at = case when v_in ? 'fcra_summary_version' then now() else fcra_summary_shown_at end,
         medical_card_pending  = case when v_in ? 'medical_card_pending' then coalesce((v_in ->> 'medical_card_pending')::boolean, false) else medical_card_pending end,
         updated_at            = now()
   where invitation_id = p_invitation and org_id = p_org
   returning id, prior_positive_2y into v_intake, v_prior;

  if v_intake is null then
    insert into public.application_intakes
      (org_id, invitation_id, phone, address_line1, address_line2, city, state, postal_code,
       prior_positive_2y, dot_program_30d, dot_tested_6m, dot_random_12m,
       fcra_summary_version, fcra_summary_shown_at, medical_card_pending)
    values
      (p_org, p_invitation,
       nullif(btrim(v_in ->> 'phone'), ''), nullif(btrim(v_in ->> 'address_line1'), ''),
       nullif(btrim(v_in ->> 'address_line2'), ''), nullif(btrim(v_in ->> 'city'), ''),
       nullif(btrim(v_in ->> 'state'), ''), nullif(btrim(v_in ->> 'postal_code'), ''),
       (v_in ->> 'prior_positive_2y')::boolean, (v_in ->> 'dot_program_30d')::boolean,
       (v_in ->> 'dot_tested_6m')::boolean, (v_in ->> 'dot_random_12m')::boolean,
       v_in ->> 'fcra_summary_version',
       case when v_in ? 'fcra_summary_version' then now() end,
       coalesce((v_in ->> 'medical_card_pending')::boolean, false))
    on conflict (invitation_id) do nothing
    returning id, prior_positive_2y into v_intake, v_prior;
    if v_intake is null then
      -- Lost the insert race to a concurrent first save under a different lock path: the row exists
      -- now, and the invitation lock above makes this unreachable in practice. Refuse rather than
      -- silently drop what was sent.
      raise exception 'applicant_intake_concurrent_write' using errcode = 'AI004';
    end if;
  end if;

  if v_prior is null then
    raise exception 'prior_positive_required' using errcode = 'AI009';
  end if;

  -- ── Licences: replaced whole when sent ─────────────────────────────────────────────────────────
  if p_licences is not null then
    if exists (select 1 from jsonb_array_elements(p_licences) l
                where jsonb_typeof(l) <> 'object'
                   or nullif(l ->> 'position', '') is null
                   or nullif(btrim(l ->> 'state_code'), '') is null
                   or nullif(btrim(l ->> 'licence_number'), '') is null) then
      raise exception 'applicant_intake_licence_incomplete' using errcode = 'AI004';
    end if;
    delete from public.application_intake_licences
     where invitation_id = p_invitation and org_id = p_org;
    insert into public.application_intake_licences
      (org_id, invitation_id, position, state_code, agency, licence_number, expires_on, source)
    select p_org, p_invitation, (l ->> 'position')::smallint, upper(btrim(l ->> 'state_code')),
           nullif(btrim(l ->> 'agency'), ''), btrim(l ->> 'licence_number'),
           (l ->> 'expires_on')::date, coalesce(l ->> 'source', 'intake')
      from jsonb_array_elements(p_licences) l;
  end if;

  select count(*) into v_count
    from public.application_intake_licences
   where invitation_id = p_invitation and org_id = p_org;
  select state_code, licence_number, expires_on into v_cdl
    from public.application_intake_licences
   where invitation_id = p_invitation and org_id = p_org and position = 0;

  -- ── The drivers row: contact and CDL class/expiry, 0365's rule ─────────────────────────────────
  select phone, address_line1, address_line2, city, state, postal_code, cdl_class, cdl_expires_at, date_of_birth
    into v_before
    from public.drivers
   where id = p_driver and org_id = p_org
   for update;

  update public.drivers d
     set phone          = case when p_overwrite and v_in ? 'phone' then i.phone else coalesce(d.phone, i.phone) end,
         address_line1  = case when p_overwrite and v_in ? 'address_line1' then i.address_line1 else coalesce(d.address_line1, i.address_line1) end,
         address_line2  = case when p_overwrite and v_in ? 'address_line2' then i.address_line2 else coalesce(d.address_line2, i.address_line2) end,
         city           = case when p_overwrite and v_in ? 'city' then i.city else coalesce(d.city, i.city) end,
         state          = case when p_overwrite and v_in ? 'state' then i.state else coalesce(d.state, i.state) end,
         postal_code    = case when p_overwrite and v_in ? 'postal_code' then i.postal_code else coalesce(d.postal_code, i.postal_code) end,
         cdl_class      = case when p_overwrite and v_in ? 'cdl_class' then nullif(v_in ->> 'cdl_class', '')
                               else coalesce(d.cdl_class, nullif(v_in ->> 'cdl_class', '')) end,
         cdl_expires_at = case when p_overwrite and p_licences is not null then v_cdl.expires_on
                               else coalesce(d.cdl_expires_at, v_cdl.expires_on) end,
         updated_at     = now()
    from public.application_intakes i
   where d.id = p_driver and d.org_id = p_org
     and i.invitation_id = p_invitation and i.org_id = p_org
   returning d.phone, d.address_line1, d.address_line2, d.city, d.state, d.postal_code, d.cdl_class, d.cdl_expires_at
     into v_after;

  -- Endorsements: the declared list, replaced whole when sent, on the intake row only (see the
  -- column's comment for why nothing is projected onto the roster).
  if p_endorsements is not null then
    update public.application_intakes
       set endorsements = (select coalesce(array_agg(distinct upper(btrim(c)) order by upper(btrim(c))), '{}'::text[])
                             from unnest(p_endorsements) as t(c)
                            where nullif(btrim(c), '') is not null)
     where id = v_intake;
  end if;

  -- ── Identity through its one writer (0365) ─────────────────────────────────────────────────────
  -- Only once there is both a DOB and a current licence to write; Part 1 posts the licences on their
  -- own screen, so an earlier call legitimately has neither yet.
  v_dob := coalesce((v_in ->> 'date_of_birth')::date, v_before.date_of_birth);
  if v_dob is not null and v_cdl.licence_number is not null then
    v_identity := public.record_applicant_identity(
      p_org, p_invitation, p_driver, v_dob, v_cdl.licence_number, v_cdl.state_code, p_overwrite);
  end if;

  return jsonb_build_object(
    'intake_id', v_intake,
    'licence_count', v_count,
    'identity', v_identity,
    -- Names only, never values: 0365's rule for what goes back to a caller on a bare link.
    'kept_existing', to_jsonb(array_remove(array[
      case when not p_overwrite and v_in ? 'phone' and v_after.phone is distinct from nullif(btrim(v_in ->> 'phone'), '') then 'phone' end,
      case when not p_overwrite and v_in ? 'address_line1' and v_after.address_line1 is distinct from nullif(btrim(v_in ->> 'address_line1'), '') then 'address_line1' end,
      case when not p_overwrite and v_in ? 'city' and v_after.city is distinct from nullif(btrim(v_in ->> 'city'), '') then 'city' end,
      case when not p_overwrite and v_in ? 'state' and v_after.state is distinct from nullif(btrim(v_in ->> 'state'), '') then 'state' end,
      case when not p_overwrite and v_in ? 'postal_code' and v_after.postal_code is distinct from nullif(btrim(v_in ->> 'postal_code'), '') then 'postal_code' end
    ], null))
  );
end;
$$;

revoke all on function public.record_applicant_intake(uuid, uuid, uuid, jsonb, jsonb, text[], boolean)
  from public, anon, authenticated;
grant execute on function public.record_applicant_intake(uuid, uuid, uuid, jsonb, jsonb, text[], boolean)
  to service_role;

comment on function public.record_applicant_intake(uuid, uuid, uuid, jsonb, jsonb, text[], boolean) is
  'D-AW3: the one writer of Part 1. Writes the intake row (present keys only), replaces the licence list while Part 1 is open (the office may correct after), fills or overwrites the drivers row by 0365''s rule, records the declared endorsements, and routes DOB/licence through record_applicant_identity. Refuses AI001 not found, AI002 revoked (or expired, applicant only), AI003 submitted, AI004 malformed, AI008 Part 1 complete (applicant), AI009 §40.25(j) unanswered.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 5. complete_applicant_intake — Part 1 ends, its documents are filed (D-AW1, D-AW4)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Idempotent by construction: a second call finds `intake_completed_at` and returns it without
-- inserting anything, so a lost response retried by the phone cannot file a document twice.
-- Promotion is 0231's join, unchanged in shape — the array cannot file anything that is not a real
-- staged capture of THIS invitation, and `documents.id = capture.id` makes it exactly-once — with two
-- differences: it skips the selfie, which is never evidence (D-AW4: `documents` is append-only and in
-- RETENTION_FORBIDDEN, and a face photograph must keep its own, shorter life), and it stamps the
-- capture's `promoted_document_id` so the filing later skips it.
create or replace function public.complete_applicant_intake(
  p_org        uuid,
  p_invitation uuid,
  p_driver     uuid,
  p_captures   jsonb
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires   timestamptz;
  v_revoked   timestamptz;
  v_submitted timestamptz;
  v_completed timestamptz;
  v_shown     timestamptz;
  v_pending   boolean;
begin
  select expires_at, revoked_at, submitted_at, intake_completed_at
    into v_expires, v_revoked, v_submitted, v_completed
    from public.application_invitations
   where id = p_invitation and org_id = p_org and driver_id = p_driver
   for update;

  if v_expires is null then
    raise exception 'application_invitation_not_found' using errcode = 'AI001';
  end if;
  if v_revoked is not null or v_expires <= now() then
    raise exception 'application_invitation_unusable' using errcode = 'AI002';
  end if;
  if v_submitted is not null then
    raise exception 'application_already_submitted' using errcode = 'AI003';
  end if;
  if v_completed is not null then
    return v_completed;
  end if;

  select fcra_summary_shown_at, medical_card_pending into v_shown, v_pending
    from public.application_intakes
   where invitation_id = p_invitation and org_id = p_org;

  if v_shown is null
     or not exists (select 1 from public.application_captures
                     where invitation_id = p_invitation and org_id = p_org and slot = 'cdl_front')
     or not exists (select 1 from public.application_captures
                     where invitation_id = p_invitation and org_id = p_org and slot = 'cdl_back')
     or (not coalesce(v_pending, false)
         and not exists (select 1 from public.application_captures
                          where invitation_id = p_invitation and org_id = p_org and slot = 'medical_card')) then
    raise exception 'intake_incomplete' using errcode = 'AI007';
  end if;

  with promoted as (
    insert into public.documents
      (id, org_id, subject_type, subject_id, kind, storage_path, content_type, bytes, sha256, page,
       captured_at, uploaded_by)
    select ac.id, p_org, 'driver', p_driver, c.kind, c.storage_path, ac.content_type, ac.bytes,
           ac.sha256, c.page, ac.captured_at, null::uuid
      from jsonb_to_recordset(coalesce(p_captures, '[]'::jsonb)) as c(
             capture_id uuid, kind text, page int, storage_path text)
      join public.application_captures ac
        on ac.id = c.capture_id and ac.invitation_id = p_invitation and ac.org_id = p_org
     where ac.slot <> 'selfie'
       and ac.promoted_document_id is null
    returning id
  )
  update public.application_captures
     set promoted_document_id = promoted.id
    from promoted
   where application_captures.id = promoted.id;

  update public.application_invitations
     set intake_completed_at = coalesce(intake_completed_at, now())
   where id = p_invitation and org_id = p_org
   returning intake_completed_at into v_completed;

  return v_completed;
end;
$$;

revoke all on function public.complete_applicant_intake(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_applicant_intake(uuid, uuid, uuid, jsonb) to service_role;

comment on function public.complete_applicant_intake(uuid, uuid, uuid, jsonb) is
  'D-AW1/D-AW4: finish Part 1. Refuses AI001/AI002/AI003, and AI007 unless the FCRA summary was shown, CDL front and back are captured, and a medical card is captured or declared pending. Promotes the listed captures into documents (never the selfie), stamps promoted_document_id, and stamps intake_completed_at once. Idempotent.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 6. Signatures, adopted once (D-AW15)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- The owner's DocuSign model: the driver adopts a signature and a set of initials once, and every
-- later place applies it with one click. The row IS the registration of the PNG in the evidence
-- bucket (`documentStoragePath(org,'driver',driverId,id,'image/png')`, complianceContract.ts) — no
-- `documents` row, because an adopted mark is not a qualification-file document; the orphan
-- reconcile is extended to this `storage_path` in C3s. Append-only: a new adoption SUPERSEDES the
-- old (`superseded_by`), and the old row keeps saying what the marks made with it looked like.
create table if not exists public.signature_adoptions (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  invitation_id      uuid not null references public.application_invitations(id) on delete cascade,
  kind               text not null constraint signature_adoptions_kind_check check (kind in ('signature','initials')),
  typed_text         text not null constraint signature_adoptions_typed_text_check check (length(btrim(typed_text)) between 1 and 200),
  storage_path       text not null,
  -- Computed by the server from the stored bytes, not claimed by the browser.
  sha256             text not null constraint signature_adoptions_sha256_check check (sha256 ~ '^[0-9a-f]{64}$'),
  adopted_at         timestamptz not null default now(),
  adopted_ip         inet,
  adopted_user_agent text,
  -- DEFERRABLE, and it has to be: the writer marks the old row superseded BEFORE inserting the new
  -- one (the partial unique index below allows one live row per kind), so the reference points at a
  -- row that exists only by the end of the transaction.
  superseded_by      uuid references public.signature_adoptions(id) on delete restrict deferrable initially deferred,
  created_at         timestamptz not null default now(),
  constraint signature_adoptions_path_check
    check (storage_path like org_id::text || '/driver/%/' || id::text || '.png'),
  constraint signature_adoptions_not_self_check check (superseded_by is null or superseded_by <> id)
);

create unique index if not exists uq_signature_adoptions_live
  on public.signature_adoptions (invitation_id, kind) where superseded_by is null;
create index if not exists idx_signature_adoptions_session
  on public.signature_adoptions (org_id, invitation_id);

alter table public.signature_adoptions enable row level security;

comment on table public.signature_adoptions is
  'D-AW15: an adopted signature or set of initials for one invitation. Append-only (SA010); the one permitted update is superseded_by null -> the adoption that replaced it. At most one live row per (invitation, kind). The row is the registration of its PNG in the evidence bucket.';

create or replace function public.guard_signature_adoptions_append_only()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'signature_adoptions is append-only' using errcode = 'SA010';
  end if;
  if tg_op = 'UPDATE' and (
       old.superseded_by is not null
       or new.superseded_by is null
       or (new.id, new.org_id, new.invitation_id, new.kind, new.typed_text, new.storage_path, new.sha256,
           new.adopted_at, new.adopted_ip, new.adopted_user_agent, new.created_at)
          is distinct from
          (old.id, old.org_id, old.invitation_id, old.kind, old.typed_text, old.storage_path, old.sha256,
           old.adopted_at, old.adopted_ip, old.adopted_user_agent, old.created_at)) then
    raise exception 'signature_adoptions is append-only: only superseded_by may be set, once' using errcode = 'SA010';
  end if;
  if tg_op = 'INSERT' and public.auth_role() is not null then
    raise exception 'signature_adoptions is written only by the application API' using errcode = 'SA010';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_signature_adoptions on public.signature_adoptions;
create trigger trg_guard_signature_adoptions
  before insert or update or delete on public.signature_adoptions
  for each row execute function public.guard_signature_adoptions_append_only();

-- The writer. The caller mints the id, because the storage key is built from it and the bytes are
-- written before the row (0230's order: a row means the object is there).
--   SA020  no such invitation for this org
--   SA021  revoked or expired
--   SA022  the storage path is not this invitation's driver's key for this id
create or replace function public.record_signature_adoption(
  p_org          uuid,
  p_invitation   uuid,
  p_adoption     uuid,
  p_kind         text,
  p_typed_text   text,
  p_storage_path text,
  p_sha256       text,
  p_ip           text,
  p_user_agent   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver     uuid;
  v_expires    timestamptz;
  v_revoked    timestamptz;
  v_superseded uuid;
begin
  select driver_id, expires_at, revoked_at into v_driver, v_expires, v_revoked
    from public.application_invitations
   where id = p_invitation and org_id = p_org
   for update;

  if v_driver is null then
    raise exception 'application_invitation_not_found' using errcode = 'SA020';
  end if;
  if v_revoked is not null or v_expires <= now() then
    raise exception 'application_invitation_unusable' using errcode = 'SA021';
  end if;
  if p_storage_path is distinct from (p_org::text || '/driver/' || v_driver::text || '/' || p_adoption::text || '.png') then
    raise exception 'adoption_path_mismatch' using errcode = 'SA022';
  end if;

  update public.signature_adoptions
     set superseded_by = p_adoption
   where invitation_id = p_invitation and org_id = p_org and kind = p_kind and superseded_by is null
   returning id into v_superseded;

  insert into public.signature_adoptions
    (id, org_id, invitation_id, kind, typed_text, storage_path, sha256, adopted_ip, adopted_user_agent)
  values
    (p_adoption, p_org, p_invitation, p_kind, btrim(p_typed_text), p_storage_path, p_sha256,
     p_ip::inet, p_user_agent);

  return jsonb_build_object('adoption_id', p_adoption, 'superseded_id', v_superseded);
end;
$$;

revoke all on function public.record_signature_adoption(uuid, uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_signature_adoption(uuid, uuid, uuid, text, text, text, text, text, text)
  to service_role;

comment on function public.record_signature_adoption(uuid, uuid, uuid, text, text, text, text, text, text) is
  'D-AW15: adopt a signature or initials for one invitation, superseding the live adoption of that kind in the same transaction. Refuses SA020 not found, SA021 revoked/expired, SA022 a storage path that is not <org>/driver/<the invitation''s driver>/<id>.png.';

-- ── adoption_id on the three mark tables; packet_version on the packet's (A-5) ────────────────────
-- `packet_version` is on the packet marks only: handbook marks have carried `handbook_version` since
-- 0374, and a permission carries `disclosure_version` since 0215. Nullable, because 20 production
-- marks predate it — and NULL MEANS "the pre-versioning text", which C2's filing reads per Q-AW2.
alter table public.application_packet_marks
  add column if not exists packet_version text,
  add column if not exists adoption_id    uuid references public.signature_adoptions(id) on delete restrict;
alter table public.driver_authorizations
  add column if not exists adoption_id    uuid references public.signature_adoptions(id) on delete restrict;
alter table public.handbook_marks
  add column if not exists adoption_id    uuid references public.signature_adoptions(id) on delete restrict;

comment on column public.application_packet_marks.packet_version is
  'A-5: the packet text version this mark was made against (PACKET_VERSION). NULL = made before versioning; filed only per Q-AW2.';
comment on column public.application_packet_marks.adoption_id is
  'D-AW15: the adopted mark applied here. NULL for legacy marks, which print from the staged capture.';
comment on column public.driver_authorizations.adoption_id is
  'D-AW15: the adopted signature applied to this permission. NULL for paper and for everything before 0376.';
comment on column public.handbook_marks.adoption_id is
  'D-AW15: the adopted mark applied at this handbook place. NULL for the carrier''s countersignature and for legacy marks.';

-- ── G-9: the day a PAPER permission was signed (added at C0c's request) ───────────────────────────
alter table public.driver_authorizations
  add column if not exists signed_on date;
alter table public.driver_authorizations drop constraint if exists driver_authorizations_signed_on_paper_only;
alter table public.driver_authorizations add constraint driver_authorizations_signed_on_paper_only
  check (signed_on is null or method <> 'esign');

comment on column public.driver_authorizations.signed_on is
  'G-9/Q-AW15: the calendar day a PAPER permission (wet_signature, verbal_documented) was signed, as written on the page. A day, not an instant — accepted_at stays the recording instant. Null for esign rows, whose accepted_at is the signing moment.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 7. record_packet_mark — the 13-argument overload (A-5, D-AW15)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0369's body with two new refusals and two new columns, as a SECOND function: the 11-argument one
-- stays until M2. No defaults (PGRST203; this migration's header).
--   DR037  an earlier mark on this link was made against a different packet text
--   DR038  the adoption is not a live adoption of this invitation of this kind of mark
create or replace function public.record_packet_mark(
  p_org            uuid,
  p_invitation     uuid,
  p_placement      text,
  p_page           int,
  p_mark           text,
  p_anchor         text,
  p_affirmed       text,
  p_signed_name    text,
  p_ip             text,
  p_user_agent     text,
  p_expected_count int,
  p_packet_version text,
  p_adoption_id    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires   timestamptz;
  v_revoked   timestamptz;
  v_approved  timestamptz;
  v_submitted timestamptz;
  v_opened    timestamptz;
  v_adopted   text;
  v_id        uuid;
  v_signed    int;
begin
  select expires_at, revoked_at, approved_at, submitted_at, signing_opened_at
    into v_expires, v_revoked, v_approved, v_submitted, v_opened
    from public.application_invitations
   where id = p_invitation and org_id = p_org
   for update;

  if v_expires is null then
    raise exception 'application_invitation_not_found' using errcode = 'DR030';
  end if;
  if v_revoked is not null or v_expires <= now() then
    raise exception 'application_invitation_unusable' using errcode = 'DR031';
  end if;
  if v_approved is null then
    raise exception 'packet_not_yet_approved' using errcode = 'DR032';
  end if;
  if v_submitted is not null then
    raise exception 'packet_already_filed' using errcode = 'DR033';
  end if;
  if v_opened is null then
    raise exception 'packet_not_opened' using errcode = 'DR036';
  end if;

  -- A-5: one packet, one text. A mark made against an earlier version stays what it was; a later mark
  -- against a different text is refused rather than filed beside it. Pre-versioning marks (NULL) are
  -- Q-AW2's question and do not refuse here.
  if exists (select 1 from public.application_packet_marks
              where invitation_id = p_invitation and org_id = p_org
                and packet_version is not null
                and packet_version is distinct from p_packet_version) then
    raise exception 'packet_version_changed' using errcode = 'DR037';
  end if;

  if p_adoption_id is not null and not exists (
       select 1 from public.signature_adoptions
        where id = p_adoption_id and invitation_id = p_invitation and org_id = p_org
          and kind = p_mark and superseded_by is null) then
    raise exception 'adoption_not_found' using errcode = 'DR038';
  end if;

  select signed_name into v_adopted
    from public.application_packet_marks
   where invitation_id = p_invitation and org_id = p_org and mark = p_mark
   limit 1;
  if v_adopted is not null and v_adopted <> p_signed_name then
    raise exception 'packet_mark_name_changed' using errcode = 'DR035';
  end if;

  begin
    insert into public.application_packet_marks
      (org_id, invitation_id, placement_id, page, mark, anchor, affirmed,
       signed_name, signed_ip, signed_user_agent, packet_version, adoption_id)
    values
      (p_org, p_invitation, p_placement, p_page, p_mark, p_anchor, p_affirmed,
       p_signed_name, p_ip::inet, p_user_agent, p_packet_version, p_adoption_id)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'packet_mark_already_made' using errcode = 'DR034';
  end;

  select count(*) into v_signed
    from public.application_packet_marks
   where invitation_id = p_invitation and org_id = p_org;

  return jsonb_build_object(
    'mark_id', v_id,
    'signed_count', v_signed,
    'complete', v_signed >= p_expected_count
  );
end;
$$;

revoke all on function public.record_packet_mark(uuid, uuid, text, int, text, text, text, text, text, text, int, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_packet_mark(uuid, uuid, text, int, text, text, text, text, text, text, int, text, uuid)
  to service_role;

comment on function public.record_packet_mark(uuid, uuid, text, int, text, text, text, text, text, text, int, text, uuid) is
  'P5 + A-5/D-AW15 (0376): the 11-argument function''s refusals (DR030..DR036) plus DR037 (an earlier mark on this link has a different non-null packet_version) and DR038 (p_adoption_id is not a live adoption of this invitation of this mark kind). Records packet_version and adoption_id. The 11-argument signature is dropped in M2.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 8. record_driver_release — the 12-argument overload (D-AW15)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0228's body plus DR038 and the column. A permission is signed, never initialled, so the adoption
-- must be a live `signature`.
create or replace function public.record_driver_release(
  p_org            uuid,
  p_invitation     uuid,
  p_driver         uuid,
  p_purpose        text,
  p_version        text,
  p_text           text,
  p_intent         text,
  p_signed_name    text,
  p_ip             text,
  p_user_agent     text,
  p_expected_count int,
  p_adoption_id    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_completed timestamptz;
  v_expires   timestamptz;
  v_revoked   timestamptz;
  v_id        uuid;
  v_signed    int;
begin
  select releases_completed_at, expires_at, revoked_at
    into v_completed, v_expires, v_revoked
    from public.application_invitations
   where id = p_invitation and org_id = p_org and driver_id = p_driver
   for update;

  if v_expires is null then
    raise exception 'application_invitation_not_found' using errcode = 'DR020';
  end if;
  if v_revoked is not null or v_expires <= now() then
    raise exception 'application_invitation_unusable' using errcode = 'DR021';
  end if;
  if v_completed is not null then
    raise exception 'releases_already_complete' using errcode = 'DR022';
  end if;

  if p_adoption_id is not null and not exists (
       select 1 from public.signature_adoptions
        where id = p_adoption_id and invitation_id = p_invitation and org_id = p_org
          and kind = 'signature' and superseded_by is null) then
    raise exception 'adoption_not_found' using errcode = 'DR038';
  end if;

  begin
    insert into public.driver_authorizations
      (org_id, driver_id, invitation_id, purpose, disclosure_version, disclosure_text,
       method, signed_name, intent_statement, esign_consent_at, accepted_ip, accepted_user_agent,
       recorded_by, adoption_id)
    values
      (p_org, p_driver, p_invitation, p_purpose, p_version, p_text,
       'esign', p_signed_name, p_intent, now(), p_ip::inet, p_user_agent,
       null, p_adoption_id)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'release_already_signed' using errcode = 'DR023';
  end;

  select count(*) into v_signed
    from public.driver_authorizations
   where invitation_id = p_invitation and org_id = p_org and revokes is null;

  if v_signed >= p_expected_count then
    update public.application_invitations
       set releases_completed_at = now()
     where id = p_invitation and org_id = p_org;
    v_completed := now();
  end if;

  return jsonb_build_object(
    'authorization_id', v_id,
    'signed_count', v_signed,
    'completed', v_completed is not null
  );
end;
$$;

revoke all on function public.record_driver_release(uuid, uuid, uuid, text, text, text, text, text, text, text, int, uuid)
  from public, anon, authenticated;
grant execute on function public.record_driver_release(uuid, uuid, uuid, text, text, text, text, text, text, text, int, uuid)
  to service_role;

comment on function public.record_driver_release(uuid, uuid, uuid, text, text, text, text, text, text, text, int, uuid) is
  'A5 + D-AW15 (0376): the 11-argument function''s refusals (DR020..DR023) plus DR038 (p_adoption_id is not a live signature adoption of this invitation). Records adoption_id. The 11-argument signature is dropped in M2.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 9. Filing twice is impossible (A-10)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Measured before writing (2026-09-26, production, read-only): zero duplicate `handbook` or
-- `road_test` records per (org, invitation) — so neither index can fail to build.
create unique index if not exists uq_qualification_records_handbook_invitation
  on public.qualification_records (org_id, (detail ->> 'invitation_id'))
  where kind = 'handbook' and detail ->> 'source' = 'handbook_signing';

create unique index if not exists uq_qualification_records_road_test_invitation
  on public.qualification_records (org_id, driver_id, (detail ->> 'invitation_id'))
  where kind = 'road_test' and detail ->> 'source' = 'road_test' and detail ? 'invitation_id';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 10. `clearinghouse_portal_consent` (D-AW5)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- The driver's §382.703 consent in the Clearinghouse portal, as its own DQF fact. Both CHECKs move in
-- lockstep (0373), and — the step 0217 and 0237 each had to remember — both RESTRICTIVE policies that
-- enumerate testing kinds are recreated with it, or it would be readable by every role through
-- PostgREST. Everything 0373 admitted is re-stated below, word for word, with one word added.
alter table public.qualification_records drop constraint if exists qualification_records_kind_check;
alter table public.qualification_records add constraint qualification_records_kind_check check (kind in (
  'employment_application','mvr','annual_mvr_review','road_test',
  'cdl_equivalency','previous_employer_inquiry','previous_employer_response',
  'clearinghouse_full','clearinghouse_limited','eldt','spe_certificate',
  'medical_registry_verification','drug_test','alcohol_test','accident',
  'psp_report','return_to_duty',
  'orientation','handbook',
  'clearinghouse_portal_consent'));

alter table public.documents drop constraint if exists documents_kind_check;
alter table public.documents add constraint documents_kind_check check (kind in (
  'cdl','medical_card','endorsement','hazmat_training','twic',
  'registration','annual_inspection','insurance','ifta','irp',
  'phmsa_registration','hazmat_safety_permit','security_plan',
  'financial_responsibility','operating_authority',
  'employment_application','mvr','annual_mvr_review','road_test',
  'cdl_equivalency','previous_employer_inquiry','previous_employer_response',
  'clearinghouse_full','clearinghouse_limited','eldt','spe_certificate',
  'medical_registry_verification','drug_test','alcohol_test','accident',
  'psp_report','return_to_duty',
  'orientation','handbook',
  'clearinghouse_portal_consent',
  'other'));

drop policy if exists qualification_records_restricted_testing on public.qualification_records;
drop policy if exists documents_restricted_testing on public.documents;

-- section-policy-waiver(qualification_records_restricted_testing): §382.401(a) custody, not a section gate — mirrors canReadTestingRecords() in shared/auth.ts (0211, 0237, 0294's header)
create policy qualification_records_restricted_testing on public.qualification_records
  as restrictive for select
  using (
    kind not in ('drug_test','alcohol_test','clearinghouse_full','clearinghouse_limited','return_to_duty',
                 'clearinghouse_portal_consent')
    or public.auth_role() in ('admin','safety_manager')
  );

-- section-policy-waiver(documents_restricted_testing): §382.401(a) custody, not a section gate — mirrors canReadTestingRecords() in shared/auth.ts (0211, 0237, 0294's header)
create policy documents_restricted_testing on public.documents
  as restrictive for select
  using (
    kind not in ('drug_test','alcohol_test','clearinghouse_full','clearinghouse_limited','return_to_duty',
                 'clearinghouse_portal_consent')
    or public.auth_role() in ('admin','safety_manager')
  );

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 11. The office's screening records (D-AW6, D-AW7)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Operational, not DQF evidence: where and when the driver goes for the test, and how they travel to
-- the office. Cancelled rather than deleted, so "the live one" is the latest uncancelled row and the
-- history of changes is readable. 0230's guard (the service may update, to send or cancel).
create table if not exists public.drug_test_appointments (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  invitation_id     uuid not null references public.application_invitations(id) on delete cascade,
  site_name         text not null,
  site_address      text not null,
  site_phone        text,
  window_start      timestamptz not null,
  window_end        timestamptz,
  donor_reference   text,
  arranged_by       uuid not null references auth.users(id),
  sent_to_driver_at timestamptz,
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),
  constraint drug_test_appointments_window_check check (window_end is null or window_end > window_start)
);
create index if not exists idx_drug_test_appointments_session
  on public.drug_test_appointments (org_id, invitation_id);
alter table public.drug_test_appointments enable row level security;
comment on table public.drug_test_appointments is
  'D-AW6: the drug-test site and window the office arranged for an applicant. Operational, not evidence; the live one is the latest uncancelled row. No lab integration (Q-AW7).';

create or replace function public.guard_drug_test_appointments_client_writes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.auth_role() is not null then
    raise exception 'drug_test_appointments is written only by the API' using errcode = 'AI012';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_guard_drug_test_appointments on public.drug_test_appointments;
create trigger trg_guard_drug_test_appointments
  before insert or update or delete on public.drug_test_appointments
  for each row execute function public.guard_drug_test_appointments_client_writes();

create table if not exists public.applicant_travel (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  invitation_id    uuid not null references public.application_invitations(id) on delete cascade,
  mode             text not null constraint applicant_travel_mode_check check (mode in ('air','bus','train','drive','other')),
  depart_at        timestamptz not null,
  arrive_at        timestamptz not null,
  confirmation_ref text,
  booked_by        uuid not null references auth.users(id),
  cancelled_at     timestamptz,
  created_at       timestamptz not null default now(),
  constraint applicant_travel_order_check check (arrive_at >= depart_at)
);
create index if not exists idx_applicant_travel_session
  on public.applicant_travel (org_id, invitation_id);
alter table public.applicant_travel enable row level security;
comment on table public.applicant_travel is
  'D-AW7: the applicant''s trip to the office. The writer refuses unless the applicant is ready to travel (TRAVEL_REFUSES_WITHOUT, in TypeScript). Operational; cancelled, never deleted.';

create or replace function public.guard_applicant_travel_client_writes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.auth_role() is not null then
    raise exception 'applicant_travel is written only by the API' using errcode = 'AI013';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_guard_applicant_travel on public.applicant_travel;
create trigger trg_guard_applicant_travel
  before insert or update or delete on public.applicant_travel
  for each row execute function public.guard_applicant_travel_client_writes();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 12. Phone verification before filing (D-AW8)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §391.23's record needs an `employer_inquiries.employment_id`, which cannot exist before filing
-- (plan §2.2) — yet the office verifies employers by phone BEFORE the applicant certifies. So the
-- call is recorded here against the draft employer's stable client-minted `key` (AW1), and
-- `submit_driver_application` (below) copies each call into `employer_inquiries` against the new
-- employment row, so after filing §391.23 is one record. Append-only (EV010): the one permitted update
-- is the copy's back-reference, set once.
create table if not exists public.employer_verification_calls (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  invitation_id     uuid not null references public.application_invitations(id) on delete cascade,
  employer_key      uuid not null,
  employer_name     text not null,
  -- Five questions, each confirmed / corrected / not_confirmed — all five, nothing else.
  outcomes          jsonb not null,
  corrections       jsonb,
  called_by         uuid not null references auth.users(id),
  answered_by       text not null constraint employer_verification_calls_answered_by_check check (length(btrim(answered_by)) >= 1),
  called_at         timestamptz not null,
  copied_inquiry_id uuid references public.employer_inquiries(id) on delete restrict,
  created_at        timestamptz not null default now(),
  constraint employer_verification_calls_outcomes_check check (
    jsonb_typeof(outcomes) = 'object'
    and outcomes ?& array['dates','position','reason','cmv','dot_tested']
    and (outcomes - array['dates','position','reason','cmv','dot_tested']) = '{}'::jsonb
    and outcomes ->> 'dates'      in ('confirmed','corrected','not_confirmed')
    and outcomes ->> 'position'   in ('confirmed','corrected','not_confirmed')
    and outcomes ->> 'reason'     in ('confirmed','corrected','not_confirmed')
    and outcomes ->> 'cmv'        in ('confirmed','corrected','not_confirmed')
    and outcomes ->> 'dot_tested' in ('confirmed','corrected','not_confirmed')
  ),
  constraint employer_verification_calls_corrections_check
    check (corrections is null or jsonb_typeof(corrections) = 'object')
);
create index if not exists idx_employer_verification_calls_session
  on public.employer_verification_calls (org_id, invitation_id);
create index if not exists idx_employer_verification_calls_employer
  on public.employer_verification_calls (invitation_id, employer_key);
alter table public.employer_verification_calls enable row level security;
comment on table public.employer_verification_calls is
  'D-AW8: the office''s phone verification of one previous employer before filing, keyed on the draft employer''s stable key. Append-only (EV010); copied into employer_inquiries at filing, which sets copied_inquiry_id once.';

create or replace function public.guard_employer_verification_calls_append_only()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'employer_verification_calls is append-only' using errcode = 'EV010';
  end if;
  if tg_op = 'UPDATE' and (
       old.copied_inquiry_id is not null
       or new.copied_inquiry_id is null
       or (new.id, new.org_id, new.invitation_id, new.employer_key, new.employer_name, new.outcomes,
           new.corrections, new.called_by, new.answered_by, new.called_at, new.created_at)
          is distinct from
          (old.id, old.org_id, old.invitation_id, old.employer_key, old.employer_name, old.outcomes,
           old.corrections, old.called_by, old.answered_by, old.called_at, old.created_at)) then
    raise exception 'employer_verification_calls is append-only: only copied_inquiry_id may be set, once' using errcode = 'EV010';
  end if;
  if tg_op = 'INSERT' and public.auth_role() is not null then
    raise exception 'employer_verification_calls is written only by the API' using errcode = 'EV010';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_employer_verification_calls on public.employer_verification_calls;
create trigger trg_guard_employer_verification_calls
  before insert or update or delete on public.employer_verification_calls
  for each row execute function public.guard_employer_verification_calls_append_only();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 13. submit_driver_application — the 13-argument overload (D-AW3, D-AW4, D-AW8)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0231's body with three differences:
--   · captures already promoted at Part 1 (`promoted_document_id`) are skipped — 0231 would insert
--     `documents.id = capture.id` a second time and fail on the primary key — and the selfie never is;
--   · each `p_employment` item may carry the draft's stable `key`, and every uncopied phone
--     verification with that key becomes an `employer_inquiries` row (method `phone`,
--     `wording_version = 'phone-call-v1'`) against the employment row just created;
--   · `body_sent` — NOT NULL, "the exact wording sent" (0223) — comes from `p_call_summaries`, an
--     object keyed by call id, rendered in TypeScript where every other inquiry's wording is composed
--     (`composeInquiry`). A call that must be copied and has no summary refuses the filing (DA043)
--     rather than filing a §391.23 record with invented wording.
-- `p_payload` is the COMPOSED payload (D-AW3: the draft plus the intake tables), composed by the
-- caller; the function stores what it is given, as 0231's does.
create or replace function public.submit_driver_application(
  p_org             uuid,
  p_invitation      uuid,
  p_driver          uuid,
  p_payload         jsonb,
  p_signed_name     text,
  p_ip              text,
  p_user_agent      text,
  p_ssn_last4       text,
  p_ssn_sealed      text,
  p_driver_patch    jsonb,
  p_employment      jsonb,
  p_captures        jsonb,
  p_call_summaries  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submitted timestamptz;
  v_expires   timestamptz;
  v_revoked   timestamptz;
  v_app       uuid;
  v_emp       record;
  v_emp_id    uuid;
  v_call      record;
  v_body      text;
  v_inquiry   uuid;
  v_copied    int := 0;
  v_tz        text;
begin
  select submitted_at, expires_at, revoked_at
    into v_submitted, v_expires, v_revoked
    from public.application_invitations
   where id = p_invitation and org_id = p_org and driver_id = p_driver
   for update;

  if v_expires is null then
    raise exception 'application_invitation_not_found' using errcode = 'DA020';
  end if;
  if v_revoked is not null or v_expires <= now() then
    raise exception 'application_invitation_unusable' using errcode = 'DA021';
  end if;
  if v_submitted is not null then
    raise exception 'application_already_submitted' using errcode = 'DA022';
  end if;

  insert into public.driver_applications
    (org_id, driver_id, invitation_id, payload, signed_name, applicant_ip, applicant_user_agent,
     ssn_last4, ssn_sealed)
  values
    (p_org, p_driver, p_invitation, p_payload, p_signed_name, p_ip, p_user_agent,
     p_ssn_last4, p_ssn_sealed)
  returning id into v_app;

  update public.application_invitations
     set submitted_at = now()
   where id = p_invitation and org_id = p_org;

  update public.drivers d
     set first_name    = coalesce(d.first_name, p_driver_patch ->> 'first_name'),
         last_name     = coalesce(d.last_name, p_driver_patch ->> 'last_name'),
         date_of_birth = coalesce(d.date_of_birth, (p_driver_patch ->> 'date_of_birth')::date),
         cdl_number    = coalesce(d.cdl_number, p_driver_patch ->> 'cdl_number'),
         cdl_state     = coalesce(d.cdl_state, p_driver_patch ->> 'cdl_state'),
         other_names   = coalesce(
                           d.other_names,
                           (select array_agg(n)
                              from jsonb_array_elements_text(
                                     coalesce(p_driver_patch -> 'other_names', '[]'::jsonb)) as t(n))),
         updated_at    = now()
   where d.id = p_driver and d.org_id = p_org;

  -- The carrier's own day for "contacted on" — a calendar day is not an instant, and the call was made
  -- in the carrier's office (organizations.operating_hours.tz, America/Chicago by default).
  select coalesce(o.operating_hours ->> 'tz', 'America/Chicago') into v_tz
    from public.organizations o where o.id = p_org;

  -- One row at a time, because each employment row's new id must meet the calls filed under its key.
  for v_emp in
    select e.*
      from jsonb_to_recordset(coalesce(p_employment, '[]'::jsonb)) as e(
             key uuid, employer_name text, usdot_number text, employer_address_line1 text,
             employer_city text, employer_state text,
             employer_phone text, employer_email text, position_held text,
             started_on date, ended_on date, dot_regulated boolean, operated_cmv boolean,
             subject_to_fmcsr boolean, safety_sensitive boolean, reason_for_leaving text)
  loop
    insert into public.driver_employment_history
      (org_id, driver_id, employer_name, usdot_number, employer_address_line1, employer_city,
       employer_state, employer_phone, employer_email,
       position_held, started_on, ended_on, dot_regulated, operated_cmv,
       subject_to_fmcsr, safety_sensitive, reason_for_leaving, inquiry_status, source)
    values
      (p_org, p_driver, v_emp.employer_name, v_emp.usdot_number, v_emp.employer_address_line1,
       v_emp.employer_city, v_emp.employer_state, v_emp.employer_phone, v_emp.employer_email,
       v_emp.position_held, v_emp.started_on, v_emp.ended_on, v_emp.dot_regulated, v_emp.operated_cmv,
       v_emp.subject_to_fmcsr, v_emp.safety_sensitive, v_emp.reason_for_leaving,
       case when v_emp.dot_regulated then 'pending' else 'not_required' end,
       'application')
    returning id into v_emp_id;

    if v_emp.key is not null then
      for v_call in
        select c.* from public.employer_verification_calls c
         where c.org_id = p_org and c.invitation_id = p_invitation
           and c.employer_key = v_emp.key and c.copied_inquiry_id is null
         order by c.called_at, c.id
      loop
        v_body := nullif(btrim(coalesce(p_call_summaries, '{}'::jsonb) ->> v_call.id::text), '');
        if v_body is null then
          raise exception 'verification_call_summary_missing' using errcode = 'DA043';
        end if;
        insert into public.employer_inquiries
          (org_id, driver_id, employment_id, kind, employer_name, employer_address, method, sent_to,
           contacted_on, wording_version, body_sent, outcome, outcome_on, response, created_by)
        values
          (p_org, p_driver, v_emp_id, 'safety_performance', v_call.employer_name,
           nullif(concat_ws(', ', v_emp.employer_address_line1, v_emp.employer_city, v_emp.employer_state), ''),
           'phone', v_call.answered_by,
           (v_call.called_at at time zone v_tz)::date, 'phone-call-v1', v_body,
           'responded', (v_call.called_at at time zone v_tz)::date,
           jsonb_build_object('source', 'employer_verification_call', 'call_id', v_call.id,
                              'outcomes', v_call.outcomes, 'corrections', v_call.corrections,
                              'answered_by', v_call.answered_by, 'called_at', v_call.called_at),
           v_call.called_by)
        returning id into v_inquiry;

        update public.employer_verification_calls
           set copied_inquiry_id = v_inquiry
         where id = v_call.id;
        v_copied := v_copied + 1;
      end loop;
    end if;
  end loop;

  insert into public.documents
    (id, org_id, subject_type, subject_id, kind, storage_path, content_type, bytes, sha256, page,
     captured_at, uploaded_by)
  select ac.id, p_org, 'driver', p_driver, c.kind, c.storage_path, ac.content_type, ac.bytes,
         ac.sha256, c.page, ac.captured_at, null::uuid
    from jsonb_to_recordset(coalesce(p_captures, '[]'::jsonb)) as c(
           capture_id uuid, kind text, page int, storage_path text)
    join public.application_captures ac
      on ac.id = c.capture_id and ac.invitation_id = p_invitation and ac.org_id = p_org
   where ac.promoted_document_id is null
     and ac.slot <> 'selfie';

  insert into public.qualification_records
    (org_id, driver_id, kind, occurred_on, result, reference, detail)
  values
    (p_org, p_driver, 'employment_application', current_date, 'certified', v_app::text,
     jsonb_build_object('source', 'application_intake', 'application_id', v_app));

  return jsonb_build_object('application_id', v_app, 'calls_copied', v_copied);
end;
$$;

revoke all on function public.submit_driver_application(
  uuid, uuid, uuid, jsonb, text, text, text, text, text, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_driver_application(
  uuid, uuid, uuid, jsonb, text, text, text, text, text, jsonb, jsonb, jsonb, jsonb)
  to service_role;

comment on function public.submit_driver_application(
  uuid, uuid, uuid, jsonb, text, text, text, text, text, jsonb, jsonb, jsonb, jsonb) is
  'H5/A8 + D-AW3/D-AW4/D-AW8 (0376): file the certified (composed) application as 0231 does, skipping captures promoted at Part 1 and the selfie, and copying each uncopied phone verification whose employer key matches a filed employer into employer_inquiries (method phone, phone-call-v1, body from p_call_summaries by call id; DA043 when missing). The 12-argument signature is dropped in M2.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 14. SMS that waits instead of vanishing (A-11, D-AW12)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Today a text refused by the quiet-hours window is dropped: the nudge stamps and rotates before
-- sending, and nothing retries it (plan §3.1, A-11). The outbox holds it until `not_before` and the
-- scheduler drains it. ⚠ It stores a TEMPLATE and its PARAMETERS, never a rendered body: the
-- applicant's link is minted or rotated at drain time, because a plaintext bearer token sitting in a
-- table is exactly what 0232 and Q-AX5 refused. The CHECKs below hold that line in the database.
create table if not exists public.sms_outbox (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  driver_id           uuid not null references public.drivers(id) on delete cascade,
  invitation_id       uuid references public.application_invitations(id) on delete cascade,
  phone               text not null,
  template            text not null constraint sms_outbox_template_check check (template ~ '^[a-z0-9_.-]{1,80}$'),
  params              jsonb not null constraint sms_outbox_params_check
                        check (jsonb_typeof(params) = 'object' and params::text !~* 'https?://'),
  reason              text not null constraint sms_outbox_reason_check
                        check (reason in ('nudge','application_sent','signing_link','drug_test_site','consent_confirm','other')),
  not_before          timestamptz not null,
  -- A held text older than this is `cancelled`, never sent late.
  expires_at          timestamptz not null,
  status              text not null default 'queued' constraint sms_outbox_status_check
                        check (status in ('queued','sending','sent','delivered','failed','suppressed','cancelled')),
  attempts            smallint not null default 0 constraint sms_outbox_attempts_check check (attempts >= 0),
  last_error          text,
  provider_message_id text unique,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  failed_at           timestamptz,
  created_at          timestamptz not null default now(),
  constraint sms_outbox_window_check check (expires_at > not_before)
);
-- The drain's read: what is due, oldest first.
create index if not exists idx_sms_outbox_drain on public.sms_outbox (not_before) where status = 'queued';
create index if not exists idx_sms_outbox_session on public.sms_outbox (org_id, invitation_id);
alter table public.sms_outbox enable row level security;
comment on table public.sms_outbox is
  'A-11/D-AW12: texts waiting for the recipient''s quiet-hours window, drained by the scheduler. Holds a template and its params, NEVER a rendered body or link (0232, Q-AX5). Retention 400 days (lands with the writer, C2).';

create or replace function public.guard_sms_outbox_client_writes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.auth_role() is not null then
    raise exception 'sms_outbox is written only by the API' using errcode = 'SO010';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_guard_sms_outbox on public.sms_outbox;
create trigger trg_guard_sms_outbox
  before insert or update or delete on public.sms_outbox
  for each row execute function public.guard_sms_outbox_client_writes();

-- A STOP, a carrier block, an invalid number or the office's own hold. Keyed on the PHONE, not the
-- driver: the number is what the provider refuses, and a STOP must outlive the driver record it came
-- in on — hence `on delete set null`, and why pruning it is forbidden (it would re-open texting).
create table if not exists public.sms_suppressions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  driver_id   uuid references public.drivers(id) on delete set null,
  phone       text not null,
  reason      text not null constraint sms_suppressions_reason_check check (reason in ('stop','carrier_block','invalid','manual')),
  lifted_at   timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists uq_sms_suppressions_live on public.sms_suppressions (org_id, phone) where lifted_at is null;
alter table public.sms_suppressions enable row level security;
comment on table public.sms_suppressions is
  'A-11: phone numbers this org must not text — STOP, carrier block, invalid, or manual. One live row per (org, phone); lifting sets lifted_at. Never pruned (RETENTION_FORBIDDEN with its writer, C2).';

create or replace function public.guard_sms_suppressions_client_writes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.auth_role() is not null then
    raise exception 'sms_suppressions is written only by the API' using errcode = 'SO011';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_guard_sms_suppressions on public.sms_suppressions;
create trigger trg_guard_sms_suppressions
  before insert or update or delete on public.sms_suppressions
  for each row execute function public.guard_sms_suppressions_client_writes();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 15. Screen events (AW14)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Where applicants stop: one row per screen visit on the link. Operational; retention 180 days with
-- its writer (C3).
create table if not exists public.application_screen_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  invitation_id uuid not null references public.application_invitations(id) on delete cascade,
  screen        text not null constraint application_screen_events_screen_check check (screen ~ '^[a-z0-9_.-]{1,60}$'),
  entered_at    timestamptz not null,
  left_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_application_screen_events_session on public.application_screen_events (org_id, invitation_id);
create index if not exists idx_application_screen_events_entered on public.application_screen_events (org_id, entered_at);
alter table public.application_screen_events enable row level security;
comment on table public.application_screen_events is
  'AW14: one row per screen an applicant entered on their link, for finding where they stop. Operational; retention 180 days with its writer (C3).';

create or replace function public.guard_application_screen_events_client_writes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.auth_role() is not null then
    raise exception 'application_screen_events is written only by the API' using errcode = 'AI014';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_guard_application_screen_events on public.application_screen_events;
create trigger trg_guard_application_screen_events
  before insert or update or delete on public.application_screen_events
  for each row execute function public.guard_application_screen_events_client_writes();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 16. Draft revisions (AW10)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- The phone replays its local copy after a lost signal; a replay of an OLDER copy must not overwrite
-- a newer save from another tab. `revision` counts payload changes. It is bumped by a TRIGGER, not by
-- the new function alone, because three writers change a draft's payload — the old
-- `save_application_draft`, `record_applicant_identity`'s patch (0365, reached through
-- `record_applicant_intake`) and the new overload — and a counter only one of them bumps is a counter
-- that lies. A write that leaves the payload as it was (a merge moving `driver_id`) bumps nothing.
alter table public.application_drafts
  add column if not exists revision int not null default 0;

create or replace function public.bump_application_draft_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.payload is distinct from old.payload then
    new.revision := old.revision + 1;
  else
    new.revision := old.revision;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_application_drafts_revision on public.application_drafts;
create trigger trg_application_drafts_revision
  before update on public.application_drafts
  for each row execute function public.bump_application_draft_revision();

comment on column public.application_drafts.revision is
  'AW10: how many times the payload has changed (bumped by trg_application_drafts_revision on every writer). save_application_draft''s 6-argument overload refuses DA041 when the caller''s expected revision is not this.';

-- DA041: the caller's copy is stale. A first save expects revision 0 and creates the row at 1.
create or replace function public.save_application_draft(
  p_org               uuid,
  p_invitation        uuid,
  p_driver            uuid,
  p_payload           jsonb,
  p_section           text,
  p_expected_revision int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid;
  v_updated  timestamptz;
  v_revision int;
  v_stored   int;
begin
  select revision into v_stored
    from public.application_drafts
   where invitation_id = p_invitation and org_id = p_org
   for update;

  if v_stored is null then
    if p_expected_revision is distinct from 0 then
      raise exception 'draft_revision_conflict' using errcode = 'DA041';
    end if;
    begin
      insert into public.application_drafts (org_id, invitation_id, driver_id, payload, furthest_section, revision)
      values (p_org, p_invitation, p_driver, coalesce(p_payload, '{}'::jsonb), p_section, 1)
      returning id, updated_at, revision into v_id, v_updated, v_revision;
    exception when unique_violation then
      -- Another first save won the race; this caller's copy is now the stale one.
      raise exception 'draft_revision_conflict' using errcode = 'DA041';
    end;
  else
    if p_expected_revision is distinct from v_stored then
      raise exception 'draft_revision_conflict' using errcode = 'DA041';
    end if;
    update public.application_drafts
       set payload          = coalesce(p_payload, '{}'::jsonb),
           furthest_section = coalesce(p_section, furthest_section),
           updated_at       = now()
     where invitation_id = p_invitation and org_id = p_org
     returning id, updated_at, revision into v_id, v_updated, v_revision;
  end if;

  return jsonb_build_object('draft_id', v_id, 'updated_at', v_updated, 'revision', v_revision);
end;
$$;

revoke all on function public.save_application_draft(uuid, uuid, uuid, jsonb, text, int)
  from public, anon, authenticated;
grant execute on function public.save_application_draft(uuid, uuid, uuid, jsonb, text, int)
  to service_role;

comment on function public.save_application_draft(uuid, uuid, uuid, jsonb, text, int) is
  'AW10 (0376): save the draft only if the stored revision equals p_expected_revision (0 = no draft yet), else DA041 draft_revision_conflict. Returns the new revision. The 5-argument signature is dropped in M2.';
