-- 0128 — hazmat_runs.qualification: the §5 gate's run evidence (driver/org findings + citations +
-- eval date). Additive; the extraction/advisories columns already exist since 0092.
alter table public.hazmat_runs add column if not exists qualification jsonb;
comment on column public.hazmat_runs.qualification is
  'M3 §5 qualification-gate evidence: driver/org findings with citations + eval date (PLAN §10.4/§10.5).';
