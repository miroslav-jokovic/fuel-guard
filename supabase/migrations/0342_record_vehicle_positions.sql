-- 0342: the writer for `vehicle_positions` (LIVE-MAP-PLAN.md LM4, D-LM16).
--
-- 0341 shipped the table and nothing that writes it — deliberately, and pinned as a waiver in
-- scripts/check-table-producers.mjs that this migration's PR removes. This is the producer.
--
-- ── WHY AN RPC AND NOT `.upsert()` ───────────────────────────────────────────────────────────────
-- Two reasons, and only the second is decisive.
--
-- The first is volume. The positions tier polls every 5 seconds, so at ~205 trucks a per-row write
-- would be ~41 statements a second, forever. One call carrying the whole tick is one round trip and
-- one plan, which is the same argument migrations 0174/0175 make for their set-based UPDATEs.
--
-- The second is the ONLY-GO-FORWARD guard, and PostgREST cannot express it. `.upsert()` compiles to
-- `INSERT … ON CONFLICT DO UPDATE` with no WHERE, so any re-delivered page would overwrite a truck's
-- current fix with an older one — and the feed is at-least-once BY DESIGN (D-SAM4): a cursor write
-- that fails after its page was applied re-delivers that page on the next tick. Without the guard, a
-- cursor hiccup makes a live truck look stale, and `vehicle_positions` keeps no history to recover
-- from. `where excluded.sampled_at > vehicle_positions.sampled_at` is the whole fix and it is one
-- line, which is why the table's writer is a function rather than a call.
--
-- ── WHY IT TAKES `p_org` AND IGNORES ANY ORG INSIDE THE PAYLOAD ──────────────────────────────────
-- Tenant scope is the caller's argument, never a value the collector put in a row — the rule 0175
-- states in its own WHERE clause. The API reads and writes with the service role, which BYPASSES RLS,
-- so this argument is the only tenant boundary the write has. The composite FK from 0341 then refuses
-- any vehicle_id that does not belong to `p_org`, so a payload that named another org's truck fails
-- loudly instead of landing.
--
-- ── WHY IT RETURNS A COUNT AND NOT A SET ─────────────────────────────────────────────────────────
-- The caller records "how many trucks moved" in its tier log. It never needs the rows back — nothing
-- downstream of a position write reads it in the same breath, and returning 205 rows every 5 seconds
-- to be discarded is the sort of cost that only shows up in a bill.
--
-- Rollback: drop the function. No data is migrated by this file.

-- raw-access-waiver: this migration defines the samsara collector's OWN writer for the samsara raw
-- table `vehicle_positions` (module=samsara, layer=raw in scripts/table-modules.json). There is no
-- cross-module read here — it is the producer 0341 deliberately deferred to this step.
create or replace function public.record_vehicle_positions(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  written int;
begin
  insert into public.vehicle_positions as vp (
    org_id, vehicle_id, lat, lng, heading_degrees, speed_mph, is_ecu_speed,
    formatted_location, sampled_at, received_at, source
  )
  select p_org,            -- the caller's org, never r.org_id: there is no org_id in the payload
         r.vehicle_id, r.lat, r.lng, r.heading_degrees, r.speed_mph, r.is_ecu_speed,
         r.formatted_location, r.sampled_at, now(), 'samsara'
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           vehicle_id         uuid,
           lat                double precision,
           lng                double precision,
           heading_degrees    double precision,
           speed_mph          double precision,
           is_ecu_speed       boolean,
           formatted_location text,
           sampled_at         timestamptz
         )
   where r.vehicle_id is not null
     and r.lat is not null
     and r.lng is not null
     and r.sampled_at is not null
  on conflict (org_id, vehicle_id) do update
     set lat                = excluded.lat,
         lng                = excluded.lng,
         heading_degrees    = excluded.heading_degrees,
         speed_mph          = excluded.speed_mph,
         is_ecu_speed       = excluded.is_ecu_speed,
         formatted_location = excluded.formatted_location,
         sampled_at         = excluded.sampled_at,
         received_at        = excluded.received_at,
         source             = excluded.source
   -- The only-go-forward guard. A re-delivered page carries samples we already stored; writing them
   -- again is harmless, but writing an OLDER one over a newer one is not, and this table has no past
   -- to restore the newer one from. Equal timestamps are also refused: the row is already correct and
   -- moving `received_at` for it would say the feed delivered something it did not.
   where excluded.sampled_at > vp.sampled_at;
  get diagnostics written = row_count;
  return written;
end;
$$;

revoke all on function public.record_vehicle_positions(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_vehicle_positions(uuid, jsonb) to service_role;

comment on function public.record_vehicle_positions(uuid, jsonb) is
  'Set-based insert-or-advance of vehicle_positions for one org (LM4). Tenant scope is p_org, never a value in the payload. A row is only overwritten by a STRICTLY NEWER sampled_at, because the delta feed is at-least-once and this table keeps no history. Returns rows written.';
