-- FuelGuard — 0105 canonical card segment in external_ref  ⚠️ OPT-IN — DO NOT APPLY BLIND
--
-- APPLY THIS ONLY TOGETHER WITH the matching code change (docs/plans/EFS-REF-CANONICAL-CARD.patch).
-- Code and data must flip in the SAME deploy or every subsequent import inserts duplicates.
--
-- WHY
-- `external_ref` — the row-level idempotency key for both fuel_transactions and efs_transactions — is
-- built as `<card>|<invoice-or-txn-id>|<business-date>[|reefer]`. The `<card>` segment is whatever the
-- report printed. That was stable while EFS printed one format. It no longer is:
--
--   • the file reports now print a MASKED card ("708305XXXXXX1234" / "1234");
--   • the SOAP feed (getMCTransExtLocV2) returns the FULL card number.
--
-- So the SAME transaction arriving by file and by SOAP produces two different external_refs, the
-- `on conflict (org_id, external_ref) do nothing` upsert sees no conflict, and you get a DUPLICATE
-- fuel_transaction. Duplicates are then scored independently and feed rapid_repeat_fueling,
-- cumulative_overfuel and the card vehicle count — a fresh class of false alerts, appearing the day
-- the SOAP feed is switched on.
--
-- WHAT THIS DOES
-- Rewrites the leading `<card>` segment of every existing external_ref to the card's LAST 4 DIGITS,
-- which is the one form both sources can always produce. The code change makes new refs use the same
-- form. Nothing else in the ref changes, so refs stay date- and invoice-scoped exactly as before.
--
-- ── STEP 1 — PRE-FLIGHT (run this ALONE first; it changes nothing) ───────────────────────────────
-- Two rows that only differed by card FORMAT will collapse to the same ref. That is the point — but
-- it means the pair is a duplicate pair, and duplicates must be resolved by a human, not silently
-- merged by a migration, because anomalies and imports reference these ids. Expect ZERO rows here on
-- a clean database. Any rows returned = review them before running STEP 2.
--
--   with canon as (
--     select id, org_id, external_ref, fueled_at, gallons, total_cost, card_ref,
--            right(regexp_replace(split_part(external_ref, '|', 1), '\D', '', 'g'), 4)
--              || substr(external_ref, position('|' in external_ref)) as new_ref
--       from fuel_transactions
--      where position('|' in external_ref) > 0
--   )
--   select org_id, new_ref, count(*) as rows, array_agg(id) as ids,
--          array_agg(card_ref) as card_refs, array_agg(gallons) as gallons
--     from canon group by org_id, new_ref having count(*) > 1
--    order by rows desc;
--
--   -- same check for the faithful store
--   with canon as (
--     select id, org_id,
--            right(regexp_replace(split_part(external_ref, '|', 1), '\D', '', 'g'), 4)
--              || substr(external_ref, position('|' in external_ref)) as new_ref
--       from efs_transactions
--      where position('|' in external_ref) > 0
--   )
--   select org_id, new_ref, count(*) from canon group by org_id, new_ref having count(*) > 1;
--
-- ── STEP 2 — THE REWRITE ────────────────────────────────────────────────────────────────────────
-- Wrapped in a transaction. If STEP 1 was skipped and collisions exist, the unique index raises and
-- the whole thing rolls back — no half-migrated state. Idempotent: a second run is a no-op because
-- an already-canonical ref fails the last predicate.

begin;

update fuel_transactions
   set external_ref = right(regexp_replace(split_part(external_ref, '|', 1), '\D', '', 'g'), 4)
                      || substr(external_ref, position('|' in external_ref))
 where position('|' in external_ref) > 0
   and length(regexp_replace(split_part(external_ref, '|', 1), '\D', '', 'g')) >= 4
   and split_part(external_ref, '|', 1)
       <> right(regexp_replace(split_part(external_ref, '|', 1), '\D', '', 'g'), 4);

update efs_transactions
   set external_ref = right(regexp_replace(split_part(external_ref, '|', 1), '\D', '', 'g'), 4)
                      || substr(external_ref, position('|' in external_ref))
 where position('|' in external_ref) > 0
   and length(regexp_replace(split_part(external_ref, '|', 1), '\D', '', 'g')) >= 4
   and split_part(external_ref, '|', 1)
       <> right(regexp_replace(split_part(external_ref, '|', 1), '\D', '', 'g'), 4);

commit;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────────
-- Not reversible by SQL (the original card segment is not recoverable from the rewritten ref). Take a
-- snapshot / PITR checkpoint before STEP 2. Reverting the code alone is safe but will start minting
-- old-form refs again → duplicates; revert both or neither.
