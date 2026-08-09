-- 0157: preserve prior Samsara evidence and record reconciliation freshness/failures
--
-- samsara_recon_at remains the last successful fueling-event timestamp. The new metadata distinguishes that
-- evidence from the last refresh attempt, so an outage never looks like historical evidence disappeared.

alter table public.fuel_transactions
  add column if not exists samsara_recon_checked_at       timestamptz,
  add column if not exists samsara_recon_status            text,
  add column if not exists samsara_recon_error             text,
  add column if not exists samsara_recon_evidence_version  int not null default 1;

alter table public.fuel_transactions
  drop constraint if exists fuel_transactions_samsara_recon_status_check;
alter table public.fuel_transactions
  add constraint fuel_transactions_samsara_recon_status_check
  check (samsara_recon_status is null or samsara_recon_status in ('success', 'no_data', 'failed', 'skipped'));

create index if not exists idx_ftxn_recon_status_checked
  on public.fuel_transactions (org_id, samsara_recon_status, samsara_recon_checked_at desc);

comment on column public.fuel_transactions.samsara_recon_checked_at is
  'Most recent live Samsara reconciliation attempt. Unlike samsara_recon_at, this is not necessarily a successful fueling-event match.';
comment on column public.fuel_transactions.samsara_recon_status is
  'Most recent reconciliation attempt: success, no_data, failed, or skipped.';
comment on column public.fuel_transactions.samsara_recon_error is
  'Last Samsara reconciliation failure message; null for success, no_data, and skipped.';
comment on column public.fuel_transactions.samsara_recon_evidence_version is
  'Monotonic revision of the persisted reconciliation evidence. Rules-only rebuilds preserve this value.';

/**
 * Phase-2 wrapper around the Phase-1 atomic scoring RPC. The nested function call and metadata update are
 * one PostgreSQL transaction: if metadata persistence fails, the scoring outcome also rolls back.
 */
create or replace function public.persist_scoring_outcome_v2(
  p_attempt_id                  uuid,
  p_org_id                     uuid,
  p_transaction_id             uuid,
  p_vehicle_id                 uuid,
  p_fueled_at                  timestamptz,
  p_engine_version             text,
  p_result_hash                text,
  p_case                       jsonb,
  p_outcome                    jsonb,
  p_recon_checked_at           timestamptz,
  p_recon_status               text,
  p_recon_error                text,
  p_recon_evidence_version     int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_recon_status is not null and p_recon_status not in ('success', 'no_data', 'failed', 'skipped') then
    raise exception 'persist_scoring_outcome_v2: invalid reconciliation status %', p_recon_status;
  end if;

  select public.persist_scoring_outcome(
    p_attempt_id,
    p_org_id,
    p_transaction_id,
    p_vehicle_id,
    p_fueled_at,
    p_engine_version,
    p_result_hash,
    p_case,
    p_outcome
  ) into v_result;

  update public.fuel_transactions
     set samsara_recon_checked_at = coalesce(p_recon_checked_at, samsara_recon_checked_at),
         samsara_recon_status = coalesce(p_recon_status, samsara_recon_status),
         samsara_recon_error = case when p_recon_status = 'failed' then p_recon_error else null end,
         samsara_recon_evidence_version = greatest(
           coalesce(samsara_recon_evidence_version, 1),
           coalesce(p_recon_evidence_version, 1)
         )
   where id = p_transaction_id
     and org_id = p_org_id;

  return v_result;
end;
$$;

revoke all on function public.persist_scoring_outcome_v2(uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb,jsonb,timestamptz,text,text,int) from public;
grant execute on function public.persist_scoring_outcome_v2(uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb,jsonb,timestamptz,text,text,int) to service_role;

comment on function public.persist_scoring_outcome_v2(uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb,jsonb,timestamptz,text,text,int) is
  'Atomically persists Phase-1 scoring outcome plus reconciliation freshness/failure metadata without replacing prior Samsara evidence.';
