-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- RESTORE CAPACITIES POISONED BY THE DOWNWARD AUTO-FIX (2026-08 incident).
--
-- The rebuild's learn pre-pass rewrote tank_capacity_gal DOWNWARD on ~30 trucks (240 → ~177–203,
-- one 240 → 117.9) via decideCapacityAutoFix 'corrected_divergent' — the plateau-peak sensor bias
-- written through as a record change. After the rewrite, entered == sensor read as "agreement"
-- (high confidence, tight tolerance), so the corruption also hid its own divergence flag.
--
-- ⚠ ORDER: deploy the code fix FIRST (capacityResolve.ts: downward auto-fix disabled,
-- sensor-below-entered no longer overrides). If you restore before deploying, the next learn
-- pass re-poisons every record.
--
-- Every rewrite was audit-logged with beforeGal + previousSource, so this restore is exact.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- PREVIEW — what will be restored (earliest downward rewrite per vehicle wins; if a vehicle was
-- rewritten more than once, the first 'before' is the original human value).
with fixes as (
  select distinct on (entity_id)
         entity_id as vehicle_id,
         (meta->>'beforeGal')::numeric as before_gal,
         nullif(meta->>'previousSource', '') as prev_source,
         created_at
  from audit_logs
  where action = 'vehicle.capacity_autofix'
    and meta->>'reason' = 'corrected_divergent'
    and (meta->>'beforeGal') is not null
    and (meta->>'afterGal')::numeric < (meta->>'beforeGal')::numeric  -- downward rewrites only
  order by entity_id, created_at asc
)
select v.unit_number, v.tank_capacity_gal as current_gal, f.before_gal as restore_to,
       coalesce(f.prev_source, 'manual') as restore_source, f.created_at as poisoned_at
from fixes f
join vehicles v on v.id = f.vehicle_id
order by v.unit_number;

-- RESTORE — run after reviewing the preview.
begin;

with fixes as (
  select distinct on (entity_id)
         entity_id as vehicle_id,
         (meta->>'beforeGal')::numeric as before_gal,
         nullif(meta->>'previousSource', '') as prev_source
  from audit_logs
  where action = 'vehicle.capacity_autofix'
    and meta->>'reason' = 'corrected_divergent'
    and (meta->>'beforeGal') is not null
    and (meta->>'afterGal')::numeric < (meta->>'beforeGal')::numeric
  order by entity_id, created_at asc
)
update vehicles v
set tank_capacity_gal    = f.before_gal,
    tank_capacity_source = coalesce(f.prev_source, 'manual')
from fixes f
where v.id = f.vehicle_id;

commit;

-- Sanity: no vehicle should remain with an auto-set capacity BELOW its sensor's observed-max fill
-- context; and the restored trucks should show their human values again.
select unit_number, tank_capacity_gal, tank_capacity_source, sensor_capacity_gal
from vehicles
where sensor_capacity_gal is not null
order by unit_number;
