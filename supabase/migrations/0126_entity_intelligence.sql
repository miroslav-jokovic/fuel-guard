-- 0126: Entity intelligence, Phase 2 storage (2026-08 plan) — the flag-triggered retrospective
-- pattern sweep persists ONE report per case. Phase 1 (the entity risk context) is deliberately
-- DERIVED ON READ from the source tables (anomalies + fuel_transactions.case_signals +
-- declined_transactions) — no counter table to drift out of sync; the sub-threshold "why clear"
-- surface persisted by WP2 is the raw material and already exists.
create table if not exists case_pattern_reports (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  anomaly_id    uuid not null references anomalies(id) on delete cascade,
  vehicle_id    uuid references vehicles(id) on delete set null,
  driver_id     uuid references drivers(id) on delete set null,
  card_ref      text,
  lookback_days int not null default 180,
  -- The sweep output: signal-frequency table, near-threshold timeline, station concentration,
  -- decline→success sequences, entity totals. Versioned inside the blob (report.version) so the
  -- analyzer can evolve without migrations.
  report        jsonb not null,
  generated_at  timestamptz not null default now()
);

-- One report per case; a re-sweep replaces it (upsert target).
create unique index if not exists uq_case_pattern_report_anomaly on case_pattern_reports (anomaly_id);
create index if not exists idx_case_pattern_reports_org on case_pattern_reports (org_id, generated_at desc);

alter table case_pattern_reports enable row level security;
drop policy if exists case_pattern_reports_select on case_pattern_reports;
create policy case_pattern_reports_select on case_pattern_reports
  for select using (org_id = auth_org_id());
-- writes: service role only (the sweep job), same posture as the other derived tables.

-- The sweep and the risk context both scan an entity's trailing fills — give the driver axis the
-- same index quality the vehicle axis already has.
create index if not exists idx_ftxn_driver_fueled on fuel_transactions (driver_id, fueled_at desc)
  where driver_id is not null;
