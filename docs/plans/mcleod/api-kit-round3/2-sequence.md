# Round 3 — sequence simulation of the McLeod API Kit build (working notes, incremental)

Repo: /Users/miroslavjokovic/Projects/FG-mcleod-api (branch claude/mcleod-api-kit-build-plan)

## Facts established up front
- origin/main migrations now end at **0639** (0637_ads_outcome_stage_lead, 0638_mcleod_dispatch_order_charges,
  0639_load_charges). The audit's "next free is 0637" (AUDIT §3) is STALE: the first API Kit migration is **0640** at best,
  and parallel chats (ads, load rates) are still taking numbers. Every number below is "≥0640, assign at merge".
- Spec A merges (A §8): S0a, S0b, M-A, C-A1, C-A2, C-A3, S0c, M-K1, C-K2, C-K3, then agent half.
- Open PR #2589 (`claude/tenstreet-ts1-ts3`) already holds **0640_tenstreet_intake.sql** → the API Kit's first
  free number today is **0641**. Numbers in the table are a projection only; each is re-taken at merge.
- origin/main moved past the plan branch's base (`d3fe22918` → `3d0e84b53`): **load rates (LOAD-RATES-PLAN R1–R5)**
  already edits `mirrorLoads.ts`, `dispatchProjection.ts`, `mcleodLoadProjection.ts`, `tmsDispatchMirror.ts`,
  `dispatchMovementIngest.ts`, and plans its own VM update (`LOAD-RATES-VM-UPDATE.md`) and its own required-key flip
  (R5). And **DRIVER-APP-VISUAL-2026-PLAN** (V0–V9, merged 2026-11-20) restyles Loads / Load detail / Stop (V6),
  the same screens as C-A2/C-K3. Neither plan names the other.
- The VM posts only to PRODUCTION (`FUELGUARD_INGEST_URL`); staging has no McLeod feed (B §0 last row, RT-10).
- Driver delivery: OTA + APK lanes deleted 2026-10-22; `driver-store.yml` has NEVER run (its own header lines
  12-15: no EAS project), no `is-ancestor origin/production` step today (grep: none), and every driver workflow
  run ends `action_required` until a human clicks Approve-and-run (memory driver-release-lanes-need-approval).
- `release.yml` rollback "Never reverses a migration" (:15) → every migration below must be safe under the code
  of the release before it (expand first), and a rollback column = "revert code; schema stays".
- File budgets (wc -l now): me.ts 444, DispatchLoadsPage.vue 496, tmsLoadIngest.ts 490, tms.ts 499,
  rosterContract.ts 452, VehiclesPage.vue 447, TrailersPage.vue 441, dutySessions.ts 437, check-in.tsx 438,
  agent.mjs 1,156 (tools/ not scanned), stop/[stopId].tsx 310, driverLoads.ts 301, mirrorLoads.ts 225.
- Files the specs name that do not exist: `apps/api/src/modules/loads/mirrorLoads.test.ts` (AUDIT §2.4 already
  moved those tests to `tmsIngest.dispatchProjection.test.ts`); driver `loadViewModel.test.ts`,
  `loadStatus.test.ts`, `handlers.test.ts` (new files; driver tests live in `apps/driver/tests/` and
  `apps/driver/src/data/policy.test.ts`); outbox/policy live in `apps/driver/src/data/`, not `features/sync`.
  `storageReconcile.ts` is `apps/api/src/modules/org/storageReconcile.ts`. `routes/meLoads.ts` does not exist.
- `driver_complete_stop` is defined in 0087 and 0141 only; `load_stops_seq_check` last set in 0423 (1..50);
  `idx_load_stops_load_seq` unique since 0085:162; `claim_identity_for_office` in 0241/0242;
  `load_stop_eta_predictions` in 0453. No `is_test_org`-style flag exists in any migration.
- Boundaries: both `loads -> mcleod` (:399) and `mcleod -> loads` (:132) are allowed edges today.

---

## 1. The ordered PR table (after AUDIT §2 + COUNCIL §2–§3 applied)

Legend — **Rel**: what must be true before the NEXT dependent step: `stg` = merged and `schema current` on staging;
`prod` = carried by an owner-approved nightly release (01:07 CT Sun–Thu) and `pnpm verify:live` green.
**Ext**: external gate. Migration numbers are projected from 0641 (0640 = PR #2589).

### Track N — no API Kit (can start now)

| # | PR | Files (verified) | Migration | Needs | Gates that bind | Tests (file) | Rel before next | Ext | Rollback (C-22) |
|---|---|---|---|---|---|---|---|---|---|
| N-1 | **B1** one required-photo rule | `packages/shared/src/loadsContract.ts`, `apps/api/src/modules/loads/mirrorLoads.ts:118-120`, `apps/api/src/modules/mcleod/tmsLoadIngestWriters.ts:155-157` | — | — | boundaries, typecheck | `loadsContract.test.ts`, `tmsLoadIngest.test.ts`, `tmsIngest.dispatchProjection.test.ts` | stg (must precede S0b, X-7) | — | revert, no data |
| N-2 | **B2** reference/BOL/unmatched columns | 2 files | **0641** `mcleod_dispatch_stops.reference_numbers` (mcleod) · **0642** `loads.bol_number, external_unmatched`, `load_stops.reference_numbers` (loads) | — | migrations, migration-ordering (merge ALONE), table-modules (2 files), schema-snapshot | `supabase/tests/loads-mcleod-references.test.mjs` | stg (B3/B4/S0a) | — | columns stay; drop ≥1 release after last reader |
| N-3 | **C-23** claim defect, 3 readers (M-D5) | new `packages/shared/src/driverIdentityFields.ts`, `rosterContract.ts` (re-export only; 452), `driverEditMeaning.ts`, `rosterFields.claimParity.test.ts`, trigger migration | **0643** `claim_identity_for_office` `col@source` (roster) | — | production-shape test (`schema-drift-production-shape.test.mjs`), definer grants, filesize | claimParity test, `driverEditMeaning.test.ts`, 0241 trigger matrix | stg | — | migration re-creating 0242's trigger args (no data change) |
| N-4 | **C-16** `linkHiredDriverToTms` + sweep call | new roster export (`apps/api/src/modules/roster/…`), `apps/api/src/modules/mcleod/rosterApplicantHire.ts` | — | N-3 (shared identity helper) | boundaries (`mcleod -> roster` exists), expectOrgScoped | `rosterApplicantHire.test.ts` + "a 360-hired manual row is handed to McLeod…" | prod (only the production sweep exercises it) | — | revert; rows already handed back stay `mcleod` (valid) |
| N-5 | **B3** N6 link-first + `unmatched_assignment` | `entityLookup.ts`(95), `tmsLoadIngest.ts`(490↓), `routes/tmsIngest.ts`(397), `dispatchProjection.ts`, `mirrorLoads.ts`, `shared/dispatchContract.ts`, `dispatchLoads/exceptions.ts`, `mutations.ts`, `LoadExceptionsTable.vue`, `DispatchLoadDetailPage.vue` | — | N-2 stg | table-access, filesize, funcsize, comment-claims | `entityLookup.test.ts`, `dispatchProjection.test.ts`, `dispatchRoutes.test.ts`, new `LoadExceptionsTable.test.ts` | prod | — | revert; `external_unmatched` stays written, unread |
| N-6 | **S0a** stable stop identity (+C-9, C-10) | 1 file | **0644** (loads): `load_stops.mcleod_stop_id`, unique `(load_id, mcleod_stop_id)`, **`mcleod_removed_at`** (C-10), seq check widened to 1..50 ∪ 101..150 (C-9), backfill, `apply_mcleod_load_stops` (column list incl. `reference_numbers`, no exception arm) | **N-2 applied** (RPC writes `load_stops.reference_numbers`) | migrations, table-access (raw-read waiver), definer grants | `supabase/tests/load-stops-mcleod-identity.test.mjs` (+DR-2, DR-5 titles) | stg | — | additive; RPC unused until S0b |
| N-7 | **S0b** projection through the RPC | `mcleodLoadProjection.ts`, `mirrorLoads.ts` (writeStops → rpc), `scripts/table-writers.json`, `routes/tmsIngest.ts` (POST /loads → 410), delete `tmsLoadIngestWriters.writeStops`; **C-10 filter on every `load_stops` reader (11 api files)** | — | N-1, N-6 stg | table-writers/producers, filesize, upserts | `mcleodLoadProjection.test.ts`, `tmsIngest.dispatchProjection.test.ts`, tmsIngest 410 test | **prod** (M-K1 and S0c wait on it) | — | revert code; stop ids written meanwhile stay valid; 410 is one-way only for a connector that stopped posting at LR4 |
| N-8 | **M-A** driver loads SQL (N1+N2+N3+N7 + C-12 + DR-9 + O-5 + C-10 + M-D2 folded) | 1 file + `rls.test.mjs:2246`, `definer-rpc-grants.test.mjs:142`, `load-lifecycle.test.mjs:151`, `loads-mirror-status-guard.test.mjs` | **0645** (loads): `driver_visible_load_ids`, wrapper, 3 policies, drop `auth_dispatched_load_ids`, `assert_driver_load`, **drop 0141 signatures** + `driver_complete_stop` v2, start/accept/decline DL013/14, `load_action_seen`, `driver_acknowledge_load`, `load_events.kind += acknowledged`, `load_stop_photos.sha256` | **N-6 applied** (reads `mcleod_removed_at`) | migrations, rls, definer grants, matrix-exit | new `supabase/tests/driver-load-actions.test.mjs` + the four edited matrices | stg | — | code revert is safe (old API never calls the dropped helper); un-doing the SQL = a new migration |
| N-9 | **C-A1** API + shared + web for M-A | `driverLoads.ts`, `routes/me.ts` (444 → split to new `routes/meLoads.ts`), new `shared/driverLoadPhase.ts`, `loadsLifecycle.ts`, `loadsContract.ts`, `dispatchToDriver.ts`, `useLoadDispatch.ts`, `DispatchLoadDetailPage.vue`, `dispatchContract.ts` (`evidence_after_reassignment`) | — | N-8 stg (function reader) | migration-ordering (function reader one merge later), shared-contracts, record-id, date-format, filesize | `driverLoads.test.ts`, `driverLoadPhase.test.ts`, `useLoadDispatch.test.ts`, `DispatchLoadDetailPage.test.ts` | **prod** (C-A2 store cut needs it, C-11) | — | revert; acks/events written stay valid rows |
| N-10 | **B4** N4a + agent reads `reference_number` | `tmsDispatchMirror.ts` (expand), `mcleodLoadProjection.ts`, `dispatchProjection.ts`, `mirrorLoads.ts`, new `shared/loadMcleodFacts.ts`, `driverLoads.ts`, `dispatchLoads/shared.ts`, `useDispatchLoads.ts`, `DispatchLoadsPage.vue` → new `LoadRefCell.vue`, driver `[id].tsx`, new `StopDetails.tsx`, agent `queries.mjs`/`loads.mjs`/`dryRun.mjs`/`review/build-routine.mjs` + regenerated `SILVICOM-READ-ROUTINE.sql`, new `apps/api/src/scripts/reprojectMcleodMirror.ts` | — | N-2 stg | upserts (mixed-shape 400), shared-contracts, filesize (496→<450), agent tests, `review.test.mjs` | listed in B §3.9 | **prod**, THEN VM update | **Alex** gets the routine before the VM runs it; VM visit | revert API; VM's newer connector keeps posting (stripped) |
| N-11 | **V1** (verification, not a PR) | — | — | N-10 in prod + VM updated | — | prod SQL in B §3.6 | — | dispatcher reads 3 orders | — |
| N-12 | **B5** N4b PU # + required `reference_numbers` | as B §3.4 | — | N-11 passed | shared-contracts | B §3.9 B5 titles | prod | — | revert API; constant change + reproject |
| N-13 | **B6** N8 planned rig | `dutyContract.ts`, new `loads/driverPlannedEquipment.ts`, `dutySessions.ts`(437), `me.ts`, driver `checkInModel.ts`, `check-in.tsx`(438), `startShortcutModel.ts`, `StartDayCard.tsx` | — | — | table-access, filesize | B §5.3 | API: prod · app: **store build** | store lane | revert |
| N-14 | **B7** N9 driver arrival on the board | `loadBoard.ts`, `dispatchBoardContract.ts`, `truckLoadPlanReads.ts`, `DispatchBoardTable.vue`, `DispatchTruckDrawer.vue`, `tutorials/fixtures/endpoints.ts` | — | — | date-format | B §6.3 | **prod** (starts DB7's 14 days, C-18) | — | revert |
| N-15 | **S0c** restore seq check + **re-key 0453 predictions on stop id** (RT-14, §2.14) | 1 migration + `boardEtaRecorder.ts` reader merge | **0646** (loads) | N-7 in prod ≥1 release | migration-ordering (column, then recorder) | identity matrix flip + recorder test | prod | — | migration; old code reads seq, still works |
| N-16 | **C-15** Hire again (360 half) | new `roster/driverReopen.ts`, `reopen_former_driver` RPC, `POST /api/recruitment/drivers/:id/reopen`, `hireApplicant.ts` (`former_driver_exists`), web button | **0647** (roster) | **Owner Q-3** (who may press it) | route-gate ledger (inline gate), boundaries (recruiting → roster), definer grants | `reopen-former-driver.test.mjs`, `driverReopen.test.ts`, `hireApplicant.test.ts` | prod | owner Q-3 | revert; reopened rows are ordinary applicants |
| N-17 | **C-A2** driver app (store build) | driver `loadViewModel.ts`, `loadStatus.ts`, `app/loads/[id].tsx`, `stop/[stopId].tsx`, `useLoads.ts`, `src/data/handlers.ts`, `src/data/policy.ts` (per-LOAD FIFO, C-13), `src/data/outbox.ts`, `FailedSyncList.tsx`, `(tabs)/loads.tsx`, `loadRows.tsx`, `UpNext.tsx` | — | N-9 **in prod** | C-11 defaults; native-android not triggered | `policy.test.ts`, new driver tests | **store release** (Play internal / TestFlight, promoted) | RELEASE-GATE P2.3, Apple Organization, Approve-and-run, `driver-store.yml` C-11 step | no rollback: forward-fix only; app must tolerate older API (C-11) |
| N-18 | **C-A3** action id required | contract | — | measured adoption (DR-19) | — | — | — | — | drop or keep optional |

### Track M — messages and rulings (no code; start day 1, they gate everything in Track T)

| # | Item | Content (source) | Unblocks |
|---|---|---|---|
| M-1 | ONE message to McLeod via Ron | E1–E9 (C §3.1) + 3-ops 15-item list + licence seat / call-volume charge (RT-24) + `clearStop` second-call / departure-only / non-next-stop behaviour (W12) | T-6 Configure, U1–U17 |
| M-2 | ONE message to Alex | writes OK (A1), 443 to `/ws` (A2), secret entry (A3), the five kill switches with his two (OPS-3), C-19 business effects + undo rehearsal, test-company read lane (C-13), `/ws` call volume (RT-24), the B4 routine **and the load-rates R4 routine** (see SEQ-5), finance follow-up Part 4 `drs_check`/`gl_summary` (§2.12) | T-6, T-11 P-run, N-10 VM, D-10 |
| M-3 | Owner rulings | Q-1 (O-2a create carries name/DOB/CDL once), Q-2 (service-failure records), Q-3 (recruiter Hire again), Q-4 (O-7 sentence) | D-6/D-7 (create/reactivate on), N-16, T-12 scope |

### Track T — transport and the write pipeline (Spec C as corrected by AUDIT §2.1/2.3/2.7 + COUNCIL)

| # | PR | Files | Migration | Needs | Gates | Tests | Rel | Ext | Rollback |
|---|---|---|---|---|---|---|---|---|---|
| T-1 | MK0 tables + agent-facing read routes | `shared/mcleodApi.ts` (new; tms.ts 499 untouched), `modules/mcleod/mcleodApi/{discovery,health,parity}.ts`, `routes/tmsMcleodApi.ts` (registered in `routes/tmsIngest.ts`), manifests | **0648** (mcleod): `mcleod_api_capabilities` (**org-scoped, one row per operation, `fields jsonb`** — RT-13), `mcleod_api_agent_status`, `mcleod_api_discoveries`, `mcleod_api_parity_runs` | — | rls, table-modules/writers/producers/lifecycle, RETENTION_RULES for parity, schema-snapshot, 12 MB body limit on discovery | `tmsMcleodApi.test.ts`, rls seeds | **prod** (the VM posts only to production) | — | revert; rows stay, unread |
| T-2 | Agent `/ws` client + VM ops (C-21, C-8, RT-9) | `tools/mcleod-agent/mcleodApi.mjs`, `apiDiscover.mjs`, `agent.mjs` (move `fetchFromMcleod`), `windows/set-mcleod-api.ps1`, **new `windows/register-connector-task.ps1`**, `windows/update-connector.ps1` (env-line adds + `$bad` regex, OPS-5), `windows/manifest.mjs`, `scripts/check-agent-syntax.mjs`, **new C-8 repo gate + `ci.yml` step**, public test cert only | — | T-1 in prod (discovery posts) | agent-syntax, gitleaks, new lint in ci.yml | `mcleodApi.test.mjs`, `apiDiscover.test.mjs`, `set-mcleod-api.test.ps1`, `review.test.mjs` manifest rule | prod, then **VM visit #2** (code, all off) | Alex RDP | `update-connector.ps1 -Commit <previous>` |
| T-3 | Write-scoped credential (C-7) | `issueMcleodToken.ts --scope=writes`, new middleware on claim/settle (egress IP from SSM `MCLEOD_AGENT_EGRESS_IP`, own limiter) | **0649** (mcleod): write-token hash table | — | rls, table-*, route gate | middleware tests | prod | SSM param on AWS | revert; token row inert |
| T-4 | Pipeline migration (council final DDL + RT-20 origins + RT-21 lease) | 1 file + `rls.test.mjs` seeds, `dataRetentionForbidden.ts` (+3), `table-modules.json` | **0650** (mcleod): `mcleod_write_requests/events/switches`, `mcleod_write_state` view, `claim/begin_send/settle/prove/retry`, switch-proof triggers; **`driver_complete_stop` v3** (subtransaction enqueue C-5, plausible time C-6, O-5 flag, already-`D` → no request, DR-8) | **N-8 applied** (v2 body), **N-6** (mcleod_stop_id) | rls, RETENTION_FORBIDDEN, table-lifecycle budgets, driver-references (`driver_id` no FK), definer grants; cross-module waiver (loads function in an mcleod migration) | `supabase/tests/mcleod-write-queue.test.mjs` (council pg/t1–t3 scenarios), `mcleod-write-requests.test.mjs` (A §6.7) | stg | — | additive; switches default off; code revert leaves rows readable |
| T-5 | Write API + monitoring + office UI | `routes/tmsMcleodApi.ts` (claim/begin_send/settle), `/api/integrations/mcleod/…` office routes (RT-16: inline gates, no ledger entry), `mcleodApi/writeQueue.ts`, `writeSwitches.ts`, `writeWatch.ts` (grouped alerts, C-20) + `schedulers.ts` entry, `envCollectors.ts` L1, `driverLoads.ts` passes `p_mcleod_write`, `/me/loads` reads `mcleod_write_state` (C-14 chunked), web `McleodApiHealthLine.vue`, `McleodWriteSwitches.vue`, `StopMcleodWriteBadge.vue`, `McleodFleetsSettingsPage.vue`(146) | — | T-4 stg, T-3 | route-gate ledger test, WORKER-DEPLOYMENT scheduler row, expectOrgScoped | `tmsMcleodApi.test.ts`, `writeWatch.test.ts`, `writeSwitches.test.ts`, web tests | **prod** | AWS env L1 | switch row `off` (≤1 claim cycle); revert code |
| T-6 | VM: Configure + Discovery Phase A | (operation, `set-mcleod-api.ps1 -Configure`) | — | T-1, T-2 in prod + VM | — | — | — | **M-1 answered (E1–E4), M-2 (A2, A3)**, McLeod enables `/ws` | remove lines |
| T-7 | Docs parser + Phase B + `wsSurface.mjs` | agent `docsParser.mjs`, `pnpm mcleod:ws-docs-fixtures`, fixtures (McLeod docs, public repo?) | — | T-6 report exists | **C-8 gate vs committing McLeod docs** (SEQ-11) | parser tests | prod + VM | VM visit | revert |
| T-8 | Agent write loop | `writeLoop.mjs`, `writeAdapters.mjs` (fmt with offset, RT-22; refuse until date setting known, C-6), `--api-prove`, `fakeMcleod.mjs`, per-movement order (DR-9.3), `max=1` in canary + `allowed_next` (OPS-9), logout in login mode | — | T-5 in prod, T-2 | agent tests, manifest | `writeLoop.test.mjs`, `writeAdapters.test.mjs` | prod + **VM visit** (writes still off) | — | VM previous commit |
| T-9 | Parity job + verdict | `apiParity.mjs`, verdict route | — | T-6 U1 = present | — | `apiParity.test.mjs` | prod + VM | — | `MCLEOD_API_FEED` line off |
| T-10 | Test-company lane (C-13) | agent second parameter set + second token; **production test org + `is_test_org` exclusion everywhere** | **org-module migration (unspecified)** | M-2 OK, E5 answered | — | — | prod + VM | Alex | — |
| T-11 | Proving run P1–P6 (test company) | operation | — | T-8 VM, T-10 or prove-only, U9–U12 resolved, **C-19 Alex list + undo rehearsal** | — | P-report row | — | Alex A1 | switch off |
| T-12 | Canary → live (stop_clear) | switch rows only | — | T-11 confirmed, N-17 in drivers' hands, Q-2 | owner S1 | — | — | owner | switch `off` |

### Track D — documents, office writes, finance, ETA, home time (Spec D as corrected)

| # | PR | Files | Migration | Needs | Gates | Tests | Rel | Ext | Rollback |
|---|---|---|---|---|---|---|---|---|---|
| D-1 | MK4 tables | 1 file; `org/storageReconcile.ts` registration of `mcleod-outbound` (RT-17); `dataRetentionForbidden.ts` | **0651** (mcleod): `mcleod_image_categories`, `mcleod_image_kind_map`, `mcleod_image_sends` (+ partial unique `(org_id, stop_id, kind)`, §2.11), bucket, `mcleod_enqueue_image_send` (inserts a T-4 request, origin `sweep`) | **T-4 applied** | rls, table-*, RETENTION_FORBIDDEN, definer grants | `supabase/tests/mcleod-images.test.mjs` | stg | — | additive |
| D-2 | M-D3 lumper kind | 1 file | **0652** (mcleod) `lumper_case_files.kind += lumper_receipt` (+`source` only if LRC has not) | — | migration-ordering (before receipt UI) | matrix | stg | LRC build owner | additive |
| D-3 | MK4 API | new `modules/mcleod/images/{candidates,assemble,enqueue}.ts`, new `loads/stopPapers.ts` export, `routes/tmsImages.ts`, office "Send again" on `/api/integrations/mcleod`, `schedulers.ts`, new `shared/mcleodImagesContract.ts` | — | D-1 stg, T-5 | boundaries (`mcleod -> loads`), expectOrgScoped, scheduler single-process | `images/*.test.ts`, `mcleodImagesContract.test.ts` | prod | — | kind switch off |
| D-4 | MK4 agent | `tools/mcleod-agent/images.mjs`, `lumper.mjs` (echo skip, OF-9), filed rule (OF-8), path allowlist lines | — | D-3 prod, MK0 image probes | agent tests | `images.test.mjs`, `lumper.test.mjs` | prod + **VM visit** | Alex RDP | VM previous commit |
| D-5 | MK4 UI | contract fields (`loadsContract.ts` 218) then `detail.ts` reader (two merges), category card | — | D-3 | migration-ordering (contract→reader) | web tests | prod | — | revert |
| D-6 | MK5 base | agent `writes/rowMap.mjs`, `rowUpdate.mjs`; office routes on `/api/integrations/mcleod` (not `/api/mcleod`, RT-16); `M-D4a` options table; `M-D4b` `reason_for_leaving` (**3-char code**, OF-7) + `can_rehire` | **0653** (mcleod) · **0654** (roster) | T-5, ROW_UPDATE_MODE probe | migration-ordering (0654 column → reader next merge), route-gate ledger | `rowMap.test.mjs` (SSN strip, C-8), route tests | prod + VM | — | switches off |
| D-7 | Create / reactivate | `writes/driverCreate.ts`, `driverReactivate.ts` (C-15.4/5), agent `writes/driverCreate.mjs` | — | D-6, N-16, N-4 | OF-19 gates | `driverReactivate.test.ts`, `driverCreate.test.mjs` | prod + VM | **Q-1, Q-4 (O-7 sentence)**; switch stays `off` until then | switch off |
| D-8 | Unit status | new `shared/mcleodUnitStatus.ts` (NOT tms.ts 499), new `web/features/roster/UnitStatusMcleod.vue` (Vehicles 447 / Trailers 441), routes | — | D-6, MK0 sub-status key probe (OF-5) | vehicle-status, filesize | inverse-table test, form tests | prod + VM | — | switch off |
| D-9 | Driver fields, medical, CDL | routes, `DriverForm.vue`, `MedicalTab.vue` | — | D-6, **N-3** (claim helper) | route-gate | as D MK5.4/5.5 | prod + VM | — | switch off |
| D-10 | MK2 finance | `review/SILVICOM-GRANTS.sql`, agent `financeCompare.mjs`, `--allow-copy` guard, M-D7 `mcleod_fuel_purchases` + `tmsFinancial.ts` ingest + RETENTION_FORBIDDEN; M-D6 only if needed | **0655** (mcleod) [+ financial] | — | table-*, upserts (set-based RPC) | `financeCompare.test.mjs`, ingest tests | prod + VM | **Alex grants** (M-2 §2.12) | `FINANCE_FEED` off; rows are books (forbidden) |
| D-11 | DB7 run (analysis, not code) | DISPATCH-BOARD-PLAN log | — | N-14 in prod + 14 days | — | — | — | — | — |
| D-12 | ETA write | `writes/etaWrite.ts`, `loads` export `latestStopPredictions` (by **stop id**), agent callin/stop adapter | **0656** `mcleod_eta_holds` | D-11 pass, **N-15 re-key**, MK0 path probe, OF-15 Alex customer-message confirmation | scheduler single-process | as D MK6.1 | prod + VM | Alex | env 0 / switch off |
| D-13 | Home time | agent `oneoff/homeTimeProbe.mjs` (needs T-6), writer, roster export `homeTimeChangesSince`, ingest (contract first) | **0657** `mcleod_home_time_map` (H1 only) | 14-day probe, TableRowService `equipstatus` probe (OF-17) | — | — | prod + VM | — | switch off |

---

## 2. Findings

### SEQ-1 [BLOCKER] The migration numbers in every layer are already taken
- Evidence: `git ls-tree origin/main supabase/migrations` ends `0637_ads_outcome_stage_lead`, `0638_mcleod_dispatch_order_charges`,
  `0639_load_charges`; open PR #2589 adds `0640_tenstreet_intake.sql`. AUDIT §3 "the next free number is 0637",
  B §0 "0637 and 0638", C §2 "0637 today" are stale.
- Fix: v2 names migrations by role only (M-B2a, M-S0a, …) and states "number = main's newest + 1 at merge, re-checked
  before push"; the table above projects 0641–0657 for ordering only. The ORDER that matters is relative:
  B2 < S0a < M-A < T-4 < D-1 (each later function body references a column/table of the earlier one).

### SEQ-2 [BLOCKER] Every driver-side benefit waits on a store lane that has never run, and no PR owns it
- Evidence: `driver-store.yml:12-15` "NOTHING BELOW HAS EVER RUN. There is no EAS project yet"; no `is-ancestor` step
  in the file (grep); driver workflows end `action_required` until a human clicks Approve-and-run (memory); council
  DR-3 (Apple account Individual = "the open launch blocker", RELEASE-GATE.md:132).
- Affected: N-17 (C-A2: N1/N2/N3/N7, C-12, C-13), N-13's app half (B6), N-10's driver rows (B4), C-K3, M-D2's sha256
  (app must send it), and — through T-12's proof rule ("live needs a confirmed `driver_app` request under canary") —
  **the McLeod stop write itself**: no installed app ⇒ no driver_app request ⇒ `live` can never be proven.
- Fix: v2 adds a Store track as PRs with owners: S-1 `driver-store.yml` gains the C-11 `is-ancestor origin/production`
  step + RELEASE-GATE text (workflow file, own PR); S-2 owner P2.3 (EAS project, keystore, APNs, ASC) + Apple
  Organization conversion; S-3 first `driver-v1.0.0-rc.1` tag cut from a production commit carrying C-A1; S-4 Play
  internal/TestFlight promotion and install on the pilot drivers' phones. State it as the critical path (below).

### SEQ-3 [CONFLICT] `driver_complete_stop` is rewritten by three migrations in three specs
- Evidence: defined today in 0087 and 0141; M-A (A §3.1, + C-12, DR-9, O-5 predicate, C-10), the pipeline migration
  (council "driver_complete_stop(…) enqueue", C-5/C-6/DR-8) and M-D2 (D Appendix A: "stores sha256") each
  `create or replace` its whole body. A migration written from an older body silently drops the newer behaviour; DR-9
  ("Complete carries its arrival") adds parameters, i.e. a second signature change after M-A's (PGRST203 risk,
  AUDIT §2.4).
- Fix: (1) fold M-D2's sha256 column + insert into M-A (M-A already rewrites the photo insert for C-12; same module
  `loads`); (2) put EVERY new parameter (`p_action_id`, `p_mcleod_write`, `p_arrived_at`, `p_arrive_action_id`) into
  M-A's one drop-and-create, so T-4 is a same-signature `create or replace`; (3) T-4's body is written from M-A's,
  and its PR body says so; (4) the three matrices that pin the behaviours (`driver-load-actions`, `mcleod-write-queue`,
  `mcleod-images`) all run in `pnpm test`, so a dropped behaviour turns a named test red — keep that, no new gate.
  T-4 also needs a `-- cross-module-waiver:` line (it inserts into `mcleod_write_requests` from a `loads` function;
  `check-table-modules.mjs:181-184` counts DML in bodies).

### SEQ-4 [GAP] Nothing that talks to McLeod can be tested on staging; every agent-facing change costs a release
- Evidence: RT-10; the VM posts only to production; staging has no McLeod feed (B §0). Production moves only at an
  owner-approved nightly release (Sun–Thu, `release.yml:8-11`).
- Counted round trips (release + RDP visit) before the first live stop write: N-10 (B4 connector), T-2 (client, all
  off), T-6 (configure + Phase A), T-7 (Phase B), T-8 (write loop), T-9 (parity on), T-11 (P-run fixes, ≥1 more if a
  probe changes an adapter). **≥ 7 release+VM cycles**, plus D-4/D-6/D-7/D-8/D-9/D-12/D-13 each adding one.
- Also impossible as written: A §1.2 S0 staging check ("wait for two sweeps") and A §9 N2 ("staging test driver in
  McLeod as driver of a P movement") — staging has no sweep. Use B's recipe: post the fixture twice with a staging
  ingest token (`issueMcleodToken.ts`).
- Fix: v2's rollout table gets two columns: "release #" and "VM visit #", and batches agent changes so one VM visit
  carries several (see SEQ-5). Decide in v2 whether agent-facing API fixes during the P-run may use `release.yml`
  hotfix mode (needs the owner's standing OK, RT-10) — recommend yes, only for `/api/tms/mcleod-api/*`.

### SEQ-5 [CONFLICT] Load rates (on main now) and B4/B5 change the same connector, the same contract and the same VM, with opposite Alex rules
- Evidence: origin/main d5fbf58ac/1ba3d45af edit `tmsDispatchMirror.ts`, `mcleodLoadProjection.ts`, `dispatchProjection.ts`,
  `mirrorLoads.ts`, `dispatchMovementIngest.ts`; LOAD-RATES-PLAN R4 edits `queries.mjs`, `loads.mjs`,
  `SILVICOM-READ-ROUTINE.sql`, regenerates the manifest; R5 flips its keys to required after the VM — the same
  expand/contract as B4/B5. LOAD-RATES-PLAN:8-10 "No request to Alex … deliberately sets aside the review step";
  B §3.3 "the changed routine reaches him before the VM runs it". `update-connector.ps1` installs ONE pinned commit.
- Consequences: whichever VM update runs second also installs the other's agent code; if R4's update runs first,
  B4 needs a second visit; if B4's routine goes to Alex, it carries R4's statement too (same routine file), so R4's
  "no Alex" ruling is overturned in practice.
- Fix: v2 states one connector release: `R4 + B4 + T-2 (all lines off)` in ONE commit, ONE Alex message (routine
  + `/ws` items + finance), ONE VM visit; R5 and B5 flip required in one PR after V1. S0b rebases over R2's
  `applyMirroredCharges` in `mirrorLoads.ts` (textual, not semantic).

### SEQ-6 [CONFLICT] The driver visual plan (V0–V9, merged 2026-11-20) restyles the screens C-A2 rewrites
- Evidence: DRIVER-APP-VISUAL-2026-PLAN V5 Today, V6 "Loads, Load detail, Stop", V3/V9 native runtime bumps; C-A2
  edits `app/loads/[id].tsx` (262), `stop/[stopId].tsx` (310), `(tabs)/loads.tsx`, `loadRows.tsx`, `UpNext.tsx`,
  `TodayHero` (A §3.6). Neither plan names the other; both ship only through the one store lane.
- Fix: v2 orders them: C-A2 (behaviour, phase model, footer actions) merges first; V6 restyles on top; the first store
  build carries both or C-A2 alone (C-11: "the first store release must include C-A2"). Record in both plans.

### SEQ-7 [GAP] Ordering inside S0 that no spec writes down
- S0a's RPC writes `load_stops.reference_numbers` (AUDIT §2.4) → B2 must be APPLIED first (a `language sql` body is
  validated at create; plpgsql fails at first call). B1 must merge before S0b (X-7; S0b deletes
  `tmsLoadIngestWriters.writeStops`, which B1 edits). M-A reads `mcleod_removed_at` (C-10) → S0a before M-A.
- C-10 soft-remove: the column lands in S0a, the RPC starts stamping it the moment S0b calls the RPC, so S0b MUST
  also add the `mcleod_removed_at is null` filter to every `load_stops` reader (11 `apps/api/src` files with
  `.from("load_stops")`, plus the driver visibility path and the board). No spec lists those files. Without it a
  removed stop shows to driver and office as a pending stop.
- Rollback trap: reverting S0b after it stamped rows leaves soft-removed stops visible to the old readers; and after
  S0c, production can never roll back past S0b (old `onConflict: "load_id,seq"`), because `release.yml` never reverses
  a migration. v2 must state both.

### SEQ-8 [GAP] The test-company read lane (C-13) needs a production "test org" that nothing defines
- Evidence: no `is_test_org` (or equivalent) in any migration; C-13 / RT-10 require the test org to be excluded from
  "every report, census and billing count"; the agent has one company and one `FUELGUARD_INGEST_TOKEN`; whether the
  test company lives in the `lme` database the SQL login reads is E5, unanswered.
- The switch proofs do not need it: `canary` is proven by a confirmed `prove` request (no load), `live` by a confirmed
  `driver_app` request under `canary` on the LIVE company (council triggers). The lane only adds an end-to-end
  driver_app rehearsal on the test company.
- Fix (recommend): drop T-10 from the first release; prove with `prove` requests (T-11) and canary on a non-EDI test
  customer in the live company (C-19). If kept, v2 must specify the org flag migration (org module), every reader
  that excludes it, and the agent's second token — none exist today.

### SEQ-9 [GAP] The ETA re-key (council §2.14) has no PR, and the ETA write needs it
- Evidence: `load_stop_eta_predictions` keyed `(org_id, load_id, stop_seq)` (0453); RT-14: after S0 two stops can share
  a seq; D-12 reads `latestStopPredictions` and maps to `mcleod_stop_id`.
- Fix: N-15 (S0c) takes it — either renumber removed-but-worked stops so `seq` stays unique (RT-14's recommendation;
  then no re-key) or add `stop_id` to predictions (column merge, then `boardEtaRecorder.ts` merge). v2 picks one.
  With C-9's scratch band, S0c no longer has an exception arm to remove; its remaining job is exactly this.

### SEQ-10 [GAP] Rollback per PR (C-22) exists only in spec B
- Evidence: B §8 has rollback; A, C, D have none per PR (C §5.9 is the emergency stop, not a rollback).
- Fix: the "Rollback" column in the tables above, with these load-bearing lines v2 must copy: a McLeod write already
  applied has no undo except a person in McLeod (RT-23c) — so operations go live cheapest-to-undo first (C-19 order);
  a store app cannot be rolled back, so the app tolerates an older API (C-11 defaults) and C-A3 is dropped; a
  migration is never reversed by `release.yml` — undoing T-4's `driver_complete_stop` v3 is a NEW migration
  re-creating M-A's body; the VM rolls back with `update-connector.ps1 -Commit <previous>` after renaming the newest
  backup folder (LOAD-RATES-VM-UPDATE D1).

### SEQ-11 [CONFLICT] C-8's new gate forbids committing McLeod docs; spec C's Phase B commits them
- Evidence: C §3.5 `pnpm mcleod:ws-docs-fixtures` "writes them under `tools/mcleod-agent/fixtures/ws-docs/`"; C §6
  ships `fixtures/ws-docs.json` to the VM; AUDIT §2.7 "McLeod's crawled docs are never committed"; C-8 "a new gate
  refuses any committed … McLeod doc".
- Fix: T-7's parser tests use hand-written minimal stubs; the real pages stay in `mcleod_api_discoveries.docs_gz`
  (production) and Phase B parses them there; C §6's fixture manifest line is deleted.

### SEQ-12 [GAP] Tests the council added that no PR owns
Assign in v2: DR-4 "a load from an API without source/acknowledged_at still parses" → N-9 (shared);
DR-9/DR-10 `policy.test.ts` titles ("waits while an older record of the same load is unfinished", "never
dead-lettered by timeouts") → N-17; DR-2/DR-5 identity titles → N-6; DR-7/DR-8/C-12 matrix titles → N-8 and T-4;
C-6 plausible-time + C-5 `enqueue_failed` titles → T-4; RT-22 DST/`+` offset titles → T-8; OPS-5 "every file a
test opens is in the manifest" (`review.test.mjs`) → T-2; C-8 gate self-test → T-2; C-20 "two connectors claim"
alert → T-5; RT-17 bucket registered with storageReconcile → D-1; OF-9 lumper echo → D-4; OF-10 "same photos ⇒
same sha256" → D-3; RT-13 paged-reader tests (capabilities, parity, candidates) → T-1/D-3; C-14 window test → N-9.

### SEQ-13 [GAP] Spec A's MK3 merges (M-K1, C-K2, C-K3) are superseded but their parts are not re-homed
- A's `mcleod_write_outcomes`, `/api/tms/writes`, `MCLEOD_WRITE_COMPANIES` are replaced by T-4/T-5 (AUDIT §2.1,
  council final DDL). Still needed from A and placed nowhere else: the office "Write again" / "Keep McLeod's" routes
  (A §6.4 put them in `loads/routes/dispatch.ts`; RT-16 puts office routes under `/api/integrations/mcleod`) — pick
  one; the driver-side `McleodWriteIssues.tsx` (C-K3, store lane) excluding `already_in_mcleod` (DR-8).
- Fix: T-5 owns the office routes (mcleod module, `mcleod_write_retry`), with `keep-mcleod` writing its `load_events`
  row through a loads export; C-K3 joins the store build after N-17.

### SEQ-14 [CONFLICT] One exception kind, two names, four writers of `EXCEPTION_KINDS`
- `shared/dispatchContract.ts` (128 lines) gains `unmatched_assignment` (B3), `evidence_after_reassignment` (DR-7)
  — RT-18 calls the same kind `late_evidence` — plus the write `refused/conflict` feed (T-5) and removed-stop evidence
  (C-10). Fix: v2 names it once (`evidence_after_reassignment`), lists all four in one table, and lands them in
  merge order (B3 → N-9 → T-5); `exceptions.ts` (166) stays under budget.

### SEQ-15 [CONFLICT] File budgets collide across plans
- `me.ts` 444: C-A1 +~15 (ack route), B6 +~10 (planned read with its catch) → 469 (warn band). Spec A splits to
  `routes/meLoads.ts` only "if it would cross 500". Fix: C-A1 (first to touch) creates `routes/meLoads.ts`.
- `DispatchLoadsPage.vue` 496: B4 extracts `LoadRefCell.vue`; load rates R3 adds rate columns to the Loads page. If
  R3 lands first it must do the extraction (or move to a component), else `lint:filesize` fails at 500.
- `tms.ts` 499: D MK5.3 puts `MCLEOD_UNIT_STATUS_REQUESTS` in it — moved to new `mcleodUnitStatus.ts` (OF-21), as the
  D-8 row says.

### SEQ-16 [GAP] Several "independent" B steps change nothing a user sees until drivers use the app
- B7 (driver arrival on the board) shows only taps that exist; today no driver uses the app (council 2-driver:63).
  B6's pin is in the driver app. B4/B5's driver rows likewise. Their API halves are harmless to ship early, but v2
  must not list them as office benefits; and DB7's window (C-18, "starts at B7's release") measures nothing new
  until taps exist — state that the ETA write therefore waits for the store lane too.

### SEQ-17 [GAP] MK4 BOL/POD waits on three things v2 lists separately
- BOL/POD photos exist only from installed apps (SEQ-2); C-17 needs the scanner attached to stops (BOL plan Step 0.0 /
  scanner Step 6.2 — another programme) or a 14-day billing trial; sha256 dedupe needs the app to send hashes.
  Revised RC + lumper receipts (office uploads) need none of these. Fix: v2's MK4 rollout says office papers first
  (D-1…D-4), BOL/POD after S-4 + C-17.

### SEQ-18 [GAP] Schedulers: four new ones, two vocabularies
- `mcleod-write-watch` (lane `general`), `mcleodImageSend` ("lane = the one `api`"), `mcleodEtaWrite`,
  `mcleodHomeTimeWrite`. CLAUDE.md: a scheduler runs in exactly one process fleet-wide. Fix: each gets a
  `docs/WORKER-DEPLOYMENT.md` row in its PR (T-5, D-3, D-12, D-13) using the lane/lease vocabulary only.

### SEQ-19 [GAP] L1 (`MCLEOD_WRITES`) is an AWS SSM parameter plus a restart, and no PR names it
- OPS-3; memory "NEVER Railway — AWS only". Spec A says "documented beside RUN_SCHEDULERS_IN_PROCESS", spec C
  "Railway/AWS variable". Fix: T-5 names the SSM parameter, the services that must restart (every one serving
  `/api/me` and `/api/tms`), and the `docs/DEPLOYMENT.md` line; T-3 likewise for `MCLEOD_AGENT_EGRESS_IP`.

### SEQ-20 [OK] Agent and API ordering — API first, agent second, contract third
- Every agent change is preceded by its API in production: new keys are optional on the wire until the VM is
  verified (B4/R2 pattern), claim passes `kinds[]` = the adapters the agent has, so the API may register kinds
  first. A switch row comes last. An API rollback past T-5 while the VM runs T-8 makes claim 404 — requests stay
  queued, nothing is written (safe). An API rollback past B4 while the VM posts `reference_numbers` strips the key
  (zod non-strict object) — safe. The VM update path is: release in production → Claude fills commit sha + script
  sha → Alex/Miki RDP `update-connector.ps1 -Commit <sha>` (tests run on the VM, then restart, then log check whose
  `$bad` regex T-2 extends).

### SEQ-21 [OK] No dependency cycle
- Checked: N-8 → N-9 → N-17 → T-12 and T-4 → T-5 → T-8 → T-11 → T-12 meet only at T-12; D-7 waits on rulings, not on
  its own outputs; B5 waits on V1, which waits on B4's VM update, which waits on B4 in production — linear.
  The only near-cycle is SEQ-2's: "live needs a confirmed driver_app request" while "drivers get the app only via
  the store" — linear, but it puts the store lane on the McLeod write's critical path.

### SEQ-22 [GAP] C-A3 has no safe moment
- DR-19: with store-only delivery a pre-C-A2 build can stay installed indefinitely; making `action_id` required
  dead-letters its actions. Fix: drop N-18 from v2 (keep `.optional()`), or gate it on a measured "every active
  device reports app_version ≥ C-A2" query written in the step.

---

## 3. Critical path, earliest benefit, and what runs in parallel

**Critical path to the headline result (a driver's Complete clears the stop in McLeod, live):**

```
Day 0  M-1 (McLeod) + M-2 (Alex) sent; M-3 owner rulings asked
       └─ McLeod enables /ws on 22.1 (or 26.x upgrade — U1, unbounded) ─┐
       └─ Store lane: P2.3 + Apple Organization (owner, unbounded) ─────┼─┐
Code (parallel, dark):  B2 → S0a → M-A → C-A1 [prod]                   │ │
                        T-1 → T-2 [prod, VM#1 all off] ; T-3, T-4 → T-5 [prod] ; T-8 code
       ┌────────────────────────────────────────────────────────────────┘ │
       T-6 VM configure + Phase A → T-7 Phase B [rel+VM] → U9–U12 resolved │
       → T-8 final [rel+VM] → C-19 (Alex list + undo rehearsal) → T-11 P-run │
       ┌──────────────────────────────────────────────────────────────────┘
       N-17 C-A2 store build (cut from production) → installed on pilot phones
       → T-12 canary (non-EDI test customer, owner S1) → live pickups → non-EDI deliveries → EDI
```
The path is the LONGER of two external waits — McLeod's enablement and the first store release — plus ≥ 4 release+VM
cycles after enablement and one canary week. Nothing we build shortens either wait; v2 should ask for both on day 0.

**Earliest point each benefit reaches users:**

| Benefit | Earliest | Gate |
|---|---|---|
| Phone edits stop freezing McLeod-linked drivers (C-23) | 1st release after N-3 | none |
| 360-hired drivers hand-entered in McLeod get linked and refreshed (C-16) | 1st release after N-4 | none |
| Office sees unmatched McLeod truck/trailer/driver codes (B3) | 2nd release (B2 then B3) | none |
| BOL #, customer, weight, pieces on Loads / load page (B4) | 2nd release | none (web half) |
| PU # (B5) | after VM update + V1 + dispatcher check | Alex (routine), VM visit |
| Finance on live `lme` (MK2) | after Alex grants + compare run + VM switch | Alex |
| Office papers (revised RC, lumper receipt) filed to McLeod (MK4 part 1) | after T-4/T-5/D-1…D-4 + MK0 image probes + switch | McLeod `/ws`, VM |
| Truck/trailer status, medical/CDL, driver fields into McLeod (MK5) | after MK0 probes per operation + test-company pass | McLeod, VM |
| Drivers see dispatched loads, Got it, offline-safe actions (N1–N3, N7) | first store release carrying C-A2 | store lane |
| Stop times into McLeod (MK3) | after both external waits + P-run + canary | McLeod, Alex, store, owner S1 |
| New hire → McLeod create / reactivate | after Q-1 + Q-4 + MK0 create probe | owner |
| ETA into McLeod | after store lane + B7 + 14 days DB7 pass + re-key + probe + OF-15 | owner, Alex |

**Proceeds while waiting on Alex / McLeod / the owner (all ship dark or are 360-only):** N-1…N-9, N-13 (API half),
N-14, N-15, N-16 (after Q-3); T-1, T-2 (code), T-3, T-4, T-5, T-8 against `fakeMcleod.mjs`; D-1, D-2, D-3, D-5, D-6
code; D-10 compare code; S-1 (`driver-store.yml` step); C-A2 code (merge, but tag the store build only from
production). Waiting only on externals: T-6 onward, N-10's VM half, V1/B5, D-4, D-7 switch, D-10 switch, D-12, D-13.

---

## 4. Summary

22 findings: **BLOCKER 2** (SEQ-1, SEQ-2) · **CONFLICT 6** (SEQ-3, SEQ-5, SEQ-6, SEQ-11, SEQ-14, SEQ-15) ·
**GAP 12** (SEQ-4, 7, 8, 9, 10, 12, 13, 16, 17, 18, 19, 22) · **OK 2** (SEQ-20, SEQ-21).
The build is 18 Track-N steps, 12 Track-T steps, 13 Track-D steps, 4 store steps and 3 message/ruling items;
~17 migrations projected 0641–0657. No cycle.

Top 10:
1. **SEQ-2** The store lane has never run and no PR owns it; it gates every driver benefit AND, through the `live`
   proof rule, the McLeod stop write. Make it Track S, start day 0.
2. **SEQ-1** 0637–0639 are on main and 0640 is in open PR #2589; every spec's numbers are stale.
3. **SEQ-5** Load rates (on main) and B4/B5 change the same connector files, contract and VM with opposite Alex
   rules; ship one connector commit, one Alex message, one VM visit, one required-key flip.
4. **SEQ-3** `driver_complete_stop` is rewritten by three migrations; fold M-D2 into M-A, put every new parameter in
   M-A's one signature change, write T-4 from M-A's body, add T-4's cross-module waiver.
5. **SEQ-4** The VM reaches only production: ≥ 7 release+VM cycles before a live write; two staging recipes in spec A
   cannot run. Add "release #" / "VM visit #" columns; decide hotfix mode for agent routes.
6. **SEQ-7** S0 ordering (B2 < S0a < M-A; B1 < S0b) and C-10's reader filter on 11 API files are unwritten; S0b's
   rollback leaves soft-removed stops visible; after S0c production cannot roll back past S0b.
7. **SEQ-6** The driver visual plan (V5/V6) restyles the screens C-A2 rewrites; order C-A2 first.
8. **SEQ-8** C-13's production test org has no flag, no exclusion, no second token; the switch proofs do not need
   it — drop it from the first release.
9. **SEQ-9** The ETA re-key (§2.14) has no PR; S0c should take it (renumber to keep `seq` unique).
10. **SEQ-10 / SEQ-12** Rollback is defined only in spec B; 15 council-added tests have no owning PR — both now
    assigned in the tables above.
