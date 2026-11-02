-- Silvicom 360 — 0545 office chat: conversations about a card-fraud incident or a roadside inspection
-- (docs/plans/messaging/OFFICE-CHAT-PLAN.md §9.4; Q-CHAT21 ruled (c) 2026-11-02; D-CHAT35, D-CHAT36)
--
-- 0543 let a group be about a load, a driver or a truck. Q-CHAT21 asked which "cases" the plan meant;
-- the owner ruled (c): card-fraud incidents AND DataQs challenges. This file adds the two links on
-- 0543's pattern — a nullable column each, at most one link, only on a group, the organisation checked by
-- trigger — and teaches 0543's three functions the two new kinds. What building it found:
--
--   D-CHAT35 — A DATAQS CHALLENGE IS LINKED THROUGH ITS INSPECTION. `dataqs_cases` (0495) is append-only
--      with one row per STATE — `approved`, then `filed` with its RDR number — so no row id stands for
--      "the challenge": a conversation linked to the approved row would point at a superseded record the
--      day it is filed. The challenge is worked on its roadside inspection's page
--      (`/roadside-inspections/:id`), which lists its tickets, their dispositions and the DataQs
--      requests; so the link is to `roadside_inspections`, and the kind is `roadside_inspection`.
--   D-CHAT36 — A CARD IS NEVER NAMED IN FULL. `card_fraud_incidents.card_ref` holds a full card number
--      for some cards (measured in `cardFraudFill.test.ts`'s fixtures: 19 digits). The label
--      `chat_thread_about` answers is "••" and the last four digits — the rule of `cardLast4()` in
--      packages/shared/src/cardAssignment.ts, digits only — because the label becomes a conversation's
--      subject, and a subject is written into the chat ledger, which never forgets.
--
-- Who may read which kind is the API's, by that record's own section: a fraud incident is read under
-- `fuel` view (`GET /api/card-fraud-incidents/:id`), a roadside inspection under `safety` view
-- (roadside.ts `canView`) — `CHAT_ABOUT_READ_SECTION` in the shared contract, the CH11b merge after this.
--
-- WHY THE OLD CODE MEETS THIS SAFELY: two nullable columns no reader selects; the CHECK widened, never
-- narrowed (every row meeting 0543's meets this); the three functions keep their arguments and their
-- answer's columns, and answer the two new kinds only when asked for them, which no client does before
-- the next merge. The ledger's `conversation_created` detail gains two keys on new rows.
--
-- Rollback: restore 0543's CHECK, trigger function, `chat_ledger_threads` and the three functions;
-- drop the two columns. The next merge's contract names the kinds and must be reverted first.

alter table message_threads add column if not exists card_fraud_incident_id uuid references card_fraud_incidents(id) on delete set null;
alter table message_threads add column if not exists roadside_inspection_id uuid references roadside_inspections(id) on delete set null;

alter table message_threads drop constraint if exists message_threads_about_check;
alter table message_threads add constraint message_threads_about_check check (
  num_nonnulls(load_id, driver_id, vehicle_id, card_fraud_incident_id, roadside_inspection_id) <= 1
  and (kind not in ('direct', 'channel')
       or num_nonnulls(load_id, driver_id, vehicle_id, card_fraud_incident_id, roadside_inspection_id) = 0)
);

create index if not exists idx_threads_card_fraud_incident on message_threads (card_fraud_incident_id) where card_fraud_incident_id is not null;
create index if not exists idx_threads_roadside_inspection on message_threads (roadside_inspection_id) where roadside_inspection_id is not null;

create or replace function message_threads_about_same_org() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (new.load_id is not null and not exists (select 1 from public.loads x where x.id = new.load_id and x.org_id = new.org_id))
     or (new.driver_id is not null and not exists (select 1 from public.drivers x where x.id = new.driver_id and x.org_id = new.org_id))
     or (new.vehicle_id is not null and not exists (select 1 from public.vehicles x where x.id = new.vehicle_id and x.org_id = new.org_id))
     or (new.card_fraud_incident_id is not null and not exists (select 1 from public.card_fraud_incidents x where x.id = new.card_fraud_incident_id and x.org_id = new.org_id))
     or (new.roadside_inspection_id is not null and not exists (select 1 from public.roadside_inspections x where x.id = new.roadside_inspection_id and x.org_id = new.org_id)) then
    raise exception 'that record is not in this organisation' using errcode = 'CH016';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_message_threads_about_same_org on message_threads;
create trigger trg_message_threads_about_same_org
  before insert or update of load_id, driver_id, vehicle_id, card_fraud_incident_id, roadside_inspection_id, org_id on message_threads
  for each row execute function message_threads_about_same_org();

create or replace function chat_ledger_threads() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'conversation_created';
  elsif new.archived_at is not null and old.archived_at is null then
    v_action := 'conversation_archived';
  elsif new.archived_at is null and old.archived_at is not null then
    v_action := 'conversation_restored';
  elsif new.subject is distinct from old.subject then
    v_action := 'conversation_renamed';
  else
    return null;
  end if;
  insert into public.chat_ledger (org_id, actor_user_id, action, thread_id, detail)
  values (new.org_id, coalesce(public.chat_declared_actor(), new.created_by), v_action, new.id,
          jsonb_build_object('kind', new.kind, 'subject', new.subject, 'load_id', new.load_id)
          || jsonb_strip_nulls(jsonb_build_object('driver_id', new.driver_id, 'vehicle_id', new.vehicle_id,
                 'card_fraud_incident_id', new.card_fraud_incident_id, 'roadside_inspection_id', new.roadside_inspection_id))
          || case when new.kind = 'channel'
                  then jsonb_build_object('space_id', new.space_id, 'visibility', new.visibility, 'general', new.general)
                  else '{}'::jsonb end);
  return null;
end;
$$;

create or replace function chat_create_about(
  p_org uuid, p_actor uuid, p_thread_id uuid, p_subject text, p_members uuid[], p_kind text, p_record uuid
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.message_threads;
  v_members uuid[];
  v_user uuid;
begin
  if p_kind is null or p_kind not in ('load', 'driver', 'vehicle', 'fraud_incident', 'roadside_inspection') or p_record is null then
    raise exception 'a conversation is about a load, a driver, a truck, a card-fraud incident or a roadside inspection' using errcode = 'CH016';
  end if;
  select t.* into v_existing from public.message_threads t where t.id = p_thread_id;
  if v_existing.id is not null then
    if v_existing.org_id = p_org and v_existing.kind = 'group' and v_existing.created_by = p_actor then
      return v_existing.id;
    end if;
    raise exception 'that id already belongs to another conversation' using errcode = 'CH007';
  end if;

  select array_agg(distinct u) into v_members from unnest(coalesce(p_members, '{}') || p_actor) u where u is not null;
  if cardinality(v_members) < 2 then
    raise exception 'a group needs at least one other person' using errcode = 'CH002';
  end if;
  if cardinality(v_members) > 250 then
    raise exception 'a group holds at most 250 people; use a channel' using errcode = 'CH006';
  end if;
  foreach v_user in array v_members loop
    perform public.chat_assert_office_member(p_org, v_user);
  end loop;
  perform set_config('silvicom.chat_actor', p_actor::text, true);

  insert into public.message_threads (id, org_id, kind, subject, created_by,
                                      load_id, driver_id, vehicle_id, card_fraud_incident_id, roadside_inspection_id)
  values (p_thread_id, p_org, 'group', nullif(btrim(p_subject), ''), p_actor,
          case when p_kind = 'load' then p_record end,
          case when p_kind = 'driver' then p_record end,
          case when p_kind = 'vehicle' then p_record end,
          case when p_kind = 'fraud_incident' then p_record end,
          case when p_kind = 'roadside_inspection' then p_record end);
  insert into public.thread_participants (thread_id, org_id, user_id, role, member_role)
  select p_thread_id, p_org, u, 'office', case when u = p_actor then 'owner' else 'member' end
    from unnest(v_members) u;
  return p_thread_id;
end;
$$;

create or replace function chat_about(p_org uuid, p_user uuid, p_kind text, p_record uuid)
returns table (
  thread_id uuid, subject text, created_at timestamptz, last_message_at timestamptz,
  unread bigint, member_count bigint, title_members jsonb
)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.subject, t.created_at, t.last_message_at, greatest(t.last_seq - p.read_seq, 0),
         (select count(*) from public.thread_participants o where o.thread_id = t.id and o.left_at is null),
         coalesce((
           select jsonb_agg(jsonb_build_object('user_id', o.user_id, 'name', public.chat_display_name(p_org, o.user_id))
                            order by o.joined_at, o.user_id)
             from (select o2.user_id, o2.joined_at from public.thread_participants o2
                    where o2.thread_id = t.id and o2.left_at is null and o2.user_id <> p_user
                    order by o2.joined_at, o2.user_id limit 4) o
         ), '[]'::jsonb)
    from public.message_threads t
    join public.thread_participants p on p.thread_id = t.id and p.user_id = p_user and p.left_at is null
   where t.org_id = p_org and t.kind = 'group'
     and case p_kind when 'load' then t.load_id = p_record
                     when 'driver' then t.driver_id = p_record
                     when 'vehicle' then t.vehicle_id = p_record
                     when 'fraud_incident' then t.card_fraud_incident_id = p_record
                     when 'roadside_inspection' then t.roadside_inspection_id = p_record
                     else false end
   order by t.last_message_at desc, t.id desc
   limit 50;
$$;

create or replace function chat_thread_about(p_org uuid, p_user uuid, p_thread uuid)
returns table (kind text, record_id uuid, label text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.message_threads;
begin
  v := public.chat_member_thread(p_org, p_user, p_thread);
  if v.kind <> 'group' then
    return;
  end if;
  return query
    select 'load'::text, l.id, l.ref from public.loads l where l.id = v.load_id and l.org_id = p_org
    union all
    select 'driver', d.id, d.full_name from public.drivers d where d.id = v.driver_id and d.org_id = p_org
    union all
    select 'vehicle', x.id, x.unit_number from public.vehicles x where x.id = v.vehicle_id and x.org_id = p_org
    union all
    -- D-CHAT36: the card's last four digits only, never the reference as stored.
    select 'fraud_incident', f.id, '••' || right(regexp_replace(f.card_ref, '\D', '', 'g'), 4)
      from public.card_fraud_incidents f where f.id = v.card_fraud_incident_id and f.org_id = p_org
    union all
    -- The report number, or the day (MM/DD/YYYY, the app's one date format) when there is none.
    select 'roadside_inspection', r.id, coalesce(nullif(btrim(r.report_number), ''), to_char(r.inspection_date, 'MM/DD/YYYY'), 'without a report number')
      from public.roadside_inspections r where r.id = v.roadside_inspection_id and r.org_id = p_org;
end;
$$;

revoke all on function message_threads_about_same_org() from public, anon, authenticated;
revoke all on function chat_ledger_threads() from public, anon, authenticated;
revoke all on function chat_create_about(uuid, uuid, uuid, text, uuid[], text, uuid) from public, anon, authenticated;
revoke all on function chat_about(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function chat_thread_about(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function chat_create_about(uuid, uuid, uuid, text, uuid[], text, uuid) to service_role;
grant execute on function chat_about(uuid, uuid, text, uuid) to service_role;
grant execute on function chat_thread_about(uuid, uuid, uuid) to service_role;
