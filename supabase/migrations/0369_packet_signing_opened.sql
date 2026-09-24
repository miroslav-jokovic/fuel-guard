-- 0369 — the packet opens for signing only when the office opens it, in person
-- (APPLICANT-FLOW-PLAN AF5, D-AF3, D-AF6).
--
-- ── WHAT CHANGES ───────────────────────────────────────────────────────────────────────────────
-- Until now approval WAS the signing gate: `record_packet_mark` refused only `approved_at is null`
-- (DR032, 0339), and approval emailed the applicant a sign link (`applicationApprovalNotice.ts`). The
-- owner's order moves signing to the office: *"then we buy him a ticket to come to the office → in
-- the office: road test and in-office orientation → after that we give him the application to sign"*
-- (§1.1). D-AF3: the packet opens only when the office opens it, and D-AF6: the office pressing the
-- button in the office IS the in-person act — no software can check who is standing at the desk.
--
-- So two things, and nothing else:
--   · `record_packet_mark` refuses a mark while `signing_opened_at is null` (new errcode DR036;
--     DR010–DR035 are taken, measured across every migration on 2026-09-24).
--   · `open_packet_signing` is the one writer of `signing_opened_at` (a column since 0365).
--
-- ── WHY THIS MERGES ALONE ──────────────────────────────────────────────────────────────────────
-- `lint:migration-ordering` cannot see functions (0340's header), so the rule is held by hand: the
-- route that calls `open_packet_signing` is a later merge. A merge is SERVED ~2m44s before its
-- migration is APPLIED (docs/MIGRATION-DISCIPLINE.md §the-deploy-window); shipped together, the
-- office's Open signing button would call a function that does not exist yet.
--
-- ⚠ The window this opens, stated because it is real: from the moment this applies until the
-- TypeScript that can call `open_packet_signing` is served, NO packet can be marked by anybody.
-- Production has exactly one approved, unfiled invitation (APPLICANT-FLOW-PLAN §2.13 row 4, the
-- 2026-09-17 QA walk with 20 marks), and under D-AF3 it is re-opened by the office anyway. The window
-- therefore affects nobody. The old TypeScript meets DR036 as an unmapped error — a 500 for a walk
-- nobody is taking.
--
-- ⚠ Order of the refusals: DR036 sits AFTER DR032 and DR033, so an unapproved packet still says it
-- is unapproved and a filed one still says it is filed. Production's filed row (§2.13 row 3) was
-- never opened and never will be; it must keep answering DR033, not DR036.
--
-- Everything else in `record_packet_mark` is 0340's, unchanged, re-stated because
-- `create or replace function` has no other form.

create or replace function public.record_packet_mark(
  p_org uuid,
  p_invitation uuid,
  p_placement text,
  p_page int,
  p_mark text,
  p_anchor text,
  p_affirmed text,
  p_signed_name text,
  p_ip text,
  p_user_agent text,
  p_expected_count int
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
  -- FOR UPDATE: "the twenty-second one completes the packet" is only true if the count below cannot
  -- interleave with another stop being filed on the same link.
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
  -- D-AF3: approval is necessary and no longer sufficient. The office opens signing in person.
  if v_opened is null then
    raise exception 'packet_not_opened' using errcode = 'DR036';
  end if;

  -- ⚠ The adopted mark OF THIS KIND, from whichever stop of that kind was signed first on this link.
  -- `and mark = p_mark` is the whole of 0340: without it the driver's initials are read as a second
  -- signature and refused (Q-PKT8). The driver still adopts each kind exactly once — a second
  -- signature is refused by the `signature` rows and a second set of initials by the `initials` ones.
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
       signed_name, signed_ip, signed_user_agent)
    values
      (p_org, p_invitation, p_placement, p_page, p_mark, p_anchor, p_affirmed,
       p_signed_name, p_ip::inet, p_user_agent)
    returning id into v_id;
  exception when unique_violation then
    -- The same stop twice on one link: a double-tap, or a second tab. Named, so the ceremony can
    -- move the driver on rather than telling them off for something the database handled correctly.
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

comment on function public.record_packet_mark(uuid, uuid, text, int, text, text, text, text, text, text, int) is
  'P5: file one of the driver''s marks on the carrier''s packet, and report whether that was the last of them. Refuses an unknown invitation (DR030), a revoked or expired one (DR031), a packet the office has not approved yet (DR032), one already filed (DR033), a stop already marked on this link (DR034), a mark whose name differs from the one adopted first FOR THAT KIND (DR035) — signatures and initials are two adopted marks (0340, D-PKT6) — and, since 0369, a packet the office has not opened for signing in person (DR036, D-AF3).';

-- ── OPENING SIGNING (D-AF6, D-AF7) ─────────────────────────────────────────────────────────────
-- The office's act at the desk, after the road test and orientation. Same shape as 0365's
-- `send_application_invitation`, for the same reasons:
--
--   · `sign_token_hash = p_sign_token_hash` — a FRESH sign link on every press. 0345 minted it once,
--     at approval, so the approval email could carry it; approval no longer opens anything (D-AF3),
--     so the link is minted where signing actually begins and handed back on the office's screen.
--     A second press (a closed tab, a lost link) rotates it, and the earlier one stops working.
--   · `signing_opened_at = coalesce(signing_opened_at, now())` — stamped once; the checklist shows
--     the FIRST date.
--   · `expires_at = greatest(…)` — never shortens a link (0232's rule), and revives one that lapsed
--     while the applicant waited on a lab result and a bus ticket. The order this serves is the one
--     that outlives 14 days (§2.8).
--
-- ⚠ Refuses, in 0365's AI0xx range so the office's three acts on an invitation answer alike:
--   AI001  no such invitation for this org
--   AI002  revoked (NOT expired — see above)
--   AI003  already filed: a filed packet is frozen for ever and never signs again
--   AI004  a missing hash or a non-positive extension
--   AI006  not approved (D-AF6: approval is the gate the SQL already enforced; opening keeps it)
-- Everything else D-AF6 lists — the `beforeTravel` federal gates, the road test — is a WARNING,
-- computed by the API from the checklist fold, and refuses nothing here.
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
  v_approved  timestamptz;
  v_opened    timestamptz;
begin
  if nullif(p_sign_token_hash, '') is null or p_extend_days is null or p_extend_days < 1 then
    raise exception 'open_signing_invalid' using errcode = 'AI004';
  end if;

  select true, revoked_at, submitted_at, approved_at
    into v_found, v_revoked, v_submitted, v_approved
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
  if v_approved is null then
    raise exception 'packet_not_yet_approved' using errcode = 'AI006';
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
  'AF5/D-AF3/D-AF6: the office opens packet signing in person. Sets a fresh sign_token_hash, stamps signing_opened_at once, and extends expires_at without ever shortening it — reviving a link that lapsed while the applicant waited to travel. Refuses AI001 not found, AI002 revoked, AI003 filed, AI004 invalid, AI006 not approved. record_packet_mark refuses DR036 until this has run.';
