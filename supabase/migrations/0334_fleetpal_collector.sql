-- 0334: the FleetPal collector's first four tables — the credential, the watermarks, the identity
-- resolution, and the webhook idempotency ledger.
--
-- FLEETPAL-INTEGRATION-PLAN.md step F2 (D-FP1, D-FP2, D-FP7, D-FP10). FleetPal is the only source in
-- this stack that knows what ONE TRUCK cost to repair: `mcleod_gl_totals` is grained
-- org × company × period × post_module × glid and carries no equipment dimension at all, and
-- `mcleod_ap_vouchers` names the truck in free text D-FS5 forbids parsing. F6 stages that repair
-- record; this migration is the ground it stands on.
--
-- ── THE COLLECTOR WRITES NO TABLE IT DOES NOT OWN (D-FP2) ───────────────────────────────────────
-- Every table here is new and prefixed `fleetpal_`. There is deliberately NO column added to
-- `vehicles` or `trailers`, and none to `parts`, `part_stock` or `part_movements`. Where the
-- collector must affect a core row it calls the owning module's exported function — `recordMovement`
-- and `createPart` in `modules/maintenance/inventory` — which is the door D-ARC3 provides and
-- `lint:table-access` permits. A `fleetpal` module writing those tables directly would be a new
-- write site `lint:table-writers` refuses, and that refusal is what keeps D-INV10's split ("the
-- shelf is ours, the repair job is FleetPal's") from eroding one convenient exception at a time.
--
-- ── ...WHICH IS WHY IDENTITY RESOLVES IN OUR OWN TABLE (D-FP7) ─────────────────────────────────
-- `fleetpal_units` carries `vehicle_id` / `trailer_id` rather than `vehicles` carrying a
-- `fleetpal_unit_id`. Two reasons and they point the same way. Roster ownership stays intact — the
-- roster module remains the only writer of its own tables. And an UNMATCHED unit becomes a visible
-- ROW rather than a missing join: 200 of 207 active tractors and 228 of 234 active trailers carry a
-- VIN (measured 2026-09-10), so thirteen active units resolve by number or not at all, and thirteen
-- rows somebody can see is an afternoon's reconciliation while thirteen silent non-joins is a cost
-- report quietly missing trucks.
--
-- ── ⚠ A FOREIGN KEY DOES NOT CARRY THE ORG (IV012) ─────────────────────────────────────────────
-- The lesson 0332's matrix taught and 0333 wrote down, arriving here for the fourth time: neither
-- `vehicles` nor `trailers` has an `(id, org_id)` unique constraint to point a composite key at, so
-- `vehicle_id uuid references vehicles(id)` is satisfied by ANOTHER ORG'S TRUCK. A cross-tenant row
-- would satisfy every constraint above it and attribute one carrier's repair cost to another
-- carrier's truck.
--
-- So the guard is `inventory_holder_is_ours` — 0333's function, CALLED and not copied. It already
-- asks exactly this question ("does the named truck or trailer belong to this org"), it is
-- `security definer` with an empty search_path so the answer is the same for a browser session and
-- for the service role that bypasses RLS, and a second spelling of it here is the copy that goes
-- stale. Its name says `inventory` because that is where it was first needed; the question it
-- answers is about equipment ownership and belongs to no one module. Deriving beats restating.
--
-- ── ...AND A BEFORE TRIGGER RUNS AHEAD OF THE CHECK CONSTRAINTS ────────────────────────────────
-- 0333's second lesson, honoured the same way: the CHECK owns "at most one of vehicle_id and
-- trailer_id", and the trigger only ever answers "does the named thing belong to us". A guard that
-- tried to do both would run before the CHECKs, answer about a null, and report the wrong fault.
--
-- ── WHY THE WATERMARKS ARE A TABLE AND NOT A COLUMN ON THE CREDENTIAL ──────────────────────────
-- FleetPal's resources sync in three different ways, and the shape of `fleetpal_sync_state` is that
-- fact made durable. Most carry `updated` and expose an EXCLUSIVE `updated_after` filter, so a
-- stored high-water mark resumes without re-delivering its own row. But `defects`, `expirations`,
-- `shops` and the purchase-order receipts have NO `updated` column at all — the vendor's own
-- documentation says so — and can only be re-read in bounded windows. One row per (org, resource)
-- lets a watermarked resource and a windowed one sit side by side and say which it is, instead of a
-- credential growing a column per feed the way `efs_soap_credentials` had to.
--
-- ── THE WEBHOOK LEDGER IS THE IDEMPOTENCY KEY, NOT A LOG ───────────────────────────────────────
-- Delivery is at-least-once and out of order. `X-Fleetpal-Delivery` is stable across retries, which
-- makes it the dedup key; `X-Fleetpal-Event-Timestamp` is when the business event happened and is
-- likewise fixed across retries, which makes it the ORDERING key. `X-Fleetpal-Timestamp` — this
-- attempt's signing time — is neither, and ordering by it would make a retried old event look newer
-- than one that succeeded first time. Both are stored so the ordering rule is enforceable rather
-- than remembered (D-FP10).
--
-- ── RETENTION ──────────────────────────────────────────────────────────────────────────────────
-- None of these four is evidence. The credential and the watermarks are operational state (a lost
-- watermark costs one wide re-read and no fact), and the delivery ledger is prunable once its
-- retention window passes. None goes in `RETENTION_FORBIDDEN`; that list is for the append-only
-- evidence tables, and putting an advanceable watermark in it would stop the collector dead.
--
-- raw-access-waiver: fleetpal_units is a raw-layer table of THIS migration's own module, and the
-- only thing referencing it here is its own guard trigger. The gate cannot tell ownership from SQL
-- — there is no module directory for a .sql file — so the waiver is how the authoring PR names the
-- collector that consented, which in this case is the collector being created. No reader outside
-- modules/fleetpal/ touches it.
--
-- Rollback: drop table fleetpal_webhook_deliveries, fleetpal_units, fleetpal_sync_state,
--           fleetpal_credentials.

-- ── the credential ──────────────────────────────────────────────────────────────────────────────
-- Per-org, on the 0091/0116/0012 precedent: one dedicated table per outbound integration, service
-- role only, no client policies.
--
-- ⚠ The key is SEALED, not stored. `api_key_sealed` holds a `secretBox` envelope
-- (`v1.<key-id>.<iv>.<tag>.<ciphertext>`, AES-256-GCM) whose AAD binds it to this org and this
-- purpose — so lifting the ciphertext into another org's row fails authentication rather than
-- decrypting. That is a step up from `efs_soap_credentials.soap_password` and
-- `integration_credentials.samsara_api_token`, which are plaintext behind "service role only", and
-- it is cheap here because nothing legacy has to be migrated. A FleetPal key carries its issuing
-- user's role and company and is shown exactly once by the vendor.
create table if not exists fleetpal_credentials (
  org_id           uuid primary key references organizations(id) on delete cascade,
  api_key_sealed   text,
  -- Parameterised rather than constant so a sandbox or a proxy can be pointed at without a
  -- migration. The vendor documents exactly one host today.
  base_url         text not null default 'https://openapi.fleetpal.io'
                     check (length(btrim(base_url)) > 0),
  enabled          boolean not null default false,
  last_synced_at   timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table fleetpal_credentials is
  'Per-org FleetPal API key, sealed with secretBox (org+purpose AAD). Service-role only, no client policies.';
comment on column fleetpal_credentials.api_key_sealed is
  'secretBox envelope, never a bare key. Null until configured; the collector refuses to run without it rather than falling back to anything.';

create trigger trg_fleetpal_credentials_updated
  before update on fleetpal_credentials
  for each row execute function set_updated_at();

create trigger trg_fleetpal_credentials_org_immutable
  before update on fleetpal_credentials
  for each row execute function forbid_org_change();

alter table fleetpal_credentials enable row level security;
-- No client policies → deny-all → the API is the only reader and writer of a credential.

-- ── the watermarks ──────────────────────────────────────────────────────────────────────────────
create table if not exists fleetpal_sync_state (
  org_id       uuid not null references organizations(id) on delete cascade,
  -- The vendor's collection name as it appears in the path: 'units', 'work-orders',
  -- 'service-history', 'defects'. Free text rather than an enum because F6, F7 and F12 each add
  -- resources and an enum would make every one of them a migration.
  resource     text not null check (length(btrim(resource)) > 0),
  -- The highest `updated` seen. NULL means "never run" and is what makes the first sweep a full
  -- walk. Null on a resource with no `updated` column, permanently — see `window_end` below.
  watermark    timestamptz,
  -- For the bounded-re-read tier: how far the last windowed pass reached. `defects` has
  -- `detected_after` and `purchase-order-receipts` has `created_after`; neither is an `updated`
  -- watermark and conflating the two would make a resumed sweep skip everything that changed
  -- without being re-created.
  window_end   timestamptz,
  last_run_at  timestamptz,
  last_error   text,
  rows_seen    integer not null default 0 check (rows_seen >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (org_id, resource)
);

comment on table fleetpal_sync_state is
  'One row per (org, FleetPal collection): the updated_after high-water mark, or the window end for the resources the vendor gives no updated column. Operational, advanceable, deliberately not evidence.';

create trigger trg_fleetpal_sync_state_updated
  before update on fleetpal_sync_state
  for each row execute function set_updated_at();

alter table fleetpal_sync_state enable row level security;
-- Deny-all. A browser that could rewind a watermark could skip a window of the carrier's repair
-- history on purpose; one that could read it learns nothing an operator wants, since freshness is a
-- server-computed figure rather than an opaque vendor timestamp.

-- ── identity ────────────────────────────────────────────────────────────────────────────────────
create table if not exists fleetpal_units (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  fleetpal_id   text not null check (length(btrim(fleetpal_id)) > 0),
  -- The vendor's own fields, kept as sent. `number` is the fleet number, `vin` is check-digit
  -- validated and uppercased by them.
  number        text,
  vin           text,
  name          text,
  ownership     text,
  model         text,
  model_year    integer,
  -- ⚠ A VMRS CODE AND NEVER ITS DESCRIPTION (D-FP8). The code is a fact about equipment we operate
  -- and is ours to keep; the English is licensed TMC material whose distribution tier is a
  -- recurring fee the owner declined on 2026-09-10. Descriptions are fetched at display time and
  -- dropped. No table in this collector has a VMRS description column, and that is the design.
  vmrs_equipment_category text,
  -- Null while the unit is active. Archived units stay readable and reject new activity, so an
  -- archived unit with historic work orders is normal and must not be dropped from a cost report
  -- about the months it was running.
  archived_at   timestamptz,
  vendor_updated_at timestamptz,

  -- ── the resolution ──
  --
  -- ⚠ `on delete CASCADE`, and `set null` is the WRONG answer here — measured, not reasoned.
  -- `set null` performs an UPDATE as the FK action, that update is evaluated against
  -- `fleetpal_units_match_agrees` below, and the resulting row (`match_method='vin'` with no
  -- match attached) violates it. So the DELETE fails with 23514 and **a vehicle becomes
  -- undeletable the moment a FleetPal unit resolves to it** — a collector reaching back to
  -- constrain a core module, which is the exact inversion D-FP2 exists to prevent. It is the same
  -- class as the `merge_driver` cascade trap, arriving through a check constraint rather than a
  -- missing branch, and no gate would have caught it.
  --
  -- Cascade is also the right behaviour on its own terms. A vehicle with any history cannot be
  -- deleted at all (`fuel_transactions` and `financial_entries` are ON DELETE RESTRICT), so a
  -- deletable one is a row created in error — and the FleetPal unit still exists at the vendor, so
  -- the next sweep re-stages it as `unmatched` and it reappears in F5's worklist for a person to
  -- resolve. Self-healing, and it loses nothing that was true.
  vehicle_id    uuid references vehicles(id) on delete cascade,
  trailer_id    uuid references trailers(id) on delete cascade,
  match_method  text not null default 'unmatched'
                  check (match_method in ('vin', 'number', 'manual', 'unmatched')),
  matched_at    timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One FleetPal unit is one row. A second is not a duplicate, it is two answers to "which truck is
  -- this", and whichever a reader picks decides whose repair cost is whose.
  constraint fleetpal_units_org_vendor_id_key unique (org_id, fleetpal_id),

  -- A unit is a truck or a trailer, never both. The CHECK owns this; the trigger below owns only
  -- "does the named thing belong to us" — 0333's ordering lesson.
  constraint fleetpal_units_one_side check (num_nonnulls(vehicle_id, trailer_id) <= 1),

  -- A match method and a match must agree in both directions. `unmatched` with a vehicle attached is
  -- a row that says one thing and means another; a method naming a match with nothing attached is a
  -- resolution that silently did not happen.
  constraint fleetpal_units_match_agrees check (
    (match_method = 'unmatched' and num_nonnulls(vehicle_id, trailer_id) = 0 and matched_at is null)
    or (match_method <> 'unmatched' and num_nonnulls(vehicle_id, trailer_id) = 1 and matched_at is not null)
  )
);

comment on table fleetpal_units is
  'FleetPal units, and how each resolves to one of our vehicles or trailers (D-FP7). The mapping lives here rather than as a column on the roster so that roster ownership is untouched and an unmatched unit is a visible row rather than a missing join.';
comment on column fleetpal_units.match_method is
  'vin (primary, 96-97% of the active fleet carries one) · number (the fallback) · manual (a person linked it) · unmatched (and it stays visible as such — D-FP14).';

create index if not exists idx_fleetpal_units_org_vehicle
  on fleetpal_units (org_id, vehicle_id) where vehicle_id is not null;
create index if not exists idx_fleetpal_units_org_trailer
  on fleetpal_units (org_id, trailer_id) where trailer_id is not null;
-- The unmatched worklist, which F5's screen reads and D-FP14 requires every read model to report.
create index if not exists idx_fleetpal_units_org_unmatched
  on fleetpal_units (org_id) where match_method = 'unmatched';

create or replace function guard_fleetpal_unit_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- `p_location => null` and `p_active => false`: this collector never names a bay, and it MUST be
  -- able to resolve to a retired truck, because a repair from March belongs to the truck that was
  -- running in March whatever its status is today.
  if not public.inventory_holder_is_ours(new.org_id, null, new.vehicle_id, new.trailer_id, false) then
    if new.vehicle_id is not null then
      raise exception 'vehicle % is not this org''s', new.vehicle_id using errcode = 'IV012';
    else
      raise exception 'trailer % is not this org''s', new.trailer_id using errcode = 'IV012';
    end if;
  end if;
  return new;
end;
$$;

comment on function guard_fleetpal_unit_match() is
  'A FleetPal unit may only resolve to equipment of its own org (IV012). The guarantee the foreign keys cannot give, because neither vehicles nor trailers carries an (id, org_id) unique constraint.';

create trigger trg_fleetpal_units_match_is_ours
  before insert or update on fleetpal_units
  for each row execute function guard_fleetpal_unit_match();

create trigger trg_fleetpal_units_updated
  before update on fleetpal_units
  for each row execute function set_updated_at();

create trigger trg_fleetpal_units_org_immutable
  before update on fleetpal_units
  for each row execute function forbid_org_change();

alter table fleetpal_units enable row level security;
-- Deny-all: raw collector staging (D-SEP1). The web reads resolved units through the maintenance
-- module's endpoints, never this table.

-- ── webhook idempotency ─────────────────────────────────────────────────────────────────────────
create table if not exists fleetpal_webhook_deliveries (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  -- `X-Fleetpal-Delivery`. Stable across retries, which is what makes it the dedup key.
  delivery_id    text not null check (length(btrim(delivery_id)) > 0),
  event_key      text not null check (length(btrim(event_key)) > 0),
  -- `X-Fleetpal-Event-Timestamp` — when the business event HAPPENED, fixed across retries. This is
  -- the ordering key. `X-Fleetpal-Timestamp` (this attempt's signing time) is deliberately not
  -- stored: keeping it would invite somebody to order by it, and a retried old event signs newer
  -- than an event that succeeded first time.
  event_at       timestamptz not null,
  received_at    timestamptz not null default now(),
  processed_at   timestamptz,
  status         text not null default 'received'
                   check (status in ('received', 'processed', 'ignored', 'failed')),
  note           text,
  constraint fleetpal_webhook_deliveries_org_delivery_key unique (org_id, delivery_id)
);

comment on table fleetpal_webhook_deliveries is
  'Seen FleetPal webhook deliveries, keyed by X-Fleetpal-Delivery so an at-least-once retry is a no-op (D-FP10). Prunable operational state, not evidence.';

create index if not exists idx_fleetpal_webhook_deliveries_org_event_at
  on fleetpal_webhook_deliveries (org_id, event_at desc);

alter table fleetpal_webhook_deliveries enable row level security;
-- Deny-all. A webhook is a wake-up signal and never a source of truth: the handler verifies the
-- signature, records the delivery id here, and then fetches the referenced resource back through
-- the authenticated API.
