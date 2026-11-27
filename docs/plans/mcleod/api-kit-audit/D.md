# Audit of spec D (docs/plans/mcleod/api-kit-specs/D-office-finance-docs.md)

Worktree `/Users/miroslavjokovic/Projects/FG-mcleod-api` at `22f3f0540`. Newest migration on disk: `0636_toll_plazas_and_observations.sql` (confirmed).

### D-1 [OK-with-note] — load_stop_photos shape (0085:213-224)
- Spec says (line 58): "`load_stop_photos` (`0085_driver_loads.sql:213-224`) — id is the phone's UUID, slot, storage_path, captured_at, uploaded_at. No sha256, no mime, no size, no review state."
- Evidence: `supabase/migrations/0085_driver_loads.sql:213-224` (create table … `uploaded_at timestamptz not null default now()`); only later DDL on it is `0422:126` `drop column if exists created_at`.
- Correct: citation exact. Note the table also has `driver_id`, `load_id`, `stop_id`, `org_id`.

### D-2 [OK] — bucket size 15 MB (0611)
- Evidence: `0611_load_photos_size_limit_restored.sql:23-25` sets `file_size_limit = 15*1024*1024` where `id='load-photos'`.

### D-3 [IMPRECISE] — "every photo of a stop is known, in one transaction, the moment the stop completes"
- Spec says (line 62-63): rows "are inserted inside `driver_complete_stop` (`0141…:349-361`, on conflict (id) do nothing) — so every photo of a stop is known, in one transaction, the moment the stop completes".
- Evidence: `0141_driver_load_rpc_contract.sql:266-277` — the RPC takes `p_status in ('arrived','completed','skipped')` and the photo insert at `:348-362` runs for ANY of the three statuses; `:326-331` checks required slots against `select slot from load_stop_photos where stop_id = p_stop union p_photos`, i.e. photos may already be stored by an earlier `arrived` call. `:309-313`: same-status replay returns early; a different outcome on a completed/skipped stop raises DL003 — so after completion no photo can be added. Insert lines are 349-361 (the `if` is 349, `on conflict` 361) — citation OK.
- Correct statement: "A stop's photos are inserted by `driver_complete_stop` on its `arrived` and/or its `completed`/`skipped` call; once the stop is `completed` or `skipped` no further photo can be added (0141:309-313), so the set is CLOSED at completion — not inserted in one transaction." Also: a `skipped` stop can carry photos; `completedStopPapers` must say whether `skipped` stops with a bol photo are sent (spec only says "completed stops"). `driver_complete_stop` last definition is 0141 (the only other definition is 0087:458), so M-D2 replaces the 0141 body.

### D-4 [OK-with-note] — phone upload (handlers.ts:76-86)
- Evidence: `apps/driver/src/data/handlers.ts:76-88` `uploadStopPhoto`, `contentType: 'image/jpeg', upsert: false`, 409/"exist|duplicate" ⇒ return. Function spans 76-88 (closing brace 88).
- Note: every stop photo is uploaded as `image/jpeg` — consistent with D-MK4-5's "assembles the JPEGs".

### D-5 [OK] — PHOTO_SLOTS (loadsContract.ts:42-52)
- Evidence: `packages/shared/src/loadsContract.ts:42` `PHOTO_SLOTS = ["trailer","seal","bol","damage","load_secured","other"]`; labels to :52. Correct.

### D-6 [OK] — required_photos for McLeod stops (mirrorLoads.ts:120)
- Evidence: `apps/api/src/modules/loads/mirrorLoads.ts:120` `required_photos: s.kind === "pickup" ? ["trailer","bol"] : ["bol"]`.

### D-7 [IMPRECISE] — office load detail citation (detail.ts:31-79)
- Spec says (line 66): "signs and displays them only (`detail.ts:31-79`)".
- Evidence: `apps/api/src/modules/loads/dispatchLoads/detail.ts:45-94` is `stopPhotos()` (query :51-56, signing :71-79); TTL const :31. File is 222 lines.
- Correct: cite `detail.ts:45-94`. Also MK4.7 says "fields added to the shared load-detail contract (`loadsContract.ts`) — contract first": `getLoadDetail` returns `Record<string, unknown>` (detail.ts:147-151) and `LoadPhoto` is a local interface (detail.ts:35-43) — see D-8.

### D-8 [GAP] — "the shared load-detail contract (`loadsContract.ts`)" does not exist
- Spec says (line 408-409): "fields added to the shared load-detail contract (`loadsContract.ts`) — contract first, reader second merge."
- Evidence: `grep LoadDetail|LoadPhoto packages/shared/src/loadsContract.ts` → no match. `getLoadDetail` returns `Promise<Record<string, unknown> | null>` (detail.ts:147-151); `LoadPhoto` is declared locally (detail.ts:35-43).
- Fix: either (a) name the web-side type that actually receives the detail (whatever `apps/web` types `GET /api/dispatch/loads/:id` with) and add the `mcleod_sends` field there, or (b) first move `LoadPhoto`/the detail shape into `loadsContract.ts` as its own step. Also: the deploy-window rule is about DB columns; a new TS field + reader can ship in one merge (the reader reads a NEW TABLE, `mcleod_image_sends`, which is exempt). "contract first, reader second merge" is unnecessary for a new table — drop it, or justify it.

### D-9 [IMPRECISE] — driverLoads citations
- Spec says (line 300): "the `driverLoads.ts:18` lesson"; (line 305) "the completion path (`driverLoads.ts:280-300`)".
- Evidence: `apps/api/src/modules/loads/driverLoads.ts:17-20` (supabase-js cannot span a transaction); `completeStop` is `driverLoads.ts:280-301` (doc comment 280-282, function 284-301, RPC call :293). File 301 lines.
- Correct: `driverLoads.ts:17-20` and `:284-301`. Substance OK.

### D-10 [OK-with-note] — lumper_case_files (0601:19-40)
- Evidence: `0601_lumper_case_files.sql:19-43` (table), kind check `check (kind in ('revised_rc'))` :23, sha256/mime/size checks :35-37, bucket `lumper-files` 25 MB :15-17, guard `lumper_case_file_guard` :47-75 (refuses UPDATE of kind/file_name/mime/byte_size/sha256, refuses DELETE "a filed revised RC is removed, never deleted" :55).
- Correct: `0601:19-43`. NOTE for M-D3: the guard's error text names "revised RC" — widening the kind to `lumper_receipt` should restate the guard message (or it lies for a receipt). LUMPER-REVISED-RC-PLAN "What changes in 360" (LRC plan :388-401) ALSO adds a **role** column (`revised_rc | previous_rc`) and makes `uploaded_by` nullable — the spec's M-D3 coordination paragraph (line 270-275) names only `source` and `mcleod_image_id`; it must also say how `kind` (widened here) and LRC's `role` relate (is `previous_rc` a kind or a role? a McLeod-sourced `previous_rc` must also be excluded from sending — D-MK4-2 excludes by `source='mcleod'`, OK, but say it).

### D-11 [OK] — documents allows subject_type 'load'; 0631 list has no bol/pod/rc/lumper_receipt
- Evidence: `0146_compliance_documents.sql:34` subject_type check includes `'load'`; `0631:19-40` kind list (newest restatement) contains none of `bol`,`pod`,`rate_confirmation`,`lumper_receipt`.

### D-12 [OK] — document_sources sha256-unique per org (0448)
- Evidence: `0448_document_reader_tables.sql:109` `constraint uq_document_sources_org_sha256 unique (org_id, sha256)`.

### D-13 [OK] — hazmat_documents has sha256 (0092:68-81)
- Evidence: `0092_hazmat_core.sql:68-81` (create table hazmat_documents … `sha256 text not null` :75). Exact.

### D-14 [IMPRECISE] — 1:1 movement:order citation
- Spec says (line 75): "(0 exceptions measured 2026-09-24, `0364:81-85`)".
- Evidence: `0364_mcleod_dispatch_raw.sql:83-86` (comment "One order per movement: 0 movements with two orders and 0 orders on two movements on the board measured 2026-09-24"), `order_id` column :86. Note the measurement is "on the board" (open movements), not over history.
- Correct: cite `0364:83-86`; say "measured on the 2026-09-24 board". `mcleodLoadProjection.ts:240-241` (external_id/ref) is exact. `mcleod_dispatch_stops.stop_id` (0364:116), `movement_sequence` (:119), index on (org, company, movement_id, movement_sequence) :154 — exact; projection keeps `seq` = McLeod's movement_sequence (`mcleodLoadProjection.ts:199-208`), so the join holds.

### D-15 [OK] — Imaging index facts (LRC plan Q-LRC10)
- Evidence: `docs/plans/dispatch-loads/LUMPER-REVISED-RC-PLAN.md:287-401` (Q-LRC10 287, tables 308-318, billing query :311-312, (b) ruled :331, D-LRC16 :357, measurements to take :380-386). Spec cites 287-405 — fine (the "What changes in 360" list ends ~:401).
- Note: the plan's path is `docs/plans/dispatch-loads/`, the spec never gives the directory — add it.

### D-16 [OK] — SILVICOM-GRANTS.sql line citations
- Evidence (`tools/mcleod-agent/review/SILVICOM-GRANTS.sql`, 238 lines): header :6-8 (already granted on LME); Part 1 :77-83; Part 3 :139-148; Part 4 :160-174 (11 finance tables :160-170 + 4 repeated :171-174); Part 5 :188-190; Part 6 :194-214 (NOT YET RUN :195); CHECK `IN(...)` :225-230; dated header paragraphs :34-67. All spec citations exact.

### D-17 [GAP] — comparison run (MK2.2 step 3) cannot run under the connector login: Part 2 on `lme_analytics` must be RE-RUN, and it is not in the request
- Spec says (line 902-903, 907-908, 923-925): the two new lines go to Part 2 "only for the comparison run"; the request is "Part 3 + Part 4 (with the two new lines) + Part 5, run on `lme`"; step 3 "runs every financial statement against `lme` and against the copy".
- Evidence: SILVICOM-GRANTS.sql:61-64 "Part 2 ALSO NEEDS RUNNING AGAIN on lme_analytics: checked the same day, the login reads no finance table there either. The copy was restored on 2026-10-09, and a restore carries LME's permissions…". Also Part 2's `tractor` (:100-101), `fuel_tax_history`, `voucher_dist`, `gl_control`, `fiscal_year_dtl` (:119-127) were never run there.
- Fix: either (a) the comparison run reads the copy with the owner's `.env.sandbox` login (`<analytics SQL login>`, which reads it today — F0 relies on it) and `lme` with the connector login — so `financeCompare.mjs` takes TWO connection configs, and the run happens where both are reachable (the VM can't hold the sandbox credential unless the spec says so); or (b) the one message to Alex includes "Part 2 again on lme_analytics, plus `drs_check`, `gl_summary`". The spec as written adds two lines to Part 2 but never asks for Part 2 to be run, so step 3 would be refused on the copy. Recommend (a): no extra IT ask, and the request stays Part 3+4+5. Also note the restore drops grants each time (header :62-64) — any Part 2 grant is lost on the next restore.

## Write-pipeline dependency (spec D §0.1 vs spec C `C-transport.md` §5)

### D-18 [WRONG] — §0.1's assumed pipeline interface does not match the pipeline spec that exists
- Spec says (line 17-27): table `mcleod_write_requests` with `target jsonb {company_id,row_type,row_id}`, `payload`, `expect jsonb`, `response jsonb`, `refusal text`, `confirmed_at`, per-kind enable flag `mcleod_write_kinds_enabled(org_id, kind, enabled_at, enabled_by)`, contract file `packages/shared/src/mcleodWriteContract.ts`, capability table `mcleod_api_capabilities`.
- Evidence: `docs/plans/mcleod/api-kit-specs/C-transport.md:345-368`: columns are `company_id text`, `target_type text check (target_type in ('stop','movement','order','driver','tractor','trailer'))`, `target_id text (≤40)`, `payload`, **`baseline`** (not `expect`), `source_ref text not null`, `requested_by`, `status`, **`reason_code`** (regex `^[a-z][a-z_]{2,39}$`, required on refused/conflict) + `reason_text`, `not_before`, lease columns, `settled_at` (not `confirmed_at`). No `response` column: McLeod's answer lives in `mcleod_write_attempts.observed/mcleod_status/mcleod_text` (:379-393). Enable = `mcleod_write_switches(org_id, kind, mode off|test|live, test_company_id, canary_targets, proven_by_request …)` (:396-410) read by `mcleod_write_allowed()` (:514-516). Registry/contract file = `packages/shared/src/mcleodApi.ts` `MCLEOD_WRITE_KINDS` (:523-529, "MK4/MK5 kinds are added by the PR that builds their adapter"). Discovery store = `mcleod_api_discoveries.report jsonb` (:425-432); there is NO `mcleod_api_capabilities` table in C.
- Fix text: replace §0.1's table with C's names: `expect` → `baseline`; `target` → (`company_id`, `target_type`, `target_id`); `refusal` → `reason_code` (+ a new entry per code in `MCLEOD_WRITE_REASONS`, C:535-543) + `reason_text`; `response.*` → `mcleod_write_attempts.observed`; enable flags → `mcleod_write_switches` rows; contract → `mcleodApi.ts`; every enqueue through `mcleod_write_enqueue(p_org, p_id, p_kind, p_company, p_target_type, p_target, p_payload, p_baseline, p_source_ref, p_requested_by)` (C:479-483). `mcleod_api_capabilities` must either be ADDED by spec D as its own table (M-D0, module `mcleod`, key/value per org with the MK0 discovery id that proved it) or be read from `mcleod_api_discoveries.report` — spec D uses it ~10 times (IMAGE_UPLOAD_FORMAT, IMAGE_UPLOAD_ENCODING, IMAGE_LIST_FIELDS, ROW_UPDATE_MODE, TRACTOR_SUBSTATUS_KEY, TRAILER_ACTIVE_KEY, ETA_WRITE_PATH, confirmation window) and never creates it.

### D-19 [WRONG] — image "sent → confirmation poll 24 h" has no state in the pipeline; C's lease expiry would RE-SEND it
- Spec says (line 326-333): after POST the request stays `sent` "Not confirmed yet"; "Confirmation poll (pipeline's `sent` re-check, every 10 minutes up to 24 hours)"; "never re-sent automatically".
- Evidence: C:365 `sent` requires a live lease; C:489 "sent & lease_expires_at < now() → status queued" (lease 120 s default, :487); C:510 transient → back to queued; adapters are synchronous `precheck/apply/verify`, "verify … must be `same`" (C:555-566). There is no "sent, awaiting batch pickup" status and no `sent` re-check loop.
- Consequence: an image POSTed and staged by DocumentPower, not yet visible, would have its lease expire, return to `queued`, be leased again, and be POSTed AGAIN — the exact double-filing D-MK4 forbids.
- Fix: settle the request on the POST's 2xx as `confirmed` with outcome `applied` (McLeod accepted it — that is the pipeline's verdict), and move "is it visible on the order yet" to `mcleod_image_sends` itself: add `filed_seen_at timestamptz`, `filing_overdue_at` (the guard allows null→value once, same as `mcleod_image_id`), set by an agent read route; the 24 h / 72 h unseen check becomes an office exception on the send, never a pipeline state. Alternatively spec C must add a status (`accepted`) and a `confirm_by` column — that is a change to C, and D must say so explicitly as a cross-spec dependency.

### D-20 [WRONG] — "one live intent per (org, kind, company, target)" collides with several papers per order and several edits per driver
- Evidence: C:370-371 unique index `mcleod_write_requests_one_live on (org_id, kind, company_id, target_id) where status in ('queued','sent')`; C:482-483 a second live intent returns the EXISTING row with `created=false`.
- Consequences in spec D: (a) `image_upload` — a pickup BOL, a dropoff POD, a lumper receipt and an RC all target the same order id; while one is queued the others are refused by the index, and `mcleod_enqueue_image_send` (line 299-301, "writes both rows or neither") would insert the `mcleod_image_sends` row while the request call returns another intent — a send without its request (the stuck send the RPC exists to prevent). (b) `driver_update` — a lifecycle write and a field edit (or a medical update) for one driver cannot both be live. (c) `home_time_update` "supersede" (line 1100-1103) assumes the newer request can be inserted while the older exists; the index refuses it.
- Fix: make each logically independent write its own kind (`image_upload_bol`, `image_upload_pod`, `image_upload_lumper_receipt`, `image_upload_revised_rc` — the C kind regex allows it — or target_id = `<order>/<send id>`; recommend the latter for images since a BOL of two pickups is two live sends on one order), and split `driver_update` into `driver_update_fields`, `driver_update_lifecycle`, `driver_update_medical` (which also solves D-21). The image enqueue RPC must check `created` and raise if the request was not created, so the transaction rolls back the send row. For home time: the newer intent waits (enqueue returns `created=false`; the sweep retries next tick) — spec the actual behaviour.

### D-21 [GAP] — sub-flags (`driver_update.fields|lifecycle|medical`, `image_upload.kinds text[]`) have no home in the switch table
- Spec says (line 452, 529-531): "a per-kind sub-flag inside `image_upload`'s enable row: `kinds text[]`"; "`driver_update` (sub-flags `fields`, `lifecycle`, `medical`)".
- Evidence: `mcleod_write_switches` (C:396-410) has `mode`, `test_company_id`, `canary_targets` — no sub-flag column; proof (`proven_by_request`) is per kind.
- Fix: separate kinds (D-20's split) — each then has its own `test` → `live` proof as D-MK3 requires, and the rollout order (line 808-810) is literally a sequence of switch rows.

### D-22 [IMPRECISE] — uuidv5 helper: an RFC 4122 v5 implementation already exists in the repo; `uuid` is not an api dependency
- Spec says (line 47-50): "`uuid` is already an api dependency — confirm … if absent, use `node:crypto` SHA-1 per RFC 4122 §4.3 in a 12-line helper".
- Evidence: `apps/api/package.json` has no `"uuid"`; `apps/api/src/scripts/importMcleodUnitPapers.ts:136-144` `export function uuidV5(name, namespace)` (createHash sha1, version/variant bits) with `importMcleodUnitPapers.test.ts`.
- Closure: move `uuidV5` to `packages/shared` (pure, Node `crypto` — or into `apps/api/src/lib/uuidV5.ts` if shared must stay browser-safe) and import it from both places; do not write a second one ("deriving beats restating"). Also C names the contract file `mcleodApi.ts`, so `MCLEOD_WRITE_NS` goes there, not `mcleodWriteContract.ts`.

## MK5.0 driver mapping / MK5.4 field edits / claim trigger

### D-23 [GAP] — writing `email` into `name_of_spouse`: the column is char(28); longer addresses are truncated
- Spec says (line 486): "`email` | `name_of_spouse` | … Written where the carrier reads it."
- Evidence: `tools/mcleod-agent/roster.mjs:64-86` — "The column is `char(28)` … of 164 active drivers 14 sit at exactly 28 characters, and only 6 of those still end in a plausible TLD. The other 8 are addresses cut off mid-domain"; `usableEmail` rejects such values on read.
- Fix: the fields route and the create payload refuse (or omit with a visible note) an email longer than McLeod's width; the width is read at MK0 from `RowDriver` (`name_of_spouse` length) and stored with the other capabilities; test: a 29-char email ⇒ not sent, office told "McLeod's email field holds 28 characters; this address is longer — keep it in 360 only". Without this, 360 would write an address McLeod truncates, the sweep's `usableEmail` would then read null, and 360's own email would be left as the only copy — i.e. the write silently breaks the round trip the spec's `rowMap.test` claims.

### D-24 [WRONG] — `rowMap.test` round-trip equality cannot hold for `middle_name` (and email, above)
- Spec says (line 469-471): "`MAP.drivers(fromRow(toRowDriver(x)))` equals `x` for each field"; table (line 479): "`middle_name` | `name_mid_initial` | first letter only".
- Evidence: `queries.mjs:37` `d.name_mid_initial AS middle_name`; a full middle name "Robert" → "R" → MAP gives "R" ≠ "Robert".
- Fix: the test asserts equality for every field EXCEPT a declared lossy set `{middle_name: firstLetter, email: ≤28}` whose expected transform is stated in the table; and `DRIVER_MCLEOD_WRITABLE_FIELDS` (line 735) should exclude `middle_name` (an edit of a middle name on a McLeod row would be sent as one letter and then sweep back as one letter, overwriting what the office typed) — or the UI states "McLeod keeps the initial only".

### D-25 [OK-with-note] — driver mapping citations
- Evidence: `tools/mcleod-agent/queries.mjs:31-67` (DRIVER_MATCH :31-38, DRIVER_IDENTITY :47-67; `license_date AS cdl_expires_at` is :52, spec says :53); `roster.mjs:95-96` (surname comment), `MAP` :90, header "FuelGuard never learns" :133; `rosterFields.ts:36-83` `driverPatch`, phone comment :79-81. All substantially correct.
- Note: the spec's `RowDriver` field names for `first_name`, `name`, `name_mid_initial`, `birth_date`, `address`, `city`, `state`, `zip`, `name_of_spouse`, `license_date` are SQL column names; the surface doc's `RowDriver` list (MCLEOD-API-SURFACE:56-59) names none of them (it lists is_active, hire_date, termination_date, reason_for_leaving, can_rehire, pta/home fields, license_no, license_state, medical_cert_expire, tractor_id, fleet_manager, payee_id, type_of, team_status, tenstreet_id, social_security_no, avl_*). The spec flags only `license_date`. MK0 check 5 must read EVERY mapped key on `RowDriver` (the whole MK5.0 table), not just `license_date`, and any absent one drops out of `DRIVER_MCLEOD_WRITABLE_FIELDS` by the same one constant.

### D-26 [OK] — claim trigger defect reproduced from the current definition
- Spec says (line 746-748): "The claim trigger stops claiming McLeod rows on phone — a defect today (McLeod never writes phone …)".
- Evidence: last `create or replace function public.claim_identity_for_office()` is `0241_identity_provenance_claim.sql:43-98` (0242 only re-creates the vehicle/trailer triggers, 0242:64-76; the drivers trigger is still 0241:124-129 `('full_name','first_name','middle_name','last_name','phone')`). Walk for a McLeod row and an office JWT phone edit: `auth_role()` not null (:55) → not INSERT (:64) → identity_source unchanged (:72) → old ≠ 'manual' (:76) → `phone` in tg_argv and changed (:85-86) → `identity_source := 'manual'` (:91). After that `driverPatch` no longer runs for the row (rosterFields.ts:58-59 "after which nothing here runs"). McLeod never writes phone (rosterFields.ts:79-81). Defect confirmed. Note 0241's own comment (:108-110) says each list is "EXACTLY the set of columns the McLeod sync writes" — `phone` contradicts it; the real reason it is there is `DRIVER_IDENTITY_FIELDS` = Samsara's list (rosterContract.ts:355-362 "The fields the Samsara sync also writes"). So the defect is that ONE list serves two sources.

### D-27 [GAP] — M-D5 fixes the trigger but not `resolveDriverUpdate`; the two would diverge
- Spec says (line 748-752): M-D5 replaces the trigger function with `col@source`; drivers trigger `('full_name','first_name','middle_name','last_name','phone@samsara')`.
- Evidence: `packages/shared/src/rosterContract.ts:360-362` `DRIVER_IDENTITY_FIELDS = ["full_name","first_name","middle_name","last_name","phone"]`; `:409-411` `claimedFromTelematics = editedIdentity && current.identity_source !== "manual"` — the PATCH route (`drivers.ts`) still claims a McLeod row on a phone edit. 0241:119-120 "so the PostgREST path and `resolveDriverUpdate` reach the same verdict on the same edit".
- Fix: same PR as M-D5 changes `DRIVER_IDENTITY_FIELDS` to a source-qualified shape (e.g. `{field, sources}`; `phone` → `['samsara']`) and `resolveDriverUpdate` honours it; `rosterFields.claimParity.test.ts` asserts the SQL trigger arguments (parsed from the newest migration) equal the shared list rendered as `col@source`. Also order: the trigger (M-D5) and the TS change can ship in one merge (a function body is not a column) — say so.
- Also: `@` inside a trigger argument — make sure `samsara`-sourced phone edits still claim (spec's matrix case covers it) and that `split_part(col,'@',1)` is used for `to_jsonb` lookup; the function must keep `security definer`, `set search_path = ''` (0241:46-47).

### D-28 [IMPRECISE] — `driverPatch`-derived writable list includes `hire_date`, which D-MR7a treats as a rehire signal
- Spec says (line 734-737): writable = keys of `driverPatch` minus `full_name`.
- Evidence: keys = first/middle/last_name, cdl_number, cdl_state, cdl_expires_at, medical_card_expires_at, hire_date, date_of_birth, email, address_line1, city, state, postal_code (rosterFields.ts:49-77). MK5.2 (line 621) states D-MR7a: "McLeod hire date after termination" restores a driver.
- Fix: exclude `hire_date` from `fields` (it belongs to lifecycle/the close), state the exclusion as data (`minus ['full_name','hire_date','middle_name']`) and pin it in the derived-list test; and exclude `cdl_expires_at` unless MK0 proved `license_date` writable (spec says this only in the MK5.0 table).

## MK5.1 new hire / MK5.2 termination & reactivation

### D-29 [OK-with-note] — hire route, gate, permission
- Spec says (line 540-542): `POST /api/recruitment/hire` (`apps/api/src/modules/recruiting/routes/hire.ts:59-104`), gate `recruitment:view` + `recruitment.close_application` (`rolePermissions.ts:49`).
- Evidence: `hire.ts:60-106` (route), `canView = requireSection("recruitment","view")` :42, `canClose = requireNamedPermission(CLOSE_APPLICATION_PERMISSION)` :43 imported from `../../org/index.js` :14; audit `compliance.applicant_hired` :85-102; `packages/shared/src/rolePermissions.ts:49` `CLOSE_APPLICATION_PERMISSION = "recruitment.close_application"`. Correct (cite :60-106). Note the module is `recruiting` (not `recruitment`); web feature is `apps/web/src/features/recruitment/{useHire.ts,HireDrawer.vue}` — both exist.

### D-30 [WRONG] — `handApplicationToTms` is a silent no-op on a hired row; it cannot be the post-create link
- Spec says (line 583-587): the result route "ALSO calls `handApplicationToTms` … with `{driverId, externalId: code, companyId}` BEFORE that post, so the link never depends on the matcher's fuzziness. `handApplicationToTms` is already idempotent on McLeod's id (23505 …)".
- Evidence: `apps/api/src/modules/roster/driverTmsHandover.ts:18-30` — `.update({mcleod_driver_id, mcleod_company_id, identity_source:'mcleod'}).eq("id").eq("org_id").eq("status","applicant")`, `return !error`. After `POST /api/recruitment/hire` the row is `active` (hire_applicant RPC), so the update matches 0 rows and returns `true` — no link, no error, no 23505.
- Fix: a NEW roster export `linkHiredDriverToTms(admin, orgId, {driverId, externalId, companyId})` = same update but `.eq("status","active").is("mcleod_driver_id", null)` and `.select("id")` so 0 rows is reported (not `!error`); its test: active+unlinked ⇒ linked; applicant ⇒ not touched; already linked ⇒ false; 23505 ⇒ false. And it must set `identity_source='mcleod'`: a 360-hired row is `manual` (an application row a person typed, driverTmsHandover.ts:10-12), and rosterIngest writes identity only for `samsara|mcleod` rows (rosterIngest.ts:33-38) — without the flip McLeod would never refresh the driver it just created.

### D-31 [WRONG] — "the matcher links it … (`rosterApplicantHire`/`rosterMatch` already link an active row by licence + name, the D-RL5 rule)"
- Spec says (line 572-574, 582-583).
- Evidence: `rosterApplicantHire.ts` handles `status='applicant'` rows only (header :7-31; `handApplicationToTms` requires applicant). `rosterMatch.ts:75-76,95-104` puts non-applicants in `pool` and matches by link → **cdl alone** → name alone (licence + name is the RL5 rule for APPLICANTS only, rosterApplicantHire.ts:27-31). A matched `manual` row is linked but its identity is never written (rosterIngest.ts:36-38, ownership by `provenanceLookup` :188-191).
- Correct statement: "An active 360 row (hired in 360) is matched by `rosterMatch` on licence (or name), linked, but stays `manual`, so McLeod does not refresh it — which is why the result route links and hands over explicitly (D-30)." The `exists_in_mcleod` branch (step 2 active licence) therefore leaves the 360 row linked-but-manual: say whether the office is shown "hand back to McLeod" (MK5.4's un-claim) for it.

### D-32 [WRONG] — reactivation of a return: the McLeod id, the 360 row and the "former termination" are not the ones the spec names
- Spec says (line 575-578, 650-658): inactive McLeod driver with the licence ⇒ request "converted in place to a reactivation"; "`hireApplicant` refuses a hire date before the former termination: new check in `validateHireRequest`, shared"; "true by construction, since the close's hire date is today or later".
- Evidence: (a) `packages/shared/src/hireHandoff.ts:57-70` `validateHireRequest(input, today)` refuses only > 365 days ahead — a past hire date is allowed, so "today or later" is false; it has no access to any former row. (b) A returning driver re-applies as a NEW applicant row; his former 360 row (terminated) still holds `mcleod_driver_id = <old code>` under `uq_drivers_org_mcleod` (0239:62). Reactivating McLeod's OLD code and linking it to the NEW 360 row (D-30's link, `externalId: code`) hits 23505 — and `code` in the request is the code typed in the drawer, not McLeod's old id. (c) C's request row's `target_id` is immutable (C-transport.md:464-467, MW003) — "converted in place" to a different target (old code instead of new code) is refused by the pipeline guard.
- Fix: (1) The close drawer's "McLeod driver code" pre-check finds the former McLeod id by licence BEFORE enqueue (from the swept roster: a 360 row with this licence and a `mcleod_driver_id`, or `mcleod`'s raw driver table) and enqueues a `driver_reactivate` request targeting THAT id — no in-place conversion. (2) The 360 side of a return: the new applicant row and the former row are the same person — either `merge_driver` the new row into the former one at close (0110/0203/0234: it carries recruiting evidence) and then the former row's link stands, or clear the former row's link first; the spec must pick one (recommend merge, which already exists and keeps one row per person). (3) The "hire date after former termination" check takes the former termination as a parameter: `validateHireRequest(input, today, formerTerminationDate?)`, and `hireApplicant` reads it from the former row found by licence.

### D-33 [IMPRECISE] — termination citations
- Spec says (line 617-619): `drivers.ts:163-246`, gated by `callerCanManage(role,'roster')`, `DRIVER_LIFECYCLE_FIELDS` `rosterContract.ts:349`.
- Evidence: `apps/api/src/modules/roster/routes/drivers.ts:164-~260` (PATCH; lifecycle refusal :180-185; read :191-201; `resolveDriverUpdate` :213-217; update :219-229; audit `driver.updated` :234-247); `rosterContract.ts:349` exact. File 328 lines.
- Note: the PATCH's lifecycle branch is not a separable block — termination is a field edit inside one generic update. "extracted, unchanged in behaviour, into roster's exported `applyDriverUpdate`" means extracting the WHOLE PATCH body (read → applicant guard → resolve → update → audit); say that, and that the route's existing tests (`drivers.test.ts`) are the refactor's proof.

### D-34 [WRONG] — MK5.2 test says the PATCH enqueues; the design says it must not
- Spec says (line 661-662): "`drivers.routes` test: PATCH terminate on a linked row enqueues one `driver_update` with the expect; on an unlinked or `manual` row enqueues none".
- Evidence: the spec's own D-MK5-0g (line 521-527): roster → mcleod would be a module cycle; termination for a linked row goes to `POST /api/mcleod/drivers/:id/end-employment`.
- Fix: the test belongs to `officeWrites` (`end-employment`): linked mcleod/samsara row ⇒ `applyDriverUpdate` called then one `driver_update_lifecycle` enqueued; unlinked/manual ⇒ 409 (or route refuses and web uses PATCH). Add a PATCH test asserting it enqueues NOTHING (the boundary) and a web test that a linked row's termination calls the mcleod route.

### D-35 [GAP] — `reason_for_leaving` / `can_rehire` columns: reader timing and lifecycle-field gating
- Spec says (line 633-636): `driverUpdateSchema` gains both; stored on our row (M-D4b, reader next merge).
- Gap: the same merge that adds the zod fields makes the PATCH WRITE them — a writer of a new column is a "reader" for `lint:migration-ordering` purposes (PostgREST rejects an unknown column during the deploy window). So: merge 1 = M-D4b; merge 2 = schema + route + UI. Also add both to `DRIVER_LIFECYCLE_FIELDS` (rosterContract.ts:349) or a recruiter could set `can_rehire` through PATCH on an applicant row without the lifecycle gate; and to `AUDITED_VALUE_FIELDS` (drivers.ts audit, :230-232) so the `driver.updated` row carries them.

### D-36 [OK] — D-RL6 interplay claim
- Spec says (line 639-641): D-RL6 will not restore a driver whose termination has an office `driver.updated` audit touching status.
- Evidence: `apps/api/src/modules/mcleod/rosterDriverSettle.ts:42` ("no office `driver.updated` touching status or termination date, no `driver.archived`"), :194-205 (`.in("action", ["driver.updated","driver.archived"])`). Holds, PROVIDED `applyDriverUpdate` keeps writing `driver.updated` with `fields` (drivers.ts:234-247) — make the extraction's test assert the audit action name.

## MK5.3 truck/trailer status

### D-37 [OK] — isStatusFromTms and its four call sites
- Evidence: `packages/shared/src/tms.ts:382-384` (doc 363-381); `VehicleForm.vue:63`, `TrailerForm.vue:26`, `VehiclesPage.vue:394` (Retire action hidden for TMS rows), `TrailersPage.vue:219`. Exact. `deriveVehicleStatus` `tms.ts:353-360` (`ordered` / `maintenance` / `active`); `in_shop` = `tractor_status==='S'`, `winding_down` = `tractor_status==='I'` (`tools/mcleod-agent/roster.mjs:144,155`); `vehicles.winding_down` (0462). Trailer `is_active='A'` membership, `trailer_status` not read (queries.mjs:171-192, 260-274). `tractor_status` values A (150 rows, running), V, S, I, reserved (FLEET-CENSUS plan §1.3, `docs/plans/roster/FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md:81-105`) — "Running writes A" is the majority code. OK.

### D-38 [WRONG] — two different route paths for the same status write
- Spec says (line 708): UI "calls `POST /api/roster/vehicles/:id/mcleod-status` (or `/trailers/:id/`)"; (line 713): API "`POST /api/mcleod/vehicles/:id/status` and `/api/mcleod/trailers/:id/status` in `officeWrites.ts`".
- Fix: one path — `/api/mcleod/vehicles/:id/status` (D-MK5-0g puts every MK5 route in `mcleod`). Correct the UI line.

### D-39 [GAP] — "the inverse is derived from the forward rule" cannot cover the retire/in-service rows
- Spec says (line 698-699): "A test asserts `deriveVehicleStatus(applyRequest(row, req)) === expected` for every row of the table".
- Evidence: `deriveVehicleStatus` (tms.ts:353-360) takes only `purchased_at`, `year`, `in_shop`; it knows nothing of `winding_down` or `service_status`. Retirement is `rosterRetire.ts`, not `deriveVehicleStatus`. So for "Winding down", "Out of service", "Back in service" the asserted function cannot produce the expected value.
- Fix: the test composes the sweep's real pipeline: `vehiclePatch(MAP.vehicles(applyRow(row, req)))` for status/winding_down, and `retirementQueries` predicate (`service_status <> 'A'`) for the retire rows; or narrow the derived assertion to the two `in_shop` rows and state the others are asserted against `roster.mjs` MAP + the retire predicate.

### D-40 [GAP] — "Out of service" can be refused on the 360 side by rosterRetire's guards, leaving McLeod I / 360 active
- Spec says (line 690, 719-721): "retired by `rosterRetire` (its caps and guards apply unchanged)"; "'Out of service' is the ONLY retire for a linked unit".
- Evidence: `apps/api/src/modules/mcleod/rosterRetire.ts:23-47` — never retires more than half the active rows in one call, and **never retires a truck still working** (telematics fix / fuel-card fill recent, :27-47, :205+).
- Fix: state the outcome: a truck the office takes out of service while its gateway still reports stays `active` in 360 and lands on rosterRetire's held list; the office line reads "McLeod has it out of service; 360 keeps it until the truck stops reporting". Add a test.

### D-41 [OK-with-note] — browser writes vehicles/trailers without an audit row
- Evidence: `apps/web/src/composables/useVehicles.ts:24-110` and `useTrailers.ts:22-97` write `vehicles`/`trailers` through PostgREST (`insert`, `update`, bulk `.in("id")`, retire `update({status:'retired'})`) — no API route, no `audit_logs` row (0241 header :18-21 says the same).
- Note: spec D's MK5.3 moves only the STATUS of linked units to an audited route; the remaining PostgREST writes stay unaudited. Not a defect of this spec, but the spec's claim "rest of the form still saves through PostgREST as today" should name it as out of scope.

### D-42 [OK] — `requireSection('equipment','manage')` = admin + fleet_manager
- Evidence: `packages/shared/src/auth.ts:136-160` `SECTION_ACCESS` (admin/fleet_manager `equipment: manage`; dispatcher/safety/auditor/technician `view`; recruiter/driver/accountant `none`). Spec's 403 cases (dispatcher, safety) hold. `settings: manage` = admin + fleet_manager (spec MK4.6) holds. `dispatch: manage` = admin, fleet_manager, dispatcher (MK4.6 "send again") holds. `safety: manage` = admin, fleet_manager, safety_manager (MK5.5) holds.

## MK2 finance

### D-43 [OK] — finance sweep citations
- Evidence: `tools/mcleod-agent/agent.mjs:718-834` `runFinancial` (spec :718-832); receipt window `:821-829` (spec :820-829); `connector.example.env:39-42` `FINANCE_FEED=off` (note line 44 calls lumper "Part 7 of the review file" — stale, it is Part 5); `apps/api/src/modules/mcleod/routes/tmsFinancial.ts` routes `/settlements` :38 … `/billing` :230 — all twelve exist; `GL_KEY_LINES` `queries.mjs:805-818`, module list `('BILL','SET','SETV','FUEL')` :815 — spec's F3 widening claim correct; `ledgerCoverage.ts:134` (`apps/api/src/modules/financial/ledgerCoverage.ts`) "posting-lag term until McLeod's fuel_detail is staged (F12b)" exact; Surface doc §Money confirms no GL/ledger/AP/fuel service.

### D-44 [WRONG] — `FUEL_PURCHASES` has 28 output columns, at `queries.mjs:450-500`
- Spec says (line 964-965): "`mcleod_fuel_purchases` … with exactly `FUEL_PURCHASES`'s 27 columns (`queries.mjs:450-505`)".
- Evidence: `tools/mcleod-agent/queries.mjs:450-500` aliases: external_id, company_id, tractor_unit, driver_external_id, movement_external_id, order_external_id, purchased_at, state, truck_stop_name, truck_stop_city, card_id, gal_tractor, gal_reefer, gal_def, gal_other, cost_tractor, cost_reefer, cost_def, cost_oil, cost_misc, cost_sales_tax, cost_transaction_fee, total_amount, fuel_discount, direct_amount, funded_amount, post_key, post_module = **28**. (The "27" is copied from FINANCE-GO-LIVE-PLAN.md:641-646, which also cites the old `queries.mjs:348-402`.) The UNION's second half (`fuel_detail`, unposted) returns NULL post_key/post_module.
- Fix: "the 28 columns `FUEL_PURCHASES` returns (`queries.mjs:450-500`) + `org_id`, `swept_at`"; post_key/post_module nullable (unposted purchases). Also update `agent.mjs:831-833`'s comment ("Fuel purchases are deliberately NOT posted…") in the same PR — `lint:comment-claims` won't catch a now-false comment.

### D-45 [WRONG] — M-D6 is unnecessary and its module is wrong: the freshness row has a `config jsonb`
- Spec says (line 937-942, Appendix A line 1132): "ingest stores it in the existing freshness row — if the row has no column for it, **M-D6** adds `source_db text` to that table"; Appendix A "M-D6 | financial".
- Evidence: the stamp is `org_integrations` provider `mcleod_financial` (`apps/api/src/modules/mcleod/tmsIngest.ts:197-215` `stampFinancialSynced`; `financialFreshnessStamp.test.ts`); `org_integrations` has `config jsonb not null default '{}'` (`0068_tms_integration.sql:15`) and is owned by module **`org`** (`scripts/table-modules.json:2502-2504`); `tmsIngest.ts:149-153` already keeps per-provider facts in `config` ("`config.counts` … this file is the module's one writer of `org_integrations`").
- Closure: no migration. `stampFinancialSynced` writes `config.source_db` (full update of the row's config, not a partial upsert); `readFinancialIntegration` returns it; Finance footer reads it. Drop M-D6 from Appendix A. (`financialFreshness.ts` itself only reads `jobs`/`organizations`; the reader of the stamp is `readFinancialIntegration`, mcleod index.)

### D-46 [OK-with-note] — grant status table
- Evidence: SILVICOM-GRANTS.sql — header :6-8 already-granted list matches; Part 1 run 2026-09-29 (:28-31, :82-83); Parts 3/4/5/6 "NOT YET RUN" (:132, :153, :179, :195). "13 of 15 refused, measured 11-18" — from LUMPER-REVISED-RC-PLAN.md:347-348 ("13 of Part 4's 15 tables still refused on LME, measured the same day with HAS_PERMS_BY_NAME"); the spec's row lists 11 tables but cites 13/15 (15 = Part 4 incl. the 4 repeated Part 3 tables), so the two readable ones are unnamed — name them (re-run the CHECK block, which already lists them) or drop the count. The statement→table map (MK2.1) matches `queries.mjs` (FUEL_PURCHASES reads `fuel_detail_hist` + `fuel_detail`; FUEL_LEDGER_LINES `gl_ledger` + `fuel_detail_hist`; GL_KEY_LINES `gl_ledger` only, :805-818).
- Gap: "Part 6 (imaging) was already sent alone (2026-11-18)" (line 909) — the repo shows only the owner's instruction that it go alone (LRC plan :343-347); no `REQUEST-TO-ALEX-2026-11-18*` file in `tools/mcleod-agent/review/` (files: …-2026-11-13-FINANCE-ON-LME-AND-LUMPER.md is the latest). Say "to be sent alone, per the owner (LRC plan :346)" unless the sent message is cited.

### D-47 [IMPRECISE] — D-MK2-1 row-limit argument
- Spec says (line 831-833): "`/ws` returns ≤ 1,000 rows per call (`-Dloadmaster.api.maxresultsize`) … 38+ paged calls".
- Evidence: MCLEOD-API-SURFACE:25-26 states the 1,000 cap for `GET /movements/search` (MovementService) only; paging params `recordLength/recordOffset` are documented there. Settlement/Deduction services' paging is unread. The conclusion (finance stays SQL) does not depend on it — reasons (1),(2),(4) suffice; mark (3) "if the same cap applies".

## MK6

### D-48 [IMPRECISE] — DB7 decision table uses a bucket and filters the plan's SQL does not compute
- Spec says (line 1005-1009): bucket "≤ 6 h out", "GPS age ≤ 15 min and HOS known", "median |error| ≤ 30 min and p90 |error| ≤ 90 min".
- Evidence: DISPATCH-BOARD-PLAN.md:532-543 — `width_bucket(…, 0, 24, 6)` = 4-hour buckets; `median_min` is the SIGNED median of (actual − eta); no gps/hos filter. Columns exist: `load_stop_eta_predictions.gps_age_seconds`, `hos_known` (0453:54-55), `load_stops.actual_arrival_at` (0366:58).
- Fix: write the exact query in the spec: `where p.gps_age_seconds <= 900 and p.hos_known and s.actual_arrival_at - p.predicted_at <= interval '6 hours'`, `percentile_cont(0.5) … abs(...)` and `percentile_cont(0.9) … abs(...)`, `count(*)`; and dedupe to one prediction per (stop, hour) — the recorder writes one row per truck per hour, so n counts predictions, not stops; say which (≥ 300 predictions vs stops).
- Also: D-DB4 citation `DISPATCH-BOARD-PLAN.md:184-190` exact (§5.1 :184-190); "§8 'No … status writes'" is `:330-332` ("No assignment, dispatch or status writes to McLeod").

### D-49 [GAP] — ETA write relies on unread doc pages and C's adapter model
- Spec relies on: `RowCallin` (unread — not even listed in the surface doc's unread list; the surface doc names only `CallinService PUT /callins/create|update`, :87), `RowStop` (unread, surface :39-40), `PUT /stop/update` via TableRowService (candidate only, surface :40). Surface :39: "No stop ETA write found in DispatchService, StopService, MovementService or SymphonyMobileCommService."
- C's stop adapters precheck with `GET /stops/{target_id}` (C-transport.md:560); spec D step 2.2 says `GET /stop/{id}` (TableRowService) and then `GET /stops/{id}` — two different reads; pick one per C's `STOP_FIELDS`.
- `mcleod_eta_holds` (M-D8) duplicates state the pipeline already has: "is the last value we wrote" = the newest `confirmed` `stop_eta_update` for that stop (`mcleod_write_attempts.observed`). Keep the hold table only for the 6-hour back-off, and say the "last value we wrote" read comes from the pipeline.
- Appendix C item 10 should add "`RowCallin` fields; `RowStop` has `eta`".

### D-50 [GAP] — home-time import: an existing ingest is ignored, and the fuel rule would read the imported periods
- Spec says (line 1086-1094): "`tmsDriverInputSchema` gains them (shared contract first, ingest second merge); the ingest writes McLeod-originated periods to `driver_time_off` with `provider='mcleod'` … through roster's interface".
- Evidence: an ingest already exists — `POST /api/tms/driver-time` (`apps/api/src/modules/mcleod/routes/tmsIngest.ts:304-316`) → `ingestDriverTimeOff` (`apps/api/src/modules/mcleod/tmsIngest.ts:~326-370`, `.upsert(rows, {onConflict:"org_id,provider,external_id"})`), schema `driverTimeOffInputSchema` (`packages/shared/src/tms.ts:35-48`, `windows[]` with `external_id`, `driver_employee_id`, `start_at`, `end_at`, `kind`, `raw`). `driver_time_off` is module `roster` (table-modules.json:610-611) yet this mcleod file writes it directly. And the fuel rule `deriveDriverHomeAtFill` (`apps/api/src/modules/anomalies/scoring/tmsGates.ts:15-50`) reads EVERY provider's non-canceled periods, `end_at null = still off`.
- Fix: (1) reuse `/api/tms/driver-time` + `driverTimeOffInputSchema` (no new fields on `tmsDriverInputSchema`); (2) H2 periods are imported only when started (`next_home_date ≤ today`) and with `end_at = pta_date` — a null `pta_date` must not produce an open-ended period, or every later fill of that driver scores "home" in the fuel anomaly; (3) note the existing mcleod→roster-table write (`ingestDriverTimeOff` upserts — check the payload is full-row, `lint:upserts`) is the path, not a new roster export; (4) test: an imported McLeod period changes `deriveDriverHomeAtFill` only inside its window.

### D-51 [GAP] — `PUT /equipStatus/create` is a Drivers-role operation
- Spec says (line 1061, 1080): H1 writes a driver status event with `PUT /equipStatus/create`.
- Evidence: MCLEOD-API-SURFACE:60 "W `PUT /equipStatus/create` (Drivers)". The integration user (C E4, C-transport.md:94) is an office `Users`-role user. Also `RowDriverStatus` and `PUT /equipStatus/create` detail are on the surface doc's unread list (:104-105).
- Fix: Appendix C item 11 adds "role needed for `/equipStatus/create` (Drivers) — can the integration user hold it?"; H1's write path falls back to TableRowService `PUT /<driverstatus table>/create` (Users) if `/ws/docs` names the table; else H1 is read-only.

## MK4 schema / dedupe / retention / UI

### D-52 [WRONG] — `mcleod-outbound` retention 1,095 days contradicts `mcleod_image_sends` in RETENTION_FORBIDDEN
- Spec says (line 262-266): bucket files get a retention rule "with the SAME 1,095 days as `load_stop_photos`" in `dataRetentionPolicy.ts`, AND `mcleod_image_sends` goes in `RETENTION_FORBIDDEN`.
- Evidence: `apps/api/src/modules/org/dataRetentionPolicy.ts:225-243` — retention works by DELETING THE ROW ("Deleting the row is the whole mechanism. The object then has no row pointing at it, and the `load-photos` orphan sweep … removes the bytes"); rules are per table (`table`, `timeColumn`, `keepDays`). The only row pointing at an outbound file is `mcleod_image_sends` (`file_path`), which the spec makes forbidden AND append-only (guard refuses DELETE). So no rule can express "delete the file after 1,095 days".
- Fix (pick one, recommend (a)): (a) keep the outbound files as long as the send row (they are the exact bytes delivered to billing — the record the evidence row describes; budget: ~210 stops/day × ~1–3 MB); register the bucket with `storageReconcile.ts` (`apps/api/src/modules/org/storageReconcile.ts:161-247`, the `{bucket, table}` source list) so ORPHANS (upload done, RPC never ran) are swept; no retention rule. (b) do not store the PDF at all: rebuild it from the source photos deterministically (see D-53) when the agent fetches — then `file_path` is dropped. Either way, delete the sentence that contradicts.

### D-53 [GAP] — the PDF's sha256 is not stable unless pdf-lib metadata is fixed; dedupe and uuidv5 depend on it
- Spec says (line 204-207, 293-295): unique on `sha256` "of the exact bytes sent"; request id `uuidv5("image_upload/<source key>/<sha256>")`.
- Evidence: `pdf-lib` 1.17.1 (`apps/api/package.json:54`) sets `CreationDate`/`ModDate`/`Producer` at `PDFDocument.create()` unless `{ updateMetadata: false }`; two assemblies of the same photos therefore hash differently. There is no PDF-from-images builder in api today to reuse (only `importMcleodUnitPapers.ts`'s content sniffer; `apps/api/src/modules/document-reading/` handles reads) — `assemble.ts` is new.
- Fix: `PDFDocument.create({ updateMetadata: false })`, set creation/mod dates to the first photo's `captured_at`, no random ids; a unit test assembles the same fixture twice and asserts equal sha256. Without it, a crash between upload and RPC followed by a re-sweep produces a second file and a second (different-sha) send — the candidate sweep's `(stop_id, kind)` subtraction is then the only dedupe; make that a DB constraint too (D-54).

### D-54 [WRONG] — "Send again" cannot insert a new send row: the bytes-unique key refuses it
- Spec says (line 393-395): retry "creates a NEW request (new uuidv5 with a `/retry-<n>` suffix) — the refused row is never edited"; (line 231) `mcleod_image_sends.id = mcleod_write_requests.id`; (line 253-254) `unique (org_id, company_id, row_type, row_id, document_type_id, sha256, page_no)`.
- Consequence: a retry of the same bytes needs either a new send row (refused by `uq_mcleod_image_sends_bytes`) or a request whose id ≠ the send id (contradicts line 231).
- Fix: split identity: `mcleod_image_sends` = one row per PAPER (unique bytes key kept), `request_id` column removed from the id, and a child list of request ids lives in the pipeline (`mcleod_write_requests.source_ref = 'image_send:<send id>'`, C's `source_ref`, C-transport.md:354). Retry = new request with `source_ref` → same send. Add a partial unique index `(org_id, stop_id, kind) where stop_id is not null` (one paper per stop and kind — the candidate sweep's rule, made a constraint), and for the TIFF branch include `page_no`.

### D-55 [GAP] — `skipped` stops and photos added before completion
- Spec says (line 288-289): `completedStopPapers` returns "completed stops (`completed_at` within 14 days)".
- Evidence: `0141:344` `completed_at` is set for BOTH `completed` and `skipped`; a skipped stop may carry a bol photo (0141:348-362 inserts photos for any status).
- Fix: say whether a `skipped` stop's bol photo is sent (recommend: yes, it is still a paper billing needs; the stop's `skip_reason` goes in nothing sent). Filter on `status in ('completed','skipped')`, not just `completed_at`.

### D-56 [GAP] — settings surfaces are catalogue entries, not bare section checks; the "existing McLeod card" on Data & sync does not exist
- Spec says (line 388-391, 401-404, 564-567): mapping card "Settings › Data & sync › McLeod › Document categories … beside the existing McLeod card"; backstop list "on the McLeod card on Settings › Data & sync".
- Evidence: `apps/web/src/lib/settingsCards.ts:64-66` — cards are `admin.settings.data` ("Samsara sync, re-sync, rebuild anomalies…"), `admin.settings.efs`, `admin.settings.mcleod-fleets`; every settings route is a surface in `packages/shared/src/surfaceCatalogue.ts` (e.g. :425 `admin.settings.mcleod-fleets`, gate `section("settings")`), and `apps/web/src/router/routes/settings.ts:1-19` reads the gate from the catalogue. No "McLeod card" exists on Data & sync.
- Fix: name the place: either a new surface `admin.settings.mcleod-writes` (catalogue entry, route, settings card, tutorial stub — memory `new-page-request-needs-a-tutorial-stub`; `bundle` CI) or a section on the existing `McleodFleetsSettingsPage.vue`. The API gate must equal the surface's gate (`section("settings")` → `requireSection('settings','manage')` for writes, `view` for reads).

### D-57 [IMPRECISE] — lumper route gate
- Spec says (line 396-397): "`lumperCases.ts` uses the dispatch/billing gate it already has".
- Evidence: the gate is in `apps/api/src/modules/mcleod/lumper/routes.ts:17` — `requireModule("dispatch"), requireSurface("dispatch.lumper-cases")` (D-LRC11: dispatch and billing share the list via a surface). `lumperCases.ts:239` hard-codes `kind: "revised_rc"` on insert.
- Fix: cite routes.ts:17 and lumperCases.ts:239; the "Send again" for a lumper send (MK4.6, `requireSection("dispatch","manage")`) excludes the accountant who works the same list — use `requireSurface("dispatch.lumper-cases")` for lumper kinds.

### D-58 [GAP] — the phone's `sha256` would be stripped by the API before it reaches the RPC
- Spec says (line 210-213): the phone "sends it in `p_photos[].sha256`; `driver_complete_stop` stores it".
- Evidence: the phone posts to `POST /api/me/loads/:loadId/stops/:stopId`; the body is validated by `completeStopRequestSchema` → `stopPhotoInputSchema` (`packages/shared/src/loadsContract.ts:129-149`: `id, slot, storage_path, captured_at` — a non-strict `z.object`, which STRIPS unknown keys), then `completeStop` passes `input.photos` as `p_photos` (`driverLoads.ts:284-300`).
- Fix: add `sha256: z.string().regex(/^[0-9a-f]{64}$/).optional()` to `stopPhotoInputSchema` (merge 1, with or after M-D2 — the old function ignores the extra jsonb key, so either order is safe), then the driver app sends it (merge 2 / OTA). `expo-crypto` is already a dependency (`apps/driver/package.json:46`, "57.0.1") — the spec's "check … add it if absent" closes as: present, no native change, no fingerprint bump.

## SSN (task item 6)

### D-59 [IMPRECISE] — SSN never sent: the assertion is on the wrong object, and the fallback's "D-RL5's sweep links it" is wrong after a 360 close
- Spec says (line 597-603): "`payload` has no SSN key; `toRowDriver` has no SSN mapping; `writes/rowMap.test.mjs` asserts no output key matches `/social|ssn/i`"; create step 3 (line 579) "`GET /drivers/new` ⇒ defaults; overlay `toRowDriver(payload)`"; fallback "the hire in McLeod is done by hand as today and D-RL5's sweep links it".
- Evidence: MCLEOD-API-SURFACE:56-59 lists `social_security_no` as a `RowDriver` field. The create body = McLeod's `/drivers/new` defaults + our overlay, so a default `social_security_no` key (empty or a placeholder) WOULD be PUT back even though `toRowDriver` never emits one. D-RL5 (`rosterApplicantHire.ts`) handles `status='applicant'` rows only; after 360's Close the row is `active` + `manual`, matched by licence by `rosterMatch` (rosterMatch.ts:95-104) and linked but never refreshed (rosterIngest.ts:33-38) — see D-30/D-31.
- Fix: (1) the agent deletes every key matching `/social|ssn|tax_id/i` from the merged body before `PUT /drivers/create`, and the stub-server test asserts on the BODY RECEIVED by the stub, not on `toRowDriver`'s output; (2) fallback text: "`driver_create` stays off for that company (switch per company? C's switch is per org+kind — if SSN is required on one company only, the kind is off for all; say so); the drawer shows 'Enter this driver in McLeod…'; the next sweep links the 360 row by licence and the result is linked-but-office-owned — the office uses 'hand back to McLeod' (MK5.4) or the spec adds an automatic hand-back for a row hired in 360 within N days whose licence and name agree." (3) MK0 check 7 also records whether McLeod REFUSES a create without SSN vs. accepts and leaves it blank — "required" is only known if the create is refused naming it; a silent blank is a different outcome (accepted, office must still key SSN in McLeod for payroll/1099) and the spec has no branch for it.

## Open decisions treated as ruled (task item 7)

### D-60 [OPEN] — every re-ruling this spec "records" is still a proposal in the parent plan
- Spec says (line 9, 13): "No step below waits on an unwritten decision"; "The write-request pipeline (ruled …)".
- Evidence: `MCLEOD-API-KIT-PLAN.md:239-245` — D-MK1, D-MK2, D-MK3, D-MK4, D-MK5 all "proposed"; :178-196 Q-MK11..14 are "Recommend: …"; :251-252 progress log "Next: owner rules Q-MK1..15". Spec D records D-RL5a, Q-7b, D-MR6a, D-MSUX7a, D-MK2-1 (re-ruling the kit plan's MK2 row :222) and D-HT5a into six other plans as decisions.
- Closure: list them as a block "needs the owner's ruling before the build of that section: Q-MK11 (D-RL5a), Q-MK12 (Q-7b), Q-MK13 (D-MR6a), Q-MK14 (D-MSUX7a), MK2 row → D-MK2-1, D-HT5a (Q-HT1)"; the spec's MK0-branch closures are fine as build forks, but the re-rulings are the owner's. Appendix B's plan edits are appended "proposed", not "ruled".

### D-61 [OPEN] — MK5.4 writes far more driver fields than Q-MK13 / D-MK2 propose
- Spec says (line 734-737): writable = every `driverPatch` key (names, CDL number/state/expiry, medical, hire date, DOB, address, email).
- Evidence: Q-MK13 (`MCLEOD-API-KIT-PLAN.md:188-190`) "for the fields in D-MK2"; D-MK2's table (:124-136) lists only "Medical card / CDL expiry when 360 holds the scanned card", "New driver at hire", "Termination / rehire" as driver writes.
- Closure: either narrow MK5.4 to D-MK2's rows (medical/CDL via MK5.5 only — then MK5.4's route is not needed beyond the phone-claim fix), or name the widening as a new ruling Q-MK13a with the field list and the reason (stopping the "edit reverts every night" for address/email). Recommend the narrow version first; widen per field on the owner's word. The phone-claim trigger fix (M-D5) stands on its own regardless (it is a defect, D-26).

### D-62 [OPEN] — assumptions/TBDs in the spec, with the closure from code
| Spec line | Assumption / TBD | Closure |
|---|---|---|
| 19, 46 | pipeline table/contract names "wins if it differs" | They differ — use C's names (D-18). |
| 48-50 | `uuid` an api dependency? | Absent; reuse `uuidV5` in `apps/api/src/scripts/importMcleodUnitPapers.ts:136-144` (D-22). |
| 200, 324, 335, 702, 1029 | `mcleod_api_capabilities` "(the MK0 table, pipeline spec)" | Not in C; add it (D-18). |
| 210-211 | `expo-crypto` present? | Yes, `apps/driver/package.json:46` (D-58). |
| 270-275 | LRC build's `source`/`mcleod_image_id` merged first? | Not on main: `lumper_case_files` is still 0601's shape (kind `revised_rc` only, no `source`); M-D3 owns `source` unless LRC lands first — also coordinate LRC's `role` column (D-10). |
| 549-551 | "synchronous read lane if the pipeline spec has one" | C has none (no "synchronous"/"read lane" in C-transport.md); the code check is the create's own precheck (`conflict` "code taken"). Delete the conditional. |
| 763 | `drivers.ts` crossing 450? | 328 lines today; the new route is in `mcleod/routes/officeWrites.ts` anyway (D-MK5-0g) — the condition is moot; delete it. |
| 937-942 | freshness row has a place for `source_db`? | Yes, `org_integrations.config` (D-45). |
| 1017-1029 | ETA write path | Unknown until our `/ws/docs` — `RowCallin`, `RowStop` unread (D-49). |
| 1080 | `RowDriverStatus` table name / role | Unread; `/equipStatus/create` is a Drivers-role op (D-51). |
| 482 | `RowDriver.license_date` | Not on the surface doc's field list; MK0 (keep). |
| 571 | `/drivers/search` licence parameter | Unread; MK0 (keep). Note the surface doc lists `GET /drivers/search` but no params. |
| 700-703 | `RowTractor` sub-status key `tractor_status` vs `status` | Surface doc says "status is `status`, `service_status`, `inservice_date`, `outservice_date` on the row" (:66-67); `RowTrailer` unread. MK0 (keep). |

## Missing steps (task item 5)

### D-63 [GAP] — file budgets the spec's additions would break
- `packages/shared/src/tms.ts` is **499** lines (budget 500, `scripts/check-file-size.mjs:55`): `MCLEOD_UNIT_STATUS_REQUESTS` + `statusEditRoute` "in `packages/shared/src/tms.ts`, beside `deriveVehicleStatus`" (line 683) cannot go there — new file `packages/shared/src/mcleodUnitStatus.ts`.
- `packages/shared/src/rosterContract.ts` 452 (already in the warn band): the schema fields (MK5.2) and the source-qualified identity list (D-27) push it toward 500 — put `DRIVER_MCLEOD_WRITABLE_FIELDS` in a new shared file.
- `apps/api/src/modules/roster/homeTime/homeTime.ts` 456 (warn band): `homeTimeChangesSince` goes in its own file under `roster/homeTime/`.
- `apps/api/src/modules/mcleod/tmsIngest.ts` 419, `apps/api/src/modules/org/dataRetentionPolicy.ts` 415, `apps/api/src/modules/mcleod/routes/tmsIngest.ts` 397 — modest headroom; don't add MK2's `source_db` handling and image routes there (spec already puts images in `tmsImages.ts`).
- `tools/mcleod-agent/agent.mjs` 1,156 lines is NOT "grandfathered": `check-file-size.mjs` scans only `apps` and `packages` (SCAN_DIRS, :57). Correct the reason (line 982-983); the separate-file advice still stands.

### D-64 [GAP] — `/api/mcleod` is a new mount and needs the route-gate ledger
- Spec says (line 524): "`officeWrites.ts` (mounted at `/api/mcleod`)".
- Evidence: no `/api/mcleod` mount in `apps/api/src/app.ts` (mcleod office routes today mount at `/api/integrations` :261-263, `/api/lumper-cases` :251); `apps/api/src/routeGateLedger.test.ts` walks every route's gate.
- Fix: add the mount in `app.ts` with a one-line comment, and confirm each route's gate is visible to `routeGateLedger` (gates declared inline, not through a local const it cannot see — the ledger's own header :17-22).

### D-65 [GAP] — evidence boundary edges are "narrow by construction" by documented function
- Evidence: `scripts/check-feature-boundaries.mjs:101-151` — each allowed edge's comment names the ONE function it carries ("mcleod -> evidence: recordSyncedCredentials only", "mcleod -> loads: applyMirroredLoads only", "mcleod -> roster: recordVehicleFleetCodes only", "mcleod -> org: listOfficeMembers and lookupMemberRole only").
- Fix: spec D adds exports across four edges (`completedStopPapers`, `latestStopPredictions` → loads; `applyDriverUpdate`, `linkHiredDriverToTms`, `homeTimeChangesSince`, a vehicle/trailer read → roster; a medical-state read → evidence; `requireNamedPermission` → org). Each comment must be updated in the same PR to name the new functions (the gate does not check symbols, the comment is the only record).

### D-66 [GAP] — Appendix C misses checks the spec itself depends on
Add: (13) `name_of_spouse` width on `RowDriver` (D-23); (14) `ROW_UPDATE_MODE` for `stop` (MK6.1 step 2.2 reuses MK5.0b's mode, but item 6 lists driver/tractor/trailer only); (15) `RowCallin` fields and `RowStop.eta` (D-49); (16) role for `/equipStatus/create` (D-51); (17) does `GET /drivers/new` return a `social_security_no` key, and does create accept a blank (D-59); (18) every MK5.0-table key present on `RowDriver` (D-25); (19) `GET /images/{rt}/{row}` per-image fields include the uploader (the daily double-capture count, MK4.9 step 5, needs "non-integration-user image" — the user field must be in the list response).

### D-67 [GAP] — migrations, RLS, append-only: remaining points
- Numbering: latest on disk `0636_toll_plazas_and_observations.sql` (confirmed). Specs A, B, C each add migrations too (C's `<next>_mcleod_api_transport.sql` must precede M-D1, whose RPC inserts into `mcleod_write_requests`). State the dependency: M-D1 ships after C's transport migration is on main.
- `mcleod_image_sends.lumper_case_id … on delete set null` (line 238) is an UPDATE of the child row — the append-only guard (line 257-258) refuses every UPDATE but `mcleod_image_id`; a lumper case delete (or the org-delete cascade order) would raise. Use `on delete restrict` (lumper cases are evidence-adjacent) or let the guard allow `pg_trigger_depth() > 1` as C's evidence guards do (C-transport.md:468-470).
- The kind list `('bol','pod','lumper_receipt','revised_rc')` is written in TWO checks (kind_map :149, sends :233); `mcleod-image-kinds.test.mjs` must parse both against `MCLEOD_IMAGE_KINDS`, not one.
- RLS: every new table in M-D1, M-D4a, M-D7, M-D8, M-D9 enables RLS with zero client policies — OK. `rls.test.mjs` seeding for each — stated for M-D4a only; add M-D1/M-D7/M-D8/M-D9.
- Retention/evidence: `mcleod_image_sends` → RETENTION_FORBIDDEN (`apps/api/src/modules/org/dataRetentionForbidden.ts`, `mcleod_settlements` at :309 is the pattern) — OK, but see D-52. `mcleod_fuel_purchases` → RETENTION_FORBIDDEN beside `mcleod_settlements` — OK.
- Column-then-reader: M-D2 (column + in-DB reader) OK; M-D4b (D-35: the PATCH WRITE is the first reader); M-D3 before the receipt UI OK; MK6 home-time read "contract first, ingest second" unnecessary if D-50's existing route is reused.

### D-68 [GAP] — UI wording and audit for MK5 routes not specified per route
- D-MK5-0e defines `mcleod.<kind>.requested`; MK5.3/5.4/5.5 do not name their audit actions or the office sentences for each `reason_code` (C keeps them in `MCLEOD_WRITE_REASONS`, C-transport.md:535-543). Add per kind: action names (`mcleod.tractor_update.requested`, `mcleod.driver_update_fields.requested`, …) and the reason codes the agent can return (`code_taken`, `exists_in_mcleod`, `not_eligible_for_rehire`, `changed_in_mcleod`, `category_missing`, `bytes_changed`, `not_visible_after_window`, `superseded`, `arrived`) with their sentences — `MCLEOD_WRITE_REASONS` is the one place.
- Audit of the pipeline's state changes "written by the pipeline's result route" (line 517-519): C's `mcleod_write_attempts` is already the state history (append-only); an `audit_logs` row per state change restates it — "deriving beats restating"; drop it or justify.

### D-69 [WORKAROUND-check] — items that read as simplifications
- MK4 "no skip heuristic" for bol/pod duplicates (line 220-223): a deliberate, measured choice with a daily count — acceptable, labelled.
- MK5.3 `V` never written; "Running" writes `A` over `V` (line 703-704): a McLeod planning state is overwritten if the office picks Running on a `V` truck — the expect (`status` as swept) would be `V`; say the office's Running on a `V` truck is a no-op (already running in 360's terms) rather than a write.
- MK2 `voucher_dist` kept in the request "because removing a line … costs more" (line 903-905): fine, labelled.
- MK4.4 switch rule step 4 "the rule is the approval" (line 354-355): replaces an owner decision with a rule — needs the owner's yes once (D-60).
- D-MK4-5 TIFF branch "one request per page" collides with C's one-live-intent index (D-20) — every page targets the same order.

### D-70 [IMPRECISE] — F3/F7 details
- `drs_check` "684/684 keys join, measured on the copy" (line 891): source is `docs/plans/financial/TRUCK-DRIVER-PNL-PLAN.md:283` (July 2026, measured 2026-10-21) — cite it. FINANCE-REPORTS-V2-PLAN.md:100 gives `drs_check` 64,254 rows.
- `gl_summary` columns "the memory already lists … the probe confirms them" (line 953-955): FINANCE-REPORTS-V2-PLAN.md:99 says "Columns not yet read." The repo's plan contradicts the memory; the spec should cite the plan and treat the column list as unknown until F7's probe.
- F3 widening `GL_KEY_LINES` to every module: `mcleod_gl_key_lines`' manifest budget is 1,500 rows/day derived from 4 modules (~490/day, `scripts/table-modules.json:2135-2136`); adding AP, DRS, OFF, DED, GJ, RJ, CASH, WIRE needs a re-measured budget in the same PR or `lint:table-lifecycle`'s budget check (if it measures) and the manifest's `why` go stale.

### D-71 [IMPRECISE] — `auth.ts:74-160` for SECTION_ACCESS
- Evidence: `packages/shared/src/auth.ts:136-160` (the matrix; its doc comment starts ~:100). Spec cites :74-160 (line 388). Minor.

### D-72 [OK] — gates and test files the spec names all exist
- `supabase/tests/{unit-file-kinds,definer-rpc-grants,schema-drift-production-shape,rls}.test.mjs` exist; `package.json` has `lint:table-producers`, `lint:table-lifecycle`, `lint:vehicle-status`, `lint:table-writers`, `lint:table-access`, `lint:table-modules`, `lint:comment-claims`, `lint:upserts`, `lint:funcsize`, `lint:migration-ordering`, `lint:boundaries`; `scripts/table-writers.json`, `supabase/schema.generated.sql` exist; `apps/api/src/modules/org/dataRetention.test.ts` exists. Plan files named in Appendix B all exist (BOL plan `docs/plans/drivers-app/`, Q6 :629, Q9 :632, §9 log :667; ROSTER-SYNC `docs/plans/mcleod/`; MEDSTOP `docs/plans/safety-dqf/`; IFTA `docs/plans/fuel/`; finance plans `docs/plans/financial/`; HOME-TIME and DISPATCH-BOARD and LUMPER `docs/plans/dispatch-loads/`; FLEET-CENSUS `docs/plans/roster/`; ROSTER-LIFECYCLE `docs/plans/mcleod/`). Appendix B should carry these directories.
- `MCLEOD-API-KIT-PLAN.md`: decisions are §7 (:239-245), the log is §8 (:249); Appendix B says "§8: D-MK2-1, D-MK4-1..6 …" — append decisions as rows of §7's table AND a dated line in §8's log.

---
## Summary
72 findings: WRONG 13 · GAP 21 · IMPRECISE 13 · OPEN 3 · OK/OK-with-note 21 · workaround review 1.
Top 10: D-19, D-20, D-18, D-30/31, D-32, D-52+D-54, D-27, D-60/61, D-17, D-44/45 (see final report).
