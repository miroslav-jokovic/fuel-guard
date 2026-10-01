-- Silvicom 360 — 0398 one key per Samsara idling event (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md I0, W1)
--
-- ── THE GAP (measured 2026-10-01, production, read-only) ────────────────────────────────────────
-- Samsara's GET /idling/events returns the same event under TWO `eventUuid` spellings: the real
-- UUID (`3411b05c-3d84-4ad3-…`), and — since 2026-09-14 — the hex of the uppercase ASCII of its
-- first sixteen hex digits, laid out as a UUID (`33343131-4230-3543-…` = "3411B05C3D844AD3").
-- 0042 made `samsara_event_id` the idempotency key, so each spelling became its own row: 258,824
-- rows grouped by that sixteen-digit prefix are 142,538 singles and 58,143 PAIRS, never a triple,
-- reaching back to events of 2026-08-15. Every driver idle figure over that span reads twice the
-- truth (Sep 1–28: 52,281 h stored vs 25,850 h of engine-state idle).
--
-- ── WHY THIS SHAPE ──────────────────────────────────────────────────────────────────────────────
-- `event_key` is the sixteen-digit prefix both spellings share, computed in ONE place
-- (`idleEventKey`, packages/shared) and written by the API — never derived here, so there is no
-- second copy of the decoding rule to drift. The unique index is created NOW, over a column that is
-- null on every existing row: a unique index admits any number of nulls, so the 58,143 pairs do not
-- block it, and the moment a row is keyed its twin can no longer be keyed beside it.
--
-- `resolve_idle_event_twins` is the one write the clean-up job needs: delete the redundant spelling
-- of each pair and key the survivor, in that order, in one statement per call — so a pair is never
-- momentarily two keyed rows. The job, not this file, decides which rows; this file migrates no
-- data, and the deletion is audited by the job (plan §6 I0: "through an audited job, not raw SQL").
--
-- ── REJECTED ────────────────────────────────────────────────────────────────────────────────────
-- · (vehicle_id, started_at, duration_sec) as the key — the plan's first draft. Five pairs from
--   2026-08-24 have the vehicle on one spelling and NULL on the other; that key misses them.
-- · A STORED generated column — puts the decoding rule in SQL as well as in the sync (which must
--   de-duplicate a fetch before it reaches the database), and rewrites a 131 MB table on the Micro
--   instance. A plain column costs a catalogue update.
-- · Re-keying `samsara_event_id` itself — the hex spelling cannot be turned back into the full
--   UUID, and rewriting the id of 200k rows changes what every existing reference means.
--
-- Ships ALONE (lint:migration-ordering): the writer arrives in the next merge. Until then the
-- deployed sync writes rows with a null key, which the index admits and the job later keys.
--
-- Rollback: drop the function, the index and the column. No data is migrated by this file.

alter table public.idle_events add column if not exists event_key text;

comment on column public.idle_events.event_key is
  'The Samsara idling event''s identity independent of spelling: the first 16 hex digits of its eventUuid, lower case (idleEventKey, packages/shared). Null only until the twin clean-up keys a row written before I0.';

create unique index if not exists idx_idle_events_org_event_key on public.idle_events (org_id, event_key);

create or replace function public.resolve_idle_event_twins(p_org uuid, p_delete uuid[], p_keys jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  deleted int;
  keyed int;
begin
  -- Twins first: the survivor's key is the twin's key, so keying before deleting would collide.
  delete from public.idle_events e
   where e.org_id = p_org        -- tenant scope is the caller's org, never a value inside the payload
     and e.id = any(coalesce(p_delete, '{}'::uuid[]));
  get diagnostics deleted = row_count;

  update public.idle_events e
     set event_key = r.event_key
    from jsonb_to_recordset(coalesce(p_keys, '[]'::jsonb)) as r(id uuid, event_key text)
   where e.id = r.id
     and e.org_id = p_org;
  get diagnostics keyed = row_count;

  return jsonb_build_object('deleted', deleted, 'keyed', keyed);
end;
$$;

revoke all on function public.resolve_idle_event_twins(uuid, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.resolve_idle_event_twins(uuid, uuid[], jsonb) to service_role;

comment on function public.resolve_idle_event_twins(uuid, uuid[], jsonb) is
  'For one org: delete the given idle_events rows (redundant spellings of a Samsara event), then set event_key on the given rows. Called only by the audited twin clean-up job (I0). Returns {deleted, keyed}.';
