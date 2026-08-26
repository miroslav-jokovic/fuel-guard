-- 0249: a reconciliation is a record, not a screen that forgets
--
-- Until now, reconciling a vendor's fuel report worked like this: the browser parsed a file, ran the
-- matcher in memory, drew a table, and lost all of it the moment the tab changed. Nothing recorded
-- what was compared, against what, with which tolerances, by whom, or what it concluded.
--
-- On a codebase this careful about evidence that is a conspicuous hole. `fuel_statements` (0243) keeps
-- the vendor's bill and the PDF behind it; `audit_logs` keeps who exported which report. The one thing
-- with no home was the FINDING — the claim that Pilot billed us for a fill we never recorded, which is
-- the fuel-theft surface this product exists to watch. If a $9,000 discrepancy were disputed and
-- settled tomorrow, there would be no record that anyone ever found it.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- D-FX1 — THE RUN IS COMPUTED ON THE SERVER, AND THE BROWSER NEVER ASSERTS ONE
--
-- Same shape as `POST /api/fueling/statements` (WP4): the browser decodes the container — only it has
-- `pdfjs` and ExcelJS — and sends the positioned WORDS or the decoded GRID. The server re-parses, ties
-- out, reads the org's own fills with the service role, runs the matcher from `@fuelguard/shared`, and
-- writes the row. A client can supply bytes; it cannot supply a conclusion.
--
-- D-FX9 — THE TOLERANCES ARE SNAPSHOTTED ONTO THE RUN
--
-- A run reconciled at a cent a gallon must still read as a cent a gallon after somebody widens the org
-- setting to two. The values in force are columns here, not a lookup at display time. Same argument as
-- `fuel_statements` storing what the vendor billed rather than recomputing it.
--
-- D-FX-SUMMARY — THE VERDICT IS STORED VERBATIM AS JSONB, THE KEYS ARE COLUMNS
--
-- `summary` is `ReconSummary` exactly as the pure function produced it — every bucket count, the three
-- match-basis counts, and the four exposure figures. It is jsonb rather than thirty numeric columns
-- because it is a SNAPSHOT of a typed result: a column list would drift from the type the day a status
-- is added, and the two would then disagree with nothing to say which was right. What a list view
-- filters and sorts on — period, source, who, when — is a real column.
--
-- ⚠ There is deliberately no `dollars_at_stake`. The figure it replaces added recoverable money, money
-- we may still owe, and money nobody has explained; the four exposures inside `summary` are reported
-- apart and nothing sums them (D-FX5).
--
-- D-FX-EVIDENCE — THIS TABLE IS EVIDENCE, `fuel_exceptions` (F6) WILL NOT BE
--
-- A run is what we concluded about a vendor's bill on a date, with the inputs that produced it. It is
-- append-only by trigger in 0243's style, a correction is a NEW run that supersedes, and it is pinned
-- in `RETENTION_FORBIDDEN`. The human working state that F6 adds on top — status, owner, note — is the
-- opposite: mutable, prunable, and deliberately not evidence. Each table states its side.

create table if not exists fuel_recon_runs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,

  -- ── what was reconciled ────────────────────────────────────────────────────
  source_kind       text not null check (source_kind in ('weekly_statement', 'monthly_export')),
  -- Set when the source was a statement we also kept. Null for an export, which is not retained as a
  -- billing record — `on delete set null` so pruning a statement never deletes the finding about it.
  statement_id      uuid references fuel_statements(id) on delete set null,
  source_filename   text,
  -- SHA-256 of the bytes the browser decoded, so the same file can be recognised on re-upload.
  source_sha256     text,
  invoice_no        text,
  period_start      date not null,
  period_end        date not null,
  check (period_end >= period_start),

  -- ── the gate the source passed ─────────────────────────────────────────────
  -- False means the format carried no printed total to check the parse against (an export with no
  -- PivotTable sheet). Ungated and verified must never look the same, so it is recorded, not implied.
  tie_out_gated     boolean not null default false,
  tie_out_notes     text[] not null default '{}',

  -- ── the tolerances in force (D-FX9) ────────────────────────────────────────
  tol_gallons       numeric(8,3) not null,
  tol_amount_abs    numeric(10,2) not null,
  tol_amount_pct    numeric(6,4) not null,
  max_day_drift     int not null,
  -- Bumped whenever the matcher's behaviour changes, so two runs are only comparable when it matches.
  matcher_version   text not null,

  -- ── the verdict ────────────────────────────────────────────────────────────
  summary           jsonb not null,
  -- Report lines set aside because nothing on our side can hold them: DEF (which arrives on
  -- `efs_transactions`, never `fuel_transactions`) and in-store merchandise. Counted, never scored as
  -- fuel we failed to record.
  unmatchable_lines int not null default 0,

  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  -- A correction is a new run pointing at the one it replaces. Never an edit.
  superseded_by     uuid references fuel_recon_runs(id) on delete set null,
  superseded_at     timestamptz
);

-- The list view: this org's live runs, newest period first.
create index if not exists idx_fuel_recon_runs_org_period
  on fuel_recon_runs (org_id, period_start desc) where superseded_by is null;
-- Recognising a re-upload of the same bytes.
create index if not exists idx_fuel_recon_runs_sha
  on fuel_recon_runs (org_id, source_sha256) where source_sha256 is not null;

-- ── append-only enforcement (0243's style, and its argument) ─────────────────
create or replace function fuel_recon_runs_supersede_only() returns trigger
language plpgsql as $$
begin
  -- Once superseded the row is frozen ENTIRELY, including re-pointing it at the same replacement,
  -- which looks idempotent and silently rewrites when the correction happened.
  if old.superseded_by is not null then
    raise exception 'this reconciliation was already superseded; supersede its replacement instead'
      using errcode = 'FR010';
  end if;
  if to_jsonb(new) - 'superseded_by' - 'superseded_at' is distinct from to_jsonb(old) - 'superseded_by' - 'superseded_at' then
    raise exception 'fuel_recon_runs is append-only: only superseded_by/superseded_at may change (re-run to correct a reconciliation)'
      using errcode = 'FR010';
  end if;
  return new;
end $$;

drop trigger if exists trg_fuel_recon_runs_supersede_only on fuel_recon_runs;
create trigger trg_fuel_recon_runs_supersede_only before update on fuel_recon_runs
  for each row execute function fuel_recon_runs_supersede_only();

-- ⚠ Fires for the SERVICE ROLE too, on purpose — the EI010/DA010 family's rule. This is evidence:
-- nothing may rewrite a finding in place, including the API that wrote it. Retention cannot prune it
-- either, which is why it is pinned in `RETENTION_FORBIDDEN` rather than left to a future sweep.
create or replace function fuel_recon_runs_no_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'fuel_recon_runs is append-only: a reconciliation is superseded, never deleted'
    using errcode = 'FR011';
end $$;

drop trigger if exists trg_fuel_recon_runs_no_delete on fuel_recon_runs;
create trigger trg_fuel_recon_runs_no_delete before delete on fuel_recon_runs
  for each row execute function fuel_recon_runs_no_delete();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Read for org members; NO client write policy at all. The API writes with the service role after it
-- has re-parsed and matched, which is the whole of D-FX1: a browser can hand over bytes and cannot
-- assert a finding. Deny-all for clients is the default here and is deliberate.
alter table fuel_recon_runs enable row level security;

drop policy if exists fuel_recon_runs_select on fuel_recon_runs;
create policy fuel_recon_runs_select on fuel_recon_runs for select using (org_id = auth_org_id());
