-- 0160: canonical fuel rows and explainable tank-balance evidence
-- Existing duplicate source rows are retained for audit, but only canonical rows may participate in scoring.

alter table public.fuel_transactions
  add column if not exists is_canonical boolean not null default true,
  add column if not exists duplicate_of uuid references public.fuel_transactions(id);

-- Mark exact content twins as non-canonical, keeping the most trustworthy row. This is non-destructive:
-- the loser remains queryable and points to the keeper for audit/reconciliation.
with ranked as (
  select id,
         first_value(id) over (
           partition by org_id, card_ref, fueled_at, gallons, coalesce(tank_type, 'tractor')
           order by (samsara_recon_at is not null) desc,
                    (transaction_id is not null) desc,
                    (control_id is not null) desc,
                    (odometer is not null) desc,
                    created_at asc, id asc
         ) as keeper,
         count(*) over (
           partition by org_id, card_ref, fueled_at, gallons, coalesce(tank_type, 'tractor')
         ) as copies
    from public.fuel_transactions
   where card_ref is not null
     and fueled_at_precision = 'instant'
)
update public.fuel_transactions f
   set is_canonical = (r.id = r.keeper),
       duplicate_of = case when r.id = r.keeper then null else r.keeper end
  from ranked r
 where f.id = r.id
   and r.copies > 1;

create index if not exists idx_ftxn_canonical_vehicle_time
  on public.fuel_transactions (vehicle_id, fueled_at, created_at, id)
  where is_canonical = true;
create index if not exists idx_ftxn_duplicate_of
  on public.fuel_transactions (duplicate_of)
  where duplicate_of is not null;

-- Detection results attached to a duplicate source row are no longer active findings.
update public.anomalies a
   set status = 'superseded'
 where a.source = 'rules'
   and a.status in ('open', 'investigating')
   and exists (
     select 1 from public.fuel_transactions f
      where f.id = a.transaction_id
        and f.is_canonical = false
   );
