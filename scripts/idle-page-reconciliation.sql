-- Read-only Task 1 reconciliation query.
-- Run from the repo with:
--   supabase db query --linked --file scripts/idle-page-reconciliation.sql --output table
-- It mirrors useIdleBreakdown's default range, rollup sums, computeAvoidable inputs,
-- confidence gates, per-truck rounding, and fleet card aggregation.
with
params as (
  select
    (current_date - 30)::date as from_day,
    current_date::date as to_day,
    31::numeric as selected_days
),
rollup as (
  select r.*, v.unit_number, v.has_apu, v.has_optimized_idle, v.idle_capability
  from idle_rollup_days r
  join vehicles v on v.id = r.vehicle_id
  cross join params p
  where r.day between p.from_day and p.to_day
    and v.status <> 'retired'
),
org_days as (
  select org_id, count(distinct day)::numeric as days_with_data
  from rollup
  group by org_id
),
periods as (
  select
    o.id as org_id,
    greatest(1, least(p.selected_days, coalesce(d.days_with_data, 0))) * 86400 as period_sec
  from organizations o
  cross join params p
  left join org_days d on d.org_id = o.id
  where d.org_id is not null
),
raw_sums as (
  select
    org_id,
    vehicle_id,
    max(unit_number) as unit_number,
    case when bool_or(has_apu is true) then true when bool_or(has_apu is false) then false else null end as has_apu,
    case when bool_or(has_optimized_idle is true) then true else null end as has_optimized_idle,
    max(idle_capability) as idle_capability,
    sum(drive_sec)::numeric as drive_sec,
    sum(idle_sec)::numeric as idle_sec,
    sum(off_sec)::numeric as off_sec,
    sum(coverage_sec)::numeric as coverage_sec,
    sum(managed_idle_sec)::numeric as managed_sec,
    sum(continuous_idle_sec)::numeric as continuous_sec,
    sum(optimized_envelope_inside_sec)::numeric as envelope_inside_sec,
    sum(optimized_envelope_outside_sec)::numeric as envelope_outside_sec,
    sum(optimized_envelope_unknown_sec)::numeric as envelope_unknown_sec,
    sum(optimized_envelope_ambiguous_sec)::numeric as envelope_ambiguous_sec,
    case max(case optimized_envelope_status
      when 'not_applicable' then 0 when 'sufficient' then 1 when 'insufficient' then 2
      when 'ambiguous' then 3 when 'unavailable' then 4 else 4 end)
      when 0 then 'not_applicable' when 1 then 'sufficient' when 2 then 'insufficient'
      when 3 then 'ambiguous' else 'unavailable' end as envelope_status,
    sum(hos_rest_sec)::numeric as hos_rest_sec,
    sum(hos_work_sec)::numeric as hos_work_sec,
    sum(hos_unknown_sec)::numeric as hos_unknown_sec,
    sum(hos_ambiguous_sec)::numeric as hos_ambiguous_sec,
    sum(hos_grace_sec)::numeric as hos_grace_sec
  from rollup
  group by org_id, vehicle_id
),
scaled as (
  select
    s.*,
    p.period_sec,
    case when s.managed_sec + s.continuous_sec > greatest(0, s.idle_sec)
              and s.managed_sec + s.continuous_sec > 0
      then greatest(0, s.idle_sec) / (s.managed_sec + s.continuous_sec)
      else 1 end as classified_scale
  from raw_sums s
  join periods p using (org_id)
),
classified as (
  select
    s.*,
    round(s.managed_sec * s.classified_scale) as managed_out_sec,
    round(s.continuous_sec * s.classified_scale) as continuous_out_sec,
    case
      when s.has_apu then 'apu'
      when s.has_optimized_idle then 'optimized_idle'
      when s.has_apu is false then 'none'
      when s.idle_capability = 'continuous_only' then 'none'
      else 'unknown'
    end as alternative
  from scaled s
),
base_verdict as (
  select
    c.*,
    (c.alternative in ('apu', 'optimized_idle')) as has_alternative,
    case when c.has_optimized_idle and c.continuous_out_sec > 0
      then case when c.envelope_status = 'not_applicable' then 'unavailable' else c.envelope_status end
      else null end as effective_envelope_status,
    case when c.alternative = 'optimized_idle' and c.envelope_status = 'sufficient'
      then least(c.continuous_out_sec, greatest(0, c.envelope_inside_sec))
      when c.alternative = 'optimized_idle' then 0
      when c.alternative = 'apu' then c.continuous_out_sec
      else 0 end as base_avoidable_sec,
    case when c.alternative = 'optimized_idle' and c.envelope_status = 'sufficient'
      then least(
        c.continuous_out_sec - least(c.continuous_out_sec, greatest(0, c.envelope_inside_sec)),
        greatest(0, c.envelope_outside_sec)
      )
      else 0 end as base_justified_sec,
    case when c.alternative = 'optimized_idle' and c.envelope_status = 'sufficient'
      then least(
        c.continuous_out_sec
          - least(c.continuous_out_sec, greatest(0, c.envelope_inside_sec))
          - least(
              c.continuous_out_sec - least(c.continuous_out_sec, greatest(0, c.envelope_inside_sec)),
              greatest(0, c.envelope_outside_sec)
            ),
        greatest(0, c.envelope_unknown_sec) + greatest(0, c.envelope_ambiguous_sec)
      )
      when c.alternative = 'optimized_idle' then c.continuous_out_sec
      else 0 end as base_uncertain_sec
  from classified c
),
duty as (
  select
    b.*,
    least(b.continuous_out_sec, greatest(0, b.hos_unknown_sec) + greatest(0, b.hos_ambiguous_sec)) as duty_uncertain_sec,
    least(
      b.continuous_out_sec - least(b.continuous_out_sec, greatest(0, b.hos_unknown_sec) + greatest(0, b.hos_ambiguous_sec)),
      least(greatest(0, b.hos_grace_sec), 900)
    ) as grace_sec
  from base_verdict b
),
verdict as (
  select
    d.*,
    least(d.continuous_out_sec, d.base_uncertain_sec + d.duty_uncertain_sec) as uncertain_out_sec,
    greatest(
      0,
      least(
        d.base_avoidable_sec - d.grace_sec,
        d.continuous_out_sec - d.base_justified_sec
          - least(d.continuous_out_sec, d.base_uncertain_sec + d.duty_uncertain_sec)
          - d.grace_sec
      )
    ) as avoidable_out_sec,
    d.base_justified_sec as justified_out_sec,
    greatest(
      0,
      d.continuous_out_sec
        - greatest(
            0,
            least(
              d.base_avoidable_sec - d.grace_sec,
              d.continuous_out_sec - d.base_justified_sec
                - least(d.continuous_out_sec, d.base_uncertain_sec + d.duty_uncertain_sec)
                - d.grace_sec
            )
          )
        - d.base_justified_sec
        - least(d.continuous_out_sec, d.base_uncertain_sec + d.duty_uncertain_sec)
        - d.grace_sec
    ) as unavoidable_out_sec,
    (d.continuous_out_sec = 0
      or (d.continuous_out_sec - d.duty_uncertain_sec) / nullif(d.continuous_out_sec, 0) >= .8
    ) as duty_can_judge
  from duty d
),
with_confidence as (
  select
    v.*,
    least(1, v.coverage_sec / nullif(v.period_sec, 0)) as coverage,
    (v.coverage_sec / nullif(v.period_sec, 0) >= .5
      and v.alternative <> 'unknown'
      and (v.alternative <> 'optimized_idle'
        or v.continuous_out_sec = 0
        or v.effective_envelope_status = 'sufficient')
      and v.duty_can_judge
    ) as confident
  from verdict v
),
settings as (
  select
    org_id,
    coalesce(idle_gal_per_hour, .8)::numeric as burn
  from idle_settings
),
price_rows as (
  select
    org_id,
    coalesce(net_price, posted_price)::numeric as price,
    row_number() over (partition by org_id order by observed_at desc) as rn
  from fuel_prices
  where product = 'diesel'
    and observed_at >= now() - interval '14 days'
    and coalesce(net_price, posted_price) is not null
),
prices as (
  select org_id, percentile_cont(.5) within group (order by price)::numeric as price
  from price_rows
  where rn <= 5000 and price > 0
  group by org_id
),
basis as (
  select
    o.id as org_id,
    coalesce(s.burn, .8)::numeric as burn,
    coalesce(p.price, s2.fuel_price_per_gal, 4.0)::numeric as price
  from organizations o
  left join settings s on s.org_id = o.id
  left join prices p on p.org_id = o.id
  left join idle_settings s2 on s2.org_id = o.id
),
output as (
  select
    c.*,
    b.burn,
    b.price,
    round(c.avoidable_out_sec / 3600.0, 1) as avoidable_h,
    round(c.unavoidable_out_sec / 3600.0, 1) as unavoidable_h,
    round(c.uncertain_out_sec / 3600.0, 1) as uncertain_h,
    round(c.managed_out_sec / 3600.0, 1) as managed_h,
    round(c.justified_out_sec / 3600.0, 1) as justified_h,
    round(c.grace_sec / 3600.0, 1) as grace_h,
    round(round(c.avoidable_out_sec / 3600.0 * b.burn, 2) * b.price, 2) as avoidable_usd
  from with_confidence c
  join basis b using (org_id)
  where c.confident
)
select
  unit_number as unit,
  alternative,
  avoidable_h,
  unavoidable_h,
  uncertain_h,
  managed_h,
  justified_h,
  grace_h,
  avoidable_usd,
  count(*) over () as confident_count,
  count(*) filter (where avoidable_h > 0) over () as rows_with_hours,
  round(sum(avoidable_h) over (), 1) as card_avoidable_h,
  round(sum(avoidable_usd) over ()) as card_avoidable_usd
from output
order by avoidable_h desc, unit_number;
