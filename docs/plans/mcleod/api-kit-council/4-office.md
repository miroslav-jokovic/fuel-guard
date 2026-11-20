# Council member 4 — office writes, documents, roster/hire, ETA/home time, finance (round 2)

Repo `/Users/miroslavjokovic/Projects/FG-mcleod-api` at `4876449c7` (2026-11-20 09:14). Inputs: AUDIT-2026-11-20 §1, §2.6, §5;
spec D; audit D.md; WS.md. Every claim below re-read at file:line. (Complete.)

## Findings

### OF-1 [BLOCKER] — O-6 "reuse the old 360 record" has no path in the code today; the design must build one
- Ruling (AUDIT §5 O-6): a returning driver reuses the old 360 record and the old McLeod id; never a second create.
- Evidence that today's code cannot reach the old record:
  - An application link is sent only to a row whose `status = 'applicant'`
    (`apps/api/src/modules/recruiting/applicationLink.ts:88-90`, 409 `not_an_applicant`).
  - The hire requires `status = 'applicant'` (`apps/api/src/modules/recruiting/hireApplicant.ts:210-211`;
    `hire_applicant` raises at `0386_applicant_hire_guard.sql:119-120`).
  - No writer moves a terminated/inactive row back to `applicant` (0386 header :33-34 "Moves INTO 'applicant'
    … are untouched" — permitted, never built). `hire_applicant` sets `status, hire_date` only (0386:126-128): it
    does NOT clear `termination_date` or `archived_at`, so a reopened row would be hired as active-with-a-last-day.
  - A returning person who is invited as a NEW applicant row cannot be folded into the former row afterwards:
    `merge_driver` refuses a source with a filed application (MD010; `0387_packet_countersignatures.sql:45`,
    `mergeDriver.ts:15-16` "may never be moved"). Round-1's D-32 recommendation ("merge the new row into the former
    one") is therefore refused by the database.
  - No duplicate-licence check exists at the close: `validateHireRequest` checks only the date
    (`packages/shared/src/hireHandoff.ts:57-69`).
- Consequence: built as spec D MK5.1/5.2 + AUDIT §2.6, a returning driver gets a new 360 row; the close then either
  (a) creates a second McLeod driver (violates O-6), or (b) reactivates the old McLeod id and links it to the new row
  → 23505 on `uq_drivers_org_mcleod` (`0239_mcleod_roster_links.sql:62-63`) because the former row still holds it.
- Fix text (v2 §MK5.2 "Returning driver", replaces spec D's "converted in place"):
  1. **Rehire starts on the former record.** New roster export `reopenFormerDriverAsApplicant(admin, orgId,
     driverId, actorId)` (`apps/api/src/modules/roster/driverReopen.ts`): one RPC `reopen_former_driver(p_org,
     p_driver)` (roster migration) that, for a row with `status in ('terminated','inactive')`, sets
     `status='applicant'`, `archived_at=null`, `termination_date=null`, keeps `mcleod_driver_id`,
     `mcleod_company_id` and `identity_source` unchanged; audit `driver.reopened_for_rehire` carrying the previous
     status, termination date and archived_at (the `restoreRehiredDriver` shape, `driverRehire.ts:31-47`). Route
     `POST /api/recruitment/drivers/:id/reopen` (recruiting module → roster export; gate
     `requireSection('recruitment','manage')` + named permission `recruitment.close_application`). Button on the
     former driver's page: "Hire again" ("Start a new application for this driver").
  2. **The new application is a second invitation on the same row** — already the designed shape
     (`0337_application_edits.sql:23-25`: "a rehire's second application is a second invitation").
  3. **Catch the duplicate before signing.** When `record_applicant_identity` stores a licence that equals the
     licence of a non-applicant row in the org (cdlKey), the office board shows "This licence belongs to former
     driver <name> — use Hire again on their record" and the hire of the NEW row is refused at the close with 409
     `former_driver_exists` (new check in `hireApplicant.ts` beside `not_an_applicant`). The new row is archived and
     purged by the existing path (`applicantPurge.ts`, unsigned) — never merged.
  4. **The close of a reopened row sends `driver_reactivate`, never `driver_create`.** The McLeod step reads
     `mcleod_driver_id` on the row: present ⇒ enqueue kind `driver_reactivate`, target = that id, payload
     `{active:true, hire_date:<close's hire date>, termination_date:NULL, reason_for_leaving:NULL}`, baseline
     `{active:false, license_no}`; absent ⇒ the O-7-gated `driver_create` path (OF-3).
  5. **Former driver never seen by 360** (terminated in McLeod before the sweep existed — no 360 row): the agent's
     create precheck `GET /drivers/search?license_no=` finds an inactive McLeod driver ⇒ the create request ends
     `conflict` reason `former_driver_in_mcleod` with that McLeod id in `observed`; the office presses "Rehire this
     McLeod driver", which enqueues a NEW `driver_reactivate` request targeting the found id (targets are immutable,
     C-transport MW003) and links the 360 row with `linkHiredDriverToTms` (no 23505: no 360 row holds that id —
     the route re-checks and refuses 409 `mcleod_id_linked_elsewhere` if one does).
  6. `identity_source`: a reopened row that was `mcleod` stays `mcleod` (the sweep refreshes it once McLeod is active
     again); one that was `manual` with a McLeod id is handed back by `linkHiredDriverToTms` (sets `'mcleod'`).
- Tests (exact files): `supabase/tests/reopen-former-driver.test.mjs` (terminated→applicant clears
  termination/archive, keeps the McLeod id; active row refused; another org refused; RESULT line);
  `apps/api/src/modules/roster/driverReopen.test.ts` (`expectOrgScoped`, audit row carries old termination);
  `apps/api/src/modules/recruiting/hireApplicant.test.ts` (+ `former_driver_exists`);
  `apps/api/src/modules/mcleod/writes/driverReactivate.test.ts` (reopened row ⇒ reactivate, not create; no
  `uq_drivers_org_mcleod` violation); `tools/mcleod-agent/writes/driverCreate.test.mjs` (+ inactive licence ⇒
  `former_driver_in_mcleod`, no PUT).

### OF-2 [WRONG] — the claim fix has THREE consumers of `DRIVER_IDENTITY_FIELDS`, not two
- AUDIT §2.6 "Claim defect": trigger + `resolveDriverUpdate` / `DRIVER_IDENTITY_FIELDS` in the same PR.
- Evidence: the list is also read by the web's pre-save warning `wouldClaimFromTelematics`
  (`packages/shared/src/driverEditMeaning.ts:42-48`, used by `apps/web/src/features/roster/DriverForm.vue:46`), and
  its parity is pinned by `apps/api/src/modules/mcleod/rosterFields.claimParity.test.ts:113-116`
  ("drivers mirror DRIVER_IDENTITY_FIELDS, so PostgREST and resolveDriverUpdate agree", comparing the trigger's
  argument set to the list with plain `toEqual(new Set(...))`) and by `apps/api/src/driverFieldOwnership.test.ts`.
  The defect itself is confirmed: drivers trigger args `0241_identity_provenance_claim.sql:124-129` include
  `'phone'`; the loop at :82-93 claims the whole row on any listed column; `resolveDriverUpdate`
  (`rosterContract.ts:409-411`) does the same in TS.
- Fix text: the same PR changes (1) M-D5 trigger args to `'full_name','first_name','middle_name','last_name',
  'phone@samsara'` with `split_part(col,'@',1)` for the jsonb lookup and `split_part(col,'@',2)` compared to
  `old.identity_source` (function keeps `security definer`, `set search_path = ''`, 0241:46-47); (2)
  `DRIVER_IDENTITY_FIELDS` becomes `{field, sources?}[]` in a NEW file `packages/shared/src/driverIdentityFields.ts`
  (rosterContract.ts is 452 lines, warn band) re-exported from rosterContract; (3) `resolveDriverUpdate` AND
  `wouldClaimFromTelematics` both call one helper `claimsIdentity(field, identitySource)`; (4)
  `rosterFields.claimParity.test.ts` renders the shared list as `col` / `col@source` and compares it to the parsed
  trigger args of the newest migration; (5) `driverEditMeaning.test.ts` gains "a phone edit on a McLeod row does
  not warn". Note: the 0241 vehicles/trailers triggers (re-created at `0242_trailer_axle_count.sql:64-76`) are
  untouched — M-D5 re-creates only the drivers trigger.

### OF-3 [GAP] — O-7 switch-off is stated, but what the close drawer does while `driver_create` is `off` is not
- AUDIT §5 O-7: the hire → McLeod create stays `off` until the owner's sentence is on file.
- Evidence: today a 360 close leaves an active `manual` row with no McLeod link; the sweep later matches it by
  licence (`rosterMatch.ts` pool, non-applicant rows) and links it but never refreshes it because it is `manual`
  (rosterIngest.ts:33-38; round-1 D-31, re-verified: `driverTmsHandover.ts:24-29` updates only
  `status='applicant'`). So with the create off, every 360 hire is a linked-but-frozen row — a regression the
  current D-RL5 sweep avoids only for McLeod-first hires.
- Fix text: v2 builds `linkHiredDriverToTms` (AUDIT §2.6) and wires it into the SWEEP, not only into the create's
  result route: when `rosterMatch` links an active `manual` row that has a `compliance.applicant_hired` audit in the
  last 30 days and whose name agrees (the `sameName` rule, `rosterApplicantHire.ts:51-53`), the sweep calls
  `linkHiredDriverToTms` (sets `identity_source='mcleod'`). That closes the "hired in 360, entered in McLeod by
  hand" path while O-7 is pending — the path every hire takes today. Drawer text while off: "Enter this driver in
  McLeod. 360 will connect them on the next McLeod sync."
  Test: `apps/api/src/modules/mcleod/rosterApplicantHire.test.ts` + "a 360-hired manual row is handed to McLeod
  when McLeod's driver matches by licence and name".

### OF-4 [WRONG] — O-2 and O-7 contradict each other on what a create carries
- O-2 (AUDIT §5): "Names, DOB, address, email and CDL number are not written." O-7: a 360 hire creates the McLeod driver.
- A McLeod driver cannot be created without a name and a licence: the create body is `GET /drivers/new` + our fields
  (WS.md:141-142), and the duplicate guard itself searches by `license_no` (WS.md:145-147).
- Fix text (v2 rulings block, and in the O-7 proposed wording): "O-2's list governs UPDATES of an existing McLeod
  driver. A CREATE (O-7) and a REACTIVATION (O-6) carry, once: first name, last name (`name`), licence number and
  state, licence expiry (`license_date`), medical-card expiry, date of birth, address, hire date. Email is never sent
  (`name_of_spouse` forbidden, AUDIT §2.6). After the create, McLeod owns those fields and the sweep refreshes 360
  (D-MR6)." Ask the owner to confirm this sentence together with the O-7 sentence (one message, not two).

### OF-5 [WRONG] — tractor sub-status key is NOT settled; W2 used another carrier's install
- AUDIT W2 / WS.md:68-70 conclude RowTractor has `status` and "no `tractor_status` key … it's `status` on this
  install". The install read is `tms-map.mcleodhosted.com` (WS.md:245-247) — another McLeod customer, not ours.
- Our SQL reads `t.tractor_status` (`tools/mcleod-agent/queries.mjs:91`) and `t.service_status`
  (:166, :258). Whether RowTractor `status` (2 chars) is the same column as our `dbo.tractor.tractor_status` is unknown.
- Fix text: keep spec D's MK0 check, made exact: "GET /tractors/{id} (TractorService) for one truck SQL shows with
  `tractor_status='S'` and one with `'I'`; record which RowTractor key carries `S`/`I`. If no key carries it, the
  in-shop and winding-down choices are not offered (only Running/Out of service/Back in service), recorded as a
  capability row." The value written for "Running" is `A` (148 of 193 in P4, queries.mjs:88-89); a truck already `V`
  is not written at all (round-1 D-69).

### OF-6 [GAP] — trailer write: which RowTrailer fields, which values, and McLeod's own validation
- Evidence: our census reads only `is_active` (`queries.mjs:192` `= 'A'`; retire `<> 'A'` :272); values measured
  `A` 231 / `I` 172, every `I` with an `outservice_date` (`FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md:312-313`). RowTrailer has
  `is_active`(1), `statuscode`(4), `disposition_code`(4), `inservice_date`, `outservice_date` (WS.md:73-75); no
  `status`. TableRowService "makes sure that auditing, permissions and validation code runs" (WS.md:21) — McLeod may
  require `disposition_code` on deactivation.
- Fix text (replaces spec D MK5.3 "`TRAILER_ACTIVE_KEY` (`is_active` vs `status`)"): "Trailer out of service writes
  `is_active='I'` and `outservice_date`; back in service writes `is_active='A'`. `statuscode` and `disposition_code`
  are never written by 360. MK0: deactivate a test-company trailer with only those two fields; if McLeod refuses
  naming `disposition_code`, the office picks the code from a list read by the agent (distinct `disposition_code` on
  the 172 inactive trailers), never typed." The bulk Retire on TrailersPage keeps skipping linked rows exactly as
  today (`apps/web/src/pages/TrailersPage.vue:221-229`); the McLeod path is one trailer at a time.

### OF-7 [GAP] — `reason_for_leaving` is a 3-character CODE in McLeod, not text
- WS.md:82 "`reason_for_leaving` width = 3 (a code, not free text)"; spec D MK5.2 adds free-text
  `drivers.reason_for_leaving text` with "zod max set to the width".
- Fix text: the termination drawer for a McLeod-linked driver shows **Reason** as a select of McLeod's codes (the
  agent reads distinct `reason_for_leaving` values on inactive drivers once a day into the M-D4a options table,
  field `reason_for_leaving`, with McLeod's description where `/ws` returns a `__…Descr`), and **Can be hired again?**
  Yes / No (`can_rehire` Y/N). The 360 column stores the code; the label is read from the options table.
  `DRIVER_LIFECYCLE_FIELDS` (`rosterContract.ts:349`) gains both, so a recruiter cannot set them on an applicant
  (round-1 D-35, re-verified). Test: `apps/api/src/modules/mcleod/writes/endEmployment.test.ts` — a code not in
  the options list ⇒ 422, nothing written.

### OF-8 [GAP] — documents: "seen on the order" is not reliable as written; make it a rule
- Facts: the POST result string is a batch id OR a stored record id, indistinguishable (WS.md:107-108). The image
  list type `Image` has only `id, documentTypeId, descr, scanDate, imageCount, appId, companyId` (WS.md:218-219) —
  **no uploader field**. So (a) round-1 D-66(19)'s "non-integration-user image" count cannot be computed from `/ws`;
  (b) a snapshot diff cannot tell our image from a McLeod-capture image of the same category filed in the same
  window — which is exactly the parallel period MK4.9 step 4 creates.
- Fix text (replaces spec D MK4.3 steps 5-6 under AUDIT §2.6's `filed_seen_at`):
  1. After a 2xx with result `S`, the agent lists `GET /images/O/{order}`; if an image with `id = S` is listed ⇒
     `mcleod_image_id = S`, `filed_seen_at = now()` (stored, not staged).
  2. Else `S` is a batch id: poll the list every 10 min; our image = the one image not in the step-2 snapshot with
     `documentTypeId` = mapped, `imageCount` = our page count, `scanDate` ≥ sent time − 5 min. Exactly one candidate ⇒
     seen. Two or more ⇒ `filed_seen_ambiguous` (office sees "In McLeod (could not tell which copy)"); never re-sent.
  3. **At most one 360 send in flight per (order, document type)**: the next send for the same pair is not leased
     until the previous is seen or its window expired. This removes 360-vs-360 ambiguity (two pickups' BOLs on one
     order).
  4. The double-capture count (MK4.9 step 5) is computed from Part 6 (`bolimgd.bimd_user`) only; until Part 6 runs it
     is "not measured", never estimated.
  Tests: `tools/mcleod-agent/images.test.mjs` + "result id listed ⇒ seen at once", "two same-category candidates ⇒
  ambiguous, no POST", "second send for the same order and category waits".

### OF-9 [GAP] — echo loop: 360's own upload comes back as a "McLeod" revised RC
- The LRC build reads RC-category images on case orders from imaging and copies them onto the case as
  `source='mcleod'` (`docs/plans/dispatch-loads/LUMPER-REVISED-RC-PLAN.md:387-393`; D-LRC16 :356-359: "the RC-category
  image scanned on or after the lumper's date is the revised RC"). Spec D sends office-uploaded `revised_rc` files INTO
  that category. The next lumper read will find our upload and attach it again as McLeod's — a duplicate file and a
  second D-LRC17 amount read.
- Fix text: `lumper.mjs` (both `fromDta` and `fromApi`) skips an image whose id equals a `mcleod_image_sends.mcleod_image_id`
  on that order; on route (b) it also skips `bimd_user = <integration user>`; while a send is not yet seen, an
  RC-category image on that order scanned after the send is held one cycle. Test:
  `tools/mcleod-agent/lumper.test.mjs` + "an RC 360 uploaded is not imported back as a McLeod RC".

### OF-10 [OK, with exactness] — pdf-lib determinism holds; state the real guard
- Verified in pdf-lib 1.17.1 (`apps/api/package.json:54`; `node_modules/pdf-lib/cjs/api/PDFDocument.js:142-150`
  `create({updateMetadata})`, `:1335-1345` `updateInfoDict` is the only `new Date()`; `core/PDFContext.js:32` the
  name RNG is `SimpleRNG.withSeed(1)` — deterministic; no trailer `/ID` is generated). So
  `PDFDocument.create({ updateMetadata: false })` + `embedJpg` in capture order gives identical bytes for identical
  JPEGs. "Fixed dates" are unnecessary: with `updateMetadata:false` no date is written; do not call
  `setCreationDate`.
- Caveat to write down: bytes (and so the sha256 key) change when pdf-lib's version changes. The duplicate guard
  must therefore not rest on sha256 alone: add the partial unique index `(org_id, stop_id, kind) where stop_id is
  not null` on `mcleod_image_sends` (round-1 D-54, not carried into AUDIT §2.6, which names only (bytes, order,
  category)). Test: `apps/api/src/modules/mcleod/images/assemble.test.ts` "assembles the same photos twice to the
  same sha256"; matrix `supabase/tests/mcleod-images.test.mjs` "a second send for the same stop and kind is refused".
- Simplification: if MK0 shows PDF refused, send each JPEG as `image/jpeg` (accepted, WS.md:105-106) — the original
  bytes, sha = the photo's own hash. Drop the `sharp().tiff()` branch (no conversion, one less dependency path).

### OF-11 [REGRESSION risk] — sending today's stop photo may give billing a worse image than McLeod's capture app
- Today: BOL/POD reach McLeod only through McLeod's capture app (BOL plan §0.2,
  `docs/plans/drivers-app/BOL-READING-RELIABILITY-PLAN.md:99-111`); 360's stop photo is never sent and is "resized,
  no gate, no hash" (`:63-64`): 1600 px wide, JPEG quality 0.6, no crop (`apps/driver/src/features/loads/stopCapture.ts:21-22,44-47`).
- If drivers stop using McLeod capture because 360 files, billing gets an uncropped 1600 px q0.6 photo instead of a
  document scan. Nothing in the plan measures legibility.
- Fix text (MK4.9 step 4 gate): "`bol`/`pod` go `live` for a fleet only after (a) the scanner capture is attached to
  stops (BOL plan Step 0.0 / scanner Step 6.2), or (b) a 14-day canary where the billing clerk marks each 360-filed
  BOL/POD readable or not, and ≥ 98% are readable. Until then 360 files them beside McLeod capture, and drivers are
  not told to stop using it."

### OF-12 [GAP] — finance: the "one message to Alex" must start from the 2026-11-13 request already in the repo
- Evidence: `tools/mcleod-agent/review/REQUEST-TO-ALEX-2026-11-13-FINANCE-ON-LME-AND-LUMPER.md` already asks (1) a
  copy refresh, (2) Part 2 re-run on `lme_analytics` after the refresh, then Part 4 on LME — and offers Alex "go
  straight to Part 4 on LME … Your call" (:30-47), (3) Part 5. `FINANCE-REPORTS-V2-PLAN.md:63` records it as
  sent and "not yet granted". AUDIT §2.6/§2.8 plans a fresh "one message to Alex" with Parts 2/3/4/5 + `drs_check`
  + `gl_summary` — written as if nothing were outstanding.
- Grant status re-verified (`SILVICOM-GRANTS.sql`): Part 1 run 2026-09-29 (:28-31, :82-83); Part 2 run 09-28/29 then
  LOST at the 10-09 restore (:59-64); Parts 3, 4, 5, 6 NOT YET RUN (:132, :153, :179, :195). Part 3's four tables are
  repeated in Part 4 (:171-174), so "Part 3 + Part 4" is one set on LME.
- Fix text: the Alex message is a **follow-up to the 11-13 email**, not a new request: "Two lines added to Part 4
  since 11-13: `drs_check` and `gl_summary` (read only, no personal data beyond a payee id). Everything else is as
  sent on 11-13." Part 2 additions of `drs_check`/`gl_summary` are dropped — no copy-side baseline exists for F3/F7,
  so the comparison never reads them (spec D MK2.1 adds them "only for the comparison run"; nothing to compare).
  The CHECK block's `IN (...)` (`SILVICOM-GRANTS.sql:225-230`) gains `drs_check`, `gl_summary`; Part 6 gets its own
  CHECK (its four `dta` tables are not in the list).

### OF-13 [GAP] — the comparison run must not depend on Alex choosing the copy night
- The 11-13 message lets Alex skip Part 2 on the copy (:46-47). If he does, the connector login never reads the copy,
  and spec D MK2.2 step 3 (`--financial --compare=lme_analytics` under one login) cannot run.
- Fix text: `tools/mcleod-agent/financeCompare.mjs` takes two connection configs — `--live-env connector.env`
  (`silvicom_dispatch_ro` on `lme`) and `--copy-env .env.sandbox` (`NikiAnalytics` on `lme_analytics`, which reads it
  today: F0 relies on it, FINANCE-REPORTS-V2 §5) — and runs on the owner's Mac on the office network, where both
  reach the SQL host. "Closed month" = every month before the open period that F0 recorded from the copy in
  `mcleod_gl_control` (period 8 per FINANCE-REPORTS-V2), read from 360, not from the copy's `gl_control` (the
  connector cannot read it there). Acceptance unchanged: closed months equal to the cent per (statement, month,
  module, account); a difference is listed with its posting keys and logged as a restatement.
  Test: `tools/mcleod-agent/financeCompare.test.mjs` + "two configs, one statement each side".

### OF-14 [OK] — F12b / C1 and the cut-over list, re-verified
- `FUEL_PURCHASES` = 28 aliases (AUDIT §2.6 / D-44 holds); `ledgerCoverage.ts:134` lag term; C1 = FINANCE-GO-LIVE
  :582, :639-664. `source_db` in `org_integrations.config` (no M-D6) holds (`0068_tms_integration.sql:15`).
- Precision to add: `mcleod_fuel_purchases.post_key`/`post_module` nullable (the UNION's unposted half, D-44), and
  `agent.mjs`'s "Fuel purchases are deliberately NOT posted" comment changes in the same PR. Steps 4-6 of MK2.2
  (switch, 322-day first night, `--allow-copy` guard) are complete as written.

### OF-15 [GAP] — O-8's call-in is a dispatcher-visible and possibly customer-visible act; probe its side effects
- RowCallin carries position, remark, `new_eta` (WS.md:91-94); `PUT /callins/create` takes `automated` (Boolean,
  default false) (WS.md:195-197). In McLeod a call-in is a check-call: it appears in the movement's call-in history
  and can drive customer status messages (EDI 214 / track-and-trace) and "last call-in" timers. Spec D writes up to
  one per stop per hour.
- Fix text (MK0 step for O-8, before the call-in is chosen): on the test company, create one call-in with
  `current_stop_id`, `new_eta`, `automated=true`, no latitude/longitude; then read (1) `GET /stops/{id}` — `eta` moved
  to the value at minute precision; (2) no change to `actual_arrival`, `status`, `prior_uncleared_stops`; (3)
  `GET /serviceFailures?…` shows no new row; (4) ask Alex in the one message: "Does a call-in send anything to a
  customer (EDI 214, e-mail, portal) for any customer of ours?" — a yes makes the call-in route `off` and O-8's
  fallback (RowStop `eta` via `PUT /stop/update`) the route. Also read 7 days of existing call-ins
  (TableRowService `GET /callin/search`) to know whether another integration (Samsara) already posts them.
  Always send `automated=true`.

### OF-16 [GAP] — O-8 ruled the ROUTE, not the write; keep the DB7 gate and fix its start date
- AUDIT §5 O-8 says the ETA "is written as a call-in"; it does not restate spec D's gate (D-MK6-1a: median |error|
  ≤ 30 min, p90 ≤ 90 min, n ≥ 300; else no write). AUDIT §2.5 (B-24) restarts DB7's 14 days at the release that puts
  the driver's arrival into `arrivedAt`. DB7 has never been recorded as run (`DISPATCH-BOARD-PLAN.md:482,500,513-519`).
- Fix text: "No ETA is written until DB7 passes. DB7 runs on the 14 days that start at B7's release (B-24), with the
  exact query of round-1 D-48 (`gps_age_seconds <= 900 and hos_known`, ≤ 6 h before `actual_arrival_at`, one
  prediction per stop per hour, absolute-error median and p90, n counted in stops). Result and verdict appended to
  DISPATCH-BOARD-PLAN §8." Without this sentence, v2 reads as "write the ETA" on unmeasured accuracy — making
  McLeod's screens worse than a dispatcher's typed value.

### OF-17 [WRONG] — W9's conclusion drops a route the docs show: TableRowService on `equipstatus`
- W9: EquipStatusService is Drivers-only, "that leaves RowDriver `next_home_date`/`pta_date`". But WS.md:171-176 names
  the table `equipstatus` and TableRowService (`GET /{table}/{id}`, `GET /{table}/{orderBy}/search`,
  `PUT /{table}/create|update`, role Users, WS.md:21, :113-117) is the generic path; the H1 READ in the probe needs it
  too (all EquipStatus reads are Drivers-only).
- Fix text: MK0 adds "TableRowService `GET /equipstatus/…/search?equipment_id=<driver>&equipment_type_id=D` as the
  integration user — readable or 403". Readable ⇒ H1 stays an outcome (writes via `PUT /equipstatus/create`
  TableRowService); 403 ⇒ H1 is read-impossible and only H2/H3 remain. RowDriverStatus keys on
  `equipment_id`+`equipment_type_id`, not a driver id (WS.md:86-89).

### OF-18 [IMPROVE] — H2 should not write `pta_date`
- McLeod uses `pta_date` (Date,19) as the driver's planned available time, which dispatch and McLeod's own planning
  update on load events; spec D H2 writes `pta_date = expected_return_at` and `= end_at`. After MK3's `clearStop`
  writes go live, McLeod's own logic and 360 would both write it.
- Fix text: H2 writes `next_home_date` and `home_duration` only; `pta_date` is written only if the 14-day probe shows
  it never changes on a stop clear (count changes that coincide with a stop's `actual_departure` within 5 min — must
  be 0). The probe's agreement thresholds (≥ 50 % filled, ≥ 80 % within ±1 day) stay.

### OF-19 [GAP] — permissions: the matrix entry for every new office act, in one table
| Act | Gate (derived, `auth.ts:136-160`) | Who today has it | Same as today's path? |
|---|---|---|---|
| Truck/trailer status "ask McLeod" | `requireSection('equipment','manage')` | admin, fleet_manager | Yes — RLS `vehicles_write`/`trailers_write` after 0277 |
| End employment of a linked driver | `requireSection('roster','manage')` | admin, fleet_manager, safety_manager | Yes — PATCH lifecycle `callerCanManage(…,'roster')` |
| Medical / CDL "Update McLeod" | `requireSection('safety','manage')` | admin, fleet_manager, safety_manager | New act |
| Hire → McLeod create / reactivate / Send now | `requireSection('recruitment','view')` + named `recruitment.close_application` | holders of the named permission | Yes — `hire.ts:42-43` |
| Hire again (reopen a former driver, OF-1) | same as the close | same | New act — **owner question Q-MK-R1** (may a recruiter reopen a terminated roster row? recommend yes: it is the first step of a hire, and the RPC moves only terminated/inactive → applicant) |
| Document category map | `requireSection('settings','manage')` + the surface it lives on | admin, fleet_manager | New |
| Send again (BOL/POD) | `requireSection('dispatch','manage')` | admin, fleet_manager, dispatcher | New |
| Send again (lumper receipt / RC) | `requireSurface('dispatch.lumper-cases')` (`mcleod/lumper/routes.ts:17`) | the lumper list's people incl. accountant | New (round-1 D-57) |
| Hand back to McLeod | `requireSection('roster','manage')` | admin, fleet_manager, safety_manager | Existing un-claim path (0241:69-74), now a button |
- Every route above enters `apps/api/src/routeGateLedger.test.ts` with its gate declared inline at the route (the
  ledger reads gates from source text, `routeGateLedger.test.ts:24-31`). Audit actions, one per act:
  `mcleod.tractor_update.requested`, `mcleod.trailer_update.requested`, `mcleod.driver_lifecycle.requested`,
  `mcleod.driver_medical.requested`, `mcleod.driver_cdl.requested`, `mcleod.driver_create.requested`,
  `mcleod.driver_reactivate.requested`, `driver.reopened_for_rehire`, `mcleod.image_map.set`,
  `mcleod.image_send.retry`, `driver.identity_returned`. Pipeline states are NOT also written to `audit_logs`
  (they are `mcleod_write_events`; round-1 D-68).

### OF-20 [IMPROVE] — UI words for a non-native reader (memory `finance-reader-is-a-non-native-speaker`)
Replace spec D's strings with short, literal ones (no idioms, no "since you looked", no "winding down"):
| Spec D text | v2 text |
|---|---|
| "Saved in McLeod; 360 shows it after McLeod confirms" | "Sent to McLeod. 360 changes when McLeod saves it (about 1 minute)." |
| "Asked McLeod: In the shop · waiting" | "Waiting for McLeod: In the shop" |
| "McLeod changed <field> from A to B since you looked" | "Someone changed this in McLeod (A → B). Check McLeod, then try again." |
| "Winding down / sold, awaiting pickup" | "Sold — waiting for pickup" |
| "Sent, waiting for McLeod to file it" | "Sent to McLeod. Not on the order yet." |
| "McLeod accepted the file but it is not on the order after 24 hours" | "McLeod took the file, but it is not on the order after 24 hours. Ask billing to check." |
| "Not sent to McLeod — Send now" | "Not sent to McLeod yet. [Send now]" |
| "McLeod marks <code> not eligible for rehire" | "McLeod says this driver cannot be hired again (<code>)." |
| "Office-owned — hand back to McLeod" | "Edited in 360, so McLeod no longer updates it. [Let McLeod update it again]" |
| "McLeod has it out of service; 360 keeps it until the truck stops reporting" (D-40) | "Out of service in McLeod. 360 keeps it active while the truck still sends GPS." |
Each string lives once in `MCLEOD_WRITE_REASONS` / the shared status table, never in a component.

### OF-21 [GAP] — file budgets the spec missed
- `apps/web/src/pages/VehiclesPage.vue` 447 and `TrailersPage.vue` 441 lines — already in the 450 warn band
  (`scripts/check-file-size.mjs`, `.vue` is scanned, :122). The McLeod status action and pending chip go in a new
  component `apps/web/src/features/roster/UnitStatusMcleod.vue`, not into the pages.
- Re-verified: `packages/shared/src/tms.ts` 499, `rosterContract.ts` 452, `roster/homeTime/homeTime.ts` 456 — no
  additions (AUDIT §2.6 holds). New shared files: `mcleodUnitStatus.ts`, `driverIdentityFields.ts` (OF-2),
  `mcleodImagesContract.ts`.

### OF-22 [GAP] — termination: McLeod may refuse `is_active='N'` while the driver is on a movement or a truck
- TableRowService runs McLeod's validation (WS.md:21); RowDriver carries `tractor_id` (WS.md:80). Unknown whether McLeod
  refuses deactivating a driver with a dispatched movement or an assigned tractor.
- Fix text: MK0 probe on the test company (deactivate a driver who holds a tractor; one on a dispatched movement).
  A refusal maps to a reason code with the words "McLeod will not end this driver while he has a truck or a load.
  Unassign him in McLeod first." The 360 termination stands (Q-MK6: the legal act is ours, written first).
- Drivers use `is_active` `Y`/`N` (`queries.mjs:138, :231`), trailers `A`/`I`: `toRowDriver`/`toRowTrailer` hold the
  letters, and `writes/rowMap.test.mjs` pins each.

### OF-23 [OK] — statements re-verified true
- Claim defect real (0241:124-129, :82-93). `handApplicationToTms` is applicant-only (`driverTmsHandover.ts:24-29`).
  `uq_drivers_org_mcleod` partial unique (0239:62-63). `isStatusFromTms` call sites (`VehicleForm.vue:63`,
  `TrailerForm.vue:26`, `VehiclesPage.vue:394`, `TrailersPage.vue:219`). Browser writes with no audit
  (`useVehicles.ts:81,94`; `useTrailers.ts:70,82`). Home-time gate `roster.home_time` (`rolePermissions.ts:79`,
  `homeTime/routes.ts:58-59`). Section matrix (`auth.ts:136-160`).
- Out of scope, labelled: unlinked trucks/trailers keep today's unaudited PostgREST status and retire writes
  (`useVehicles.ts:94`, `useTrailers.ts:82`). v2 should say so in one line, not leave it implied.

---

## Today vs planned, per flow (rulings O-2, O-6, O-7, O-8 applied)

| Flow | TODAY (file:line) | PLANNED (v2 + this review) | Better? |
|---|---|---|---|
| Truck status, linked unit | Read-only in 360 (`isStatusFromTms`, `tms.ts:382-384`; `VehicleForm.vue:63`; Retire hidden `VehiclesPage.vue:394`); change only in McLeod by hand | "Ask McLeod" from 360 (`equipment:manage`), audited request; RowTractor key measured at MK0 (OF-5); 360 column still written only by the sweep | Yes, once the key is measured |
| Truck status, unlinked unit | Browser → PostgREST, no audit (`useVehicles.ts:81,94`) | Unchanged (out of scope — say so, OF-23) | Same |
| Trailer status, linked | Read-only (`TrailerForm.vue:26`); bulk Retire skips linked (`TrailersPage.vue:221-229`) | `is_active` `I`/`A` + `outservice_date`; never `statuscode`/`disposition_code` unless McLeod refuses (OF-6) | Yes |
| Medical-card expiry | Disagreement shown (`MedicalTab.vue`, `resolveMedicalExpiry` `credentialSources.ts:51`); fixed in McLeod by hand | One button "Update McLeod to MM/DD/YYYY" (`safety:manage`), server recomputes, never automatic | Yes |
| CDL expiry | McLeod's `license_date` is the roster value (D-MR6); office edit reverts | Same button shape; `license_date` exists on RowDriver (WS.md:82) | Yes |
| New hire (O-7) | Close in 360 → active `manual` row; McLeod entry by hand; sweep links by licence but never refreshes (`rosterIngest.ts:33-38`) | Create switch `off` until the owner's sentence; meanwhile the sweep hands a matched 360-hired row to McLeod (OF-3); after: create with identity fields once (OF-4), SSN stripped | Yes with OF-3; without it, same as today |
| Termination | PATCH (`drivers.ts:164+`), 360 only; McLeod by hand | 360 first (unchanged), then lifecycle request with McLeod reason CODE + can-rehire (OF-7); refusal mapped (OF-22) | Yes |
| Returning driver (O-6) | No path: link only to applicants (`applicationLink.ts:88`), hire only applicants (`hireApplicant.ts:210`), no reopen | "Hire again" reopens the former row (clears termination/archive, keeps McLeod id), second invitation, reactivation to the SAME McLeod id; duplicate licence caught before signing (OF-1) | Yes — new capability |
| Claim defect | Phone edit claims a McLeod row for good (0241:124-129; `rosterContract.ts:409-411`; `driverEditMeaning.ts:42-48`) | `phone@samsara` in trigger + shared list + both TS readers, one PR (OF-2) | Yes |
| BOL / POD into McLeod | McLeod capture app only; 360 photos never sent (BOL plan :63-64, :109-111) | One PDF per (stop, kind) on order `O`, deterministic, sha + (stop, kind) unique; seen-rule (OF-8); live only after scanner-on-stops or a readable-rate canary (OF-11) | Yes, if OF-11's gate holds; else a quality regression |
| Lumper receipt / revised RC | Office uploads RC to the case (`lumperCases.ts:239`, kind `revised_rc`); dispatcher files RC in McLeod by hand | Upload also files into McLeod RC category after the D-LRC16 already-present check; echo suppressed (OF-9) | Yes with OF-9 |
| ETA (O-8) | Board ETA is 360's; McLeod `stop.eta` hand-typed (D-DB4) | Nothing written until DB7 passes on the post-B7 window (OF-16); then call-in `new_eta`, `automated=true`, after the side-effect probe (OF-15); fallback RowStop `eta` | Yes if gated; worse if not |
| Home time | `driver_time_off` in 360 only (D-HT5) | Probe first; H2 writes `next_home_date`/`home_duration` (not `pta_date`, OF-18); H1 via TableRowService `equipstatus` if readable (OF-17) | Yes, measured |
| Finance | Copy restored 10-09, read by hand under NikiAnalytics; nightly feed off (`connector.example.env:39-42`) | Follow-up to the 11-13 email (+`drs_check`, `gl_summary`); compare with two logins (OF-13); switch; `--allow-copy` guard | Yes |

## Missing tests (exact files)
- `supabase/tests/reopen-former-driver.test.mjs` (new matrix, RESULT line) — OF-1.
- `apps/api/src/modules/roster/driverReopen.test.ts`, `apps/api/src/modules/recruiting/hireApplicant.test.ts`
  (+`former_driver_exists`), `apps/api/src/modules/mcleod/writes/driverReactivate.test.ts` — OF-1.
- `packages/shared/src/driverEditMeaning.test.ts` (+phone on McLeod row), `rosterFields.claimParity.test.ts`
  (`col@source` rendering) — OF-2.
- `apps/api/src/modules/mcleod/rosterApplicantHire.test.ts` (+360-hired manual row handed over) — OF-3.
- `apps/api/src/modules/mcleod/writes/endEmployment.test.ts` (code not in list ⇒ 422) — OF-7.
- `tools/mcleod-agent/images.test.mjs` (+seen-by-id, ambiguous, one-in-flight) — OF-8.
- `tools/mcleod-agent/lumper.test.mjs` (+no echo import) — OF-9.
- `apps/api/src/modules/mcleod/images/assemble.test.ts` (same sha twice); `supabase/tests/mcleod-images.test.mjs`
  (+(stop, kind) unique) — OF-10.
- `tools/mcleod-agent/financeCompare.test.mjs` (+two configs) — OF-13.
- `tools/mcleod-agent/writes/rowMap.test.mjs` (driver Y/N vs trailer A/I letters) — OF-22.

## Summary
23 findings: BLOCKER 1 (OF-1) · WRONG 4 (OF-2, OF-4, OF-5, OF-17) · GAP 12 (OF-3, 6, 7, 8, 9, 12, 13, 15, 16, 19, 21, 22) · REGRESSION 1 (OF-11) · IMPROVE 2 (OF-18, OF-20) · OK 3 (OF-10, OF-14, OF-23).

Top 10: OF-1 (O-6 has no path; merge is refused by MD010) · OF-4 (O-2 vs O-7: a create needs a name and licence) ·
OF-2 (third consumer `wouldClaimFromTelematics`) · OF-11 (photo quality vs McLeod capture) · OF-8 (seen-rule; Image has
no uploader) · OF-9 (RC echo loop) · OF-16 (O-8 must keep the DB7 gate, window after B7) · OF-15 (call-in side effects,
`automated=true`) · OF-3 (with create off, sweep hands 360 hires to McLeod) · OF-5/OF-6 (tractor key unsettled —
W2 read another carrier; trailer `is_active` I/A only).

Better than today? Yes for every flow, on three conditions: OF-1 is built (otherwise O-6 cannot be honoured and a
returning driver hits `uq_drivers_org_mcleod` or a second McLeod create), OF-11's gate holds for BOL/POD (otherwise
billing may get worse images than McLeod capture gives today), and OF-16 keeps the ETA write behind DB7 (otherwise
McLeod's ETA can become worse than a dispatcher's typed value).
