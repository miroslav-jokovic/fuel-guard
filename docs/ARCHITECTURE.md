# Silvicom 360 — Architecture Contract

**Status: CANONICAL** (like `DESIGN-SYSTEM-CONTRACT.md` and `MIGRATION-DISCIPLINE.md`). Written
2026-08-26 from the re-founding decision, after a full audit of the codebase, schema, and plan
corpus found the mess was structural, not local: 151 flat files in `apps/api/src/services`, the
`drivers` table touched by 54 API files, one compliance fact stored in two unsynchronised places,
and four tables shipped with zero application code. This document names the architecture those
symptoms were missing. Decision IDs are `D-ARC*`; cite them the way `D-DQ6` and `D-DS11` are cited.

**The standing rule of this repo applies to this document too: gates outrank prose.** Where a
`lint:*` script and this document disagree, the gate is the contract and this file has rotted —
fix the file. §6 lists which gates enforce which decision, and which decisions are not yet
gate-backed (those are the ones a reviewer must hold by hand until the gate lands).

---

## 1. The shape — D-ARC1

Silvicom 360 is a **data platform with a product on top**, and the architecture says so in three
layers:

```
  COLLECTORS        one module per external source; owns its raw/staging tables,
      │             its credentials, its rate limits, its vendor quirks
      ▼
  CORE STORE        the canonical entities every feature reads; each table has
      │             exactly one owning module
      ▼
  HARNESS           the features and reports sold to the user; reads core,
                    never a collector's internals
```

Dependency direction is **downward only**: harness → core → nothing; collectors → core (they
write canonical rows through core's interfaces). A collector never imports harness code; a
harness feature never imports a collector's internals or reads its staging tables. Two harness
features never import each other's internals — coupling between features goes through core or
through `packages/shared`.

**This is a modular monolith, not microservices, on purpose.** One deploy, one Postgres, one
transaction boundary — but each module is shaped as if it could be extracted: own tables, own
interface, no reaching into a sibling. The EFS module (`apps/api/src/efs/` —
`capabilities/`, `harness/`, `orchestrator/`, `registry.ts`) is the proof this team can build
that shape; D-ARC1 generalises it instead of leaving it a one-off.

**D-ARC2 — the language stays TypeScript.** The single most valuable structural asset in this
repo is `packages/shared`: one set of Zod contracts consumed by the API, the web SPA, and the
React Native driver app. A backend rewrite in C# (considered 2026-08-26 because the future TMS
will be C#) would split that into two hand-synced languages — the exact disease the admin
console already demonstrates (seven types defined twice, drifted). The future TMS integrates
over the API surface this architecture produces; it does not dictate this codebase's language.

## 2. Collectors — one module per source

A collector owns: its credentials (dedicated `*_credentials` table with secretBox envelopes —
the 0091/0116/0012 precedent, reaffirmed when the SambaSafety fork was settled), its raw/staging
tables, its schedulers and pollers, its vendor error vocabulary, and the mapping into core rows.
Nothing outside the collector parses a vendor payload.

| Module | Today lives in | Sources | Staging/owned tables |
|---|---|---|---|
| `efs` | `apps/api/src/efs/` + `services/efs*` (to be pulled in) | EFS SOAP + transaction feed | `efs_transactions`, `efs_processing_runs`, `efs_cards`, `efs_card_mutations`, `efs_card_control_settings`, `efs_card_control_approvers`, `efs_capability_promotions`, `efs_capability_proofs`, `efs_soap_credentials`, `efs_soap_client_certs`, `card_write_counters` |
| `samsara` | `services/samsara*`, `services/idle*Sync` | Samsara telematics | `samsara_ifta_fetches`, `samsara_ifta_jurisdiction_miles`, `hos_duty_segments`, `vehicle_engine_days`, `duty_equipment_segments`, `idle_telemetry_windows` |
| `mcleod` | `apps/api/src/tms/` + `services/mcleod*` | McLeod SQL (via carrier VPN) | `tms_movements`, `mcleod_settlements`, `mcleod_ap_vouchers`, `mcleod_billing`, `load_external_payloads` |
| `psp` | `apps/api/src/psp/` | FMCSA PSP via vendor API | `psp_requests`, `driver_authorizations` |
| `hazmat-data` | `packages/hazmat-data`, `packages/hazmat-engine` | Versioned regulatory data | (pure packages, no tables — and gate-enforced to stay that way) |
| `manual-uploads` | `services/import*`, XLS price upload | Toll expenses, Pilot/posted fuel prices, spreadsheets | `imports`, `import_rows` |
| `fleetpal` | — not built | FleetPal maintenance | none yet — **watch the double-arrival trap**: McLeod AP already carries maintenance dollars (FINANCIAL-STORE-PLAN records this) |
| `fmcsa` | — not built | Clearinghouse §382.701, MCMIS | none yet |
| ~~`samba`~~ | — | SambaSafety MVR | **DEFERRED 2026-08-26** on cost (see DQF-EXECUTION-PLAN Phase E banner) |

## 3. Core store — every table has exactly one owner (D-ARC3)

The audit's sharpest finding: `fuel_transactions` is written by 35 API files and read directly
by five web features, and CDL/medical expiry lives in BOTH `drivers.*` columns (0098) and
`certifications` rows (0127) with nothing syncing them — a §391.51 compliance surface with two
disagreeing sources. That is what "no owner" costs.

**The rule:** every table is owned by exactly one module. Only the owner writes it. Readers
outside the owner go through the owner's exported interface (service function or RPC), not raw
`.from("table")`. RLS does not save us here — the API reads with the service role, which
bypasses RLS; ownership is the discipline that replaces it.

| Core module | Owns |
|---|---|
| `org` (identity & platform) | `organizations`, `memberships`, `invites`, `org_modules`, `org_integrations`, `integration_credentials`, `org_usage_month`, `platform_admins`, `platform_audit_log`, `support_impersonation_grants`, `audit_logs` (append-only), `jobs`, `migration_markers` |
| `roster` | `drivers`, `vehicles`, `trailers`, `terminals`†, `driver_vehicle_assignments`, `driver_time_off` |
| `fuel` | `fuel_transactions`, `fuel_events`, `declined_transactions`, `fuel_cards`, `fuel_stations`, `station_geocode_learned`, `fuel_prices`, `fuel_prices_posted`, `fuel_price_days`, `fuel_discount_rules` |
| `evidence` | `documents`, `certifications`, `qualification_records`, `dq_exports` — the append-only set pinned in `RETENTION_FORBIDDEN` |
| `loads` | `loads`, `load_stops`, `load_events`, `load_stop_photos` |
| `financial` | `financial_entries` (staging feeds arrive via the `mcleod` collector) |

† `terminals` has zero producers and zero readers since 0097 while three roster FKs point at it —
resolve (build or drop) during the `roster` carve-out.

**The CDL/medical dual-source resolves toward `evidence`** when `roster` and `evidence` are
carved out: `certifications` is what the qualification gate (§391) already reads, so it is the
source of truth; the `drivers.cdl_*`/medical columns become a synced projection or are dropped.
Until that carve-out lands, treat `certifications` as authoritative in new code.

## 4. Harness — the features

Harness modules read core through owners' interfaces, own their feature-specific tables, and map
1:1 with `apps/web/src/features/*` (and `apps/driver/src/features/*`) on the client side.

| Module | Owns | Client feature(s) |
|---|---|---|
| `anomalies` | `anomalies`, `anomaly_transitions`, `anomaly_thresholds`, `scoring_attempts`, `case_pattern_reports`, `pattern_sweep_requests`, `ai_verifications`† | anomalies, dashboard |
| `fuel-spend` | `fuel_statements`, `fuel_statement_lines`, `fuel_spend_days`, `fuel_recon_runs`, `fuel_exceptions`, `fuel_exception_events` | reconcile, reports, fuel |
| `ifta` | (reads `samsara` staging + `fuel`) | ifta |
| `idle` | `idle_events`, `idle_park_sessions`, `idle_rollup_days`, `idle_settings` | fleet, dashboard |
| `performance` | `driver_scores`, `driver_performance_weeks`, `driver_performance_settings` | drivers; driver-app score |
| `compliance` (DQF, binders) | (reads `evidence`; binder rendering in `services/dqBinder/`) | compliance |
| `recruiting` | `driver_applications`, `application_drafts`, `application_invitations`, `application_captures`, `applicant_dispositions`, `employer_inquiries`, `driver_employment_history`, `esign_consents`, `sms_consents`, `seven_day_statements` | recruitment, apply |
| `hazmat` | `hazmat_loads`, `hazmat_documents`, `hazmat_policies`, `hazmat_reviews`, `hazmat_runs` | hazmat |
| `dispatch` | (reads `loads`) | dispatch |
| `messaging` | `message_threads`, `messages`, `message_reports`, `thread_participants`, `notification_events`, `notification_preferences`, `notification_reads` | messages; driver-app messages |
| `driver-app` (server side) | `device_push_tokens`, `driver_app_features`, `driver_app_feature_overrides`, `driver_duty_sessions`, `driver_write_counters` | the driver app |
| `routing` (support) | `geocode_cache`, `route_geometries`, `route_fuel_settings`, `weather_cache`, `fuel_plans`† | fueling |

† Known-dead or near-dead per the 2026-08-26 audit (`ai_verifications` has no code;
`fuel_plans` has one production row ever). Each module's carve-out PR decides build-or-drop;
this matrix records ownership, not endorsement.

This matrix is the **initial assignment**, made from the audit's read of who actually writes
what. A carve-out PR may move a table with a stated reason — what it may not do is leave a table
unowned or co-owned.

## 5. Migration strategy — strangler, not rewrite (D-ARC4)

The 258 migrations and their commit narratives encode incident-bought knowledge (the 46× SQL
inlining regression, the PostgREST `p_org` default, the McLeod batch-settlement timestamps). A
rewrite discards the knowledge and keeps the authors. So:

1. **New code lands inside a module.** A new service file in a flat directory is a review
   rejection once the module skeleton for its area exists.
2. **Old code moves when touched.** Fixing a bug in `services/fuelReconRun.ts` means moving it
   into `fuel-spend` in the same PR, budget permitting.
3. **Active streams carve out first.** Fuel/IFTA is under active development — it proves the
   module rules the way EFS proved the folder shape. Dormant areas move last.
4. **One module per carve-out PR**, and the carve-out PR is where that module's known schema
   defects (§3, §4 daggers) get resolved — not in a separate big-bang schema cleanup.

## 6. Enforcement — what is gated vs. hand-held

| Decision | Gate | Status |
|---|---|---|
| Feature isolation, web + driver | `lint:boundaries` (`check-feature-boundaries.mjs`) | live |
| Hazmat purity | same script | live (gap: `hazmat-placards` unscanned) |
| RLS on every table | `check-rls.mjs` | live |
| Migration numbering | `check-migration-versions.mjs` | live |
| File/function budgets | `lint:filesize` / `lint:funcsize` | live (gap: no `.vue`/`.tsx`/shared coverage) |
| **apps/api module isolation** | extend `check-feature-boundaries.mjs` to `apps/api/src/modules` | **to build — first gate of the carve-out** |
| **Table ownership** (write-site check: only the owner's directory writes its tables) | new script | **to build** |
| **Every table has a producer** (would have caught `financial_entries`, `terminals`) | new script | **to build** |
| Contracts only in `packages/shared` | review discipline | **not gate-backed; hold by hand** |

Until the three "to build" gates exist, D-ARC3 is a reviewer's obligation. Build them early in
the carve-out sequence — this repo's own history (`gates-outrank-the-design-contract`) shows
un-gated contracts rot.

## 7. Related canon

- `docs/SILVICOM-360.md` — what the product is; the feature inventory this architecture serves.
- `docs/MIGRATION-DISCIPLINE.md` — schema change rules (unchanged by this document).
- `docs/DESIGN-SYSTEM-CONTRACT.md` — UI canon (unchanged).
- `docs/plans/mcleod/FINANCIAL-STORE-PLAN.md` — the `financial` core module's build plan.
- Root `CLAUDE.md` — the enforced-rules digest; its `src/features/<name>` rule becomes true for
  `apps/api` only as carve-outs land.
