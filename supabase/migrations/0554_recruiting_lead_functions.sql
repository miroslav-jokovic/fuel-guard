-- 0554 — recruiting's lead functions: store a lead once, say who else it might be, turn it into an
-- applicant, save a hiring profile or an opening as a new version, and read the queue one person per
-- row (ADS-AGENT-BUILD-WORKFLOW.md step D1, first of three merges; tables from 0553).
--
-- ── WHY THESE ARE FUNCTIONS, AND WHY THEY MERGE ALONE ────────────────────────────────────────────
-- Each one is a fact that must hold across rows written in one moment — "the same lead twice is stored
-- once" (`LeadSink.accept`), "version N+1 follows N", "a lead is converted to one applicant once" — and
-- PostgREST cannot span statements. They merge before their caller (D1c, apps/api/src/modules/recruiting/
-- leads/) because `lint:migration-ordering` reads columns, not functions: a caller merged with them would
-- be served for the deploy window against a database that does not have them yet (memory: a function's
-- reader is held behind its migration by hand). Nothing in this merge calls them.
--
-- ── ONE PHONE NORMALISATION, IN TWO LANGUAGES (`phone_e164`) ─────────────────────────────────────
-- A lead's phone is stored in E.164 (0553's CHECK), but `drivers.phone` and `phone_alt` are free text
-- typed by an office ("(708) 236-5732"). Matching one against the other needs the same normalisation
-- `normalisePhone` (packages/shared/src/smsConsentContract.ts) already applies to every inbound STOP:
-- digits only, US-defaulted, an already-E.164 value kept, anything else unknown. SQL cannot import
-- TypeScript, so this is a second copy, and `recruiting-lead-functions.test.mjs` holds the two together
-- over a fixture list by importing the built TypeScript — the same answer to the same problem as
-- `adsSchemaParity.test.ts` (0537). A copy nothing checks would be a workaround; a copy a test pins is a
-- translation.
--
-- ── WHAT A DUPLICATE IS (D-RA7, D-LS5, D-LS10) ───────────────────────────────────────────────────
-- Two different things, kept apart:
--   · the SAME LEAD again (a webhook retried, the hourly backfill re-reading it): same (org, channel,
--     external_ref). Stored once; the second call answers `duplicate` with the first row's id. The stored
--     row is never updated by a repeat — its attribution is frozen (0553, RL013), and a platform's second
--     copy of a lead it already sent carries nothing the first did not.
--   · the SAME PERSON from somewhere else (a Meta lead and an Indeed email; an applicant already on the
--     board; a former driver): matched on E.164 phone or lower-case email only — never on a name, never
--     on anything else (D-LS10, no dossier). Each lead is still stored, because each carries its own
--     attribution and the owner's spend report counts both (D-LS5). `ingest_lead` RETURNS the matches;
--     the queue (below) shows the person once.
--
-- ── CONVERSION: ROSTER CREATES THE APPLICANT, THIS RECORDS IT ────────────────────────────────────
-- `drivers` is roster's table, and an applicant is created through roster's door (`POST /roster/drivers`,
-- which a recruiter may use). So `convert_lead` takes the applicant's id and does not insert a driver:
-- D1c calls roster's exported create, then this. What this guarantees in one transaction: the lead is
-- this carrier's, the driver is this carrier's and still an applicant, a lead becomes one applicant once
-- (a repeat for the same pair is answered, not refused — a retried request), and the lead reads
-- `converted`. If the call fails after roster's create, the applicant exists unconverted; the next
-- `ingest_lead`/queue read lists them as a match for the lead, and the recruiter attaches the lead to
-- them instead of creating a second one.
--
-- ── THE QUEUE: ONE PERSON PER ROW, PAGED ─────────────────────────────────────────────────────────
-- A lead is a queue row unless an EARLIER lead in the same carrier, with one of the asked-for statuses,
-- shares its phone or email; then it rides on that row as `also`. "Earlier" so the row is stable while
-- new leads arrive; "with one of the asked-for statuses" so a person who was `lost` in March and applies
-- again in June is a new row, not hidden behind a closed one. Keyset paging on (received_at, id), newest
-- first: an offset would skip or repeat rows as leads arrive (memory: a cursor into a refetched list).
-- Freshness is the only order here. The plan's "hard requirements met → fewest unknowns → freshness"
-- needs the verdicts D1c writes and is the queue screen's step (E-phase), recorded in the progress log.
-- Two leads where one has only a phone and the other only an email show twice: a Meta lead always has
-- both (`META_CONTACT_TYPES`), and the transitive grouping that would join them is not worth a recursive
-- query until a channel that sends one without the other exists.
--
-- ── VERSIONS ─────────────────────────────────────────────────────────────────────────────────────
-- `save_hiring_profile_version` / `save_opening_version` lock the parent row, so two saves at once get
-- N+1 and N+2, never a unique violation for the second person. A null parent id creates the parent. An
-- opening version must pin a profile version of the same carrier — 0553's composite FK refuses it, and
-- the function says so in words (RL034) rather than a 23503.
--
-- ── THE SQLSTATE REGISTER (RL, continuing 0553) ──────────────────────────────────────────────────
--   RL020  the lead is not this carrier's
--   RL021  the driver is not this carrier's applicant (not found, another carrier's, hired, or archived)
--   RL022  the lead was already converted to a different applicant
--   RL030  the profile or opening is not this carrier's
--   RL031  the profile is archived
--   RL032  a required argument is missing
--   RL034  the opening's profile version is not this carrier's
--
-- cross-module-waiver: `ingest_lead`, `convert_lead` and `recruiting_lead_queue` READ `drivers` (roster's)
-- to answer "is this person already here" and "is this still an applicant". They write nothing of
-- roster's; the applicant itself is created through roster's own exported function (D1c).
--
-- ⚠ DEPLOY WINDOW: six new functions and nothing that calls them. Old code cannot trip over a function it
-- does not name.

-- ── 0. one phone normalisation (normalisePhone's twin; parity pinned by the matrix) ──────────────
create or replace function public.phone_e164(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when length(d) = 10 then '+1' || d
    when length(d) = 11 and left(d, 1) = '1' then '+' || d
    when btrim(coalesce(p_raw, '')) ~ '^\+[1-9][0-9]{7,14}$' then btrim(p_raw)
    else null
  end
  from (select regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g') as d) x;
$$;

-- ── 1. who else this lead might be (phone or email only; D-LS10) ─────────────────────────────────
create or replace function public.recruiting_lead_matches(p_org uuid, p_lead uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with l as (
    select id, phone_e164, email_lower from public.recruiting_leads where id = p_lead and org_id = p_org
  )
  select jsonb_build_object(
    'leads', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'channel', o.channel, 'status', o.status,
                                          'received_at', o.received_at) order by o.received_at, o.id)
        from public.recruiting_leads o, l
       where o.org_id = p_org and o.id <> l.id
         and ((l.phone_e164 is not null and o.phone_e164 = l.phone_e164)
           or (l.email_lower is not null and o.email_lower = l.email_lower))), '[]'::jsonb),
    'drivers', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'status', d.status,
                                          'archived', d.archived_at is not null) order by d.created_at, d.id)
        from public.drivers d, l
       where d.org_id = p_org
         and ((l.phone_e164 is not null
               and (public.phone_e164(d.phone) = l.phone_e164 or public.phone_e164(d.phone_alt) = l.phone_e164))
           or (l.email_lower is not null and lower(btrim(d.email)) = l.email_lower))), '[]'::jsonb))
  from l;
$$;

-- ── 2. store a lead once (LeadSink.accept) ───────────────────────────────────────────────────────
-- `p_lead` carries the projection D1c builds with `leadContract` (phone already E.164, email already
-- lower-case — 0553's CHECKs refuse anything else, loudly). Plain INSERT … ON CONFLICT DO NOTHING on the
-- partial key: never an update, so never a partial upsert (`lint:upserts`'s hazard is a NOT NULL checked
-- before arbitration on an UPDATE path; there is none here).
create or replace function public.ingest_lead(p_org uuid, p_lead jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_stored text := 'new';
begin
  if p_org is null or p_lead is null or nullif(btrim(p_lead ->> 'channel'), '') is null then
    raise exception 'ingest_lead: org and channel are required' using errcode = 'RL032';
  end if;

  insert into public.recruiting_leads (
    org_id, channel, external_ref, source, campaign_ref, opening_id, platform_created_at,
    raw, answers, full_name, phone_e164, email_lower)
  values (
    p_org, p_lead ->> 'channel', p_lead ->> 'external_ref', p_lead ->> 'source', p_lead ->> 'campaign_ref',
    (p_lead ->> 'opening_id')::uuid, (p_lead ->> 'platform_created_at')::timestamptz,
    coalesce(p_lead -> 'raw', '{}'::jsonb), coalesce(p_lead -> 'answers', '{}'::jsonb),
    p_lead ->> 'full_name', p_lead ->> 'phone_e164', p_lead ->> 'email_lower')
  on conflict (org_id, channel, external_ref) where external_ref is not null do nothing
  returning id into v_id;

  if v_id is null then
    v_stored := 'duplicate';
    select id into v_id from public.recruiting_leads
     where org_id = p_org and channel = p_lead ->> 'channel' and external_ref = p_lead ->> 'external_ref';
  end if;

  return jsonb_build_object('lead_id', v_id, 'stored', v_stored,
                            'matches', public.recruiting_lead_matches(p_org, v_id));
end;
$$;

-- ── 3. a lead becomes an applicant (the applicant itself is roster's to create) ──────────────────
create or replace function public.convert_lead(p_org uuid, p_lead uuid, p_driver uuid, p_actor uuid, p_actor_name text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_existing record;
  v_id uuid;
begin
  if p_org is null or p_lead is null or p_driver is null or p_actor is null or nullif(btrim(p_actor_name), '') is null then
    raise exception 'convert_lead: org, lead, driver and actor are all required' using errcode = 'RL032';
  end if;

  -- Locked, so two recruiters converting the same lead at once are answered one after the other.
  perform 1 from public.recruiting_leads where id = p_lead and org_id = p_org for update;
  if not found then
    raise exception 'convert_lead: lead % is not this carrier''s', p_lead using errcode = 'RL020';
  end if;

  select id, driver_id into v_existing from public.lead_conversions where lead_id = p_lead;
  if found then
    if v_existing.driver_id = p_driver then
      return jsonb_build_object('conversion_id', v_existing.id, 'lead_id', p_lead, 'driver_id', p_driver, 'created', false);
    end if;
    raise exception 'convert_lead: lead % was already converted to another applicant', p_lead using errcode = 'RL022';
  end if;

  if not exists (select 1 from public.drivers d
                  where d.id = p_driver and d.org_id = p_org and d.status = 'applicant' and d.archived_at is null) then
    raise exception 'convert_lead: driver % is not an open applicant of this carrier', p_driver using errcode = 'RL021';
  end if;

  insert into public.lead_conversions (org_id, lead_id, driver_id, converted_by, converted_by_name)
  values (p_org, p_lead, p_driver, p_actor, btrim(p_actor_name))
  returning id into v_id;
  update public.recruiting_leads set status = 'converted' where id = p_lead and org_id = p_org;

  return jsonb_build_object('conversion_id', v_id, 'lead_id', p_lead, 'driver_id', p_driver, 'created', true);
end;
$$;

-- ── 4. save a hiring profile as its next version ─────────────────────────────────────────────────
create or replace function public.save_hiring_profile_version(
  p_org uuid, p_profile uuid, p_name text, p_requirements jsonb, p_actor uuid, p_actor_name text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_profile uuid := p_profile;
  v_archived timestamptz;
  v_version integer;
  v_id uuid;
begin
  if p_org is null or nullif(btrim(p_name), '') is null or p_requirements is null
     or p_actor is null or nullif(btrim(p_actor_name), '') is null then
    raise exception 'save_hiring_profile_version: org, name, requirements and actor are all required' using errcode = 'RL032';
  end if;

  if v_profile is null then
    insert into public.hiring_profiles (org_id, name) values (p_org, btrim(p_name)) returning id into v_profile;
  else
    select archived_at into v_archived from public.hiring_profiles where id = v_profile and org_id = p_org for update;
    if not found then
      raise exception 'save_hiring_profile_version: profile % is not this carrier''s', v_profile using errcode = 'RL030';
    end if;
    if v_archived is not null then
      raise exception 'save_hiring_profile_version: profile % is archived', v_profile using errcode = 'RL031';
    end if;
    update public.hiring_profiles set name = btrim(p_name) where id = v_profile and name <> btrim(p_name);
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.hiring_profile_versions where profile_id = v_profile;
  insert into public.hiring_profile_versions (org_id, profile_id, version, requirements, created_by, created_by_name)
  values (p_org, v_profile, v_version, p_requirements, p_actor, btrim(p_actor_name))
  returning id into v_id;

  return jsonb_build_object('profile_id', v_profile, 'version_id', v_id, 'version', v_version);
end;
$$;

-- ── 5. save an opening as its next version ───────────────────────────────────────────────────────
-- `p_version` carries the opening contract's fields (D1b validates them): profile_version_id, title,
-- facts, headcount, area_label, area_latitude, area_longitude, area_radius_miles, area_reason.
create or replace function public.save_opening_version(
  p_org uuid, p_opening uuid, p_version jsonb, p_actor uuid, p_actor_name text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_opening uuid := p_opening;
  v_pv uuid;
  v_version integer;
  v_id uuid;
begin
  if p_org is null or p_version is null or p_actor is null or nullif(btrim(p_actor_name), '') is null then
    raise exception 'save_opening_version: org, version and actor are all required' using errcode = 'RL032';
  end if;
  v_pv := (p_version ->> 'profile_version_id')::uuid;
  if v_pv is null or not exists (select 1 from public.hiring_profile_versions where id = v_pv and org_id = p_org) then
    raise exception 'save_opening_version: the profile version is not this carrier''s' using errcode = 'RL034';
  end if;

  if v_opening is null then
    insert into public.recruiting_openings (org_id) values (p_org) returning id into v_opening;
  else
    perform 1 from public.recruiting_openings where id = v_opening and org_id = p_org for update;
    if not found then
      raise exception 'save_opening_version: opening % is not this carrier''s', v_opening using errcode = 'RL030';
    end if;
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.recruiting_opening_versions where opening_id = v_opening;
  insert into public.recruiting_opening_versions (
    org_id, opening_id, version, profile_version_id, title, facts, headcount,
    area_label, area_latitude, area_longitude, area_radius_miles, area_reason, created_by, created_by_name)
  values (
    p_org, v_opening, v_version, v_pv, p_version ->> 'title', coalesce(p_version -> 'facts', '{}'::jsonb),
    (p_version ->> 'headcount')::integer, p_version ->> 'area_label', (p_version ->> 'area_latitude')::double precision,
    (p_version ->> 'area_longitude')::double precision, (p_version ->> 'area_radius_miles')::integer,
    p_version ->> 'area_reason', p_actor, btrim(p_actor_name))
  returning id into v_id;

  return jsonb_build_object('opening_id', v_opening, 'version_id', v_id, 'version', v_version);
end;
$$;

-- ── 6. the queue: one person per row, newest first, keyset-paged ─────────────────────────────────
create or replace function public.recruiting_lead_queue(
  p_org uuid, p_statuses text[], p_before_at timestamptz default null, p_before_id uuid default null,
  p_limit integer default 50)
returns table (
  id uuid, channel text, source text, campaign_ref text, opening_id uuid, full_name text, phone_e164 text,
  email_lower text, status text, assigned_to uuid, received_at timestamptz, answers jsonb, also jsonb, drivers jsonb)
language sql
stable
set search_path = ''
as $$
  with open_leads as (
    select l.* from public.recruiting_leads l
     where l.org_id = p_org and l.status = any (p_statuses)
  ),
  primaries as (
    select l.* from open_leads l
     where not exists (
       select 1 from open_leads e
        where (e.received_at, e.id) < (l.received_at, l.id)
          and ((l.phone_e164 is not null and e.phone_e164 = l.phone_e164)
            or (l.email_lower is not null and e.email_lower = l.email_lower)))
       and (p_before_at is null or (l.received_at, l.id) < (p_before_at, p_before_id))
     order by l.received_at desc, l.id desc
     limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  select p.id, p.channel, p.source, p.campaign_ref, p.opening_id, p.full_name, p.phone_e164, p.email_lower,
         p.status, p.assigned_to, p.received_at, p.answers,
         coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'channel', o.channel, 'campaign_ref', o.campaign_ref,
                                                       'received_at', o.received_at) order by o.received_at, o.id)
                     from open_leads o
                    where o.id <> p.id and (o.received_at, o.id) > (p.received_at, p.id)
                      and ((p.phone_e164 is not null and o.phone_e164 = p.phone_e164)
                        or (p.email_lower is not null and o.email_lower = p.email_lower))), '[]'::jsonb),
         public.recruiting_lead_matches(p_org, p.id) -> 'drivers'
    from primaries p
   order by p.received_at desc, p.id desc;
$$;

-- ── grants: the service role only ────────────────────────────────────────────────────────────────
revoke all on function public.phone_e164(text) from public, anon, authenticated;
revoke all on function public.recruiting_lead_matches(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ingest_lead(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.convert_lead(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.save_hiring_profile_version(uuid, uuid, text, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.save_opening_version(uuid, uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.recruiting_lead_queue(uuid, text[], timestamptz, uuid, integer) from public, anon, authenticated;

comment on function public.phone_e164(text) is
  'D1 (0554): normalisePhone (smsConsentContract.ts) in SQL — digits only, US-defaulted, E.164 kept, else null. Parity with the TypeScript pinned by recruiting-lead-functions.test.mjs.';
comment on function public.ingest_lead(uuid, jsonb) is
  'D1 (0554), LeadSink.accept: stores a lead once per (org, channel, external_ref) — a repeat answers duplicate with the first id, never updates — and returns who else it may be (leads and drivers, by E.164 phone or lower-case email only). Service-role only.';
comment on function public.convert_lead(uuid, uuid, uuid, uuid, text) is
  'D1 (0554): records that a lead became an applicant roster already created — RL020 lead not this carrier''s, RL021 driver not an open applicant of it, RL022 converted to someone else; the same pair again is answered, not refused. Sets the lead converted. Service-role only.';
comment on function public.recruiting_lead_queue(uuid, text[], timestamptz, uuid, integer) is
  'D1 (0554): the lead queue, one person per row (later leads with the same phone or email ride as also), newest first, keyset-paged on (received_at, id), at most 100. Service-role only.';
