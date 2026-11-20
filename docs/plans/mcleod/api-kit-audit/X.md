# Audit — McLeod API Kit planning documents (2026-11-20)

Repo `/Users/miroslavjokovic/Projects/FG-mcleod-api` at `22f3f0540`. All paths below are relative to
`docs/plans/mcleod/` unless they start with `docs/`, `apps/`, `scripts/` etc.
Abbreviations: **v1** = `MCLEOD-API-KIT-PLAN.md`, **SURF** = `MCLEOD-API-SURFACE-2026-11-19.md`,
**HO** = `HANDOFF-2026-11-19-API-KIT-BUILD-PLAN.md`, **A/B/C/D** = `api-kit-specs/{A-driver-loads,B-data-fixes,C-transport,D-office-finance-docs}.md`.
Newest migration on main: `0636_toll_plazas_and_observations.sql` (checked `origin/main`).

---

## 1. Contradictions between documents

### 1.1 The write pipeline — A and C define two incompatible schemas (blocking; HO:100-102 already flags it)

| Aspect | A | C | D (consumer) |
|---|---|---|---|
| Tables | 2: `mcleod_write_requests` (immutable) + `mcleod_write_outcomes` (A:557-599) | 6: `mcleod_write_requests` with **mutable** `status`, `mcleod_write_attempts`, `mcleod_write_switches`, `mcleod_api_agent_status`, `mcleod_api_discoveries`, `mcleod_api_parity_runs` (C:345-461) | assumes columns `state`, `target jsonb`, `expect jsonb`, `response jsonb`, `refusal`, `confirmed_at` (D:17-27) — neither A nor C has them |
| Append-only | "An append-only row cannot carry a changing state" (A:30) | status moves forward through functions, "append-only-friendly" (C:18, C:325-327) | — |
| Request columns | `operation in ('stop_clear')`, `load_id`, `stop_id` FK, `company_id`, `movement_id`, `mcleod_stop_id`, `arrival_at`, `departure_at`, `expected`, `origin`, `supersedes`, `requested_by NOT NULL` (A:557-574) | `kind` (regex), `target_type`, `target_id`, `payload`, `baseline`, `source_ref NOT NULL`, `requested_by` nullable, lease columns (C:345-368) | `target`, `payload`, `expect` (D:22-24) |
| Error codes | `MW010`, `MW011` (A:600-601) | `MW001`–`MW005` (C:341-342) | — |
| Budgets | requests 700/day, outcomes 1,500/day (A:611-613) | requests 2,000/day, attempts 4,000 (C:864) | image sends 600/day (D:441) |
| One-live rule | one driver intent per (stop, operation) (A:575-576) | one live intent per (org, kind, company, target) (C:369-371) | D needs several live intents per target: hourly ETA (D:1040), home-time supersede (D:1100-1103), `driver_update` fields + medical + lifecycle on the same driver |
| Shared contract file | `MCLEOD_WRITE_STATES`, `MCLEOD_WRITE_REASON_TEXT` (A:663-665) | `packages/shared/src/mcleodApi.ts`: `MCLEOD_WRITE_KINDS`, `MCLEOD_WRITE_REASONS` (C:72, C:523-543) | `packages/shared/src/mcleodWriteContract.ts` "the pipeline spec's contract file" (D:46) — does not exist in C |
| Capabilities store | — | `mcleod_api_discoveries` (C:425-432) | `mcleod_api_capabilities` "the MK0 table, pipeline spec" (D:200, 324, 335, 348, 497, 701, 1029) — **C defines no such table** |
| Id of server-born intents | client action id only | client action id, NO default (C:346) | `uuidv5(MCLEOD_WRITE_NS, …)` (D:42-50) |
| `sent` meaning | the agent called /ws, may repeat (A:602-603) | leased for 120 s, re-queued on expiry (C:489, C:648) | waiting up to 24 h/72 h for McLeod's batch to file an image (D:326-337) — under C the lease would expire and re-queue every 120 s |

**Resolution.** One schema, owned by C's migration (C has the claim/lease/settle machinery D needs):
keep C's `mcleod_write_requests` (+ `attempts`, `switches`, `agent_status`, `discoveries`, `parity_runs`), but
(a) rename A's `mcleod_write_outcomes` concept onto C's `mcleod_write_attempts` (A's tests at A:707-713 re-titled);
(b) state in v2's D-MK1 that requests are "immutable intent, forward-only status by two SQL functions, append-only attempt log" (amends v1 D-MK1, A C4 and C D-MKT5 at once);
(c) add a 7th table **`mcleod_api_capabilities`** (org, key, value, measured_at, discovery_id; append-only, newest wins) to C's migration — D reads 8 keys from it;
(d) add C's columns D needs instead of D's names: D's `target` → C `target_type`/`target_id`, D's `expect` → C `baseline`, D's `response/refusal/confirmed_at` → C `attempts.mcleod_text/observed` + `reason_code/reason_text/settled_at`; rewrite D:17-27 to C's names;
(e) give `kind` a `sent`-window: add `confirm_by timestamptz` (or per-kind `lease_seconds` in the registry) so `image_upload` can sit in `sent` 24 h/72 h without lease expiry (D:326-337);
(f) replace C's one-live index with "one live intent per (org, kind, company, target, `intent_key`)" or add a `superseded_by` path (A's `supersedes` column, A:570-573) so D's ETA/home-time/driver-field kinds can supersede; the guard (C:464-467) gains `queued→refused` with reason `superseded`;
(g) one shared file `packages/shared/src/mcleodApi.ts` holds kinds, states, reasons (merge A's `arrival_unknown, stop_gone, mcleod_differs` A:588 into C's list C:535-543), and `MCLEOD_WRITE_NS` (D:46);
(h) one error-code range: C's MW001–MW005 plus A's org/append-only checks folded into MW001/MW002.

### 1.2 Stop write — what is sent and when

- A: "**Arrive** → evidence only, no write request … **Complete** (departure) → ONE write request carrying `arrival_at` … and `departure_at`" (A:540-544); kind `stop_clear` (A:560).
- C: kinds `stop_arrival` and `stop_departure` (C:525-528); "`status: "arrived"` → `stop_arrival`; `"completed"` → `stop_departure`" (C:617-618); `apply`: "`POST /dispatch/clearStop/{target_id}?arrivalDate=<fmt(at)>` (or `departureDate`)" (C:563-565).
- HO sides with A: "Only stop **Complete** sends one `clearStop` … Arrive and Skip send nothing" (HO:106-107). SURF: clearStop "Clears the stop" (SURF:38-42) — sending an arrival-only clearStop risks marking the stop departed, A's reasoning (A:540-541).
- Null arrival: A → `refused` `arrival_unknown`, office keys it (A:547-549); C U10 "both dates required" → "arrival = driver's tap if McLeod's is null, else McLeod's (never overwritten)" (C:793).

**Resolution.** v2 rules A's model: one kind `stop_clear` on Complete only. C's U10 table becomes: arrival-only accepted → still not used (writing on Arrive would clear the stop); both required → A's rule, except take C's improvement "if McLeod already holds an arrival, send McLeod's" (C:793). Delete `stop_arrival`/`stop_departure` from C:525-528, C:552-553, C:242-244 (`REQUIRED_SURFACE`), C:617-618; C's proving run P1/P6 (C:805-810) become one `stop_clear` case.

### 1.3 Where the stop write is enqueued

- A: inside SQL `driver_complete_stop`, same transaction, with a `cross-module-waiver` (A:555-556, A:628-655).
- C: TypeScript `orchestration/driverStopToMcleod.ts` after the RPC; "Any throw in 4 → 503 to the phone" (C:601-615), justified by "`mcleod` already imports `../loads/index.js` … so `loads → mcleod` would be an import cycle" (C:601-603).
- D: "the completion path (`driverLoads.ts:280-300`) stays McLeod-free (D-ARC3: `loads` does not call `mcleod`)" (D:304-306); D-MK5-0g "the reverse edges would close module cycles" (D:521-523).
- **Fact check:** `scripts/check-feature-boundaries.mjs:399` already allows `"loads -> mcleod"` (for `readFleetDispatchers`) and `:132` allows `"mcleod -> loads"`. C's and D's cycle argument is factually wrong as stated; the edge exists. The real argument is D-ARC3 layering.

**Resolution.** Pick A's same-transaction SQL enqueue (no lost intent, no 503 path, evidence and intent atomic — the strongest form of D-MK1's "evidence first"), but call C's `mcleod_write_enqueue()` function from inside `driver_complete_stop` so the request row shape is C's. Record the cross-module waiver in the migration header. Delete C §5.5 "Enqueue path" and `orchestration/driverStopToMcleod.ts` (C:73, C:601-618, C:838-839, C:884) and C's W6 finding (C:695) becomes a matrix test instead. Correct the cycle sentence in C:602 and D:522-523.

### 1.4 Which McLeod stop id is used
- A: `load_stops.mcleod_stop_id` from S0 (A:41-147, A:565), keyed for stability.
- C: `queueStopActual` "resolves stop_id + baseline from `mcleod_dispatch_stops` (org, company, movement, movement_sequence = seq)" (C:612-613).
- D (ETA): "joins its own `mcleod_dispatch_stops` by (company_id, movement_id, movement_sequence = seq)" (D:1039); D MK4.0 same (D:77-78).
**Resolution.** After S0 every McLeod stop write reads `load_stops.mcleod_stop_id` (exported from `loads`), never seq-matching — seq is exactly what McLeod re-sequences (A:99-101). D's ETA job takes the id from the loads export it already calls (`latestStopPredictions`, D:1038) extended with `mcleod_stop_id`.

### 1.5 Kill switches — three different designs
- A: env `MCLEOD_WRITE_COMPANIES` (comma list, API) (A:650-655).
- C: three locks — API env `MCLEOD_API_WRITES` `"true"|"false"` (C:702), org/kind rows in `mcleod_write_switches` `off|test|live` (C:396-410, C:703), VM line `MCLEOD_API_WRITES=on` + `MCLEOD_WS_WRITE_COMPANIES` (C:122-124, C:704). Same variable name `MCLEOD_API_WRITES` on API and VM with different value vocabularies (`true` vs `on`).
- D: table `mcleod_write_kinds_enabled(org_id, kind, enabled_at, enabled_by)` "or the pipeline spec's equivalent" (D:26); sub-flags `image_upload.kinds text[]` (D:452), `driver_update` sub-flags `fields`, `lifecycle`, `medical` (D:529-530); env `MCLEOD_ETA_WRITE_MINUTES` (D:1036).
**Resolution.** C's three locks are the design (D-MKT3). Delete A's `MCLEOD_WRITE_COMPANIES` (A:650-655, A:744, A:761) — the company restriction is C's `test_company_id`/`canary_targets` + VM `MCLEOD_WS_WRITE_COMPANIES`. Rename the API env to `MCLEOD_API_WRITES_ENABLED` (true/false) to stop the name clash with the VM's `on`. D's sub-flags become separate kinds in C's registry (`image_upload_office`, `image_upload_stop`, `driver_update_fields`, `driver_update_lifecycle`, `driver_update_medical`, `driver_create`, `tractor_update`, `trailer_update`, `stop_eta_update`, `home_time_event`, `home_time_fields`), each with its own switch row — C's `kind` regex already admits them. `MCLEOD_ETA_WRITE_MINUTES` stays as cadence only, not as a lock.

### 1.6 Agent endpoints and file homes
- Agent routes: A `GET /api/tms/writes?limit=`, `POST /api/tms/writes/:id/outcome` (A:667-671); C `POST /api/tms/mcleod-api/writes/claim`, `/writes/:id/settle` (C:581-582); D `POST /api/tms/mcleod/image-categories`, `GET /api/tms/mcleod/image-sends/:id/file` (D:309-310).
- API dirs: A `apps/api/src/modules/mcleod/writes/` (A:620, A:666); C `modules/mcleod/mcleodApi/*.ts` + `routes/tmsMcleodApi.ts` (C:73); D `modules/mcleod/images/`, `modules/mcleod/writes/{driverCreate,etaWrite,homeTimeWrite}.ts`, `routes/officeWrites.ts`, `routes/tmsImages.ts` (D:283, 307, 524, 558, 1037, 1097).
- Agent: C `writeLoop.mjs`, `writeAdapters.mjs` at the agent root (C:68); D `tools/mcleod-agent/images.mjs`, `writes/rowMap.mjs`, `writes/rowUpdate.mjs`, `writes/driverCreate.mjs` (D:313, 466, 498, 569). **`windows/manifest.mjs:28` ships only top-level `*.mjs`** (plus three review files) — D's `writes/` subdirectory would never reach the VM, and the VM's pre-start test run would not include it.
**Resolution.** One prefix `/api/tms/mcleod-api/*` for every agent route (C). D's agent code as root-level files `writeDriver.mjs`, `writeUnit.mjs`, `writeImage.mjs`, `rowMap.mjs` registered in C's `ADAPTERS` (C:551-554), or extend `manifest.mjs` to ship `writes/*.mjs` in the same PR (explicit list, with its test). API code under `modules/mcleod/mcleodApi/` with one sub-folder per kind family.

### 1.7 Office retry / resolution
- A: `POST /api/dispatch/loads/:id/stops/:stopId/mcleod-write/retry` (`origin='office_retry'`, `supersedes`) and `…/keep-mcleod` (A:675-681).
- C: no retry route; only `GET /api/mcleod/writes` (C:592); stale intents after 72 h → `conflict stale_intent` (C:489-491). A has no stale rule.
- D: "Send again" creates a new request with uuidv5 `/retry-<n>` (D:393-395).
**Resolution.** v2 adopts both A's retry/keep routes (generalised: `POST /api/mcleod/writes/:id/retry|dismiss`, gate per kind's owning section) and C's 72-h stale rule. A request's supersede link (A's `supersedes`) is added to C's table — needed by D's retry too.

### 1.8 Driver-facing display of McLeod refusals
- A: C-K3 `McleodWriteIssues.tsx` in Settings, no Retry (A:684-696).
- C: "Driver app: unchanged UI in MK3 … a later plan item; not a dependency" (C:720-722).
**Resolution.** Rule one. Recommend A (the driver should see "dispatch will fix this"), built in the same app release as MK3.

### 1.9 Office display of write state
- A: text on `DispatchLoadDetailPage.vue` stop row + buttons (A:699-703).
- C: `StopMcleodWriteBadge.vue` reading `GET /api/mcleod/writes?source_ref=…` (C:716-719), but the route at C:592 accepts only `status=&since=`.
- D: per-kind status lines on load detail via `detail.ts` (D:405-409).
**Resolution.** One component (`McleodWriteState.vue`) used by stop rows, image lines, driver/unit chips; `detail.ts` returns write state per stop (A:682) — no extra browser fetch; drop C's `source_ref` query.

### 1.10 Field name of the action id
A `action_id` (A:507-516); C `input.client_action_id` (C:610-611, C:695). **Resolution:** `action_id` (A's, it is the contract field shipped in N7).

### 1.11 Migration numbers and labels
- B: "the 2026-11-19 value is 0637 and 0638" (B:12-13). C: "`<next>_mcleod_api_transport.sql` (… 0637 today)" (C:71). **Both claim 0637.**
- Label collision: A's **M-A** = `NNNN_driver_loads_mcleod_channel.sql` (A:159); B's **M-A** = `M-A_mcleod_dispatch_stop_references.sql` (B:164).
- A's merges named **C-A1..C-A3, C-K2, C-K3** (A:243, 657, 684) collide with spec letter C and A's own finding ids C1–C7 (A:25-33). C's sign-off moments **S1/S2** (C:887-888) collide with A's step **S0a/S0b/S0c** (A:47-147).
**Resolution.** v2 assigns one global sequence of PR ids (e.g. `K01…K40`) and migration placeholders `MIG-01…MIG-17` in merge order; the real number is taken at build time. Rename sign-offs to `SO-1/SO-2`.

### 1.12 `driver_complete_stop` rewritten three times, `load_stops` writer rewritten twice
- A M-A replaces it (+`p_action_id`, `p_mcleod_write`, tms gates) (A:282-305); A M-K1 replaces it again (enqueue) (A:628-655); D M-D2 replaces it (sha256) (D:267-269, D:1127). D's text is written against 0141 ("`driver_complete_stop` stores `elem->>'sha256'`"), not against A's body.
- A S0b turns `mirrorLoads.writeStops` into an RPC with an **explicit** projected-column list that omits `reference_numbers` (A:91-95, A:124-128); B5 says "`writeStops` already spreads `...s`" (B:373-374) → after S0, B5's `reference_numbers` would be silently dropped.
**Resolution.** v2 orders the three function rewrites and says each `create or replace` starts from the previous migration's body (with a matrix test from each step re-run). Add `reference_numbers` to `apply_mcleod_load_stops`'s update list in S0c (or B5 ships its own `create or replace` of the RPC after S0a), and fix B:373-374.

### 1.13 Required photos (N5) vs S0b
- B1 edits `mirrorLoads.ts:118-120` and `tmsLoadIngestWriters.ts:155-157` (B:94-97).
- A S0b: "`MCLEOD_REQUIRED_PHOTOS` is NOT added here — N5 owns it; S0b keeps `mirrorLoads.ts:120`'s literal and moves it into the RPC payload" and deletes `tmsLoadIngestWriters.writeStops` (A:122-133). Name mismatch too: A says `MCLEOD_REQUIRED_PHOTOS`, B defines `REQUIRED_PHOTOS_BY_STOP_KIND`/`requiredPhotosFor` (B:82-90).
**Resolution.** B1 merges before S0b (B1 has no prerequisites); S0b then calls `requiredPhotosFor` and deletes the tmsLoadIngestWriters copy. Fix A:122 name.

### 1.14 Shared load contract edited twice
- A C-A1 adds `external_status`, `actual_arrival_at`, `actual_departure_at` to `loadStopSchema` "(nullable …; N4 adds the rest)" and `source` **required** (A:239-241, A:331-333).
- B4 adds `actual_arrival_at`, `actual_departure_at` etc. via `stopMcleodFactsSchema` with `.nullable().default(null)` and states "Every new driver-contract field is `.nullable().default(null)`" so release order does not matter (B:147-149, B:326-335).
**Resolution.** All McLeod fields (incl. `external_status`) live once in B's `stopMcleodFactsSchema`; whichever of C-A1/B4 merges first creates `loadMcleodFacts.ts`. `source` follows D-MKN4.6 (`.default("manual")`?) — or keep A's "API a release ahead" rule but then say B's rule does not apply to `source`. Pick one in v2.

### 1.15 Q-LMR2 / Q-MK3 status
- B: "the two are never merged (Q-LMR2 is open)" (B:401); D-MKN9.1 "Q-MK3 as proposed" (B:761).
- HO: "treat every Q-MK recommendation as approved 2026-11-19" (HO:24-25); A treats Q-MK3 as ruled (A:8-10, A:31).
**Resolution.** Edit B:401 and B:761 to "ruled 2026-11-19 (Q-MK3)".

### 1.16 Finance via API (v1) vs SQL (all others)
- v1: "**MK2** | **Finance through the API** — the live GL/AP/settlement reads that end the frozen `lme_analytics` restore" (v1:222) and Q-MK15 "The kit's **read** side for finance … is MK2" (v1:197-198).
- SURF:97 "No GL, ledger, AP voucher or fuel service … Finance reads stay on SQL grants."; HO:38-40; C:315-316; D-MK2-1 (D:826-837).
**Resolution.** v2 MK2 = SQL grants (D §MK2). Already agreed by all but v1.

### 1.17 Home time endpoint
- v1 Q-MK2: "driver availability (Symphony or driver fields)" (v1:133); v1 MK6 "B-MK8 for home time" (v1:226).
- SURF:92 "`driverAvailable` (= HOS available hours, **not home time**)"; D uses `PUT /equipStatus/create` or `RowDriver` `next_home_date`/`pta_date` (D:1080-1081); C U16 "Symphony … no effect on this spec" (C:800).
**Resolution.** v2's D-MK2 table row: home time → `equipStatus/create` (H1) or `/driver/update` fields (H2), per D's probe; Symphony is not needed for home time; B-MK8 then blocks nothing in the plan except the ack-to-McLeod that v1 Q-MK4 already rules out.

### 1.18 Termination/rehire semantics
- v1 Q-MK2: "Termination / rehire | office | driver update" (v1:129).
- D: termination via end-employment route; **rehire is not a roster button** — a return comes back through Hiring and the create request is "converted in place to a reactivation" (D:575-578, D:650-658); HO:122-123 agrees.
- C's guard: "`id, org_id, kind, … payload …` fixed (MW003)" (C:465-466) — **an intent cannot be converted in place** (kind and payload are immutable).
**Resolution.** D's step 2 settles the `driver_create` request `conflict` with reason `returning_driver` and the API enqueues a new `driver_update_lifecycle` reactivation request (superseding). Update v1's table row.

### 1.19 Documents: order vs movement vs stop
- v1 Q-MK2: "DocumentPower image on the order" (v1:127); Q-MK8 mapping "to McLeod's image categories (`imapcats`) in one table" (v1:165-166).
- D-MK4-1: order (rowId = `loads.ref`), with MK0 fallback (ii) movement (D:85-108); D-MK4-3: **two** tables, categories from `/ws` `documentTypes`, `imapcats` only displayed beside (D:127-179).
- HO:117-118 agrees with D. No spec attaches to stop.
**Resolution.** Consistent except v1's "imapcats in one table" — v2 says D's two tables, `/ws` ids.

### 1.20 Who signs off, and how often
- HO:108-109 / C:886-888: "Owner sign-off is needed at exactly two moments: S1 — the first `test`→`live` switch for a kind … S2 — only if U8 = none".
- "for a kind" × D's ≥ 9 kinds = ≥ 10 sign-offs; D's rollout says "each after its test-company pass" (D:808-811) without naming a sign-off; D's revised-RC read switch: "no separate approval step: the rule is the approval" (D:354-355); A: "live company only on the owner's word" (A:744-745).
**Resolution.** v2 states: SO-1 is per kind (list them), or rules that after the first kind goes live, later kinds go live on the P-report alone. Owner decides once.

### 1.21 MK3 prerequisite chain
- A: "Steps 1–7 need no API Kit and can ship now; 8–10 can ship dark (switch empty) before MK0" (A:747) — i.e. M-K1/C-K2 (enqueue) ship before MK0.
- C PR-7 (MK3 enqueue) needs "N7 merged; U9–U12 resolved; P1–P6 passed on the test company" (C:884).
- C's proving run P1–P6 needs a confirmed `mcleod_write_requests` row (`proven_by_request`, C:403, C:408) — which only exists if the enqueue path is merged. **P1–P6 cannot pass before PR-7, and PR-7 needs P1–P6: a cycle.** `--api-prove` (C:804-806) has no specified way to create the request row.
**Resolution.** Adopt A's order: enqueue ships dark (switch row absent = off). `--api-prove` creates its request through a service-role route `POST /api/mcleod/writes/prove` (admin-only, test company only) or by switching the kind to `test` and completing a stop on the test company's load. PR-7 then needs only N7 + S0b.

### 1.22 Messages to Alex and McLeod — four drafts where the rule is one each
- B: `tools/mcleod-agent/review/REQUEST-TO-ALEX-<date>-REFERENCES.md`, "one complete message" (B:262-266).
- C: E1–E9 to Ron, A1–A3 to Alex (C:85-102).
- D: Parts 3/4/5 + `drs_check`/`gl_summary` to Alex, "ONE message" (D:907-911).
- HO:136-137: "**one** message to McLeod via Ron and **one** to Alex".
- C's E4 role list (C:94) omits operations D needs: `PUT /driver/update` (TableRowService), `GET /drivers/{id}`, `GET /drivers/new`, `GET /drivers/search`, `GET /images/{rt}/{id}/documentTypes`, `GET /images/…`, `POST /images/…`, `GET /tractors/{id}`, `GET /trailers/{id}`, `PUT /callins/create`, `PUT /stop/update`, `PUT /equipStatus/create`; D:1025-1026 says ETA role "added to the pipeline spec's B-MK4 role list" — it is not there.
**Resolution.** v2 writes one Alex message = C's A1–A3 + D's Parts 3/4/5 grant list + B's reference-routine review (with B's dated "apply after" instruction), and one McLeod message = C's E1–E9 + D's Appendix C questions that McLeod can answer + the full operation list above in E4.

### 1.23 Scheduler lanes and owners
- D image sender: "lane = the one `api`" (D:302-303); ETA job "lane `general`, owner `api`" (D:1035); home time "lane `general`" (D:1097); C watch "lane `general`" (C:676).
- Lanes are only `egress` and `general` (`apps/api/src/schedulerLanes.ts:29`). None of these calls a vendor (the VM does), so `general` is right. Fix D:302-303.

### 1.24 Pipeline audit rows
- D-MK5-0e: pipeline state changes write `audit_logs` "`action = 'mcleod.write.<state>'`, written by the pipeline's result route — one place" (D:515-519).
- C's settle route writes no audit row (C:582, C:502-511).
**Resolution.** Add the audit write to C's settle route (or rule that `mcleod_write_attempts` IS the trail and drop D:517-519).

### 1.25 Smaller contradictions
- D internal: truck status route `POST /api/roster/vehicles/:id/mcleod-status` (D:708) vs `POST /api/mcleod/vehicles/:id/status` (D:713). Keep the second (D-MK5-0g).
- D "a stop completed" is a server-born intent with uuidv5 id (D:43-44) vs A/C: the stop write id is the client action id (A:558, C:346). For **images** server-born is right (D's sweep); the sentence about "a stop completed" should say "a stop's papers".
- C `requested_by uuid references auth.users on delete set null` (nullable, C:355) vs A `not null` (A:571). D's server-born kinds have no user → C's nullable wins.
- C target_type list `('stop','movement','order','driver','tractor','trailer')` (C:350) lacks D's `driver_status` event target (home time H1, D:1080). Add it.
- v1 B-MK list ends at B-MK10 (v1:41-50); D adds **B-MK11** "DocumentPower not exposed on our `/ws`" (D:103). Add to v2's table.
- D-MK5-0g listed before D-MK5-0f (D:521, D:529); D-MK5-1c with no 1a/1b (D:597). Renumber.
- C says `tms.ts` is 499/500 lines (C:72) — confirmed 499; D adds `MCLEOD_UNIT_STATUS_REQUESTS` "in `packages/shared/src/tms.ts`" (D:683) and `statusEditRoute` (D:678) → `lint:filesize` fails. Put both in `packages/shared/src/mcleodUnitStatus.ts`.
- `DispatchLoadsPage.vue` is 496/500: A C-A1 edits `DispatchLoadsPage.vue:479` (A:460); B4 first extracts `LoadRefCell.vue` (B:404-405). If C-A1 lands first, it must not add lines there (the headline comes from `useLoadDispatch.ts` — say so) or must wait for B4.
- `me.ts` is 444 lines: A adds the ack route (+15, A:431-433), B6 adds the planned read (B:720-723), C PR-7 edits the stop route (C:73). Combined > 450 warn, close to 500. v2: first PR moves the five load routes to `routes/meLoads.ts` (A's own fallback, A:433).
- `handlers.ts` (driver app) edited by A C-A2 (`action_id`, A:512-514) and D M-D2 era (`p_photos[].sha256`, D:209-212). Same file, sequence them.
- C claims `/api/version` "must not reveal a carrier's integration state" (C:273-274) while v1 MK0 asked for "`GET /api/version`-style health line" (v1:220). C's reading is right; update v1 text.
- C §5.10 says "N4 already adds McLeod actuals to the contract" (C:718-719) — true only after B4/A C-A1; list as a prerequisite of C's badge.
- A's budget basis "99.3 movements/day × ~2.3 stops" (A:612) vs C's "≈160 loads × 3 stops × 2 sides" (C:864) vs D's "~210 stops/day" (D:441). One measured number in v2.
- C:702 "Flip = Railway/AWS variable"; A:653 "documented beside RUN_SCHEDULERS_IN_PROCESS in docs/DEPLOYMENT.md". Owner rule (memory `never-railway-we-are-on-aws`): AWS only; drop "Railway".
- C:18 and D:21 describe states `queued → sent → confirmed | refused | conflict`; C's guard also allows `sent→queued` and `queued→conflict` (C:466-467) — v2 states the full state machine once.

---

## 2. Places still open

Legend: **CLOSED-ELSEWHERE** (cite), **CLOSED-NOW** (I checked the repo), **OPEN** (what closes it).

### v1 / SURF / HO
| Where | Text | Status |
|---|---|---|
| v1:3, v1:241-247 | every D-MK "proposed"; Q-MK1..15 "Open questions" | CLOSED-ELSEWHERE: HO:23-25 "treat every Q-MK recommendation as approved 2026-11-19"; v2 must restate them as D-MK with status "ruled 2026-11-19, owner verifies" |
| v1:62 | "Nothing below changes until the owner re-rules it" | OPEN → v2 §re-rulings with replacement text per doc (see §5 below) |
| v1:161-162 | "If McLeod cannot give one, the owner rules whether the first write may run live" | CLOSED-ELSEWHERE: C U8 "none" row (C:790) + sign-off S2 (C:888) |
| v1:167-168 | revised-RC reading moves to API "only if the API exposes it" | CLOSED-ELSEWHERE: D §MK4.4 switch rule (D:340-369) |
| v1:180-181 | "Needs: McLeod's required-field list for `drivers/create`" | CLOSED-ELSEWHERE: D MK0 check 7 (D:589-595, D:1161) |
| v1:228-230 | "Driver screens the API enables (each its own small plan after MK3)" — detention/lumper report, fuel receipt photo, roadside request, home-time request, ETA, navigation | **OPEN** — in no spec. v2 must either place each or rule "out of this plan, own plan after MK3" with the reason (see §6) |
| v1:234-237 | §6 gates: real phone, store, Apple Individual, SMS consent Q-LMR9, Samsara write token | **OPEN** — no spec owns them; D:452-453 depends on "the app's release gate … decides who that is". v2: name the driver-app release step as a prerequisite of C-A2/MK3/MK4-bol rollout, owned by `docs/plans/drivers-app/RELEASE-GATE.md` |
| SURF:21 | "Token expiry not stated" | CLOSED-ELSEWHERE: C §3.2 rule 3 + U4 (C:161-166, C:779-782) |
| SURF:46-47 | "No stop ETA write found … `RowStop` type page not yet read … candidate `PUT /stop/update`" | CLOSED-ELSEWHERE: C U12 (C:795) for field names; D MK6.1 step 2 (D:1016-1029) for ETA path |
| SURF:105-107 | "Still unread on tms-map" list | CLOSED-ELSEWHERE: C §3.5 Phase A step 7 crawls the types pages (C:227-230). `PUT /orders/create` (D-MK4: not used) and `/symphonymcmessages/position` (not used) need no read — v2 should say so |
| HO:134-135 | B-MK10 meeting notes + Ron email "ask the owner for them once" | **OPEN** — no spec closes it. Closes: one line to the owner in v2's ask list; and v2 states no build step depends on B-MK10 (every B-MK1..9 has an MK0 check) |
| HO:113-115 | PU may be "Previous BOL #" | CLOSED-ELSEWHERE: B V1 outcomes A/B/C (B:416-457) |
| HO:125-126 | "ETA write waits on DB7 (never recorded as run)" | CLOSED-ELSEWHERE: D MK6.1 step 1 table (D:1002-1009) |

### A
| Where | Text | Status |
|---|---|---|
| A:29 | "Flag for the owner: confirm in one line" (co-driver rule C3) | **OPEN** → v2 decision (HO:97-99 says so); owner verifies |
| A:217-218 | "confirm on PGlite that `anon` can execute the wrapper" | CLOSED-ELSEWHERE: matrix test "an anonymous read of loads is filtered, not an error" (A:266) |
| A:287-289 | "extend `assert_driver_load` to return status and source, **or** a second `select`" | **OPEN** (a build choice) → pick: a second `select` (keeps `assert_driver_load`'s signature, which A:220-224 also replaces in the same migration — one change, not two) |
| A:432-433 | "if it would cross 500, move the five load routes to `routes/meLoads.ts`" | **OPEN** → close by doing the split first (B6 and C PR-7 also add to `me.ts`, §1.25) |
| A:547-549 | "whether `clearStop` accepts `departureDate` alone is unknown … The agent spec decides" | Conflicts with C U10 (§1.2); OPEN until v2 picks one rule |
| A:550 | odometer `hub` "Samsara's is a later D-MK2 row" | **OPEN** → v2: rule "not sent in this plan" with reason (no trusted odometer at the stop moment; `samsara-distance-is-an-odometer-difference`) |
| A:744-745 | "live company only on the owner's word" | CLOSED-ELSEWHERE: C SO-1 (C:886-887) |

### B
| Where | Text | Status |
|---|---|---|
| B:97 | "if it is typed as `string` there, narrow with the contract's own enum" | CLOSED-NOW: `apps/api/src/modules/mcleod/tmsLoadIngestWriters.ts:27` types `kind: string` → narrowing is required; moot if S0b deletes that writer first (§1.13) |
| B:208-212 | Step 0: the statement "assumes" `reference_qual`/`reference_number` column names | CLOSED-ELSEWHERE: Step 0 measures them before the statement is written (B:208-209) |
| B:401, B:761 | "Q-LMR2 is open", "Q-MK3 as proposed" | CLOSED-ELSEWHERE: HO:24, A:8-10 |
| B:449-451 | V1 pass: "within the board's churn", "roughly a third" | **OPEN** (acceptance is not a number) → v2: `not_read = 0` AND P8-or-PU on 25–45 % of open movements AND P8 count ≥ PU count; else the three-load check decides alone |
| B:262-266, B:418 | owner sends a separate Alex message | Merge into the one Alex message (§1.22) |
| B:743, B:803 | "(or the existing me route test)", "`dispatchBoardView.test.ts` / a new `DispatchBoardTable.test.ts`" | OPEN (cosmetic) → name the file |
| B:841 | "Mark Q-MK9 and Q-MK10 ruled as recommended by the owner's 'proceed'" | CLOSED-ELSEWHERE: HO:24 |

### C
| Where | Text | Status |
|---|---|---|
| C:316-317 | "the close read until the change read covers V/D status" | **OPEN** → v2: close read stays SQL in this plan (no parity feed defined for it) |
| C:720-722 | driver-side refusal list "a later plan item; not a dependency" | **OPEN** — contradicts A §6.5 (§1.8) |
| C:769-770, 774, 778, 802 | terminal "blocked" outcomes (no 22.1 /ws, no clearStop, http only, one company id, Alex says no) | Closed as decision tables, but v2 must state the product consequence in each (driver tap stays evidence; N9 shows it; office keys McLeod) — C says it only for U1 |
| C:802 | "MK1 parity may still run (reads only — confirm separately in A1)" | **OPEN** → A1 (C:100) asks only for writes; add "and API reads from the VM" to A1 |
| C:804-811 | P1–P6 need a confirmed request; `--api-prove` creates none | **OPEN** — cycle (§3) |
| C:860 vs C:878-884 | "functions in PR-1, their TS callers in PR-2" vs build table (callers in PR-3) | **OPEN** (internal) → "PR-3" |
| — | Test company loads never reach 360: the connector reads ONE company (`connector.example.env:19-20`: "`MCLEOD_COMPANY_ID=TMS` … TMS2/TMS3 are never read"; `agent.mjs:175`) | **OPEN, not mentioned by any spec.** A driver cannot complete a stop on a test-company load (MK3 proof), D's image candidates (D:285-292) and ETA/home-time jobs cannot find test rows. Closes: a C/A step that adds the test company to the loads feed (second SQL company or second server profile, matching U8's two answers) with the board/finance filtering it out, or a proving run that enqueues synthetic requests directly. v2 must pick |

### D
| Where | Text | Status |
|---|---|---|
| D:19, D:26, D:46, D:200, D:551, D:1025 | "the pipeline spec's name wins", "or the pipeline spec's equivalent", "added there if absent", `mcleod_api_capabilities` "pipeline spec", "synchronous read lane if the pipeline spec has one", "added to the pipeline spec's B-MK4 role list" | **OPEN** — all resolved by §1.1/§1.5/§1.22. C has no synchronous read lane → D:551's "otherwise" branch applies |
| D:48-50 | "`uuid` is already an api dependency — confirm … if absent, use `node:crypto`" | CLOSED-NOW: `apps/api/package.json` has no `uuid` → the 12-line `node:crypto` helper |
| D:210-212 | "check `apps/driver/package.json` for `expo-crypto`; add it if absent" | CLOSED-NOW: `apps/driver/package.json:46` `"expo-crypto": "57.0.1"` |
| D:272-274 | M-D3 `source` column "whichever merges first owns it" | **OPEN** → `0601_lumper_case_files.sql:23` has only `kind in ('revised_rc')`, no `source` → rule now: the LRC build's migration owns `source`/`mcleod_image_id`; MK4 lists the LRC build as a prerequisite |
| D:407-409 | load detail reads `mcleod_image_sends` "in `detail.ts`" | **OPEN** — `detail.ts` is `loads`; `mcleod_image_sends` is `mcleod` (`lint:table-access`). Close: an `mcleod` export `imageSendsForStops()` read through `loads -> mcleod` (edge exists, `check-feature-boundaries.mjs:399`) |
| D:452-453 | bol/pod "for the fleet whose drivers use the 360 app" | **OPEN** → depends on driver-app release (v1 §6) |
| D:763 | "if [`drivers.ts`] crosses 450 lines the new route goes in `routes/driverMcleodEdit.ts`" | Contradicts D-MK5-0g (the route is in `mcleod/routes/officeWrites.ts`, D:739) → delete the sentence |
| D:937-942 | M-D6 "if the row has no column for it" (module `financial`) | CLOSED-NOW: freshness is read from org-owned `jobs` (`apps/api/src/modules/financial/financialFreshness.ts:160-172`; `table-modules.json`: `jobs` module `org`), which has `stats jsonb` (`supabase/migrations/0027_jobs.sql:13`) → put `source_db` in `jobs.stats`, drop M-D6 |
| D:966-967 | F12b "write by set-based RPC" | **OPEN** — the RPC appears in no migration in Appendix A (D:1122-1135) → add to M-D7 |
| D:1081 | H2 "if step 1's agreement shows a different reading, the mapping … follows the measurement" | **OPEN** → write the alternative mappings out (as B's V1 does) or rule H2 needs the owner's one-line confirmation of the measured meaning |
| D:1059 | "Q-HT1 … is open as a fact" | CLOSED-ELSEWHERE: D's probe H1/H2/H3 (D:1064-1084) |
| D:354-355 | revised-RC switch "the rule is the approval" | see §1.20 — owner must accept that sign-off count |

---

## 3. Dependency graph

`→` = must be merged (and where stated, live on staging/production) before.

### 3.1 Every merge, with prerequisites as written
**A (driver loads)** (A:731-747)
- A-S0a mig (`load_stops.mcleod_stop_id`, `apply_mcleod_load_stops`) — none
- A-S0b code → S0a current on staging
- A-M-A mig (visibility fn, policies, `assert_driver_load`, `driver_complete_stop` v2, ack fn, `load_action_seen`, `load_events` kind) — "may merge in parallel with S0b" (A:735)
- A-C-A1 api+shared+web → M-A current (prod: M-A released first)
- A-C-A2 driver app → C-A1 in production
- A-C-A3 (action id required) → C-A2 in production
- A-S0c mig → ≥1 release after S0b in production
- A-M-K1 mig (write tables, `driver_complete_stop` v3) → S0b live
- A-C-K2 api+web → M-K1 current; A-C-K3 app → C-K2 in production

**B (data fixes)** (B:44-59)
- B1 (N5) — none · B6 (N8) — none · B7 (N9) — none
- B2 mig M-A + M-B — none (must merge alone)
- B3 (N6) → B2 on staging · B4 (N4a + agent) → B2 on staging
- V1 → B4 in production + VM updated (Alex) · B5 (N4b) → V1

**C (transport)** (C:874-884)
- C-PR1 mig (6 tables, 4 fns) + discovery/health/parity routes — none
- C-PR2 agent client + Phase A — none
- C-PR3 claim/settle/switch API, watch, web → PR1
- C-PR4 agent write loop + `--api-prove` → PR2
- C-PR5 docs parser → Phase A ran (needs PR1 routes, PR2 on VM, E1–E9, A2, A3)
- C-PR6 parity job → U1 present
- C-PR7 MK3 enqueue → N7, U9–U12, P1–P6

**D (office/finance/docs)** (D Appendix A + text)
- M-D1 (image tables + `mcleod_enqueue_image_send` RPC) · M-D2 (sha256 + `driver_complete_stop`) · M-D3 (lumper kind) → before receipt UI
- MK4 code (candidates/assemble/enqueue/scheduler/routes) → M-D1 (RPC reader a merge later); app sha256 → M-D2
- M-D4a, M-D4b → readers next merge; `applyDriverUpdate` refactor; officeWrites routes; M-D5
- MK2: GRANTS file edit → Alex runs Parts 3/4/5 → `financeCompare.mjs` → VM switch; M-D6; M-D7 + ingest
- MK6: DB7 → path check → M-D8 → `etaWrite`; probe → M-D9 → `homeTimeWrite`; roster contract fields → ingest

### 3.2 Cycles
1. **C-PR7 ↔ P1–P6.** PR7 needs "P1–P6 passed on the test company" (C:884); a `live` switch needs `proven_by_request` = a confirmed request (C:403, C:408), and requests of kind `stop_*` are created only by PR7's enqueue (C:601-615). `--api-prove --stop=<id>` (C:804) does not say how its request row is created. **Break:** A's order (enqueue ships dark, A:747) + `--api-prove` creates its request via an admin-only, test-company-only API route.
2. **Same shape for every D kind**: each kind ships disabled and goes live only after a confirmed test-company request (D:26, D:529-531), and test-company rows never reach 360 (single-company connector, §2 C). Break as above + the test-company feed step.

### 3.3 Missing prerequisites
- **A-M-A before S0b in production.** HO:95-96: "S0 precedes N2 and MK3". A:735 lets M-A merge "in parallel with S0b", and C-A1 depends only on M-A — so N2 (approved loads visible + `assert_driver_load` admitting them) can be live while stop ids still churn (A C1, A:27). Fix: C-A1 → S0b in production.
- **B5 → an RPC change.** After S0b, stops are written by `apply_mcleod_load_stops` with a fixed column list (A:91-95); B5 assumes `writeStops` spreads `...s` (B:373-374). B5 needs a migration adding `reference_numbers` to the RPC's update list (and B2's column must exist first — it does).
- **B1 → S0b** (§1.13), else S0b moves the literal and B1 edits a deleted writer.
- **D M-D1 → C-PR1** (`mcleod_enqueue_image_send` inserts into `mcleod_write_requests`, D:296-301). Not stated in D.
- **D M-D2 → A M-A and A M-K1** (three rewrites of `driver_complete_stop`). Not stated.
- **D MK4/MK5 office routes → C-PR3** (switch table + claim) and agent adapters → C-PR4. D says only "the pipeline spec".
- **C-PR4 `--api-prove` → C-PR3** (claim/settle routes). C:881 lists only PR-2.
- **C badge (§5.10) → B4 / A C-A1** (McLeod actuals in contract, C:718-719).
- **MK4 → LRC build** (`lumper_case_files.source`, D:270-274) — unstated as a hard prerequisite.
- **MK3/MK4/MK5/MK6 proofs → test company in the SQL feed** (§2, not in any spec).
- **D home-time probe → C-PR2 on the VM + read role** (probe uses `/ws` reads, D:1064-1074; role list C:94 lacks `/drivers/{id}` and RowDriverStatus reads).
- **B4 → `LoadRefCell.vue` extraction before A C-A1 touches `DispatchLoadsPage.vue`** (496/500).

### 3.4 Used before created
- A M-K1 creates `mcleod_write_requests` (A:557) and C-PR1 creates `mcleod_write_requests` (C:345) with **different shapes**, both `create table if not exists` — whichever runs second **silently keeps the first shape**; every later function fails at run time. Highest-risk item in the set.
- D reads `mcleod_api_capabilities` (8 places) — created nowhere.
- D's `mcleod_write_kinds_enabled` (D:26) — created nowhere.
- D's `packages/shared/src/mcleodWriteContract.ts` (D:46) — created nowhere.
- B5 writes `load_stops.reference_numbers` through an RPC that does not list it (above).
- A C-K2's `mcleodWriteEnabledFor(env, …)` reads `MCLEOD_WRITE_COMPANIES` — replaced by C's switch (§1.5).

### 3.5 Same file, conflicting edits
| File | Edits |
|---|---|
| `supabase/migrations/0637_*` | B2 (B:12) and C-PR1 (C:71) |
| `driver_complete_stop` (SQL) | A M-A (A:282), A M-K1 (A:628), D M-D2 (D:267) |
| `apps/api/src/modules/loads/mirrorLoads.ts` | A S0b (RPC, A:124-128), B1 (A:94), B3 (`external_unmatched`, B:593-594), B4/B5 (`bol_number`, `pickup_number`, B:309, B:373) |
| `apps/api/src/modules/mcleod/tmsLoadIngestWriters.ts` | B1 edits (B:96); A S0b deletes `writeStops` (A:133) |
| `apps/api/src/modules/loads/driverLoads.ts` | A C-A1 (rpc visibility, `LOAD_COLUMNS += source`, `STOP_COLUMNS += actual_*`), A C-K2, B4 (`LOAD_COLUMNS`, `STOP_COLUMNS`, B:339-342) |
| `packages/shared/src/loadsContract.ts` | A C-A1 (`source`, `acknowledged_at`, stop actuals, moves `nextStop` etc. out), A C-K2 (`mcleod_write`), B1 (`REQUIRED_PHOTOS_BY_STOP_KIND`), B4 (`.extend(...)`) |
| `apps/api/src/modules/driver-app/routes/me.ts` (444) | A C-A1, B6, C-PR7 |
| `apps/driver/src/data/handlers.ts` | A C-A2 (`action_id`), D (sha256 in `p_photos`) |
| `apps/web/src/pages/DispatchLoadsPage.vue` (496) | A C-A1 (`:479`), B4/B5 (extraction + PU line) |
| `apps/web/src/pages/DispatchLoadDetailPage.vue` | A §3.5/§4.5/§6.6, B3 (banner), B4 (facts), C (badge), D (image lines) |
| `packages/shared/src/tms.ts` (499) | D (`MCLEOD_UNIT_STATUS_REQUESTS`, `statusEditRoute`) — budget overflow |
| `scripts/table-writers.json` / `table-modules.json` / `RETENTION_FORBIDDEN` | A M-K1, C-PR1, D M-D1/4a/7/8/9 — the A/C table entries conflict |
| `tools/mcleod-agent/review/SILVICOM-GRANTS.sql` / `SILVICOM-READ-ROUTINE.sql` | B4 (references routine), D (Part 4 lines) |
| `tools/mcleod-agent/agent.mjs` (1,156 lines) | B4 (references), C-PR2/4/6 (flags, `fetchFromMcleod` removal), D MK2 (compare flag, copy guard), D MK4.4 (`LUMPER_IMAGE_SOURCE`) |
| `docs/DEPLOYMENT.md` | A (env beside `RUN_SCHEDULERS_IN_PROCESS`), C (L1) — different variable names |

### 3.6 Proposed single order (for v2)
1. B1, B6, B7, `me.ts` split (no prerequisites).
2. A-S0a → A-S0b (+ B1 done) → release.
3. B2 (own number) → B3, B4 → (VM/Alex) → V1 → B5 (+ RPC column) ; A-S0c after S0b release (can carry B5's RPC change).
4. A-M-A → C-A1 (after S0b in production) → C-A2 → C-A3.
5. C-PR1 (the ONE pipeline schema, incl. capabilities, supersede, test-company columns) → C-PR3; C-PR2 → C-PR4; Phase A → C-PR5 → C-PR6.
6. A-M-K1 (now only `driver_complete_stop` v3 calling `mcleod_write_enqueue`) → C-K2/C-K3 (dark) → test-company feed → P-run → SO-1.
7. D: LRC build → M-D1/M-D2/M-D3 → MK4 code; MK5 M-D4a/b/M-D5 → routes; MK2 grants (parallel, no API); MK6 after DB7/probe.

---

## 4. Decision-ID hygiene

### 4.1 Inventory
- **v1:** D-MK1..5 (v1:241-247), Q-MK1..15 (v1:114-198), B-MK1..10 (v1:41-50), steps N1–N9 (v1:206-214), phases MK0–MK6 (v1:220-226).
- **A:** findings C1–C7 (A:25-33); steps S0/S0a/S0b/S0c, M-A, C-A1..C-A3, M-K1, C-K2, C-K3 (A:731-745); codes DL012–DL014, LS001, MW010/MW011.
- **B:** D-MKN4.1–4.8, D-MKN5.1, D-MKN6.1–6.5, D-MKN8.1–8.4, D-MKN9.1–9.3; PRs B1–B7; V1; migrations M-A, M-B.
- **C:** D-MKT1–7; E1–E9, A1–A3; U1–U17; P1–P6; W1–W7; L1–L3; S1/S2; PR 1–7; codes MW001–MW005.
- **D:** D-MK4-1..6, D-MK5-0a..0g, D-MK5-1c, D-MK2-1, D-MK6-1a/b/c, D-HT5a(H1/H2), D-RL5a, D-MR6a, Q-7b, D-MSUX7a (for other plans); B-MK11; M-D1..M-D9 (M-D4a/b); H1–H3.
- `grep -rlE "\b(D|Q|B)-MK" docs` outside these seven files → **no hits**: the D-MK/Q-MK/B-MK families do not collide with any other plan. D-MKN*/D-MKT* also appear nowhere else. D-RL5a, D-MR6a, Q-7b, D-MSUX7a, D-HT5a are free in their target plans.

### 4.2 Reused with a different meaning (inside the set)
| ID | Meaning 1 | Meaning 2 | Fix |
|---|---|---|---|
| D-MK2 / D-MK2-1 | v1:244 field-by-field write list | D:824-826 "finance reads stay on SQL" | rename D's to D-MK8 (next free) |
| D-MK4 / D-MK4-1..6 | v1:246 loads stay in McLeod | D:85-223 document decisions | renumber D's into the v2 sequence (e.g. D-MK9..14) |
| D-MK5 / D-MK5-0a..g, 1c | v1:247 no money writes | D:464-603 office-write rules | renumber (D-MK15..) |
| D-MK6-1a/b/c | no D-MK6 exists | D:1007-1027 ETA outcomes | renumber; make outcomes sub-letters of one decision |
| M-A | A:159 driver-loads migration | B:164 dispatch-stop references migration | global MIG-nn placeholders |
| C1..C7 vs C (spec) and C-A1.. | A's findings / A's merges | spec C | rename A's merges |
| S0 vs S1/S2 | A's stop-identity step | C's sign-offs | rename sign-offs SO-1/SO-2 |
| A1–A3 | C's Alex items (C:100-102) | A's merges C-A1..3 | rename Alex items AX-1.. |
| E5 | C:95 test company request | D:673 "(E5, measured: 39 of 223…)" — another plan's step | qualify D's ("FLEET-CENSUS E5") |
| P1–P6 | C:804-811 proving run | D:829, D:960 "PNL P3", "TRUCK-DRIVER-PNL P1" | rename C's proving cases PR-T1.. or qualify D's |
| C1 | A:27 | D:963 "GO-LIVE C1" | qualify |
| D-MK5-0f/0g order; D-MK5-1c with no 1a/1b | D:521, D:529, D:597 | — | renumber |

### 4.3 Cited IDs that collide with other plans (qualify on every use)
| ID | Definitions | Cited by |
|---|---|---|
| D-TL1 | `dispatch-loads/TRAILER-LINK-PLAN.md:41` (one source per question) and `financial/TOLLS-PER-TRUCK-PLAN.md:174` (transponder history) | v1:175, B:682 (D-MKN8.1), HO:90 |
| D-DB4 | `dispatch-loads/DISPATCH-BOARD-PLAN.md:184` (ETA) and `drivers-app/DRIVER-APP-DIRECTION-B-PLAN.md:112` (radius scale) | v1:226, B:768, D:992 |
| D-FS2 | `mcleod/FINANCIAL-STORE-PLAN.md:64` (EFS authoritative) and `FUEL-SPEND-RECONCILIATION-PLAN.md:536` (unattributed fuel row) | D:969 (means FINANCIAL-STORE's) |
| LR4 | `mcleod/LOADS-MIRROR-PLAN.md:232` and recruitment ads `LR4` (`ADS-AGENTS-AUDIT-2026-11-10.md:113`) | A:33 |
| Q-TL3 | TOLLS-PER-TRUCK:412 and TRAILER-LINK:95 | HO:90 only |
HO:90 already names D-DB4, D-TL1, Q-TL3, LR4 as reused; v2 must write them as `TRAILER-LINK D-TL1`, `DISPATCH-BOARD D-DB4`, `FINANCIAL-STORE D-FS2`, `LOADS-MIRROR LR4`.

---

## 5. Rulings that must be re-ruled

v1 §1 (v1:60-77) lists 12 rows. Memory `mcleod-api-kit-bought.md` lists, in addition, `MCLEOD-READ-ONLY-INTEGRATION-HANDOFF` write policy — **absent from v1 §1**. The grep (`read-only|no write|never write|selects only|nothing … written to McLeod` × McLeod) finds more.

### 5.1 Listed in v1 §1 — located, with the text to replace
| Ruling | File:line (verified) | Says | Replacement (proposed) |
|---|---|---|---|
| owner ruling 2026-09-24 | `docs/plans/mcleod/LOADS-GO-LIVE-PLAN.md:678` ("Owner ruling: loads are a read-only mirror of McLeod") — **v1 cites only LOADS-MIRROR; this is where the 09-24 ruling is logged** | read-only mirror | append a dated log line: "re-ruled 2026-11-19 by MCLEOD-API-KIT v2: loads are still authored in McLeod (D-LMR1 kept); 360 writes stop times and papers to McLeod through the API" |
| title + quote | `LOADS-MIRROR-PLAN.md:1`, `:14` ("Loads are read-only on our dashboard…") | | append note under `:14`, keep the quote (it is the owner's words) |
| D-LMR1 | `LOADS-MIRROR-PLAN.md:18-21` | "McLeod is the only author of a load" | keep; add "Stop facts and papers the driver records are written to McLeod by the API (D-MK v2); a load's creation, edit, assignment stay McLeod's (v1 D-MK4)" |
| D-LMR2 | `LOADS-MIRROR-PLAN.md:23` | status = projection | keep; add the Q-MK3 sentence |
| D-LMR5 | `LOADS-MIRROR-PLAN.md:338` | no offer step | keep; add "no Accept/Decline on McLeod loads; Got it (v1 Q-MK4)" |
| Q-LMR2, Q-LMR4, Q-LMR5 (PU), Q-LMR10 | `LOADS-MIRROR-PLAN.md:403`, `:410`, `:413`, `:456` | open | close: Q-MK3; Q-MK5 + A C3; B V1; D-MKN4.1 |
| D-FC0 | `roster/FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md:16-22` (table), `:375-376` | McLeod owns drivers/trucks/trailers/loads | add "360 may ASK McLeod to change the fields in D-MK2 through the API; McLeod's answer comes back on the sweep" |
| Q-7 | `FLEET-CENSUS…:537` (and option text `:553`) | status read-only | D's Q-7b (D:675-680) |
| D-RL5 | `mcleod/ROSTER-LIFECYCLE-PLAN.md:152-156` | owner's words: *"hiring is not done from 360"* | D-RL5a (D:535-538). **Note:** this re-rules an explicit owner quote — the owner must confirm in his own words, not by "go ahead" |
| D-MR6 | `mcleod/MCLEOD-ROSTER-SYNC-PLAN.md:296-299` | edit claims to manual | D-MR6a (D:1143) |
| BOL Q6 | `drivers-app/BOL-READING-RELIABILITY-PLAN.md:629-630` | "Writes are expensive … the service writes nothing" | D §MK4.5 (D:376-380); also Q9 at `:632` |
| CPM spec | `mcleod/MCLEOD-CPM-DATA-SOURCE-SPEC.md:669` | "any write to McLeod" out of scope | strike "any write to McLeod," |
| Money control | `maintenance/MAINTENANCE-MONEY-CONTROL-PLAN.md:296` (v1 says `:294`, which is the heading) | no writes to FleetPal, McLeod or EFS | "FleetPal or EFS"; McLeod money writes stay out under v1 D-MK5 |
| Alex's terms | `mcleod/mail.md:38` ("SELECTs only"), `:42` ("No insert, update, or delete"), `:36` ("nothing connecting into our network"), **`:89` ("The name_of_spouse email convention stays on your side. Do not write it back to McLeod.")** | | B-MK9: Alex's written OK; mail.md itself is a record and is not edited — append his new reply below it |
| TMS repo | SILVICOM360-TMS `HANDOFF.md:80`, `RESEARCH-RESOLUTIONS.md` §126(7) | — | outside this repo; v1:77 says owner rules separately. Not located (other repo) |

### 5.2 NOT in v1 §1 — found by grep, must be added
| File:line | Text | Why it must be re-ruled |
|---|---|---|
| `mcleod/MCLEOD-READ-ONLY-INTEGRATION-HANDOFF.md:6` | "**Write policy:** no SQL writes, no DDL, no stored-procedure execution, no direct McLeod mutations" | cited as authority by BOL plan `:652` and MEDSTOP `:134`; add "API writes via /ws are governed by MCLEOD-API-KIT v2; SQL stays SELECT-only" |
| `dispatch-loads/HOME-TIME-PLAN.md:100` | "**D-HT5 — Nothing is written to McLeod** (D-LMR1 stands)." | D re-rules as D-HT5a (D:1080-1083); not in v1 §1 |
| `dispatch-loads/HOME-TIME-PLAN.md:444` | "No writes to McLeod. No change to a driver's status." | same |
| `dispatch-loads/DISPATCH-BOARD-PLAN.md:332` | "No assignment, dispatch or status writes to McLeod — read-only connector" | D re-rules for ETA (D:1050-1051); not in v1 §1 |
| `dispatch-loads/DISPATCH-BOARD-V2-PLAN.md:296` | "No writes to McLeod (D-LMR1)." | scope note citing D-LMR1 — add "(assignment; stop writes per API-KIT v2)" |
| `dispatch-loads/DISPATCH-LOADS-COUNTS-PLAN.md:226` | "No writes to McLeod (D-LMR1)." | same |
| `mcleod/COLLECTOR-AUDIT-2026-09-24.md:305-316` | Alex's terms summarised: "a read-only mirror … SELECTs only … the email convention is never written back (nothing writes to McLeod)" | historical audit; append a dated pointer |
| `drivers-app/BOL-READING-RELIABILITY-PLAN.md:87`, `:652` | "read-only SQL … imaging has no API in this repository"; Layer 2 premise | update with D §MK4.5 |
| `dispatch-loads/LUMPER-REVISED-RC-PLAN.md:328` | route (a) "with a read-only API user" | the API user now writes; route (a)/(b) switch per D §MK4.4 |
| `docs/MCLEOD-SELF-HOSTED-INTEGRATION.md:30`, `:51`, `:131` | "a read-only internal integration" (the request text to McLeod) | the new McLeod message supersedes it |
| `docs/plans/MCLEOD-SQL-SOURCE-OF-TRUTH.md:14`, `:91` | read-only SQL as the integration | context only; pointer |
| `mcleod/CODEBASE-IMPACT-ANALYSIS.md:72` | pairing "⛔ NEVER WRITE" | still true (D-TL1/Q-MK10 keep it) — no change, list it as checked |
| `roster/FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md:553` | Q-7 option (a) "make the field read-only" | covered by Q-7b |

### 5.3 A ruling the specs violate outright
`mail.md:89`: **"The name_of_spouse email convention stays on your side. Do not write it back to McLeod."** — D's driver mapping writes `email → name_of_spouse` "Written where the carrier reads it" (D:486), and D-MK5-0a's round-trip test asserts `name_of_spouse = email` on create (D:609). This contradicts Alex's explicit condition. **Resolution:** drop `email` from every MK5 write (or make it an explicit item in the Alex message with his yes/no, and build both outcomes). No other spec mentions it.

---

## 6. Coverage

Note: v1 does not contain a "19 write-blocked items" list. The list is in memory
`mcleod-api-kit-bought.md` ("~19 write-blocked items (loads CRUD, dispatch assign, stop actuals, …)", 16 named,
plus 6 read-side wins). v2 should carry the list itself so the owner can tick it.

### 6.1 v1 §2 driver-app research (v1:83-108)
| Item | Placed in | Status |
|---|---|---|
| 1 Accept/Decline can never work on McLeod loads | A N3 §4 | once ✓ |
| 2 dispatched `approved` load invisible | A N2 §2 | once ✓ |
| 3 sweep undoes load status, not stop facts | A N1 §3 (+ S0 for stop ids) | once ✓ |
| 4 units resolve by unit number; unmatched driver silent null | B N6 §4 | once ✓ |
| 5 rig pick list = whole org | B N8 §5 | once ✓ |
| 5b driver workflows need GitHub "Approve and run" | — | **not placed** (it is a release-lane fact; v2 §gates should cite it for C-A2/C-K3 OTA lanes) |
| `co_driver_id` no policy reads it | A N2 (C3) | ✓ |
| required photos hard-coded twice | B N5 | ✓ (A S0b touches same lines — §1.13) |
| contract lacks PU/refs/customer/weight/pieces/actuals | B N4 **and** A C-A1 (actuals, `external_status`) | **twice** (§1.14) |
| `loads.pickup_number` never written | B5 | ✓ |
| no action id; replayed decline writes twice | A N7 | ✓ |
| navigation is a dev-only sample | — | **not placed**; v1 §5 lists "real navigation on McLeod's stops" as a later plan → v2 must rule it out with reason |
| app never ran on a real phone, in no store | — | **not placed** (v1 §6) → v2 prerequisite step |

### 6.2 v1 §4 N-steps and §5 phases
| Step | Spec | Status |
|---|---|---|
| N1 N2 N3 N7 | A | ✓ |
| N4 | B (+A slice) | double (§1.14) |
| N5 N6 N8 N9 | B | ✓ |
| MK0 | C §3, §7 **and** D Appendix C (12 checks) | two lists → merge into one MK0 checklist |
| MK1 | C §4 | ✓ |
| MK2 | D §MK2 (SQL) | ✓; v1 text wrong |
| MK3 | A §6 **and** C §5 | double, conflicting (§1.1–1.3) |
| MK4 MK5 MK6 | D | ✓ |
| v1 §5 driver screens: detention/lumper report, fuel receipt photo, roadside request, home-time request, ETA screen, navigation | none | **not placed, not ruled out** |
| v1 §6 SMS dispatch (Q-LMR9), Samsara driver create (read-only token) | none | not McLeod; v2 should list as "outside, unchanged" |

### 6.3 Memory's write-blocked inventory
| Item | Placed / ruled |
|---|---|
| loads CRUD | ruled out: v1 D-MK4 (v1:134, v1:246) ✓ |
| dispatch assign | ruled out: D-MK4; HO:35-37 notes `POST /dispatch/assign` exists, "revisit only after MK3" ✓ (no spec mentions — v2 should state it) |
| stop actuals | A MK3 + C — **double** |
| ETA | D MK6.1 ✓ |
| home time | D MK6.2 ✓ |
| BOL/POD filing | D MK4 ✓ |
| lumper "RC-received" | D MK4 sends the revised RC and lumper receipt as images ✓; a McLeod-side "RC received" flag/status is **not addressed** — rule out or place |
| truck status Q-7 | D MK5.3 ✓ |
| identity_source claim | D MK5.4 ✓ |
| new hire D-RL5 | D MK5.1 ✓ |
| termination/rehire | D MK5.2 ✓ |
| med card write-back | D MK5.5 ✓ |
| trailer pairing | ruled out: v1 Q-MK10 (TRAILER-LINK D-TL1); B N8 reads only ✓ |
| manual fuel D-IP5 | superseded by D-IP7 (HO:89; `fuel/IFTA-PRECISION-PLAN.md:110`, `:120`) — **no spec says "no write" explicitly**; v2 one line |
| AP vouchers from FleetPal | ruled out: v1 D-MK5; SURF:97 no AP service ✓ |
| tolls per truck | ruled out: v1 D-MK5 ✓ |
| (unnamed 3 of ~19: deductions, PrePass reclass, "Got it" to McLeod) | deductions/PrePass: v1 Q-MK15 ✓; ack to McLeod: v1 Q-MK4 "not planned" ✓ |
| read: frozen restore D-PREC12 / finance grant | D MK2 ✓ |
| read: imaging Q-LRC10 route (a) | D MK4.4 ✓ |
| read: unit papers in McLeod comments | **not placed** (UNIT-FILES plan) — rule out or place |
| read: home-time read | D MK6.2 reads ✓ |
| read: delivered history | **not placed** (C MK1 covers open board only, C:316-317 keeps the close read on SQL) — rule |
| read: MK1 movements parity | C ✓ |

---

## Summary

The seven documents agree on the outline: N-steps need no API, MK0 discovery first, writes go through `/ws`
from the VM's outbound connector, nothing goes live before a test-company proof, and finance stays on SQL
(only v1 still says API). They do **not** agree on the write pipeline itself. A and C specify two different
schemas under the same table name, two different stop-write models, two enqueue sites and two kill-switch
designs. D is written against a third, imagined interface (`state`, `target`, `expect`, `mcleod_api_capabilities`,
`mcleod_write_kinds_enabled`, `mcleodWriteContract.ts`) that neither defines. Several prerequisites are
unstated or circular (the proving run needs a request that only the gated PR can create; no test-company
load ever reaches 360 because the connector reads one company). One spec breaks an explicit carrier
condition (`mail.md:89`). D reuses v1's decision numbers with different meanings. Most other "open" items
are already closed by a decision table somewhere, or I closed them by checking the repo (uuid absent,
expo-crypto present, freshness is in `jobs.stats`, `lumper_case_files` has no `source`, `tmsLoadIngestWriters`
`kind: string`).

### The 10 most important items
1. **Two `mcleod_write_requests` schemas** (A:557-599 vs C:345-461), both `create table if not exists`: the second migration silently keeps the first shape. v2 needs one schema (C's, plus a supersede link, `mcleod_api_capabilities`, a per-kind `sent` window, and D's columns mapped to C's names) (§1.1, §3.4).
2. **Stop write model**: A sends one `clearStop` on Complete only; C sends `stop_arrival` + `stop_departure`. HO and SURF favour A. Rule A, with C's "use McLeod's arrival if it has one" (§1.2).
3. **`mail.md:89`: "Do not write [the name_of_spouse email] back to McLeod"**, but D writes `email → name_of_spouse` on create and update (D:486, D:609). Drop it, or put it in the Alex message as an explicit yes/no (§5.3).
4. **Test-company loads never reach 360**: the connector reads one company (`connector.example.env:19-20`). Every D-MK3 proof (MK3, images, ETA, driver writes) is unbuildable as written. Add a test-company feed step (§2 C, §3.2).
5. **Proving-run cycle**: C-PR7 needs P1–P6, and P1–P6 need a confirmed request that only PR7 creates. Ship the enqueue dark (A:747) and give `--api-prove` a way to create its request (§1.21, §3.2).
6. **Enqueue site and kill switches**: SQL in `driver_complete_stop` (A) vs TS orchestration (C) vs browser double-call (D). Env `MCLEOD_WRITE_COMPANIES` vs three locks vs `mcleod_write_kinds_enabled`. C's and D's module-cycle argument is factually wrong: `loads -> mcleod` is already allowed (`check-feature-boundaries.mjs:399`) (§1.3, §1.5).
7. **Unstated ordering hazards**: N2 (A M-A/C-A1) may go live before S0b is in production, which the handoff forbids (HO:95). `driver_complete_stop` is rewritten three times by two specs. B5's `reference_numbers` would be dropped by A's RPC column list. B1 edits a writer that S0b deletes. Both B2 and C-PR1 claim migration 0637 (§3.3, §3.5, §1.11–1.13).
8. **Decision-ID collisions**: D-MK2-1, D-MK4-1..6 and D-MK5-0a..1c reuse v1's D-MK2, D-MK4 and D-MK5 with unrelated meanings. M-A, S0/S1, A1/C-A1, E5, P1 and C1 collide across specs. D-TL1, D-DB4, D-FS2 and LR4 must be qualified by plan (§4).
9. **Re-rulings v1 §1 misses**: MCLEOD-READ-ONLY-INTEGRATION-HANDOFF.md:6, LOADS-GO-LIVE-PLAN.md:678 (where the 09-24 ruling is actually logged), HOME-TIME D-HT5 (:100, :444), DISPATCH-BOARD :332, DISPATCH-BOARD-V2 :296, DISPATCH-LOADS-COUNTS :226, LUMPER-RC :328, COLLECTOR-AUDIT :305-316, MCLEOD-SELF-HOSTED :30. v1's money-control citation should be :296, not :294. D-RL5 re-rules a verbatim owner quote ("hiring is not done from 360"), so the owner should confirm it in words (§5).
10. **Coverage gaps**: the v1 §5 driver screens (detention/lumper, fuel receipt, roadside, home-time request, ETA, navigation) and the v1 §6 gates (real phone, store, the GitHub approve-run lane) appear in no step and are not ruled out. The same holds for the McLeod "RC received" flag, unit papers, delivered-history reads and D-IP5's no-write. The contract (N4) and MK0 checklists are each specified twice, and the driver-side refusal display is contradictory (A §6.5 vs C §5.10). Four separate drafts to Alex/McLeod exist where the rule is one message each, and C's E4 role list lacks the D endpoints (§1.8, §1.22, §6).
