-- FuelGuard — 0645 a late photo for a stop the driver already finished (Visual 2026 D-DV30, Q-DV7)
--
-- WHY. The office asks drivers for a missing seal or BOL photo after the stop is done — that is the
-- photo they chase most — and until now the app had no way to send it. `driver_complete_stop` (0141)
-- refuses any change to a finished stop on purpose ("stop already completed", DL003), and a repeat of
-- the same status returns BEFORE it inserts photos, so a re-sent completion carrying the photo is
-- silently dropped. The driver's only route was a text message outside the record.
--
-- WHAT. A second, narrower function. It ADDS photos to a COMPLETED stop and does nothing else:
--   * the stop's status, its arrival and completion times, its reason and its existing photos are
--     not touched — the finished record stays exactly as finished (0141's guard is unchanged);
--   * the load must be the driver's, and still in transit or delivered — not canceled;
--   * only a COMPLETED stop takes one: a pending or arrived stop goes through driver_complete_stop
--     as before, and a skipped stop was never visited, so a photo of it would be a claim it was;
--   * a photo must arrive within 14 days of the stop's completion (DL007). Ruling D-DV30 set no
--     limit; 14 days is the settlement week twice over, long enough for every chase the office
--     makes, and bounded so an old load cannot be re-opened from a phone indefinitely;
--   * every storage path must sit under this org and this driver, the same prefix the storage
--     policies key on (0085), so the record cannot point at another driver's file.
--
-- "LATE" IS DERIVED, NOT STORED. A late photo is a `load_stop_photos` row whose `uploaded_at` is
-- after its stop's `completed_at`. No column is added: the fact already exists in two timestamps, and
-- a flag beside them would be a second source of truth that could disagree with them.
--
-- THE OFFICE SEES IT as a `stop_photo_added` event on the load's timeline, written once per call that
-- added something. The outbox replays: a replay adds no photo (conflict on the client id) and writes
-- no event, so a driver in a dead zone produces one event, not five.
--
-- DEPLOY WINDOW. Additive only: one widened CHECK and one new function, called by nothing until the
-- API route ships in a later merge (lint:migration-ordering cannot see functions; the route is held
-- by hand). Old code never writes the new kind; old readers would not parse it, which is why the
-- shared contract learns the kind in THIS merge, ahead of the first writer.

alter table public.load_events
  drop constraint if exists load_events_kind_check;

alter table public.load_events
  add constraint load_events_kind_check check (kind in (
    'created', 'submitted', 'approved', 'rejected',
    'assigned', 'reassigned', 'released',
    'accepted', 'declined', 'started',
    'stop_arrived', 'stop_completed', 'stop_skipped',
    'equipment_mismatch', 'amended', 'canceled', 'completed',
    'load_changed', 'exception_resolved',
    'stop_photo_added'
  ));

create function public.driver_add_stop_photos(
  p_org         uuid,
  p_driver      uuid,
  p_load        uuid,
  p_stop        uuid,
  p_photos      jsonb,                                   -- [{id, slot, storage_path, captured_at}, ...]
  p_actor_user  uuid        default null,
  p_occurred_at timestamptz default null
) returns integer                                        -- how many photos this call added
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_load_status  text;
  v_stop_status  text;
  v_stop_seq     integer;
  v_completed_at timestamptz;
  v_prefix       text := p_org::text || '/' || p_driver::text || '/';
  v_added        integer;
  v_slots        text[];
begin
  v_load_status := public.assert_driver_load(p_org, p_driver, p_load);

  select s.status, s.seq, s.completed_at
    into v_stop_status, v_stop_seq, v_completed_at
    from public.load_stops s
   where s.id = p_stop and s.load_id = p_load;
  if v_stop_seq is null then
    raise exception 'stop not found on this load' using errcode = 'DL005';
  end if;
  if v_load_status not in ('in_transit', 'delivered') then
    raise exception 'cannot add photos in load status %', v_load_status using errcode = 'DL003';
  end if;
  if v_stop_status <> 'completed' then
    raise exception 'late photos go on a completed stop (this one is %)', v_stop_status using errcode = 'DL003';
  end if;
  if v_completed_at is null or v_completed_at < now() - interval '14 days' then
    raise exception 'this stop finished more than 14 days ago' using errcode = 'DL007';
  end if;

  if jsonb_typeof(p_photos) is distinct from 'array' or jsonb_array_length(p_photos) = 0 then
    raise exception 'no photos to add' using errcode = 'DL010';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_photos) elem
     where coalesce(btrim(elem->>'slot'), '') = ''
        or coalesce(elem->>'storage_path', '') not like v_prefix || '%'
        or coalesce(elem->>'id', '') = ''
  ) then
    raise exception 'each photo needs an id, a slot and a path under this driver' using errcode = 'DL010';
  end if;

  with added as (
    insert into public.load_stop_photos (id, org_id, load_id, stop_id, driver_id, slot, storage_path, captured_at)
    select
      (elem->>'id')::uuid,
      p_org,
      p_load,
      p_stop,
      p_driver,
      elem->>'slot',
      elem->>'storage_path',
      nullif(elem->>'captured_at', '')::timestamptz
    from jsonb_array_elements(p_photos) elem
    on conflict (id) do nothing
    returning slot
  )
  select count(*)::integer, array_agg(distinct slot order by slot) into v_added, v_slots from added;

  if v_added > 0 then
    insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, payload, occurred_at)
    values (p_org, p_load, p_actor_user, 'driver', 'stop_photo_added',
            jsonb_build_object('stop_id', p_stop, 'seq', v_stop_seq, 'photos', v_added, 'slots', to_jsonb(v_slots)),
            coalesce(p_occurred_at, now()));
  end if;

  return v_added;
end;
$$;

comment on function public.driver_add_stop_photos(uuid, uuid, uuid, uuid, jsonb, uuid, timestamptz) is
  'Adds late photos to a COMPLETED stop without touching it; returns how many were new (0645, D-DV30).';

-- Service role only, like every driver load function (0141): the API has authenticated the driver.
revoke all on function public.driver_add_stop_photos(uuid, uuid, uuid, uuid, jsonb, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.driver_add_stop_photos(uuid, uuid, uuid, uuid, jsonb, uuid, timestamptz) to service_role;
