-- FuelGuard — 0014 Upsert-safe unique indexes for idempotent import
-- The import commits rows with a PostgREST upsert (on_conflict=org_id,external_ref). A PARTIAL unique
-- index (… where external_ref is not null) CANNOT serve as an ON CONFLICT arbiter unless the query
-- repeats the index predicate — which PostgREST does not send — so every import returned HTTP 400
-- ("no unique or exclusion constraint matching the ON CONFLICT specification"). This affected all
-- three faithful/import tables: fuel_transactions, declined_transactions, efs_transactions.
--
-- Fix: rebuild each as a FULL unique index on (org_id, external_ref). NULLs remain distinct (Postgres
-- default NULLS DISTINCT), so rows with a null external_ref still insert freely — identical practical
-- behavior to the old partial index, but now usable as an upsert conflict target.

drop index if exists idx_ftxn_external_ref;
create unique index idx_ftxn_external_ref on fuel_transactions (org_id, external_ref);

drop index if exists idx_declined_external_ref;
create unique index idx_declined_external_ref on declined_transactions (org_id, external_ref);

drop index if exists idx_efs_txn_extref;
create unique index idx_efs_txn_extref on efs_transactions (org_id, external_ref);
