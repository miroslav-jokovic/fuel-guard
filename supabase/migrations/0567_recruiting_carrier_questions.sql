-- 0567 — questions the carrier writes itself, stamped on each invitation at its first Send
-- (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.3, D-CQ1..D-CQ5; owner's ruling on Q-RS2, 2026-11-04). Reader: CQ2.
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- The questionnaire is code (`SILVICOM_DRIVER_V3`), immutable once answered and versioned `id@version`. A
-- carrier that wants to ask "Can you start within two weeks?" or "Which terminal would you report to?" has
-- nowhere to write it. The owner (Q-RS2): carrier-written questions, as a Settings option.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
-- · `recruiting_carrier_questions` — the carrier's list: the wording, an optional hint, a kind (short
--   answer, long answer, yes/no, one of a list, date, number), its choices, whether it is required, and its
--   place in the list. **Retired, never deleted** (CQ010) and **what was asked never changes** (CQ011):
--   wording, kind and choices are frozen once saved, because an answer must stay readable beside exactly
--   the question asked — a different question is a new row (§10's D-CE5, 0545's CS010/CS011). The hint,
--   whether it is required and its place stay the office's to edit; retiring is one-way (CQ012). At most
--   20 live (CQ013, D-CQ5).
-- · `application_invitations.carrier_questions jsonb` — the set THIS applicant is asked, stamped once at
--   the office's first Send (D-CQ2, the twin of 0550's `required_questions`): an array of
--   {id, wording, hint, kind, choices, required}. The applicant answers the stamp; the API validates
--   against the stamp, never the client's copy, and the filed PDF and office drawer print it — so a
--   question retired later still prints on the application that asked it. Null = sent before CQ2, and
--   such an application has no carrier questions.
-- · `send_application_invitation` gains `p_carrier_questions jsonb default null`, written only while
--   `application_sent_at` is still null (0550's rule: a resend never restamps).
--
-- ── WHY THE STAMP IS JSON AND NOT A JOIN ───────────────────────────────────────────────────────
-- Frozen columns make the row's words stable, but `required` and the hint are editable and the set is
-- per applicant. A join to the live list would let a Tuesday edit change what Monday's applicant was
-- asked. The stamp is a copy, on purpose — taken once, at the moment the applicant is first served.
-- SQL checks only its outer shape (an array of at most 20); the API composes it from the rows and
-- checks every answer against it (D-CQ3).
--
-- ── WHY CHOICES ARE CHECKED HERE ───────────────────────────────────────────────────────────────
-- Unlike 0550's question ids, a choice is not a fact of any TypeScript catalogue — it is the carrier's
-- own text, and this row is its only home. So the bounds are the database's: a one-of-a-list question has
-- 2..20 choices of 1..80 characters (D-CQ5); every other kind has none.
--
-- ── WHY THE QUESTIONNAIRE'S KIND WORDS ─────────────────────────────────────────────────────────
-- `text, longtext, boolean, select, date, number` are `QUESTION_KINDS` less `table` (a grid is not a
-- question a carrier types into a settings box). Using the questionnaire's own words makes a stamped
-- question a questionnaire question: the wizard's fields, the answer schema, the review and the filed
-- PDF read it with the code that already reads the built-in ones, rather than a second vocabulary
-- translated at every edge. The CHECK is a copy of five words of that list — the shape a row must have
-- for that code to read it, which a TS test pins against `QUESTION_KINDS` (CQ2).
--
-- RLS on, no client policies — deny-all to a browser; the API is the one door and every service query
-- filters on `org_id` itself.
--
-- cross-module-waiver: `send_application_invitation` is recruiting's own function (0365, 0533, 0550);
-- redefined whole with 0550's body, one argument added and one column written.
--
-- ⚠ DEPLOY WINDOW: a new table (no old reader), one added nullable column no served code names, and a
-- function whose old 5-argument call still resolves (the sixth argument defaults to null and stamps
-- nothing). Code served before CQ2 keeps working on either side of the merge (docs/MIGRATION-DISCIPLINE.md).
--
-- Rollback: drop table public.recruiting_carrier_questions; alter table public.application_invitations drop
-- column carrier_questions; restore 0550's send_application_invitation.

-- ── the carrier's list ─────────────────────────────────────────────────────────────────────────
-- Immutable, so a CHECK may call it: every choice present and 1..80 characters after trimming.
create or replace function public.carrier_question_choices_ok(p_choices text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(c is not null and length(btrim(c)) between 1 and 80), false)
    from unnest(p_choices) as c;
$$;

create table if not exists public.recruiting_carrier_questions (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  wording    text not null check (length(btrim(wording)) between 1 and 300),
  hint       text check (hint is null or length(hint) <= 300),
  -- The questionnaire's own kinds (`QUESTION_KINDS`, questionnaireContract.ts) less `table`, so a stamped
  -- question IS a questionnaire question and is drawn, checked and filed by the same code (CQ2).
  kind       text not null check (kind in ('text', 'longtext', 'boolean', 'select', 'date', 'number')),
  -- Only a one-of-a-list question (`select`) has choices, and it has 2..20 of them (D-CQ5).
  choices    text[],
  required   boolean not null default false,
  position   integer not null default 0 check (position between 0 and 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by uuid references auth.users(id) on delete set null,
  constraint recruiting_carrier_questions_choices_check check (
    case when kind = 'select'
      then choices is not null and cardinality(choices) between 2 and 20 and public.carrier_question_choices_ok(choices)
      else choices is null
    end)
);

alter table public.recruiting_carrier_questions enable row level security;

create index if not exists ix_recruiting_carrier_questions_org
  on public.recruiting_carrier_questions (org_id, position, created_at) where retired_at is null;

comment on table public.recruiting_carrier_questions is
  'HIRING-WORKFLOW-AUDIT §15.3 CQ1 (0567): questions the carrier writes itself, asked on the application after the built-in ones. Retired, never deleted (CQ010); wording, kind and choices never change (CQ011) — a different question is a new row; retiring is one-way (CQ012); at most 20 live (CQ013). Stamped onto each invitation at its first Send (application_invitations.carrier_questions). Service-role only (RLS, no policies).';

create or replace function public.guard_recruiting_carrier_questions()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_live int;
begin
  if tg_op = 'DELETE' then
    raise exception 'recruiting_carrier_questions are never deleted — retire the question instead' using errcode = 'CQ010';
  end if;
  if tg_op = 'INSERT' then
    -- One carrier's inserts queue behind each other, so two at once cannot both be the twentieth.
    perform pg_advisory_xact_lock(hashtext('recruiting_carrier_questions'), hashtext(new.org_id::text));
    select count(*) into v_live
      from public.recruiting_carrier_questions
     where org_id = new.org_id and retired_at is null;
    if new.retired_at is null and v_live >= 20 then
      raise exception 'carrier_questions_full — retire one before adding another' using errcode = 'CQ013';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.org_id <> old.org_id
     or new.wording <> old.wording or new.kind <> old.kind or new.choices is distinct from old.choices
     or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'what a carrier question asks never changes — retire it and add a new question' using errcode = 'CQ011';
  end if;
  if old.retired_at is not null
     and (new.retired_at is distinct from old.retired_at or new.retired_by is distinct from old.retired_by) then
    raise exception 'carrier_question_already_retired' using errcode = 'CQ012';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_recruiting_carrier_questions on public.recruiting_carrier_questions;
create trigger trg_guard_recruiting_carrier_questions
  before insert or update or delete on public.recruiting_carrier_questions
  for each row execute function public.guard_recruiting_carrier_questions();

-- ── the set this applicant is asked ────────────────────────────────────────────────────────────
alter table public.application_invitations
  add column if not exists carrier_questions jsonb
    check (carrier_questions is null
           or (jsonb_typeof(carrier_questions) = 'array' and jsonb_array_length(carrier_questions) <= 20));

comment on column public.application_invitations.carrier_questions is
  'HIRING-WORKFLOW-AUDIT §15.3 CQ1 (0567): the carrier-written questions this applicant is asked — [{id, wording, hint, kind, choices, required}] — stamped once by send_application_invitation at the first Send (D-CQ2) and never changed by a resend. The API validates answers against this, and the filed PDF and office drawer print it. Null = sent before CQ2: no carrier questions.';

-- ── send_application_invitation: 0550's body, stamping the carrier's questions once ────────────
-- Dropped and recreated rather than overloaded (PGRST203). The sixth argument defaults, so the
-- 5-argument call served before CQ2 resolves to this function and stamps nothing (0550's pattern).
drop function if exists public.send_application_invitation(uuid, uuid, text, int, text[]);

create or replace function public.send_application_invitation(
  p_org                uuid,
  p_invitation         uuid,
  p_token_hash         text,
  p_extend_days        int,
  p_required_questions text[] default null,
  p_carrier_questions  jsonb default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found     boolean;
  v_revoked   timestamptz;
  v_submitted timestamptz;
  v_sent      timestamptz;
begin
  if nullif(p_token_hash, '') is null or p_extend_days is null or p_extend_days < 1 then
    raise exception 'send_application_invalid' using errcode = 'AI004';
  end if;

  select true, revoked_at, submitted_at
    into v_found, v_revoked, v_submitted
    from public.application_invitations
   where id = p_invitation and org_id = p_org
   for update;

  if v_found is null then
    raise exception 'application_invitation_not_found' using errcode = 'AI001';
  end if;
  if v_revoked is not null then
    raise exception 'application_invitation_unusable' using errcode = 'AI002';
  end if;
  if v_submitted is not null then
    raise exception 'application_already_submitted' using errcode = 'AI003';
  end if;

  -- ⚠ Both stamps read the row as it was BEFORE this update (SET expressions see the old row), so they
  -- are written on the first Send and left alone by every resend (D-RS3, D-CQ2).
  update public.application_invitations
     set token_hash          = p_token_hash,
         required_questions  = case when application_sent_at is null then p_required_questions
                                    else required_questions end,
         carrier_questions   = case when application_sent_at is null then p_carrier_questions
                                    else carrier_questions end,
         application_sent_at = coalesce(application_sent_at, now()),
         expires_at          = greatest(expires_at, now() + make_interval(days => p_extend_days))
   where id = p_invitation and org_id = p_org
   returning application_sent_at into v_sent;

  return v_sent;
end;
$$;

revoke all on function public.send_application_invitation(uuid, uuid, text, int, text[], jsonb)
  from public, anon, authenticated;
grant execute on function public.send_application_invitation(uuid, uuid, text, int, text[], jsonb) to service_role;

comment on function public.send_application_invitation(uuid, uuid, text, int, text[], jsonb) is
  'AF2/D-AF5/D-AF7: the office sends the application form. Rotates the token in place (0232), stamps application_sent_at once, and extends expires_at without ever shortening it. Refuses AI001 not found, AI002 revoked, AI003 submitted, AI004 invalid. Since 0550 (§11 S1) it stores p_required_questions, and since 0567 (§15.3 CQ1) p_carrier_questions — the carrier-written questions this applicant is asked — both on the FIRST send only; a resend never restamps (D-RS3, D-CQ2).';
