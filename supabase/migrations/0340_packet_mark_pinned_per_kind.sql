-- 0340 — the adopted mark is pinned per KIND, not per link (Q-PKT8, D-PKT6, APPLICATION-PACKET-PLAN).
--
-- ── WHAT 0339 GOT WRONG, AND HOW IT WAS FOUND ─────────────────────────────────────────────────
-- 0339 pins the adopted mark with `select signed_name … where invitation_id = … limit 1`: the first
-- row on a link fixes the name, and any later stop arriving with a different one is refused (DR035).
-- That is exactly right for the owner's model — *"driver can draw or type name once"* — and it is
-- wrong about how many marks that model has.
--
-- D-PKT6 has always said there are TWO adopted marks, and `adoptedMarkKinds()` returns two:
--
--   *"Initials are a SECOND adopted mark and not an abbreviation of the first. The packet treats
--   them as a distinct thing — three pages take initials and nothing else — and a ceremony that
--   derived them from the typed name would be inventing a mark the signer never made."*
--
-- `p05`, `p06` and `p09` are `mark: 'initials'`. Under 0339 a client that correctly sent `MV` at p05
-- after `Marija Varmeda` at p03 is **refused at the third stop** with DR035 — the pin cannot tell
-- "this driver is signing under a second name" from "this is the other mark they adopted". The
-- ceremony that shipped in #783 only works because it sends the full name at all twenty-two stops,
-- so the three narrowest lines in the packet (89–141pt) get a full name drawn on them.
--
-- Found on 2026-09-14 by the overlay (#788), which draws `signed_name` onto the line and had to be
-- handed something for three placements whose kind said initials. Nothing had exercised it before:
-- production holds zero packet marks.
--
-- ── THE SHAPE, AND WHAT WAS REJECTED ──────────────────────────────────────────────────────────
-- The pin becomes per `(invitation_id, mark)`. One line of the RPC; no table change, no new column,
-- no backfill — `mark` is already on every row because §390.32(d) asks that a filed record reproduce
-- what was signed, so the fact the pin now reads was written down from the first migration.
--
-- ⚠ Rejected: an `adopted_marks` table, or two columns on `application_invitations`. Both make the
-- adoption a thing the database holds separately from the marks, and then the marks can disagree with
-- it. The pin works precisely because it reads the evidence rather than a summary of the evidence:
-- whatever the first `signature` row says IS the adopted signature, and there is no second copy to
-- drift. Same reasoning as `packetDriverMarkCount()` being a count rather than a
-- `packet_signing_completed_at` stamp (0339's header).
--
-- ⚠ Rejected: relaxing DR035 to a warning, or dropping it. It is the enforcement of "adopted once"
-- (D-PKT13 says so in as many words: *"'Once' is enforced by `record_packet_mark`, not by the UI"*).
-- A packet that came out carrying two different signatures on pages meant to carry one person's is
-- the failure this refusal exists for; it should refuse a second SIGNATURE just as hard as before,
-- and it still does.
--
-- ── WHY THE FIRST READER DOES NOT SHIP WITH THIS ──────────────────────────────────────────────
-- `lint:migration-ordering` cannot see functions, so this one is held by hand: the walk that sends
-- initials at an initials stop is a separate merge, after this is applied. Today's client sends one
-- name everywhere and is unaffected either way — under this function a link's `signature` rows and
-- its `initials` rows would simply both pin to the same string, which is what they do now.
-- `docs/MIGRATION-DISCIPLINE.md` §the-deploy-window is why: a merge is SERVED ~2m44s before its
-- migration is APPLIED, and a client shipped alongside this one would spend that window being
-- refused at p05 on four live invitation links.
--
-- Everything else about the function is 0339's, unchanged, and is re-stated here because
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
  v_adopted   text;
  v_id        uuid;
  v_signed    int;
begin
  -- FOR UPDATE: "the twenty-second one completes the packet" is only true if the count below cannot
  -- interleave with another stop being filed on the same link.
  select expires_at, revoked_at, approved_at, submitted_at
    into v_expires, v_revoked, v_approved, v_submitted
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
  'P5: file one of the driver''s marks on the carrier''s packet, and report whether that was the last of them. Refuses an unknown invitation (DR030), a revoked or expired one (DR031), a packet the office has not approved yet (DR032), one already filed (DR033), a stop already marked on this link (DR034), and a mark whose name differs from the one adopted first FOR THAT KIND (DR035) — signatures and initials are two adopted marks (0340, D-PKT6).';
