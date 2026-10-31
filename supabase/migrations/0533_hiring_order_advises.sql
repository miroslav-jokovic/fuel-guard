-- 0533 — the hiring order advises; it no longer refuses (HIRING-WORKFLOW-AUDIT-2026-10-31 §9 P3,
-- §8.1; Q-WF1 (a) and Q-WF6 as assumed in §8.3).
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- The audit (§2) measured the office being told "no" by the database for an ORDER the carrier
-- prefers, not one the law or the data requires. Three refusals are that kind and go here:
--   · AI005 `releases_not_complete` (0365, `send_application_invitation`) — the application form
--     waited on every permission being signed. Nothing in §391.21 puts the permissions first; a
--     recruiter on the phone with a driver who has not signed the PSP release yet can now send the
--     form, and the checklist shows the permissions still open.
--   · AI006 `packet_not_yet_approved` (0369, `open_packet_signing`) — opening the in-person session
--     waited on approval. Opening only issues the sign token (DR036 / HB023 read it); what may be
--     SIGNED with it is still guarded below, so the office can open the session at the desk and the
--     driver can sign the handbook while approval is pending.
--   · HB022 `handbook_application_not_filed` (0374, kept by 0382/0385, `handbook_marks_guard`) —
--     the handbook marks waited on the application being filed. The handbook is the carrier's own
--     paper (D-HB5, replaced by Q-WF6); a driver may read and sign it on the office day in any
--     order.
--
-- ── WHAT STAYS, AND WHY (§8.1) ─────────────────────────────────────────────────────────────────
--   · DR032 (`record_packet_mark`: packet not approved) — approval writes the carrier's half into
--     the packet; a mark before it would sign a document that does not exist yet. Not order: content.
--   · DR036 / HB023 (signing not opened) — opening is what issues the token the mark is made with.
--     Mechanical: with no token there is nothing to refuse.
--   · PC030 (0388: a handbook is FILED only once the packet's countersignature exists) — D-HB10/11:
--     the countersign ceremony stamps the packet's carrier lines first and the handbook last, as one
--     act. So a handbook marked before the application is filed waits, signed, for the packet; it
--     cannot be filed alone. That is the evidence's shape, not a preferred order.
--   · AI001..AI004, HB011, HB020, HB021, HB024 — existence, revocation, frozen-after-filing and
--     invalid input. Unchanged.
-- What the office SHOULD do first is now a warning the API computes from the checklist fold
-- (`APPLICATION_SEND_WARNS_ON`, `OPEN_SIGNING_WARNS_ON` and the lists §9 P4 adds), shown as a
-- caution callout — never a refusal here.
--
-- ── SHAPE ──────────────────────────────────────────────────────────────────────────────────────
-- Each body is its last definition (0365, 0369, 0385) with the one refusal taken out and the column
-- that only that refusal read dropped from its select. Signatures, grants and every other refusal
-- are copied unchanged, so `create or replace` keeps the grants; they are restated anyway.
--
-- ⚠ DEPLOY WINDOW: this only removes refusals. Code served before it still checks nothing these
-- refused (the API never relied on them — it warns or refuses itself until §9 P4), and code served
-- after it simply stops seeing three error codes. Safe on either side of the merge
-- (docs/MIGRATION-DISCIPLINE.md).

-- ── 1. send_application_invitation: the form no longer waits on the permissions ─────────────────
create or replace function public.send_application_invitation(
  p_org         uuid,
  p_invitation  uuid,
  p_token_hash  text,
  p_extend_days int
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

  update public.application_invitations
     set token_hash          = p_token_hash,
         application_sent_at = coalesce(application_sent_at, now()),
         expires_at          = greatest(expires_at, now() + make_interval(days => p_extend_days))
   where id = p_invitation and org_id = p_org
   returning application_sent_at into v_sent;

  return v_sent;
end;
$$;

revoke all on function public.send_application_invitation(uuid, uuid, text, int)
  from public, anon, authenticated;
grant execute on function public.send_application_invitation(uuid, uuid, text, int) to service_role;

comment on function public.send_application_invitation(uuid, uuid, text, int) is
  'AF2/D-AF5/D-AF7: the office sends the application form. Rotates the token in place (0232), stamps application_sent_at once, and extends expires_at without ever shortening it. Refuses AI001 not found, AI002 revoked, AI003 submitted, AI004 invalid. Since 0533 (HIRING-WORKFLOW-AUDIT §9 P3) the permissions coming first is advised, not refused: AI005 is no longer raised.';

-- ── 2. open_packet_signing: the session no longer waits on approval ────────────────────────────
create or replace function public.open_packet_signing(
  p_org             uuid,
  p_invitation      uuid,
  p_sign_token_hash text,
  p_extend_days     int
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
  v_opened    timestamptz;
begin
  if nullif(p_sign_token_hash, '') is null or p_extend_days is null or p_extend_days < 1 then
    raise exception 'open_signing_invalid' using errcode = 'AI004';
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

  update public.application_invitations
     set sign_token_hash   = p_sign_token_hash,
         signing_opened_at = coalesce(signing_opened_at, now()),
         expires_at        = greatest(expires_at, now() + make_interval(days => p_extend_days))
   where id = p_invitation and org_id = p_org
   returning signing_opened_at into v_opened;

  return v_opened;
end;
$$;

revoke all on function public.open_packet_signing(uuid, uuid, text, int)
  from public, anon, authenticated;
grant execute on function public.open_packet_signing(uuid, uuid, text, int) to service_role;

comment on function public.open_packet_signing(uuid, uuid, text, int) is
  'AF5/D-AF3/D-AF6: the office opens signing in person. Sets a fresh sign_token_hash, stamps signing_opened_at once, and extends expires_at without ever shortening it. Refuses AI001 not found, AI002 revoked, AI003 filed, AI004 invalid. Since 0533 (HIRING-WORKFLOW-AUDIT §9 P3) approval coming first is advised, not refused: AI006 is no longer raised. What can be signed is still guarded: record_packet_mark refuses DR032 before approval and DR036 until this has run.';

-- ── 3. handbook_marks_guard: the handbook no longer waits on the filed application ─────────────
-- 0385's body without HB022. HB011, HB020, HB021, HB023, HB024 and 0380's purge branch unchanged.
create or replace function public.handbook_marks_guard()
returns trigger
language plpgsql
as $$
declare
  inv record;
begin
  if TG_OP = 'DELETE' and public.purging_applicant_invitation(old.invitation_id) then
    return old;
  end if;
  if TG_OP <> 'INSERT' then
    raise exception 'handbook_marks is append-only' using errcode = 'HB011';
  end if;

  select org_id, expires_at, revoked_at, signing_opened_at, handbook_filed_at
    into inv
    from application_invitations
   where id = new.invitation_id;

  if not found or inv.org_id <> new.org_id then
    raise exception 'handbook_invitation_not_found' using errcode = 'HB020';
  end if;
  if inv.revoked_at is not null or inv.expires_at <= now() then
    raise exception 'handbook_invitation_unusable' using errcode = 'HB021';
  end if;
  -- D-AW16: the envelope the office sent (`signing_opened_at`) opens the handbook (0382); since 0385
  -- it is the only opening.
  if inv.signing_opened_at is null then
    raise exception 'handbook_signing_not_opened' using errcode = 'HB023';
  end if;
  if inv.handbook_filed_at is not null then
    raise exception 'handbook_already_filed' using errcode = 'HB024';
  end if;
  return new;
end;
$$;

comment on function public.handbook_marks_guard() is
  'D-HB/0374, 0382, 0385: guards handbook_marks — append-only (HB011) except the applicant purge, invitation of this org (HB020), live (HB021), signing opened (HB023), handbook not yet filed (HB024). Since 0533 (HIRING-WORKFLOW-AUDIT §9 P3) a filed application is no longer required (HB022 dropped, Q-WF6); filing the handbook still waits on the packet countersignature (PC030, 0388).';
