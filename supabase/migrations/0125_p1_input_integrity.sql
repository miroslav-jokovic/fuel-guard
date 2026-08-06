-- 0125: P1 input-integrity batch (2026-08 duplication audit) — duplicate-input classes that feed
-- detection rules, each with cleanup FIRST, then the constraint that makes recurrence impossible.

-- ── 1. imports.file_hash — enforce the file-level idempotency the code only ever ASSUMED ─────────
-- The check in efsIngest/useImport is read-then-write and idx_imports_file_hash (0017) is NOT
-- unique, so two concurrent deliveries of one file both passed the gate and both ran a scoring
-- cascade. Historical duplicate uploads exist and are legitimate records — keep the rows, but NULL
-- the hash on all but the newest so the partial unique index can build (the hash's only purpose is
-- the "already imported?" check, which only needs the newest carrier).
with ranked as (
  select id,
         row_number() over (partition by org_id, file_hash order by created_at desc, id desc) as rn
  from imports
  where file_hash is not null
)
update imports i
set file_hash = null
from ranked r
where i.id = r.id and r.rn > 1;

create unique index if not exists uq_imports_org_file_hash
  on imports (org_id, file_hash)
  where file_hash is not null;

-- ── 2. fuel_prices_posted — a snapshot identity, so replicated fetchers can't stack rows ─────────
-- The posted-price fetcher had no cross-replica lock and the table no unique key: two replicas both
-- ran delete-by-source + insert, and interleavings left duplicate price rows feeding the
-- cost_outlier market median. Ingest now buckets fallback timestamps to the hour and upserts with
-- ignoreDuplicates against this key, so identical snapshots collapse instead of stacking.
delete from fuel_prices_posted a
using fuel_prices_posted b
where a.id > b.id
  and a.station_id = b.station_id
  and a.product    = b.product
  and a.price_kind = b.price_kind
  and a.source     = b.source
  and a.observed_at = b.observed_at;

create unique index if not exists uq_fpp_snapshot
  on fuel_prices_posted (station_id, product, price_kind, source, observed_at);

-- ── 3. driver_time_off — no more best-effort appends (fed fuel_while_driver_home directly) ───────
-- Windows without a provider external_id were APPENDED on every re-ingest (tmsIngest.ts admitted
-- it). Ingest now derives a deterministic synthetic id from content; this backfill applies the SAME
-- formula to stored null-id rows so the first post-deploy re-ingest matches them instead of
-- duplicating them. Exact-duplicate appends are removed first (keep the oldest).
delete from driver_time_off a
using driver_time_off b
where a.id > b.id
  and a.external_id is null and b.external_id is null
  and a.org_id = b.org_id
  and a.provider = b.provider
  and a.driver_id is not distinct from b.driver_id
  and a.start_at = b.start_at
  and a.end_at is not distinct from b.end_at
  and a.kind = b.kind;

update driver_time_off
set external_id = 'synthetic:' || coalesce(driver_id::text, 'na')
    || ':' || extract(epoch from start_at)::bigint
    || ':' || coalesce((extract(epoch from end_at)::bigint)::text, 'open')
    || ':' || kind
where external_id is null;
