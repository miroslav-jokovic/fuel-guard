-- What are the 610 declines that stayed blank? Read-only.
-- Each bucket needs a different answer, and one of them is a fraud signal rather than a data gap.
with d as (
  select id, card_ref, unit, declined_at,
         regexp_replace(coalesce(card_ref,''), '\D', '', 'g') as cd
  from declined_transactions
  where nullif(btrim(driver_name),'') is null
),
posted as (
  select regexp_replace(coalesce(card_num,''), '\D', '', 'g') as cd,
         (select string_agg(t,' ' order by t)
            from unnest(string_to_array(lower(regexp_replace(driver_name,'[^a-zA-Z]',' ','g')),' ')) t
           where length(t) > 1) as match_key
  from efs_transactions
  where nullif(btrim(driver_name),'') is not null
),
agg as (select cd, count(distinct match_key) as drivers from posted group by cd)
select
  case
    when length(d.cd) < 15  then 'A. short card ref — not an EFS 19-digit PAN'
    when a.cd is null       then 'B. card has NEVER had an approved fill'
    when a.drivers > 1      then 'C. card shared by 2+ drivers — refused on purpose'
    else                         'D. other'
  end                                as bucket,
  count(*)                           as declines,
  count(distinct d.cd)               as distinct_cards,
  count(distinct d.unit)             as distinct_units,
  min(d.declined_at)::date           as oldest,
  max(d.declined_at)::date           as newest
from d left join agg a on a.cd = d.cd
group by 1 order by 2 desc;
