-- 0589 — the applicant's Social Security number, held sealed BEFORE signing (APPLICATION-FIX-PLAN.md
-- §7 item 3; owner rulings Q-AM3 and Q-AM17, 2026-11-11).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
-- Until now the SSN existed only after signing: the driver typed it on the sign-off screen and it
-- went straight into `driver_applications.ssn_sealed` (D-HIRE6, D-APP3), so the office could neither
-- review it nor correct it, and the packet the driver signs could not hold it. The owner's ruling:
-- the driver enters it in the FORM, the office reviews it like every other answer, and nothing is
-- editable after signing. So it needs a home between "typed" and "filed".
--
-- ── WHY ITS OWN TABLE, AND NOT THE DRAFT ────────────────────────────────────────────────────────
-- `application_drafts.payload` is plain jsonb in a prunable table, and `applicationDraftSaveSchema`
-- refuses an `ssn` key in it on purpose (D-APP3). That rule stays. This table holds what 0220 holds
-- on the filed row, in the same two shapes: the last four in the clear, the whole number only as a
-- secretBox v1 envelope (AES-256-GCM, bound to org + purpose `driver_ssn`). `ssn_sealed` is NULLABLE
-- for 0220's reason: a deploy without the secret box configured keeps the last four and nothing more.
-- Neither value is ever logged, audited by value, or placed in a `meta` blob.
--
-- One row per invitation, keyed by it, removed with it (`on delete cascade`, so `purge_applicant`
-- needs no change). RLS on, no client policy: only the api reads it, and Q-AM17's rule — the full
-- number for the holders of the "See the full SSN" permission, the last four for everyone else — is
-- the api's to apply, as every other office read is.
--
-- ── WHY A FUNCTION IS THE ONE WRITER ────────────────────────────────────────────────────────────
-- `record_applicant_ssn` writes it (UPDATE first, INSERT only if absent — lint:upserts) and refuses
-- what must never land: an invitation of another org or driver (SN001), a revoked one (SN002), and a
-- filed one (SN003). After filing the number lives on `driver_applications` and the
-- pre-signing row is the API's to delete, in the same request that files it. The office's own window
-- (until the driver's first packet mark, F3 E7) is checked by the api, as it is for every other door.
--
-- ── WHY IT CAN MERGE ALONE ──────────────────────────────────────────────────────────────────────
-- A new table, read and written by nothing until the next merge (new tables are exempt from
-- `lint:migration-ordering`; MIGRATION-DISCIPLINE.md §the-deploy-window).
create table if not exists public.application_ssns (
  invitation_id uuid primary key references public.application_invitations(id) on delete cascade,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  ssn_last4     text not null constraint application_ssns_last4_check check (ssn_last4 ~ '^[0-9]{4}$'),
  ssn_sealed    text,
  -- Who typed the value now held: the driver on the form, or the office replacing it (Q-AM17).
  entered_by    text not null constraint application_ssns_entered_by_check check (entered_by in ('applicant', 'office')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_application_ssns_org on public.application_ssns (org_id);

alter table public.application_ssns enable row level security;

comment on table public.application_ssns is
  'Q-AM3/Q-AM17 (0589): the applicant''s SSN between the form and filing — last four in the clear, the whole number only sealed (secretBox v1, purpose driver_ssn; NULL when the box is not configured, 0220''s rule). One row per invitation; written only by record_applicant_ssn; deleted by the api when the application is filed (the number then lives on driver_applications). No client policy.';

create or replace function public.record_applicant_ssn(
  p_org        uuid,
  p_invitation uuid,
  p_driver     uuid,
  p_last4      text,
  p_sealed     text,
  p_entered_by text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revoked   timestamptz;
  v_submitted timestamptz;
  v_found     boolean := false;
begin
  select true, revoked_at, submitted_at
    into v_found, v_revoked, v_submitted
    from public.application_invitations
   where id = p_invitation and org_id = p_org and driver_id = p_driver
   for update;

  if not coalesce(v_found, false) then
    raise exception 'application_invitation_not_found' using errcode = 'SN001';
  end if;
  if v_revoked is not null then
    raise exception 'application_invitation_unusable' using errcode = 'SN002';
  end if;
  if v_submitted is not null then
    raise exception 'application_already_submitted' using errcode = 'SN003';
  end if;

  update public.application_ssns
     set ssn_last4 = p_last4, ssn_sealed = p_sealed, entered_by = p_entered_by, updated_at = now()
   where invitation_id = p_invitation and org_id = p_org;
  if not found then
    insert into public.application_ssns (invitation_id, org_id, ssn_last4, ssn_sealed, entered_by)
    values (p_invitation, p_org, p_last4, p_sealed, p_entered_by);
  end if;
end;
$$;

revoke all on function public.record_applicant_ssn(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_applicant_ssn(uuid, uuid, uuid, text, text, text) to service_role;

comment on function public.record_applicant_ssn(uuid, uuid, uuid, text, text, text) is
  'Q-AM3/Q-AM17 (0589): the one writer of application_ssns. Writes (UPDATE, else INSERT) the last four, the sealed number and who entered it. Refuses SN001 not found (other org or driver), SN002 revoked, SN003 filed. The office''s window (until the first packet mark) is the api''s check.';
