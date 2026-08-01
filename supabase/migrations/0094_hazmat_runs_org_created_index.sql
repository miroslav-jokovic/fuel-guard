-- Index for the per-org monthly token tally in hazmatExtraction/orchestrate.ts (tokensUsedThisMonth),
-- which filters hazmat_runs by org_id + created_at >= month-start before every extraction. The existing
-- (org_id, load_id, created_at desc) index cannot serve an org_id + created_at range without load_id, so
-- Postgres range-scanned the org's entire run history (and dragged every `models` jsonb over) each time.
-- See ARCHITECTURE-AUDIT-2026-08-01 finding P1-B.
create index if not exists idx_hazmat_runs_org_created
  on hazmat_runs (org_id, created_at desc);
