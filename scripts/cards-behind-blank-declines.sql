-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- THE 22 CARDS BEHIND 527 BLANK DECLINES.  Read-only.
--
-- Buckets C + D: cards WITH approved fills whose posted rows carry no driver name (and, for D, no
-- EFS driver ID either), and whose declines mostly carry no Unit. A card that transacts without a
-- driver prompt, a unit prompt or a driver id is a card EFS is not asking the driver to identify
-- themselves on — which is a card-configuration fact, visible in the mirror.
--
-- The mirror columns below come from getCardSummaries / getCardv2:
--   driver_name      — the driver EFS has assigned to the card  (this is the name we can still show)
--   driver_id_prompt — DRID prompt configured on the card
--   unit_prompt      — UNIT prompt configured on the card
-- A card with a driver_name but no prompts explains BOTH the blank Driver column and the blank Unit.
--
-- ⚠ Matched on LAST 4 only — card_ref_hmac needs the app's key. `mirror_rows_sharing_last4 > 1`
--   means this row is a guess; the API resolver does the exact-PAN version.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
with blank as (
  select regexp_replace(coalesce(card_ref,''), '\D','','g') as cd, unit, declined_at
  from declined_transactions
  where nullif(btrim(driver_name),'') is null
),
card_stats as (
  select regexp_replace(coalesce(card_num,''),'\D','','g') as cd,
         count(*) as posted_rows,
         count(*) filter (where nullif(btrim(driver_name),'') is not null) as rows_with_name
  from efs_transactions group by 1
),
targets as (
  select b.cd, count(*) as declines, count(distinct b.unit) as units_seen,
         min(b.declined_at)::date as first_seen, max(b.declined_at)::date as last_seen,
         max(cs.posted_rows) as approved_fills
  from blank b
  join card_stats cs on cs.cd = b.cd and cs.rows_with_name = 0
  where length(b.cd) >= 15
  group by b.cd
),
mirror as (
  select card_last4,
         max(status) as status, max(driver_name) as driver_name,
         max(driver_id_prompt) as driver_id_prompt, max(unit_prompt) as unit_prompt,
         count(*) as rows_sharing_last4
  from efs_cards where absent_since is null group by card_last4
)
select right(t.cd,4)                            as card_last4,
       t.declines, t.approved_fills, t.units_seen, t.first_seen, t.last_seen,
       coalesce(m.status,'NOT IN MIRROR')       as efs_status,
       coalesce(m.driver_name,'—')              as mirror_driver_name,
       coalesce(m.driver_id_prompt,'—')         as drid_prompt,
       coalesce(m.unit_prompt,'—')              as unit_prompt,
       coalesce(m.rows_sharing_last4,0)         as mirror_rows_sharing_last4
from targets t
left join mirror m on m.card_last4 = right(t.cd,4)
order by t.declines desc;
