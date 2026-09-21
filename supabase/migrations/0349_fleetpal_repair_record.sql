-- 0349: the repair record — what FleetPal knows about one truck's work, staged.
--
-- FLEETPAL-INTEGRATION-PLAN.md step F6 (D-FP1, D-FP2, D-FP8, D-FP9). 0334 built the ground: the
-- credential, the watermarks, the identity resolution and the webhook ledger. This is what stands on
-- it, and it is the reason the integration exists — `mcleod_gl_totals` is grained
-- org × company × period × post_module × glid with NO equipment dimension at all, so FleetPal is the
-- only source in this stack that can say what ONE TRUCK cost to repair.
--
-- Eight tables, all `layer=raw`, all deny-all: work orders, their jobs, their line items, the closed
-- repair as `service-history`, meter readings, PM schedules and their intervals, and the two
-- reference lists a repair points at (vendors, shops).
--
-- ── ⚠ NONE OF THIS MONEY IS FINANCIAL (D-FP3, D-FP4) ───────────────────────────────────────────
-- Nothing here projects into `financial_entries` and nothing here reaches the fleet report. The
-- 2026-09-03 ruling (D-FLEET2) made McLeod's general ledger the entire financial input and that
-- stands. What FleetPal knows is what the shop spent THROUGH FLEETPAL; what the ledger knows is what
-- the company spent on maintenance through every channel, and a roadside call invoiced straight to
-- AP never touches FleetPal. The two will disagree, the gap is not an error, and it is why no
-- surface may print a per-unit total without the coverage ratio beside it.
--
-- ── ⚠ THERE ARE NO FOREIGN KEYS BETWEEN THESE TABLES, AND THAT IS THE DESIGN ───────────────────
-- A job names its work order, a line item names its job, a meter names its unit — all as the
-- vendor's opaque ids, in `*_fleetpal_id` text columns, joined at READ on `(org_id, fleetpal_id)`.
-- Every one of those pairs is unique here, so a composite foreign key would be possible and would
-- even carry the org for free. It is still wrong: the sweep pages each resource SEPARATELY by
-- `updated_after` (§2.7), so a job whose parent work order did not change in this window arrives
-- with no parent staged. A foreign key turns that ordinary case into a failed sweep, and the
-- workaround — fetch every parent on demand — is a request per row against a rate limit we could not
-- even measure (F4: no limiter headers at all).
--
-- So an orphan is expected, temporarily, and the read side treats a missing parent as missing rather
-- than as an error. This is the standing posture of the raw layer (`mcleod_*` stages the same way);
-- what is new is writing down WHY, because the constraint looks free from here.
--
-- ── ⚠ VMRS CODES, NEVER DESCRIPTIONS (D-FP8) ───────────────────────────────────────────────────
-- `component`, `complaint`, `reason_for_repair` and `cause` arrive as an id that resolves to a code
-- and an English description. The code is a fact about a repair we performed and is ours to keep;
-- the English is licensed TMC material whose distribution tier is a recurring fee the owner declined
-- on 2026-09-10. No table below has a description column for any of them, and that absence is the
-- decision, not an omission.
--
-- ── ⚠ THERE IS NO `technician` COLUMN, THOUGH THE SERVER SENDS ONE ─────────────────────────────
-- F4 found `JobItem.technician` on the live account — a field the vendor's own OpenAPI document does
-- not declare. It is an opaque member id and **there is no `/v1/members` endpoint** to resolve it
-- against, so it can say that two repairs were done by the same person and never which person.
-- Staging it would mean adding a field to the contract that the spec-derived manifest does not have,
-- which `lint:fleetpal-contract` correctly refuses. When the vendor documents it, the column and the
-- contract field arrive together; until then the plan carries the finding (§2.10.2) and the database
-- does not carry a half-fact.
--
-- ── MONEY AND DISTANCE (D-FP9) ─────────────────────────────────────────────────────────────────
-- Money is `numeric` and never a float: the vendor sends JSON decimals (`125.5`, `1808.1`) and a
-- binary float is how a five-way cost split stops adding up to its own total. Distances are stored
-- exactly as received, in the vendor's canonical **metres**, and converted at read by the one
-- conversion site in `client.ts` — a column in miles would be a second unit in the database and the
-- first report to disagree with the shop would be unexplainable.

-- raw-access-waiver: every `fleetpal_*` table named below is a raw-layer table of THIS migration's
-- own module, created here, and the only things referencing them are the nine `stage_fleetpal_*`
-- functions this same file defines. The gate cannot read ownership out of a .sql file — there is no
-- module directory for one — so the waiver is how the authoring PR names the collector that
-- consented, which here is the collector being extended. Nothing outside `modules/fleetpal/` reads
-- them: the maintenance endpoints go through the module's index (F9), which is the edge declared in
-- `check-feature-boundaries.mjs` as `maintenance -> fleetpal`.
--
-- Rollback: drop the nine stage_fleetpal_* functions, then drop table fleetpal_pm_intervals,
-- fleetpal_pm_schedules, fleetpal_meters, fleetpal_service_history, fleetpal_job_items,
-- fleetpal_jobs, fleetpal_work_orders, fleetpal_shops, fleetpal_vendors.

-- ── the two reference lists ─────────────────────────────────────────────────────────────────────
--
-- Deliberately narrow. FleetPal holds a supplier's email, phone and street address; we hold their
-- name, their state and the vendor's own code, because a repair report says "Love's, Fort Stockton
-- TX" and never needs to write to them. Data we do not need is a disclosure we cannot have.

create table if not exists fleetpal_vendors (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  fleetpal_id       text not null check (length(btrim(fleetpal_id)) > 0),
  name              text,
  -- SERVICE for parts and repair work, FINANCIAL for lenders and lessors. Only the first kind can
  -- appear on a work order.
  vendor_type       text,
  -- ⚠ The vendor's own documentation offers this as "the match key when syncing from an accounting
  -- system" — i.e. straight to `mcleod_ap_vouchers.vendor_id`. Measured 2026-09-21: populated on
  -- **1 of 761**. It is stored because one is not none and a shop may fill the rest in; the coverage
  -- ratio must not be built on it (Q9).
  code              text,
  city              text,
  state             text,
  country           text,
  zip_code          text,
  payment_term_fleetpal_id text,
  payment_method    text,
  vendor_created_at timestamptz,
  vendor_updated_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint fleetpal_vendors_org_vendor_id_key unique (org_id, fleetpal_id)
);

comment on table fleetpal_vendors is
  'FleetPal suppliers, staged (F6). Name, state and code only — the contact details FleetPal holds are not ours to keep for a report that never writes to them.';

alter table fleetpal_vendors enable row level security;

create table if not exists fleetpal_shops (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  fleetpal_id       text not null check (length(btrim(fleetpal_id)) > 0),
  name              text,
  -- Prefixes the work-order and purchase-order numbers a human reads, which is why
  -- `reference_number` and not `number` is what a person is holding.
  code              text,
  city              text,
  state             text,
  country           text,
  zip_code          text,
  hourly_labor_rate numeric(12,2),
  vendor_created_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint fleetpal_shops_org_vendor_id_key unique (org_id, fleetpal_id)
);

comment on table fleetpal_shops is
  'Our own service locations as FleetPal holds them (F6). One row on the live account, 2026-09-21. No `updated` field exists at the vendor, so this is re-read in full rather than watermarked (§2.7).';

alter table fleetpal_shops enable row level security;

-- ── the work order and what was done on it ──────────────────────────────────────────────────────

create table if not exists fleetpal_work_orders (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id) on delete cascade,
  fleetpal_id          text not null check (length(btrim(fleetpal_id)) > 0),
  -- `number` is sequential and shop-blind; `reference_number` is what users see, prefix included,
  -- and is therefore what any surface prints and what `part_movements.work_order_ref` will hold.
  number               integer,
  reference_number     text,
  status               text,
  priority             text,
  repair_priority_class text,
  unit_fleetpal_id     text,
  shop_fleetpal_id     text,
  description          text,
  scheduled_start      timestamptz,
  expected_completion  timestamptz,
  started              timestamptz,
  -- Null until the work is done. 5,264 of 5,295 were completed on the live account, the earliest on
  -- 2025-01-01 — which is how far back a backfill is worth running (Q8).
  completed            timestamptz,
  cancellation_reason  text,
  vendor_created_at    timestamptz,
  vendor_updated_at    timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint fleetpal_work_orders_org_vendor_id_key unique (org_id, fleetpal_id)
);

comment on table fleetpal_work_orders is
  'FleetPal work orders, staged (F6). The in-flight repair; a CLOSED one is also in fleetpal_service_history with its cost split, which is the table a cost report reads.';

create index if not exists idx_fleetpal_work_orders_org_unit
  on fleetpal_work_orders (org_id, unit_fleetpal_id);
create index if not exists idx_fleetpal_work_orders_org_completed
  on fleetpal_work_orders (org_id, completed desc) where completed is not null;

alter table fleetpal_work_orders enable row level security;

create table if not exists fleetpal_jobs (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organizations(id) on delete cascade,
  fleetpal_id              text not null check (length(btrim(fleetpal_id)) > 0),
  work_order_fleetpal_id   text,
  name                     text,
  description              text,
  -- VMRS ids. Codes only — see the header.
  component                text,
  complaint                text,
  reason_for_repair        text,
  -- MANUAL | PM_SCHEDULE | DEFECT | ISSUE, with the matching id below naming the origin.
  source                   text,
  defect_fleetpal_id       text,
  issue_fleetpal_id        text,
  pm_schedule_fleetpal_id  text,
  billable                 boolean,
  items_count              integer,
  total                    numeric(14,2),
  vendor_created_at        timestamptz,
  vendor_updated_at        timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint fleetpal_jobs_org_vendor_id_key unique (org_id, fleetpal_id)
);

comment on table fleetpal_jobs is
  'One repair on a work order (F6). `source` plus the matching id is how a PM schedule or a defect connects to the money it caused.';

create index if not exists idx_fleetpal_jobs_org_work_order
  on fleetpal_jobs (org_id, work_order_fleetpal_id);

alter table fleetpal_jobs enable row level security;

create table if not exists fleetpal_job_items (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organizations(id) on delete cascade,
  fleetpal_id              text not null check (length(btrim(fleetpal_id)) > 0),
  job_fleetpal_id          text,
  -- PART | LABOR | SERVICE | FEE | TAX. A PART line is what F13 turns into an `issued` movement on
  -- our own shelf; everything else is cost only and never touches inventory.
  item_type                text,
  description              text,
  part_fleetpal_id         text,
  part_number              text,
  universal_product_code   text,
  manufacturer             text,
  manufacturer_part_number text,
  component                text,
  cause                    text,
  unit_of_measure          text,
  -- Fractional on purpose: a LABOR line is hours, and `hr` is one of the vendor's 22 units of
  -- measure. It must never gain an equivalent in our own 8 — a shelf would then hold a quantity of
  -- hours (see the `fleetpal-api-facts` note and F12's mapping).
  quantity                 numeric(14,3),
  price                    numeric(14,4),
  total                    numeric(14,2),
  vendor_created_at        timestamptz,
  vendor_updated_at        timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint fleetpal_job_items_org_vendor_id_key unique (org_id, fleetpal_id)
);

comment on table fleetpal_job_items is
  'What a repair consumed (F6): 35,121 rows on the live account, 2026-09-21. Consumption, never stock — FleetPal has no on-hand quantity anywhere in its model (D-INV10, D-FP11).';

create index if not exists idx_fleetpal_job_items_org_job
  on fleetpal_job_items (org_id, job_fleetpal_id);
create index if not exists idx_fleetpal_job_items_org_part
  on fleetpal_job_items (org_id, part_fleetpal_id) where part_fleetpal_id is not null;

alter table fleetpal_job_items enable row level security;

-- ── the closed repair, with its cost split — the table F9 reads ─────────────────────────────────
--
-- `/v1/service-history` is the whole point of the integration: per unit, per repair, the cost split
-- five ways, the labour hours, and the meter reading at the time. It is CLOSED work orders only,
-- which is why the three tables above exist as well — an in-flight repair is invisible here.

create table if not exists fleetpal_service_history (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organizations(id) on delete cascade,
  fleetpal_id              text not null check (length(btrim(fleetpal_id)) > 0),
  work_order_fleetpal_id   text,
  -- The human-facing work-order reference, denormalised by the vendor. Kept as sent so a row can
  -- name its paperwork without a join that may have no parent staged yet (see the header).
  work_order_reference     text,
  unit_fleetpal_id         text,
  shop_fleetpal_id         text,
  vendor_fleetpal_id       text,
  customer_fleetpal_id     text,
  name                     text,
  description              text,
  source                   text,
  component                text,
  complaint                text,
  reason_for_repair        text,
  defect_fleetpal_id       text,
  issue_fleetpal_id        text,
  pm_schedule_fleetpal_id  text,
  billable                 boolean,
  items_count              integer,

  -- ── the five-way split, plus its total ──
  -- The vendor sends all six; they are stored as sent and NOT recomputed. A total that disagrees
  -- with its parts is a fact about the vendor's data worth seeing, and a column derived here would
  -- hide it while looking tidier.
  total                    numeric(14,2),
  total_parts              numeric(14,2),
  total_labor              numeric(14,2),
  total_fees               numeric(14,2),
  total_tax                numeric(14,2),
  total_services           numeric(14,2),
  total_labor_hours        numeric(12,2),

  -- ── the meters at the time of the repair ──
  -- ⚠ CANONICAL METRES, as received. `odometer` reaches 663 million on this fleet, which is 412,000
  -- miles and exactly why this is `bigint` and the conversion lives at read.
  odometer                 bigint,
  hubometer                bigint,
  engine_hours             numeric(12,2),
  apu_hours                numeric(12,2),

  started                  timestamptz,
  completed                timestamptz,
  vendor_created_at        timestamptz,
  vendor_updated_at        timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint fleetpal_service_history_org_vendor_id_key unique (org_id, fleetpal_id)
);

comment on table fleetpal_service_history is
  'The closed repair with its five-way cost split and the meter at the time (F6) — the first per-truck repair cost this product has ever been able to print, and an OPERATIONAL number only (D-FP3).';
comment on column fleetpal_service_history.odometer is
  'Canonical METRES, as the vendor sends it. Converted at read by the single conversion site (D-FP9); a miles column here would be a second unit in the database.';

create index if not exists idx_fleetpal_service_history_org_unit_completed
  on fleetpal_service_history (org_id, unit_fleetpal_id, completed desc);
create index if not exists idx_fleetpal_service_history_org_completed
  on fleetpal_service_history (org_id, completed desc) where completed is not null;
create index if not exists idx_fleetpal_service_history_org_work_order
  on fleetpal_service_history (org_id, work_order_fleetpal_id) where work_order_fleetpal_id is not null;

alter table fleetpal_service_history enable row level security;

-- ── meters and PM schedules ─────────────────────────────────────────────────────────────────────

create table if not exists fleetpal_meters (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  fleetpal_id       text not null check (length(btrim(fleetpal_id)) > 0),
  unit_fleetpal_id  text,
  -- ODOMETER | ENGINE_HOURS | HUBOMETER | APU_HOURS. The unit of `value` depends on it: metres for
  -- the two distances, hours for the two clocks. One column for both because that is one reading in
  -- the vendor's model, and splitting it here would invent a shape nothing sends.
  meter_type        text,
  value             bigint,
  source            text,
  -- The vendor calls this `timestamp`; renamed because `timestamp` is a type name in Postgres and a
  -- quoted column is a trap that only shows up in the one query somebody writes by hand.
  measured_at       timestamptz,
  vendor_created_at timestamptz,
  vendor_updated_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint fleetpal_meters_org_vendor_id_key unique (org_id, fleetpal_id)
);

comment on table fleetpal_meters is
  'Meter readings as FleetPal holds them (F6): 135,631 rows on the live account, 2026-09-21. The push in the other direction — our Samsara odometer into FleetPal — is F14 and is flagged off by default.';

create index if not exists idx_fleetpal_meters_org_unit_measured
  on fleetpal_meters (org_id, unit_fleetpal_id, measured_at desc);

alter table fleetpal_meters enable row level security;

create table if not exists fleetpal_pm_schedules (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  fleetpal_id       text not null check (length(btrim(fleetpal_id)) > 0),
  unit_fleetpal_id  text,
  name              text,
  description       text,
  component         text,
  reason_for_repair text,
  auto_create_wo    boolean,
  last_done         timestamptz,
  vendor_created_at timestamptz,
  vendor_updated_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint fleetpal_pm_schedules_org_vendor_id_key unique (org_id, fleetpal_id)
);

comment on table fleetpal_pm_schedules is
  'Preventive-maintenance schedules (F6). F11 reads these against the latest meter to finally feed vehicles.next_pm_due_odometer / next_pm_due_at, dead since 0099.';

create index if not exists idx_fleetpal_pm_schedules_org_unit
  on fleetpal_pm_schedules (org_id, unit_fleetpal_id);

alter table fleetpal_pm_schedules enable row level security;

create table if not exists fleetpal_pm_intervals (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organizations(id) on delete cascade,
  fleetpal_id              text not null check (length(btrim(fleetpal_id)) > 0),
  pm_schedule_fleetpal_id  text,
  interval_type            text,
  -- The vendor's own field is `order`, which is a reserved word here for the same reason
  -- `timestamp` was above.
  order_index              integer,
  -- Metres or a count of time units, depending on `interval_type` / `value_time_type` — the same
  -- canonical-units rule as everywhere else.
  value_int                bigint,
  value_time_type          text,
  threshold_int            bigint,
  threshold_time_type      text,
  last_done_meter_value    bigint,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint fleetpal_pm_intervals_org_vendor_id_key unique (org_id, fleetpal_id)
);

comment on table fleetpal_pm_intervals is
  'The intervals behind a PM schedule (F6) — distance, time, or both, with the threshold that makes one due-soon.';

create index if not exists idx_fleetpal_pm_intervals_org_schedule
  on fleetpal_pm_intervals (org_id, pm_schedule_fleetpal_id);

alter table fleetpal_pm_intervals enable row level security;

-- ── the ingest, set-based ───────────────────────────────────────────────────────────────────────
--
-- One function per resource, each taking the page the client just walked as a jsonb array and
-- writing it in one statement. Three properties matter and all three are the reason this is SQL
-- rather than a loop in TypeScript:
--
--   1. **IDEMPOTENT ON `(org_id, fleetpal_id)`.** A re-run of the same window writes the same rows
--      and changes nothing else, so a retried sweep is free rather than a duplicate history.
--   2. **NEVER A PARTIAL UPSERT** (`lint:upserts`, migrations 0174/0175). Every column the vendor
--      sends is in both the INSERT and the DO UPDATE, so Postgres never evaluates a NOT NULL against
--      a half-built tuple — the failure that took the idling and HOS syncs down on 2026-08-10.
--   3. **THE TENANT COMES FROM THE PARAMETER, NEVER FROM THE PAYLOAD.** `p_org` is written into
--      every row and the payload's own idea of an org, if it ever grew one, is ignored.
--
-- `security definer` with an empty search_path, and EXECUTE revoked from everyone but the service
-- role: these take a tenant id and act on it, which is the convention 0095, 0149, 0174 and 0175 set.

create or replace function public.stage_fleetpal_vendors(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare written int;
begin
  insert into public.fleetpal_vendors as t (
    org_id, fleetpal_id, name, vendor_type, code, city, state, country, zip_code,
    payment_term_fleetpal_id, payment_method, vendor_created_at, vendor_updated_at
  )
  select p_org, r.fleetpal_id, r.name, r.vendor_type, r.code, r.city, r.state, r.country, r.zip_code,
         r.payment_term_fleetpal_id, r.payment_method, r.vendor_created_at, r.vendor_updated_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           fleetpal_id text, name text, vendor_type text, code text, city text, state text,
           country text, zip_code text, payment_term_fleetpal_id text, payment_method text,
           vendor_created_at timestamptz, vendor_updated_at timestamptz)
  on conflict (org_id, fleetpal_id) do update
    set name = excluded.name, vendor_type = excluded.vendor_type, code = excluded.code,
        city = excluded.city, state = excluded.state, country = excluded.country,
        zip_code = excluded.zip_code, payment_term_fleetpal_id = excluded.payment_term_fleetpal_id,
        payment_method = excluded.payment_method, vendor_created_at = excluded.vendor_created_at,
        vendor_updated_at = excluded.vendor_updated_at, updated_at = now();
  get diagnostics written = row_count;
  return written;
end;
$$;

create or replace function public.stage_fleetpal_shops(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare written int;
begin
  insert into public.fleetpal_shops as t (
    org_id, fleetpal_id, name, code, city, state, country, zip_code, hourly_labor_rate,
    vendor_created_at
  )
  select p_org, r.fleetpal_id, r.name, r.code, r.city, r.state, r.country, r.zip_code,
         r.hourly_labor_rate, r.vendor_created_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           fleetpal_id text, name text, code text, city text, state text, country text,
           zip_code text, hourly_labor_rate numeric(12,2), vendor_created_at timestamptz)
  on conflict (org_id, fleetpal_id) do update
    set name = excluded.name, code = excluded.code, city = excluded.city, state = excluded.state,
        country = excluded.country, zip_code = excluded.zip_code,
        hourly_labor_rate = excluded.hourly_labor_rate,
        vendor_created_at = excluded.vendor_created_at, updated_at = now();
  get diagnostics written = row_count;
  return written;
end;
$$;

create or replace function public.stage_fleetpal_work_orders(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare written int;
begin
  insert into public.fleetpal_work_orders as t (
    org_id, fleetpal_id, number, reference_number, status, priority, repair_priority_class,
    unit_fleetpal_id, shop_fleetpal_id, description, scheduled_start, expected_completion,
    started, completed, cancellation_reason, vendor_created_at, vendor_updated_at
  )
  select p_org, r.fleetpal_id, r.number, r.reference_number, r.status, r.priority,
         r.repair_priority_class, r.unit_fleetpal_id, r.shop_fleetpal_id, r.description,
         r.scheduled_start, r.expected_completion, r.started, r.completed, r.cancellation_reason,
         r.vendor_created_at, r.vendor_updated_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           fleetpal_id text, number integer, reference_number text, status text, priority text,
           repair_priority_class text, unit_fleetpal_id text, shop_fleetpal_id text,
           description text, scheduled_start timestamptz, expected_completion timestamptz,
           started timestamptz, completed timestamptz, cancellation_reason text,
           vendor_created_at timestamptz, vendor_updated_at timestamptz)
  on conflict (org_id, fleetpal_id) do update
    set number = excluded.number, reference_number = excluded.reference_number,
        status = excluded.status, priority = excluded.priority,
        repair_priority_class = excluded.repair_priority_class,
        unit_fleetpal_id = excluded.unit_fleetpal_id, shop_fleetpal_id = excluded.shop_fleetpal_id,
        description = excluded.description, scheduled_start = excluded.scheduled_start,
        expected_completion = excluded.expected_completion, started = excluded.started,
        completed = excluded.completed, cancellation_reason = excluded.cancellation_reason,
        vendor_created_at = excluded.vendor_created_at,
        vendor_updated_at = excluded.vendor_updated_at, updated_at = now();
  get diagnostics written = row_count;
  return written;
end;
$$;

create or replace function public.stage_fleetpal_jobs(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare written int;
begin
  insert into public.fleetpal_jobs as t (
    org_id, fleetpal_id, work_order_fleetpal_id, name, description, component, complaint,
    reason_for_repair, source, defect_fleetpal_id, issue_fleetpal_id, pm_schedule_fleetpal_id,
    billable, items_count, total, vendor_created_at, vendor_updated_at
  )
  select p_org, r.fleetpal_id, r.work_order_fleetpal_id, r.name, r.description, r.component,
         r.complaint, r.reason_for_repair, r.source, r.defect_fleetpal_id, r.issue_fleetpal_id,
         r.pm_schedule_fleetpal_id, r.billable, r.items_count, r.total, r.vendor_created_at,
         r.vendor_updated_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           fleetpal_id text, work_order_fleetpal_id text, name text, description text,
           component text, complaint text, reason_for_repair text, source text,
           defect_fleetpal_id text, issue_fleetpal_id text, pm_schedule_fleetpal_id text,
           billable boolean, items_count integer, total numeric(14,2),
           vendor_created_at timestamptz, vendor_updated_at timestamptz)
  on conflict (org_id, fleetpal_id) do update
    set work_order_fleetpal_id = excluded.work_order_fleetpal_id, name = excluded.name,
        description = excluded.description, component = excluded.component,
        complaint = excluded.complaint, reason_for_repair = excluded.reason_for_repair,
        source = excluded.source, defect_fleetpal_id = excluded.defect_fleetpal_id,
        issue_fleetpal_id = excluded.issue_fleetpal_id,
        pm_schedule_fleetpal_id = excluded.pm_schedule_fleetpal_id, billable = excluded.billable,
        items_count = excluded.items_count, total = excluded.total,
        vendor_created_at = excluded.vendor_created_at,
        vendor_updated_at = excluded.vendor_updated_at, updated_at = now();
  get diagnostics written = row_count;
  return written;
end;
$$;

create or replace function public.stage_fleetpal_job_items(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare written int;
begin
  insert into public.fleetpal_job_items as t (
    org_id, fleetpal_id, job_fleetpal_id, item_type, description, part_fleetpal_id, part_number,
    universal_product_code, manufacturer, manufacturer_part_number, component, cause,
    unit_of_measure, quantity, price, total, vendor_created_at, vendor_updated_at
  )
  select p_org, r.fleetpal_id, r.job_fleetpal_id, r.item_type, r.description, r.part_fleetpal_id,
         r.part_number, r.universal_product_code, r.manufacturer, r.manufacturer_part_number,
         r.component, r.cause, r.unit_of_measure, r.quantity, r.price, r.total,
         r.vendor_created_at, r.vendor_updated_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           fleetpal_id text, job_fleetpal_id text, item_type text, description text,
           part_fleetpal_id text, part_number text, universal_product_code text,
           manufacturer text, manufacturer_part_number text, component text, cause text,
           unit_of_measure text, quantity numeric(14,3), price numeric(14,4), total numeric(14,2),
           vendor_created_at timestamptz, vendor_updated_at timestamptz)
  on conflict (org_id, fleetpal_id) do update
    set job_fleetpal_id = excluded.job_fleetpal_id, item_type = excluded.item_type,
        description = excluded.description, part_fleetpal_id = excluded.part_fleetpal_id,
        part_number = excluded.part_number,
        universal_product_code = excluded.universal_product_code,
        manufacturer = excluded.manufacturer,
        manufacturer_part_number = excluded.manufacturer_part_number,
        component = excluded.component, cause = excluded.cause,
        unit_of_measure = excluded.unit_of_measure, quantity = excluded.quantity,
        price = excluded.price, total = excluded.total,
        vendor_created_at = excluded.vendor_created_at,
        vendor_updated_at = excluded.vendor_updated_at, updated_at = now();
  get diagnostics written = row_count;
  return written;
end;
$$;

create or replace function public.stage_fleetpal_service_history(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare written int;
begin
  insert into public.fleetpal_service_history as t (
    org_id, fleetpal_id, work_order_fleetpal_id, work_order_reference, unit_fleetpal_id,
    shop_fleetpal_id, vendor_fleetpal_id, customer_fleetpal_id, name, description, source,
    component, complaint, reason_for_repair, defect_fleetpal_id, issue_fleetpal_id,
    pm_schedule_fleetpal_id, billable, items_count, total, total_parts, total_labor, total_fees,
    total_tax, total_services, total_labor_hours, odometer, hubometer, engine_hours, apu_hours,
    started, completed, vendor_created_at, vendor_updated_at
  )
  select p_org, r.fleetpal_id, r.work_order_fleetpal_id, r.work_order_reference, r.unit_fleetpal_id,
         r.shop_fleetpal_id, r.vendor_fleetpal_id, r.customer_fleetpal_id, r.name, r.description,
         r.source, r.component, r.complaint, r.reason_for_repair, r.defect_fleetpal_id,
         r.issue_fleetpal_id, r.pm_schedule_fleetpal_id, r.billable, r.items_count, r.total,
         r.total_parts, r.total_labor, r.total_fees, r.total_tax, r.total_services,
         r.total_labor_hours, r.odometer, r.hubometer, r.engine_hours, r.apu_hours, r.started,
         r.completed, r.vendor_created_at, r.vendor_updated_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           fleetpal_id text, work_order_fleetpal_id text, work_order_reference text,
           unit_fleetpal_id text, shop_fleetpal_id text, vendor_fleetpal_id text,
           customer_fleetpal_id text, name text, description text, source text, component text,
           complaint text, reason_for_repair text, defect_fleetpal_id text, issue_fleetpal_id text,
           pm_schedule_fleetpal_id text, billable boolean, items_count integer,
           total numeric(14,2), total_parts numeric(14,2), total_labor numeric(14,2),
           total_fees numeric(14,2), total_tax numeric(14,2), total_services numeric(14,2),
           total_labor_hours numeric(12,2), odometer bigint, hubometer bigint,
           engine_hours numeric(12,2), apu_hours numeric(12,2), started timestamptz,
           completed timestamptz, vendor_created_at timestamptz, vendor_updated_at timestamptz)
  on conflict (org_id, fleetpal_id) do update
    set work_order_fleetpal_id = excluded.work_order_fleetpal_id,
        work_order_reference = excluded.work_order_reference,
        unit_fleetpal_id = excluded.unit_fleetpal_id, shop_fleetpal_id = excluded.shop_fleetpal_id,
        vendor_fleetpal_id = excluded.vendor_fleetpal_id,
        customer_fleetpal_id = excluded.customer_fleetpal_id, name = excluded.name,
        description = excluded.description, source = excluded.source, component = excluded.component,
        complaint = excluded.complaint, reason_for_repair = excluded.reason_for_repair,
        defect_fleetpal_id = excluded.defect_fleetpal_id,
        issue_fleetpal_id = excluded.issue_fleetpal_id,
        pm_schedule_fleetpal_id = excluded.pm_schedule_fleetpal_id, billable = excluded.billable,
        items_count = excluded.items_count, total = excluded.total,
        total_parts = excluded.total_parts, total_labor = excluded.total_labor,
        total_fees = excluded.total_fees, total_tax = excluded.total_tax,
        total_services = excluded.total_services, total_labor_hours = excluded.total_labor_hours,
        odometer = excluded.odometer, hubometer = excluded.hubometer,
        engine_hours = excluded.engine_hours, apu_hours = excluded.apu_hours,
        started = excluded.started, completed = excluded.completed,
        vendor_created_at = excluded.vendor_created_at,
        vendor_updated_at = excluded.vendor_updated_at, updated_at = now();
  get diagnostics written = row_count;
  return written;
end;
$$;

create or replace function public.stage_fleetpal_meters(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare written int;
begin
  insert into public.fleetpal_meters as t (
    org_id, fleetpal_id, unit_fleetpal_id, meter_type, value, source, measured_at,
    vendor_created_at, vendor_updated_at
  )
  select p_org, r.fleetpal_id, r.unit_fleetpal_id, r.meter_type, r.value, r.source, r.measured_at,
         r.vendor_created_at, r.vendor_updated_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           fleetpal_id text, unit_fleetpal_id text, meter_type text, value bigint, source text,
           measured_at timestamptz, vendor_created_at timestamptz, vendor_updated_at timestamptz)
  on conflict (org_id, fleetpal_id) do update
    set unit_fleetpal_id = excluded.unit_fleetpal_id, meter_type = excluded.meter_type,
        value = excluded.value, source = excluded.source, measured_at = excluded.measured_at,
        vendor_created_at = excluded.vendor_created_at,
        vendor_updated_at = excluded.vendor_updated_at, updated_at = now();
  get diagnostics written = row_count;
  return written;
end;
$$;

create or replace function public.stage_fleetpal_pm_schedules(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare written int;
begin
  insert into public.fleetpal_pm_schedules as t (
    org_id, fleetpal_id, unit_fleetpal_id, name, description, component, reason_for_repair,
    auto_create_wo, last_done, vendor_created_at, vendor_updated_at
  )
  select p_org, r.fleetpal_id, r.unit_fleetpal_id, r.name, r.description, r.component,
         r.reason_for_repair, r.auto_create_wo, r.last_done, r.vendor_created_at,
         r.vendor_updated_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           fleetpal_id text, unit_fleetpal_id text, name text, description text, component text,
           reason_for_repair text, auto_create_wo boolean, last_done timestamptz,
           vendor_created_at timestamptz, vendor_updated_at timestamptz)
  on conflict (org_id, fleetpal_id) do update
    set unit_fleetpal_id = excluded.unit_fleetpal_id, name = excluded.name,
        description = excluded.description, component = excluded.component,
        reason_for_repair = excluded.reason_for_repair, auto_create_wo = excluded.auto_create_wo,
        last_done = excluded.last_done, vendor_created_at = excluded.vendor_created_at,
        vendor_updated_at = excluded.vendor_updated_at, updated_at = now();
  get diagnostics written = row_count;
  return written;
end;
$$;

create or replace function public.stage_fleetpal_pm_intervals(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare written int;
begin
  insert into public.fleetpal_pm_intervals as t (
    org_id, fleetpal_id, pm_schedule_fleetpal_id, interval_type, order_index, value_int,
    value_time_type, threshold_int, threshold_time_type, last_done_meter_value
  )
  select p_org, r.fleetpal_id, r.pm_schedule_fleetpal_id, r.interval_type, r.order_index,
         r.value_int, r.value_time_type, r.threshold_int, r.threshold_time_type,
         r.last_done_meter_value
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           fleetpal_id text, pm_schedule_fleetpal_id text, interval_type text, order_index integer,
           value_int bigint, value_time_type text, threshold_int bigint, threshold_time_type text,
           last_done_meter_value bigint)
  on conflict (org_id, fleetpal_id) do update
    set pm_schedule_fleetpal_id = excluded.pm_schedule_fleetpal_id,
        interval_type = excluded.interval_type, order_index = excluded.order_index,
        value_int = excluded.value_int, value_time_type = excluded.value_time_type,
        threshold_int = excluded.threshold_int, threshold_time_type = excluded.threshold_time_type,
        last_done_meter_value = excluded.last_done_meter_value, updated_at = now();
  get diagnostics written = row_count;
  return written;
end;
$$;

-- Service role only. Postgres grants EXECUTE to PUBLIC by default on CREATE FUNCTION, so every
-- revoke below is load-bearing: without it a browser holding the anon key could write a carrier's
-- repair history through PostgREST, past the deny-all RLS these tables carry.
revoke all on function public.stage_fleetpal_vendors(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.stage_fleetpal_shops(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.stage_fleetpal_work_orders(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.stage_fleetpal_jobs(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.stage_fleetpal_job_items(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.stage_fleetpal_service_history(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.stage_fleetpal_meters(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.stage_fleetpal_pm_schedules(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.stage_fleetpal_pm_intervals(uuid, jsonb) from public, anon, authenticated;

grant execute on function public.stage_fleetpal_vendors(uuid, jsonb) to service_role;
grant execute on function public.stage_fleetpal_shops(uuid, jsonb) to service_role;
grant execute on function public.stage_fleetpal_work_orders(uuid, jsonb) to service_role;
grant execute on function public.stage_fleetpal_jobs(uuid, jsonb) to service_role;
grant execute on function public.stage_fleetpal_job_items(uuid, jsonb) to service_role;
grant execute on function public.stage_fleetpal_service_history(uuid, jsonb) to service_role;
grant execute on function public.stage_fleetpal_meters(uuid, jsonb) to service_role;
grant execute on function public.stage_fleetpal_pm_schedules(uuid, jsonb) to service_role;
grant execute on function public.stage_fleetpal_pm_intervals(uuid, jsonb) to service_role;

-- The `updated_at` touch and the org-immutability guard, the same pair every table in 0334 carries.
create trigger trg_fleetpal_vendors_updated before update on fleetpal_vendors
  for each row execute function set_updated_at();
create trigger trg_fleetpal_vendors_org_immutable before update on fleetpal_vendors
  for each row execute function forbid_org_change();
create trigger trg_fleetpal_shops_updated before update on fleetpal_shops
  for each row execute function set_updated_at();
create trigger trg_fleetpal_shops_org_immutable before update on fleetpal_shops
  for each row execute function forbid_org_change();
create trigger trg_fleetpal_work_orders_updated before update on fleetpal_work_orders
  for each row execute function set_updated_at();
create trigger trg_fleetpal_work_orders_org_immutable before update on fleetpal_work_orders
  for each row execute function forbid_org_change();
create trigger trg_fleetpal_jobs_updated before update on fleetpal_jobs
  for each row execute function set_updated_at();
create trigger trg_fleetpal_jobs_org_immutable before update on fleetpal_jobs
  for each row execute function forbid_org_change();
create trigger trg_fleetpal_job_items_updated before update on fleetpal_job_items
  for each row execute function set_updated_at();
create trigger trg_fleetpal_job_items_org_immutable before update on fleetpal_job_items
  for each row execute function forbid_org_change();
create trigger trg_fleetpal_service_history_updated before update on fleetpal_service_history
  for each row execute function set_updated_at();
create trigger trg_fleetpal_service_history_org_immutable before update on fleetpal_service_history
  for each row execute function forbid_org_change();
create trigger trg_fleetpal_meters_updated before update on fleetpal_meters
  for each row execute function set_updated_at();
create trigger trg_fleetpal_meters_org_immutable before update on fleetpal_meters
  for each row execute function forbid_org_change();
create trigger trg_fleetpal_pm_schedules_updated before update on fleetpal_pm_schedules
  for each row execute function set_updated_at();
create trigger trg_fleetpal_pm_schedules_org_immutable before update on fleetpal_pm_schedules
  for each row execute function forbid_org_change();
create trigger trg_fleetpal_pm_intervals_updated before update on fleetpal_pm_intervals
  for each row execute function set_updated_at();
create trigger trg_fleetpal_pm_intervals_org_immutable before update on fleetpal_pm_intervals
  for each row execute function forbid_org_change();
