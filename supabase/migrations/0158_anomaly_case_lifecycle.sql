-- 0158: anomaly case lifecycle, immutable transition history, and re-fire correctness
--
-- Closed cases are historical outcomes. They must not block a new case when the same transaction fires again.
-- Reviewer transitions are written through one locked RPC so status, disposition, version, and history cannot
-- diverge under concurrent reviewers.

create table if not exists public.anomaly_transitions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  anomaly_id     uuid not null references public.anomalies(id) on delete cascade,
  from_status    public.anomaly_status not null,
  to_status      public.anomaly_status not null,
  from_version   int not null,
  to_version     int not null,
  note           text,
  disposition    text check (disposition in ('confirmed', 'false_positive', 'benign_explained', 'inconclusive')),
  actor_id       uuid not null references auth.users(id),
  created_at     timestamptz not null default now()
);

create index if not exists idx_anomaly_transitions_org_created
  on public.anomaly_transitions (org_id, created_at desc);
create index if not exists idx_anomaly_transitions_anomaly_created
  on public.anomaly_transitions (anomaly_id, created_at asc, id asc);

-- The original 0010 index treated resolved/dismissed rows as active and prevented legitimate re-fires.
-- Keep only the intended one-open-case invariant from 0123.
drop index if exists public.idx_anomaly_active_rule;
create unique index if not exists uq_anomalies_open_txn_rule
  on public.anomalies (transaction_id, rule_id)
  where status = 'open' and transaction_id is not null;

alter table public.anomaly_transitions enable row level security;
drop policy if exists anomaly_transitions_select on public.anomaly_transitions;
create policy anomaly_transitions_select on public.anomaly_transitions
  for select using (org_id = auth_org_id());

/** Atomically validate, apply, and record one reviewer transition. */
create or replace function public.transition_anomaly(
  p_org_id             uuid,
  p_anomaly_id         uuid,
  p_actor_id            uuid,
  p_target_status      text,
  p_note               text,
  p_disposition        text,
  p_expected_version   int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.anomaly_status;
  v_version int;
  v_target public.anomaly_status;
  v_now timestamptz := now();
begin
  if p_target_status not in ('investigating', 'resolved', 'dismissed') then
    raise exception 'invalid_transition: unsupported target status %', p_target_status;
  end if;
  v_target := p_target_status::public.anomaly_status;

  select status, version
    into v_status, v_version
    from public.anomalies
   where id = p_anomaly_id
     and org_id = p_org_id
   for update;
  if not found then
    raise exception 'not_found: anomaly % does not exist in org %', p_anomaly_id, p_org_id;
  end if;
  if v_version <> p_expected_version then
    raise exception 'conflict: anomaly version is %, expected %', v_version, p_expected_version;
  end if;

  if v_status = 'superseded' then
    raise exception 'invalid_transition: superseded cases are terminal';
  end if;
  if not (
    (v_status = 'open' and v_target in ('investigating', 'resolved', 'dismissed'))
    or (v_status = 'investigating' and v_target in ('resolved', 'dismissed'))
    or (v_status in ('resolved', 'dismissed') and v_target = 'investigating')
  ) then
    raise exception 'invalid_transition: cannot move anomaly from % to %', v_status, v_target;
  end if;
  if p_note is null or length(btrim(p_note)) = 0 then
    if v_target in ('resolved', 'dismissed') then
      raise exception 'invalid_transition: a closing note is required';
    end if;
  end if;
  if v_target in ('resolved', 'dismissed') and p_disposition is null then
    raise exception 'invalid_transition: a closing disposition is required';
  end if;
  if v_target = 'investigating' and p_disposition is not null then
    raise exception 'invalid_transition: disposition is only valid when closing a case';
  end if;
  if p_note is not null and length(p_note) > 2000 then
    raise exception 'invalid_transition: note exceeds 2000 characters';
  end if;

  update public.anomalies
     set status = v_target,
         version = v_version + 1,
         resolution_note = nullif(btrim(p_note), ''),
         assigned_to = p_actor_id,
         resolved_by = case when v_target in ('resolved', 'dismissed') then p_actor_id else null end,
         resolved_at = case when v_target in ('resolved', 'dismissed') then v_now else null end,
         disposition = case when v_target in ('resolved', 'dismissed') then p_disposition else null end,
         disposition_by = case when v_target in ('resolved', 'dismissed') then p_actor_id else null end,
         disposition_at = case when v_target in ('resolved', 'dismissed') then v_now else null end
   where id = p_anomaly_id
     and org_id = p_org_id
     and version = p_expected_version;

  insert into public.anomaly_transitions (
    org_id, anomaly_id, from_status, to_status, from_version, to_version, note, disposition, actor_id, created_at
  ) values (
    p_org_id, p_anomaly_id, v_status, v_target, v_version, v_version + 1,
    nullif(btrim(p_note), ''), case when v_target in ('resolved', 'dismissed') then p_disposition else null end,
    p_actor_id, v_now
  );

  return jsonb_build_object(
    'anomaly_id', p_anomaly_id,
    'from_status', v_status,
    'to_status', v_target,
    'from_version', v_version,
    'to_version', v_version + 1
  );
end;
$$;

revoke all on function public.transition_anomaly(uuid,uuid,uuid,text,text,text,int) from public;
grant execute on function public.transition_anomaly(uuid,uuid,uuid,text,text,text,int) to service_role;

comment on table public.anomaly_transitions is
  'Append-only reviewer workflow history for anomaly cases. Service role inserts through transition_anomaly; tenant roles read their org history.';
comment on function public.transition_anomaly(uuid,uuid,uuid,text,text,text,int) is
  'Validates and atomically applies one anomaly state transition, disposition, optimistic version, and immutable history row.';

-- Replace the Phase-1 persistence core so only open/investigating cases block a new detection. The Phase-2
-- wrapper calls this function, so its reconciliation metadata behavior remains unchanged.
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

  select status into v_attempt_status
    from public.scoring_attempts
   where id = p_attempt_id and org_id = p_org_id and transaction_id = p_transaction_id
   for update;
  if not found then
    raise exception 'persist_scoring_outcome: scoring attempt % not found for transaction %', p_attempt_id, p_transaction_id;
  end if;

  if v_attempt_status = 'succeeded' then
    select id into v_case_id
      from public.anomalies
     where transaction_id = p_transaction_id and rule_id = 'theft_case' and status = 'open'
     order by created_at desc, id desc limit 1;
    return jsonb_build_object('idempotent', true, 'anomaly_id', v_case_id);
  end if;
  if v_attempt_status <> 'running' then
    raise exception 'persist_scoring_outcome: attempt % is already %', p_attempt_id, v_attempt_status;
  end if;

  perform 1 from public.fuel_transactions
   where id = p_transaction_id and org_id = p_org_id
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

    -- Only open/investigating cases are active blockers. Resolved/dismissed rows remain history and allow
    -- a new open case when the same transaction fires again.
    select exists(
      select 1 from public.anomalies
       where transaction_id = p_transaction_id
         and rule_id = v_case_rule_id
         and status in ('open', 'investigating')
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
       order by created_at desc, id desc limit 1;
    end if;
  end if;

  update public.anomalies
     set status = 'superseded'
   where transaction_id = p_transaction_id
     and source = 'rules'
     and status = 'open'
     and (v_case_rule_id is null or rule_id <> v_case_rule_id);

  if p_case is not null and p_case <> 'null'::jsonb and not v_case_inserted and v_case_id is not null then
    update public.anomalies
       set severity = v_case_severity, message = v_case_message,
           evidence = v_case_evidence, fueled_at = p_fueled_at
     where id = v_case_id and status = 'open';
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
   where id = p_transaction_id and org_id = p_org_id;

  update public.scoring_attempts
     set status = 'succeeded', error = null, completed_at = now(),
         engine_version = coalesce(nullif(p_engine_version, ''), engine_version),
         result_hash = coalesce(nullif(p_result_hash, ''), result_hash)
   where id = p_attempt_id and status = 'running';

  return jsonb_build_object('idempotent', false, 'anomaly_id', v_case_id);
end;
$$;

revoke all on function public.persist_scoring_outcome(uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb,jsonb) from public;
grant execute on function public.persist_scoring_outcome(uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb,jsonb) to service_role;
