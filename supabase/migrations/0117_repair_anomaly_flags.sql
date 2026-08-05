-- 0117: one-time repair of fuel_transactions.has_anomaly / max_severity.
--
-- Detection logic has changed repeatedly since fills were first scored, and rebuilds SUPERSEDE
-- anomaly rows without re-scoring every historical fill (the nightly rules-only rebuild is bounded to
-- recent days on purpose). Result: ~1.2k fills flagged red in the Fuel Log whose anomalies no longer
-- exist on the Alerts page — clicking a flagged row dead-ends on an empty list. The nightly reconcile
-- now keeps the flags converged going forward (services/anomalyFlagReconcile.ts); this migration
-- performs the same repair ONCE at apply time so the numbers are correct immediately, not tomorrow.

-- 1) Clear flags with no live (non-superseded) anomaly behind them.
update fuel_transactions t
set has_anomaly = false,
    max_severity = null
where t.has_anomaly = true
  and not exists (
    select 1 from anomalies a
    where a.transaction_id = t.id
      and a.status <> 'superseded'
  );

-- 2) Restore flags the other direction: fills with live anomalies but no mark, at the correct max
--    severity.
with live as (
  select a.transaction_id,
         max(case a.severity when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end) as sev_rank
  from anomalies a
  where a.status <> 'superseded'
    and a.transaction_id is not null
  group by a.transaction_id
)
update fuel_transactions t
set has_anomaly = true,
    max_severity = case live.sev_rank when 4 then 'critical' when 3 then 'high' when 2 then 'medium' else 'low' end
from live
where t.id = live.transaction_id
  and t.has_anomaly = false;
