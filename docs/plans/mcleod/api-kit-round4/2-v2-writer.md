# Round 4 — dry run as the v2 plan writer (2-v2-writer)

Repo `/Users/miroslavjokovic/Projects/FG-mcleod-api` at `274dd5459`. Read-only. Written incrementally.
Input: `api-kit-round3/2-sequence.md` §1 with ROUND3 §2 applied; precedence ROUND3 > round3 reports > COUNCIL > council reports > AUDIT > audit reports > specs.

## Working notes (as read)
- ROUND3 §2.3 (C-10 replaced: delete + `load_events` `stop_removed_in_mcleod`) removes `mcleod_removed_at` from N-6 and the 11-reader filter from N-7 that 2-sequence §1 still lists. 2-sequence's table is therefore stale in N-6/N-7/N-8 and must be re-derived.
- ROUND3 §2.5 partial unique `(stop_id, operation) where origin='driver_app' and supersedes is null` differs from R3-9's `where origin <> 'office_retry'`; ROUND3 wins, but then image-send duplicates (origin `sweep`) rely only on `mcleod_image_sends` check-then-insert (race; no unique).
- ROUND3 §2.15 says attempts kept 90 days; R3-19 said 180. ROUND3 wins.
- origin/main has moved 52 commits past the plan branch (fetched 2026-11-20 14:18 CT): **0640 is merged** (tenstreet),
  **driver Visual 2026 V5 (#2597) and V6 Loads/Load detail/Stop (#2601) are merged**, load rates R1–R3 + Q-RATE1 are
  merged (R4 connector not yet built). `[id].tsx` 262→241, `stop/[stopId].tsx` 310→338, `mirrorLoads.ts` 225→262,
  `DispatchLoadsPage.vue` 496→498 (R3 added `LoadRateCell.vue`, did NOT extract the Load # cell). ROUND3 §2.23
  ("C-A2 merges before V5/V6") is therefore impossible; §2.25's "whichever of B4 or R3 lands first extracts" resolves to B4.
- R3-12 keys the driver window on `loads.completed_at`; spec A §3.1 step 6 makes `completed_at` null on every McLeod load
  by design. The window column for tms loads must be `external_closed_at` (0366:52). Code-readable, but the documents conflict.
- ROUND3 §2.15 puts `enqueue_failed` in `mcleod_write_events`, whose `request_id` is NOT NULL → impossible when the request
  insert is what failed. P-17/1-pipeline put it in the `stop_completed` payload. Layer conflict.

---

## 1. PR table (2-sequence §1 order, ROUND3 §2 applied)

Legend: READY = every detail determined by the documents + code (cited). GUESS = I would have to invent the named detail.

| PR | Verdict | Detail I would have to invent | Closure |
|---|---|---|---|
| N-1 B1 photo rule | READY | — (spec B §2 gives constant, callers, 4 titles, mutation; only line numbers drifted with load-rates R2: `mirrorLoads.ts` 262 lines) | re-read lines at build |
| N-2 B2 columns | READY | — (spec B §3.2 full DDL, matrix file + 4 titles, staging SQL). Rename spec B's "M-A/M-B" labels (collide with spec A's M-A, X §4) | — |
| N-3 C-23 claim defect | READY | — (OF-2: `col@source` args, `split_part`, new `driverIdentityFields.ts`, `claimsIdentity()`, parity test renders `col@source`, title "a phone edit on a McLeod row does not warn"). Only gap: the trigger matrix file/titles are named "0241 trigger matrix" only | code read: which `supabase/tests/*` covers 0241 |
| N-4 C-16 link 360 hires | GUESS (small) | (a) file + signature of the new roster export `linkHiredDriverToTms` ("`apps/api/src/modules/roster/…`"); (b) where ROUND3 §2.10's "reopened row is skipped" rule lands — N-4 edits `rosterApplicantHire` but reopen does not exist until N-16; (c) R3-11(d)'s matrix title says the sweep HIRES the reopened row, §2.10 says it SKIPS it — the title must be rewritten, no replacement given | (a) code read of `roster/index.ts` exports; (b)+(c) writer's call: put the skip + a new title in N-16 ("a reopened former driver is not hired by the sweep") |
| N-5 B3 link-first + unmatched | GUESS | B-20: the act that clears an `unknown` truck/trailer code. AUDIT §2.5 says "named for each reason" but never names them; B-20 says it depends on whether the roster sweep would create the unit | one SQL measurement (are unmatched codes present in McLeod `tractor`/`trailer` the sweep reads?) → per reason: driver → RosterHeldList; truck/trailer → sweep or "McLeod data fix (Alex)"; ambiguous → duplicate on Trucks/Trailers |
| N-6 S0a stable stop ids | GUESS | 2-sequence still lists `mcleod_removed_at` + C-9 band parking; ROUND3 §2.2/§2.3 replace both. Must invent: (1) the exact band algorithm order (claim → copy evidence → delete pending removed → move incoming to +100 → tail-renumber removed worked stops → final seqs); (2) the `load_events` row for a deleted pending stop: kind `stop_removed_in_mcleod` needs `load_events_kind_check` re-added in THIS migration (loads module, fine) but its `actor_role`/`actor_user_id` values for a system actor are unstated; (3) R3-2's "> 50 stops → refused by name and the office sees it": return shape of the refusal and which surface shows it (no exception kind named) | (1)(2) code read of `0145`/`0370` load_events constraints + R3-2/DR-5 text — writer can close; (3) needs a named exception kind → add to the SEQ-14 table |
| N-7 S0b projection via RPC | READY | — (spec A §1.2 S0b + A-24/25/26 fix texts: files, 410 `retired_feed`, `loadEntityResolvers` move, table-writers entries, tests in `tmsIngest.dispatchProjection.test.ts`). The 11-reader C-10 filter in 2-sequence is DELETED by ROUND3 §2.3. Rebase over R2's `writeCharges` is textual | A-25's "no deployed agent still posts `/api/tms/loads`": CloudWatch read |
| N-8 M-A driver loads SQL | GUESS | (1) Orphaned evidence (ROUND3 §2.3 "a queued action for that stop lands on the load as a flagged event"): event kind name (R3-18 `stop_evidence_orphaned`? ROUND3 names only the sweep's `stop_removed_in_mcleod`), HTTP answer (R3-18 410 `stop_removed` — a raise rolls the event back; the function must RETURN a status, i.e. return type changes from `void`), and the app's handling (ROUND3 §2.6: 4xx → Needs attention, but the evidence is stored); (2) C-6 bounds: future tolerance 5 min (ROUND3 §2.9) is "a tunable" — SQL has no config object (ROUND3 §2.7's object is the agent's); where the SQL value lives is unstated; (3) whether `action_id` is required for accept/decline/start too (ROUND3 §2.16 says "stop actions") | (1) writer ruling inside the plan: recommend `returns jsonb {outcome}` + 200 + event `stop_evidence_orphaned` + exception `late_evidence` reused; (2) recommend a SQL constant `interval '5 minutes'` with a comment naming the measurement; (3) spec A §5.3 lists four schemas — take all four |
| N-9 C-A1 API/shared/web | GUESS | (1) the 14-day window column (R3-12 `completed_at` is null on tms — see notes); (2) R3-21's precondition "query `app_version` for any device from the retired APK lane; if none, ship required" — result not on file; (3) DR-14 `dispatch_not_visible` and `late_evidence` UI copy beyond "Not in {name}'s app — {reason}" | (1) code: `external_closed_at` (0366:52) for tms, `completed_at` for manual; (2) one production query (`notifications.ts:182` registrations); (3) DR-14 gives the three reasons verbatim — enough |
| N-10 B4 BOL/customer + agent refs | GUESS | SEQ-5/ROUND3 §2.22: ONE connector commit R4 + B4 + T-2 (all off) + ONE Alex SQL review that also covers "test-company reads" (§3). (1) R4 belongs to another plan/chat (LOAD-RATES-PLAN on main still says "no request to Alex"; R4 unbuilt) — who builds the combined commit and whether LOAD-RATES-PLAN is amended is not decided; (2) T-2 needs T-1 in production first, so the combined commit waits on T-1's release — unstated; (3) the test-company SQL Alex must review does not exist yet (T-10 has no design) | (1) owner/coordination ruling (or amend LOAD-RATES-PLAN in the v2 PR); (2) writer can state it; (3) depends on T-10 closure |
| N-11 V1 | READY | — (spec B §3.6 + B-41 count query) | dispatcher + VM (external) |
| N-12 B5 PU # | READY (per outcome) | spec B §3.1 D-MKN4.4 defines both outcomes of V1 (P8+PU vs P8 only); handoff says "three written outcomes" — spec has two + "neither" (null). B-28's it.each fix needs a code read | V1 result |
| N-13 B6 planned rig | GUESS (small) | B-21(c): StartDayCard heading for the planned-truck case — "Dispatch's truck for today?" **or similar** + "add a test" (no title); DR-16 set source depends on merge order (rule given) | owner/copy ruling on the heading, or writer picks and titles it |
| N-14 B7 arrival on board | READY | — (spec B §6, B-24 resolved by AUDIT §2.5) | — |
| N-15 S0c + ETA re-key | GUESS | ROUND3 §2.19/§2.21 vs SEQ-9 vs DR-21 vs A-52: is `idx_load_stops_load_seq` dropped (then the band is unnecessary and §2.21's "cannot roll back past S0b" holds) or kept (then the band and widened check stay forever and "restore seq check" is impossible)? And the re-key's DDL: `load_stop_eta_predictions.stop_id` column (FK? on delete? backfill by `(load_id, stop_seq)`?), then the `boardEtaRecorder.ts` merge — two PRs, not one | writer ruling with A-52's consumer list (`activity.ts:62-63`, `truckLoadPlanReads.ts:103-105`, 0453): recommend drop unique, remove band, narrow check, add `stop_id` + backfill + recorder in the next merge |
| N-16 C-15 Hire again | GUESS | (1) Q-3 (who may press it) unruled; EXT-20 says the default while unruled is not stated; (2) the reopened row keeps `termination_date` (§2.10's definition), so `hire_applicant` (0386, sets only status+hire_date) must clear it at the close — no document assigns that change to a migration | (1) owner Q-3; (2) writer: add the 0386 re-create to N-16's roster migration with a title |
| N-17 C-A2 driver app | GUESS | (1) V6 already restyled these screens on main: every spec-A line ref (`[id].tsx:84-160`, `stop/[stopId].tsx:160-190`) is stale and the order rule §2.23 is moot; (2) ROUND3 §2.6 "after 60 min of failure … the office gets one alert per load": a phone that cannot reach the API cannot tell the office; no mechanism (route, table, scheduler) is named; (3) obsolete titles still assigned here by SEQ-12 (DR-9 "waits while an older record of the same load is unfinished", "a dead record of the load no longer holds the queue") and R3-5's "a 500 … dead-letters after 8 attempts" contradicts §2.6 "never dead-letter"; no title for the 60-min banner | (1) code read of main's V6 screens; (2) owner/writer ruling: alert only on server-observed failures (5xx/refusals logged per load) or on the phone's next contact — the text as written cannot be built; (3) writer drops them, writes new titles |
| N-18 C-A3 | DROPPED | ROUND3 §2.16 | — |
| S-1..S-4 store track (SEQ-2) | S-1 READY; S-2..S-4 external | S-1: ROUND3 §2.11 + R3-8 (fetch, is-ancestor on both triggers, header fix, workflow test "a dispatch from main ahead of production is refused"). S-2..S-4 = owner Q-5 + Apple conversion + RELEASE-GATE P2.3 | owner |
| M-1/M-2/M-3 messages | READY | 3-external §3.1/§3.2/§3.3 final lists (17 Alex, 15 McLeod, owner list) | — |
| T-1 MK0 tables + read routes | GUESS (small) | `mcleod_api_capabilities` columns: RT-13 says org-scoped, one row per operation, `fields jsonb`, but no DDL exists (spec C §5.2 has the other three tables, built for per-field rows per AUDIT §2.1) | writer derives from RT-13 + spec C §5.2; no external input |
| T-2 agent `/ws` client + VM ops | READY | spec C §3.2/§3.3/§6 + C-1 (client exists), RT-9 (public cert + `*.ci.test.mjs` excluded from manifest), OPS-16 exact gate patterns; "the four already public" = AnywhereCompanyIDs TMS..TMS4 (OPS-16). Only choice left: OPS-16 chains the gate onto `lint:agent-syntax`, 2-sequence says "new repo gate + ci.yml step" — both legal | writer picks |
| T-3 write-scoped credential | GUESS | OPS-8: "a new mcleod-owned table" with its own hash column — no DDL, no rotation/revoke columns; ROUND3 §2.13 "egress IP recorded on every claim, a change raises an alert" — which row stores it (agent_status? attempts?) and which watcher alerts is unstated; SSM `MCLEOD_AGENT_EGRESS_IP` becomes conditional (only if Alex confirms static) | writer DDL (mirror the ingest-token table, `tmsIngest.ts:34-51`); per-outcome on Alex's static-IP answer is defined |
| T-4 pipeline migration | GUESS (largest) | Starting DDL = 1-pipeline "Final pipeline spec", amended by ROUND3 §2.4/§2.5/§2.7/§2.15 + R3-10. Not determined: (1) `enqueue_failed` as a `mcleod_write_events` kind (§2.15) has no request to reference → impossible; (2) `canary_scope jsonb` shape and validation (keys? `customer_codes` vs `customer_ids`; stop kinds `pickup`/`dropoff` vs McLeod `PU`/`SO`), and whether requests get R3-3's `stop_type`/`customer_id` columns (needed for the claim to evaluate the scope; ROUND3 is silent); (3) how the owner's "recorded sign-off" is stored so the switch-proof trigger can accept a `canary` row with no `proven_by_request` (column? audit row? `changed_by` = owner?) and how the trigger reads "the org has no test company" from `org_integrations.config`; (4) `test` mode semantics: COUNCIL §2.1 "only admin prove requests", ROUND3 §2.4 "writes only to listed test companies" — are `driver_app` requests on a test company leased in `test`?; (5) `mcleod_write_attempts` DDL (which kinds move: leased/send_started/transient), retention anchor ("kept 90 days" from insert or from request end — R3-19 said "after the request ends"), the purge job, and the MK012 "nothing after an end" + view + MK013 rewritten across two tables; (6) R3-10's `subject_ref` per-operation check content; (7) matrix file name: ROUND3 §2.26 `mcleod-writes.test.mjs` vs R3-1 `mcleod-write-pipeline` vs 2-sequence `mcleod-write-queue` + `mcleod-write-requests` (precedence picks ROUND3, but SEQ-3/SEQ-12 cite the old names) | (1)(4)(6) writer rulings within the plan (recommend: `enqueue_failed` stays in the `stop_completed` payload + W6, as P-17); (2)(3) need a design paragraph — no external input, but the documents do not have it; (5) writer + table-lifecycle budget; (7) precedence |
| T-5 write API + monitoring + UI | GUESS | (1) the switch card must edit `canary_scope` and record the owner sign-off — no UI or route body is specified; (2) SSM parameter name for L1 (`MCLEOD_WRITES`, AUDIT §2.1) and the services to restart — SEQ-19 says T-5 "names" them, no document does; (3) the "one alert per load" phone-failure feed (see N-17); (4) web copy for `McleodApiHealthLine.vue`/`McleodWriteSwitches.vue` beyond P-25 | (2) code read of `infra/server/fetch-settings.sh` + `docs/DEPLOYMENT.md`; (1)(4) writer design; (3) ruling |
| T-6 VM configure + Phase A | READY (external) | spec C §6 step 2 + §7 U1–U17 per outcome; 3-ops probe table K1–K24 | McLeod `/ws`, URL, cert; Alex RDP |
| T-7 docs parser + Phase B | GUESS | SEQ-11: real pages stay in `mcleod_api_discoveries.docs_gz` and "Phase B parses them there". `docsParser.mjs` is agent code; whether the VM downloads `docs_gz` back through a new `/api/tms/mcleod-api/*` route, or parsing moves into the API, is unstated | writer ruling (recommend: parse on the VM from its own fresh crawl, never round-trip the docs; stubs in the repo) |
| T-8 agent write loop | READY | spec C §5.6 as amended by P-1..P-26, R3-4 (begin_send no-retry 10 s; startup invariant `quiet ≥ deadline + settle_worst + margin`), ROUND3 §2.7 tunables table, R3-7 date modes per K6 outcome, DR-9.3 per-movement order with claim size 1. Titles named (P-26 trickle, RT-22 DST, "stop 2's clear waits for stop 1's") | K6/K13 outcomes select the date mode (defined) |
| T-9 parity + verdict | READY | spec C §4 + D-MKT4; RT-13 paged reads | U1 present |
| T-10 test-company lane | GUESS (no PR content exists) | ROUND3 §2.4 replaced the test org, but nothing describes the PR: (1) agent reads a second company (today one `MCLEOD_COMPANY_ID`, `agent.mjs:175`; queries are company-scoped) — which queries, which env line; (2) who writes `org_integrations.config.mcleod.test_companies` (owner act from K1 `GET /metadata`, 1-assumptions row 1) and whether `mcleod` may write that org-owned config (D-MKT6 says mcleod's sites in `org_integrations` may not grow); (3) "one shared predicate" — where it lives (SQL function? shared TS?) and the list of every report, census and count it must be applied to (roster sweep would also create test drivers/trucks as seats — billing); (4) Alex's OK for reading a second company (in §3's SQL review, but no SQL exists) | (1)(3) code read: graphify `affected` on `loads.external_id`/roster sweep readers; (2) code read of `table-modules.json` ownership; (4) Alex (after the SQL exists) |
| T-11 proving run | READY (external) | spec C §7 P1–P6, C-19 Alex list + undo rehearsal, ROUND3 §2.4 proof rule | E5/test company, Alex A1, C-19 answers |
| T-12 canary → live | GUESS | C-19 order "pickups → non-EDI deliveries → EDI" needs to know which customers are EDI; `canary_scope` holds customer ids, but no document says where the EDI flag comes from (McLeod column? Alex list?) | Alex question (add to M-2) or a McLeod column read (code: `queries.mjs` customer fields) |
| D-1 MK4 tables | GUESS | 2-sequence D-1 still carries the partial unique `(org_id, stop_id, kind)` that ROUND3 §2.5 drops. With no unique key, (1) what stops the image sweep from enqueuing the same (stop, kind, sha) twice before the first is sent (the send-time check covers McLeod, not the queue); (2) RT-17 "backup" of the `mcleod-outbound` bucket — no backup mechanism exists for storage (memory `storage-files-have-no-backup`) | (1) writer: enqueue function checks open/confirmed requests with the same `subject_ref` + sha under the org lock; (2) ruling or reuse whatever the storage-backup programme lands |
| D-2 M-D3 lumper kind | READY after one code read | "+`source` only if LRC has not" | read `lumper_case_files` on main |
| D-3 MK4 API | GUESS (tests) | Code is determined (spec D §MK4.3 + OF-8/9/10, R3-9/ROUND3 §2.5 Send again = `office_retry` random id, §2.17, SEQ-17/18). But spec D §MK4.8's tests pin what ROUND3 dropped: matrix (3) "`uq_mcleod_image_sends_bytes` refuses a second identical send", (4) a guard allowing `mcleod_image_id` null→value UPDATE (the table is now append-only file facts keyed by request id), the mutation "drop `page_no` from the unique key", and "enqueue idempotence (two calls ⇒ one row)" whose mechanism no longer exists; M-D2's sha test (1) moves to M-A's matrix (§2.20) | writer rewrites the list after D-1's closure |
| D-4 MK4 agent | GUESS (external, no per-outcome build) | ROUND3 §1 fact 5 "where a `/ws` image lands (DocumentPower module)" only "blocks MK4 going live"; no build is defined for the answer "it lands in a store billing does not read" or "needs a module we do not have" | McLeod answer (M-1); the plan must write each outcome's build (likely: MK4 stays off; office papers keep today's path) |
| D-5 MK4 UI | READY | contract then reader (two merges) | — |
| D-6 MK5 base | GUESS (small) | M-D4a options table content = McLeod's `reason_for_leaving` codes (OF-7 3-char code) — source of the list (K-probe read vs Alex) not stated | K-probe read through `/ws` (add to the K list) |
| D-7 create / reactivate | BLOCKED (owner) | body content depends on Q-1 (O-2 vs O-7, OF-4 sentence) and switch on Q-4 | owner Q-1 + Q-4; per-outcome defined (OF-4 text or create stays off) |
| D-8 unit status | READY (per probe) | OF-5/OF-6/K21 outcomes defined; D-39/D-40 guards; browser→API move (handoff facts) | MK0 probes |
| D-9 driver fields, medical, CDL | READY (per probe) | O-2 narrow + D-28 exclusion + `license_date` writability probe | K-probe |
| D-10 MK2 finance | READY | OF-12/OF-13 (two configs on the owner's Mac), EXT-3/EXT-4 exact Part 4 list, D-44 28 columns | Alex grants |
| D-11 DB7 run | READY | 1-assumptions row 60: baseline = dispatcher ETA error, last 90 days | needs taps (store lane) |
| D-12 ETA write | READY (per probe) | O-8 two outcomes, RT-8 ≥ 30 min change cadence, OF-15 Alex confirmation, N-15 re-key | probe + Alex |
| D-13 home time | READY (per probe) | spec D §MK6.2 H1/H2/H3 + OF-17/OF-18 + D-50 | 14-day probe |

Counts: 45 rows (store track and messages one row each). READY 21 (13 fully; 8 per probe/external answer with every
outcome's build written: N-11, N-12, T-6, T-11, D-8, D-9, D-12, D-13) + S-1 · GUESS 21 · BLOCKED on owner 1 (D-7) ·
DROPPED 1 (N-18).

---

## 2. Every GUESS, grouped by what closes it

### 2a. Code-readable now (a fresh chat can close these in the worktree, no one else needed)
1. N-3: which `supabase/tests/*` matrix pins the 0241 drivers trigger (for the `col@source` titles).
2. N-4: the roster export's file and signature for `linkHiredDriverToTms`.
3. N-6: `load_events` columns/constraints for a system-written `stop_removed_in_mcleod` row (actor_role/actor_user_id; 0145 kind list; 0370 guard).
4. N-7: CloudWatch — does any deployed connector still POST `/api/tms/loads` (A-25) before the 410.
5. N-9: the window column — `external_closed_at` (0366:52) for tms; `completed_at` stays null on McLeod loads by spec A §3.1 step 6, so R3-12's rule cannot be used as written.
6. N-9: R3-21's precondition query on push registrations `app_version` (`notifications.ts:182`) — run it, record the count.
7. N-12: B-28's `it.each` required-fields test shape.
8. N-16: `hire_applicant` (0386) must clear `termination_date` on a reopened row's close — add the re-create to N-16's roster migration.
9. N-17: main's V6 screens (`[id].tsx` 241, `stop/[stopId].tsx` 338) — every spec-A line reference must be re-read; V6 is merged, so ROUND3 §2.23 is moot.
10. T-1: `mcleod_api_capabilities` DDL from RT-13's shape.
11. T-3: write-token table DDL, mirroring the ingest-token table (`tmsIngest.ts:34-51`).
12. T-5: the SSM parameter path convention and restart list (`infra/server/fetch-settings.sh:32-36`, `docs/DEPLOYMENT.md`).
13. T-10: the readers the test-company predicate must cover (roster sweep, census, seats, boards, Ask AI); whether `mcleod` may write `org_integrations.config` (table-modules ownership; D-MKT6 says mcleod's sites there may not grow).
14. T-12: whether McLeod's `customer` row carries an EDI flag we can SELECT (`queries.mjs` customer fields).
15. D-2: `lumper_case_files.kind/source` on main.
16. N-5: one SQL measurement — are the unmatched truck/trailer codes in the McLeod tables the roster sweep reads.

### 2b. Writer's own rulings (no external input; the documents simply stop before deciding)
1. N-6: the band algorithm's exact step order and the "> 50 stops" refusal surface (an exception kind for the SEQ-14 table).
2. N-8: orphaned evidence — function returns a status instead of raising, HTTP 200, kind `stop_evidence_orphaned`, exception `late_evidence` reused (or a new kind); app treats it as done.
3. N-8: where the SQL future-time tolerance lives (constant vs config).
4. N-8/N-9: whether `action_id` is required on accept/decline/start (manual loads) or stop actions only.
5. N-13: StartDayCard heading wording for the planned truck + its title.
6. N-15: S0c — drop or keep `idx_load_stops_load_seq`; band removed or permanent; 0453 `stop_id` column DDL + backfill; recorder as its own merge.
7. T-4 (1): `enqueue_failed` cannot be a `mcleod_write_events` row (no request exists) — keep it in the `stop_completed` payload (P-17) and say ROUND3 §2.15 is corrected.
8. T-4 (2): `canary_scope` JSON schema, and request columns `stop_type`/`customer_code` (R3-3) so the claim can evaluate it.
9. T-4 (3): how the owner's canary sign-off is stored and read by the proof trigger.
10. T-4 (4): `test` mode = prove-only (COUNCIL §2.1) or any request on a listed test company (ROUND3 §2.4 wording).
11. T-4 (5): `mcleod_write_attempts` DDL, retention anchor (insert vs request end), purge job, and MK012/MK013/view across two tables.
12. T-4 (6): R3-10's `subject_ref` per-operation check.
13. T-5: switch-card UI for `canary_scope` + sign-off; health/switch copy.
14. T-7: where Phase B parses (VM fresh crawl vs API-side from `docs_gz`).
15. D-1: enqueue idempotency for image sends with no unique index.
16. D-3: rewrite spec D §MK4.8's tests for the new key scheme.

### 2c. Owner rulings
1. Q-1 (create carries name/DOB/CDL once) + Q-4 (O-7 sentence) → D-7.
2. Q-3 (recruiters may press Hire again) → N-16; EXT-20: the default while unruled is not stated.
3. N-10: who builds the combined connector commit (load-rates R4 belongs to another plan; LOAD-RATES-PLAN on main still says "no request to Alex").
4. N-17/T-5: ROUND3 §2.6's "office gets one alert per load after 60 min of failure" cannot be built for a phone that cannot reach the API — rule what it means (server-seen failures only, or report on next contact).
5. D-1: what "backup" of the `mcleod-outbound` bucket means while storage has no backup programme.
6. Q-5..Q-8 (store track, hotfix OK, Q-7 security fallback, 14-day window).

### 2d. External answers (already in ROUND3 §1/§3; listed here only where the plan lacks the per-answer build)
1. D-4: where a `/ws` image lands (DocumentPower module) — the documents say only "blocks MK4"; the build for each answer is not written.
2. D-6: the list of McLeod `reason_for_leaving` codes (a K-probe read, not yet on the K list).
3. T-12: which customers are EDI, if no SELECT-able flag exists (Alex, add to M-2).
4. T-10: Alex's OK on reading a second (test) company — the SQL for it does not exist yet, so it cannot be in the "one SQL review".
(All other externals — `/ws` on 22.1, URL/cert, test company, Alex's write OK, `clearStop` effects, date mode, token revocation, egress IP, store release — have a per-outcome build in spec C §7, 3-ops' K table, 1-assumptions and ROUND3 §2.13.)

### 2e. Layer conflicts that survive the precedence rule
The rule is "later round wins"; ROUND3.md and `api-kit-round3/*.md` are the SAME round, and §0 does not say the summary beats its own reports.
1. Partial unique index predicate: ROUND3 §2.5 `origin='driver_app' and supersedes is null` vs R3-9 `origin <> 'office_retry'` (R3-9 covers image sweeps; §2.5 does not).
2. Attempts retention: §2.15 90 days vs R3-19 180 days "after the request ends".
3. Driver window: §2.18 14 days vs R3-12 30 days keyed on `completed_at` (null on tms).
4. Canary: §2.4 `canary_scope` vs R3-3 `test_targets` + `allow_stop_types/allow_customers` + request columns.
5. Reopened row: §2.10 "skipped by the sweep" vs R3-11(a)/(d) "hired by the sweep once" (title).
6. Settle: §2.7 "settle may retry" vs R3-4 "begin_send and settle no-retry 10 s".
7. Stop outbox: §2.6 "never dead-letter" vs R3-5 "a 500 counts toward MAX_ATTEMPTS" (title "a 500 that never clears dead-letters after 8 attempts").
8. Future tolerance: §2.9 5 min vs R3-7 2 min.
9. `enqueue_failed`: §2.15 (events table) vs P-17/1-pipeline (payload) — and §2.15 is impossible.
10. `p_mcleod_write`: DR-18 drops it; SEQ-3 keeps it in M-A (later round wins — determined, but SEQ-3 never says what it carries now that the SQL reads the switch table: L1 only).
11. Matrix names: §2.26 `mcleod-writes.test.mjs` vs SEQ-3/SEQ-12/2-sequence T-4 names.
12. 2-sequence §1 itself (the base the handoff names) predates ROUND3 §2.3: N-6/N-7/N-8 still carry `mcleod_removed_at`, the 11-reader filter, C-9 parking; D-1 the `(stop, kind)` index; T-10 the test org. "Apply ROUND3 §2" silently deletes ~20% of the table's cells.
Recommended fix: one line in ROUND3 §0: "ROUND3.md §2 outranks every round-3 report; where §2 is silent the report stands."

## 3. Tests: exact titles or only "a test"?
- Exact titles exist for: B1, B2, B3, B5, B7 (spec B §2-§6), S0a (spec A + DR-2/DR-5/R3-2), M-A (spec A §2.5/§3.3/§4.6/§5.4 + DR-7/8/11/12/17/25, A-14/15), C-A1 (spec A driverLoads/useLoadDispatch/DispatchLoadDetailPage + DR-4/DR-14/DR-15), C-23 (OF-2), C-16 (OF-3), S-1 (R3-8), T-8 (P-26, RT-22, DR-9.3), switch proofs (only under the dropped R3-3 design).
- Only a file or "a test": T-1 ("rls seeds"), T-3 ("middleware tests"), T-5 ("web tests"), T-7 ("parser tests"), T-9, T-10 (none), D-5 ("web tests"), D-6 ("route tests"), D-8 ("inverse-table test, form tests"), D-9 ("as D MK5.4/5.5"), D-12 ("as D MK6.1"), D-13 (none), N-13 ("B §5.3" + B-21(c) "add a test"), N-16 (files only), N-17 (60-min banner, never-dead-letter beyond DR-10, V6-rebased screens). Spec C §8 and spec D §MK4.8 describe behaviours, not quoted titles.
- Titles now OBSOLETE and still assigned: DR-9's two per-load-FIFO titles (SEQ-12 → N-17); R3-5's 500-cap title; R3-3's three (test org / test_targets); R3-11(d); spec A "a re-sequenced movement is deferred, not failed…" and S0c's flip title; spec C §8.3 (mutable model: `lease_expired` attempt, MW002/MW003, "second live intent returns the first"); spec D §MK4.8 (3), (4) and its `page_no` mutation; DR-6's soft-remove titles ("…stored and flagged, never DL005" survives only under the orphan design).

## 4. Handoff defects (HANDOFF-2026-11-19-API-KIT-BUILD-PLAN.md as the v2 writer would receive it)

1. **The required reading does not fit one context.** The precedence rule ("every finding in every report is adopted unless
   §5 rejects it") forces the writer to read all of it: handoff + ROUND3 + COUNCIL + AUDIT + SURFACE + v1 + 4 round-3 + 5
   council + 6 audit reports + 4 specs = **1,077,880 bytes (~270k tokens)**, before any code. The same handoff says "at ~50%
   context, write a handoff". A fresh chat cannot both read and write. Missing: a consolidated, de-duplicated
   "adopted findings by PR" list (this file's §1 is a start), or an explicit split of the v2 writing across chats by track.
2. **Precedence is incomplete** (§2e above): it does not rank ROUND3.md against its own reports, and 12 conflicts survive.
3. **Stale state.** "branch = main + commit `6a70d36a2`" (now 3 more commits; main is 52 commits ahead); 0640 is merged,
   not "open PR #2589"; V5/V6 of the driver visual plan are merged, so ROUND3 §2.23 cannot be followed; load-rates R1–R3 +
   Q-RATE1 merged (R4 not); `DispatchLoadsPage.vue` 498 not 496; `mirrorLoads.ts` line refs shifted. The
   "Facts verified against code on main (2026-11-19) — do not re-derive" block tells the writer NOT to re-read exactly the
   lines that moved.
4. **Superseded instructions are left in place, unmarked.** The handoff body (written 11-19) still says: copy specs from the
   scratchpad (done — and the path may be cleared); "Spec C proposes six tables … reconcile A and C" (done in AUDIT §2.1,
   then rewritten twice); "dedupe by sha256" and the image keys (dropped, ROUND3 §2.5); "S0 … 3 merges" (now S0a/S0b/S0c
   + a recorder merge); "per-stop FIFO" (dropped); "Revised RC … 14 days of exact agreement"; "the test-company read lane
   … staging org" (AUDIT, replaced twice); "Never commit company ids" (R3-14: the four public ids are allowlisted); the
   "External blockers B-MK2..B-MK10" list is not mapped to ROUND3 §1's ten facts. Three "READ FIRST" layers stacked on
   one body make the writer diff them by hand.
5. **Read order omits files the plan depends on:** `MCLEOD-API-KIT-PLAN.md` (v1, which v2 supersedes and whose §1 rulings
   are re-ruled), `MCLEOD-API-SURFACE-2026-11-19.md` (named only in the body), `docs/plans/dispatch-loads/LOAD-RATES-PLAN.md`
   + `LOAD-RATES-VM-UPDATE.md` (SEQ-5), the driver visual plan (SEQ-6), `docs/plans/drivers-app/RELEASE-GATE.md` (store
   track), `docs/plans/mcleod/mail.md` (Alex's terms), the ruling documents X.md §5 lists for re-ruling, the 11-13 Alex
   request (`tools/mcleod-agent/review/REQUEST-TO-ALEX-2026-11-13-…`), and `api-kit-council/pg/` + `round3/pg/` (the
   R3 scripts live in the session scratchpad, `4-redteam.md:3-5`, i.e. not in the repo).
6. **Owner questions are split over three lists** (AUDIT O-1..O-8 ruled; COUNCIL Q-1..Q-4; ROUND3 Q-5..Q-8 + EXT-19's extras)
   and the handoff's "write v2 only after Q-1..Q-4, or show those steps blocked" does not cover Q-5..Q-8 (Q-5 blocks every
   driver benefit and is not a switch).
7. **ID scheme left to the writer:** v2 must renumber C-*, O-*, Q-*, R3-*, SEQ-*, DR-*, OPS-*, OF-*, P-* into D-MK* (AUDIT
   §2.8) with no mapping table; specs reuse "M-A" for two different migrations (spec A, spec B).
8. **Tests:** the handoff demands "tests by title"; for ~15 PRs the documents give only files (§3), and ~20 assigned titles are
   obsolete. The handoff does not say so.
9. **"Nothing left open"** is impossible: ROUND3 §1 lists ten facts only others supply. The handoff should say plainly that
   v2 is "every step determined OR blocked on a named answer with its per-answer build" — it says this only for Q-1..Q-4.
10. The handoff still names `docs/plans/mcleod/` for the two drafted messages but ROUND3 §3 changes the Alex recipient
    (To Tzakov, Cc Lockwood, EXT-2) — the body says "one to Alex".

## 5. Summary

45 rows from 2-sequence §1 (+ store track, messages), ROUND3 §2 applied: **READY 21** (13 fully, 8 with every outcome's build
written) + S-1 · **GUESS 21** · **BLOCKED 1** (D-7, owner Q-1/Q-4) · **DROPPED 1** (N-18). GUESS items by kind: **16 code-readable
now**, **16 writer rulings** (no external input; the documents stop short), **6 owner rulings**, **4 external answers without
a per-answer build**, **12 layer conflicts** that survive the precedence rule. Test titles: exact for the N track's SQL and
B steps; files-only for ~15 PRs; ~20 assigned titles obsolete.

Top 15
1. **T-4 cannot be written from the documents**: `enqueue_failed` as an events row is impossible (no request); `canary_scope`
   shape, request scope columns, the stored owner sign-off, `test`-mode semantics, and the attempts-table split (DDL,
   retention anchor, MK012/MK013/view across two tables) are all undefined.
2. **The handoff's reading is ~1.08 MB (~270k tokens)** under a rule that adopts every finding — it cannot be read and
   written in one context; no consolidated adopted-findings list exists.
3. **Precedence gap**: ROUND3.md vs its own round-3 reports is unranked; 12 conflicts survive (index predicate, 90 vs 180 d,
   14 vs 30 d + `completed_at`, canary_scope vs test_targets, sweep skip vs hire, settle retry, 500 cap, 5 vs 2 min, …).
4. **Main moved**: V5/V6 merged (ROUND3 §2.23 impossible; C-A2's line refs stale), 0640 merged, load-rates R1–R3 merged;
   the handoff's "do not re-derive" block points at moved lines.
5. **N-15 S0c is undetermined**: drop or keep the unique seq index (decides whether the band is permanent and whether
   §2.21's "no rollback past S0b" is even true), and the 0453 re-key DDL + its separate recorder merge.
6. **T-10 has no content**: second-company agent reads, who writes `test_companies` (and whether `mcleod` may write the
   org-owned config), where the "one shared predicate" lives and every reader it covers (roster/seats would ingest test drivers).
7. **ROUND3 §2.6 "office alert per load after 60 min"** cannot be built for a phone that cannot reach the API — needs a ruling.
8. **N-8 orphaned evidence**: event name, non-raising return (return type change), HTTP code, and app handling are not
   decided; a raise would roll the evidence back.
9. **R3-12's window keys on `completed_at`, null on every McLeod load** by spec A — must be `external_closed_at` for tms.
10. **D-1/D-3 image dedupe**: with every unique key dropped, nothing stops a double enqueue; spec D's MK4 tests pin the
    dropped keys.
11. **N-10 combined connector commit** depends on another plan's unbuilt R4 (whose plan still says "no request to Alex")
    and on a test-company SQL that does not exist — needs an owner/coordination ruling.
12. **D-4 MK4 agent**: the DocumentPower answer only "blocks"; no per-answer build is written.
13. **2-sequence §1 is stale against ROUND3 §2.3** (`mcleod_removed_at`, the 11-reader filter, C-9 parking, `(stop,kind)`,
    test org): ~20% of the table the handoff tells the writer to start from must be deleted by hand.
14. **T-12 EDI ordering** needs to know which customers are EDI; no source is named.
15. **N-16**: Q-3 unruled with no default (EXT-20), and `hire_applicant` must clear the reopened row's `termination_date` —
    no document assigns that migration change.
