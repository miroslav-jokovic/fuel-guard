-- 0339 — the driver's twenty-two marks on the carrier's packet (APPLICATION-PACKET-PLAN P5, D-PKT6).
--
-- ── WHAT THIS IS FOR ───────────────────────────────────────────────────────────────────────────
-- The owner's sentence, 2026-09-14: *"we review it as this PDF form, and resend it to the driver for
-- signing — the driver needs to be navigated precisely from place to place and sign all places.
-- Similar to DocuSign."* `packetPlacements.ts` is the measured inventory of those places: twenty-two
-- are the driver's, across nineteen pages, and six more belong to the carrier or to a witness. This
-- table is where the driver's twenty-two land.
--
-- ── WHY NOT `driver_authorizations` ────────────────────────────────────────────────────────────
-- That table holds five legal BASES for screening — PSP, FCRA, previous employer, Clearinghouse,
-- drug and alcohol — each one an instrument carrying its own disclosure text and its own version,
-- and its `purpose` check constraint is that vocabulary. A packet mark is a PLACE on paper. Six of
-- the twenty-two sit on pages whose instrument the applicant already signed on their phone, and
-- adding twenty-two members to a column of legal bases would put "page 19, the second one" beside
-- "§382.701(a) full query" as though they were the same kind of fact.
--
-- ── WHY IT CARRIES NO `driver_id` ──────────────────────────────────────────────────────────────
-- 0337's reasoning, and it applies harder here: a mark belongs to the SESSION. A rehire's second
-- application is a second invitation with its own packet, and its signatures must not merge with the
-- first — the packet a driver signed in 2025 is not the packet they are signing now, and the whole
-- point of storing the page and the sentence beside each mark is that the two may differ. Reaching
-- the driver is one join through `application_invitations`; conflating two packets is not
-- recoverable. ⚠ It also keeps this table off `merge_driver`'s list of things to carry, which is a
-- list nothing checks (0234 is where the ones that do belong live).
--
-- ── WHY THE PAGE, THE ANCHOR AND THE SENTENCE ARE COPIED IN ────────────────────────────────────
-- `placement_id` alone would be a pointer into a constant that gets re-measured. It already has
-- been: p17 joined the inventory on 2026-09-14 (D-PKT12) and p24 left it on 2026-08-23 (D-PKT10),
-- and counsel may yet rule that page 19's duplicated signature line is one line rather than two.
-- §390.32(d) asks that a filed electronic record stay reproducible, so each row keeps its own copy
-- of what the signer was standing on and what they were told they were agreeing to — 0215's
-- `disclosure_text` decision, for the same reason and with the same consequence: this table can
-- answer "what did they sign" without loading any of today's code.
--
-- ── APPEND-ONLY ────────────────────────────────────────────────────────────────────────────────
-- Evidence, so the CLAUDE.md rule applies: no update policy, no delete policy, corrections are new
-- rows. There is no such thing as un-signing a page; a driver who disowns a mark is a disposition,
-- and `driver_applications` already refuses DELETE for the same reason (0220).

create table if not exists public.application_packet_marks (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  invitation_id uuid not null references public.application_invitations(id) on delete cascade,
  -- The stop, as `PACKET_PLACEMENTS` names it: `p03`, `p11a`, `p19b`. ⚠ Deliberately NOT constrained
  -- to a list here. The inventory is a measurement of somebody else's paper and has changed twice
  -- already; a CHECK would mean a migration every time the carrier's document is re-read, and the
  -- server validates against `driverPlacementIds()` before the insert is attempted.
  placement_id  text not null,
  -- The carrier's own page number, from its footer, as the inventory had it when this was signed.
  page          int  not null,
  mark          text not null check (mark in ('signature', 'initials')),
  -- The line on the page, verbatim from the workbook — `Driver signature: | Date:`, and on three
  -- pages `Driver signatrure`, which is how the carrier spells it.
  anchor        text not null,
  -- The one sentence the driver was shown at this stop, as they were shown it.
  affirmed      text not null,
  -- ── ESIGN / UETA evidence, the same four fields 0215 records ──────────────────────────────────
  signed_name   text not null,
  signed_at     timestamptz not null default now(),
  signed_ip     inet,
  signed_user_agent text,
  created_at    timestamptz not null default now()
);

-- One mark per stop per link. The database half of "the ceremony cannot walk you somewhere twice":
-- a double-tap, a replayed request and a second browser tab all meet it here rather than in the UI.
create unique index if not exists uq_application_packet_marks_stop
  on public.application_packet_marks (invitation_id, placement_id);

-- The read the ceremony makes on every load: which stops this link has already collected, in the
-- packet's own page order, so a resumed session opens on the next one rather than on the first.
create index if not exists ix_application_packet_marks_invitation
  on public.application_packet_marks (org_id, invitation_id, page);

-- The service role bypasses RLS and every read carries its own org filter. No client policies, so
-- this is deny-all from a browser on purpose: the applicant reaches it only through their token, and
-- the office reads it through the API.
alter table public.application_packet_marks enable row level security;

comment on table public.application_packet_marks is
  'Append-only. One row per place on the carrier''s packet where the driver applied their adopted mark (P5, D-PKT6). Keyed on the invitation rather than the driver: a rehire signs a second packet, and the two must not merge.';

comment on column public.application_packet_marks.placement_id is
  'The stop, as `packages/shared/src/packetPlacements.ts` names it — p03, p11a, p19b. Not CHECK-constrained: the inventory measures the carrier''s paper and has been corrected twice, and the server validates against `driverPlacementIds()`.';

comment on column public.application_packet_marks.anchor is
  'The signature line this mark sits on, verbatim from the workbook — including `Driver signatrure`, which is how the carrier''s own pages 22, 23 and 24 spell it.';

comment on column public.application_packet_marks.affirmed is
  'The sentence the driver was shown at this stop, as they were shown it. Copied in rather than looked up, so §390.32(d) reproduction does not depend on today''s constant (0215''s `disclosure_text` rule).';

-- ── FILING ONE MARK ────────────────────────────────────────────────────────────────────────────
-- `record_driver_release` (0228) is the model, and the differences are the interesting part.
--
-- ⚠ **It closes no phase and stamps no column.** The releases stamp `releases_completed_at` because
-- the ceremony's end is a gate the rest of the flow reads. The packet's end is a COUNT against
-- `driverPlacements().length`, passed in as `p_expected_count` the way the releases pass theirs —
-- so there is no second place the number twenty-two lives, and counsel ruling on page 19's duplicate
-- moves one array rather than an array and a column that has to agree with it.
--
-- ⚠ **It refuses before `approved_at` and after `submitted_at`, and that window is the whole point.**
-- A packet signed before the office has corrected the employment history is a packet signed over
-- answers that are about to change — which is exactly the reversal D-AX11 made when it split the
-- signing (0336): *"a certification of answers the office has since corrected certifies something
-- else."* Six of these twenty-two stops are certifications in those words.
--
-- ⚠ **And it pins the adopted name.** The owner's model is one mark applied at every place. The
-- first row on a link fixes `signed_name`; a later stop arriving with a different one is refused
-- rather than filed, so a packet cannot come out carrying two different signatures on pages that
-- were meant to carry one person's.
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

  -- The adopted mark, from whichever stop was signed first on this link.
  select signed_name into v_adopted
    from public.application_packet_marks
   where invitation_id = p_invitation and org_id = p_org
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

revoke all on function public.record_packet_mark(uuid, uuid, text, int, text, text, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.record_packet_mark(uuid, uuid, text, int, text, text, text, text, text, text, int) to service_role;

comment on function public.record_packet_mark(uuid, uuid, text, int, text, text, text, text, text, text, int) is
  'P5: file one of the driver''s marks on the carrier''s packet, and report whether that was the last of them. Refuses an unknown invitation (DR030), a revoked or expired one (DR031), a packet the office has not approved yet (DR032), one already filed (DR033), a stop already marked on this link (DR034), and a mark whose name differs from the one adopted first (DR035).';
