-- 0660: a McLeod stop keeps one `load_stops` row for its whole life — identity by McLeod's stop id, the
-- in-transaction band, and `mcleod_removed_at` (S0a; docs/plans/mcleod/v2/T1-driver-and-data.md N-6,
-- D-MK15, D-MK16).
--
-- ── THE GAP ──────────────────────────────────────────────────────────────────────────────────────
-- Spec A C1/C2: both stop writers delete a McLeod load's PENDING stops and re-insert them on every
-- sweep (`apps/api/src/modules/loads/mirrorLoads.ts:104-129` — delete `status = 'pending'`, then
-- upsert `onConflict: "load_id,seq"`; `tmsLoadIngestWriters.ts` the same). So `load_stops.id` churns
-- every 60 seconds, and a phone that queued "arrived at stop <id>" offline comes back to an id that no
-- longer exists. And because the upsert keys on `seq`, a worked stop McLeod re-sequenced is
-- overwritten with its sequence-neighbour's address. Nothing in the row says which McLeod stop it is.
--
-- ── WHAT THIS MIGRATION ADDS ─────────────────────────────────────────────────────────────────────
-- · `load_stops.mcleod_stop_id` — McLeod's `stop.id`, trimmed, and the unique index
--   `(load_id, mcleod_stop_id)` the RPC upserts on. Non-partial: NULLs are distinct, so manual rows
--   (and McLeod rows not yet claimed) never collide (aA A-28 corrected the old "PostgREST cannot name
--   a partial index" reason — after S0b no PostgREST upsert targets this index at all).
-- · `load_stops.mcleod_removed_at` — WHY KEPT, NOT DELETED (D-MK15, reversing ROUND3 §2.3): the
--   `load-photos` reconciler deletes every photo object whose `load_stop_photos` row is gone
--   (`apps/api/src/modules/org/storageReconcile.ts:297`, after its 24 h grace), and that row cascades
--   from the stop (`load_stop_photos_stop_id_fkey … ON DELETE CASCADE`, schema.generated.sql:8223).
--   Deleting a stop McLeod stopped listing would destroy the driver's proof of work at it. So the row
--   stays, stamped, at the tail; computing readers skip it, displaying readers label it.
-- · `load_stops_seq_check` widened from 1..50 (0423:101-102) to 1..1999 — WHY THE BAND (D-MK16):
--   `idx_load_stops_load_seq (load_id, seq)` is unique and NOT deferrable, so a swap of two stops, or
--   a stop inserted mid-movement, collides row by row if applied in place. The RPC first moves every
--   row of the load to `seq + 1000`, re-seats McLeod's stops at McLeod's numbers, puts removed ones at
--   the tail, and asserts the band is empty before the sub-block ends. At rest: 1..999 (McLeod's
--   numbers plus the tail); 1000..1999 exists only inside one call. Proved on PGlite across two
--   sweeps, an added stop and a swap (`docs/plans/mcleod/api-kit-round4/pg/tail.mjs`).
-- · two `load_events` kinds, both written only by this RPC, both system facts (actor_role 'system',
--   no user): `stop_removed_in_mcleod` and `stop_mirror_refused`. The list below is 0645's
--   (0645:38-46) — main's newest definition of the CHECK — plus those two; every kind main allows is
--   kept, `stop_photo_added` included. The shared contract (`LOAD_EVENT_KINDS`) learns both kinds in
--   THIS merge, 0645's rule: ahead of the first writer, so no reader meets an unknown kind.
-- · `public.apply_mcleod_load_stops(p_org, p_loads)` — the one writer of a McLeod load's stops from
--   S0b on. Each load runs in its own `begin … exception … end` sub-block (D-MK16, V4 §2.2), so one
--   refused load never aborts the batch; the sub-block re-raises 40001/40P01 so the caller retries the
--   whole batch. Algorithm and refusal reasons are on the function.
--
-- ── WAIVERS ──────────────────────────────────────────────────────────────────────────────────────
-- raw-access-waiver: the one-time backfill below reads `mcleod_dispatch_stops` (mcleod raw) to learn
--   each existing projected stop's McLeod id by movement and sequence (aA A-29, A-57). The RPC itself
--   reads no raw table — its caller (N-7's projection) hands it McLeod's stops.
-- cross-module-waiver: every table WRITTEN here is the loads module's (`load_stops`, `load_events`);
--   the only other module's table is the backfill's read of the mcleod raw mirror, named above.
--
-- ── DEPLOY WINDOW ────────────────────────────────────────────────────────────────────────────────
-- Columns, an index, a widened CHECK, two more allowed kinds and a function. Nothing calls the function
-- in this merge (N-7 does, `lint:migration-ordering`), and the old writers keep working unchanged on
-- either side of the window: they never name the new columns, their seqs stay within 1..50, and the
-- CHECKs only widen. A pending row the old writer re-inserts in the S0a→S0b window has a null
-- `mcleod_stop_id`; the RPC's claim step gives it its id by sequence on the first apply.
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────────────────────────────
-- Inert without N-7. Nothing here narrows, so no later migration has to undo it to roll code back
-- (D-MK17: there is no "cannot roll back past S0b").

alter table public.load_stops add column if not exists mcleod_stop_id text;
alter table public.load_stops add column if not exists mcleod_removed_at timestamptz;
comment on column public.load_stops.mcleod_stop_id is
  'McLeod stop.id (trimmed). Identity of a projected stop: apply_mcleod_load_stops updates by (load_id, mcleod_stop_id) '
  'and never deletes it, so load_stops.id is stable for a phone that queued an action (S0a, D-MK15). Null on a manual load.';
comment on column public.load_stops.mcleod_removed_at is
  'When McLeod stopped listing this stop. The row and its photos are kept; computing readers skip it, displaying '
  'readers label it "Removed in McLeod" (D-MK15).';
-- Non-partial: NULLs are distinct, so manual rows never collide (aA A-28 corrected the old reason).
create unique index if not exists uq_load_stops_load_mcleod_stop on public.load_stops (load_id, mcleod_stop_id);

-- D-MK16: McLeod seq 1..999 at rest, removed stops at the tail (≤ 200 by refusal), 1000+ is the in-transaction band.
alter table public.load_stops drop constraint if exists load_stops_seq_check;              -- 0423:101-102 (1..50)
alter table public.load_stops add constraint load_stops_seq_check check (seq between 1 and 1999);

-- load_events kinds: 0645's list (0645:38-46) + two system facts this RPC writes.
alter table public.load_events drop constraint load_events_kind_check;
alter table public.load_events add constraint load_events_kind_check check (kind in (
  'created','submitted','approved','rejected','assigned','reassigned','released','accepted','declined','started',
  'stop_arrived','stop_completed','stop_skipped','equipment_mismatch','amended','canceled','completed',
  'load_changed','exception_resolved','stop_photo_added',
  'stop_removed_in_mcleod','stop_mirror_refused'));

-- Backfill (aA A-29): by movement and McLeod sequence, trimmed, company from external_id. The projection
-- builds `external_id` as `<movement.company_id>:<movement.movement_id>` verbatim
-- (`packages/shared/src/mcleodLoadProjection.ts:294`) and seats each stop at McLeod's own
-- `movement_sequence` (`:262`), and the collector writes a stop's `company_id`/`movement_id` from the
-- same values and deletes the raw stops McLeod stopped listing (`dispatchMovementIngest.ts:171-198`),
-- so the join is exact and finds at most one raw stop per row. A row whose raw movement is gone stays
-- null and is claimed by sequence on its first apply (step 2 below).
update public.load_stops ls
   set mcleod_stop_id = btrim(s.stop_id)
  from public.loads l
  join public.mcleod_dispatch_stops s
    on s.org_id = l.org_id and l.external_id = s.company_id || ':' || s.movement_id
 where ls.load_id = l.id and l.source = 'tms' and s.movement_sequence = ls.seq and ls.mcleod_stop_id is null;

-- ── public.apply_mcleod_load_stops ───────────────────────────────────────────────────────────────
-- p_loads = [{load_id, stops: [ProjectedStop + mcleod_stop_id, required_photos, reference_numbers]}].
-- Per load, in its own sub-block, in order (T1 N-6 steps 1-8):
--   1. lock the load: in p_org, source 'tms' — else refused `not_tms_in_org` (LS001's meaning,
--      returned, not raised; no event, since the load may be another organization's).
--   2. CLAIM: a row with no McLeod id at an incoming stop's sequence gets that stop's id — the rows the
--      old writer inserted in the S0a→S0b window, and loads whose raw movement the backfill missed.
--   3. BAND: every row of the load, worked or not, removed or not, moves to seq + 1000.
--   4. UPSERT each incoming stop on (load_id, mcleod_stop_id). The row is built with
--      `jsonb_populate_record(null::public.load_stops, stop)`, so names and types come from the table
--      (aA A-47). It sets the PROJECTED columns only and clears `mcleod_removed_at` (a stop McLeod
--      lists again is no longer removed). NEVER status, arrived_at, completed_at, skip_reason: those
--      are the driver's, and a sweep that overwrote them would undo a delivery.
--   5. REMOVED: rows still in the band are stops McLeod no longer lists. Stamped (once) and moved to
--      max(incoming seq) + n in their previous order; one `stop_removed_in_mcleod` event per row newly
--      stamped, payload {stop_id, mcleod_stop_id, driver_status}.
--   6. TAIL REFUSAL: more than 200 removed stops → refused `stop_tail_over_200`, and one
--      `stop_mirror_refused` event unless an unresolved one for the load is younger than 24 h (one a
--      day, not one per 60-second sweep).
--   7. ASSERT: no row of the load at seq ≥ 1000 — else refused `band_not_empty`.
--   8. CLOSE: a load that applies cleanly closes its newest open `stop_mirror_refused` with an
--      `exception_resolved` naming it — 0145's close-by-new-row rule; the payload carries `resolves`
--      (the event id), the shape `dispatchLoads/exceptions.ts` reads.
-- Returns {written: [load_id…], refused: [{load_id, reason, sqlstate?, message?}]}.
create or replace function public.apply_mcleod_load_stops(p_org uuid, p_loads jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item     jsonb;
  v_load     uuid;
  v_stops    jsonb;
  v_max      integer;
  v_tail     integer;
  v_open     uuid;
  v_written  jsonb := '[]'::jsonb;
  v_refused  jsonb := '[]'::jsonb;
begin
  if p_loads is null or jsonb_typeof(p_loads) <> 'array' then
    raise exception 'p_loads must be a json array' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_loads) loop
    v_load  := (v_item->>'load_id')::uuid;
    v_stops := coalesce(v_item->'stops', '[]'::jsonb);
    begin
      -- 1. the load: ours, a McLeod load, locked against a concurrent sweep.
      perform 1 from public.loads l
        where l.id = v_load and l.org_id = p_org and l.source = 'tms'
        for update;
      if not found then
        v_refused := v_refused || jsonb_build_array(jsonb_build_object('load_id', v_load, 'reason', 'not_tms_in_org'));
        continue;
      end if;
      if jsonb_typeof(v_stops) <> 'array'
         or exists (select 1 from jsonb_array_elements(v_stops) x where nullif(btrim(x->>'mcleod_stop_id'), '') is null) then
        raise exception 'stop_without_mcleod_id' using errcode = 'LS004';
      end if;

      -- 2. claim by sequence: only when no row of the load already carries that McLeod id.
      update public.load_stops ls
         set mcleod_stop_id = btrim(x->>'mcleod_stop_id')
        from jsonb_array_elements(v_stops) x
       where ls.load_id = v_load and ls.mcleod_stop_id is null
         and ls.seq = (x->>'seq')::integer
         and not exists (select 1 from public.load_stops o
                          where o.load_id = v_load and o.mcleod_stop_id = btrim(x->>'mcleod_stop_id'));

      -- 3. the band.
      update public.load_stops set seq = seq + 1000 where load_id = v_load;

      -- 4. upsert McLeod's stops at McLeod's sequence.
      insert into public.load_stops as ls (
        org_id, load_id, mcleod_stop_id, seq, kind, name, address_line, city, state, postal_code, lat, lon,
        appointment_start, appointment_end, location_name, location_code, external_status,
        actual_arrival_at, actual_departure_at, eta_at, contact_name, contact_phone, po_number,
        required_photos, reference_numbers, mcleod_removed_at)
      select p_org, v_load, btrim(x->>'mcleod_stop_id'), r.seq, r.kind, r.name, r.address_line, r.city, r.state,
             r.postal_code, r.lat, r.lon, r.appointment_start, r.appointment_end, r.location_name, r.location_code,
             r.external_status, r.actual_arrival_at, r.actual_departure_at, r.eta_at, r.contact_name,
             r.contact_phone, r.po_number, coalesce(r.required_photos, '{}'::text[]), r.reference_numbers, null
        from jsonb_array_elements(v_stops) x
        cross join lateral jsonb_populate_record(null::public.load_stops, x) r
      on conflict (load_id, mcleod_stop_id) do update set
        seq = excluded.seq, kind = excluded.kind, name = excluded.name, address_line = excluded.address_line,
        city = excluded.city, state = excluded.state, postal_code = excluded.postal_code,
        lat = excluded.lat, lon = excluded.lon,
        appointment_start = excluded.appointment_start, appointment_end = excluded.appointment_end,
        location_name = excluded.location_name, location_code = excluded.location_code,
        external_status = excluded.external_status,
        actual_arrival_at = excluded.actual_arrival_at, actual_departure_at = excluded.actual_departure_at,
        eta_at = excluded.eta_at, contact_name = excluded.contact_name, contact_phone = excluded.contact_phone,
        po_number = excluded.po_number, required_photos = excluded.required_photos,
        reference_numbers = excluded.reference_numbers, updated_at = now(),
        mcleod_removed_at = null;

      -- 5. what is still in the band is no longer listed by McLeod.
      select coalesce(max((x->>'seq')::integer), 0) into v_max from jsonb_array_elements(v_stops) x;
      select count(*) into v_tail from public.load_stops where load_id = v_load and seq >= 1000;

      -- 6. refused by name before anything is renumbered; the handler below records it.
      if v_tail > 200 then
        raise exception 'stop_tail_over_200' using errcode = 'LS002';
      end if;
      if v_max + v_tail > 999 then
        raise exception 'band_not_empty' using errcode = 'LS003';
      end if;

      insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, payload)
      select p_org, v_load, null, 'system', 'stop_removed_in_mcleod',
             jsonb_build_object('stop_id', ls.id, 'mcleod_stop_id', ls.mcleod_stop_id, 'driver_status', ls.status)
        from public.load_stops ls
       where ls.load_id = v_load and ls.seq >= 1000 and ls.mcleod_removed_at is null
       order by ls.seq;

      update public.load_stops ls
         set seq = v_max + t.n, mcleod_removed_at = coalesce(ls.mcleod_removed_at, now())
        from (select id, row_number() over (order by seq) as n
                from public.load_stops where load_id = v_load and seq >= 1000) t
       where ls.id = t.id;

      -- 7. the band is empty.
      if exists (select 1 from public.load_stops where load_id = v_load and seq >= 1000) then
        raise exception 'band_not_empty' using errcode = 'LS003';
      end if;

      -- 8. a clean apply closes the open refusal.
      v_open := null;
      select e.id into v_open
        from public.load_events e
       where e.load_id = v_load and e.org_id = p_org and e.kind = 'stop_mirror_refused'
       order by e.occurred_at desc, e.recorded_at desc
       limit 1;
      if v_open is not null and not exists (
           select 1 from public.load_events r
            where r.load_id = v_load and r.kind = 'exception_resolved' and r.payload->>'resolves' = v_open::text) then
        insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, payload)
        values (p_org, v_load, null, 'system', 'exception_resolved',
                jsonb_build_object('resolves', v_open, 'kind', 'stop_mirror_refused', 'by', 'mirror'));
      end if;

      v_written := v_written || jsonb_build_array(v_load);
    exception
      when sqlstate 'LS002' then
        -- One event a day per load, not one per sweep: skip while an unresolved refusal is under 24 h old.
        if not exists (
             select 1 from public.load_events e
              where e.load_id = v_load and e.org_id = p_org and e.kind = 'stop_mirror_refused'
                and e.occurred_at > now() - interval '24 hours'
                and not exists (select 1 from public.load_events r
                                 where r.load_id = v_load and r.kind = 'exception_resolved'
                                   and r.payload->>'resolves' = e.id::text)) then
          insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, payload)
          values (p_org, v_load, null, 'system', 'stop_mirror_refused',
                  jsonb_build_object('reason', 'stop_tail_over_200'));
        end if;
        v_refused := v_refused || jsonb_build_array(jsonb_build_object('load_id', v_load, 'reason', 'stop_tail_over_200'));
      when others then
        -- A serialization failure or deadlock is the batch's, not this load's: the caller retries it.
        if sqlstate in ('40001', '40P01') then
          raise;
        end if;
        v_refused := v_refused || jsonb_build_array(jsonb_build_object(
          'load_id', v_load,
          'reason', case sqlstate when 'LS003' then 'band_not_empty'
                                  when 'LS004' then 'stop_without_mcleod_id'
                                  else 'error' end,
          'sqlstate', sqlstate, 'message', sqlerrm));
    end;
  end loop;

  return jsonb_build_object('written', v_written, 'refused', v_refused);
end;
$$;

revoke all on function public.apply_mcleod_load_stops(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_mcleod_load_stops(uuid, jsonb) to service_role;
