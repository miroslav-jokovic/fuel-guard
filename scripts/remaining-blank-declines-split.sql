-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- THE REMAINING BLANK DECLINES, SPLIT HONESTLY.  Read-only.
--
-- Correcting my own error: the earlier "never had an approved fill" bucket asked whether the card
-- had a posted row WITH A DRIVER NAME. That silently merged two very different populations —
-- cards with no history at all, and cards with plenty of history whose rows simply carry no name.
-- The follow-up query used the other definition, which is why it returned 29 declines and not 556.
-- This one separates them, and measures the fill still available from the EFS driver ID.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
with blank as (
  select d.id, d.unit, d.card_ref, d.declined_at,
         regexp_replace(coalesce(d.card_ref,''), '\D','','g') as cd
  from declined_transactions d
  where nullif(btrim(d.driver_name),'') is null
),
card_stats as (
  select regexp_replace(coalesce(card_num,''),'\D','','g')                     as cd,
         count(*)                                                              as posted_rows,
         count(*) filter (where nullif(btrim(driver_name),'')   is not null)    as rows_with_name,
         count(*) filter (where nullif(btrim(driver_ext_id),'') is not null)    as rows_with_ext_id,
         max(driver_ext_id) filter (where nullif(btrim(driver_ext_id),'') is not null) as ext_id
  from efs_transactions group by 1
),
classified as (
  select b.*,
         cs.posted_rows, cs.rows_with_name, cs.rows_with_ext_id, cs.ext_id,
         case
           when length(b.cd) < 15                       then 'A. short card ref (not a 19-digit PAN)'
           when cs.cd is null                           then 'B. card has NO posted history at all'
           when cs.rows_with_name = 0
            and cs.rows_with_ext_id > 0                 then 'C. history exists, no NAME — but has an EFS driver ID'
           when cs.rows_with_name = 0                   then 'D. history exists, no name and no driver ID'
           else                                              'E. name available but ambiguous (shared card)'
         end as bucket
  from blank b
  left join card_stats cs on cs.cd = b.cd
)
select bucket,
       count(*)                as declines,
       count(distinct cd)      as cards,
       count(distinct unit)    as units,
       min(declined_at)::date  as oldest,
       max(declined_at)::date  as newest,
       -- For bucket C: how many of those EFS driver IDs actually resolve to a driver on your roster?
       count(*) filter (
         where ext_id is not null
           and exists (select 1 from drivers dr where btrim(dr.efs_driver_id) = btrim(classified.ext_id))
       ) as resolvable_via_efs_driver_id
from classified
group by bucket
order by declines desc;
