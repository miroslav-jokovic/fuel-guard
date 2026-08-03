# FuelGuard — Fuel-Card Integration (XLSX/CSV upload now, EFS data feed later)

> Ingest fuel-card transactions. **Primary source: EFS CardManagementWS SOAP** (posted transactions and
> rejected authorizations). **Fallback: XLSX/CSV upload** (manual). Both sources use the same staging →
> reconcile → score pipeline.

---

## 0. Confirmed EFS format (from real Silvicom exports, 2026-06-30)

Two real EFS reports were analyzed; the spec below reflects them (superseding earlier assumptions).

**Both reports are `.xlsx`** (so the importer must accept XLSX **and** CSV), and there are **two
distinct report types**:

1. **Transaction Report** — completed purchases. Columns:
   `Card #, Tran Date, Invoice, Unit, Driver Name, Odometer, Location Name, City, State/Prov, Fees,
   Item, Unit Price, Qty, Amt, DB, Currency`.
   - `Unit` = vehicle (must match `vehicles.unit_number`); `Odometer` present on every row;
     `Qty` = gallons; `Unit Price` = $/gal; `Amt` = line total; `Currency` = `USD/Gallons`.
   - **No time** (date only) and **no lat/lng** (City/State + location name only) → off-hours and
     precise geo-distance can't come from EFS; City/State still feeds the AI location check (doc 07).
   - **`Item` is a product code and one `Invoice` spans multiple rows.** Observed codes:
     **`ULSD`/`ULSR`** = diesel (real propulsion fuel → counts toward gallons/MPG), **`DEFD`** = DEF,
     **`SCLE`** = scales, **`STAX`/`ADD`/`WWFL`** = tax/additive/wash. **Decision: import only the
     diesel/gasoline fuel line; drop all non-fuel line items.** (One fueling event = the fuel row;
     ancillary rows are ignored, so `total_cost` matches the fuel `Amt`.)
   - **No single transaction id** → idempotency uses a **composite `external_ref`** =
     `Card# | Invoice | Item` (+ date).

2. **Reject Transaction Report** — *declined* attempts (e.g. `INACTIVE CARD`, `INVALID TRUCKSTOP`,
   `LIMIT EXCEEDED`). Columns: `Date, Time, Card Number, Invoice, Location ID, Location Name,
   Location City, State/Prov, Error Code, Error Description, Unit, Driver ID, Driver Name, Policy,
   Policy Name`. These are **not** fuel purchases — they are a **fraud/control signal**. **Decision:
   ingest into a separate `declined_transactions` stream** (see §3.1), surfaced as a risk feed.
   (Note: this report carries the full card PAN + numeric Driver ID and a real time, unlike the
   Transaction Report.)

---

## 1. How EFS actually shares data (grounding — confirmed with EFS 2026-07)

**EFS offers four integration channels for an in-house customer**: REST API, **SOAP web service**,
authorization webhook / push feed, and SFTP transaction+rejection feed. Their REST API returns only
successfully posted transactions — it does NOT return rejected authorization attempts — so it is
unusable for us (the fraud/control signal lives in the rejections). EFS recommended the **SOAP web
service** because it delivers **both** posted and rejected transactions through the same credential
set.

**Locked decision (2026-07):** we use the **SOAP web service** as the sole primary integration
channel, in the **in-house** deployment mode on Silvicom's own EFS account. No fees for the in-house
setup. Multi-tenant productization would require an NDA + several weeks of provisioning — tracked
separately.

**Complete integration plan:** `docs/plans/EFS-SOAP-INTEGRATION-PLAN.md` — precise, assumption-free,
verified against the codebase. That plan is the source of truth for the SOAP integration; this
document is the pipeline overview + XLSX importer spec (the SOAP source is a drop-in behind the
same staging → reconcile → score pipeline).

**Prior grounding (superseded):** an earlier version of this document assumed a Fleetio-style
"portal-authorized data feed with AC29 polling." That assumption is now retracted — EFS provides a
real SOAP webservice, not a portal-polled fixed-format file drop. The XLSX/CSV importer described
below remains valid as a manual-upload fallback path.

---

## 2. Architecture: one pipeline, swappable source

```
   SOURCE                         STAGING                  RECONCILE                 SCORE
┌───────────────┐   parse +    ┌───────────────┐  match   ┌────────────────┐  →   rules engine
│ CSV upload    │──map cols──► │ import_rows   │──card→──► │ fuel_transactions│      (docs 02 §7)
│ (phase 1)     │   validate   │ (raw + status)│  vehicle │  source='fuel_card'│  →   AI layer (07)
├───────────────┤              │               │  /driver │  external_ref=…    │
│ EFS data feed │──same parser─►               │          └────────────────┘
│ (phase 2)     │   (mapping)  └───────────────┘
└───────────────┘
```

Both sources land in the **same staging table** and go through the **same reconcile + score** steps.
Phase 2 only adds a credential store + a poller that feeds the existing parser. No rework.

---

## 3. New schema

### fuel_cards — maps a physical card to a vehicle/driver
```sql
create table fuel_cards (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  card_number_last4 text not null,
  card_ref    text,                       -- provider card id / full ref if available
  provider    text not null default 'efs',-- efs | corpay | wex | manual
  vehicle_id  uuid references vehicles(id),
  driver_id   uuid references drivers(id),
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, provider, card_ref)
);
create index on fuel_cards (org_id);
```

### imports — one upload or one feed pull
```sql
create type import_source as enum ('csv', 'efs_feed', 'corpay_feed');
create type import_status as enum ('uploaded','parsing','review','committing','completed','failed');

create table imports (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  source       import_source not null,
  filename     text,                       -- for CSV
  column_map   jsonb,                       -- chosen mapping (CSV) / fixed (feed)
  status       import_status not null default 'uploaded',
  total_rows   int not null default 0,
  inserted_rows int not null default 0,
  duplicate_rows int not null default 0,
  error_rows   int not null default 0,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on imports (org_id, created_at desc);
```

### import_rows — raw staged rows + outcome (the audit trail of ingestion)
```sql
create type row_status as enum ('pending','valid','duplicate','error','committed');

create table import_rows (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  import_id     uuid not null references imports(id) on delete cascade,
  row_number    int not null,
  raw           jsonb not null,            -- original parsed row, verbatim
  external_ref  text,                      -- provider txn id (idempotency)
  status        row_status not null default 'pending',
  error_message text,
  transaction_id uuid references fuel_transactions(id),  -- set when committed
  created_at    timestamptz not null default now()
);
create index on import_rows (import_id);
create index on import_rows (org_id, external_ref);
```

### fuel_transactions additions (from audit H8)
```sql
alter table fuel_transactions
  add column external_ref text,            -- provider txn id; null for manual
  add column import_id uuid references imports(id);
-- dedup: a provider txn can never be imported twice
create unique index fuel_txn_external_ref_uniq
  on fuel_transactions (org_id, external_ref) where external_ref is not null;
```

All follow the standard RLS pattern (02 §5): read = org members; **write = managers/admin via
API** (service role does the commit). `import_rows.raw` is retained for audit.

### 3.1 declined_transactions — Reject Report risk stream
```sql
create table declined_transactions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  import_id     uuid references imports(id),
  declined_at   timestamptz not null,         -- Reject Report has a real time
  card_ref      text,                          -- full PAN from the reject report
  invoice       text,
  unit          text,                          -- vehicle unit (text; resolve to vehicle_id if known)
  vehicle_id    uuid references vehicles(id),
  driver_ext_id text,                          -- numeric Driver ID from the report
  driver_id     uuid references drivers(id),
  location_text text,
  city          text,
  state         text,
  error_code    text,
  error_description text,
  external_ref  text,                          -- card_ref | invoice | error_code (idempotency)
  created_at    timestamptz not null default now()
);
create index on declined_transactions (org_id, declined_at desc);
create unique index declined_external_ref_uniq
  on declined_transactions (org_id, external_ref) where external_ref is not null;
```
Surfaced as a risk feed (repeated `INACTIVE CARD` / `INVALID TRUCKSTOP` / `LIMIT EXCEEDED` attempts
are control signals). Not scored by the fuel-anomaly engine; feeds dashboards/alerts.

---

## 4. Field mapping — real EFS Transaction Report (confirmed)

Default mapping for the EFS **Transaction Report** (`.xlsx`/`.csv`). Importer stays mapping-driven so
layout changes don't break it, but ships with this as the EFS preset.

| EFS column | FuelGuard | Notes |
|-----------|------------|-------|
| `Card #` | → `fuel_cards` lookup (`card_ref`) | resolves vehicle/driver if mapped |
| `Tran Date` | `fueled_at` | **date only** → store at org-local noon; no time available |
| `Invoice` | part of `external_ref` | |
| `Unit` | `vehicle_id` via `vehicles.unit_number` | else card mapping; else **unattributed** |
| `Driver Name` | `driver_id` via name match | (Transaction Report has name, not id) |
| `Odometer` | `odometer` | **present on every row** — drives odometer rules |
| `Location Name` + `City` + `State/Prov` | `location_text` (+ `location_*`) | **no lat/lng** |
| `Item` | **product filter** | keep `ULSD`/`ULSR`/gasoline → fuel; **drop** `DEFD`,`SCLE`,`STAX`,`ADD`,`WWFL` |
| `Unit Price` | `price_per_gal` | (also re-derivable from Amt/Qty) |
| `Qty` | `gallons` | authoritative |
| `Amt` | `total_cost` | fuel line only (ancillary lines dropped) |
| `Card # \| Invoice \| Item` | `external_ref` | **composite idempotency key** |

**Multi-line invoices:** one `Invoice` may have several `Item` rows (e.g. ULSD + DEFD). The importer
keeps **only the fuel line(s)**; DEF/scales/fees are ignored (per decision), so an imported fill-up's
`total_cost` equals the fuel `Amt`.

> Setup prerequisite: each vehicle's `unit_number` in FuelGuard must equal its EFS `Unit` value
> (e.g. `637`, `704`) for auto-reconciliation; unmatched rows go to the review screen.

---

## 5. Ingestion flow (idempotent, staged, reviewable)

1. **Upload / pull** → create an `imports` row (`status=parsing`).
2. **Parse** each line into `import_rows.raw` with a `row_number`; extract `external_ref`.
3. **Validate** per row: required fields present, gallons/cost numeric, fuel type sane → `valid`
   or `error` (with message). No partial commits.
4. **Dedup**: if `external_ref` already exists in `fuel_transactions` (or staged) → `duplicate`.
5. **Reconcile**: resolve `vehicle_id`/`driver_id` via `fuel_cards`; unresolved → flagged for the
   manager to map a card (creates/links a `fuel_cards` row) or marks **unattributed**.
6. **Review screen** (status `review`): manager sees counts (valid / duplicate / error /
   unattributed), can fix mappings, then **Commit**.
7. **Commit**: insert `valid` rows into `fuel_transactions` (`source='fuel_card'`, `import_id`,
   `external_ref`), set `import_rows.status='committed'` + `transaction_id`, then **enqueue scoring**
   (rules → AI) for each new txn, **in `fueled_at` order** so baselines build correctly (audit B4).
8. **Audit**: write `import.run` with the summary counts.

Re-uploading the same file is safe: every row dedupes on `external_ref`.

---

## 6. Phase 10 — EFS SOAP source (confirmed direction)

**Approach:** replace the never-built "portal-polled AC29 feed" with a direct **SOAP webservice
client** against EFS's in-house webservice. One credential set covers both feeds:

- **Posted transactions** — polled every `EFS_SOAP_POSTED_POLL_MINUTES` (default 15 min), routed
  through the "backfill" priority lane of the SOAP client.
- **Rejected authorization attempts** — polled every `EFS_SOAP_REJECTED_POLL_MINUTES` (default 5
  min, tighter if EFS confirms lower latency is allowed), routed through the "live" lane so a slow
  posted-backfill can never starve real-time rejection polling.

Both flows feed the SAME `ingestReport()` write path used by the XLSX importer (`efsIngest.ts`).
Zero rework of the reconcile / score / faithful-store / shortfall / Samsara-recon logic downstream.
The only new files are:

- `apps/api/src/lib/soapClient.ts` — rate-limited SOAP HTTP client, modeled on `samsaraHttp.ts`
  (per-credential pacing, Retry-After, exponential backoff, priority lanes, optional egress proxy).
- `apps/api/src/lib/efsSoap.ts` — EFS-specific SOAP operations. Uses `login`/`clientId`,
  `getMCTransExtLocV2`, `getTranRejects`, and best-effort `logout`, with XML response normalization.
- `apps/api/src/services/efsSoapCredentials.ts` — CRUD + non-secret status (`efs_soap_credentials`).
- `apps/api/src/services/efsSoapIngest.ts` — thin bridge that pipes SOAP rows into `ingestReport()`.
- `apps/api/src/services/efsSoapPoller.ts` — two-tier scheduler wrapping each org's pass in a
  jobs-ledger `runJob` call (kinds `efs_soap_posted`, `efs_soap_rejected`).
- `apps/api/src/routes/integrations.ts` — new admin routes: `GET /efs-soap/config`,
  `POST /efs-soap/enable`, `POST /efs-soap/disable`, `POST /efs-soap/test-connection`,
  `POST /efs-soap/sync-now/:feed`.

New credential storage (`supabase/migrations/0091_efs_soap_credentials.sql`):

```sql
create table efs_soap_credentials (
  org_id                    uuid primary key references organizations(id) on delete cascade,
  environment               text not null default 'sandbox'
                              check (environment in ('sandbox', 'production')),
  endpoint_url              text not null,
  soap_username             text not null,
  soap_password             text not null,
  account_id                text,
  posted_last_cursor        text,                 -- opaque delta cursor per EFS's contract
  rejected_last_cursor      text,
  posted_last_polled_at     timestamptz,
  rejected_last_polled_at   timestamptz,
  posted_last_success_at    timestamptz,
  rejected_last_success_at  timestamptz,
  posted_last_error         text,
  rejected_last_error       text,
  enabled                   boolean not null default false,
  ...
);
alter table efs_soap_credentials enable row level security;
-- No client policies → service-role only (the password lives here).
```

Env vars added to `apps/api/src/env.ts`: `EFS_SOAP_ENABLED` (master kill switch, defaults false),
`EFS_SOAP_ENVIRONMENT`, `EFS_SOAP_ENDPOINT_URL`, `EFS_SOAP_USERNAME`, `EFS_SOAP_PASSWORD`,
`EFS_SOAP_ACCOUNT_ID` (optional single-tenant fallback), `EFS_SOAP_POSTED_POLL_MINUTES`,
`EFS_SOAP_REJECTED_POLL_MINUTES`, `EFS_SOAP_MAX_RPS`, `EFS_SOAP_MAX_RETRIES`,
`EFS_SOAP_BACKFILL_DAYS`, and optional `EFS_SOAP_EGRESS_PROXY_URL`.

Full implementation plan + timeline: **`docs/plans/EFS-SOAP-INTEGRATION-PLAN.md`**.

---

## 7. Build phasing

- **File import = Phase 4.5** (right after manual fuel capture, before/with the engine so imported
  data also gets scored). Scope confirmed 2026-06-30:
  - **XLSX + CSV** parsing (SheetJS), auto-detect report type by header signature.
  - Schema: `fuel_cards`, `imports`, `import_rows`, `declined_transactions`, + `fuel_transactions`
    `external_ref`/`import_id`.
  - **Transaction Report** → fuel_transactions: split multi-line invoices, **keep diesel/gas lines
    only**, composite `external_ref`, reconcile Unit→vehicle / Driver Name→driver, review + commit,
    enqueue scoring in `fueled_at` order.
  - **Reject Report** → `declined_transactions`: dedup, reconcile, surface as a risk feed.
  - Mapping-driven UI with a saved EFS preset; full audit (`import.run`).
- **Phase 10 — EFS SOAP source (confirmed direction, in flight 2026-07):** SOAP webservice replaces
  the never-built "portal polling" plan. Prep work (migration 0091, env schema, credential storage,
  scheduler wiring, admin routes, plan document) is complete; SOAP operations and end-to-end
  connectivity land after EFS's data release delivers the WSDL. XLSX importer stays as a manual
  upload fallback for outages and historical loads.

---

## 8. Open items / setup prerequisites

- ✅ Real EFS exports obtained — format locked (§0, §4). Layout: EFS standard (not Corpay AC29).
- ✅ Confirmed: **odometer present**, **no lat/lng**, **date only (no time)** on the Transaction Report.
- ✅ EFS integration channel locked — SOAP webservice, in-house deployment, no fees (2026-07).
- ⏳ Awaiting EFS's data release: WSDL, sandbox credentials, endpoint URLs, authentication scheme,
  delta-cursor mechanism, stable transaction ID field, product-code list, rejection-code list,
  IP allowlisting format, rate limits. Complete list in
  `docs/plans/EFS-SOAP-INTEGRATION-PLAN.md` §11.
- Seed **`fuel_cards`**: provide the `Card # → vehicle/driver` assignment list (the Transaction
  Report's short `Card #` differs from the Reject Report's full PAN — capture both if available).
- Ensure each FuelGuard vehicle's **`unit_number` matches the EFS `Unit`** value for auto-reconcile.
- Product-code list may grow; the importer treats any code **not** in the fuel allowlist
  (`ULSD`,`ULSR`, gasoline codes) as non-fuel and skips it — add new fuel codes to the allowlist as needed.

---

## Sources
- **`docs/plans/EFS-SOAP-INTEGRATION-PLAN.md`** — the SOAP integration source of truth.
- [Fleetio — EFS fuel card integration (superseded reference for the never-built polling path)](https://help.fleetio.com/en_US/fuel/efs-fuel-card-integration)
- [Motive — Download CSV files from WEX/EFS fuel purchase integration](https://helpcenter.gomotive.com/hc/en-us/articles/6191936452381-Download-CSV-Files-From-WEX-EFS-Fuel-Purchase-Integration)
- [Geotab — Fleetcor fuel transaction setup](https://support.geotab.com/mygeotab/mygeotab-add-ins/doc/fleet-fuel-transaction)
