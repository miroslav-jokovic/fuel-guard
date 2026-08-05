-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- DUPLICATION AUDIT (2026-08) — run each block in the Supabase SQL editor and review.
-- Root context: the fleet appeared fully duplicated (same samsara_vehicle_id, two created_at
-- batches). Block 0 determines whether that is TWO ORGS ingesting the same feeds (most likely)
-- or true same-org twins. Blocks 1–7 sweep every identity key for duplicates, org-scoped.
-- Run BEFORE applying migration 0123 (its unique indexes will refuse to build over duplicates —
-- that is the point: they make this entire class of bug structurally impossible afterward).
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- 0. THE ORG QUESTION — is the "duplication" actually a second organization?
select o.id, o.name, o.created_at,
       (select count(*) from vehicles v where v.org_id = o.id)          as vehicles,
       (select count(*) from fuel_transactions t where t.org_id = o.id) as fills,
       (select count(*) from hos_duty_segments h where h.org_id = o.id) as hos_segments,
       (select count(*) from anomalies a where a.org_id = o.id)         as alerts
from organizations o order by o.created_at;

-- Same Samsara trucks appearing in MORE THAN ONE org (the duplicate-org fingerprint):
select samsara_vehicle_id, count(distinct org_id) as orgs, array_agg(distinct org_id) as org_ids
from vehicles where samsara_vehicle_id is not null
group by 1 having count(distinct org_id) > 1 limit 10;

-- 1. Vehicles — org-scoped duplicate identity keys (each should return 0 rows):
select org_id, samsara_vehicle_id, count(*) from vehicles
where samsara_vehicle_id is not null group by 1,2 having count(*) > 1;

select org_id, upper(vin) as vin, count(*) from vehicles
where vin is not null and vin <> '' group by 1,2 having count(*) > 1;

select org_id, unit_number, count(*) from vehicles
where status = 'active' group by 1,2 having count(*) > 1;

-- 2. Drivers — duplicate telematics / fuel-card identities:
select org_id, samsara_driver_id, count(*) from drivers
where samsara_driver_id is not null group by 1,2 having count(*) > 1;

select org_id, efs_driver_id, count(*) from drivers
where efs_driver_id is not null group by 1,2 having count(*) > 1;

-- Name-only near-duplicates (informational — the merge_driver flow handles these):
select org_id, lower(trim(full_name)) as name, count(*) from drivers
group by 1,2 having count(*) > 1 limit 20;

-- 3. Fuel transactions — the money data. external_ref is the import dedup key:
select org_id, external_ref, count(*) from fuel_transactions
where external_ref is not null group by 1,2 having count(*) > 1 limit 20;

-- Content-level duplicates external_ref missed (same instant+gallons+card, different rows):
select org_id, fueled_at, gallons, card_ref, count(*) as copies,
       count(distinct vehicle_id) as distinct_vehicles
from fuel_transactions
group by 1,2,3,4 having count(*) > 1
order by copies desc limit 20;

-- 4. EFS raw store:
select org_id, transaction_id, count(*) from efs_transactions
where transaction_id is not null group by 1,2 having count(*) > 1 limit 10;

-- 5. Anomalies — more than one OPEN case per (transaction, rule):
select transaction_id, rule_id, count(*) from anomalies
where status = 'open' group by 1,2 having count(*) > 1 limit 10;

-- 6. Trailers:
select org_id, unit_number, count(*) from trailers
where status <> 'retired' group by 1,2 having count(*) > 1 limit 10;

-- 7. Idle events — same truck, same start instant, multiple rows:
select org_id, vehicle_id, started_at, count(*) from idle_events
group by 1,2,3 having count(*) > 1 limit 10;
