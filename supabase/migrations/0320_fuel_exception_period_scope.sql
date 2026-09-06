-- 0320: a producer without a reconciliation run could file findings and never close one.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────────────────────────
-- `sync_fuel_exceptions` learns the window a producer just read by looking `p_run` up in
-- `fuel_recon_runs` (0253). That was correct while the only producer was `reconFindings`, which exists
-- because somebody uploaded a vendor statement and therefore always has a run. C6 adds the policy
-- producer, which reads the EFS feed for a calendar month and has no statement, no tolerances, no
-- matcher version and no run. Called with `p_run => null` the function behaves like this:
--
--   * `v_from` / `v_to` stay null, so the close block never executes. A truck-month whose fills were
--     corrected — a late-posting EFS row, a station finally resolved to a brand — would sit open on
--     somebody's queue for good. That is precisely the defect 0253 was written to fix, reappearing
--     through the other door.
--   * the `opened` event insert keys on `e.run_id = p_run`, and `x = null` is NULL rather than true, so
--     a policy finding would be created with NO opening event and its history would begin blank.
--
-- ── WHAT THIS DOES ───────────────────────────────────────────────────────────────────────────────
-- The period becomes something a producer can state directly. `p_run` still wins where it is given —
-- the run row is the authoritative record of what that reconciliation read, and a caller may not
-- override it — and `p_period_start` / `p_period_end` answer for a producer that has no run.
--
-- Filing a fake `fuel_recon_runs` row for a policy scan was the alternative and is rejected: that
-- table's `source_kind` admits only `weekly_statement` and `monthly_export`, and `tol_gallons`,
-- `tol_amount_abs`, `tol_amount_pct`, `max_day_drift` and `matcher_version` are all NOT NULL. A policy
-- scan has no tolerances and no matcher, so every one of those would be a number invented to satisfy a
-- column — a second source of truth about what a run is, which is the shape this repo calls a
-- workaround rather than a fix.
--
-- The `opened` event is re-keyed onto the batch's own fingerprints, which is correct for BOTH producers
-- and does not depend on a run existing. It is not a widening: a refreshed row has
-- `first_seen_at <> last_seen_at` and is filtered out exactly as before, and the `not exists` guard is
-- unchanged.
--
-- ── DEPLOYMENT ORDER, WHICH IS WHY THE NEW PARAMETERS HAVE DEFAULTS ──────────────────────────────
-- `migrate.yml` applies this on merge and Railway serves the merge ~3 minutes earlier, so for a few
-- minutes the running code calls the five-argument form. `create or replace` cannot add a parameter —
-- it would leave both signatures live and make every existing five-argument call ambiguous — so the old
-- one is dropped and the new one takes the two dates with `default null`. A five-argument call still
-- resolves, still reads its period from `p_run`, and behaves exactly as production does today. The
-- policy producer that passes the new arguments ships in a SEPARATE merge, behind this one:
-- `lint:migration-ordering` cannot see a function's signature, so that hold is held by hand.
-- Expand, then contract; no window in which anything is worse than it is now.

-- cross-module-waiver: this replaces `sync_fuel_exceptions` whole, and the function has written its own
-- `audit_logs` row (org module) beside its `fuel_exceptions` writes since 0250 — a security-definer RPC
-- called through the service role is invisible to the JWT-based table triggers, so `p_actor` is the only
-- witness to who ran it (0218 is the template). Re-declaring the function without that insert would
-- delete the audit trail for every closure; the cross-module touch is the audit itself, not a new
-- dependency, and no table's ownership moves.

drop function if exists sync_fuel_exceptions(uuid, uuid, jsonb, uuid, text[]);

create or replace function sync_fuel_exceptions(
  p_org          uuid,
  p_run          uuid,
  p_findings     jsonb,
  p_actor        uuid default null,
  -- The kinds this producer is authoritative for. Null closes nothing — fail closed, as in 0253.
  p_kinds        text[] default null,
  -- The window this producer read, for a producer that has no `fuel_recon_runs` row. Ignored when
  -- `p_run` is given: a run's own period is the record of what it read and a caller may not restate it.
  p_period_start date default null,
  p_period_end   date default null
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
  -- a row by id alone is one bad id away from reading another carrier's period. A `p_run` that does not
  -- resolve leaves the period null and therefore closes NOTHING — it does not fall through to the
  -- explicit dates, because a run id that matches no run of this org is a bug or a cross-org attempt,
  -- and neither should be answered by quietly using a window the caller supplied instead.
  if p_run is not null then
    select r.period_start, r.period_end into v_from, v_to
    from fuel_recon_runs r where r.id = p_run and r.org_id = p_org;
  elsif p_period_start is not null and p_period_end is not null then
    if p_period_end < p_period_start then
      raise exception 'sync_fuel_exceptions period ends before it starts' using errcode = 'FE012';
    end if;
    v_from := p_period_start;
    v_to   := p_period_end;
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
  -- Scoped by kind and period, never by run id (see 0253's header). `disputed` is deliberately absent
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
  -- Keyed on the batch's fingerprints rather than on `run_id`, which is null for a producer with no
  -- reconciliation run and would have left every policy finding with an empty history.
  insert into fuel_exception_events (org_id, exception_id, kind, to_status, actor_id)
  select p_org, e.id, 'opened', 'open', p_actor
  from fuel_exceptions e
  where e.org_id = p_org
    and e.fingerprint = any (v_seen)
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
                             'periodStart', v_from, 'periodEnd', v_to,
                             -- Which of the two ways the window was established, so an auditor reading
                             -- a closure can tell a statement reconciliation from a policy scan.
                             'periodSource', case when p_run is not null then 'run' else 'explicit' end));

  return query select v_inserted, v_refreshed, v_closed;
end $$;

revoke all on function sync_fuel_exceptions(uuid, uuid, jsonb, uuid, text[], date, date) from public;
grant execute on function sync_fuel_exceptions(uuid, uuid, jsonb, uuid, text[], date, date) to service_role;
