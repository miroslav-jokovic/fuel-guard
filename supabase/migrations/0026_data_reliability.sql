-- FuelGuard — 0026 Data reliability hardening (see DATA-RELIABILITY-FINDINGS.md)
--
-- 1. fuel_transactions.fueled_at_precision — explicit timestamp precision (was a noon-sentinel heuristic).
-- 2. Restore fueled_at BUSINESS time on rows the old scorer overwrote with the Samsara-matched instant
--    (that rewrite moved spend onto neighboring dates and reordered the MPG chain).
-- 3. Date-scope external_ref dedupe keys (card|invoice alone merged/dropped different days when EFS
--    reused invoice numbers).
-- 4. Convert naive-"UTC" EFS wall-clock times to TRUE UTC using the station state's IANA timezone
--    (DST-correct; split-timezone states use their dominant zone — worst case ±1h).
-- 5. imports.summary — post-commit reconciliation fingerprint (file vs DB counts, rows per day).
-- 6. geocode_cache.updated_at — lets stale unresolved lookups be retried instead of failing forever.
--
-- Ordering inside this file is load-bearing: restore (2) → dedupe (2b) → refs+tz-shift (3+4, merged
-- into one atomic statement per table because the date-scoped ref must be built from the business
-- date, which equals the UTC date only BEFORE the shift). Every statement is independently
-- idempotent and NO session state (temp tables) is used, so this runs safely both as one
-- transaction (CLI / direct connection) and statement-by-statement through a connection pooler
-- (Supabase SQL editor).

-- ── helper: dominant IANA timezone per US state / CA province (mirrors shared/efsImport.ts) ─────────
create or replace function efs_state_tz(state text) returns text
language sql immutable as $$
  select case upper(trim(state))
    -- Eastern
    when 'CT' then 'America/New_York' when 'DE' then 'America/New_York' when 'FL' then 'America/New_York'
    when 'GA' then 'America/New_York' when 'IN' then 'America/New_York' when 'KY' then 'America/New_York'
    when 'MA' then 'America/New_York' when 'MD' then 'America/New_York' when 'ME' then 'America/New_York'
    when 'MI' then 'America/New_York' when 'NC' then 'America/New_York' when 'NH' then 'America/New_York'
    when 'NJ' then 'America/New_York' when 'NY' then 'America/New_York' when 'OH' then 'America/New_York'
    when 'PA' then 'America/New_York' when 'RI' then 'America/New_York' when 'SC' then 'America/New_York'
    when 'VA' then 'America/New_York' when 'VT' then 'America/New_York' when 'WV' then 'America/New_York'
    when 'DC' then 'America/New_York' when 'ON' then 'America/Toronto'  when 'QC' then 'America/Toronto'
    -- Atlantic / Newfoundland
    when 'NB' then 'America/Halifax' when 'NS' then 'America/Halifax' when 'PE' then 'America/Halifax'
    when 'NL' then 'America/St_Johns'
    -- Central
    when 'AL' then 'America/Chicago' when 'AR' then 'America/Chicago' when 'IA' then 'America/Chicago'
    when 'IL' then 'America/Chicago' when 'KS' then 'America/Chicago' when 'LA' then 'America/Chicago'
    when 'MN' then 'America/Chicago' when 'MO' then 'America/Chicago' when 'MS' then 'America/Chicago'
    when 'ND' then 'America/Chicago' when 'NE' then 'America/Chicago' when 'OK' then 'America/Chicago'
    when 'SD' then 'America/Chicago' when 'TN' then 'America/Chicago' when 'TX' then 'America/Chicago'
    when 'WI' then 'America/Chicago' when 'MB' then 'America/Winnipeg' when 'SK' then 'America/Regina'
    -- Mountain
    when 'AZ' then 'America/Phoenix' when 'CO' then 'America/Denver' when 'ID' then 'America/Denver'
    when 'MT' then 'America/Denver'  when 'NM' then 'America/Denver' when 'UT' then 'America/Denver'
    when 'WY' then 'America/Denver'  when 'AB' then 'America/Edmonton'
    -- Pacific / other
    when 'CA' then 'America/Los_Angeles' when 'NV' then 'America/Los_Angeles'
    when 'OR' then 'America/Los_Angeles' when 'WA' then 'America/Los_Angeles'
    when 'BC' then 'America/Vancouver'   when 'AK' then 'America/Anchorage'
    when 'HI' then 'Pacific/Honolulu'    when 'NT' then 'America/Yellowknife'
    when 'NU' then 'America/Iqaluit'     when 'YT' then 'America/Whitehorse'
    else null
  end;
$$;

-- ── 1) explicit timestamp precision ────────────────────────────────────────────────────────────────
alter table fuel_transactions add column if not exists fueled_at_precision text
  check (fueled_at_precision in ('instant', 'date'));

-- ── 2) restore the EFS business time on recon-rewritten rows ───────────────────────────────────────
-- Old scorer wrote fueled_at = samsara_recon_at for date-only EFS rows. The faithful efs_transactions
-- store still has the report's time; join back via the ref prefix (card|invoice). Under the OLD keys a
-- reused invoice could only ever produce ONE fuel row (the first occurrence), so min(fueled_at) is that
-- occurrence. Rows with no efs match (pre-0011 imports) keep the recon time — still within ±30h.
update fuel_transactions f
set fueled_at = e.efs_fueled_at
from (
  select org_id,
         coalesce(card_num, '') || '|' || invoice as ref,
         min(fueled_at) as efs_fueled_at
  from efs_transactions
  where invoice is not null and fueled_at is not null
  group by 1, 2
) e
where f.source = 'fuel_card'
  and f.samsara_recon_at is not null
  and f.fueled_at = f.samsara_recon_at
  and f.org_id = e.org_id
  and f.external_ref = e.ref;

-- Backfill precision AFTER the restore (the sentinel test needs the business time back).
update fuel_transactions
set fueled_at_precision = case
  when source = 'manual' then 'instant'
  when (fueled_at at time zone 'UTC')::time = time '12:00:00' then 'date'
  else 'instant'
end
where fueled_at_precision is null;

alter table fuel_transactions alter column fueled_at_precision set default 'instant';
alter table fuel_transactions alter column fueled_at_precision set not null;

-- ── 2b) remove duplicates created by imports that ran with the NEW (date-scoped) code BEFORE this
-- migration was applied ─────────────────────────────────────────────────────────────────────────────
-- If a file was re-imported under the new parser, its rows landed with date-scoped refs that didn't
-- match the old-format rows already present — the same physical line/fill now exists twice, and the
-- ref rewrite below would collide with the new twin (23505). The ORIGINAL old-format row is the
-- keeper (it carries the Samsara reconciliation + any reviewer workflow); the re-import twin is
-- deleted. anomalies / ai_verifications on the twin cascade; legacy import_rows pointers detach first.

update import_rows ir
set transaction_id = null
where ir.transaction_id in (
  select n.id
  from fuel_transactions n
  join fuel_transactions o
    on  o.org_id = n.org_id
    and n.external_ref = o.external_ref || '|' || to_char(o.fueled_at at time zone 'UTC', 'YYYY-MM-DD')
  where o.source = 'fuel_card'
    and o.external_ref is not null
    and o.external_ref !~ '\|\d{4}-\d{2}-\d{2}$'
);

delete from fuel_transactions n
using fuel_transactions o
where o.org_id = n.org_id
  and o.source = 'fuel_card'
  and o.external_ref is not null
  and o.external_ref !~ '\|\d{4}-\d{2}-\d{2}$'
  and n.external_ref = o.external_ref || '|' || to_char(o.fueled_at at time zone 'UTC', 'YYYY-MM-DD');

delete from efs_transactions n
using efs_transactions o
where o.org_id = n.org_id
  and o.external_ref is not null
  and o.external_ref !~ '\|\d{4}-\d{2}-\d{2}$'
  and n.external_ref = o.external_ref || '|' || coalesce(to_char(o.tran_date, 'YYYY-MM-DD'), '');

delete from declined_transactions n
using declined_transactions o
where o.org_id = n.org_id
  and o.external_ref is not null
  and o.external_ref !~ '\|\d{4}-\d{2}-\d{2}$'
  and n.external_ref = o.external_ref || '|' || to_char(o.declined_at at time zone 'UTC', 'YYYY-MM-DD');

-- ── 3+4) date-scope the dedupe keys AND convert naive wall-clock times — ONE atomic statement per
-- table ──────────────────────────────────────────────────────────────────────────────────────────────
-- Both derived values are computed from the row's PRE-UPDATE state (SQL update semantics), which is
-- what makes this correct: the new ref needs the business date (= the UTC date BEFORE the shift), and
-- the old-format ref is simultaneously the only reliable marker that a row's time is naive local-as-UTC
-- (rows written by the new parser are already true UTC and already date-scoped — they are never
-- touched). No temp tables: connection-pooled runners (Supabase SQL editor) don't keep a session
-- between statements, so session state must never be relied on.
--
-- Shift guards (inside the CASE):
--   • precision = 'instant' only (noon-sentinel date rows keep their sentinel by design)
--   • never rows still equal to samsara_recon_at (already true UTC from telematics)
--   • only states we can map (unknown state → keep deterministic naive-UTC)
-- The NOT EXISTS guard is belt-and-braces for any twin 2b could not pair (e.g. a pre-0011 row whose
-- business date could not be restored and sits ±1 day off): such a row keeps its old-format ref and
-- naive time — still unique, still functional — instead of aborting the whole migration.
update fuel_transactions f
set external_ref = f.external_ref || '|' || to_char(f.fueled_at at time zone 'UTC', 'YYYY-MM-DD'),
    fueled_at = case
      when f.fueled_at_precision = 'instant'
       and (f.samsara_recon_at is null or f.fueled_at <> f.samsara_recon_at)
       and efs_state_tz(f.state) is not null
      then ((f.fueled_at at time zone 'UTC') at time zone efs_state_tz(f.state))
      else f.fueled_at
    end
where f.source = 'fuel_card'
  and f.external_ref is not null
  and f.external_ref !~ '\|\d{4}-\d{2}-\d{2}$'
  and not exists (
    select 1 from fuel_transactions x
    where x.org_id = f.org_id
      and x.external_ref = f.external_ref || '|' || to_char(f.fueled_at at time zone 'UTC', 'YYYY-MM-DD')
  );

update efs_transactions e
set external_ref = e.external_ref || '|' || coalesce(to_char(e.tran_date, 'YYYY-MM-DD'), ''),
    fueled_at = case
      when e.fueled_at is not null
       and (e.fueled_at at time zone 'UTC')::time <> time '12:00:00'
       and efs_state_tz(e.state) is not null
      then ((e.fueled_at at time zone 'UTC') at time zone efs_state_tz(e.state))
      else e.fueled_at
    end
where e.external_ref is not null
  and e.external_ref !~ '\|\d{4}-\d{2}-\d{2}$'
  and not exists (
    select 1 from efs_transactions x
    where x.org_id = e.org_id
      and x.external_ref = e.external_ref || '|' || coalesce(to_char(e.tran_date, 'YYYY-MM-DD'), '')
  );

update declined_transactions d
set external_ref = d.external_ref || '|' || to_char(d.declined_at at time zone 'UTC', 'YYYY-MM-DD'),
    declined_at = case
      when (d.declined_at at time zone 'UTC')::time <> time '12:00:00'
       and efs_state_tz(d.state) is not null
      then ((d.declined_at at time zone 'UTC') at time zone efs_state_tz(d.state))
      else d.declined_at
    end
where d.external_ref is not null
  and d.external_ref !~ '\|\d{4}-\d{2}-\d{2}$'
  and not exists (
    select 1 from declined_transactions x
    where x.org_id = d.org_id
      and x.external_ref = d.external_ref || '|' || to_char(d.declined_at at time zone 'UTC', 'YYYY-MM-DD')
  );

-- ── 4b) odometer tolerance default 5 → 10 mi ───────────────────────────────────────────────────────
-- The Samsara reference odometer is a GPS-interpolated stop reading (±1h anchor slack, 0.1 mi
-- rounding); ±5 flagged honest entries. Rows still at the old default move to the new one; any org
-- that explicitly saved a different value is left alone (indistinguishable 5s move too — acceptable,
-- the setting remains editable in Settings → Thresholds).
alter table anomaly_thresholds alter column odometer_tolerance_miles set default 10;
update anomaly_thresholds set odometer_tolerance_miles = 10 where odometer_tolerance_miles = 5;

-- ── 5) import reconciliation summary ───────────────────────────────────────────────────────────────
alter table imports add column if not exists summary jsonb;
comment on column imports.summary is
  'Post-commit reconciliation: rows-per-day in the file vs rows actually in the DB (detects silent loss).';

-- ── 6) retryable negative geocode cache ────────────────────────────────────────────────────────────
alter table geocode_cache add column if not exists updated_at timestamptz not null default now();

-- ── 7) completion marker ───────────────────────────────────────────────────────────────────────────
-- Records that the one-shot data conversions (tz shift) ran, so repair scripts can refuse to run
-- twice (a second shift would corrupt the timestamps). Deliberately the LAST statement: on a
-- statement-by-statement runner it only executes if everything above succeeded. RLS enabled with no
-- policies = invisible to the API; the SQL editor / service role bypasses RLS.
create table if not exists migration_markers (
  key     text primary key,
  done_at timestamptz not null default now()
);
alter table migration_markers enable row level security;
insert into migration_markers (key) values ('0026_tz_shift') on conflict (key) do nothing;
