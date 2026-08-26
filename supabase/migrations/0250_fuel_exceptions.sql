-- 0250: the product finds money and then forgets it
--
-- 0249 gave a reconciliation a record. What it still had no home for was the FINDING as something
-- somebody works on: a discrepancy has no state, no owner, no note, no resolution, and no link to a
-- vendor credit. The tab lists it, and next week it is listed again with no memory that anyone looked.
--
-- Three consequences, and the third is commercial:
--   • the same discrepancy is investigated twice, by two people, a week apart;
--   • a dispute settled with Pilot leaves no trace that it was ever raised;
--   • the product can report a $177 contract variance and can never report "we recovered $14,200 last
--     quarter", which is the figure that renews a contract.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- D-FX2 — ONE LEDGER, MANY DETECTORS, AND NOT `anomalies`
--
-- A reconciliation discrepancy, a fill billed above its contracted price and a policy premium are the
-- same object: priced, dated, attributable, and needing a decision. Given a table each they get a
-- status vocabulary each and a screen each. So one table with a `kind` discriminator.
--
-- The obvious reuse is `anomalies`, which already carries exactly this lifecycle. It cannot be used:
-- `anomalies.transaction_id` is NOT NULL and references `fuel_transactions`, and the most valuable
-- finding this feature produces — a line the vendor billed that we have no record of — has no
-- `fuel_transactions` row BY DEFINITION. That is the whole point of the finding. The lifecycle columns
-- below are copied from `anomalies`; the table is not.
--
-- D-FX10 — A DETECTOR NEVER WRITES A LIFECYCLE
--
-- Re-running a reconciliation over a period must not reset a human's work. Every finding carries a
-- deterministic `fingerprint` derived from what it IS rather than which run found it (see
-- `fuelExceptionFingerprint` in `@fuelguard/shared`), and `sync_fuel_exceptions` below refreshes
-- evidence while leaving `status`, `assigned_to` and `resolution_note` untouched. A finding that a
-- later run no longer produces is CLOSED as `resolved_by_reingest`, never deleted — "nobody decided
-- anything, it stopped appearing" is a different fact from "somebody dismissed it".
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- THE EVIDENCE LINE — AND THIS TABLE IS ON THE OTHER SIDE OF IT
--
-- `fuel_recon_runs` (0249) is evidence: append-only, undeletable, RETENTION_FORBIDDEN. `fuel_exceptions`
-- is deliberately NOT, and the distinction is not a technicality. Status, owner and note are a person's
-- working state, not a record of fact; the immutable part of a finding is the run it points at and the
-- `evidence` snapshot it carries. Making the queue append-only would mean a typo in a note could never
-- be fixed, and would make the ledger unprunable when a carrier leaves.
--
-- It is therefore mutable, prunable, and NOT in `RETENTION_FORBIDDEN`. Its act log is the opposite —
-- append-only, because who closed a $9,000 dispute and when is exactly the thing nobody may rewrite.

create table if not exists fuel_exceptions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,

  kind              text not null check (kind in (
                      'recon_missing_in_system', 'recon_missing_on_report', 'recon_amount',
                      'recon_gallons', 'contract_variance',
                      'off_network_premium', 'avoided_state_premium', 'avoided_brand_premium')),

  -- The run that last produced it. `set null` so pruning a run never deletes the finding — though 0249
  -- makes runs undeletable, so in practice this only ever fires if that guarantee is relaxed.
  run_id            uuid references fuel_recon_runs(id) on delete set null,
  -- ⚠ NULLABLE, and this is D-FX2's entire argument: a line the vendor billed and we never recorded
  -- has no transaction. A NOT NULL here would silently exclude the fuel-theft surface.
  transaction_id    uuid references fuel_transactions(id) on delete set null,
  vehicle_id        uuid references vehicles(id) on delete set null,
  driver_id         uuid references drivers(id) on delete set null,
  station_id        uuid references fuel_stations(id) on delete set null,

  occurred_on       date,
  -- Always a positive magnitude; `amount_kind` says what it means. Nothing sums across kinds (D-FX5).
  amount            numeric(12,2) not null default 0,
  amount_kind       text not null check (amount_kind in
                      ('overbilled', 'underbilled', 'unbilled', 'unrecorded', 'premium', 'opportunity')),

  -- Denormalised from the finding so the queue reads without joining four tables.
  unit_number       text,
  site_number       text,
  city              text,
  state             text,
  brand             text,

  -- What a reader needs to judge it without opening the source file.
  evidence          jsonb not null default '{}',
  -- Stable across runs. The unique index below is what makes a re-run an UPDATE (D-FX10).
  fingerprint       text not null,

  -- ── the lifecycle, copied from `anomalies` ─────────────────────────────────
  status            text not null default 'open' check (status in
                      ('open', 'investigating', 'disputed', 'credited', 'dismissed', 'resolved_by_reingest')),
  assigned_to       uuid references auth.users(id) on delete set null,
  resolved_by       uuid references auth.users(id) on delete set null,
  resolved_at       timestamptz,
  resolution_note   text,
  -- E3: what was actually recovered, which is a different number from what was claimed. Only a
  -- `credited` exception may carry one, so "identified / claimed / recovered" cannot blur.
  credited_amount   numeric(12,2),
  credited_on       date,
  check (credited_amount is null or status = 'credited'),

  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- The whole of D-FX10: the same finding found again is the same row.
create unique index if not exists uq_fuel_exceptions_fingerprint
  on fuel_exceptions (org_id, fingerprint);
-- The queue: this org's open findings, newest first.
create index if not exists idx_fuel_exceptions_queue
  on fuel_exceptions (org_id, status, occurred_on desc);
create index if not exists idx_fuel_exceptions_run on fuel_exceptions (run_id) where run_id is not null;

create trigger trg_fuel_exceptions_updated before update on fuel_exceptions
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- The act log. Append-only, because who closed a dispute and when is the part nobody may rewrite.
--
-- ⚠ 0213's STYLE, not the EI010 family's: the guard exempts `auth_role() is null`, so the service role
-- can still prune. That is deliberate and it is what keeps `fuel_exceptions` prunable — an
-- undeletable child would pin its mutable parent in place and quietly move this whole table across the
-- evidence line.
create table if not exists fuel_exception_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  exception_id  uuid not null references fuel_exceptions(id) on delete cascade,
  kind          text not null check (kind in
                  ('opened', 'reopened', 'status_changed', 'assigned', 'note', 'credited', 'closed_by_reingest')),
  from_status   text,
  to_status     text,
  note          text,
  actor_id      uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_fuel_exception_events_parent
  on fuel_exception_events (exception_id, created_at desc);

create or replace function fuel_exception_events_append_only() returns trigger
language plpgsql as $$
begin
  -- Retention must still be able to prune an exception and its log together; a client or the API
  -- acting for a person may not rewrite history.
  if auth_role() is null and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'fuel_exception_events is append-only: add an event, never edit one'
    using errcode = 'FE010';
end $$;

drop trigger if exists trg_fuel_exception_events_append_only on fuel_exception_events;
create trigger trg_fuel_exception_events_append_only before update or delete on fuel_exception_events
  for each row execute function fuel_exception_events_append_only();

-- ─────────────────────────────────────────────────────────────────────────────
-- D-FX10's mechanism: refresh the evidence, never the lifecycle.
--
-- Set-based on purpose. Not a partial `.upsert()` — Postgres checks NOT NULL before conflict
-- arbitration, so a partial payload fails on the columns it did not mean to write (`lint:upserts`,
-- 0174/0175 the pattern). The `on conflict` clause below names every column it may touch and none it
-- may not, which is the property the matrix asserts.
create or replace function sync_fuel_exceptions(
  p_org      uuid,
  p_run      uuid,
  p_findings jsonb,
  p_actor    uuid default null
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
begin
  if p_org is null then
    raise exception 'sync_fuel_exceptions requires an org' using errcode = 'FE011';
  end if;

  select coalesce(array_agg(f->>'fingerprint'), '{}') into v_seen
  from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) f;

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
      -- touch a person's work (D-FX10).
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

  -- ── close what this run no longer finds ────────────────────────────────────
  -- Only findings from THIS run's own kinds, and only ones a person has not already decided about.
  with closed as (
    update fuel_exceptions e
       set status = 'resolved_by_reingest', resolved_at = now(), resolved_by = p_actor
     where e.org_id = p_org
       and e.run_id = p_run
       and not (e.fingerprint = any (v_seen))
       and e.status in ('open', 'investigating')
    returning e.id, e.status
  )
  insert into fuel_exception_events (org_id, exception_id, kind, to_status, actor_id, note)
  select p_org, c.id, 'closed_by_reingest', 'resolved_by_reingest', p_actor,
         'A later reconciliation of this period no longer produced this finding.'
  from closed c;
  get diagnostics v_closed = row_count;

  -- Every newly created finding gets its opening event, so the log is complete from the first row.
  insert into fuel_exception_events (org_id, exception_id, kind, to_status, actor_id)
  select p_org, e.id, 'opened', 'open', p_actor
  from fuel_exceptions e
  where e.org_id = p_org
    and e.run_id = p_run
    and e.first_seen_at = e.last_seen_at
    and not exists (select 1 from fuel_exception_events ev where ev.exception_id = e.id);

  -- A security-definer RPC writes its own audit row: the JWT-based table triggers see null through the
  -- service role, so `p_actor` is the only witness to who ran it (0218 is the template).
  insert into audit_logs (org_id, actor_id, action, entity, meta)
  values (p_org, p_actor, 'fuel.exceptions_synced', 'fuel_exceptions',
          jsonb_build_object('run', p_run, 'inserted', v_inserted, 'refreshed', v_refreshed, 'closed', v_closed));

  return query select v_inserted, v_refreshed, v_closed;
end $$;

revoke all on function sync_fuel_exceptions(uuid, uuid, jsonb, uuid) from public;
grant execute on function sync_fuel_exceptions(uuid, uuid, jsonb, uuid) to service_role;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Read for org members. Writes are the API's: a finding is produced by a detector, and its lifecycle
-- moves through a route that records who moved it. No client write policy on either table.
alter table fuel_exceptions       enable row level security;
alter table fuel_exception_events enable row level security;

drop policy if exists fuel_exceptions_select on fuel_exceptions;
create policy fuel_exceptions_select on fuel_exceptions for select using (org_id = auth_org_id());

drop policy if exists fuel_exception_events_select on fuel_exception_events;
create policy fuel_exception_events_select on fuel_exception_events for select using (org_id = auth_org_id());
