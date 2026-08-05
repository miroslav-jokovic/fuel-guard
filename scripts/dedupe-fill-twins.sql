-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- DEDUPE FILL TWINS (2026-08 duplication incident, fuel_transactions content twins).
--
-- Root cause: the store-derive repair path (syncFuelEventsFromEfs) matched existing fills by
-- external_ref only. The direct parser keys refs on `Stable Transaction ID` while the store keeps
-- the merged transaction_id (stable ?? TransactionId), so file variants carrying only
-- `TransactionId` derived a DIFFERENT ref at repair time — and the repair inserted a twin of every
-- such fill (two rows, two refs, one physical dispense). The sync-inserted twin also lacked
-- transaction_id/control_id, so the txn-identity dedup could never catch it afterwards.
--
-- These twins DOUBLE the rolling-window gallons of their truck, which is what mass-fired
-- cumulative_overfuel (75) and, with any odometer-axis wobble (45–55), pushed hundreds of fills
-- over the 110 alert threshold after the clean rebuild.
--
-- ORDER OF OPERATIONS:
--   1. Run the PREVIEW below and eyeball the twin pairs + keeper choice.
--   2. Run the DELETE block (single transaction).
--   3. Apply migration 0124 (supabase db push) — its unique index refuses duplicates from here on.
--   4. Full rebuild: POST /transactions/rebuild with {} — windows halve back to reality and the
--      rebuild supersedes the anomaly cases that no longer fire.
--
-- KEEPER CHOICE, per twin group (org, card_ref, fueled_at, gallons, tank_type):
--   samsara-reconciled copy > has transaction_id > has control_id > has odometer > oldest row.
-- The loser's anomalies rows are deleted with it (they are per-transaction detection outcomes,
-- not reviewer work — pre-launch dispositions were already wiped by reset-detection).
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- ── PREVIEW ──────────────────────────────────────────────────────────────────────────────────
with ranked as (
  select t.id, t.org_id, t.card_ref, t.fueled_at, t.gallons, t.external_ref, t.transaction_id,
         t.samsara_recon_at, t.created_at,
         row_number() over (
           partition by t.org_id, t.card_ref, t.fueled_at, t.gallons, coalesce(t.tank_type, 'tractor')
           order by (t.samsara_recon_at is not null) desc,
                    (t.transaction_id  is not null) desc,
                    (t.control_id      is not null) desc,
                    (t.odometer        is not null) desc,
                    t.created_at asc, t.id asc
         ) as rn,
         count(*) over (
           partition by t.org_id, t.card_ref, t.fueled_at, t.gallons, coalesce(t.tank_type, 'tractor')
         ) as copies
  from fuel_transactions t
  where t.card_ref is not null -- card-less (manual) rows have no content identity — never grouped
)
select fueled_at, gallons, right(card_ref, 4) as card4, external_ref,
       (transaction_id is not null) as has_txn_id,
       (samsara_recon_at is not null) as reconciled,
       case when rn = 1 then 'KEEP' else 'DELETE' end as action
from ranked
where copies > 1
order by fueled_at, card_ref, rn
limit 100;

-- ── DELETE (run after reviewing the preview) ─────────────────────────────────────────────────
begin;

with ranked as (
  select t.id,
         row_number() over (
           partition by t.org_id, t.card_ref, t.fueled_at, t.gallons, coalesce(t.tank_type, 'tractor')
           order by (t.samsara_recon_at is not null) desc,
                    (t.transaction_id  is not null) desc,
                    (t.control_id      is not null) desc,
                    (t.odometer        is not null) desc,
                    t.created_at asc, t.id asc
         ) as rn
  from fuel_transactions t
  where t.card_ref is not null
),
losers as (
  select id from ranked where rn > 1
),
del_anomalies as (
  delete from anomalies where transaction_id in (select id from losers)
  returning id
)
delete from fuel_transactions where id in (select id from losers);

commit;

-- Sanity: should return 0 rows afterwards.
select org_id, fueled_at, gallons, card_ref, count(*)
from fuel_transactions
group by 1, 2, 3, 4, coalesce(tank_type, 'tractor')
having count(*) > 1
limit 5;
