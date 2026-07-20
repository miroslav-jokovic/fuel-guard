# McLeod TMS Integration — design & research

**Goal.** Two related problems on the Alerts page trace back to the same missing context — *what the truck was
actually doing*:

1. **Reefer-diversion false positives.** `reefer_fuel_diversion` flags a truck that hauls a reefer trailer but
   bought little/no reefer (ULSR) fuel over the window. But if the reefer **wasn't run** — dry freight in a
   reefer, deadhead, an empty trailer, or simply no temperature-controlled load — there's *nothing to fuel*, so
   the alert is wrong. We currently have no signal for "did this truck actually pull a reefer load."
2. **Driver home time.** When a driver is home / on time-off, the truck legitimately isn't fueling, driving, or
   running the reefer. Today that looks like a gap (or suppressed activity) with no explanation.

McLeod (the dispatch/TMS system of record) knows both: which movements were temperature-controlled, and when a
driver was off. This doc proposes how to pull that in and wire it into the detection engine.

## What we found about the McLeod API

McLeod exposes **two** integration surfaces; which one applies depends on the carrier's edition/deployment:

- **LoadMaster web services** (the classic `com.tms.ws.loadmaster.*` API, served from the carrier's own
  LoadMaster host, e.g. `https://<host>/ws/...`). The relevant services are **OrderService** (order records),
  **MovementService** (the assigned trip that ties tractor + trailer + driver to an order), **StopService**
  (stops, references, notes), and **DriverService** (retrieve/update drivers). Auth is header-based
  (company + API token). This is what most established LoadMaster Enterprise carriers have.
- **Innovation Hub / FusionAPI** (the newer cloud REST API, `https://api.mcleodsoft.com/loadmaster/v1/...`).
  OAuth 2.0 `client_credentials` (`/oauth/token` with `client_id` / `client_secret`), REST + JSON, and
  **webhooks** (e.g. `load.status.changed`). McLeod's "Open API Framework" also supports XML/JSON over
  FTP/SFTP/AS2 for bulk/EDI.

Both surfaces cover the data we need: **orders/movements carry temperature-controlled / reefer info** (McLeod
has first-class reefer support — temperature setpoint min/max and a temperature-controlled flag on the order,
plus commodity), and **DriverService** exposes driver records + status. Driver **home-time** is not a single
tidy endpoint — in McLeod it lives in driver status + the dispatch/planning ("driver availability") data and is
inferred from time-off records and the absence of an active movement; the exact representation is carrier-config
dependent (see open questions).

Access is gated by McLeod: API access must be enabled for the account (and, for the hosted/Innovation Hub path,
credentials issued through their developer portal / partner process). So step one is confirming the carrier's
edition and getting credentials — this is a customer-configuration prerequisite, not something we can code around.

## Proposed architecture (fits the existing Samsara pattern)

FuelGuard already integrates a third-party telematics system (Samsara) with a clean, copyable shape:
`integration_credentials` → per-provider client (`samsaraClient`) → sync services (`samsara*Sync.ts`) →
scheduler (`samsaraScheduler`) → data feeds the scoring engine. McLeod slots in the same way.

### 1. Credentials

`integration_credentials` is currently single-row-per-org and Samsara-shaped (`org_id` PK,
`samsara_api_token`). Generalize it so a second provider can coexist — either add McLeod columns
(`mcleod_base_url`, `mcleod_auth_kind`, `mcleod_company`, `mcleod_token` / `mcleod_client_id` +
`mcleod_client_secret`, `mcleod_enabled`, `mcleod_last_synced_at`) or move to a `(org_id, provider)` row model.
Secrets stay server-side only (service-role reads, never exposed to the browser), same as the Samsara token.

### 2. Client + sync services (new)

- `mcleodClient.ts` — auth (token header **or** OAuth `client_credentials`, chosen per `mcleod_auth_kind`) +
  typed fetch helpers for movements, stops, and drivers. Injectable fetcher so it's unit-testable offline (the
  `samsaraRecon` test pattern).
- `mcleodLoadSync.ts` — pull **movements/orders** for the org's trucks over a rolling window; for each, resolve
  whether it was **temperature-controlled** (reefer) and the active date span, and upsert into a new
  `tms_movements` table (below). Match McLeod tractor/trailer to our vehicle/trailer by unit number (or a stored
  external id).
- `mcleodDriverTimeSync.ts` — pull driver **time-off / home-time** windows into a new `driver_time_off` table.

### 3. New tables

```
tms_movements
  org_id, movement_id (mcleod), vehicle_id, trailer_id,
  started_at, ended_at,
  temperature_controlled boolean,   -- the key reefer signal
  setpoint_f numeric null, commodity text null,
  raw jsonb, synced_at
  -- index (org_id, vehicle_id, started_at)

driver_time_off
  org_id, driver_id,
  start_at, end_at, kind text,       -- home_time | pto | unavailable
  raw jsonb, synced_at
  -- index (org_id, driver_id, start_at)
```

### 4. Detection-engine wiring (the actual fix)

`ruleReeferFuelDiversion` gains one gate, assembled in `scoreTransaction`'s reefer context:

- Add `reeferLoadInWindow: boolean` to `RuleContext` — true iff the truck had **≥1 temperature-controlled
  movement** (`tms_movements.temperature_controlled`) overlapping the diversion window.
- Rule change: **when `reeferLoadInWindow` is false → return `none`** (the reefer was never asked to run, so
  buying no ULSR is expected — not diversion). When it's true and the truck still bought ~no ULSR, the signal is
  *stronger* (it hauled cold freight yet no reefer fuel), so we keep firing and can cite the load in the evidence.
- Only applies when McLeod is connected; with no TMS data we fall back to today's behavior (so nothing regresses
  for orgs without McLeod), but we can down-weight or mark it "unverified" in the evidence.

Driver home time feeds a similar suppression: when a fill/idle/off-hours signal falls inside a
`driver_time_off` window (or the truck had no movements because the driver was home), suppress or annotate it,
and stop "expected reefer fuel / expected miles" logic from running during home time.

### 5. Scheduler, API routes, UI

- `mcleodScheduler.ts` — periodic sync (reads `integration_credentials`, same shape as `samsaraScheduler`),
  behind the existing worker split.
- Integrations routes — `POST /mcleod/sync-loads`, `POST /mcleod/sync-driver-time`, and a settings screen to
  enter/validate McLeod credentials (mirrors the Samsara settings).
- Alerts page — on a reefer alert, show the load context ("no temperature-controlled load in the last 30 days"
  vs "hauled 4 reefer loads, bought 0 gal ULSR"), turning a guess into evidence.

## Phasing

1. **Connectivity** — creds model + `mcleodClient` + a read-only "test connection" that lists recent movements
   for one truck. Proves auth + field mapping before we build on it. *(Blocked on the open questions below.)*
2. **Reefer gate** — `tms_movements` + `mcleodLoadSync` + the `reeferLoadInWindow` rule gate + evidence. This
   alone removes the false positives.
3. **Driver home time** — `driver_time_off` + `mcleodDriverTimeSync` + suppression/annotation.
4. **Webhooks / freshness** — if the carrier is on Innovation Hub, subscribe to load-status webhooks instead of
   polling for near-real-time load context.

## Open questions (needed before Phase 1 — these are carrier-specific)

1. **Edition & deployment.** Is the carrier on **LoadMaster Enterprise (on-prem / McLeod-hosted, classic
   `ws` API)** or the newer **cloud / Innovation Hub (FusionAPI, OAuth)**? This decides the client + auth.
2. **API access.** Is McLeod API access already enabled for the account, and do we have (or can we get)
   credentials — a `ws` company+token, or an Innovation Hub `client_id`/`client_secret`? McLeod must turn this on.
3. **Reefer-load representation.** In their McLeod, what marks a movement as temperature-controlled — an order
   **temperature-controlled flag**, a **temperature setpoint** field, specific **commodity codes**, or an
   **order type**? We map that to `tms_movements.temperature_controlled`.
4. **Home-time representation.** How is driver time-off / home time recorded — a **driver status**, **time-off
   records**, or dispatch **availability/planning** data? Determines the `driver_time_off` source.
5. **Identity mapping.** How do McLeod tractor / trailer / driver ids line up with our units — shared
   **unit numbers**, or do we need to store McLeod external ids on `vehicles` / `trailers` / `drivers`?

Answering 1–5 unblocks Phase 1; Phases 2–3 are the parts that actually fix the Alerts page.

## Sources

- McLeod Innovation Hub — API developer portal: https://innovationhub.mcleodsoftware.com/apis
- McLeod LoadMaster web-service docs (Services list — OrderService / MovementService / StopService /
  DriverService): https://tms-dsly.loadtracking.com/ws/docs/services?role=-1
- McLeod Software — Integrations / Open API Framework: https://www.mcleodsoftware.com/solutions/integrations/
- McLeod Software — APIs for truckload carriers: https://www.mcleodsoftware.com/apis-truckload-carriers/
- Zuplo — "Unlocking the Potential of the McLeod API" (auth, base URLs, webhooks overview):
  https://zuplo.com/learning-center/mcleod-api
