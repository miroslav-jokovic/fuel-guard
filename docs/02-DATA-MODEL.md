# FuelGuard — Data Model, Schema & Anomaly Rules

> Postgres (Supabase) schema, RLS policies, indexes, and the precise anomaly rule spec.
> This is the contract. Windsurf builds migrations from this file.

---

## 1. Entity overview

```
organizations ──< memberships >── auth.users
      │
      ├──< vehicles ──< fuel_transactions >── drivers
      │                      │
      │                      └──< anomalies
      ├──< anomaly_thresholds (1:1 defaults per org)
      ├──< audit_logs
      └──< invites
```

- One **organization** (Silvicom) at launch; everything is tenant-scoped by `org_id`.
- **memberships** join Supabase `auth.users` to an org with a role.
- **fuel_transactions** is the central fact table; **anomalies** hang off it.

---

## 2. Enums

```sql
create type user_role     as enum ('admin', 'fleet_manager', 'driver', 'auditor');
create type fuel_type      as enum ('diesel', 'gasoline', 'def', 'electric', 'other');
create type vehicle_status as enum ('active', 'maintenance', 'retired');
create type anomaly_status as enum ('open', 'investigating', 'resolved', 'dismissed', 'superseded');
create type anomaly_severity as enum ('low', 'medium', 'high', 'critical');
create type invite_status  as enum ('pending', 'accepted', 'revoked', 'expired');
```

---

## 3. Tables (canonical definitions)

> Every table has `org_id`, `created_at`, `updated_at`. `updated_at` maintained by a trigger.

### organizations
```sql
create table organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  allowed_domains text[] not null default '{}',  -- e.g. {'silvicominc.com'}
  operating_hours jsonb not null default '{"start":"05:00","end":"20:00","tz":"America/Chicago"}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
```

### memberships
```sql
create table memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       user_role not null default 'driver',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
```

### invites
```sql
create table invites (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  email      text not null,
  role       user_role not null default 'driver',
  status     invite_status not null default 'pending',
  invited_by uuid references auth.users(id),
  token      text not null unique,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, email)
);
```

### drivers
```sql
create table drivers (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid references auth.users(id),      -- nullable: driver may not have a login
  full_name  text not null,
  employee_id text,
  phone      text,
  status     text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### vehicles
```sql
create table vehicles (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  unit_number     text not null,                  -- internal fleet number
  make            text,
  model           text,
  year            int,
  plate           text,
  vin             text,
  fuel_type       fuel_type not null default 'diesel',
  tank_capacity_gal numeric(7,2) not null,        -- used by capacity rules
  baseline_mpg    numeric(6,2),                   -- seeded; engine refines a rolling baseline
  current_odometer numeric(10,1) not null default 0,
  status          vehicle_status not null default 'active',
  assigned_driver_id uuid references drivers(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, unit_number)
);
```

### fuel_transactions  (the central fact table)
```sql
create table fuel_transactions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  vehicle_id      uuid references vehicles(id),    -- nullable flags "unattributed"
  driver_id       uuid references drivers(id),
  fueled_at       timestamptz not null,            -- when fueling happened
  odometer        numeric(10,1),                   -- driver-entered; nullable flags "missing"
  gallons         numeric(8,3) not null,
  price_per_gal   numeric(8,3),
  total_cost      numeric(10,2),
  location_text   text,
  location_lat    numeric(9,6),
  location_lng    numeric(9,6),
  source          text not null default 'manual',  -- manual | import | fuel_card
  receipt_path    text,                            -- Supabase Storage path
  -- derived (computed by engine on write):
  miles_since_last numeric(10,1),
  computed_mpg     numeric(6,2),
  has_anomaly      boolean not null default false,
  max_severity     anomaly_severity,
  entered_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
```

### anomalies
```sql
create table anomalies (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  transaction_id uuid not null references fuel_transactions(id) on delete cascade,
  vehicle_id    uuid references vehicles(id),
  rule_id       text not null,                     -- e.g. 'odometer_regression'
  severity      anomaly_severity not null,
  status        anomaly_status not null default 'open',
  message       text not null,                     -- human-readable explanation
  evidence      jsonb not null default '{}',       -- the numbers that fired it
  source        text not null default 'rules',     -- rules | ml (future)
  assigned_to   uuid references auth.users(id),
  resolved_by   uuid references auth.users(id),
  resolved_at   timestamptz,
  resolution_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
```

### anomaly_thresholds  (per-org config, 1 row)
```sql
create table anomaly_thresholds (
  org_id            uuid primary key references organizations(id) on delete cascade,
  mpg_drop_pct      numeric(5,2) not null default 15.0,   -- % below baseline
  capacity_tolerance_pct numeric(5,2) not null default 5.0,
  rapid_refuel_hours int not null default 4,
  max_plausible_mph  numeric(5,1) not null default 85.0,  -- for implausible-jump rule
  enabled_rules     text[] not null default '{}',         -- empty = all defaults on
  updated_at        timestamptz not null default now()
);
```

### audit_logs
```sql
create table audit_logs (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  actor_id   uuid references auth.users(id),
  action     text not null,        -- 'invite.created','role.changed','anomaly.resolved','threshold.updated'
  entity     text,                 -- table/entity name
  entity_id  uuid,
  meta       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
```

---

## 4. Helper functions for RLS

```sql
-- current user's org from JWT claim (set by the Custom Access Token hook)
create or replace function auth_org_id() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'org_id','')::uuid;
$$;

create or replace function auth_role() returns text
language sql stable as $$
  select current_setting('request.jwt.claims', true)::jsonb ->> 'role';
$$;
```

---

## 5. RLS — the pattern (apply to EVERY table)

> RLS is mandatory. Every tenant table follows the same shape: read/write only within your org; writes that change roles/settings require admin.

```sql
alter table vehicles enable row level security;

-- READ: anyone in the org
create policy vehicles_select on vehicles
  for select using (org_id = auth_org_id());

-- INSERT/UPDATE/DELETE: managers & admins (drivers are read-only on fleet config)
create policy vehicles_write on vehicles
  for all
  using (org_id = auth_org_id() and auth_role() in ('admin','fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin','fleet_manager'));
```

Per-table authorization summary:

| Table | Read | Write |
|-------|------|-------|
| organizations | org members | admin |
| memberships | org members | admin |
| invites | admin | admin (via API) |
| drivers | org members | admin, fleet_manager |
| vehicles | org members | admin, fleet_manager |
| fuel_transactions | org members | drivers (own/insert), managers (all) |
| anomalies | org members | managers (status/notes); engine via service role |
| anomaly_thresholds | org members | admin |
| audit_logs | admin, auditor | service role only (no client writes) |

> Drivers may **insert** fuel_transactions and read their own; they cannot edit fleet config or resolve anomalies. The Express API uses the **service role** (bypasses RLS) only for engine writes, imports, invites, and audit logging — all after its own auth-middleware checks the caller's JWT and role.

---

## 6. Indexes (RLS performance + query speed)

```sql
create index on memberships (user_id);
create index on memberships (org_id);
create index on vehicles (org_id);
create index on drivers (org_id);
create index on fuel_transactions (org_id);
create index on fuel_transactions (vehicle_id, fueled_at desc);  -- baseline & "last fill" lookups
create index on fuel_transactions (org_id, fueled_at desc);
create index on anomalies (org_id, status);
create index on anomalies (transaction_id);
```

Index every column used in an RLS policy (`org_id` everywhere) — missing indexes are the top RLS performance killer.

---

## 7. Anomaly rules — precise spec

> Implement in `packages/shared/anomalyRules.ts` as pure functions `(ctx) => RuleResult`. `ctx` = `{ txn, vehicle, previousTxn, recentTxns, thresholds, operatingHours }`. Each returns `{ ruleId, fired, severity, message, evidence }`.

### Tier 1 — Odometer integrity
| ruleId | Fires when | Severity | Evidence |
|--------|-----------|----------|----------|
| `odometer_missing` | `txn.odometer` is null while `gallons > 0` | medium | `{gallons}` |
| `odometer_regression` | `txn.odometer < previousTxn.odometer` | high | `{previous, current}` |
| `odometer_stale` | `txn.odometer == previousTxn.odometer` and `gallons > 0` | medium | `{odometer, gallons}` |
| `odometer_implausible_jump` | `miles_since_last / hours_elapsed > thresholds.max_plausible_mph` | high | `{miles, hours, impliedMph}` |

### Tier 2 — Volume vs. capacity
| ruleId | Fires when | Severity | Evidence |
|--------|-----------|----------|----------|
| `exceeds_tank_capacity` | `gallons > tank_capacity_gal * (1 + capacity_tolerance_pct/100)` | critical | `{gallons, capacity, tolerancePct}` |
| `implausible_topoff` | `gallons` exceeds plausible empty space given `miles_since_last` and `baseline_mpg` (gallons consumed ≈ miles/mpg; dispensed should not greatly exceed consumed + small buffer) | high | `{gallons, milesSinceLast, baselineMpg, expectedConsumed}` |

### Tier 3 — Efficiency
| ruleId | Fires when | Severity | Evidence |
|--------|-----------|----------|----------|
| `mpg_deviation` | `computed_mpg < baseline_mpg * (1 - mpg_drop_pct/100)` (needs valid odometer delta) | high | `{computedMpg, baselineMpg, dropPct}` |
| `mpg_sustained_decline` | rolling baseline declined across last N valid fills beyond noise | medium | `{trend, window}` |

### Tier 4 — Behavioral
| ruleId | Fires when | Severity | Evidence |
|--------|-----------|----------|----------|
| `rapid_repeat_fueling` | another fill on same vehicle within `rapid_refuel_hours` | high | `{minutesSincePrev}` |
| `off_hours_fueling` | `fueled_at` time-of-day outside org operating_hours | medium | `{fueledAt, window}` |
| `unattributed_transaction` | `vehicle_id` or `driver_id` is null | high | `{missing}` |
| `cost_outlier` | `price_per_gal` outside org rolling range (e.g. > 3σ or fixed band) | low | `{pricePerGal, expectedRange}` |

**Engine rules of thumb**
- `computed_mpg = miles_since_last / gallons`, only when there is a valid, non-regressed odometer delta.
- `baseline_mpg` = rolling median of last **5** valid fills (fallback to seeded `vehicles.baseline_mpg` until enough history). Exclude fills with odometer anomalies from the baseline.
- A txn can fire multiple rules → multiple `anomalies` rows. `fuel_transactions.max_severity` = highest fired severity; `has_anomaly = true`.
- Re-scoring an edited txn deletes its prior `rules`-source anomalies and re-creates.

---

## 8. Seed data (`supabase/seed.sql`)

- 1 organization: **Silvicom Inc.**, `allowed_domains = {silvicominc.com}`.
- ~8 vehicles (mixed diesel/gas, varied tank sizes & baseline MPG).
- ~6 drivers.
- ~150 fuel_transactions across 3 months, including a deliberate spread of **clean** records plus seeded examples of each anomaly type (a regression, an over-capacity fill, an MPG cliff, a rapid double-fuel, an off-hours fill, an unattributed txn) so the dashboard and queue look real on day one.

---

## 9. Research sources (fraud-detection design)

The rule set above is grounded in industry fleet fuel-fraud guidance:

- [WEX — How to stop fuel theft](https://www.wexinc.com/resources/blog/how-to-stop-fuel-theft-in-its-tracks/)
- [Element Fleet — Best practices to combat fuel fraud](https://www.elementfleet.com/insights-and-resources/insights/blogs/best-practices-to-combat-fuel-fraud-in-commercial-fleets)
- [Fuelman — Warning signs of fuel card fraud](https://www.fuelman.com/your-business-is-at-risk/)
- [FleetWage — Fuel card fraud prevention guide](https://fleetwage.com/blog/fuel-card-fraud-prevention-guide)
- [OTR Solutions — Fuel fraud in trucking (2026)](https://otrsolutions.com/blog/fuel-fraud)
- [HVI — Fuel theft: detect, prevent, save](https://heavyvehicleinspection.com/blog/post/fuel-theft-in-fleets-how-to-detect-prevent-and-save)

---

## 10. v1.1 Amendments — supersede the sections above

> These changes come from the design audit (`06-AUDIT-FINDINGS.md`) and the new integration/AI
> scope. Where they conflict with earlier sections, **these win.** Build migrations from here.

### 10.1 Common columns & triggers (L5)
Every table gets `created_at` and `updated_at`. Add `created_at` to `anomaly_thresholds`. The
`updated_at` trigger:
```sql
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
-- apply per table:
create trigger trg_updated_at before update on <table>
  for each row execute function set_updated_at();
```

### 10.2 Idempotency & identity (H8, M6)
- `fuel_transactions.id` is **client-generated UUID v4** (used as PK *and* storage path prefix) so
  double-submit upserts harmlessly.
- Add to `fuel_transactions`: `external_ref text`, `import_id uuid references imports(id)`,
  and `version int not null default 1` (H6 optimistic concurrency). Anomalies also get `version`.
- Dedup index: `create unique index on fuel_transactions (org_id, external_ref) where external_ref is not null;`

### 10.3 Referential integrity (H5)
Vehicles & drivers are **soft-deleted** (`status='retired'`); never hard-deleted when history exists.
Set `fuel_transactions.vehicle_id` / `driver_id` FKs to **`on delete restrict`**. Transactions and
anomalies are immutable history.

### 10.4 Derived odometer (B4)
`vehicles.current_odometer` is **advisory/derived** = `max(odometer)` over that vehicle's valid
transactions; refreshed by the scoring service. **Never** used as a rule input — rules use
`previousTxn` (§10.7).

### 10.5 Thresholds table changes (L1, L6)
```sql
-- replace enabled_rules with explicit opt-out, add cost band + AI settings
alter table anomaly_thresholds
  drop column enabled_rules,
  add column disabled_rules text[] not null default '{}',   -- "off" is additive/explicit
  add column cost_min_per_gal numeric(6,3),                 -- fixed-band cost_outlier
  add column cost_max_per_gal numeric(6,3),
  add column ai_verification_enabled boolean not null default true,
  add column ai_monthly_token_budget int,
  add column created_at timestamptz not null default now();
```
Add denormalized `fuel_transactions.ai_risk_level anomaly_severity` for fast queue sorting (see `07`).

### 10.6 Expanded audit actions (H9)
`audit_logs.action` must cover at minimum: `auth.login`, `auth.login_failed`, `invite.created`,
`invite.accepted`, `invite.revoked`, `membership.created/updated/deleted`, `role.changed`,
`vehicle.created/updated/retired`, `driver.created/updated/retired`,
`transaction.created/edited/deleted`, `anomaly.status_changed`, `threshold.updated`,
`export.generated`, `import.run`, `ai.verification_run`.

### 10.7 Precise engine definitions (B4, H2, M3)
- **`previousTxn`** := for the same `vehicle_id`, the row with the greatest `fueled_at` **strictly <**
  the current row's `fueled_at`, tiebreak by `created_at`. **`recentTxns`** := last **5** *valid*
  fills (not odometer-anomalous) by `fueled_at`, same vehicle.
- **Re-score cascade**: on insert/edit/delete, re-score the changed txn **and the immediately
  following txn** in `fueled_at` order for that vehicle. Scoring is **serialized per vehicle**
  (Postgres advisory lock).
- **Guards**: skip MPG rules when `gallons<=0`, `baseline_mpg` null, or odometer delta invalid; skip
  implausible-jump when `hours_elapsed<=0`; first-ever fill (no `previousTxn`) **skips** delta-based
  rules (does not fire them).

### 10.8 Rule scope, precedence & specifics (H1, H3, H4, M5, M9, L1–L3)
- **Fuel-type gating**: Tier 2 (capacity/top-off) and Tier 3 (MPG) run **only** for
  `fuel_type in ('diesel','gasoline')`. Electric/DEF → odometer + behavioral rules only.
- **Baseline**: `baseline_mpg` stays nullable; **no baseline → MPG rules skipped** until ≥3 valid
  fills, then rolling **median of last 5** becomes the baseline.
- **Off-hours tz**: compare `fueled_at AT TIME ZONE org.operating_hours.tz`; support windows crossing
  midnight.
- **Precedence**: if `exceeds_tank_capacity` fires, **suppress** `implausible_topoff`.
- **`mpg_sustained_decline`**: median MPG of last 3 valid fills < 90% of median of the prior 3.
- **`cost_outlier`**: fixed band (`cost_min/max_per_gal`); σ-based deferred.
- **Re-scoring keeps workflow**: never delete anomalies that are not `open`; mark them `superseded`
  (new enum value) with a note; replace only still-`open` rules-anomalies.
- **Authoritative money**: `gallons` and `total_cost` are source of truth; `price_per_gal` derived
  (`total/gallons`, 3dp).

### 10.9 Storage policy SQL (M7)
Bucket `receipts`, objects keyed `org_id/vehicle_id/{fillup_uuid}.webp`:
```sql
create policy receipts_read on storage.objects for select
  using (bucket_id = 'receipts' and split_part(name,'/',1) = auth_org_id()::text);
create policy receipts_write on storage.objects for insert
  with check (bucket_id = 'receipts' and split_part(name,'/',1) = auth_org_id()::text);
```
Add a cross-org object-read **negative test** to the go-live checklist.

### 10.10 New tables (defined in companion docs)
- `ai_verifications` — see `07-AI-VERIFICATION.md §5`.
- `fuel_cards`, `imports`, `import_rows` (+ `fuel_transactions.external_ref/import_id`) — see
  `08-EFS-INTEGRATION.md §3`. `integration_credentials` is **phase-2 only**.

### 10.11 Single-org-per-user (M1)
v1 constraint: a user belongs to **one** org. `memberships (org_id,user_id)` unique already enforces
one role per org; the JWT hook injects that sole membership's `org_id`/`role`.

