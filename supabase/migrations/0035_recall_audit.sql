-- 0035: recall sampling audit. A reviewer audits a random sample of CLEARED, telematics-COVERED fills
-- and marks each 'clean' or 'missed' (a false negative). Those verdicts let recall be MEASURED, not
-- guessed. Verdict lives on the transaction (one current verdict per fill); the API records who/when.
alter table fuel_transactions add column if not exists audit_verdict text
  check (audit_verdict in ('clean', 'missed'));
alter table fuel_transactions add column if not exists audit_note text;
alter table fuel_transactions add column if not exists audit_by   uuid references auth.users(id);
alter table fuel_transactions add column if not exists audit_at   timestamptz;

-- Fast "already audited?" checks and recall counts.
create index if not exists idx_ftxn_audit on fuel_transactions (org_id, audit_verdict) where audit_verdict is not null;

-- Random sample of un-audited, cleared, telematics-covered TRACTOR fills for the recall audit queue.
-- Called by the API with the service role, so it takes the org explicitly and filters on it (the API has
-- already authorized the caller's org). STABLE; order-by-random over one org's cleared pool is fine.
create or replace function sample_clear_transactions(p_org uuid, p_limit int)
returns setof fuel_transactions
language sql
stable
as $$
  select *
  from fuel_transactions
  where org_id = p_org
    and coalesce(has_anomaly, false) = false   -- the engine cleared it (no case)
    and audit_verdict is null                  -- not yet audited
    and samsara_recon_at is not null           -- COVERED: a miss here is a real miss, not a blind spot
    and tank_type is distinct from 'reefer'    -- tractor fills; reefer has its own program
  order by random()
  limit greatest(coalesce(p_limit, 0), 0);
$$;
