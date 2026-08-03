-- FuelGuard — 0107 store EFS's own transaction identifier
--
-- WHY
-- The EFS Card Web Service Integration Guide names the authoritative key for a fuel transaction:
--
--   transactionId  int (40)  "EFS LLC transaction ID. This is unique for each transaction and can be
--                             used as the unique identifier for the transaction."
--
-- and the integration tips ask consumers to reconcile with it:
--
--   "put in a daily check to make sure the end system has received all fuel card transactions for the
--    previous day... make sure all transaction IDs are inputted."
--
-- We were not storing it. Identity was inferred instead from `external_ref`, a composite of
-- card + invoice + business date — which is stable WITHIN one delivery channel and incompatible
-- ACROSS them: a file report keys on the Invoice column while the SOAP feed supplies a Stable
-- Transaction ID, so the same physical fill arriving both ways produced two rows that no constraint
-- could recognise as one. That is precisely the duplication observed on 2026-08-03 (248 duplicated
-- fills in a single month).
--
-- Storing the vendor's identifier makes the invariant enforceable in the database rather than
-- reconstructed by string assembly in three different parsers.
--
-- ── Why the fuel_transactions index includes tank_type ─────────────────────────────────────────
-- One EFS transaction is NOT one fueling event. A driver who fills the tractor and the reefer on one
-- swipe produces a single transactionId with two line items, which we deliberately split into two
-- fuel_transactions rows so reefer gallons never inflate the tractor's capacity/MPG checks. Observed:
--
--   7083050030485897149|1539602272|2026-06-04           113.63 gal   (tractor)
--   7083050030485897149|1539602272|2026-06-04|reefer     13.49 gal   (reefer)
--
-- So the unique identity of a fueling event is (org, transactionId, tank_type). A unique index on
-- transactionId alone would reject the reefer line as a duplicate and silently lose the gallons.
--
-- efs_transactions is the FAITHFUL line-level store — one row per line item, several per transaction —
-- so it gets a plain lookup index, not a unique one. Its uniqueness stays on external_ref.
--
-- ── Nullable on purpose ────────────────────────────────────────────────────────────────────────
-- Both indexes are partial (`where transaction_id is not null`). A report variant that omits the
-- column still ingests; it simply falls back to external_ref dedupe as before. Fail-open here is
-- correct: refusing to ingest a fill because the vendor left a field blank would lose real data to
-- protect against a duplicate we can detect other ways.
--
-- Rollback:
--   drop index if exists idx_ftxn_efs_txn_identity;
--   drop index if exists idx_efs_txn_transaction_id;
--   alter table fuel_transactions drop column if exists transaction_id;
--   alter table efs_transactions  drop column if exists transaction_id;

alter table efs_transactions  add column if not exists transaction_id text;
alter table fuel_transactions add column if not exists transaction_id text;

comment on column fuel_transactions.transaction_id is
  'EFS transactionId — the vendor''s unique identifier for the transaction. Unique per (org, id, tank_type): one transaction can yield a tractor line and a reefer line.';
comment on column efs_transactions.transaction_id is
  'EFS transactionId. NOT unique here — the faithful store holds one row per line item.';

create index if not exists idx_efs_txn_transaction_id
  on efs_transactions (org_id, transaction_id)
  where transaction_id is not null;

create unique index if not exists idx_ftxn_efs_txn_identity
  on fuel_transactions (org_id, transaction_id, tank_type)
  where transaction_id is not null;
