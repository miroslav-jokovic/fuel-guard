-- FuelGuard — 0080 persist the correlation outcome on every scored fill (WP2 "why" surface,
-- docs/plans/WP2-CORRELATION-SPEC.md). Previously a fired-but-sub-threshold signal (e.g. a lone
-- odometer regression, weight 55 < review 60) left NO trace anywhere — the fill just read "clear".
-- Storing (level, score, signals) makes every outcome explainable in the UI, including clear ones.
alter table fuel_transactions add column if not exists case_level   text;
alter table fuel_transactions add column if not exists case_score   numeric;
alter table fuel_transactions add column if not exists case_signals jsonb;
