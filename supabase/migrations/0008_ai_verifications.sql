-- FuelGuard — 0008 AI verification layer (docs/07-AI-VERIFICATION.md §5)
-- Stores Claude's explainable risk assessment for flagged transactions. The kill-switch
-- (anomaly_thresholds.ai_verification_enabled) and budget (ai_monthly_token_budget) and the
-- denormalized fuel_transactions.ai_risk_level column already exist (migration 0003).

create table ai_verifications (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  transaction_id     uuid not null references fuel_transactions(id) on delete cascade,
  anomaly_id         uuid references anomalies(id) on delete set null,
  model              text not null,                 -- 'claude-haiku-4-5' | 'claude-sonnet-4-6'
  risk_score         int not null,                  -- 0-100
  risk_level         anomaly_severity not null,
  location_plausible boolean,
  implied_speed_mph  numeric(6,1),
  summary            text not null,
  recommended_action text not null,                 -- monitor|investigate|contact_driver|block_card|none
  contributing_factors text[] not null default '{}',
  confidence         numeric(4,3),                  -- 0.000-1.000
  raw_response       jsonb not null default '{}',
  input_hash         text not null,                 -- cache key / dedup
  token_usage        jsonb,                         -- {input, output}
  created_at         timestamptz not null default now()
);
create index idx_ai_verifications_org_time on ai_verifications (org_id, created_at desc);
create index idx_ai_verifications_txn on ai_verifications (transaction_id);
create unique index idx_ai_verifications_cache on ai_verifications (org_id, input_hash);

-- RLS: read = org members; writes are service-role only (the API performs them).
alter table ai_verifications enable row level security;
create policy ai_verifications_select on ai_verifications
  for select using (org_id = auth_org_id());
