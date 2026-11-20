# Red-team of the round-1 audit (AUDIT-2026-11-20-API-KIT-SPECS.md + api-kit-audit/{A,B,C,D,WS,X}.md)

Repo `/Users/miroslavjokovic/Projects/FG-mcleod-api` HEAD `4876449c7` (audit ran at `22f3f0540`; the cited
api/agent files are unchanged between the two). McLeod pages re-fetched 2026-11-20 from
`https://tms-map.mcleodhosted.com/ws/docs/…&role=-1` with curl; installed libraries read from
`/Users/miroslavjokovic/Projects/FuelGuard/node_modules` (same pinned versions: supabase-js/postgrest-js 2.110.0,
pdf-lib 1.17.1).

## 1. Verification table (44 claims)

| # | Claim (report) | Source opened | Verdict | Evidence |
|---|---|---|---|---|
| 1 | Connector reads one company (AUDIT §2.3, X §2) | `tools/mcleod-agent/connector.example.env:19-20` | CONFIRMED | `:19` "TMS is the trucking company; TMS2/TMS3 are never read", `:20` `MCLEOD_COMPANY_ID=TMS`; `agent.mjs:175` single `companyId` |
| 2 | Alex forbade email in `name_of_spouse` (AUDIT §2.6, D-23) | `docs/plans/mcleod/mail.md:89` | CONFIRMED | "The name_of_spouse email convention stays on your side. Do not write it back to McLeod." |
| 3 | `loads -> mcleod` is an allowed edge (AUDIT §2.1, X §1.3) | `scripts/check-feature-boundaries.mjs:399` | CONFIRMED, but MISAPPLIED (RT-4) | `:399` exists; its comment `:397-398` scopes it to `readFleetDispatchers` "never directly"; `:132` `mcleod -> loads` also exists |
| 4 | `/api/tms` limiter 300 / 15 min (C-9) | `apps/api/src/app.ts:340-346` | CONFIRMED | `rateLimit({ windowMs: 15*60_000, limit: 300 })` then `app.use("/api/tms", ingestLimiter)`; keyed by default IP |
| 5 | Router-wide 8 MB parser (C-8) | `routes/tmsIngest.ts:119` | CONFIRMED (line is `:120`; `:119` is its comment) | `router.use(json({ limit: "8mb" }))` |
| 6 | Office routes mount under `/api/integrations` (C-7) | `routes/integrations.ts:21`, `app.ts:261` | CONFIRMED | `app.use("/api/integrations", integrationsRouter())`; `:21 registerMcleodIntegrationRoutes(router)` |
| 7 | MW010/MW011 taken by 0551 (A-38) | `0551_recruiting_message_wording.sql:91,93` | CONFIRMED | `errcode = 'MW011'` :91, `'MW010'` :93 |
| 8 | `handApplicationToTms` updates applicants only (D-30) | `modules/roster/driverTmsHandover.ts:18-30` | CONFIRMED | `.eq("status","applicant")`, `return !error` → silent no-op on an `active` row |
| 9 | `uq_drivers_org_mcleod` blocks re-linking the old McLeod id to a new row (D-32) | `0239_mcleod_roster_links.sql:62-63` | CONFIRMED | partial unique `(org_id, mcleod_driver_id) where … is not null` |
| 10 | 0412 closes new functions by default (A-10, AUDIT §2.4) | `0412_new_functions_closed_to_clients_by_default.sql` header | OVERSTATED as a reason to re-grant (RT-15) | 0412 revokes PUBLIC/anon/authenticated only; "does NOT revoke service_role"; 0141 grants are service_role-only, so a recreated driver RPC is already callable by the API |
| 11 | `create or replace` with a new parameter makes a 2nd overload → PGRST203 (A-10) | `0141:264-276` | CONFIRMED | 0141 itself drops both older signatures before `create function`; two candidates matching the same named args is PostgREST's PGRST203 |
| 12 | `load-lifecycle.test.mjs:151` turns red (A-12) | `supabase/tests/load-lifecycle.test.mjs:150-152` | CONFIRMED | `makeLoad("LD-A2")` (draft) → expects `DL001` |
| 13 | `loadOnTruck.test.ts:100` turns red (A-18) | `packages/shared/src/loadOnTruck.test.ts:100-104` | CONFIRMED | asserts `nextStop(load).id === "s1"` while `isStopBehindTruck(s1)` is true |
| 14 | `stopPhotoInputSchema` is non-strict, strips `sha256` (D-58) | `packages/shared/src/loadsContract.ts:129-135`; `me.ts:386` | CONFIRMED | plain `z.object({id,slot,storage_path,captured_at})`; `validateBody(completeStopRequestSchema)` |
| 15 | `FUEL_PURCHASES` has 28 columns (D-44) | `tools/mcleod-agent/queries.mjs:450-479` | CONFIRMED | counted 28 aliases external_id … post_module; second UNION arm `NULL, NULL` |
| 16 | `org_integrations.config jsonb` exists (D-45) | `0068_tms_integration.sql:15` | CONFIRMED | `config jsonb not null default '{}'` |
| 17 | pdf-lib stamps metadata unless `updateMetadata:false` (D-53) | `node_modules/pdf-lib/cjs/api/PDFDocument.js:59,144` | CONFIRMED | `updateMetadata` defaults `true` → `updateInfoDict()`; RNG is `SimpleRNG.withSeed(1)` (`core/PDFContext.js:32`) so suffixes are deterministic — dates are the only nondeterminism, as D-53 says |
| 18 | `node:crypto` cannot create an X.509 cert (C-6) | Node 22/24 API | CONFIRMED | only `generateKeyPair*` + `X509Certificate` (parse). But the fix chosen is not the best one (RT-9) |
| 19 | supabase-js array upsert sends the UNION of keys, missing = NULL (B-7) | `node_modules/@supabase/postgrest-js/dist/index.mjs:3159-3171` (v2.110.0) | CONFIRMED | `columns = values.reduce(concat Object.keys)`, `columns=` set to the de-duplicated union; `defaultToNull = true` unless `missing=default` |
| 20 | Agent already reads `MCLEOD_WS_URL/TOKEN/USERNAME/PASSWORD`, `MCLEOD_COMPANY` (C-1, AUDIT §2.7) | `tools/mcleod-agent/agent.mjs:180-197` | CONFIRMED | `mcleod: { baseUrl …MCLEOD_WS_URL, company …MCLEOD_COMPANY, token, username, password, pageSize ≤1000 … }` |
| 21 | VM runs every `*.test.mjs` before restart, installs nothing (C-5/C-6) | `windows/update-connector.ps1:8-10, 166-181` | CONFIRMED | "node_modules stays"; `Get-ChildItem -Filter "*.test.mjs"` → `node --test`, throws on any fail |
| 22 | `RETENTION_FORBIDDEN` vs 1,095-day file retention conflict (D-52) | `D.md:246-249` → `dataRetentionPolicy.ts:225-243` (as quoted) | CONFIRMED (logic) | retention deletes the ROW; an append-only forbidden row can never be deleted, so a file rule cannot fire. AUDIT §2.6 dropped D-52's orphan-sweep half (RT-17) |
| 23 | EquipStatusService is Drivers-only (WS, AUDIT W9) | `services?service=EquipStatusService&role=-1` | CONFIRMED | all five ops list role "Drivers" |
| 24 | …"That leaves RowDriver `next_home_date`/`pta_date`" (AUDIT W9) | WS.md:175-176, 319 | AUDIT WRONG (RT-11) | WS.md's own alternative — TableRowService `PUT /equipstatus/create` as Users — was dropped from the summary |
| 25 | `GET /metadata` needs no login (W3) | `services?service=MetadataService&role=-1` | CONFIRMED | roles include "Not Logged In"; content "current user information, enabled companies … licensing" — what an anonymous call returns is not documented |
| 26 | Image `rowType` letters O/M/C/L/P/D/T/E/U, raw body, no filename, String result ambiguous (W5) | `services?service=ImagingService&operation=addImage&role=-1` | CONFIRMED | verbatim; also "Some providers may simply stage the uploaded image and later pick it up with a batch process" |
| 27 | Date `yyyyMMddHHmmssZ` when `useServerTimezone=false` (W6) | `types?type=com.tms.common.lib.Date&role=-1` | CONFIRMED | verbatim — the pattern has SECONDS (RT-6) |
| 28 | Omitted fields not nulled; `"NULL"` to null (W7) | `types?type=null&role=-1` | CONFIRMED | verbatim |
| 29 | audit_log_tx "keeps one day only" (W8) | `…AuditTransactionService&operation=getAuditLogTransactionsByAdvancedSearch` | OVERSTATED (RT-12) | "only retains one day of transactions **based upon purge settings in the McLeod application**" — tms-map's setting, not ours |
| 30 | 75 services; RemoteNotification/SysAdmin 500 (W11) | `?role=-1`; both service URLs | CONFIRMED | 75 unique `services?service=` links; both pages HTTP 500 today. WS.md:16 still says "78" before its own correction at :29 |
| 31 | Settlement/Deduction/Billing have writes (W1) | WS.md:206-211 | CONFIRMED (not re-fetched) | — |
| 32 | RowTrailer has no `status`/`service_status` (W2) | `types?type=…RowTrailer&role=-1` | CONFIRMED | sample row has `is_active`, `statuscode`, `disposition_code`, in/outservice_date |
| 33 | RowStop has `eta`, `actual_arrival`, `prior_uncleared_stops`; RowCallin `new_eta`, `current_stop_id`; RowDriver `license_date`, `next_home_date`, `pta_date`, `social_security_no` | type pages | CONFIRMED | grep of the fetched pages |
| 34 | clearStop `isReportable` default true; service failure "if necessary" (A-36) | `…DispatchService&operation=clearStop&role=-1` | CONFIRMED | "isReportable indicates if service failure, if one existed, is reportable to customer — true" (RT-7) |
| 35 | CallinService `PUT /callins/create` Users | `services?service=CallinService&role=-1` | CONFIRMED | Users, Carriers, Carrier Drivers |
| 36 | DriverService has no update op | `services?service=DriverService&role=-1` | CONFIRMED | only `PUT /drivers/create` writes (+ `confirmNotDriving`) |
| 37 | `mirrorLoads.test.ts` does not exist; stop tests in `tmsIngest.dispatchProjection.test.ts` (A-24) | disk | CONFIRMED | `:172-176` asserts the `.delete()` with `status = pending` |
| 38 | `getDriverLoads` stop/photo reads not org-filtered (A-30) | `modules/loads/driverLoads.ts:142-148` | CONFIRMED | `.in("load_id", loadIds)` only |
| 39 | `claimNext` takes oldest due record (A-21) | `apps/driver/src/data/outbox.ts:94-110` | CONFIRMED — and AUDIT §2.2 misstates it (RT-5) | `order by created_at asc` over `next_attempt_at <= now` |
| 40 | `tms.ts` 499, `rosterContract.ts` 452, `homeTime.ts` 456 (D-63) | `wc -l` | CONFIRMED | the 456 file is `apps/api/src/modules/roster/homeTime/homeTime.ts` (shared `homeTime.ts` is 215) — name the path |
| 41 | No tooltip component exists (B-13) | `packages/ui/src/components`, `apps/web/src` | CONFIRMED | no component; Status cell uses `:title` |
| 42 | Repo is PUBLIC (C-24) | `gh repo view` | CONFIRMED | `miroslav-jokovic/fuel-guard`, PUBLIC |
| 43 | "route-gate ledger" entry for office routes (AUDIT §2.6, D-64) | `apps/api/src/testing/routeLedger.ts:1-25` | AUDIT WRONG (RT-16) | ledger is SHRINK-ONLY and holds deliberately OPEN routes; a gated route gets no entry, and an unused entry fails the fitness test |
| 44 | "The VM's existing lines are the third lock" (AUDIT §2.1) | `tools/mcleod-agent/*` | AUDIT WRONG (RT-2) | `grep MCLEOD_API_WRITES\|MCLEOD_WS_WRITE` → nothing; connector.example.env has only `FINANCE_FEED`, `LUMPER_FEED` |
| 45 | "next free number is 0637" (AUDIT §3) | `git ls-tree origin/main supabase/migrations` | STALE | `0637_ads_outcome_stage_lead.sql` landed on main since; harmless only because numbers are taken at merge |
| 46 | 0453 predictions are "a `(load_id, seq)` reader that gets a tie-break" (AUDIT §2.4) | `0453_load_stop_eta_predictions.sql:15,45,63` | OVERSTATED (RT-14) | `stop_seq` is part of the KEY/index, not an ORDER BY — a tie-break cannot fix a key |

Tally: CONFIRMED 34 (incl. 2 confirmed-but-misapplied) · AUDIT WRONG 4 · OVERSTATED 5 · STALE 1 · other notes 2.
The six reports' file:line citations are overwhelmingly right. The errors are concentrated in the
**summary** (AUDIT §1–§2), where several report findings were compressed and lost the half that mattered.

## 2. Findings

### RT-1 [AUDIT-WRONG] — The adopted switch schema lets `test` mode on a production company write without proof
- AUDIT §2.1 adopts C.md's reconciled schema: `mode in ('off','test','canary','live')`; only `live` requires
  `proven_by_request`; `mcleod_write_allowed`: "`test`/`live`→true" (C.md:340). C-14's original fix said a test row
  must name a company flagged as a test company (`is_test_company` / `mcleod_test_companies`); the reconciled
  schema (C.md:316-330) dropped that flag. Nothing stops an admin inserting `(org, stop_clear, 'TMS', 'test')`:
  every live TMS write is then allowed, with no proof, no canary, and no owner — the exact bypass D-MK3 exists to forbid.
- Also: proof is "a confirmed request of the same operation+company issued under a test or canary row" (C.md:337).
  For company TMS a `test` row cannot exist legitimately, so the only legitimate path to `live` is `canary` on TMS —
  §2.1's "needs a confirmed `test`- **or** `canary`-proven request" reads as if a test-company pass unlocks TMS. It cannot.
- Fix text for v2: "A `test` row is legal only for a company in the org's test-company list; the list is a column of
  the org's `mcleod` integration (`org_integrations.config.test_companies`), set from `GET /metadata`'s enabled
  companies by an owner act, never an env var. `live` on company X needs a confirmed `canary` request on X **and** a
  confirmed `test` request of the same operation on any test company. The trigger `mcleod_write_same_org` enforces both."
  Matrix titles: "a test row on a non-test company is refused"; "live without a canary on the same company is refused".

### RT-2 [AUDIT-WRONG] — "The VM's existing lines are the third lock" — they do not exist, and one of them restates the company list §2.1 says it removed
- `grep -rn "MCLEOD_API_WRITES|MCLEOD_WS_WRITE" tools/` → nothing. They are C's proposals (C.md L122, L704).
- C's VM lock `MCLEOD_WS_WRITE_COMPANIES` is a company list — the very restatement A-35/X-6 objected to ("three
  restatements of which company may be written", C-44). §2.1 drops A's env list and D's table but silently keeps the VM list.
- Fix: v2 says "a new VM line `MCLEOD_API_WRITES=on|off` (Alex's on-prem kill switch, boolean only). Which companies
  may be written is answered by the switch table alone; the agent refuses a claimed request whose company is not
  in the claim response's allowed set." If Alex wants his own company allowlist, it is a labelled second lock owned by
  Alex, with a startup check that it is a SUBSET of the switch table's non-off companies (refuse to start otherwise).

### RT-3 [AUDIT-WRONG] — O-2 as ruled makes the new-hire create (O-7) and the rehire (O-6) unbuildable
- O-2 ruled: "360 writes … only medical-card expiry, CDL expiry, new hire and termination/rehire. Names, DOB, address,
  email and CDL number are not written."
- A `PUT /drivers/create` with no name and no licence number creates a nameless McLeod driver; D-RL5's sweep and
  `rosterMatch` link by licence (+ name) (D-31; `rosterApplicantHire.ts` header), so the created row could never be
  matched back. RowDriver `name`(28)/`first_name`/`license_no`(16) are the identity fields of the create.
- The §4 question conflated "fields 360 may EDIT on an existing McLeod driver" (Q-MK13's scope) with "fields a
  create carries once". The owner ruled the literal text.
- Fix: v2 records O-2 as "(a) updates to an existing McLeod driver: only medical-card expiry, CDL expiry, and the
  termination/rehire fields (`is_active`, `termination_date`, `hire_date`, `reason_for_leaving`, `can_rehire`);
  (b) the create carries the identity a hire needs (`name`, `first_name`, `last_name`, `license_no`,
  `license_state`, `birth_date`?, `hire_date`) once, never again". (b) is a NEW question for the owner (O-2a) —
  do not infer it from "go ahead". Until ruled, the create is off anyway (O-7), so nothing is blocked today.

### RT-4 [OVERSTATED] — `check-feature-boundaries.mjs:399` does not settle where the stop request is enqueued
- AUDIT §2.1 / X §1.3: "`loads → mcleod` is already an allowed boundary edge, so the import-cycle argument in C and D does not apply."
- The edge is about TypeScript imports; A's design is a SQL insert inside `driver_complete_stop` — no import at all.
  What the SQL design actually crosses is table ownership (`mcleod_write_requests` is mcleod-owned, the writer is a
  loads-owned function), which `check-table-modules` / `lint:table-producers` see, not the boundary gate.
- Both `mcleod -> loads` (:132) and `loads -> mcleod` (:399) already exist, so the module graph already has a
  cycle — the edges are kept safe by naming ONE function each (D-65). Citing `:399` as general permission
  contradicts its own comment ("through `readFleetDispatchers`, never directly").
- Fix: v2 states the real argument: "the enqueue is SQL inside `driver_complete_stop`; the cross-module table write
  is declared in `table-modules.json` producers + a `cross-module-waiver` comment in the migration header; any TS read
  of write state from `loads` goes through ONE named mcleod export and `:397-398`'s comment is extended to name it".
  The conclusion (A's in-transaction enqueue) stands; the citation does not.

### RT-5 [AUDIT-WRONG] — §2.2 says `claimNext` "keeps first-in-first-out order per stop". It does not; that is the change to make
- `apps/driver/src/data/outbox.ts:94-110`: `where status in ('pending','failed') and next_attempt_at <= ? order by created_at asc limit 1`
  — a due Complete overtakes an Arrive in backoff, exactly A-21's finding.
- Fix: "`claimNext` is CHANGED to skip a `load_stop` record while an older non-`done`, non-`dead` record with the
  same `payload.stop_id` exists (test: 'a Complete never syncs before an older Arrive of the same stop')". And since
  this ships by OTA, old builds keep the overtaking behaviour: the server side must also tolerate it — an `arrived`
  on a completed stop with null `arrived_at` records the arrival (A-21 option b) and, if the McLeod request has not been
  leased yet, the request's `payload.arrival_at` is filled by a superseding request, never by editing it.

### RT-6 [AUDIT-WRONG] — "the minute precision of the `/ws` Date format" — the format has seconds
- Date page: pattern `yyyyMMddHHmmss[Z]`, `ss` = "Second in minute". Precision of what McLeod STORES and returns is not
  documented (A-37 item 5 said exactly that: "read-back precision → the ± tolerance" is an MK0 probe).
- Fix: "Exact-match compares at the precision MK0 measures (write a time with seconds ≠ 0 on the test company, read it
  back); until measured the rule is: truncate both sides to the minute AND record the raw read-back in `observed`".

### RT-7 [MISSED] — O-4 (`isReportable=false`, no delay code) still CREATES a service-failure record and changes "as today"
- clearStop: "creates a service failure record if necessary"; `isReportable` = "if service failure, if one existed, is
  reportable to customer". `false` hides it from the customer; it does not stop McLeod creating it. Today a dispatcher
  clearing a late stop in LoadMaster is prompted for the delay code; after MK3 the record exists, un-coded, created by
  the integration user, possibly with `faultOfCarrierOrDriver=false` default. "Dispatchers record lateness as today"
  becomes "dispatchers find and code a record the integration made".
- Also unknown: whether our install refuses clearStop on a late stop without `delayCode` (a site setting) — then every
  late stop is a `refused`.
- Fix: MK0 probe P-SF on the test company: clear a stop past its appointment with `isReportable=false`, then
  `GET /serviceFailures?stop_id=…` (ServiceFailureService exists, WS.md:230-232). v2 builds both outcomes: (a) record
  created → the agent reads it back and the office exception reads "late — code it in McLeod"; (b) refused → `refused
  needs_delay_code`. Add the question "is an un-coded, non-reportable service failure acceptable?" to the ONE Alex message.

### RT-8 [MISSED] — O-8's call-in ETA may notify customers (EDI 214 / check-call alerts) and floods call-in history
- A call-in is McLeod's check call; carriers commonly drive customer EDI 214 status messages and tracking e-mails from
  call-ins. D's ETA cadence (`MCLEOD_ETA_WRITE_MINUTES`, X §1.5) on ~100 open movements is ~2,400 call-ins/day in the
  dispatch history if hourly. Neither the audit nor O-8 mentions it.
- Fix: O-8's MK0 probe also answers "does a `callins/create` with `new_eta` send anything outward (EDI/e-mail)?" — a
  question for Alex, not the docs. v2 rule: ETA writes only on CHANGE beyond a threshold (e.g. ≥ 30 min shift), never on
  a timer; the stop `eta` (TableRowService) branch is preferred if call-ins fan out.

### RT-9 [BETTER-SOLUTION] — "commit a test-only certificate" contradicts the repo's own secret-scanning rule
- `.gitleaks.toml` (paths allowlist): the seven committed mTLS test keys are "TEMPORARY … committing private keys defeats
  secret-scanning signal … should be generated into a temp directory at test setup instead". CI runs gitleaks; a new
  `fake-mcleod-key.pem` fails `gates` unless a new allowlist entry is added — "a decision to stop looking".
- Better: the pin logic is a pure function over the peer certificate. Commit only a PUBLIC test certificate (not a
  secret) and unit-test the pin with `new X509Certificate(pem)` → that runs on the VM with Node built-ins. The full TLS
  handshake test generates key+cert with `openssl` at setup in CI (ubuntu has it) and is a `*.ci.test.mjs` that the VM
  manifest excludes, stated in the manifest comment (so the VM is not "hollowed": it runs the pin unit test).

### RT-10 [MISSED] — The test-company read lane breaks "one program, one connection" and the release train decides the proving cadence
- AUDIT §2.3: "movements of the test company … mirrored to a staging org only". Two readings, both unaddressed:
  (a) the STAGING environment → a second egress host (Alex approved only the production API host, `mail.md:40`), a
  second token/agent instance, and staging serves merges before production — but the VM's single agent cannot post
  to two hosts without code; (b) a "staging" org inside PRODUCTION → a second ingest token, and the agent must post a
  second company to a second org — the agent today has one `companyId` and one `FUELGUARD_INGEST_TOKEN`.
  Either way, a second agent process would break Alex's "one program, one connection" (`mail.md:38`).
- Release-train consequence nobody wrote down: the VM talks only to PRODUCTION, so every claim/settle/prove code change
  is testable against McLeod only after a nightly release with owner approval (01:07 CT, Sun–Thu). MK0 probes and the
  P-run iterate one release per round-trip.
- Fix: v2 picks (b): one agent, one SQL connection, a second statement parameter set for the test company, posted with
  a second token to a production org flagged `is_test_org` (excluded from every report, census and billing count), and
  states it in the ONE Alex message. v2's rollout table lists, per MK step, "needs a release" and budgets the round-trips
  (or uses `release.yml` hotfix mode for agent-facing API changes, with the owner's standing OK recorded).

### RT-11 [AUDIT-WRONG] — W9 drops the documented alternative and substitutes a different fact
- WS.md:175-176, 319: "a driver-role login (or TableRowService `PUT /equipstatus/create` as Users) would be needed".
  AUDIT W9: "That leaves RowDriver `next_home_date` / `pta_date`". `next_home_date` is a planning date on the driver,
  not a home-time EVENT (`equipstatus` rows with `event_code`, `start_date`, `end_date`, which is what McLeod's
  home-time/time-off board reads). Writing the date instead of the event is a different product behaviour.
- Fix: W9 = "EquipStatusService is Drivers-role. Candidates: (a) TableRowService `PUT /equipstatus/create` as Users
  (generic row service; permissions enforced, WS.md:21); (b) RowDriver `next_home_date`/`pta_date`. MK0 probes (a) first;
  (b) only if (a) is refused, and then the office is told the McLeod time-off board will not show it".

### RT-12 [OVERSTATED] — §1 presents tms-map's site settings as facts about our install
- tms-map is another customer's install (SURFACE doc :5-8). Site-dependent items stated as fact: audit_log_tx "keeps
  one day only" (the page says "based upon purge settings"); `useServerTimezone=false` (W6 does say "MK0 reads ours");
  the role lists (Roles page: "the users web user type must be on endpoint" — LoadMaster web-user types, site config);
  `-Dloadmaster.api.maxresultsize`.
- Fix: §1 gets a column "site setting? (MK0 reads ours)" and W8/W9 are worded "on tms-map".

### RT-13 [MISSED] — The 1,000-row PostgREST cap and `.in()` length on the new readers
- `mcleod_api_capabilities` "one row per operation × field": RowDriver 159 + RowTractor 112 + RowTrailer 84 + RowStop
  (~100) + RowCallin 39 already exceeds 1,000 with a few more types — every supabase-js read of it is silently capped
  (memory: PostgREST caps every response at 1,000). Same for parity (≈160 movements × stops), the derived open-request
  set, and image candidates. `.in("id", ids)` over hundreds of ids overflows Node 22 headers (memory).
- Fix: v2 states for each new reader: paged with `.range()` until short page, or an RPC returning a single aggregated row;
  and capabilities are stored one row per operation with a `fields jsonb`, not per field. Also: org-scope the
  capabilities table (`org_id` — §2.1 does not say it is per org; McLeod installs differ per tenant).

### RT-14 [OVERSTATED] — 0453 needs a re-key, not a tie-break; D's ETA writer would send the wrong stop's ETA
- `load_stop_eta_predictions` is keyed `(org_id, load_id, stop_seq)` (`0453:45,63`). After S0c two stops can share a
  `seq`; a tie-break in ORDER BY cannot split one prediction row into two. D's ETA job reads `latestStopPredictions`
  (X §1.4) → `mcleod_stop_id`: with a shared seq it attaches one ETA to whichever stop sorts first.
- Fix: S0c adds `stop_id uuid` to predictions (column merge, then reader merge — `lint:migration-ordering`), and
  the ETA write reads by `stop_id`. Or S0c keeps `seq` unique by renumbering removed-but-worked stops (A-27's other
  option) — which makes every seq reader safe at once. Recommend the renumbering; it is one rule in one RPC.

### RT-15 [OVERSTATED] — "re-grant because 0412 closes new functions by default"
- 0412 header: "It does NOT revoke service_role … A new function is callable by postgres and service_role only".
  0141 grants are service_role-only (`0141:403-417`). So the recreated driver RPCs are already callable by the API.
  The explicit revoke/grant is hygiene (and keeps `definer-rpc-grants.test.mjs` happy), not a correctness fix. The
  one function that DOES need a new grant is the RLS helper `driver_visible_load_ids` (`to anon, authenticated`).
- Fix wording only; keep the explicit block.

### RT-16 [AUDIT-WRONG] — "entered in the route-gate ledger" would fail the ledger's own fitness test
- `apps/api/src/testing/routeLedger.ts:1-17`: the ledger records DELIBERATELY OPEN mounts/routes; "Every map below is
  SHRINK-ONLY. Each fitness function fails on an entry it did not use". Gated office routes
  (`requireAdminOnly`/`requireSection`) get no entry. D-64's point was a NEW `/api/mcleod` mount; C-7's resolution
  (house pattern, `/api/integrations/mcleod/…`) removes the need.
- Fix: "office routes register through `registerMcleodIntegrationRoutes` under `/api/integrations/mcleod/…`, each with an
  inline gate `routeGateLedger.test.ts` can see; no ledger entry". The agent routes stay under `/api/tms` (ledger :45 already covers the mount).

### RT-17 [MISSED] — Outbound evidence PDFs: orphan sweep and backup were dropped from D-52
- D-52's fix (a) had two halves: no retention rule AND register the bucket with `storageReconcile.ts` so orphaned uploads
  are swept. §2.6 kept only the first. Memory: storage files have no backup (10/26 deletion incident). A new bucket of
  evidence that is never deleted and never backed up is a single point of loss.
- Fix: v2 §2.6 adds "the `mcleod-outbound` bucket is registered with `storageReconcile.ts` (orphans only) and with the
  storage backup the document-storage plan defines; budget ≈ 210 stops/day × 1–3 MB, stated in `table-lifecycle`".

### RT-18 [MISSED] — O-5 is ruled but no §2 resolution implements it; §2.2 implements the opposite
- O-5: evidence for a load re-dispatched away is "stored and shown to the office as an exception. Never sent to McLeod."
- §2.4 keeps the visibility check (`assert_driver_load` via `driver_visible_load_ids`) → DL002 → 404 → `dead`
  (A-13). §2.2 enqueues on every Complete and lets the agent find "dispatched driver changed" → `conflict` — i.e. the
  request IS created and the agent DOES touch McLeod (a read) before refusing; the office sees a write conflict, not
  a late-evidence exception.
- Fix: v2: "stop actions on `tms` loads accept a driver who was EVER dispatched the load (`load_dispatches` names the
  driver) — A-13 (b); when the driver is not on the CURRENT dispatch, the event payload gets `after_reassignment=true`,
  `driver_complete_stop` enqueues NO McLeod request, and the exceptions feed lists it (kind `late_evidence`)".

### RT-19 [MISSED] — O-7 "does not block anything else" is false for the manual fallback and for rehire
- With the create switched off, the hire falls back to "hire in McLeod by hand as today". D-59/D-31: after a 360 close the
  row is `active` + `manual`; `rosterApplicantHire` handles applicants only; `rosterMatch` links by licence but leaves
  identity `manual`, so McLeod never refreshes the driver. §2.6's `linkHiredDriverToTms` is called by the create's
  result route — which never runs while the switch is off. So with O-7 pending, every 360-closed hire that Alex's team
  then creates by hand is linked-but-frozen.
- And O-6's rehire (TableRowService update of the old McLeod driver) is a hire done from 360 too — D-RL5's sentence
  covers it. If only `driver_create` is off, `driver_reactivate` (a different operation row) can go live first.
- Fix: v2: (1) `linkHiredDriverToTms` is ALSO called by the roster sweep when `rosterMatch` links an active `manual`
  row that was closed in 360 (hire event exists) — that is what makes the switch-off fallback work; (2) O-7's switch covers
  every operation that creates or reactivates a McLeod driver (`driver_create`, `driver_reactivate`).

### RT-20 [AUDIT-WRONG] — The adopted schema's `origin` list cannot carry D's writes, and image "Send again" has no link to its send row
- C.md reconciled schema (adopted by §2.1): `origin in ('driver_app','office_retry','prove')`, check
  `(origin='office_retry') = (supersedes is not null)`; NO `source_ref`. D's writes come from an office act (hire,
  termination, equipment status, "Update McLeod"), a sweep (image sends of completed stops) or a job (ETA). None fits.
- D-54's fix links a retry to the send through `source_ref = 'image_send:<id>'`; §2.6 says "Send again = a new request
  with `supersedes`" — a request with no column naming its `mcleod_image_sends` row. And `requested_by uuid not null
  references auth.users(id)` remains in the adopted DDL (C.md:284) although §2.1 says it is not an FK; `changed_by` on
  switches has the same FK (deletion of an office login blocked, append-only refuses SET NULL).
- Fix: `origin in ('driver_app','office','sweep','job','office_retry','prove')`; `supersedes` allowed for any
  `office*` origin; a nullable `subject_ref text` (e.g. `image_send:<uuid>`, `driver:<uuid>`) with a check per
  operation; `requested_by`/`changed_by` plain uuids without FK (A-33's reason). One DDL in v2, not a prose override of
  an adopted DDL.

### RT-21 [BETTER-SOLUTION] — Lease events as append-only, retention-forbidden evidence is the costly choice
- §2.1: "A lease is an event"; all three tables in `RETENTION_FORBIDDEN` (C.md:349). Every claim and every expiry is a
  row kept forever; with retries and 15-s claims under backlog, `leased`/`lease_expired` dominate the table. Memory:
  the database is micro and swapping; growth is three tables.
- Better: keep the INTENT and the McLeod FACTS (`applied_unverified`, `confirmed`, `refused`, `conflict`, `transient`
  with McLeod status) append-only and forbidden; make the lease itself not evidence — either a separate small mutable
  `mcleod_write_leases(request_id pk, lease_id, expires_at)` row (the `print_jobs` shape, 0526) or derived from the
  advisory lock + `not_before`. Retention may then trim lease rows; budget the evidence tables from A's measured base.

### RT-22 [MISSED] — Time zones/DST on the write path
- If our install has `useServerTimezone=true` (W6 says MK0 reads it), the date has NO zone: the agent must render
  Central wall time, and the DST fall-back hour (01:00–01:59 CT, first Sunday of November) is ambiguous — a stop cleared
  at 01:30 CDT vs 01:30 CST writes the same string. With `false`, `-0500`/`-0600` are explicit, but a `+0000` offset in a
  QUERY parameter (clearStop's dates are query params) must be percent-encoded or it arrives as a space.
- Fix: v2's `fmtMcleodDate` (in `centralTime.mjs`, the one owner of Central) always renders the carrier's offset form
  when `Z` is available, percent-encodes, and the test list includes "the repeated 01:30 on the fall-back Sunday" and
  "an offset with +". For the zone-less form, the ambiguous hour is resolved to the earlier instant and recorded in `observed`.

### RT-23 [MISSED] — Rollback per step is not stated in the summary
- §2 names no rollback for: (a) `driver_complete_stop` v3 (drop+create — rollback = a migration recreating the old
  signature; old code calls by named args, fine either way); (b) a `live` write switch (insert `off` row — ≤ one claim
  cycle, C-23's guarantee, should be stated); (c) a McLeod write already applied (no undo exists — the only rollback is a
  human in McLeod; v2 must say so per operation, and pick operations whose wrong value is cheap to undo first);
  (d) VM update (update-connector.ps1 to the previous commit); (e) S0b's legacy ingest deletion (410 is one-way for old agents).
- Fix: one "rollback" column per step in v2's rollout table.

### RT-24 [MISSED] — Cost and McLeod-side load
- C-21's ≈15,000 `/ws` GETs/day for parity is in a report but not in §2 or the Alex message list; McLeod licence seats
  (`X-com.mcleodsoftware.LicensingAgent`, C-31 — an integration user may consume a seat) and the API Kit's per-call or
  per-user pricing are not in the McLeod message list in §2.8.
- Fix: §2.8's McLeod message adds "does the integration login consume a licence seat, and is there a call-volume
  limit or charge"; the Alex message adds the /ws call volume per day.

### RT-25 [MISSED] — O-1 approves a list that does not exist yet
- O-1 ruled "approved as D-MK decisions, as v2 lists them". v2 is not written; the audit itself changes several v1
  recommendations (D-MK1 append-only → events; Q-MK5 reread → O-3; Q-MK13 scope → O-2). An approval of a future text
  is circular.
- Fix: v2 marks each D-MK row "as v1 recommended (ruled 2026-11-20)" or "CHANGED from v1 — needs ruling", and only the
  first kind cites O-1.

### RT-26 [OK] — items checked and sound
- §2.1 no re-send after a 2xx, capped sends (C-15/C-30): right, and needed.
- §2.2 one `clearStop` on Complete with both dates: right (A-36/C-17 reasoning holds; DispatchService has no
  truckload arrive op — `/dispatch/{stopId}/arrive` is LTL-only, re-confirmed).
- §2.4 drop+create and dedupe-before-visibility: right. §2.5 B-7 reason corrected: right (verified in postgrest-js).
- §2.6 SSN stripped from the FINAL body (D-59): right — `/drivers/new` defaults may carry `social_security_no`.
- §2.6 `name_of_spouse`: right (mail.md:89). `FUEL_PURCHASES` 28: right. No M-D6: right.
- §2.7 agent env keys, no new npm deps, separate write timer, public-repo rule: right. The separate timer must still
  never run `/ws` and SQL in parallel if Alex reads "one at a time" as covering HTTP — say it in the Alex message.
- §2.5 `title` for BOL # (B-13): acceptable — it matches every other hover on that page — but B-13's other half
  ("ALSO on the load page facts, for keyboard/touch") was dropped; restore it. Not a workaround if both halves ship.
- §2.1 one API env master switch: acceptable as defence-in-depth IF v2 names every service that must carry it
  (C-22: the one serving `/api/me` AND the one serving `/api/tms`) and its vocabulary matches the house form
  (`MCLEOD_WRITES_ENABLED=true|false` beside `MEDSTOP_SYNC_ENABLED`, `envCollectors.ts`), not a third name `MCLEOD_WRITES=off|on`
  (C-22 and X-1.5 each proposed a different name).

## 3. Summary

Counts — verification: 46 claims checked; 34 CONFIRMED (2 of them misapplied), 4 AUDIT WRONG, 5 OVERSTATED, 1 STALE.
Findings: AUDIT-WRONG 8 (RT-1, 2, 3, 5, 6, 11, 16, 20) · OVERSTATED 4 (RT-4, 12, 14, 15) · BETTER-SOLUTION 2 (RT-9, 21) ·
MISSED 11 (RT-7, 8, 10, 13, 17, 18, 19, 22, 23, 24, 25) · OK 1 (RT-26).

The six reports' citations hold; the defects are in how AUDIT §1–§2 and §4–§5 compressed them.

Top 10:
1. RT-1 — adopted switch schema: `test` mode on a production company writes with no proof; `live` on TMS can only be proven by a canary on TMS. Add a test-company list and the two-proof rule.
2. RT-3 — O-2 as ruled ("names, DOB, CDL number not written") makes O-7's create and O-6's rehire unbuildable; split update-fields from create-identity, ask the owner O-2a.
3. RT-18 — O-5 is ruled but §2.4/§2.2 implement the opposite (DL002 dead-letters; request enqueued and conflicted). Accept "ever dispatched", flag, enqueue nothing.
4. RT-19 — O-7 does block: with the create off, hand-made McLeod hires of 360-closed drivers are linked but frozen; and rehire bypasses the switch unless it is covered.
5. RT-7 — O-4's `isReportable=false` still creates an un-coded service failure; probe it and tell Alex.
6. RT-10 — test-company lane breaks "one program, one connection" or needs a new egress host; and every agent-facing fix waits a nightly release. Pick one agent + test org in production; budget release round-trips.
7. RT-20 — adopted DDL's `origin` list and missing `source_ref` cannot carry D's office/sweep/job writes or link image retries; `requested_by`/`changed_by` FKs still in the DDL.
8. RT-2 — the "existing VM lines" do not exist, and the VM company list re-introduces the restatement §2.1 claims to remove.
9. RT-5 + RT-6 — `claimNext` does NOT keep per-stop FIFO today (it is the change), and the Date format has seconds, not minutes.
10. RT-13 + RT-14 — 1,000-row cap/`.in()` limits on capabilities/parity readers; 0453 predictions need a re-key (or seq renumbering), not a tie-break, or D's ETA writes the wrong stop.
