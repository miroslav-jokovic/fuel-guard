-- The scoring_version stamp was written by the app and thrown away by the database.
--
-- 0318 added the column and #573 made `buildTxnOutcomePatch` include `scoring_version` in the outcome
-- JSON. But the outcome is not applied by a table update from the app — it goes through
-- `persist_scoring_outcome_v2`, and that function (via `persist_scoring_outcome`, 0158) applies an
-- EXPLICIT column list. A key the list does not name is silently ignored: no error, no warning, no
-- write. Measured on production immediately after the deploy — 562 fills scored in three minutes,
-- **zero stamped**, and the whole mechanism inert.
--
-- Worth stating plainly because it is the trap this shape sets for the next person: adding a field to
-- the outcome patch in TypeScript LOOKS complete and typechecks fine, and every test that fakes the
-- RPC passes, because the fake accepts whatever JSON it is handed. The column list here is the second
-- half of that change, and there is nothing in the type system to say so.
--
-- Applied on the OUTER function rather than by recreating `persist_scoring_outcome`: v2 already runs
-- its own update on the same row in the same transaction, the app calls only v2, and re-issuing the
-- thirty-column inner function to add one line would be a much larger diff for the same effect.
--
-- `coalesce(..., scoring_version)` keeps the existing stamp when the key is absent, so any caller that
-- does not send one cannot silently un-stamp a fill it just scored.

create or replace function public.persist_scoring_outcome_v2(
  p_attempt_id                 uuid,
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
         ),
         -- 0318/0319: which generation of the rules produced the verdict just written above. The
         -- nightly sweep claims the lowest stamps first, so this is what makes a derivation change
         -- drain over a few nights instead of a full-history rebuild.
         scoring_version = coalesce(
           nullif(p_outcome ->> 'scoring_version', 'null')::integer,
           scoring_version
         )
   where id = p_transaction_id
     and org_id = p_org_id;

  return v_result;
end;
$$;

revoke all on function public.persist_scoring_outcome_v2(uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb,jsonb,timestamptz,text,text,int) from public;
grant execute on function public.persist_scoring_outcome_v2(uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb,jsonb,timestamptz,text,text,int) to service_role;

comment on function public.persist_scoring_outcome_v2(uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb,jsonb,timestamptz,text,text,int) is
  'Atomically persists Phase-1 scoring outcome plus reconciliation freshness/failure metadata without replacing prior Samsara evidence, and stamps scoring_version from the outcome (0319).';
