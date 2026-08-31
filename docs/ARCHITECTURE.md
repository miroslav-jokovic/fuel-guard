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

**Amended 2026-08-27** per `docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md` (decisions
D-SEP1–12): three stale "lives in" paths corrected, two table ownerships transferred to their
measured writers, `manual-uploads` struck as a phantom, and the finance/maintenance modules
added to the matrices. Once `scripts/table-modules.json` lands (program step P0.2), that
manifest — not these tables — is the machine-read source of ownership and layer
(raw|core|derived); these matrices become its rendering.

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
| `efs` | `apps/api/src/modules/efs/` (carved 2026-08-26 — registry, services, SOAP lib, card routes) | EFS SOAP + transaction feed | `efs_transactions`, `efs_processing_runs`, `efs_cards`, `efs_card_mutations`, `efs_card_control_settings`, `efs_card_control_approvers`, `efs_capability_promotions`, `efs_capability_proofs`, `efs_soap_credentials`, `efs_soap_client_certs`, `card_write_counters`, `imports` (transferred 2026-08-27 at the manual-uploads strike-out — its only writers are efs ingest services) |
| `samsara` | `apps/api/src/modules/samsara/` (carved 2026-08-26) | Samsara telematics | `samsara_ifta_fetches`, `samsara_ifta_jurisdiction_miles`, `hos_duty_segments`, `fuel_events` (transferred from `fuel` 2026-08-27 at P1.5 — its only writer is the Samsara webhook, and a collector owns its raw feed). (Corrected 2026-08-26 at the `idle` carve-out: `vehicle_engine_days` and `idle_telemetry_windows` went to `idle`. Corrected again 2026-08-27: `duty_equipment_segments` went to `driver-app` — its only writers are the duty RPCs of 0143, called exclusively from `modules/driver-app/dutySessions.ts`; nothing in `modules/samsara` touches it.) |
| `mcleod` | `apps/api/src/modules/mcleod/` (carved 2026-08-26) | McLeod SQL (via carrier VPN) | `tms_movements`, `mcleod_settlements`, `mcleod_ap_vouchers`, `mcleod_billing`, `load_external_payloads` |
| `psp` | `apps/api/src/modules/psp/` (carved 2026-08-26) | FMCSA PSP via vendor API | `psp_requests`. (`driver_authorizations` transferred to `recruiting` 2026-08-27 — recruiting is its only writer, `modules/recruiting/routes/authorizations.ts`; psp only reads it, `pspOrder.ts:197`.) |
| `hazmat-data` | `packages/hazmat-data`, `packages/hazmat-engine` | Versioned regulatory data | (pure packages, no tables — and gate-enforced to stay that way) |
| ~~`manual-uploads`~~ | — | — | **STRUCK 2026-08-27 (D-SEP12)** — it was a phantom: no `services/import*` ever existed at the carve-outs' end; `imports` is written only by `modules/efs` ingest services (ownership transferred there), and `import_rows` has zero application references (build-or-drop decided in program step P1.9). |
| `posted-prices` | `apps/api/src/modules/posted-prices/` (carved 2026-08-27, program step P1.5) | Pilot/Love's/Kwik Trip/Road Ranger posted fuel prices | `fuel_prices`, `fuel_prices_posted` (both moved with their only writers). Its five `fuel_stations` collector→core writes are pinned by name pending the P6.1 interface pass. |
| `fleetpal` | — not built | FleetPal maintenance | none yet — **watch the double-arrival trap**: McLeod AP already carries maintenance dollars (FINANCIAL-STORE-PLAN records this). Gated 2026-08-27 (D-SEP8): FleetPal may not land its first row before it adopts the `financial_entries` dedup contract written at program step P3.4. |
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
| `org` (identity & platform; carved 2026-08-27, `apps/api/src/modules/org/`) | `organizations`, `memberships`, `invites`, `org_modules`, `org_integrations`, `integration_credentials`, `org_usage_month`, `platform_admins`, `platform_audit_log`, `support_impersonation_grants`, `audit_logs` (append-only), `jobs`, `migration_markers` |
| `roster` (carved 2026-08-27, `apps/api/src/modules/roster/`) | `drivers`, `vehicles`, `trailers`, `driver_vehicle_assignments`, `driver_time_off` |
| `fuel` (carved 2026-08-27, `apps/api/src/modules/fuel/`) | `fuel_transactions`, `fuel_events`, `declined_transactions`, `fuel_cards`, `fuel_stations`, `station_geocode_learned`, `fuel_prices`, `fuel_prices_posted`, `fuel_price_days`, `fuel_discount_rules` |
| `evidence` (carved 2026-08-26, `apps/api/src/modules/evidence/` — first core-store module) | `documents`, `certifications`, `qualification_records`, `dq_exports` — the append-only set pinned in `RETENTION_FORBIDDEN` |
| `loads` (carved 2026-08-27, `apps/api/src/modules/loads/`) | `loads`, `load_stops`, `load_events`, `load_stop_photos` |
| `financial` | `financial_entries` (staging feeds arrive via the `mcleod` collector) |

† resolved: `terminals` was DROPPED at the roster carve-out (0259, 2026-08-27) after measuring zero
rows and zero FK references in production — a future terminals feature recreates it WITH a
producer, an ordering `lint:table-producers` now guarantees.

**The CDL/medical dual-source resolves toward `evidence`** when `roster` and `evidence` are
carved out: `certifications` is what the qualification gate (§391) already reads, so it is the
source of truth; the `drivers.cdl_*`/medical columns become a synced projection or are dropped.
Until that carve-out lands, treat `certifications` as authoritative in new code.

## 4. Harness — the features

Harness modules read core through owners' interfaces, own their feature-specific tables, and map
1:1 with `apps/web/src/features/*` (and `apps/driver/src/features/*`) on the client side.

| Module | Owns | Client feature(s) |
|---|---|---|
| `anomalies` (carved 2026-08-27, `apps/api/src/modules/anomalies/`) | `anomalies`, `anomaly_transitions`, `anomaly_thresholds`, `scoring_attempts`, `case_pattern_reports`, `pattern_sweep_requests` | anomalies, dashboard |
| `fuel-spend` (carved 2026-08-26, `apps/api/src/modules/fuel-spend/`) | `fuel_statements`, `fuel_statement_lines`, `fuel_spend_days`, `fuel_recon_runs`, `fuel_exceptions`, `fuel_exception_events` | reconcile, reports, fuel |
| `ifta` | `apps/api/src/modules/ifta/` (built 2026-08-27, program step P1.10) — serves the 0256/0258 period reads via `/api/ifta/period`; the browser→staging path is closed. The RPCs' own samsara-staging reads remain the tolerated read, grandfathered at the SQL boundary. | ifta |
| `idle` (carved 2026-08-26, `apps/api/src/modules/idle/`) | `idle_events`, `idle_park_sessions`, `idle_rollup_days`, `idle_settings`, `idle_telemetry_windows`, `vehicle_engine_days`, `weather_cache` — sync and rollup deliberately together; the collector/harness seam inside idle runs through shared windows and evidence versions | fleet, dashboard |
| `performance` (carved 2026-08-27, `apps/api/src/modules/performance/`) | `driver_scores`, `driver_performance_weeks`, `driver_performance_settings` | drivers; driver-app score |
| `compliance` (DQF, binders) | (reads `evidence`; folded INTO `evidence` at the carve-out — binder rendering lives at `modules/evidence/dqBinder/`, routes mounted as `complianceRouter`; corrected 2026-08-27, the old `services/dqBinder/` path is dead) | compliance |
| `recruiting` (carved 2026-08-27, `apps/api/src/modules/recruiting/`) | `driver_applications`, `application_drafts`, `application_invitations`, `application_captures`, `applicant_dispositions`, `employer_inquiries`, `driver_employment_history`, `esign_consents`, `sms_consents`, `seven_day_statements`, `driver_authorizations` (transferred from `psp` 2026-08-27 — recruiting is its only writer) | recruitment, apply |
| `hazmat` (carved 2026-08-27, `apps/api/src/modules/hazmat/`) | `hazmat_loads`, `hazmat_documents`, `hazmat_policies`, `hazmat_reviews`, `hazmat_runs` | hazmat |
| `dispatch` | (reads `loads`; carved UNDER `loads` — code lives at `modules/loads/dispatchLoads/`, mounted as `dispatchRouter`; corrected 2026-08-27) | dispatch |
| `messaging` (carved 2026-08-27, `apps/api/src/modules/messaging/` — took `device_push_tokens` from driver-app parking, its writers live here) | `message_threads`, `messages`, `message_reports`, `thread_participants`, `notification_events`, `notification_preferences`, `notification_reads` | messages; driver-app messages |
| `driver-app` (server side; carved 2026-08-27, `apps/api/src/modules/driver-app/`) | `driver_app_features`, `driver_app_feature_overrides`, `driver_duty_sessions`, `driver_write_counters`, `duty_equipment_segments` (transferred from `samsara` 2026-08-27 — written only via the 0143 duty RPCs this module calls) | the driver app |
| `routing` (carved 2026-08-27, `apps/api/src/modules/routing/`, program step P1.7) | `geocode_cache`, `route_geometries`, `route_fuel_settings`, `fuel_plans`† (1 production row measured at the carve-out; the drop is the owner's call — program plan §6 Q8) | fueling |
| `insights` (carved 2026-08-27, `apps/api/src/modules/insights/`) | none — the cross-cutting read-only harness (reports, askData, AI route); owns no tables, writes none; its remaining raw reads are pinned for the P6.1 burn-down | reports, dashboard |
| `accounting` (planned 2026-08-27, D-SEP6/7; program steps P3–P5) | the reporting/config tables it creates (CPM rules, allocation rules) — reads `financial` + `mcleod` through owner interfaces | accounting |
| `billing` (planned 2026-08-27, D-SEP6/7; program steps P3–P5) | the AR/invoice surfaces it creates — reads `financial` + `mcleod_billing` through owner interfaces; projects revenue onto `loads` | billing |
| `maintenance` (built 2026-08-27, D-SEP8; program step P5.3, `apps/api/src/modules/maintenance/`) | `maintenance_inspectors`, `vehicle_inspections`, `vehicle_inspection_items`, `maintenance_print_profiles` — the §396.17 annual inspection (D-S360-6, `docs/plans/maintenance/ANNUAL-INSPECTION-PLAN.md`), its first owned tables. Repair spend still arrives as McLeod AP via `financial` (`category='maintenance'`); `fleetpal` collector later, dedup-gated. ⚠ The inspection feature writes NO table it does not own: the report PDF is filed through `evidence`'s interface, the expiry through `roster`'s (D-AVI10) | maintenance |

† Known-dead or near-dead per the 2026-08-26 audit (`ai_verifications` was dropped at 0260;
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
| **apps/api module isolation** | `check-feature-boundaries.mjs`, armed for `apps/api/src/modules` | live 2026-08-26 — fires on the first carve-out |
| **Table ownership** (write-site freeze: a new writer is a deliberate manifest edit) | `check-table-writers.mjs` + `scripts/table-writers.json` | live 2026-08-26; **collapsing as promised** — the out-of-owner grandfather list went 70 → 63 across Phases 1–6 (P1 moves, P1.4b/P2.5 owner interfaces, P6.1 settings endpoints + one-shot deletions), with the remaining clusters named in the program plan's P6.1 marker |
| **Every table has a producer** (would have caught `financial_entries`, `terminals`) | `check-table-producers.mjs` | live 2026-08-26 (6 waivers after 0259 retired terminals, each naming the plan that owes the producer) |
| Contracts only in `packages/shared` + vendor parsers never in a browser bundle | `check-shared-contracts.mjs` (`lint:shared-contracts`) | live 2026-08-27 (P6.2) — the last hand-held rule is gated; it caught two live name collisions during its own authoring |
| **Table→module→layer manifest** (D-SEP2) | `check-table-modules.mjs` + `scripts/table-modules.json` | live 2026-08-27 (P0.2) — chained onto `lint:table-writers` |
| **Table access respects layers** (D-SEP1) | `check-table-access.mjs` over `.from()` literals, dynamic-`.from()` indirection AND new migration SQL | live 2026-08-27 (P0.3) — chained onto `lint:boundaries` |
| **SECTION_ACCESS matrix ↔ RLS policy role lists in sync** | `lint:section-policies` (`check-section-policies.mjs`) | live 2026-08-27 (P0.4) — chained onto `lint:rls`; route-mount half lands at P4.2 as a runtime test |

All three re-founding gates run in CI since 2026-08-26 (`.github/workflows/ci.yml`), alongside
the three design gates (`lint:codegen`, `lint:token-schema`, `lint:light-dark`) that had existed
since 2026-08-23 without ever being wired in. What remains hand-held is the contracts rule — and
this repo's own history (`gates-outrank-the-design-contract`) says hand-held rules rot, so it is
the natural next gate.

## 7. Related canon

- `docs/SILVICOM-360.md` — what the product is; the feature inventory this architecture serves.
- `docs/MIGRATION-DISCIPLINE.md` — schema change rules (unchanged by this document).
- `docs/DESIGN-SYSTEM-CONTRACT.md` — UI canon (unchanged).
- `docs/plans/mcleod/FINANCIAL-STORE-PLAN.md` — the `financial` core module's build plan.
- `docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md` — the active program (D-SEP1–12) finishing
  the data-layer separation and building `accounting`/`billing`/`maintenance` on it; its §4
  execution protocol governs every step referenced above.
- Root `CLAUDE.md` — the enforced-rules digest; its `src/features/<name>` rule becomes true for
  `apps/api` only as carve-outs land.
