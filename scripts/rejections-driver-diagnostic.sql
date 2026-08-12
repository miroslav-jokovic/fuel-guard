-- ═══ FuelGuard — Rejections "Driver" column diagnostic ═══════════════════════════════════════
-- Read-only. Nothing here writes, locks, or deletes. Safe to run against production.
--
-- Supabase's SQL Editor shows only the LAST statement's result, so run the two blocks
-- SEPARATELY: highlight BLOCK 1 → Run, then highlight BLOCK 2 → Run.


-- ╔═══════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ BLOCK 1 — PREFLIGHT                                                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════════╝

-- ── PREFLIGHT — run this FIRST. Confirms the diagnostic below can actually run. ────────────────
-- If anything says MISSING, tell me which one before running the main query: a missing table makes
-- the main query error out rather than return a wrong answer, and it also tells us that migration
-- never landed (docs/22 records one migration being silently skipped by a version collision).
select
  t.label,
  case when t.ok then 'present' else 'MISSING' end as status
from (
  values
    ('table  declined_transactions',
       to_regclass('public.declined_transactions') is not null),
    ('table  efs_transactions',
       to_regclass('public.efs_transactions') is not null),
    ('table  efs_cards                (migration 0171)',
       to_regclass('public.efs_cards') is not null),
    ('table  imports',
       to_regclass('public.imports') is not null),
    ('table  drivers',
       to_regclass('public.drivers') is not null),
    ('column declined_transactions.driver_name    (0011)',
       exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='declined_transactions' and column_name='driver_name')),
    ('column declined_transactions.driver_ext_id  (0007)',
       exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='declined_transactions' and column_name='driver_ext_id')),
    ('column efs_cards.driver_name               (0171)',
       exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='efs_cards' and column_name='driver_name')),
    ('column efs_cards.absent_since              (0181)',
       exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='efs_cards' and column_name='absent_since')),
    ('column drivers.efs_driver_id               (0079)',
       exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='drivers' and column_name='efs_driver_id'))
) as t(label, ok)
order by t.ok, t.label;


-- ╔═══════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ BLOCK 2 — THE DIAGNOSTIC                                                                  ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- FuelGuard — REJECTIONS "Driver" COLUMN DIAGNOSTIC          read-only, safe to run in production
-- Paste the whole thing into Supabase → SQL Editor → Run. Returns ONE table, read top to bottom.
--
--   A. Is driver_name blank on declines — and is it blank ONLY on the SOAP feed path?
--   B. Do we already hold the driver for those cards somewhere else?
--   C. If we backfilled from what we hold, how many rows would light up, and what stays unknown?
--
-- Scoping: runs across every org in the database. To pin it to one org, add the org filter marked
-- ⇩ ORG FILTER below.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

with

-- EFS space-pads card refs ('7083050030485867142      '), so every comparison is digits-only.
-- last4 is the one key both sides can always produce; the full PAN is the exact one.
d as (
  select dt.id,
         dt.driver_name,
         dt.driver_ext_id,
         dt.driver_id,
         dt.vehicle_id,
         regexp_replace(coalesce(dt.card_ref,''), '\D', '', 'g')           as card_digits,
         right(regexp_replace(coalesce(dt.card_ref,''), '\D', '', 'g'), 4) as card_last4,
         coalesce(i.source::text, '(no import row)')                       as source
  from declined_transactions dt
  left join imports i on i.id = dt.import_id
  -- ⇩ ORG FILTER: where dt.org_id = '00000000-0000-0000-0000-000000000000'
),

-- The posted feed DOES carry the driver (infos NAME / DRID) — this is the same card, seen approved.
posted as (
  select regexp_replace(coalesce(card_num,''), '\D', '', 'g') as card_digits,
         max(driver_name)   filter (where nullif(trim(driver_name),'')   is not null) as driver_name,
         max(driver_ext_id) filter (where nullif(trim(driver_ext_id),'') is not null) as driver_ext_id
  from efs_transactions
  group by 1
),

-- The EFS card mirror. absent_since = the roster stopped returning it (tombstoned, 0181).
mirror as (
  select card_last4,
         max(driver_name)      filter (where nullif(trim(driver_name),'')      is not null) as driver_name,
         max(driver_id_prompt) filter (where nullif(trim(driver_id_prompt),'') is not null) as driver_ext_id,
         count(*) as cards_sharing_last4
  from efs_cards
  where absent_since is null
  group by 1
),

resolved as (
  select d.*,
         p.driver_name as posted_driver_name,
         m.driver_name as mirror_driver_name,
         m.cards_sharing_last4
  from d
  left join posted p on p.card_digits = d.card_digits and length(d.card_digits) >= 8
  left join mirror m on m.card_last4  = d.card_last4  and length(d.card_last4)  = 4
),

blank as (select * from resolved where nullif(trim(driver_name),'') is null),

metrics as (

  -- ── A. what the Rejections page is reading ───────────────────────────────────────────────────
  select 10 as ord, 'A. declines today' as section,
         'total decline rows' as metric, count(*)::bigint as value from resolved
  union all select 11, 'A. declines today', '  … with a driver NAME',
         count(*) from resolved where nullif(trim(driver_name),'') is not null
  union all select 12, 'A. declines today', '  … with an EFS driver ID (driver_ext_id)',
         count(*) from resolved where driver_ext_id is not null
  union all select 13, 'A. declines today', '  … linked to a driver record (driver_id)',
         count(*) from resolved where driver_id is not null
  union all select 14, 'A. declines today', '  … linked to a vehicle (vehicle_id)',
         count(*) from resolved where vehicle_id is not null

  -- Split by ingest path. If SOAP is 0% and xlsx is ~100%, the mapping is the whole story.
  union all select 20, 'B. by ingest path',
         'rows from ' || source || ' — WITH driver name', count(*) filter (where nullif(trim(driver_name),'') is not null)
         from resolved group by source
  union all select 21, 'B. by ingest path',
         'rows from ' || source || ' — total', count(*)
         from resolved group by source

  -- ── C. do we hold the answer elsewhere? ──────────────────────────────────────────────────────
  union all select 30, 'C. what we hold', 'efs_cards rows (live)', count(*) from efs_cards where absent_since is null
  union all select 31, 'C. what we hold', '  … carrying a driver_name',
         count(*) from efs_cards where absent_since is null and nullif(trim(driver_name),'') is not null
  union all select 32, 'C. what we hold', 'distinct cards seen in posted-feed history', count(*) from posted
  union all select 33, 'C. what we hold', '  … whose posted rows carry a driver_name',
         count(*) from posted where driver_name is not null
  union all select 34, 'C. what we hold', 'driver records on the roster', count(*) from drivers
  union all select 35, 'C. what we hold', '  … with efs_driver_id learned',
         count(*) from drivers where nullif(trim(efs_driver_id),'') is not null

  -- ── D. what a backfill recovers ──────────────────────────────────────────────────────────────
  union all select 40, 'D. backfill potential', 'declines with a BLANK driver name', count(*) from blank
  union all select 41, 'D. backfill potential', '  … fillable from the card mirror',
         count(*) from blank where mirror_driver_name is not null
  union all select 42, 'D. backfill potential', '  … fillable from posted-feed history',
         count(*) from blank where posted_driver_name is not null
  union all select 43, 'D. backfill potential', '  … fillable from EITHER source',
         count(*) from blank where coalesce(mirror_driver_name, posted_driver_name) is not null
  union all select 44, 'D. backfill potential', '  … STILL unknown after both',
         count(*) from blank where coalesce(mirror_driver_name, posted_driver_name) is null

  -- ── E. caveats that would make a backfill guess ──────────────────────────────────────────────
  union all select 50, 'E. match quality', 'blank rows whose card_ref is a full PAN (exact match possible)',
         count(*) from blank where length(card_digits) >= 8
  union all select 51, 'E. match quality', 'blank rows whose card_ref is NOT a full PAN (last4 only)',
         count(*) from blank where length(card_digits) < 8
  union all select 52, 'E. match quality', 'blank rows whose last4 is shared by 2+ mirror cards (ambiguous)',
         count(*) from blank where cards_sharing_last4 > 1
)

select section, metric, value,
       case when value = 0 then '—' else to_char(value, 'FM999G999') end as count
from metrics
order by ord, metric;
