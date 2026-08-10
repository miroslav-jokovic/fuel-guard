-- FuelGuard — 0163 audit_logs action search index
-- The Audit Log settings page filters by action prefix with `.ilike(...)` and
-- requests `count: "exact"`. Without an index on `action`, Postgres scans the
-- whole per-org audit set to compute the count, which times out for orgs with
-- many events. A GIN trigram index makes prefix `ilike` lookups fast.

create extension if not exists pg_trgm;

create index idx_audit_action_trgm on audit_logs using gin (action gin_trgm_ops);
