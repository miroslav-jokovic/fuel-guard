-- 0406: a reconciliation keeps its lines, not only its totals (FS3, D-FSV8)
--
-- 0249 made the reconciliation a record: who ran it, against which tolerances, what it concluded.
-- What it kept of the conclusion is `summary` — the counts and the four exposures. The ROWS behind
-- them, the line Pilot billed and the fill we hold beside it, were returned to the browser once and
-- then lived in a component ref that vanished when the drawer closed (W5 of the owner's 2026-10-01
-- review). So a run said "1 on Pilot's bill, not in our records, $242.11" and nothing anywhere could
-- say which line that was. FS3's Pilot invoices page opens a saved check and shows what was found;
-- that needs the lines to have been kept.
--
-- ── WHY NOT `fuel_exceptions` ───────────────────────────────────────────────────────────────────
-- It holds the discrepancies, and it is the wrong record twice over. It is working state — status,
-- owner, note — mutable and prunable by design (0250, D-FX-EVIDENCE). And its `run_id` is the LATEST
-- run that produced the finding: a monthly export covering the same weeks re-points it (0253, 0320).
-- Reading run X's findings from it answers "what is open now", not "what run X found". It also holds
-- no clean rows, and the clean rows are the evidence that the rest were looked for.
--
-- ── WHY NOT RE-RUN THE MATCHER ON OPEN ──────────────────────────────────────────────────────────
-- Our fills move after a run — an EFS correction, a late reefer split, a vehicle relink — so a
-- re-match is a new finding wearing the old run's date. The run is evidence of what was concluded on
-- that day; the only faithful reading of it is the one that was written that day.
--
-- ── WHY ONE ROW PER RUN, NOT ONE ROW PER LINE ───────────────────────────────────────────────────
-- The lines are only ever read whole, for one run, in the order the matcher produced them, and the
-- page already pages them in the browser (X12). One row per line would put a monthly export's few
-- thousand rows behind PostgREST's 1,000-row cap and need a paged read to get back what one jsonb
-- value returns in one round trip. Nothing filters or sums across runs' lines in SQL; the moment
-- something needs to, the lines get a table of their own and this stays the snapshot.
-- Size, measured 2026-10-02 on the seven real statements (07/20–09/27, decoded with the browser's own
-- pdfjs path and matched by the shared matcher): 440–471 fuel rows each, 611 bytes per row with the
-- bill side alone, ~0.28 MB per statement plus ~300 DEF lines in `unmatchable`. A row matched to one of
-- our fills carries both sides, so under 1 KB. TOASTed and compressed; ~5 runs a month.
--
-- ── EVIDENCE: APPEND-ONLY, UNDELETABLE, NO CLIENT WRITE (0249's rules, and its argument) ───────
-- Written once, by the API, in the same request as its run. No update at all — unlike the run, it has
-- nothing to supersede: a correction is a new run with its own lines. Pinned in RETENTION_FORBIDDEN.
-- The run and its lines must belong to one org, so the foreign key is composite on (id, org_id); a
-- unique index on the parent makes that key referable.
--
-- ⚠ Card numbers: the system side of a row carries `fuel_transactions.card_ref`, the full card number.
-- The API cuts it to the last six digits before writing, the form `fuel_statement_lines.card_ref` and
-- `fuel_exceptions` already use. Nothing here needs more than six.

create unique index if not exists uq_fuel_recon_runs_id_org on fuel_recon_runs (id, org_id);

create table if not exists fuel_recon_run_rows (
  run_id      uuid primary key,
  org_id      uuid not null references organizations(id) on delete cascade,
  foreign key (run_id, org_id) references fuel_recon_runs (id, org_id),
  -- `ReconResult.rows`, verbatim apart from the card cut: report line, our fill, status, basis, deltas.
  rows        jsonb not null check (jsonb_typeof(rows) = 'array'),
  -- `ReconResult.unmatchable`: DEF and in-store lines set aside, never scored as fuel.
  unmatchable jsonb not null default '[]'::jsonb check (jsonb_typeof(unmatchable) = 'array'),
  created_at  timestamptz not null default now()
);

create or replace function fuel_recon_run_rows_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'fuel_recon_run_rows is append-only: a reconciliation''s lines are never edited or deleted (re-run to correct it)'
    using errcode = 'FR012';
end $$;

-- ⚠ Fires for the SERVICE ROLE too, like 0249's: the API that wrote the lines may not rewrite them.
drop trigger if exists trg_fuel_recon_run_rows_no_update on fuel_recon_run_rows;
create trigger trg_fuel_recon_run_rows_no_update before update on fuel_recon_run_rows
  for each row execute function fuel_recon_run_rows_immutable();
drop trigger if exists trg_fuel_recon_run_rows_no_delete on fuel_recon_run_rows;
create trigger trg_fuel_recon_run_rows_no_delete before delete on fuel_recon_run_rows
  for each row execute function fuel_recon_run_rows_immutable();

-- Read for org members, as the parent; NO client write policy (D-FX1). The API reads with the service
-- role and filters by org itself.
alter table fuel_recon_run_rows enable row level security;
drop policy if exists fuel_recon_run_rows_select on fuel_recon_run_rows;
create policy fuel_recon_run_rows_select on fuel_recon_run_rows for select using (org_id = auth_org_id());

comment on table fuel_recon_run_rows is
  'module=fuel-spend; layer=derived (0406, FS3: the lines of one fuel_recon_runs row; evidence, append-only, RETENTION_FORBIDDEN; scripts/table-modules.json is the machine-read source).';
