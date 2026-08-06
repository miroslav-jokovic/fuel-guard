-- 0130 — D17 + N2 + D3: atomic run recording with a materialised token counter.
--
-- D17: the monthly budget check scanned EVERY hazmat_runs row for the org since month start and
-- summed a JSON field in app code, on every extraction, before the cache lookup. This materialises
-- the counter: one row per (org, month), incremented in the SAME transaction as the run insert, so
-- the budget gate becomes one indexed row read that can never drift from the runs it summarises.
-- N2: insertHazmatRun swallowed insert errors (console.error) — losing the run row, which is the
-- audit evidence a verdict happened. record_hazmat_run() gives the app one atomic call whose error
-- it propagates and fails closed on.
-- D3: the RPC writes advisories + extraction (both columns existed since 0092, never written) and
-- qualification (0128) — the extraction evidence makes M12.2 reproduce byte-identical for photo runs.
--
-- ADDITIVE. record_hazmat_run is the ONLY writer of org_usage_month; FuelGuard's existing direct
-- inserts are replaced by this RPC in the same change.

create table if not exists public.org_usage_month (
  org_id        uuid    not null references public.organizations(id) on delete cascade,
  yyyymm        text    not null check (yyyymm ~ '^[0-9]{4}-[0-9]{2}$'),
  input_tokens  bigint  not null default 0,
  output_tokens bigint  not null default 0,
  runs          integer not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (org_id, yyyymm)
);

comment on table public.org_usage_month is
  'Materialised per-org monthly model-token usage (D17). Written ONLY by record_hazmat_run(), in the same transaction as the hazmat_runs insert. The budget gate reads this, never scans hazmat_runs.';

-- Service-role-only surface: RLS on, no policies => the JWT/PostgREST door reads and writes nothing.
alter table public.org_usage_month enable row level security;

-- Atomic run insert + usage increment. SECURITY INVOKER (default): called on the service-role
-- connection, which already bypasses RLS; no privilege-escalation surface for the JWT door.
-- Signature = 0003's record_hazmat_run + p_qualification (FuelGuard's hazmat_runs.qualification, 0128).
create or replace function public.record_hazmat_run(
  p_id              uuid,
  p_org_id          uuid,
  p_load_id         uuid,
  p_engine_version  text,
  p_dataset_version text,
  p_verdict         jsonb,
  p_outcome         text,
  p_flags           jsonb,
  p_advisories      jsonb,
  p_extraction      jsonb,
  p_models          jsonb,
  p_input_hash      text,
  p_input_tokens    bigint  default 0,
  p_output_tokens   bigint  default 0,
  p_qualification   jsonb   default null
) returns void
language plpgsql
as $$
begin
  insert into public.hazmat_runs
    (id, org_id, load_id, engine_version, dataset_version, verdict, outcome, flags,
     advisories, extraction, models, input_hash, qualification)
  values
    (p_id, p_org_id, p_load_id, p_engine_version, p_dataset_version, p_verdict, p_outcome,
     coalesce(p_flags, '[]'::jsonb), coalesce(p_advisories, '[]'::jsonb), p_extraction, p_models,
     p_input_hash, p_qualification);

  insert into public.org_usage_month (org_id, yyyymm, input_tokens, output_tokens, runs)
  values (p_org_id, to_char(now(), 'YYYY-MM'), coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0), 1)
  on conflict (org_id, yyyymm) do update
    set input_tokens  = org_usage_month.input_tokens  + excluded.input_tokens,
        output_tokens = org_usage_month.output_tokens + excluded.output_tokens,
        runs          = org_usage_month.runs + 1,
        updated_at    = now();
end;
$$;
