-- 0610: the API's two paged idle reads stop sorting on disk (database audit 2026-11-15, P1 + P2).
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────────────────────────
-- pg_stat_statements on production, 41 days since the 2026-10-05 restart: 365 GB written to temp
-- files, and two statements own 364 GB of it. Both are `readAll` pages from
-- `idle/idleRollupInputs.ts` (and the same shape in `idle/vehicleDutyTimelines.ts`):
--   · driver_vehicle_assignments, `order by start_at, vehicle_samsara_id` — 145,334 calls, 262 GB.
--     A 30-day window matches 99,474 of 250,273 rows, so one read is 100 OFFSET pages, and every
--     page past the top-N threshold sorts all 99,474 rows.
--   · idle_park_sessions, `order by started_at, vehicle_id` — 18,864 calls, 102 GB.
-- `work_mem` is 5 MB (the platform default for this compute size) and nothing overrides it for the
-- role the API runs as.
--
-- ── MEASURED, NOT ASSUMED (production, 2026-11-15, each inside a rolled-back transaction) ────────
-- The audit first proposed an index on driver_vehicle_assignments (org_id, start_at,
-- vehicle_samsara_id). Built and rolled back, it removed the sort and made things WORSE: the filter
-- that matters is on `end_at`, so a page at OFFSET 40000 walked 142,785 index entries and touched
-- 135,593 buffers against 3,663 for the sequential scan it replaced. Rejected.
-- What the sort actually needs, in PostgREST's own query shape (CTE + json_agg, no parallel worker):
--   work_mem  5 MB (today): external merge on the deep pages (5 MB on disk at OFFSET 90000)
--   work_mem 16 MB:         quicksort, Memory 10,066 kB, nothing on disk
-- So the assignments read is fixed by memory, not by an index. Sixteen is the smallest round figure
-- above the 10 MB measured; PostgREST holds 11 connections, so the ceiling this adds is ~176 MB
-- only if every connection sorts at once.
-- idle_park_sessions is the opposite case. Its sort is 2.5 MB at 30 days but 11.7 MB ON DISK at the
-- 400-day backfill window — more memory than is reasonable to hand every connection — while an
-- index on (org_id, started_at, vehicle_id), built and rolled back, returned OFFSET 14000 with no
-- sort node at all (13,573 buffers, 18.8 ms; before: 15,963 buffers plus the sort). Its three
-- columns are the existing unique key's, never updated, so the table's HOT updates (99.4% of
-- 11.8M) are unaffected.
--
-- ── WHY A ROLE SETTING ──────────────────────────────────────────────────────────────────────────
-- PostgREST applies the impersonated role's settings per transaction — the same mechanism that
-- already gives `anon` 3 s and `authenticated` 8 s of statement_timeout here. `service_role` is the
-- API; the browser roles keep 5 MB. PostgREST caches role settings, hence the reload notice.
--
-- ── TWO DIAGNOSTIC SETTINGS ON THE SAME ROLE MECHANISM (audit P9) ───────────────────────────────
-- `authenticator` is the role PostgREST logs in as, so its settings are the session's.
--   · idle_in_transaction_session_timeout = 60s. It is 0 (never) today; a PostgREST transaction is
--     one statement, so anything idle inside one for a minute is a stuck client holding locks and
--     the vacuum horizon.
--   · track_io_timing = on. Without it pg_stat_statements cannot say whether a slow statement was
--     waiting on disk — the audit saw one park-session page take 2.2 s cold and 36 ms warm and could
--     only infer why.
-- All three ALTER ROLE statements were run on production inside a rolled-back transaction first
-- (2026-11-15): the platform permits `postgres` to set each of them.
-- NOT set, on purpose: `log_min_duration_statement` logs bind values, and PostgREST passes every
-- request body as one — a slow write would put applicant data in the platform log;
-- `pg_stat_statements.track = all` adds every statement inside a function to a table already at
-- 4,780 of its 5,000 entries. Both are the owner's trade-off, recorded in the audit report.
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md) ─────────────────────────────────────────────────
-- Additive and order-independent: no column, no reader. The plain CREATE INDEX blocks writes to
-- idle_park_sessions while it builds — 107,751 rows, 47 MB of heap, built and queried inside one
-- CLI round trip in the measurement above; the writers are the idle syncs' batched upserts, which wait and proceed.

alter role service_role set work_mem = '16MB';

create index if not exists idx_idle_park_sessions_org_started_vehicle
  on public.idle_park_sessions (org_id, started_at, vehicle_id);

do $$
begin
  -- The PGlite matrices have no `authenticator`; production and staging always do.
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    alter role authenticator set idle_in_transaction_session_timeout = '60s';
    alter role authenticator set track_io_timing = 'on';
  end if;
end $$;

notify pgrst, 'reload config';
