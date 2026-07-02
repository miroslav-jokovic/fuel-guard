-- FuelGuard — 0023 denormalize the fueling date onto anomalies
-- Anomalies were filtered/sorted by created_at (DETECTION time), but a rebuild re-creates every anomaly
-- "today", making the date filter useless and hiding older activity. Store the transaction's fueling
-- time on the anomaly so the queue can be filtered/sorted by when the fill actually happened.
alter table anomalies add column if not exists fueled_at timestamptz;
create index if not exists idx_anomaly_org_fueled on anomalies (org_id, fueled_at desc);

-- Backfill existing rows from their transaction (safe to re-run).
update anomalies a
set fueled_at = t.fueled_at
from fuel_transactions t
where a.transaction_id = t.id and a.fueled_at is null;
