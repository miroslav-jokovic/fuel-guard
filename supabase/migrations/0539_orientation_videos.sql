-- 0539 — orientation videos, first version: the carrier's list of links, and the applicant's "I watched
-- these" (HIRING-WORKFLOW-AUDIT-2026-10-31 §3.7, §4.8, §8.2 last bullet, §5 HW8a). The reader is HW8a's
-- second PR: Settings → Recruiting's list, the step's "Send the videos", the applicant's page, the fold.
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- `orientation_videos` is a checklist step with `evidence: null` (`hiringSteps.ts`) and a drawer whose
-- body is "unbuilt". Q-HM3 ruled the videos go to an APPLICANT before they travel — that is what buys
-- the half-day orientation (Q-HM7) — and nothing records a video, a send, or a watch. §8.2 sets the size
-- of the first version: "a link list and an attestation tick". Watched-to-the-end needs a player we
-- host; that is `DRIVER-TRAINING-PLAN.md`'s micro-LMS (D1–D7), still the later version, and these
-- tables are shaped so it can grow out of them rather than beside them.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
-- · `orientation_videos` — the carrier's list (Settings → Recruiting): title, a LINK (no hosted player,
--   §8.2), minutes, required yes/no, position. **Retired, never deleted** (OV010): a driver's
--   attestation names the videos it covered, and a list that could lose a row would leave that
--   statement pointing at nothing. **The link never changes** (OV011): a different link is a different
--   video — retire this one and add that one — because "watched it" is a statement about what was at
--   the link the applicant was shown, and an edited URL would silently move it. Title, minutes,
--   required and position are the office's to edit; retiring is one-way (OV012).
-- · `orientation_video_attestations` — one row per "I watched these" tick: the driver, the invitation
--   it came through, WHICH videos (`video_ids`), a snapshot of each (title, link, minutes, required)
--   taken by the insert trigger from the list itself — never from the request — the name the
--   applicant typed, the time, and the request's ip and user agent (D-APP's forensic context, as every
--   applicant-link act records). Append-only (OV020/OV021): a later tick covering a video added since
--   is a new row, never an edit of the old one.
-- · `orientation_video_opens` — the applicant pressed a video's link on OUR page. It records exactly
--   that and nothing more: that a link was opened from the list, not that anything was watched (the
--   reader's words say "Opened", never "Watched"). It is the one thing the brief's "when the link was
--   opened" can record honestly without a player. Append-only (OV030/OV031).
-- · `application_invitations.orientation_videos_sent_at` — the last time the office sent the videos
--   link on this invitation. The fold reads it as "sent, not returned" (in flight), the way
--   `signing_opened_at` is read for the packet; without it the step could not tell "nobody sent them"
--   (the office's move) from "sent, waiting on the driver" (theirs) — D-HUI4's whole distinction.
-- · `recruiting_settings.videos_block_hire` (default false) — §9 P12's deferred switch (0536 header:
--   "they come with HW8's evidence tables"). It ships here, in the schema half, so its reader can follow
--   in the next merge (`lint:migration-ordering`). Q-WF6 as assumed: off.
-- · `sms_outbox.reason` gains `orientation_videos` — the "Send the videos" text. Widened one merge
--   before its writer, 0504's discipline: in a release the new code may meet a database that has not
--   migrated, and a reason the CHECK refuses would fail the insert. Mirrors `SMS_TEMPLATES`.
--
-- ── WHY THE ATTESTATION IS ITS OWN TABLE, NOT A `qualification_records` KIND ────────────────────
-- §4.8: the step is done when EVERY REQUIRED video is attested. That is a set question — which
-- videos, against which list — and it must re-open when the carrier adds a required video after the
-- driver's tick (they have not watched it). So the evidence has to name its videos in a column the
-- fold can read and the trigger can check against this carrier's list. A `qualification_records` row
-- would carry them in `detail` jsonb, where nothing checks they exist, belong to this carrier, or are
-- not retired.
-- And `qualification_records` is the driver qualification FILE: its kinds are §391.51 items read by
-- `dqCatalogue.ts`, the binder and the three RESTRICTIVE policies, written by the office with a
-- document behind each row. Orientation videos are carrier training, not a §391.51 item — the same
-- reason ORIENTATION-PLAN Q-OR2 keeps even the `orientation` kind out of the DQ catalogue — and this
-- statement is made by the applicant on their link with no document behind it. Putting it in the DQ
-- file would make the binder print a self-statement among the carrier's verified records.
-- The office's in-person orientation (Q-OR2 (a), 0373's `orientation` kind) is unchanged: that is
-- HW8b, a signed page 24 filed as a qualification record. This is not that, and does not replace it.
-- `DRIVER-TRAINING-PLAN.md` §10 puts its attestation (typed name, timestamp, ip, ua) on its own attempt
-- row too — this table is that row's first, smaller form.
--
-- ── EVIDENCE, SO APPEND-ONLY — AND STILL PURGED WITH A NEVER-HIRED APPLICANT ──────────────────
-- Both driver tables follow 0535 `applicant_notes`' guard: never edited, never deleted, except that the
-- roster merge may move `driver_id` inside the carrier and the applicant purge (`purge_applicant`,
-- redefined below from 0538's body) deletes them with the person. `driver_id … on delete restrict` and
-- listed in `DRIVER_REASSIGNMENTS` (this PR) — the merge-driver cascade trap: a merge that forgot them
-- would stop on the final `delete from drivers` instead of losing them.
--
-- RLS on, no client policies — deny-all from a browser; the api is the one door (the office's routes
-- and the applicant's token routes), and every service query filters on `org_id` itself.
--
-- cross-module-waiver: the applicant purge (`purge_applicant`, recruiting's) is redefined whole to add
-- these two tables, and its body already deletes from evidence's, psp's and roster's tables as one
-- audited act (0380, 0387, 0535, 0538); nothing about those deletes changes here.
--
-- raw-access-waiver: `purge_applicant` is copied whole from 0538 and has always deleted the applicant's
-- `psp_requests` rows itself — the purge is the one audited act that removes everything they wrote.
--
-- ⚠ DEPLOY WINDOW: three new tables (no old reader can trip over them) and two added columns, each
-- nullable or defaulted, that no code names until the next merge. The one code change in the same PR
-- is the merge list, which updates the two driver tables; a merge run in the minutes between the code
-- deploying and `migrate-staging` applying this would fail loudly on a missing table.

-- ── the carrier's list ─────────────────────────────────────────────────────────────────────────
create table if not exists public.orientation_videos (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  title       text not null check (length(btrim(title)) between 1 and 200),
  -- A link the applicant's phone opens. https only: an http link would show a browser warning to a
  -- driver who cannot tell it from a phishing page, and the page we send is https.
  url         text not null check (url ~* '^https://[^[:space:]]+$' and length(url) <= 2000),
  minutes     integer check (minutes between 1 and 600),
  required    boolean not null default true,
  position    integer not null default 0 check (position between 0 and 1000),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  retired_at  timestamptz,
  retired_by  uuid references auth.users(id) on delete set null
);

alter table public.orientation_videos enable row level security;

create index if not exists ix_orientation_videos_org
  on public.orientation_videos (org_id, position, created_at) where retired_at is null;

comment on table public.orientation_videos is
  'HW8a (0539): the carrier''s orientation videos, as links (no hosted player). Retired, never deleted (OV010); the link never changes (OV011) — a different link is a different video; retiring is one-way (OV012). Service-role only (RLS, no policies).';

create or replace function public.guard_orientation_videos()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'orientation_videos are never deleted — retire the video instead' using errcode = 'OV010';
  end if;
  if new.id <> old.id or new.org_id <> old.org_id or new.url <> old.url
     or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'an orientation video''s link never changes — retire it and add the new link' using errcode = 'OV011';
  end if;
  if old.retired_at is not null
     and (new.retired_at is distinct from old.retired_at or new.retired_by is distinct from old.retired_by) then
    raise exception 'orientation_video_already_retired' using errcode = 'OV012';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_orientation_videos on public.orientation_videos;
create trigger trg_guard_orientation_videos
  before update or delete on public.orientation_videos
  for each row execute function public.guard_orientation_videos();

-- ── the applicant's "I watched these" ──────────────────────────────────────────────────────────
create table if not exists public.orientation_video_attestations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  driver_id     uuid not null references public.drivers(id) on delete restrict,
  invitation_id uuid not null references public.application_invitations(id) on delete restrict,
  video_ids     uuid[] not null check (cardinality(video_ids) between 1 and 100),
  -- [{id, title, url, minutes, required}] — written by the insert trigger from the list, never by the caller.
  videos        jsonb not null default '[]'::jsonb,
  signer_name   text not null check (length(btrim(signer_name)) between 1 and 200),
  attested_at   timestamptz not null default now(),
  ip            text,
  user_agent    text
);

alter table public.orientation_video_attestations enable row level security;

create index if not exists ix_orientation_video_attestations_driver
  on public.orientation_video_attestations (org_id, driver_id, attested_at desc);
create index if not exists ix_orientation_video_attestations_invitation
  on public.orientation_video_attestations (invitation_id);

comment on table public.orientation_video_attestations is
  'HW8a (0539): the applicant''s "I watched these" — which videos (checked against the carrier''s live list, snapshotted by the trigger), the typed name, the time. Append-only (OV020/OV021) except the roster merge''s driver_id; deleted only by purge_applicant. Not a qualification_records kind: carrier training, a self-statement, not a §391.51 item. Service-role only (RLS, no policies).';

create or replace function public.guard_orientation_video_attestations_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_found integer;
begin
  if not exists (select 1 from public.drivers d where d.id = new.driver_id and d.org_id = new.org_id) then
    raise exception 'orientation_video_driver_not_in_org' using errcode = 'OV022';
  end if;
  if not exists (select 1 from public.application_invitations i
                  where i.id = new.invitation_id and i.org_id = new.org_id and i.driver_id = new.driver_id) then
    raise exception 'orientation_video_invitation_not_this_applicants' using errcode = 'OV023';
  end if;
  -- Every named video is this carrier's and live, named once. A retired video cannot be newly
  -- attested: the applicant was not shown it.
  -- An empty list is refused here rather than by the column's CHECK, which runs after this trigger and
  -- would meet a null snapshot first.
  if coalesce(cardinality(new.video_ids), 0) = 0 then
    raise exception 'orientation_video_not_on_the_list' using errcode = 'OV024';
  end if;
  select count(*), jsonb_agg(jsonb_build_object('id', v.id, 'title', v.title, 'url', v.url,
                                                'minutes', v.minutes, 'required', v.required)
                             order by v.position, v.created_at)
    into v_found, v_snapshot
    from public.orientation_videos v
   where v.org_id = new.org_id and v.retired_at is null and v.id = any (new.video_ids);
  -- One count covers all three: a list row matches an id once however often it is named, so a repeat,
  -- a retired video and another carrier's each leave the count short of the array's length.
  if v_found <> cardinality(new.video_ids) then
    raise exception 'orientation_video_not_on_the_list' using errcode = 'OV024';
  end if;
  new.videos := v_snapshot;
  new.attested_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_orientation_video_attestations_insert on public.orientation_video_attestations;
create trigger trg_guard_orientation_video_attestations_insert
  before insert on public.orientation_video_attestations
  for each row execute function public.guard_orientation_video_attestations_insert();

create or replace function public.guard_orientation_video_attestations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public.purging_applicant(old.driver_id) then
      return old;
    end if;
    raise exception 'orientation_video_attestations are never deleted' using errcode = 'OV020';
  end if;
  if new.id <> old.id or new.org_id <> old.org_id or new.invitation_id <> old.invitation_id
     or new.video_ids <> old.video_ids or new.videos <> old.videos or new.signer_name <> old.signer_name
     or new.attested_at <> old.attested_at or new.ip is distinct from old.ip
     or new.user_agent is distinct from old.user_agent then
    raise exception 'orientation_video_attestations are never edited' using errcode = 'OV021';
  end if;
  -- The roster merge moves an attestation to the canonical driver; it must stay in the same carrier.
  if new.driver_id <> old.driver_id
     and not exists (select 1 from public.drivers d where d.id = new.driver_id and d.org_id = new.org_id) then
    raise exception 'orientation_video_driver_not_in_org' using errcode = 'OV022';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_orientation_video_attestations on public.orientation_video_attestations;
create trigger trg_guard_orientation_video_attestations
  before update or delete on public.orientation_video_attestations
  for each row execute function public.guard_orientation_video_attestations();

-- ── a link opened from the list ────────────────────────────────────────────────────────────────
create table if not exists public.orientation_video_opens (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  driver_id     uuid not null references public.drivers(id) on delete restrict,
  invitation_id uuid not null references public.application_invitations(id) on delete restrict,
  video_id      uuid not null references public.orientation_videos(id) on delete restrict,
  opened_at     timestamptz not null default now()
);

alter table public.orientation_video_opens enable row level security;

create index if not exists ix_orientation_video_opens_driver
  on public.orientation_video_opens (org_id, driver_id, video_id, opened_at desc);
create index if not exists ix_orientation_video_opens_invitation
  on public.orientation_video_opens (invitation_id);

comment on table public.orientation_video_opens is
  'HW8a (0539): the applicant pressed a video''s link on the list page — that a link was opened, never that it was watched. Append-only (OV030/OV031) except the roster merge''s driver_id; deleted only by purge_applicant. Service-role only (RLS, no policies).';

create or replace function public.guard_orientation_video_opens_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.drivers d where d.id = new.driver_id and d.org_id = new.org_id) then
    raise exception 'orientation_video_driver_not_in_org' using errcode = 'OV022';
  end if;
  if not exists (select 1 from public.application_invitations i
                  where i.id = new.invitation_id and i.org_id = new.org_id and i.driver_id = new.driver_id) then
    raise exception 'orientation_video_invitation_not_this_applicants' using errcode = 'OV023';
  end if;
  if not exists (select 1 from public.orientation_videos v
                  where v.id = new.video_id and v.org_id = new.org_id and v.retired_at is null) then
    raise exception 'orientation_video_not_on_the_list' using errcode = 'OV024';
  end if;
  new.opened_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_orientation_video_opens_insert on public.orientation_video_opens;
create trigger trg_guard_orientation_video_opens_insert
  before insert on public.orientation_video_opens
  for each row execute function public.guard_orientation_video_opens_insert();

create or replace function public.guard_orientation_video_opens()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public.purging_applicant(old.driver_id) then
      return old;
    end if;
    raise exception 'orientation_video_opens are never deleted' using errcode = 'OV030';
  end if;
  if new.id <> old.id or new.org_id <> old.org_id or new.invitation_id <> old.invitation_id
     or new.video_id <> old.video_id or new.opened_at <> old.opened_at then
    raise exception 'orientation_video_opens are never edited' using errcode = 'OV031';
  end if;
  if new.driver_id <> old.driver_id
     and not exists (select 1 from public.drivers d where d.id = new.driver_id and d.org_id = new.org_id) then
    raise exception 'orientation_video_driver_not_in_org' using errcode = 'OV022';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_orientation_video_opens on public.orientation_video_opens;
create trigger trg_guard_orientation_video_opens
  before update or delete on public.orientation_video_opens
  for each row execute function public.guard_orientation_video_opens();

-- ── the send, the switch, the text's reason ────────────────────────────────────────────────────
alter table public.application_invitations
  add column if not exists orientation_videos_sent_at timestamptz;

comment on column public.application_invitations.orientation_videos_sent_at is
  'HW8a (0539): the last time the office sent the orientation videos link on this invitation. The checklist reads it as the step in flight (sent, not attested). Null = never sent.';

alter table public.recruiting_settings
  add column if not exists videos_block_hire boolean not null default false;

comment on column public.recruiting_settings.videos_block_hire is
  'HW8a (0539; §9 P12''s deferred switch): when true, the hire refuses until every required orientation video is attested. Default false (Q-WF6). With no required video on the list the switch has nothing to wait for and the reader says so.';

alter table public.sms_outbox drop constraint if exists sms_outbox_reason_check;
alter table public.sms_outbox add constraint sms_outbox_reason_check
  check (reason in ('nudge', 'application_sent', 'signing_link', 'drug_test_site', 'consent_confirm', 'invite',
                    'orientation_videos', 'other'));

-- ── the applicant purge removes both driver tables too ─────────────────────────────────────────
-- 0538's body with `orientation_video_attestations` and `orientation_video_opens` added to PA011's owned
-- list and deleted before the invitations they point at and the driver.
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
    'orientation_video_opens'];
  v_driver record;
  v_invitations uuid[];
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
  'Q-AW40: deletes an applicant who was never hired, and every row their application wrote, as one audited service-role act (the api writes driver.purged). Refuses PA010 ever hired (status, hire/termination date, or a compliance.applicant_hired audit row), PA011 rows in any drivers-referencing table it does not own or a DQ export naming them, PA012 a driver-app account or McLeod/Samsara/EFS id, PA020 not in this org, PA030 actor not an admin. Opens the seven delete guards for THIS driver only, through fuelguard.purging_applicant (transaction-local); 0387 added application_packet_countersignatures; 0535 applicant_notes; 0538 driver_employment_gaps; 0539 orientation_video_attestations and orientation_video_opens. Returns {counts, storage}: the Storage paths the api must remove.';

revoke all on function public.purge_applicant(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.purge_applicant(uuid, uuid, uuid) to service_role;
