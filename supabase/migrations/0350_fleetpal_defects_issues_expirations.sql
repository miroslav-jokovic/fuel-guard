-- 0350: what is WRONG with a unit — defects, issues and expirations.
--
-- FLEETPAL-INTEGRATION-PLAN.md step F7 (D-FP1, D-FP8, §2.7). 0349 staged what a repair COST; this
-- stages what is outstanding against a truck before anybody spends anything on it, and it is the
-- feed F11 turns into worklists.
--
-- ── ⚠ TWO OF THESE THREE CANNOT BE WATERMARKED, AND THE CODE MUST KEEP SAYING SO ──────────────
-- `Defect` and `Expiration` carry **no `updated` field at all** — the vendor's own document, and
-- verified against the live account on 2026-09-21. Their endpoints offer `detected_after` and
-- `expires_before` instead, which are about when a thing came into existence or falls due and NOT
-- about when it last changed. So:
--
--   · defects     — `is_resolved=false` in full (the outstanding ones), PLUS
--                   `detected_after=<last run>` to catch the ones that resolved in between.
--   · expirations — `is_completed=false` in full. It is small: zero rows on the live account.
--   · issues      — the ordinary watermark; `Issue` does carry `updated`.
--
-- Three sibling resources syncing three different ways is exactly the shape a later maintainer
-- "fixes". `fleetpal_sync_state` keeps a window position in a different column from a watermark so
-- the two cannot be confused, and the ingest for each of these names the vendor constraint out loud.
--
-- ── ⚠ `dvirs` IS AN ARRAY OF IDS NOTHING RESOLVES ─────────────────────────────────────────────
-- There is no `/v1/dvirs` endpoint — checked against the full 71-path list. The column is stored
-- because a defect carried across several inspections lists several of them, which is evidence of
-- how long it went unrepaired even when we cannot open the reports. Any DVIR surface in the product
-- comes from our own driver app, not from here (§2.10.1).
--
-- ── ⚠ `target_status` NAMES A UNIT STATUS NOTHING EXPOSES ─────────────────────────────────────
-- The vendor references a unit-status resource three times across its document and ships no
-- endpoint for it; F4 then found 8 distinct opaque status ids on the live units and no way to
-- resolve any of them (§2.10.5). So we can read that lapsing an obligation changes the unit's
-- status, and we cannot say to what. Stored as the opaque id it is, and no surface may invent a
-- label for it.
--
-- VMRS ids are stored as codes only (D-FP8), as everywhere else in this collector.
--
-- raw-access-waiver: the three `fleetpal_*` tables below are raw-layer tables of THIS migration's
-- own module, created here, referenced only by the three `stage_fleetpal_*` functions this file
-- defines. Same reasoning as 0334 and 0349: a .sql file has no module directory, so the waiver is
-- how the authoring PR names the collector that consented.
--
-- Rollback: drop the three stage_fleetpal_* functions, then drop table fleetpal_expirations,
-- fleetpal_issues, fleetpal_defects.

create table if not exists fleetpal_defects (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  fleetpal_id       text not null check (length(btrim(fleetpal_id)) > 0),
  unit_fleetpal_id  text,
  name              text,
  description       text,
  severity          text,
  component         text,
  complaint         text,
  detected_on       timestamptz,
  is_resolved       boolean,
  resolved_on       timestamptz,
  -- Free text a driver typed and a technician typed back. Stored because the pair is the whole
  -- account of what was wrong and what was done, and it is the only such account FleetPal keeps.
  driver_comment    text,
  repair_note       text,
  -- ⚠ Opaque ids no endpoint resolves — see the header. `text[]` rather than jsonb because it is a
  -- list of ids and nothing more, and an array can be searched with `&&` the day that helps.
  dvir_fleetpal_ids text[],
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint fleetpal_defects_org_vendor_id_key unique (org_id, fleetpal_id)
);

comment on table fleetpal_defects is
  'Defects found on inspections, staged (F7). No `updated` field exists at the vendor, so this is a bounded re-read — unresolved in full plus detected_after — and never a watermark (§2.7).';
comment on column fleetpal_defects.dvir_fleetpal_ids is
  'The inspection reports this defect came from. Opaque: there is no /v1/dvirs endpoint (§2.10.1). Kept as evidence of how long a defect went unrepaired, never as something to follow.';

create index if not exists idx_fleetpal_defects_org_unit
  on fleetpal_defects (org_id, unit_fleetpal_id);
-- The open worklist F11 reads, which is the only query this table exists to answer quickly.
create index if not exists idx_fleetpal_defects_org_open
  on fleetpal_defects (org_id, detected_on desc) where is_resolved = false;

alter table fleetpal_defects enable row level security;

create table if not exists fleetpal_issues (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  fleetpal_id       text not null check (length(btrim(fleetpal_id)) > 0),
  unit_fleetpal_id  text,
  name              text,
  description       text,
  priority          text,
  status            text,
  component         text,
  complaint         text,
  reason_for_repair text,
  reason_closed     text,
  reported          timestamptz,
  vendor_created_at timestamptz,
  vendor_updated_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint fleetpal_issues_org_vendor_id_key unique (org_id, fleetpal_id)
);

comment on table fleetpal_issues is
  'Reported problems ahead of any work order (F7). Unlike a defect, an Issue DOES carry `updated`, so this one watermarks like the repair record.';

create index if not exists idx_fleetpal_issues_org_unit
  on fleetpal_issues (org_id, unit_fleetpal_id);
create index if not exists idx_fleetpal_issues_org_open
  on fleetpal_issues (org_id, reported desc) where status <> 'CLOSED';

alter table fleetpal_issues enable row level security;

create table if not exists fleetpal_expirations (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  fleetpal_id        text not null check (length(btrim(fleetpal_id)) > 0),
  unit_fleetpal_id   text,
  name               text,
  description        text,
  expiration_date    timestamptz,
  threshold_value    integer,
  threshold_type     text,
  alters_unit_status boolean,
  -- ⚠ A unit-status id nothing exposes. See the header; no surface may invent a label for it.
  target_status      text,
  is_completed       boolean,
  -- The vendor derives this from the date and the threshold: PLANNED · DUE_SOON · OVERDUE ·
  -- COMPLETED. Stored as sent rather than recomputed — their threshold, their verdict.
  status             text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint fleetpal_expirations_org_vendor_id_key unique (org_id, fleetpal_id)
);

comment on table fleetpal_expirations is
  'Dated obligations against a unit — registration, insurance, permits (F7). ZERO rows on the live account on 2026-09-21: the carrier tracks none of this in FleetPal, so anything built on it ships proved against the spec and nothing else.';

create index if not exists idx_fleetpal_expirations_org_unit
  on fleetpal_expirations (org_id, unit_fleetpal_id);
create index if not exists idx_fleetpal_expirations_org_due
  on fleetpal_expirations (org_id, expiration_date) where is_completed = false;

alter table fleetpal_expirations enable row level security;

-- ── the ingest, set-based — same three properties as 0349 ───────────────────────────────────────

create or replace function public.stage_fleetpal_defects(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare written int;
begin
  insert into public.fleetpal_defects as t (
    org_id, fleetpal_id, unit_fleetpal_id, name, description, severity, component, complaint,
    detected_on, is_resolved, resolved_on, driver_comment, repair_note, dvir_fleetpal_ids
  )
  select p_org, r.fleetpal_id, r.unit_fleetpal_id, r.name, r.description, r.severity, r.component,
         r.complaint, r.detected_on, r.is_resolved, r.resolved_on, r.driver_comment, r.repair_note,
         r.dvir_fleetpal_ids
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           fleetpal_id text, unit_fleetpal_id text, name text, description text, severity text,
           component text, complaint text, detected_on timestamptz, is_resolved boolean,
           resolved_on timestamptz, driver_comment text, repair_note text, dvir_fleetpal_ids text[])
  on conflict (org_id, fleetpal_id) do update
    set unit_fleetpal_id = excluded.unit_fleetpal_id, name = excluded.name,
        description = excluded.description, severity = excluded.severity,
        component = excluded.component, complaint = excluded.complaint,
        detected_on = excluded.detected_on, is_resolved = excluded.is_resolved,
        resolved_on = excluded.resolved_on, driver_comment = excluded.driver_comment,
        repair_note = excluded.repair_note, dvir_fleetpal_ids = excluded.dvir_fleetpal_ids,
        updated_at = now();
  get diagnostics written = row_count;
  return written;
end;
$$;

create or replace function public.stage_fleetpal_issues(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare written int;
begin
  insert into public.fleetpal_issues as t (
    org_id, fleetpal_id, unit_fleetpal_id, name, description, priority, status, component,
    complaint, reason_for_repair, reason_closed, reported, vendor_created_at, vendor_updated_at
  )
  select p_org, r.fleetpal_id, r.unit_fleetpal_id, r.name, r.description, r.priority, r.status,
         r.component, r.complaint, r.reason_for_repair, r.reason_closed, r.reported,
         r.vendor_created_at, r.vendor_updated_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           fleetpal_id text, unit_fleetpal_id text, name text, description text, priority text,
           status text, component text, complaint text, reason_for_repair text, reason_closed text,
           reported timestamptz, vendor_created_at timestamptz, vendor_updated_at timestamptz)
  on conflict (org_id, fleetpal_id) do update
    set unit_fleetpal_id = excluded.unit_fleetpal_id, name = excluded.name,
        description = excluded.description, priority = excluded.priority, status = excluded.status,
        component = excluded.component, complaint = excluded.complaint,
        reason_for_repair = excluded.reason_for_repair, reason_closed = excluded.reason_closed,
        reported = excluded.reported, vendor_created_at = excluded.vendor_created_at,
        vendor_updated_at = excluded.vendor_updated_at, updated_at = now();
  get diagnostics written = row_count;
  return written;
end;
$$;

create or replace function public.stage_fleetpal_expirations(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare written int;
begin
  insert into public.fleetpal_expirations as t (
    org_id, fleetpal_id, unit_fleetpal_id, name, description, expiration_date, threshold_value,
    threshold_type, alters_unit_status, target_status, is_completed, status
  )
  select p_org, r.fleetpal_id, r.unit_fleetpal_id, r.name, r.description, r.expiration_date,
         r.threshold_value, r.threshold_type, r.alters_unit_status, r.target_status,
         r.is_completed, r.status
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           fleetpal_id text, unit_fleetpal_id text, name text, description text,
           expiration_date timestamptz, threshold_value integer, threshold_type text,
           alters_unit_status boolean, target_status text, is_completed boolean, status text)
  on conflict (org_id, fleetpal_id) do update
    set unit_fleetpal_id = excluded.unit_fleetpal_id, name = excluded.name,
        description = excluded.description, expiration_date = excluded.expiration_date,
        threshold_value = excluded.threshold_value, threshold_type = excluded.threshold_type,
        alters_unit_status = excluded.alters_unit_status, target_status = excluded.target_status,
        is_completed = excluded.is_completed, status = excluded.status, updated_at = now();
  get diagnostics written = row_count;
  return written;
end;
$$;

-- Service role only — EXECUTE is granted to PUBLIC by default, so these revokes are the defence
-- that keeps a browser holding the anon key from writing a carrier's defect list through PostgREST.
revoke all on function public.stage_fleetpal_defects(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.stage_fleetpal_issues(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.stage_fleetpal_expirations(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.stage_fleetpal_defects(uuid, jsonb) to service_role;
grant execute on function public.stage_fleetpal_issues(uuid, jsonb) to service_role;
grant execute on function public.stage_fleetpal_expirations(uuid, jsonb) to service_role;

create trigger trg_fleetpal_defects_updated before update on fleetpal_defects
  for each row execute function set_updated_at();
create trigger trg_fleetpal_defects_org_immutable before update on fleetpal_defects
  for each row execute function forbid_org_change();
create trigger trg_fleetpal_issues_updated before update on fleetpal_issues
  for each row execute function set_updated_at();
create trigger trg_fleetpal_issues_org_immutable before update on fleetpal_issues
  for each row execute function forbid_org_change();
create trigger trg_fleetpal_expirations_updated before update on fleetpal_expirations
  for each row execute function set_updated_at();
create trigger trg_fleetpal_expirations_org_immutable before update on fleetpal_expirations
  for each row execute function forbid_org_change();
