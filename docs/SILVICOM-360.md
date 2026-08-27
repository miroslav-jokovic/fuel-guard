# Silvicom 360 — Product Definition

**Status: CANONICAL.** Written 2026-08-26, the re-founding date. Decision IDs are `D-S360-*`.
This document says what the product IS; `docs/ARCHITECTURE.md` says how it is built. When a plan
document in `docs/plans/` disagrees with this inventory about scope or status, this document
wins and the plan needs a truth-pass correction.

## 1. What this product is — D-S360-1

**FuelGuard is the wrong name for what this became.** The product started as fleet fuel security
and grew into the carrier's **operational data platform**: it collects from every service the
company runs on, stores it canonically, and sells the harness on top — compliance files, fraud
detection, spend reconciliation, hiring, reporting. Fuel security is now one feature among many.

**D-S360-1: the product is renamed Silvicom 360.** The rename is executed as its own contained
step (package names, Railway service names, app titles, this repo's docs) — deliberately NOT
smeared across unrelated PRs. Until that step lands, code says FuelGuard and this document
already says Silvicom 360; that is expected, not drift.

**D-S360-2: collect first, then derive.** Every feature stands on data the platform already
collects canonically. When a feature needs data we don't have, the work item is "build the
collector," not "let the feature fetch it ad hoc." This is the product-side statement of the
architecture's collectors → core → harness shape, and it exists because the audit found the
opposite pattern (five features querying `fuel_transactions` directly, each inventing its own
read) is how double work happened.

**D-S360-3: manual uploads are a legitimate collector, not a stopgap apology.** Toll expenses
and Pilot posted prices arrive by spreadsheet today; the platform treats an upload exactly like
an API feed — staged, validated, attributed, idempotent. Automation replaces the transport
later without the features above noticing.

## 2. Data sources

| Source | What it feeds | Status |
|---|---|---|
| **EFS** (WEX) | Fuel transactions, card mirror, card control writes | Live — the deepest integration; capability registry with proofs and promotions |
| **Samsara** | Telematics, HOS, engine hours, IFTA jurisdiction miles, idle evidence | Live |
| **McLeod** (via carrier VPN) | Roster identity, movements, settlements, AP, billing | Live for roster + extraction; financial ingestion into `financial_entries` is the next build (FINANCIAL-STORE-PLAN) |
| **PSP** (FMCSA pre-employment screening) | Screening reports into the DQ file | Live (UAT token held; production billing rules pinned) |
| **Hazmat regulatory data** | Versioned rules powering the hazmat engine | Live (pure packages, versioned data) |
| **Manual uploads** | Toll expenses, Pilot/posted fuel prices, spreadsheets | Partially live (imports + price XLS); tolls not yet built |
| **FleetPal** | Maintenance | Planned — ⚠ McLeod AP already carries maintenance dollars; the collector must dedupe against it (the "maintenance arrives twice" trap, FINANCIAL-STORE-PLAN) |
| **FMCSA Clearinghouse / MCMIS** | §382.701 queries, carrier data | Planned |
| ~~SambaSafety~~ | MVR ordering + licence monitoring | **DEFERRED 2026-08-26 on cost** (D-S360-4). Possibly replaced later by an in-house MVR path; the recon and the settled credential decision are preserved in the plan banners |

## 3. Feature inventory

### Shipped and live

- **Fuel security** — anomaly detection, scoring, declined-transaction analysis, case lifecycle.
- **Fuel spend** — statements, reconciliation, exceptions, buy discipline, spend reports.
- **IFTA** — completed-months ledger from Samsara jurisdiction miles + fuel gallons.
- **Idle & efficiency** — idle evidence pipeline, rollups, avoidability, driver performance scores.
- **Card control** — EFS card writes through the capability registry, step-up approved.
- **Roster** — drivers/vehicles/trailers, McLeod-synced identity with provenance.
- **DQF (partial)** — document store, derivatives, previews, qualification gate, DQ alerts,
  binder rendering (`dqBinder`). Retention/self-service phases remain (DQF-EXECUTION-PLAN).
- **Recruiting & applications** — invitation → wizard → capture → packet PDF → disposition.
  **Code-complete and legally inert** until counsel clears the instruments
  (COUNSEL-REVIEW-PACKAGE — the single blocking artifact).
- **Employer inquiries** — incoming verification requests (E1–E5; E6/E7 remain).
- **Hazmat** — load vetting against the versioned rules engine, documents, reviews.
- **Dispatch & loads** — load lifecycle with approval gate, driver-visible release.
- **Messaging** — office↔driver threads, notifications with entitlement/quiet-hours.
- **Driver app** — Expo app: duty, loads, messages, score, hazmat capture; nine hardening
  phases built; MapLibre navigation dev-gated (D52).
- **Admin console** — internal platform operations (own service).

### Committed, being built or unblocked next

- **Digital binders / DQ files** — complete the DQF execution plan on the shipped foundation.
- **Digital truck & trailer files** — the "office axis" 0099/0100 shipped as dead columns;
  build the pages on the `roster` carve-out or drop the columns (D-ARC3 matrix decides it there).
- **Applicant & hiring digitalisation** — unblocks the moment counsel returns; then A0/P1/P5.
- **Training** — six authored Silvicom 360 content modules exist
  (`docs/plans/silvicom360/MODULE-01..06`) with no delivery system and, until now, no owner.
  **D-S360-5: training is one feature** — the module content, DRIVER-TRAINING-PLAN, R7, and
  packet page 24 all fold into a single future plan under this name.
- **Financial store** — McLeod settlements/AP/billing ingestion into `financial_entries`
  (schema shipped 0257; ingestion is the work).
- **Toll expense collection** — manual upload first (D-S360-3).

### Deferred, deliberately

- **SambaSafety MVR** (D-S360-4) — cost. Revival inherits the settled credential decision.
- **Planned/smart fueling** — production says one `fuel_plans` row ever; dormant-bannered
  2026-08-26. Re-validate demand before any build.
- **Adverse action (R10)** — waiting on counsel's FCRA answers, on purpose.
- **C# rewrite** — rejected (D-ARC2). The future TMS consumes the API.

## 4. How plans relate to this document

`docs/plans/<area>/` documents remain the build-level decision logs. This inventory is the map;
a feature not listed here needs a D-S360 decision before its plan starts. The 2026-08-26 truth
pass made the plan corpus trustworthy again — keep it that way: shipping a step means marking it
in its plan the same day.
