-- 0226 — the half-typed application, saved (APPLICATION-SYSTEM-PLAN A2, D-APP2/D-APP3/D-APP16).
--
-- ── WHY THIS TABLE EXISTS ──────────────────────────────────────────────────────────────────────
-- The §391.21 application is long, and the market's one durable finding about these forms is that
-- roughly nine in ten are filled on a phone — at a truck stop, on a signal that comes and goes. Our
-- design until now was one link, one shot, submit-or-lose-forty-minutes-of-typing. A driver who lost
-- the tab lost everything they had typed and had to ask the carrier for a new link to start again.
-- 0225 made the link a session; this gives the session something to remember.
--
-- ── IT IS OPERATIONAL, NOT EVIDENCE, AND THAT IS THE WHOLE ARGUMENT ────────────────────────────
-- A half-typed form is transcription, not a certification. Nobody signed it, nothing cites it, and
-- §391.51 does not ask for it. What it DOES hold is a date of birth, an address history and a
-- licence number for a person who may never apply — so the requirement runs the other way from the
-- evidence tables: this must be DELETABLE the moment it stops being useful.
--
-- Both halves of that are structural rather than aspirational:
--
--   1. The append-only guard uses **0213's style** — `auth_role() is null` PASSES, which is the
--      service role — and not the EI010/DA010 family, which fires for the service role too. The
--      EI010 style is correct for evidence (nothing may rewrite it, ever) and would have made the
--      "prunable" promise structurally false here: the retention rule A11 ships runs as the service
--      role, and a trigger that refuses it would leave a table nobody can ever clear.
--   2. This table is deliberately **NOT** in `RETENTION_FORBIDDEN` (`apps/api/src/services/dataRetention.ts`).
--      That list is the evidence line. A draft is on the other side of it, and A11's rule prunes
--      drafts a configured window after their invitation expires or their lead is dispositioned.
--
-- Until that rule lands, the cascade below is what actually collects: `on delete cascade` from the
-- invitation means revoking or deleting an invitation takes its draft with it, with no service code
-- involved and nothing to forget.
--
-- ── WHY NOT A `draft jsonb` COLUMN ON `application_invitations` ────────────────────────────────
-- Because of what that table is. 0220's header is built on a property worth keeping: a leak of
-- `application_invitations` yields SHA-256 hashes and timestamps — no working links, nothing about a
-- person. Putting a half-typed date of birth in it changes its sensitivity class entirely, and it
-- would put PII inside a row that `RETENTION_FORBIDDEN` pins in place forever. Two tables with two
-- retention answers is the honest shape; one table with two kinds of secret is not.
--
-- ── WHY THE PAYLOAD IS UNVALIDATED ─────────────────────────────────────────────────────────────
-- `jsonb`, partial, no schema. A form that refuses to save until it is valid is a form that cannot
-- save at all until it is finished, which defeats the entire point of saving it. The contract
-- (`driverApplicationSchema`) is applied at SUBMIT, where the applicant certifies the answers as
-- true and complete — that is the moment §391.21(b) cares about, and nothing before it.
--
-- ── WHAT MUST NEVER BE IN HERE ─────────────────────────────────────────────────────────────────
-- The Social Security number (D-APP3). `driver_applications.ssn_sealed` is a secretBox envelope
-- bound to org + purpose; this column is plain `jsonb` in a prunable table, and nine digits do not
-- go in it, ever. The client never places it in the draft object (a unit test pins that) and the API
-- refuses a payload carrying the key rather than filtering it out — a silent filter would let the
-- client regress unnoticed, and this is the one field where "unnoticed" is unacceptable.
--
-- ── AND WHY A DATE OF BIRTH IN HERE FORCES A READ GATE ─────────────────────────────────────────
-- D-APP16. The link is now a session, the session holds this row, and A10 will re-send that same
-- link in a nudge email. A forwarded email or a shared phone would therefore read a half-typed
-- application: D-APP2 defends the DATABASE leak, not the LINK leak. So once a draft contains a date
-- of birth, `GET /:token` returns the phase stamps and the furthest section but not the body, and
-- the body is released only by `POST /:token/unlock` carrying the matching date of birth. The gate
-- lives in the API, not here — but it exists because of what this column holds, which is why it is
-- written down beside it.
create table if not exists public.application_drafts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  -- One draft per link, enforced by the unique constraint rather than by service discipline: a
  -- second row for the same invitation would mean two answers to "what did this driver type?", and
  -- the save path resolves that by UPDATE-ing the one that exists (0226's RPC below).
  invitation_id    uuid not null unique references public.application_invitations(id) on delete cascade,
  driver_id        uuid not null references public.drivers(id) on delete cascade,
  payload          jsonb not null default '{}'::jsonb,
  -- The furthest section the driver reached, so a resumed session opens there rather than at the
  -- top. Free text and nullable: A3 defines the section vocabulary, and this column holding a value
  -- from a vocabulary that does not exist yet would be a constraint written against an assumption.
  furthest_section text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.application_drafts enable row level security;
-- No client policies — deny-all, API-only, the same posture as `application_invitations` and
-- `driver_applications`. The only reader is the public token surface, which resolves the org from
-- the presented token server-side and never accepts one from a request.

comment on table public.application_drafts is
  'A2/D-APP2: the applicant''s half-typed §391.21 form, saved so a lost signal is not a lost application. OPERATIONAL, not evidence — prunable by design (0213-style guard, cascade from the invitation, deliberately absent from RETENTION_FORBIDDEN). Never holds an SSN (D-APP3).';
comment on column public.application_drafts.payload is
  'The form''s working shape: partial and unvalidated on purpose (a form that will not save until it is valid cannot save at all). Validated against driverApplicationSchema only at submit, where the applicant certifies it. Never contains an ssn key.';
comment on column public.application_drafts.furthest_section is
  'The furthest section reached, for resuming. Free text until A3 defines the section vocabulary.';

-- ── THE GUARD: PRUNABLE BY THE SERVICE ROLE, IMMUTABLE TO EVERYONE ELSE ────────────────────────
-- 0213's style, and the choice is load-bearing (see the header). `auth_role() is null` is the
-- service role and any path with no JWT claims; every JWT-bearing writer is refused. RLS with no
-- policies already refuses a browser session outright — this is the second lock, and the statement
-- of intent for whoever later wonders whether a client was ever meant to write here.
create or replace function public.guard_application_drafts_client_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.auth_role() is not null then
    raise exception 'application_drafts is written only by the application API'
      using errcode = 'DA030';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_guard_application_drafts on public.application_drafts;
create trigger trg_guard_application_drafts
  before update or delete on public.application_drafts
  for each row
  execute function public.guard_application_drafts_client_writes();

-- ── SAVING: UPDATE FIRST, INSERT ONLY IF THERE WAS NOTHING TO UPDATE ───────────────────────────
-- Written as an explicit update-then-insert RPC and NOT as a partial `.upsert()`, which the root
-- CLAUDE.md forbids and `lint:upserts` enforces: Postgres evaluates NOT NULL on the proposed tuple
-- BEFORE conflict arbitration, so `ON CONFLICT DO UPDATE` cannot rescue an insert that omits a NOT
-- NULL column even when the row already exists (0174's incident, in full).
--
-- The `unique_violation` handler is the race, not a formality: two autosaves in flight can both miss
-- the UPDATE and both attempt the INSERT. The loser retries the UPDATE, which now finds the row the
-- winner created. Last write wins, which is the correct semantic for a draft — both writes came from
-- the same driver in the same session, and the later one is what is on their screen.
create or replace function public.save_application_draft(
  p_org        uuid,
  p_invitation uuid,
  p_driver     uuid,
  p_payload    jsonb,
  p_section    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_updated timestamptz;
begin
  update public.application_drafts
     set payload          = coalesce(p_payload, '{}'::jsonb),
         -- coalesce on the INCOMING side: a save that does not name a section keeps the furthest one
         -- already reached. A driver stepping back to fix an address has not un-reached the page
         -- they were on.
         furthest_section = coalesce(p_section, furthest_section),
         updated_at       = now()
   where invitation_id = p_invitation and org_id = p_org
   returning id, updated_at into v_id, v_updated;

  if v_id is null then
    begin
      insert into public.application_drafts (org_id, invitation_id, driver_id, payload, furthest_section)
      values (p_org, p_invitation, p_driver, coalesce(p_payload, '{}'::jsonb), p_section)
      returning id, updated_at into v_id, v_updated;
    exception when unique_violation then
      update public.application_drafts
         set payload          = coalesce(p_payload, '{}'::jsonb),
             furthest_section = coalesce(p_section, furthest_section),
             updated_at       = now()
       where invitation_id = p_invitation and org_id = p_org
       returning id, updated_at into v_id, v_updated;
    end;
  end if;

  return jsonb_build_object('draft_id', v_id, 'updated_at', v_updated);
end;
$$;

revoke all on function public.save_application_draft(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_application_draft(uuid, uuid, uuid, jsonb, text) to service_role;

comment on function public.save_application_draft(uuid, uuid, uuid, jsonb, text) is
  'A2: save the applicant''s partial form for one invitation — UPDATE if a draft exists, INSERT if not, retry the UPDATE on the concurrent-insert race. Never a partial upsert (lint:upserts, 0174''s incident). Last write wins, which is what a draft means.';
