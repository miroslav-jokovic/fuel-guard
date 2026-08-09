-- 0156: atomic scoring persistence + durable scoring attempts
--
-- The scoring engine computes its result in the API, but anomaly reconciliation and the transaction outcome
-- must commit together. PostgREST cannot hold a transaction across separate table writes, so this migration
-- adds one service-role RPC as the database boundary. The attempt row also makes a lost response retryable:
-- a repeated call with the same attempt id returns success without applying the writes twice.

create table if not exists public.scoring_attempts (
  id              uuid primary key,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  transaction_id  uuid not null references public.fuel_transactions(id) on delete cascade,
  engine_version  text not null,
  result_hash     text not null,
  status          text not null default 'running'
                    check (status in ('running', 'succeeded', 'failed')),
  error           text,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_scoring_attempts_org_started
  on public.scoring_attempts (org_id, started_at desc);
create index if not exists idx_scoring_attempts_transaction_started
  on public.scoring_attempts (transaction_id, started_at desc);

alter table public.scoring_attempts enable row level security;
drop policy if exists scoring_attempts_select on public.scoring_attempts;
create policy scoring_attempts_select on public.scoring_attempts
  for select using (org_id = auth_org_id());

 drop trigger if exists trg_scoring_attempts_updated on public.scoring_attempts;
create trigger trg_scoring_attempts_updated
  before update on public.scoring_attempts
  for each row execute function public.set_updated_at();

/**
 * Persist one fully computed score atomically.
 *
 * The anomaly reconciliation intentionally mirrors the current TypeScript reconcileAnomalies behavior:
 *   - active means status <> superseded;
 *   - a fired rule is inserted only when no active row for that rule exists;
 *   - open rules-source rows that did not fire are superseded;
 *   - an already-open case is refreshed only when no new case row was inserted.
 *
 * Detection behavior is not implemented here; this function only commits the already computed result.
 */
create or replace function public.persist_scoring_outcome(
  p_attempt_id      uuid,
  p_org_id          uuid,
  p_transaction_id  uuid,
  p_vehicle_id      uuid,
  p_fueled_at       timestamptz,
  p_engine_version  text,
  p_result_hash     text,
  p_case            jsonb,
  p_outcome         jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_status text;
  v_case_rule_id text;
  v_case_id uuid;
  v_case_inserted boolean := false;
  v_has_active_case boolean := false;
  v_case_severity public.anomaly_severity;
  v_case_message text;
  v_case_evidence jsonb;
begin
  if p_attempt_id is null or p_org_id is null or p_transaction_id is null then
    raise exception 'persist_scoring_outcome: attempt, org, and transaction are required';
  end if;

  select status
    into v_attempt_status
    from public.scoring_attempts
   where id = p_attempt_id
     and org_id = p_org_id
     and transaction_id = p_transaction_id
   for update;

  if not found then
    raise exception 'persist_scoring_outcome: scoring attempt % not found for transaction %', p_attempt_id, p_transaction_id;
  end if;

  -- A client retry after a committed transaction must be a no-op.
  if v_attempt_status = 'succeeded' then
    select id into v_case_id
      from public.anomalies
     where transaction_id = p_transaction_id
       and rule_id = 'theft_case'
       and status = 'open'
     order by created_at desc, id desc
     limit 1;
    return jsonb_build_object('idempotent', true, 'anomaly_id', v_case_id);
  end if;

  if v_attempt_status <> 'running' then
    raise exception 'persist_scoring_outcome: attempt % is already %', p_attempt_id, v_attempt_status;
  end if;

  -- Serialize all scoring writers for this transaction before reading/reconciling anomalies.
  perform 1
    from public.fuel_transactions
   where id = p_transaction_id
     and org_id = p_org_id
   for update;
  if not found then
    raise exception 'persist_scoring_outcome: transaction % not found in org %', p_transaction_id, p_org_id;
  end if;

  if p_case is not null and p_case <> 'null'::jsonb then
    v_case_rule_id := nullif(p_case ->> 'rule_id', '');
    v_case_severity := (p_case ->> 'severity')::public.anomaly_severity;
    v_case_message := p_case ->> 'message';
    v_case_evidence := coalesce(p_case -> 'evidence', '{}'::jsonb);
    if v_case_rule_id is null or v_case_message is null then
      raise exception 'persist_scoring_outcome: case rule_id and message are required';
    end if;

    select exists(
      select 1
        from public.anomalies
       where transaction_id = p_transaction_id
         and rule_id = v_case_rule_id
         and status <> 'superseded'
    ) into v_has_active_case;

    if not v_has_active_case then
      insert into public.anomalies (
        org_id, transaction_id, vehicle_id, rule_id, severity, status, message, evidence, source, fueled_at
      ) values (
        p_org_id, p_transaction_id, p_vehicle_id, v_case_rule_id, v_case_severity, 'open',
        v_case_message, v_case_evidence, 'rules', p_fueled_at
      ) returning id into v_case_id;
      v_case_inserted := true;
    else
      select id into v_case_id
        from public.anomalies
       where transaction_id = p_transaction_id
         and rule_id = v_case_rule_id
         and status = 'open'
       order by created_at desc, id desc
       limit 1;
    end if;
  end if;

  -- Match the current reconcileAnomalies behavior: stale open rules cases disappear from the active queue.
  update public.anomalies
     set status = 'superseded'
   where transaction_id = p_transaction_id
     and source = 'rules'
     and status = 'open'
     and (v_case_rule_id is null or rule_id <> v_case_rule_id);

  -- Refresh an already-open case only when this pass did not insert a new case row.
  if p_case is not null and p_case <> 'null'::jsonb and not v_case_inserted and v_case_id is not null then
    update public.anomalies
       set severity = v_case_severity,
           message = v_case_message,
           evidence = v_case_evidence,
           fueled_at = p_fueled_at
     where id = v_case_id
       and status = 'open';
  end if;

  update public.fuel_transactions
     set miles_since_last = nullif(p_outcome ->> 'miles_since_last', 'null')::numeric,
         computed_mpg = nullif(p_outcome ->> 'computed_mpg', 'null')::numeric,
         has_anomaly = (p_outcome ->> 'has_anomaly')::boolean,
         max_severity = nullif(p_outcome ->> 'max_severity', 'null')::public.anomaly_severity,
         case_level = p_outcome ->> 'case_level',
         case_score = nullif(p_outcome ->> 'case_score', 'null')::numeric,
         case_signals = case when p_outcome ? 'case_signals' then p_outcome -> 'case_signals' else null end,
         case_gates = case when p_outcome ? 'case_gates' then p_outcome -> 'case_gates' else null end,
         attribution_verdict = p_outcome ->> 'attribution_verdict',
         logbook_vehicle_id = nullif(p_outcome ->> 'logbook_vehicle_id', 'null')::uuid,
         samsara_odometer = nullif(p_outcome ->> 'samsara_odometer', 'null')::numeric,
         samsara_odometer_at = nullif(p_outcome ->> 'samsara_odometer_at', 'null')::timestamptz,
         samsara_odometer_source = p_outcome ->> 'samsara_odometer_source',
         samsara_location_matched = nullif(p_outcome ->> 'samsara_location_matched', 'null')::boolean,
         samsara_location_confidence = p_outcome ->> 'samsara_location_confidence',
         samsara_nearest_station_miles = nullif(p_outcome ->> 'samsara_nearest_station_miles', 'null')::numeric,
         station_lat = nullif(p_outcome ->> 'station_lat', 'null')::numeric,
         station_lng = nullif(p_outcome ->> 'station_lng', 'null')::numeric,
         samsara_tank_short_gal = nullif(p_outcome ->> 'samsara_tank_short_gal', 'null')::numeric,
         samsara_tank_observed_gal = nullif(p_outcome ->> 'samsara_tank_observed_gal', 'null')::numeric,
         samsara_fuel_pct_before = nullif(p_outcome ->> 'samsara_fuel_pct_before', 'null')::numeric,
         samsara_fuel_pct_after = nullif(p_outcome ->> 'samsara_fuel_pct_after', 'null')::numeric,
         samsara_observed_state = p_outcome ->> 'samsara_observed_state',
         samsara_observed_city = p_outcome ->> 'samsara_observed_city',
         samsara_observed_address = p_outcome ->> 'samsara_observed_address',
         samsara_observed_lat = nullif(p_outcome ->> 'samsara_observed_lat', 'null')::numeric,
         samsara_observed_lng = nullif(p_outcome ->> 'samsara_observed_lng', 'null')::numeric,
         fueling_time_basis = p_outcome ->> 'fueling_time_basis',
         samsara_recon_at = nullif(p_outcome ->> 'samsara_recon_at', 'null')::timestamptz
   where id = p_transaction_id
     and org_id = p_org_id;

  update public.scoring_attempts
     set status = 'succeeded',
         error = null,
         completed_at = now(),
         engine_version = coalesce(nullif(p_engine_version, ''), engine_version),
         result_hash = coalesce(nullif(p_result_hash, ''), result_hash)
   where id = p_attempt_id
     and status = 'running';

  return jsonb_build_object('idempotent', false, 'anomaly_id', v_case_id);
end;
$$;

revoke all on function public.persist_scoring_outcome(uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb,jsonb) from public;
grant execute on function public.persist_scoring_outcome(uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb,jsonb) to service_role;

comment on table public.scoring_attempts is
  'Durable scoring persistence attempts. A succeeded attempt is an idempotency record for the atomic scoring RPC; failed attempts preserve the error for operations. ';
comment on function public.persist_scoring_outcome(uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb,jsonb) is
  'Atomically reconciles rules anomalies, persists the fuel transaction scoring outcome, and completes one scoring attempt. Retries of a succeeded attempt are no-ops.';
