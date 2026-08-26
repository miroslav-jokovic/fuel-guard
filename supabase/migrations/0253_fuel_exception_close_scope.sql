-- 0253: `sync_fuel_exceptions` could never close a finding, and its matrix could not see it.
--
-- ── THE DEFECT ────────────────────────────────────────────────────────────────────────────────────
-- D-FX10 has two halves. The first — a re-run refreshes evidence and never touches a person's status,
-- owner or note — works, and the matrix proves it. The second — "a finding a run no longer produces is
-- closed as `resolved_by_reingest` rather than deleted" — has NEVER FIRED IN PRODUCTION, and could not.
--
-- 0250 scoped the close to `where e.run_id = p_run`. By the time that statement runs, the upsert
-- directly above it has already set `run_id = excluded.run_id` on every finding this batch produced.
-- So the rows carrying `p_run` are exactly the rows in `v_seen`, and `not (fingerprint = any (v_seen))`
-- selects none of them. `closed` is structurally always 0.
--
-- The matrix reported the opposite because its `sync()` helper defaulted to ONE fixed run id for all
-- four calls, so the second call's `p_run` matched rows the first call had written. Production never
-- does that: `runFuelReconciliation` inserts a new `fuel_recon_runs` row per upload and passes that
-- fresh id. Re-pointing the fixture at a new run per sync — which is what the deployed code does —
-- turns three assertions red on 0250 and green on this migration. That change ships with this one.
--
-- What it cost the carrier: nothing was ever closed. A discrepancy that next week's corrected
-- statement resolves stays `open` on the ledger for good, so the queue can only grow and the
-- `resolved_by_reingest` status — which has a token, a label ("No longer found") and an event kind —
-- has never been written to. A queue that cannot shrink is a queue people stop opening.
--
-- ── THE FIX, AND WHY THE SCOPE IS KIND + PERIOD RATHER THAN RUN ───────────────────────────────────
-- "This run no longer finds it" is a claim about a PERIOD and a set of KINDS, never about a run id: two
-- runs over the same week are two readings of one period, and the later one supersedes — which is the
-- same argument `fuel_recon_runs.superseded_by` already encodes for the runs themselves.
--
--   • the KINDS come from the caller as `p_kinds`, because "which findings am I authoritative for" is
--     the producer's knowledge and not this function's. A reconciliation owns the four recon kinds; the
--     contract detector owns `contract_variance`; a future detector owns its own (§1.2 — a new detector
--     is a new kind and a new producer). Declaring them explicitly is also what makes an EMPTY batch
--     work: a run that finds no `recon_amount` rows this week must still close last week's, and a kind
--     set derived from the batch itself could never express that.
--   • the PERIOD comes from the run row, which already records `period_start` / `period_end` under an
--     append-only trigger. Deriving it beats another parameter that could disagree with the run.
--
-- ── FAIL CLOSED, EVERYWHERE ──────────────────────────────────────────────────────────────────────
-- `p_kinds` null, no `p_run`, or a run row that cannot be read → close NOTHING. Leaving a resolved
-- finding open costs somebody a second look; closing an open one silently retires money the carrier is
-- owed, and only the second is unrecoverable. A finding with a null `occurred_on` is never closed by
-- period either — we cannot place it in the window, so we do not act on it.
--
-- ── DEPLOYMENT ORDER, WHICH IS WHY `p_kinds` HAS A DEFAULT ───────────────────────────────────────
-- `migrate.yml` applies this on merge; the API deploys separately, so for a few minutes the running
-- code calls the four-argument form. `create or replace` cannot add a parameter — it would leave BOTH
-- signatures live and make every existing four-argument call ambiguous — so the old one is dropped and
-- the new one takes `p_kinds text[] default null`. A four-argument call still resolves, closes nothing,
-- and therefore behaves exactly as production does today until the new code lands. Expand, then
-- contract; no window in which anything is worse than it is now.

drop function if exists sync_fuel_exceptions(uuid, uuid, jsonb, uuid);

create or replace function sync_fuel_exceptions(
  p_org      uuid,
  p_run      uuid,
  p_findings jsonb,
  p_actor    uuid default null,
  -- The kinds this producer is authoritative for. Null closes nothing — see "fail closed" above.
  p_kinds    text[] default null
)
returns table (inserted int, refreshed int, closed int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int := 0;
  v_refreshed int := 0;
  v_closed int := 0;
  v_seen text[];
  v_from date;
  v_to   date;
begin
  if p_org is null then
    raise exception 'sync_fuel_exceptions requires an org' using errcode = 'FE011';
  end if;

  select coalesce(array_agg(f->>'fingerprint'), '{}') into v_seen
  from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) f;

  -- The window this run read. Org-scoped as well as keyed, because a security-definer function reading
  -- a row by id alone is one bad id away from reading another carrier's period.
  if p_run is not null then
    select r.period_start, r.period_end into v_from, v_to
    from fuel_recon_runs r where r.id = p_run and r.org_id = p_org;
  end if;

  -- ── upsert the evidence ────────────────────────────────────────────────────
  with incoming as (
    select
      f->>'fingerprint'                                   as fingerprint,
      f->>'kind'                                          as kind,
      nullif(f->>'occurredOn', '')::date                  as occurred_on,
      coalesce((f->>'amount')::numeric, 0)                as amount,
      f->>'amountKind'                                    as amount_kind,
      nullif(f->>'transactionId', '')::uuid               as transaction_id,
      f->>'unit'                                          as unit_number,
      f->>'site'                                          as site_number,
      f->>'city'                                          as city,
      f->>'state'                                         as state,
      f->>'brand'                                         as brand,
      coalesce(f->'evidence', '{}'::jsonb)                as evidence
    from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) f
  ),
  upserted as (
    insert into fuel_exceptions
      (org_id, kind, run_id, transaction_id, occurred_on, amount, amount_kind,
       unit_number, site_number, city, state, brand, evidence, fingerprint)
    select p_org, i.kind, p_run, i.transaction_id, i.occurred_on, i.amount, i.amount_kind,
           i.unit_number, i.site_number, i.city, i.state, i.brand, i.evidence, i.fingerprint
    from incoming i
    on conflict (org_id, fingerprint) do update set
      -- Evidence only. `status`, `assigned_to`, `resolved_by`, `resolved_at`, `resolution_note`,
      -- `credited_amount` and `credited_on` are ABSENT from this list on purpose: a detector may not
      -- touch a person's work (D-FX10). Unchanged from 0250.
      run_id         = excluded.run_id,
      transaction_id = excluded.transaction_id,
      occurred_on    = excluded.occurred_on,
      amount         = excluded.amount,
      amount_kind    = excluded.amount_kind,
      unit_number    = excluded.unit_number,
      site_number    = excluded.site_number,
      city           = excluded.city,
      state          = excluded.state,
      brand          = excluded.brand,
      evidence       = excluded.evidence,
      last_seen_at   = now(),
      -- A finding closed by a previous re-ingest and found AGAIN is genuinely open again. One a person
      -- dismissed or credited stays where they put it.
      status         = case when fuel_exceptions.status = 'resolved_by_reingest' then 'open'
                            else fuel_exceptions.status end
    returning (xmax = 0) as was_insert
  )
  select
    count(*) filter (where was_insert),
    count(*) filter (where not was_insert)
  into v_inserted, v_refreshed
  from upserted;

  -- ── close what this producer no longer finds in the period it just read ────
  -- Scoped by kind and period, never by run id (see the header). `disputed` is deliberately absent
  -- from the status list: somebody is mid-conversation with the vendor about that one, and a
  -- re-ingest is not entitled to end it.
  if p_kinds is not null and v_from is not null and v_to is not null then
    with closed as (
      update fuel_exceptions e
         set status = 'resolved_by_reingest', resolved_at = now(), resolved_by = p_actor
       where e.org_id = p_org
         and e.kind = any (p_kinds)
         and e.occurred_on is not null
         and e.occurred_on between v_from and v_to
         and not (e.fingerprint = any (v_seen))
         and e.status in ('open', 'investigating')
      returning e.id
    )
    insert into fuel_exception_events (org_id, exception_id, kind, to_status, actor_id, note)
    select p_org, c.id, 'closed_by_reingest', 'resolved_by_reingest', p_actor,
           'A later reconciliation of this period no longer produced this finding.'
    from closed c;
    get diagnostics v_closed = row_count;
  end if;

  -- Every newly created finding gets its opening event, so the log is complete from the first row.
  insert into fuel_exception_events (org_id, exception_id, kind, to_status, actor_id)
  select p_org, e.id, 'opened', 'open', p_actor
  from fuel_exceptions e
  where e.org_id = p_org
    and e.run_id = p_run
    and e.first_seen_at = e.last_seen_at
    and not exists (select 1 from fuel_exception_events ev where ev.exception_id = e.id);

  -- A security-definer RPC writes its own audit row: the JWT-based table triggers see null through the
  -- service role, so `p_actor` is the only witness to who ran it (0218 is the template). The audited
  -- window and kinds are what make a closure traceable later — "why did this go away" is the question
  -- somebody asks about a finding that was worth money.
  insert into audit_logs (org_id, actor_id, action, entity, meta)
  values (p_org, p_actor, 'fuel.exceptions_synced', 'fuel_exceptions',
          jsonb_build_object('run', p_run, 'inserted', v_inserted, 'refreshed', v_refreshed,
                             'closed', v_closed, 'kinds', p_kinds,
                             'periodStart', v_from, 'periodEnd', v_to));

  return query select v_inserted, v_refreshed, v_closed;
end $$;

revoke all on function sync_fuel_exceptions(uuid, uuid, jsonb, uuid, text[]) from public;
grant execute on function sync_fuel_exceptions(uuid, uuid, jsonb, uuid, text[]) to service_role;
