-- 0578 — a recruiter closes, qualifies or reopens a lead (ADS-LEAD-INTAKE-PLAN.md LQ5a; audit finding F-LA1;
-- Q-AD64 ruled 2026-11-09: a fixed reason list, and `qualified` is the recruiter's act). The readers — routes,
-- the outcome feed's three new stages, the drawer — are the NEXT merge (LQ5b); nothing here is called yet.
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- `recruiting_leads.status` allows `qualified`, `not_qualified` and `lost` (0553), and until this migration
-- nothing wrote them: `leadContacts.ts` moves `new → contacted`, `convert_lead` → `converted`, `purge_lead`
-- → `lost`. So a lead a recruiter called and found to have no CDL stayed `contacted` in the open queue for
-- good; the lead-quality alert (0575) could count only wrong numbers and what the person said about
-- themselves on the form; and the outcome feed (0570) sent Meta no negative stage, so Meta had no reason to
-- stop delivering the same kind of lead. The audit of 2026-11-09 (`ADS-LEAD-INTAKE-AUDIT-2026-11-09.md`) names
-- this the biggest precision gap in the intake.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
-- · `recruiting_lead_closures` — one row per act (`closed` | `qualified` | `reopened`): the reason, the status
--   it left, who, when, an optional note. The ROW is the fact; `recruiting_leads.status` is its projection,
--   written in the same transaction. Rows are never edited (RL061) — a reopen is a new row — except that
--   `purge_lead` empties the note, which may name the person. They go with the lead (`on delete cascade`,
--   as `lead_match_verdicts` do), so `purge_applicant`'s whole-lead delete still works.
-- · `close_lead(org, lead, reason, note, actor, actor_name)` — the reason is one of the list below, and three
--   of them need EVIDENCE the function reads from `recruiting_contacts`, never a typed count: `not_interested`
--   a `reached` row, `wrong_number` a `wrong_number` row, `unreachable` at least three outbound
--   `no_answer`/`voicemail` rows; `duplicate` needs another lead of the same person by phone or e-mail
--   (`recruiting_lead_matches`, 0554). A `not_qualified:<requirement>` close ALSO writes a
--   `lead_match_verdicts` row — `does_not_meet`, evidence `verified` — against the opening's current profile
--   version, so the recruiter's verdict and the rules' verdict are one ledger and the quality alert's
--   "hard does-not-meet share" counts what a person established on the call. A lead with no opening or no
--   profile gets the closure and no verdict row, and the answer says so (`verdict_written`).
-- · `qualify_lead(org, lead, note, actor, actor_name)` — after a call: needs a `reached` contact row. A lead
--   that is already closed must be reopened first (RL058): a status is never walked over silently.
-- · `reopen_lead(org, lead, note, actor, actor_name)` — a closed lead comes back as `contacted` when anybody
--   ever reached for it, else `new` (so the uncontacted alarm applies again) — derived, not chosen.
-- · A second close/qualify of a lead already in that state changes nothing and says so (`already`): the
--   routes are retried, and a retry must not write a second act.
-- · `purge_lead` (0558) is redefined whole to also empty the notes on the lead's closures and report it
--   (`closure_notes_cleared`). The reasons stay: they are operational, not personal.
-- · NOT here: the outcome feed's stage CHECK (0570). `adsSchemaParity.test.ts` holds it equal to the shared
--   `LEAD_OUTCOME_STAGES`, which the daily brief and the Analyst read, so the CHECK, the list, the closures
--   reader and the brief move together in LQ5b2's migration — never a CHECK ahead of its list.
--
-- The reason list is `LEAD_CLOSE_REASONS` in packages/shared/src/recruiting/leads/leadClosureContract.ts,
-- derived from `LEAD_REQUIREMENTS` + six lost reasons; the CHECK below is its copy, and the matrix
-- `recruiting-lead-closures.test.mjs` imports the built TypeScript and inserts every reason — the same
-- translation-pinned-by-a-test answer as 0554's `phone_e164`. `home_time` is absent on purpose: it becomes a
-- requirement in LQ7, whose migration widens this CHECK.
--
-- ── THE SQLSTATE REGISTER (RL, continuing 0558's RL040–RL044) ─────────────────────────────────
--   RL050  a required argument is missing
--   RL051  the lead is not this carrier's
--   RL052  the lead's details were deleted (purged): nothing more can be recorded on it
--   RL053  the lead became an applicant: the applicant's dispositions own it now
--   RL054  unknown close reason
--   RL055  the reason needs a contact row on record that is not there (reached / wrong_number)
--   RL056  `unreachable` needs three outbound no-answer/voicemail attempts on record; fewer are recorded
--   RL057  `duplicate` needs another lead of the same person; none shares the phone or e-mail
--   RL058  the lead is closed: reopen it first
--   RL059  the lead is not closed, so there is nothing to reopen
--   RL061  recruiting_lead_closures are append-only
--
-- cross-module-waiver: `close_lead` and `reopen_lead` READ `recruiting_contacts` and `lead_conversions`
-- (recruiting's own) and `close_lead` WRITES `lead_match_verdicts` (recruiting's own, the same verdict shape
-- `verdicts.ts` writes). Nothing of another module's is touched.
--
-- ⚠ DEPLOY WINDOW: a new table nothing reads, three new functions nothing calls, one function redefined so
-- that its old caller's answer gains a key. Old code meets the new schema unchanged.

-- ── 1. the closures ledger ───────────────────────────────────────────────────────────────────────
create table if not exists public.recruiting_lead_closures (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  lead_id      uuid not null,
  kind         text not null check (kind in ('closed', 'qualified', 'reopened')),
  reason       text check (reason is null or reason in (
                 'not_qualified:age', 'not_qualified:class_a', 'not_qualified:class_a_experience', 'not_qualified:hazmat',
                 'not_qualified:dui', 'not_qualified:preventable_accident', 'not_qualified:clearinghouse',
                 'not_qualified:drug_alcohol',
                 'not_interested', 'unreachable', 'wrong_number', 'duplicate', 'out_of_area', 'spam')),
  status_after text not null check (status_after in ('new', 'contacted', 'qualified', 'not_qualified', 'lost')),
  note         text check (note is null or length(note) <= 2000),
  actor        uuid not null,
  actor_name   text not null check (length(btrim(actor_name)) between 1 and 200),
  recorded_at  timestamptz not null default now(),
  -- The order of acts on one lead. `recorded_at` alone cannot give it: two acts in one instant (a retry
  -- burst; PGlite's clock in the matrix) would fall to the uuid, which is random, and the drawer would show
  -- a reopen before its close. Readers order by `seq`.
  seq          bigint generated always as identity,
  -- A close carries a reason; a qualify or a reopen never does.
  check ((kind = 'closed') = (reason is not null)),
  unique (org_id, id),
  foreign key (org_id, lead_id) references public.recruiting_leads (org_id, id) on delete cascade
);
alter table public.recruiting_lead_closures enable row level security;
create index if not exists ix_recruiting_lead_closures_lead
  on public.recruiting_lead_closures (org_id, lead_id, seq desc);

create or replace function public.guard_recruiting_lead_closures()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The one edit: a purge empties the note (it may name the person). Everything else is frozen.
  if public.purging_lead(old.lead_id) and new.note is null
     and new.id = old.id and new.org_id = old.org_id and new.lead_id = old.lead_id and new.kind = old.kind
     and new.reason is not distinct from old.reason and new.status_after = old.status_after
     and new.actor = old.actor and new.actor_name = old.actor_name and new.recorded_at = old.recorded_at
     and new.seq = old.seq then
    return new;
  end if;
  raise exception 'recruiting_lead_closures are append-only: a correction is a new row' using errcode = 'RL061';
end;
$$;
drop trigger if exists trg_guard_recruiting_lead_closures on public.recruiting_lead_closures;
create trigger trg_guard_recruiting_lead_closures before update on public.recruiting_lead_closures
  for each row execute function public.guard_recruiting_lead_closures();

-- ── 2. the lead read every act starts with (locked; refusals RL050–RL053) ───────────────────────
create or replace function public.lead_for_act(p_fn text, p_org uuid, p_lead uuid, p_actor uuid, p_actor_name text)
returns public.recruiting_leads
language plpgsql
set search_path = ''
as $$
declare
  v_lead public.recruiting_leads;
begin
  if p_org is null or p_lead is null or p_actor is null or nullif(btrim(p_actor_name), '') is null then
    raise exception '%: org, lead and actor are all required', p_fn using errcode = 'RL050';
  end if;
  select * into v_lead from public.recruiting_leads where id = p_lead and org_id = p_org for update;
  if not found then
    raise exception '%: lead % is not this carrier''s', p_fn, p_lead using errcode = 'RL051';
  end if;
  if v_lead.purged_at is not null then
    raise exception '%: this lead''s details were deleted, so nothing more can be recorded on it', p_fn using errcode = 'RL052';
  end if;
  -- The conversion ROW is the fact (`convert_lead` writes it and the status together); the status alone is
  -- not asked, so a status somebody repaired by hand cannot reopen a converted lead.
  if exists (select 1 from public.lead_conversions c where c.org_id = p_org and c.lead_id = p_lead) then
    raise exception '%: this lead became an applicant; record the outcome on the applicant', p_fn using errcode = 'RL053';
  end if;
  return v_lead;
end;
$$;

-- ── 3. close ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.close_lead(
  p_org uuid, p_lead uuid, p_reason text, p_note text, p_actor uuid, p_actor_name text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_lead public.recruiting_leads;
  v_status text;
  v_requirement text;
  v_attempts integer;
  v_pv uuid;
  v_id uuid;
  v_verdict boolean := false;
begin
  v_lead := public.lead_for_act('close_lead', p_org, p_lead, p_actor, p_actor_name);
  if p_reason is null or p_reason not in (
      'not_qualified:age', 'not_qualified:class_a', 'not_qualified:class_a_experience', 'not_qualified:hazmat',
      'not_qualified:dui', 'not_qualified:preventable_accident', 'not_qualified:clearinghouse', 'not_qualified:drug_alcohol',
      'not_interested', 'unreachable', 'wrong_number', 'duplicate', 'out_of_area', 'spam') then
    raise exception 'close_lead: unknown close reason %', coalesce(p_reason, '(none)') using errcode = 'RL054';
  end if;
  if v_lead.status in ('not_qualified', 'lost') then
    return jsonb_build_object('lead_id', p_lead, 'closed', false, 'already', true, 'status', v_lead.status, 'verdict_written', false);
  end if;

  -- Evidence the reason needs, read from the contacts ledger — never a count the person typed.
  if p_reason in ('not_interested', 'wrong_number') then
    if not exists (select 1 from public.recruiting_contacts c
                    where c.org_id = p_org and c.lead_id = p_lead
                      and c.outcome = case p_reason when 'not_interested' then 'reached' else 'wrong_number' end) then
      raise exception 'close_lead: % needs a call with outcome % on record — log the call first',
        p_reason, case p_reason when 'not_interested' then 'reached' else 'wrong_number' end using errcode = 'RL055';
    end if;
  elsif p_reason = 'unreachable' then
    select count(*) into v_attempts from public.recruiting_contacts c
     where c.org_id = p_org and c.lead_id = p_lead and c.direction = 'outbound' and c.outcome in ('no_answer', 'voicemail');
    if v_attempts < 3 then
      raise exception 'close_lead: unreachable needs 3 outbound attempts with no answer on record; % recorded', v_attempts
        using errcode = 'RL056';
    end if;
  elsif p_reason = 'duplicate' then
    if jsonb_array_length(public.recruiting_lead_matches(p_org, p_lead) -> 'leads') = 0 then
      raise exception 'close_lead: duplicate needs another lead of the same person; none shares this phone or e-mail'
        using errcode = 'RL057';
    end if;
  end if;

  v_requirement := case when p_reason like 'not_qualified:%' then substr(p_reason, length('not_qualified:') + 1) end;
  v_status := case when v_requirement is not null then 'not_qualified' else 'lost' end;

  insert into public.recruiting_lead_closures (org_id, lead_id, kind, reason, status_after, note, actor, actor_name)
  values (p_org, p_lead, 'closed', p_reason, v_status, nullif(btrim(coalesce(p_note, '')), ''), p_actor, btrim(p_actor_name))
  returning id into v_id;
  update public.recruiting_leads set status = v_status, updated_at = now() where id = p_lead and org_id = p_org;

  -- The recruiter's verdict joins the rules' ledger, against the opening's current profile version.
  if v_requirement is not null and v_lead.opening_id is not null then
    select ov.profile_version_id into v_pv
      from public.recruiting_opening_versions ov
     where ov.org_id = p_org and ov.opening_id = v_lead.opening_id
     order by ov.version desc limit 1;
    if v_pv is not null then
      insert into public.lead_match_verdicts (org_id, lead_id, profile_version_id, requirement, verdict, evidence, detail)
      values (p_org, p_lead, v_pv, v_requirement, 'does_not_meet', 'verified',
              jsonb_build_object('hard', true, 'closure_id', v_id, 'by', 'recruiter'));
      v_verdict := true;
    end if;
  end if;

  return jsonb_build_object('lead_id', p_lead, 'closed', true, 'already', false, 'closure_id', v_id,
                            'status', v_status, 'verdict_written', v_verdict);
end;
$$;

-- ── 4. qualify ───────────────────────────────────────────────────────────────────────────────────
create or replace function public.qualify_lead(p_org uuid, p_lead uuid, p_note text, p_actor uuid, p_actor_name text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_lead public.recruiting_leads;
  v_id uuid;
begin
  v_lead := public.lead_for_act('qualify_lead', p_org, p_lead, p_actor, p_actor_name);
  if v_lead.status = 'qualified' then
    return jsonb_build_object('lead_id', p_lead, 'qualified', false, 'already', true, 'status', 'qualified');
  end if;
  if v_lead.status in ('not_qualified', 'lost') then
    raise exception 'qualify_lead: this lead is closed; reopen it first' using errcode = 'RL058';
  end if;
  if not exists (select 1 from public.recruiting_contacts c
                  where c.org_id = p_org and c.lead_id = p_lead and c.outcome = 'reached') then
    raise exception 'qualify_lead: qualifying needs a call with outcome reached on record — log the call first'
      using errcode = 'RL055';
  end if;
  insert into public.recruiting_lead_closures (org_id, lead_id, kind, reason, status_after, note, actor, actor_name)
  values (p_org, p_lead, 'qualified', null, 'qualified', nullif(btrim(coalesce(p_note, '')), ''), p_actor, btrim(p_actor_name))
  returning id into v_id;
  update public.recruiting_leads set status = 'qualified', updated_at = now() where id = p_lead and org_id = p_org;
  return jsonb_build_object('lead_id', p_lead, 'qualified', true, 'already', false, 'closure_id', v_id, 'status', 'qualified');
end;
$$;

-- ── 5. reopen ────────────────────────────────────────────────────────────────────────────────────
create or replace function public.reopen_lead(p_org uuid, p_lead uuid, p_note text, p_actor uuid, p_actor_name text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_lead public.recruiting_leads;
  v_status text;
  v_id uuid;
begin
  v_lead := public.lead_for_act('reopen_lead', p_org, p_lead, p_actor, p_actor_name);
  if v_lead.status not in ('not_qualified', 'lost') then
    raise exception 'reopen_lead: this lead is not closed (it is %)', v_lead.status using errcode = 'RL059';
  end if;
  v_status := case when exists (select 1 from public.recruiting_contacts c where c.org_id = p_org and c.lead_id = p_lead)
                   then 'contacted' else 'new' end;
  insert into public.recruiting_lead_closures (org_id, lead_id, kind, reason, status_after, note, actor, actor_name)
  values (p_org, p_lead, 'reopened', null, v_status, nullif(btrim(coalesce(p_note, '')), ''), p_actor, btrim(p_actor_name))
  returning id into v_id;
  update public.recruiting_leads set status = v_status, updated_at = now() where id = p_lead and org_id = p_org;
  return jsonb_build_object('lead_id', p_lead, 'reopened', true, 'closure_id', v_id, 'status', v_status);
end;
$$;

-- ── 6. purge_lead (0558) also empties the closures' notes ───────────────────────────────────────
create or replace function public.purge_lead(p_org uuid, p_lead uuid, p_actor uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_lead record;
  v_verdicts bigint;
  v_contacts bigint;
  v_notes bigint;
begin
  if p_org is null or p_lead is null or p_actor is null then
    raise exception 'purge_lead: org, lead and actor are all required' using errcode = 'RL043';
  end if;
  if not exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = p_actor and m.role = 'admin') then
    raise exception 'purge_lead: only an admin of the carrier may delete a lead''s details' using errcode = 'RL042';
  end if;
  select id, purged_at into v_lead from public.recruiting_leads where id = p_lead and org_id = p_org for update;
  if not found then
    raise exception 'purge_lead: lead % is not this carrier''s', p_lead using errcode = 'RL040';
  end if;
  if exists (select 1 from public.lead_conversions c where c.org_id = p_org and c.lead_id = p_lead) then
    raise exception 'purge_lead: lead % became an applicant; purge the applicant', p_lead using errcode = 'RL041';
  end if;
  select count(*) into v_contacts from public.recruiting_contacts where org_id = p_org and lead_id = p_lead;
  if v_lead.purged_at is not null then
    return jsonb_build_object('lead_id', p_lead, 'purged', false, 'already', true, 'verdicts_deleted', 0,
                              'contacts_kept', v_contacts, 'closure_notes_cleared', 0);
  end if;

  perform set_config('fuelguard.purging_lead', p_lead::text, true);
  update public.recruiting_leads
     set full_name = null, phone_e164 = null, email_lower = null, answers = '{}'::jsonb, raw = '{}'::jsonb,
         assigned_to = null, status = 'lost', purged_at = now()
   where id = p_lead and org_id = p_org;
  delete from public.lead_match_verdicts where org_id = p_org and lead_id = p_lead;
  get diagnostics v_verdicts = row_count;
  update public.recruiting_lead_closures set note = null where org_id = p_org and lead_id = p_lead and note is not null;
  get diagnostics v_notes = row_count;
  perform set_config('fuelguard.purging_lead', '', true);

  return jsonb_build_object('lead_id', p_lead, 'purged', true, 'already', false, 'verdicts_deleted', v_verdicts,
                            'contacts_kept', v_contacts, 'closure_notes_cleared', v_notes);
end;
$$;

comment on table public.recruiting_lead_closures is
  'LQ5a (0578): one row per recruiter act on a lead — closed (with a fixed reason), qualified, reopened. The row is the fact; recruiting_leads.status is its projection. Append-only (RL061) except purge_lead emptying the note. Goes with the lead.';
comment on function public.close_lead(uuid, uuid, text, text, uuid, text) is
  'LQ5a: closes a lead with one of LEAD_CLOSE_REASONS; evidence reasons are checked against recruiting_contacts (RL055/RL056) and recruiting_lead_matches (RL057); a not_qualified:<requirement> close also writes a verified does_not_meet verdict. Idempotent on an already-closed lead.';
comment on function public.qualify_lead(uuid, uuid, text, uuid, text) is
  'LQ5a: the recruiter''s positive verdict after a reached call (RL055); a closed lead must be reopened first (RL058). Idempotent.';
comment on function public.reopen_lead(uuid, uuid, text, uuid, text) is
  'LQ5a: a closed lead returns as contacted when any contact is on record, else new (RL059 when not closed).';

revoke all on function public.lead_for_act(text, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.close_lead(uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.qualify_lead(uuid, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.reopen_lead(uuid, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.purge_lead(uuid, uuid, uuid) from public, anon, authenticated;
