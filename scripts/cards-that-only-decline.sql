-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- THE 40 CARDS THAT ONLY EVER DECLINE.  Read-only.
--
-- 556 declines, 40 cards, 10 trucks, 2026-02-04 → 2026-08-11, and not ONE approved fill among them.
-- A card that fails 14 times on average over six months and never succeeds is not a missing-name
-- problem. This asks the three questions that separate the innocent explanations from the rest:
--
--   • Is the card even in your EFS account?  (efs_cards mirror, matched on last 4)
--   • If it is, what is its status?          (Inactive/Hold/Deleted = someone is trying a dead card)
--   • What is EFS actually refusing, and on whose truck?
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
with blank as (
  select d.*, regexp_replace(coalesce(d.card_ref,''), '\D','','g') as cd
  from declined_transactions d
  where nullif(btrim(d.driver_name),'') is null
),
posted as (select distinct regexp_replace(coalesce(card_num,''),'\D','','g') as cd from efs_transactions),
never_approved as (
  select b.* from blank b
  where length(b.cd) >= 15 and not exists (select 1 from posted p where p.cd = b.cd)
),
-- Mirror match is on LAST 4 only: card_ref_hmac needs the app's key, which SQL cannot compute.
-- Good enough to answer "does EFS know this card at all"; not an identity claim.
mirror as (
  select card_last4, max(status) as status, max(driver_name) as driver_name, count(*) as cards_with_last4
  from efs_cards where absent_since is null group by card_last4
)
select
  right(n.cd, 4)                                   as card_last4,
  count(*)                                         as declines,
  count(distinct n.unit)                           as units_tried,
  string_agg(distinct coalesce(n.unit,'(none)'), ', ' order by coalesce(n.unit,'(none)')) as units,
  string_agg(distinct n.error_code, ',' order by n.error_code)                            as error_codes,
  min(n.declined_at)::date                         as first_seen,
  max(n.declined_at)::date                         as last_seen,
  coalesce(m.status, 'NOT IN EFS ACCOUNT')         as efs_card_status,
  coalesce(m.driver_name, '—')                     as efs_assigned_driver,
  coalesce(m.cards_with_last4, 0)                  as mirror_rows_sharing_last4
from never_approved n
left join mirror m on m.card_last4 = right(n.cd, 4)
group by right(n.cd,4), m.status, m.driver_name, m.cards_with_last4
order by declines desc;
