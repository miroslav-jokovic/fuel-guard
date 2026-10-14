-- 0473: who was driving at each roadside inspection, when it happened, and the telematics frozen
-- around it (INSPECTION-CHALLENGE-PLAN.md IC5; D-IC4, D-IC7, D-IC8).
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────────
-- FMCSA's public record does not name the driver, and its times are the officer's local HHMM with no
-- zone. Our own `hos_duty_segments` resolves the driver for 31% of inspections (it starts 2026-04-07).
-- Measured 2026-10-14 instead: Samsara's HOS driver–vehicle assignments, GPS history, HOS logs and
-- DVIRs all answer for the whole three-year record (Q-IC6, Q-IC7), and 1,226 of 1,388 inspections'
-- power units are trucks of ours that Samsara knows. Every later rule that argues "not our driver",
-- "not there" or "the defect was repaired" (IC6) stands on these two tables.
--
-- ── TWO TABLES, BOTH APPEND-ONLY, BOTH RETENTION_FORBIDDEN ───────────────────────────────────────
-- `inspection_attributions` — one row per reading of an inspection: the resolved instant and how it
-- was resolved, what the GPS said about the truck at it, and the driver Samsara's assignments put on
-- the truck, with a confidence. The engine writes one per inspection per `engine_version`; a person
-- who confirms or corrects it writes another (`source = 'person'`). Nothing is ever updated: a
-- correction that overwrote the engine's reading would erase what the filing was first drafted from.
--
-- `inspection_evidence_snapshots` — one row per frozen Samsara answer (D-IC4): the endpoint, the exact
-- request, the HTTP status, the time it was asked, and the sha256 of the bytes as received. The bytes
-- themselves are NOT in the row: a ±2 h GPS window is ~400 KB, ~550 MB across the backfill, and the
-- database is a swapping Micro instance (DATA-LIFECYCLE-PLAN, measured 2026-09-22). They are stored
-- gzipped in the private bucket below, at `storage_path`; the row keeps the hash, the size and a small
-- summary a reader can show without fetching them. An empty answer is frozen too — "Samsara had no
-- assignment" is evidence, and the plan's `evidence_unavailable` is exactly that row.
--
-- ── NO FOREIGN KEY TO DRIVERS ────────────────────────────────────────────────────────────────────
-- The engine records the driver as Samsara named it (`samsara_driver_id`, `samsara_driver_name`): that
-- is the evidence. Our driver is that id read through `drivers.samsara_driver_id` when the page asks.
-- A `drivers(id)` column here would put an append-only table in `merge_driver`'s move list, which
-- must update it, and the trigger below would refuse the merge. A person's correction that names one
-- of our drivers carries `driver_id` with no FK for the same reason; the reader resolves it.
--
-- ── RLS DENY-ALL, A PRIVATE BUCKET WITH NO POLICY ────────────────────────────────────────────────
-- Service role only; every API query filters `org_id` itself. The bucket has no `storage.objects`
-- policy, like `document-intake` (0448): the org prefix of every object path is applied by the API
-- from the org it is working for, never taken from a request.
--
-- New tables, so their writer (`apps/api/src/modules/inspections/attribution/`) ships in this same
-- merge (`lint:migration-ordering` exempts new tables).

create table if not exists public.inspection_attributions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null,
  source text not null check (source in ('engine', 'person')),
  -- `ATTRIBUTION_ENGINE_VERSION` (D-IC5): the version an engine row IS, or the version of the engine
  -- reading a person's row decided over — a confirmation answers one reading, not the inspection.
  engine_version text not null check (length(btrim(engine_version)) > 0),
  -- ── the instant (D-IC8) ──
  zone text,
  zone_method text not null check (zone_method in ('gps', 'state_only', 'unresolved')),
  started_at timestamptz,
  ended_at timestamptz,
  location_check text not null check (location_check in ('confirmed', 'other_state', 'unplaced', 'moving', 'no_gps')),
  -- ── the truck and the driver (D-IC7) ──
  vehicle_id uuid,
  samsara_vehicle_id text,
  outcome text not null
    check (outcome in ('one_driver', 'several_drivers', 'no_assignment', 'no_samsara_vehicle', 'no_matched_tractor')),
  samsara_driver_id text,
  samsara_driver_name text,
  basis text check (basis in ('covering', 'bracketing', 'before_only', 'after_only')),
  confidence text check (confidence in ('high', 'low')),
  -- Every driver the window held, with their assignment segments, so a person deciding sees the same.
  candidates jsonb not null default '[]'::jsonb,
  -- A person's reading only: who decided, and which of our drivers they named (null = "not one of ours").
  decided_by uuid,
  driver_id uuid,
  note text,
  created_at timestamptz not null default now(),
  constraint inspection_attributions_inspection_fk
    foreign key (inspection_id, org_id) references public.roadside_inspections (id, org_id),
  constraint inspection_attributions_person_named check ((source = 'person') = (decided_by is not null)),
  -- A driver, a basis and a confidence exist only together, and only when there was one driver.
  constraint inspection_attributions_one_driver check (
    (outcome = 'one_driver') = (samsara_driver_id is not null)
    and (samsara_driver_id is null) = (basis is null)
    and (basis is null) = (confidence is null)
  ),
  constraint inspection_attributions_instant_pair check ((started_at is null) = (ended_at is null) and (started_at is null) = (zone is null)),
  constraint inspection_attributions_candidates_array check (jsonb_typeof(candidates) = 'array')
);

create index if not exists inspection_attributions_latest_idx
  on public.inspection_attributions (org_id, inspection_id, created_at desc);
-- The backlog's question, "which inspections have no engine reading at this version yet".
create unique index if not exists inspection_attributions_engine_once
  on public.inspection_attributions (org_id, inspection_id, engine_version) where source = 'engine';

-- raw-access-waiver: inspection_evidence_snapshots is the `inspections` module's own raw store of what
-- Samsara answered, created here and written only by modules/inspections/attribution/freeze.ts.
create table if not exists public.inspection_evidence_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null,
  kind text not null check (kind in ('gps_window', 'assignments', 'hos_logs', 'dvirs')),
  temporal_class text not null check (temporal_class in ('contemporaneous', 'post_event', 'context')),
  -- The request exactly as sent: path and every query parameter, so it can be asked again.
  source_endpoint text not null check (source_endpoint like '/%'),
  request jsonb not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  retrieved_at timestamptz not null,
  http_status integer not null,
  -- The bytes as received (every page, in order), hashed before compression; stored gzipped.
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check (byte_size >= 0),
  storage_path text not null,
  item_count integer not null check (item_count >= 0),
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint inspection_evidence_snapshots_inspection_fk
    foreign key (inspection_id, org_id) references public.roadside_inspections (id, org_id),
  constraint inspection_evidence_snapshots_window check (window_end >= window_start),
  -- The object lives under the org's own prefix.
  constraint inspection_evidence_snapshots_path_org check (storage_path like org_id::text || '/%')
);

create index if not exists inspection_evidence_snapshots_inspection_idx
  on public.inspection_evidence_snapshots (org_id, inspection_id, kind);

create or replace function public.inspection_evidence_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: % is refused (a reading or a frozen answer is corrected by a new row)', tg_table_name, tg_op
    using errcode = 'IA010';
end;
$$;

drop trigger if exists trg_inspection_attributions_append_only on public.inspection_attributions;
create trigger trg_inspection_attributions_append_only
  before update or delete on public.inspection_attributions
  for each row execute function public.inspection_evidence_append_only();

drop trigger if exists trg_inspection_evidence_snapshots_append_only on public.inspection_evidence_snapshots;
create trigger trg_inspection_evidence_snapshots_append_only
  before update or delete on public.inspection_evidence_snapshots
  for each row execute function public.inspection_evidence_append_only();

alter table public.inspection_attributions enable row level security;
alter table public.inspection_evidence_snapshots enable row level security;

comment on table public.inspection_attributions is
  'IC5 (0472): who was driving at a roadside inspection and when it happened — one append-only row per engine version or person''s decision (D-IC7, D-IC8). Service role only; RETENTION_FORBIDDEN.';
comment on table public.inspection_evidence_snapshots is
  'IC5 (0472): a frozen Samsara answer around an inspection — request, status, sha256; bytes gzipped in the inspection-evidence bucket (D-IC4). Append-only; RETENTION_FORBIDDEN.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- The bucket. Private, no policy (service role only). 10 MB is ~25× the largest answer measured: a day's
-- DVIRs for the whole fleet came back at 419 KB on 2026-09-22.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit)
values ('inspection-evidence', 'inspection-evidence', false, 10 * 1024 * 1024)
on conflict (id) do nothing;
