# Audit of spec C — `docs/plans/mcleod/api-kit-specs/C-transport.md`

Repo: `/Users/miroslavjokovic/Projects/FG-mcleod-api` @ `22f3f0540` (spec says written at `cc590a62b`).
Auditor did not edit the repo. Line numbers are spec C's unless prefixed with a path.

## Part 1 — the existing agent

### C-1 [WRONG] The agent already HAS a `/ws` client and a CFG.mcleod block with the spec's key names
- Spec says (L68, L110, L114-117): CFG.mcleod :180-197 is "replaced"; new keys `MCLEOD_WS_URL`, `MCLEOD_WS_TOKEN`, `MCLEOD_WS_USERNAME`/`PASSWORD` introduced.
- Evidence: `tools/mcleod-agent/agent.mjs:180-197` already reads `MCLEOD_WS_URL`, `MCLEOD_COMPANY` (sent as AnywhereCompanyID), `MCLEOD_WS_TOKEN`, `MCLEOD_WS_USERNAME`, `MCLEOD_WS_PASSWORD`, `MCLEOD_PAGE_SIZE` (capped 1000), `MCLEOD_DRIVER_TIMEOFF_PATH`, `MCLEOD_REEFER_EQUIPMENT_TYPES`; `config.example.env:27-33` documents them. `fetchFromMcleod` (`agent.mjs:333-470`) uses Basic OR Bearer, `fetch` (undici), and `SOURCE=mcleod` one-shot mode.
- Correct statement / fix: the keys are not new; the spec must say what happens to `MCLEOD_COMPANY` (replaced by `MCLEOD_WS_COMPANIES` — any old `.env` with `SOURCE=mcleod` breaks), to `pageSize`/`driverTimeOffPath`/`reeferEquipmentTypes` (they live in the same block and are used by `fetchFromMcleod`'s mapping at :400-468), and that `MCLEOD_WS_*` values may ALREADY be present in the laptop `.env` (config.example.env is the laptop template; connector.env on the VM has none — `connector.example.env` has no MCLEOD_WS_ line). Say "extend CFG.mcleod (:180-197)" not "replace".

### C-2 [IMPRECISE] `fetchFromMcleod` is legacy one-shot code, not a service feed; moving it is optional scope
- Spec says (L68, L180-181, L202-203): `fetchFromMcleod` :333-470 moves into `mcleodApi.mjs`; its 6-way hydration (`agent.mjs:388-397`) is removed; "the first rule fails on `agent.mjs:347`".
- Evidence: `agent.mjs:333` `async function fetchFromMcleod`; 6-way workers at `agent.mjs:388-397` (correct); `AnywhereCompanyID` first appears at `agent.mjs:347` (correct). It is called only from the one-shot path `agent.mjs:493` (`CFG.source === "mock" ? mockData() : await fetchFromMcleod(since)`); `runService`'s feeds (`agent.mjs:1007-1014`) are all SQL. README "Switch to live McLeod" (README.md:96-107) still tells an operator to complete a mapping "marked TODO(confirm)" in it.
- Correct statement: citations are right. But the fix text must decide: either delete the `SOURCE=mcleod` one-shot path (it has never run against a real `/ws`; its mapping is `TODO(confirm)`, e.g. :461) or port it onto `createMcleodApi`. "Moves" hides that its `fetch`-based code cannot use the pinned `https.Agent` and that its mapping is unverified. Recommend: delete the `/ws` branch of the one-shot sync in PR-2 (SQL is the source for movements) and rewrite README:96-107 — it is stale and would contradict the new section.

### C-3 [IMPRECISE] Line citations in the agent
- `agent.mjs` `runService` feeds: spec ":1007" — correct (`const feeds = {` at 1007); jobs ":1015" — correct (`serviceJobs(...)` at 1015).
- Breaker log: spec `agent.mjs:1036-1038` — actual `agent.mjs:1039-1040` (`const b = breakerState(); if (b.open) log(...)`).
- `service.mjs:38` `validateIngestUrl` — correct. `service.mjs:236` `serviceConfigProblems` — correct; its signature is `({ rosterMode, dryRun })`, so §5.9's checks need new params (`writesOn`, `wsWriteCompanies`, `wsCompanies`, `certSha256`) and every caller updated.
- `connection.mjs:68-84` for the SERVERNAME rule — actual `connection.mjs:82-99` (comment 82-92, the IP check and throw 93-99). Also note `connection.mjs:111` uses `trustServerCertificate: trustCert !== false` — the SQL side does NOT pin; "same rule" is only the IP→servername rule, not the trust model.
- `connection.mjs` 15 s cap: `STATEMENT_TIMEOUT_MS = 15_000` at `connection.mjs:33` — correct.
- `check-agent-syntax.mjs` `AGENT_RULES` :71 — correct; "the loop at :118" — actual `rule.except === f` at `:124` (loop body 122-131); self-check practice comment at :67-68 — correct.

### C-4 [WRONG] "Alex's outbound-only Windows VM" cited to mail.md:36-42 — mail says Linux and names only two destinations
- Spec says (L13-15): "API calls run from the on-prem connector on Alex's outbound-only Windows VM ... (Alex, `docs/plans/mcleod/mail.md:36-42`)".
- Evidence: `mail.md:40` "We will stand up a small Linux VM. Node.js 22+, outbound to LME on 10.0.1.171:1433 and HTTPS 443 to fleetguardapi-production.up.railway.app, no inbound access." `mail.md:38` "The connector can run on our side as one program, one connection, SELECTs only." `mail.md:42` "silvicom_dispatch_ro stays read-only. No insert, update, or delete." The VM actually deployed IS Windows (`windows/update-connector.ps1:27-31`: scheduled task "Silvicom 360 connector", `C:\Silvicom\node\node.exe`).
- Correct statement: "the Board VM (Windows, scheduled task `Silvicom 360 connector`, `update-connector.ps1:27`); Alex's approval (mail.md:36-42) covers outbound to LME:1433 and HTTPS to the API host ONLY, and a read-only mirror". The `/ws` host is a NEW egress destination (A2 covers it) and writes contradict mail.md:38/42 in spirit — A1 is a re-approval of the whole posture, not an add-on; the letter must say it changes "Silvicom 360 can be a read-only mirror". Also: the approved API egress host is `fleetguardapi-production.up.railway.app`; with the AWS move (owner rule: never Railway) the ingest host changes, which is a third egress item for the same one-complete-list email (memory: IT requests are one complete list).

### C-5 [OK-with-note] The agent is NOT zero-dependency; new code must add none
- Evidence: `tools/mcleod-agent/package.json` deps `mssql ^11.0.1`; `update-connector.ps1:8-10` "node_modules stays: the only dependency (mssql) has not changed"; `manifest.mjs:13` "not the lockfile (nothing is installed)". Node is the VM's `C:\Silvicom\node\node.exe` (engines >=22).
- Note: the update path CANNOT install a new dependency (no `npm ci` step). So the spec's "built on `node:https`, not fetch" (L157-158) is right for that reason too, and the plan should state the hard rule: "no new npm dependency in tools/mcleod-agent — update-connector.ps1 does not install". See C-6 for the place it breaks.

### C-6 [WRONG] `fakeMcleod.mjs` "self-signed test cert generated at test time by `node:crypto`" — Node cannot do that
- Spec says (L106-108): "a `node:https` server with a self-signed test cert generated at test time by `node:crypto`, no fixtures on disk".
- Evidence: `node:crypto` can generate key pairs (`generateKeyPairSync`) and PARSE certificates (`X509Certificate`), but has no API to create/sign an X.509 certificate (Node 22/24). The usual routes are an npm package (`selfsigned`, `node-forge`) or the `openssl` CLI. Neither is available: the VM installs nothing (`update-connector.ps1:8-10`, `manifest.mjs:13` "not the lockfile (nothing is installed)") and Windows has no `openssl` on PATH by default; and the VM RUNS every `*.test.mjs` before restarting (`update-connector.ps1:167-182`) — a test that fails or skips there blocks or hollows the update.
- Fix text: "fakeMcleod uses a committed TEST-ONLY key+certificate pair (`fixtures/fake-mcleod-cert.pem`, `fixtures/fake-mcleod-key.pem`, CN `fake-mcleod.test`, 20-year validity, generated once with openssl on the Mac and labelled test-only in its header), added to `manifest.mjs`'s explicit list beside the review files". The pin test then uses that cert's known fingerprint. (A key in a public repo is fine ONLY because it is never trusted by anything but the test; say so.)

### C-7 [WRONG] Office routes are not at `/api/mcleod/...` when registered from `routes/integrations.ts:21`
- Spec says (L267, L587-596, L716-718): `GET /api/mcleod/api-health`, `/api/mcleod/writes…`, registered from `routes/integrations.ts:21`.
- Evidence: `apps/api/src/app.ts:261` `app.use("/api/integrations", integrationsRouter());`; `routes/integrations.ts:16-21` `router.use(requireAuth); … registerMcleodIntegrationRoutes(router);`; existing paths are `/mcleod/config` etc. (`modules/mcleod/routes/integration.ts:19-22`) → served at `/api/integrations/mcleod/config`.
- Fix: either name the paths `/api/integrations/mcleod/api-health`, `/api/integrations/mcleod/writes`, … (registration from integrations.ts:21 is then right), or give them a new mount and a route-ledger entry. The first is the house pattern.

### C-8 [GAP] The 12 MB discovery body cannot pass the router-wide 8 MB parser
- Spec says (L255, L578): "body limit raised to 12 MB on that route only".
- Evidence: `apps/api/src/modules/mcleod/routes/tmsIngest.ts:119` `router.use(json({ limit: "8mb" }));` runs for every route registered after it (lumper at :126). A route registered "beside :126" has its body parsed (and refused with 413) by the 8 MB parser first.
- Fix: register `POST /mcleod-api/discovery` BEFORE line 119 (after the token middleware at :100-117) with its own `json({ limit: "12mb" })`, or cap the gz payload so base64 fits (8 MB raw gz → ~10.7 MB base64 — the spec's 8 MB gz cap does not fit 8 MB JSON either). Recommend: send the docs gz as a separate `application/octet-stream` POST with `express.raw({ limit: "9mb" })` mounted before :119, and keep the JSON report small.

### C-9 [GAP] The `/api/tms` rate limiter (300 / 15 min per IP) is shared by every agent feed; the write loop's traffic can starve the loads feed
- Spec says (L44, L264, L581-582): claim every 15 s; health "each service cycle that ran an API job, and every claim"; one settle per request.
- Evidence: `apps/api/src/app.ts:340-346` `rateLimit({ windowMs: 15 * 60_000, limit: 300 })` on all of `/api/tms`. Today's agent load per 15 min ≈ loads 15 + close 2 + roster 3-4 + retire ~3 + lumper/finance occasional. Adding claim 60 + health ≥60 + settles (5 per claim when a backlog exists → up to 300) exceeds 300 in a backlog, and a 429 then refuses the LOADS post too (`service.mjs` retries 429 as transient, so the board goes stale).
- Fix: health is folded into the claim body (no separate POST per claim); settle accepts a batch (`POST …/writes/settle` with ≤5 results) or the claim returns only after the previous batch's settles; and state the per-15-min budget in the spec (claim 60 + settle-batch ≤60 + parity 1 + discovery rare ≈ 121, under 300 with today's ~25). Alternatively key the limiter by ingest token instead of IP — a wider change, needs its own decision.

### C-10 [WRONG] "the established evidence-table pattern" `pg_trigger_depth() > 1` for cascade exceptions does not exist in this repo
- Spec says (L468-470): append-only triggers allow "cascade from the org's deletion excepted — the trigger allows `pg_trigger_depth() > 1`, the established evidence-table pattern".
- Evidence: `grep -l pg_trigger_depth supabase/migrations/*.sql` → no file. Established patterns are: (a) guard UPDATE only and leave DELETE to retention + org cascade (`0532_scanner_relay.sql:160-180`: "Deletion stays open — retention (D-SR7) and an organization's cascade"); (b) refuse UPDATE/DELETE/TRUNCATE except the schema owner inside `set local silvicom.audit_retention` (`0395_access_changes_are_audited_in_one_transaction.sql:63-88`); (c) refuse everything (`0448_document_reader_tables.sql:228-237`).
- Fix: use (a) for attempts and switches (`before update` refuse; DELETE left to the org cascade, and both tables listed in `RETENTION_FORBIDDEN` so no retention job deletes them). A depth test is a new invention and also lets any nested trigger delete evidence.

## Part 2 — the write pipeline's database design

### C-11 [WRONG] Guard trigger's allowed status steps contradict `mcleod_write_settle`
- Spec says (L466-467): steps only `queued→sent`, `sent→queued`, `sent→confirmed|refused|conflict`, `queued→conflict`. And (L507): "`applied`/`already_applied` → confirmed (from sent OR queued: a late success is the truth)".
- Evidence: internal — `queued→confirmed` is not in the guard's list, so the late-success path raises MW002.
- Fix: add `queued→confirmed` to the guard (and require `lease_attempt_id is null` on it), or state that a late success from a stale lease records only an attempt row and the next claim's precheck reaches `already_applied`. Recommend the second: one path to `confirmed` (precheck/verify of the CURRENT lease) is simpler to test and needs no extra step.

### C-12 [WRONG] The canary fallback (U8 = none) is circular under the spec's own constraint and trigger
- Spec says (L790): "`proven_by_request` must then reference a canary request (the constraint is satisfied by a `live`+canary row, mode stays canary-restricted)".
- Evidence: `mcleod_write_switches_live check (mode <> 'live' or proven_by_request is not null)` (L408) needs proof for ANY live row, canary or not; `mcleod_write_rows_same_org` (L471-473) requires the proof to be confirmed "on `test_company_id` of a previous `test` row"; `mcleod_write_allowed` (L514-516) returns true for a live company only in `live` mode. So the first canary request can never be claimed (needs live), and the live row can never be inserted (needs a confirmed request). No path exists.
- Fix: add mode `canary` (`off | test | canary | live`): `canary` requires `canary_targets` not null and NO proof; `live` requires `proven_by_request` confirmed under a `test` OR `canary` row of the same kind. `mcleod_write_allowed`: canary → `p_target = any(canary_targets)` and `p_company = canary_company_id`.

### C-13 [WRONG] `mcleod_write_allowed` for `live` uses `<>` against a column that is null on live rows
- Spec says (L516): "live → `p_company <> test_company_id` is allowed".
- Evidence: `test_company_id` is only required for `test` (L401, L407); a `live` row will normally have it null, and `p_company <> null` is NULL → the function returns NULL/false → every live write is refused silently (the repo's own trap: memory "SQL NULL in RLS denies").
- Fix: `p_company is distinct from test_company_id`. Better (see C-14): a live row names its company.

### C-14 [GAP] The switch is per (org, kind), not per (org, kind, McLeod company) — four legal entities go live at once
- Spec says (L396-410, L514-516): newest row per (org, kind) wins; live = any company other than the test one.
- Evidence: `dbo.company` holds four legal entities (TMS, TMS2, TMS3, TMS4) — `agent.mjs:173-174` ("Getting this wrong mixes two legal entities"); spec E3 itself lists four. The only per-company scope is the VM's `MCLEOD_WS_WRITE_COMPANIES` (L122) — one lock, on the VM. Spec A's per-company lock is the API env `MCLEOD_WRITE_COMPANIES` (A L650-655). So "live for TMS" in the database means "live for TMS2-4" too.
- Fix: switches keyed `(org_id, kind, company_id)`; `company_id not null`; `test` = `company_id` is a test company (flag `is_test_company boolean` on the row, or a separate `mcleod_test_companies` list). `mcleod_write_allowed(p_org, p_kind, p_company, p_target)` reads the newest row for that triple.

### C-15 [GAP] D-MKT2's "exactly-once effect" breaks when verify reads `absent` after a 2xx — the loop re-applies
- Spec says (L644, L648-649): verify `absent` → "settle transient (accepted but not visible yet; next precheck decides)"; "No path issues a second `clearStop` while McLeod holds our value."
- Evidence: the next lease's precheck reads `absent` again whenever McLeod's read does not show the field the adapter looks at — which is exactly the failure a wrong `STOP_FIELDS` mapping (U12), a staged write, or a clearStop that stores the time on a different column produces. It then calls `clearStop` again, with backoff up to 15 min, for 72 h (≈ 290 calls on one stop).
- Fix: an `applied_unverified` outcome: after a 2xx, the request NEVER returns to `apply`; verify-absent settles `transient` with `observed.accepted = true`, and the adapter's precheck refuses to apply when ANY attempt on the request has `mcleod_status between 200 and 299` (the attempt log answers it — that is what it is for). After 3 verify-absent reads → `conflict` reason `accepted_not_visible`, office decides. Add the test "a 2xx followed by an absent read never sends a second clearStop".

### C-16 [GAP] Read-before-write compares one field only; D-MK1's "conflict = McLeod's record changed since the request" is not implemented
- Spec says (L560-562, L661-669): precheck compares McLeod's actual for `side` to `payload.at`; `baseline` is used only for the audit-check `since` and the enqueue refusal.
- Evidence: `MCLEOD-API-KIT-PLAN.md:155-157`: "`conflict` = McLeod's record changed since the request was made (dispatch changed the load while the phone was offline)". Spec A (A L672-674): compare status `D`, times, stop gone, movement differs. C's agent ignores `baseline.stop_status`, the stop's movement, and its driver/tractor; a stop re-planned onto another movement or another driver while the phone was offline (actual still null) is written anyway.
- Fix: precheck compares `observed` with `baseline` on: stop status, stop's movement_id, McLeod stop id still present, and (via `GET /movements/{id}`) movement status not V and the movement's driver1 = the load's driver at enqueue (add `driver_id` to baseline). Any difference → `conflict changed_in_mcleod`, before looking at the time. Note `GET /stops/{id}` does not give movement status — the spec's "movement status V in observed" row (L669) needs the second read.

### C-17 [GAP] Two kinds (`stop_arrival`, `stop_departure`) through `clearStop` will make the departure conflict with itself
- Spec says (L526-527, L563-565, L617): Arrive → `stop_arrival` = `clearStop?arrivalDate=…`; Complete → `stop_departure`.
- Evidence: surface doc L38-42: clearStop "Clears the stop with the given dates" — it is McLeod's DEPARTURE act (it clears the stop and may create a service failure). Spec A (A L540-541): "Writing on arrival would mark the stop departed in McLeod." If McLeod accepts an arrival-only clear, the stop is already cleared (status D, departure possibly defaulted); the later `stop_departure` precheck then reads a departure ≠ ours → `conflict`, or a re-clear of a cleared stop (behaviour unknown, U11).
- Fix: adopt A's mapping as the plan: ONE kind `stop_clear` written on Complete with both dates (arrival = driver's Arrive tap, or the arrival McLeod already holds, never invented; if neither and McLeod requires both → `refused arrival_unknown`). U10's "arrival alone accepted" branch is not a reason to send two writes — it only decides whether a departure-without-arrival is sendable.

### C-18 [IMPRECISE] "lease" on the request row is coherent ONLY because the request table is not append-only — say it; and lease expiry is lazy
- Spec says (L18, L325-330): "One append-only-friendly write-request table"; leases columns on the request row.
- Evidence: D-MK1 (`MCLEOD-API-KIT-PLAN.md:153-154`) rules "one append-only table of write requests". C's request row changes `status`, `lease_*`, `not_before`, `reason_*`, `settled_at` — a mutable queue row (the 0526 `print_jobs` shape, `0526_print_stations.sql:138-165`, which is mutable too). Leases on an append-only table are incoherent; on this table they are fine.
- Fix: state plainly "D-MK1 amended: the request row is a mutable queue row with an immutable intent (MW003); the append-only evidence is `mcleod_write_attempts`" and record it in the plan's decision log — it is NOT "ruled, not reopened". Also state that expiry is lazy (only inside `mcleod_write_claim`), so a single agent never loses its own lease mid-batch, and that settle tests the lease by ID, never by `lease_expires_at` (otherwise a batch of 5 slow requests — worst case 5 × (15 s read ×4 tries + 30 s write + 15 s ×4 verify) ≫ 120 s — would have its own refusals discarded).

### C-19 [GAP] `--api-prove` cannot create a request, and test-company stops have no baseline
- Spec says (L804-811): `agent.mjs --api-prove --company=TEST --stop=<id>` runs P1-P6; requests are created only by the API (`mcleod_write_enqueue`, L479), baseline from `mcleod_dispatch_stops` (L612-613).
- Evidence: the agent has no enqueue route (L576-582 lists discovery, health, parity, claim, settle); `mcleod_dispatch_stops` (`0364_mcleod_dispatch_raw.sql:113-148`) is filled by the SQL loads feed for ONE `MCLEOD_COMPANY_ID` (`agent.mjs:175`) — a test company's stops are never mirrored, so `baseline` (not null, L353) cannot be built.
- Fix: an admin route `POST /api/integrations/mcleod/writes/prove` (`requireAdminOnly("mcleod.connection")` + `requireFreshAuth`) that enqueues `source_ref = 'prove:<run id>'` with a baseline the agent supplies from its own `/ws` read (`baseline.source = 'ws_read'`), allowed only when the newest switch for (kind, company) is `test`; the agent's `--api-prove` then only drives the loop. Or: the prove CLI posts the proving request through a dedicated ingest route that refuses any company not in a `test` switch row.

## Part 3 — agent scheduling, locks, deployment

### C-20 [GAP] New jobs share ONE sequential loop with the SQL feeds: parity (~90 s) delays `loads`, the nightly finance sweep stalls `writes`
- Spec says (L283-290, L622-624): `api_parity` every 15 min taking ≈90 s; `writes` every 15 s "after loads"; "The loop never touches the SQL connection, so it does not affect the one-statement-at-a-time promise".
- Evidence: `agent.mjs:1027-1045` runs every due job to completion, one after another, then `sleep(5_000)`; `schedule.mjs:4-7` "runs whatever is due ONE AT A TIME". A 90-s parity run means the 60-s `loads` feed (the board) misses a cycle every 15 min; a multi-minute `financial` sweep at 02:00 or a `roster` cycle holds every write for its duration; a claimed batch can sit leased while finance runs.
- Fix: say it and bound it: parity reads at most N movements per tick (resumable cursor in service-state) so a tick is ≤ 10 s; `writes` processes ≤ 1 request per tick when another job is due (check `dueJobs` between requests); and state the worst-case write latency (= longest SQL job, measured: finance minutes at 02:00). Do not run `/ws` in parallel with SQL — the single loop is a promise to Alex.

### C-21 [WRONG] "no new SQL, so the reviewed routine is unchanged" — parity adds a SECOND open-board SQL read every 15 min, which changes the cadence promised in the letter
- Spec says (L285-287): parity step 1 runs "the existing open-board SQL read (the statement `serviceLoads` already sends — no new SQL, so the reviewed routine is unchanged)".
- Evidence: `schedule.mjs:9-10` "The cadences are the letter's, section 3. Changing one here changes what we told the carrier; the letter and `review/SILVICOM-READ-ROUTINE.sql` must be updated in the same PR."; `mail.md:69` Alex approved "open loads every minute…" — an extra execution of that statement is a new cadence.
- Fix: parity compares against the `loads` job's LAST result held in memory (no SQL of its own; ≤ 60 s old, which the in-flight re-read rule already tolerates) — or tell Alex in the A1 letter. Recommend the first; zero SQL change. Also state the `/ws` call volume Alex's app server gets: ≈160 `GET /movements/{id}` per 15 min ≈ 15,000/day for parity alone.

### C-22 [IMPRECISE] L1 and L3 share one name with two vocabularies; L1 "Railway/AWS variable"
- Spec says (L58-60, L702-704): API env `MCLEOD_API_WRITES` = `true|false`; VM line `MCLEOD_API_WRITES=on`.
- Evidence: two different switches with one name (`envAds.ts:19` uses the `z.enum(["true","false"])` form; the VM uses `on` like `LUMPER_FEED`, `lumper.mjs` `lumperFeedOn`). Memory rule (owner, 2026-11-15): production is on AWS — never Railway; "Flip = Railway/AWS variable + restart" (L702) names a host the owner forbade.
- Fix: API env `MCLEOD_WRITES_ENABLED` (`true|false`, in `envCollectors.ts` beside `MEDSTOP_SYNC_ENABLED` :49), VM line `MCLEOD_API_WRITES=on`. "Flip = the AWS service's env file (`infra/server/production.env` is the repo's record of production's settings — check `docs/DEPLOYMENT.md` for the current procedure) + restart". And name every service that needs it: the one serving `/api/me` (enqueue) AND the one serving `/api/tms` (claim) — if they differ, a half-set flag enqueues without claiming (W2 fires) or claims without enqueuing.

### C-23 [GAP] How L2 is read and how the owner flips live is underspecified; no UI step-up name
- Spec says (L594): "+ step-up (the 'Confirm it's you' flow other admin-only integration acts use)".
- Evidence: the middleware is `requireFreshAuth` (`apps/api/src/middleware/requireFreshAuth.ts:73`), route `routes/authStepUp.ts`.
- Fix: name `requireFreshAuth()` explicitly; state that `POST …/switches` with `mode:"live"` is owner-only (S1 is an OWNER sign-off, L887 — `requireAdminOnly` lets any admin flip it; add a check that the actor's role is `owner`, or record S1 as a second row "approved_by" that must be an owner). State that `mcleod_write_allowed` is evaluated at claim AND at enqueue, so a switch to `off` stops leasing within one claim (≤ 15 s) — already implied; write it as the guarantee.

### C-24 [GAP] McLeod's docs crawled from OUR install would be committed to a PUBLIC repository
- Spec says (L227-230, L234-237, L733-736): raw docs HTML gzipped into `mcleod_api_discoveries.docs_gz`; `pnpm mcleod:ws-docs-fixtures` writes them under `tools/mcleod-agent/fixtures/ws-docs/` (committed) and ships `fixtures/ws-docs.json` to the VM.
- Evidence: `gh repo view` → `PUBLIC` (`miroslav-jokovic/fuel-guard`); `update-connector.ps1:37` downloads from `raw.githubusercontent.com` unauthenticated. The API Kit is a purchased McLeod product (memory: "McLeod API Kit bought 11-19"); our install's docs pages may also carry our host name, AnywhereCompanyIDs and custom role names.
- Fix: commit only the PARSED surface (`{service, operation, method, path, roles, params}` JSON, hashed URLs, no prose) and a redaction test that fails on the host, company ids or any `<html` fragment; keep raw pages only in the DB row (admin-only route already, L596). Ask McLeod in E-list whether their docs may be redistributed — or don't redistribute.

### C-25 [GAP] Files and scripts the spec uses but never lists
- §2 omits: `tools/mcleod-agent/docsParser.mjs` (+test, L234), `wsSurface.mjs` (L238), `fixtures/ws-docs.json` and `windows/manifest.mjs` (L733-735; §2 L69 says update-connector.ps1 changes "nothing else" but manifest.mjs's explicit list must change), the root script `mcleod:ws-docs-fixtures` (package.json), the `--api-prove` code (L804), the `loads` export `readStopEventsSince` (L695 — does not exist today; `grep readStopEventsSince` → none), the office route for the badge `GET …/writes?source_ref=` (L717 — the table at L592 lists `?status=&since=` only), `docs/WORKER-DEPLOYMENT.md` (L681, one row), the A1 letter file under `review/`, and `review/SILVICOM-READ-ROUTINE.sql`'s cadence note (C-21).
- Fix: add each to §2 with the PR that carries it.

### C-26 [OK-with-note] Gate and file citations that check out
- `routes/tmsIngest.ts:126` `registerTmsLumperRoutes(router)` ✓; token middleware `:100-117` (spec :96-117, comment starts :96) ✓; `routeLedger.ts:27` `/api/version` public ✓; `routeLedger.ts:45` `/api/tms` ✓; `schedulers.ts:92` `financial-freshness` ✓; `financialFreshness.ts:242-275` scheduler and `:181-235` run-once with `keysAlreadySent` (:198) ✓; `table-modules.json:2502` `org_integrations` module `org` ✓; `tmsLumper.ts:21-25` 400 invalid_payload ✓; `driverLoads.ts:284` `completeStop` ✓; `dispatchProjection.ts:3` imports `../loads/index.js` ✓; `mcleodLoadProjection.ts:240` `${m.company_id}:${m.movement_id}` ✓; `packages/shared/src/tms.ts` 499 lines ✓; `router/routes/settings.ts:16` mcleod-fleets ✓; `rls.test.mjs` print_jobs seed at `:2482-2487` (spec 2479-2487, comment from 2479) ✓; `check-file-size.mjs:57` `SCAN_DIRS = ["apps","packages"]` ✓; `agent.mjs` 1,156 lines ✓; `requireAnySection` (`middleware/auth.ts:180`), `sectionManagerIds`/`surfaceHolders` (`modules/org/surfaceHolders.ts:16,24`) exist ✓; agent tests are collected by `lint:cli-streams`/`lint:agent-syntax` glob `tools/mcleod-agent/*.test.mjs` (`package.json:125,127`) ✓ — new test files must stay top-level.
- `stampRosterRead` is in `apps/api/src/modules/mcleod/tmsIngest.ts:157-179` (the MODULE file), not `routes/tmsIngest.ts` — give the full path.
- Latest migration on disk is `0636_toll_plazas_and_observations.sql` → "0637 today" ✓ (number re-taken at merge; parallel chats race — memory).

## Part 4 — `/ws` claims against `MCLEOD-API-SURFACE-2026-11-19.md`

Supported as stated (surface line in brackets): Basic or Bearer/Token auth, token from Smartphone Mobile Service or `POST /users/login` (S:19-21); token expiry undocumented (S:21); `Authorization`, `Accept` (XML default), `AnywhereCompanyID` on every call (S:22-23); `recordLength`/`recordOffset`, 1,000 cap, `-Dloadmaster.api.maxresultsize` (S:28-30); `changedAfterDate`+`changedAfterType` bounded by audit days-to-keep (S:31-32); no webhooks (S:33); `AuditTransactionService GET /auditTransactions/search` (S:89); clearStop query params and `text/plain` response, role Users (S:38-42); arrive/depart LTL-only (S:43-44); `PUT /drivers/create`, `TableRowService PUT /{table}/update`, `PUT /tractors/update`, `PUT /trailers/update`, `POST /images/...` (S:64, 70-72, 82, 87). `orderBy` exists with default `movement.id DESC` (S:28), so `ASC` is plausible.

### C-27 [OPEN] `changedAfterDate` with an absolute timestamp — only the relative form `t-1` is documented
- Spec says (L293-295): `changedAfterDate=<watermark − 10 min>` (Central wall time).
- Evidence: S:31 shows only `t-1`, type "Date"; the existing `fetchFromMcleod` passes an ISO string (`agent.mjs:367-372`, never run against a real `/ws`).
- Closure: Phase A step 4 adds one probe with an absolute value in each candidate format (`yyyyMMddHHmmss`, ISO with offset, `MM/dd/yyyy HH:mm`) and records which returns 200 + rows; `fmtMcleodDate` (U9) is shared by both uses. If only day-granular `t-N` works, the change leg is `t-1` every cycle and the 10-min overlap rule is replaced by "the whole last day, deduplicated".

### C-28 [OPEN] Audit-check design assumes filters the surface doc has not read
- Spec says (L654-657): `GET /auditTransactions/search` "filtered to the stop row since `baseline.mirror_last_seen_at`" and attribute "a user other than the integration user".
- Evidence: S:106-107 lists `GET /auditTransactions/search`'s detail page as STILL UNREAD.
- Closure: U14 gains a third row "granted but cannot filter by table+row id+date" → audit check off (same as not granted). Phase B records its params.

### C-29 [GAP] HTTP-status semantics are assumed; 404 and 403 refusals can mass-refuse a healthy queue
- Spec says (L144, L176, L633-634): 400/403/404/409/422 → `WsRefused`; precheck 404 → `refused not_found_in_mcleod`; 403 → `refused mcleod_role`.
- Evidence: the surface doc documents no status codes. A wrong base path (`/ws` vs `/ws/`), a proxy, or a role change answers 404/403 for EVERY call; the loop would permanently refuse every queued driver stop in one cycle.
- Fix: 403 → treat like `WsAuthFailed` (settle transient, stop the cycle, health `refused`); 404 on `GET /stops/{id}` counts as "stop gone" only when `GET /movements/{movement_id}` answered 200 in the same precheck (the movement exists, the stop does not). Add both tests.

### C-30 [GAP] 500 on a write is "transient", so a validation error McLeod reports as 500 re-applies every lease for 72 h
- Spec says (L174, L641): 500 on write → `WsTransient` → next lease's precheck decides.
- Evidence: precheck reads `absent` again (the write failed), so it applies again — no cap.
- Fix: cap applies per request (`count(attempts where outcome in ('transient') and observed.applied = true) >= 3` → `conflict` reason `mcleod_keeps_failing`), with C-15's "never re-apply after a 2xx" rule.

### C-31 [OPEN] `X-com.mcleodsoftware.LicensingAgent` header on login is ignored
- Spec says (L159-160): headers = Accept, AnywhereCompanyID, Authorization, User-Agent.
- Evidence: S:23 "Login also shows `X-com.mcleodsoftware.LicensingAgent`".
- Closure: Phase A step 2 records whether `/users/login` succeeds without it; E4 asks McLeod what value an integration user should send (it may consume a licence seat — ask that too).

### C-32 [IMPRECISE] TableRowService "does not advance movement status" is not in the surface doc
- Spec says (L770): "TableRowService `PUT /stop/update` … it does not advance movement status otherwise; generic row update rejected for stop actuals".
- Evidence: S:47 names `PUT /stop/update` only as a "candidate"; S:87-88 says auditing, permissions, validation are enforced; nothing about dispatch logic.
- Fix: "unknown whether it runs dispatch logic; used only if McLeod states in writing that it does" — drop the asserted fact.

### C-33 [OPEN] Open-status filter and the movement-detail response shape are unverified
- Spec says (L288-290): `GET /movements/search?…&<open-status filter>` then `GET /movements/{id}` supplies stop status/actuals/sequence.
- Evidence: S:27-28 lists prefixed fields but no status filter; nothing documents that `GET /movements/{id}` returns stops (only `agent.mjs:384-386`'s unverified comment).
- Closure: Phase A step 3 also records the key list of `GET /movements/{id}` (including nested stop keys) and probes `status=A`/`movement.status=A`; if no status filter exists, parity reads `changedAfterDate` + the SQL board's movement id list (`GET /movements/{id}` per id) — no search walk.

### C-34 [IMPRECISE] `page_cap_hit` definition
- Spec says (L785): "`page_cap_hit` = a full last page with no next".
- Evidence: §4 pages until a page < 1000 (L288-289), so a "full last page" cannot occur; the cap bites only if McLeod ignores `recordOffset` or caps total results.
- Fix: `page_cap_hit` = the walk returned exactly k·1000 rows AND a page repeated the previous page's first id (offset ignored) or the total equals a round 1000 multiple while SQL's count is larger.

## Part 5 — assumptions / TBD / open choices, each with a closure grounded in code

| # | Open item | Spec line | Closure |
|---|---|---|---|
| O1 | E1-E9, A1-A3 answers | L91-102 | One email each (memory rule); add to the Alex email: new egress `/ws` host AND the AWS ingest host replacing `fleetguardapi-production.up.railway.app` (mail.md:40), and the change from "read-only mirror" (mail.md:38). |
| O2 | U9 date format / zone | L791 | Phase B param doc + P2 read-back; `fmtMcleodDate` in `centralTime.mjs` (the one owner of Central, `schedule.mjs:15`). |
| O3 | U10 arrival-only | L792-793 | Moot under A's single `stop_clear` (C-17). |
| O4 | U11 already-cleared / late | L794 | P4/P5; precheck prevents re-clear; delay-code refusal text becomes the regex. |
| O5 | U12 RowStop keys | L795 | Phase A `stop_keys`; test pins `STOP_FIELDS`. |
| O6 | U14 audit service | L797-798 | Add "granted but unfilterable" (C-28). |
| O7 | Token expiry | L25, L780 | Login mode re-login on 401; record time-to-first-401. Fine as written. |
| O8 | N7 (client_action_id on stop actions) | L616 | Spec A §5 builds it; MK3 PR waits for it. |
| O9 | Stop identity | L612-613 | Use `load_stops.mcleod_stop_id` from A's S0 instead of `movement_sequence = seq` (A C1/C2: seq churns). |
| O10 | Test company exists? | L788-790 | U8; canary path needs the `canary` mode fix (C-12). |
| O11 | "N4 already adds McLeod actuals to the contract" | L718-719 | Verify in A/N4 before MK3's badge PR. |
| O12 | Owner-only S1 | L887 | `requireAdminOnly` is not owner-only (C-23). |
| O13 | Which AWS services carry L1 | L702 | C-22. |

## Part 6 — workarounds / simplifications

### C-35 [OPEN] W6 "evidence without request" is a detector for a two-transaction design that A avoids
- Spec says (L601-615, L695): enqueue in TS after `completeStop` commits; a lost enqueue is detected by W6 (critical).
- Evidence: A (A L555-556, L628-646) enqueues inside `driver_complete_stop`, same transaction as the evidence. C's ordering ("evidence first, never depends on McLeod") is ALSO satisfied by A's (the request insert cannot fail for a McLeod reason).
- Fix: adopt A's in-transaction enqueue (with its cross-module waiver comment); W6 then becomes a cheap invariant check, not a recovery path. C's orchestration file disappears.

### C-36 [OK-with-note] `mcleod_api_agent_status` written by two writers in two styles
- L497-499 (`insert … on conflict (org_id) do update` inside the claim function) and L579 (TS update-then-insert). Both legal (`lint:upserts` is about `.upsert()`), but one table, one writer: fold health into the claim (C-9) and let the claim function be the only writer.

## Part 7 — conflicts between spec A (§6, A-driver-loads.md:531-700) and spec C (§5)

### C-37 [CONFLICT-with-A] Table count and names
- A: TWO tables, `mcleod_write_requests` + `mcleod_write_outcomes` (A:557, A:581). C: SIX tables, of which three are the write pipeline — `mcleod_write_requests`, `mcleod_write_attempts`, `mcleod_write_switches` (C:345, 379, 396) — plus `mcleod_api_agent_status`, `mcleod_api_discoveries`, `mcleod_api_parity_runs`. Same name `mcleod_write_requests` with incompatible column sets: whichever migration lands second fails `create table if not exists` silently (no-op) and its functions then fail on missing columns.

### C-38 [CONFLICT-with-A] Append-only vs mutable request row
- A: both tables append-only, UPDATE/DELETE raise MW011 (A:600-601); state = latest outcome, `queued` = no outcome (A:602). C: request row mutable (`status`, lease, `not_before`, `reason_*`, `settled_at`), attempts append-only (C:325-330, 464-467).

### C-39 [CONFLICT-with-A] Columns
| Fact | A | C |
|---|---|---|
| operation | `operation in ('stop_clear')` | `kind` regex; `stop_arrival`, `stop_departure` |
| target | `load_id` FK loads restrict, `stop_id` FK load_stops restrict, `company_id`, `movement_id`, `mcleod_stop_id` | `company_id`, `target_type`, `target_id` (no FK to our rows) |
| data | `arrival_at`, `departure_at not null` | `payload jsonb {at}` |
| what we saw | `expected jsonb {external_status, actual_arrival_at, actual_departure_at, seen_at}` | `baseline jsonb {stop_status, actual_arrival, actual_departure, mirror_last_seen_at}` |
| provenance | `origin in (driver_app, office_retry)`, `supersedes` | `source_ref text` |
| actor | `requested_by not null` | `requested_by` nullable |
| time | `requested_at` | `created_at`, `not_before`, `settled_at` |
| outcome row | `state` (sent/confirmed/refused/conflict), `attempt int`, `reason_code`, `mcleod_status`, `mcleod_message`, `observed`, `recorded_at` | `event` (leased/reported/lease_expired), `outcome` (applied/already_applied/refused/conflict/transient), `lease_id`, `instance_id`, `agent_version`, `mcleod_status`, `mcleod_text`, `observed`, `at` |
| FK delete | outcomes→requests `restrict` | attempts→requests `cascade` |
| error codes | MW010 org, MW011 append-only | MW001-MW005 (different meanings, same prefix) |

### C-40 [CONFLICT-with-A] States and their meaning
- Same five names, different carriers: A's `sent` is an outcome ROW meaning "the agent called /ws"; C's `sent` is a STATUS meaning "leased" (set at claim, before any call). A has no lease state; C has no "called" fact on the request (only in attempts). C has `transient` and `already_applied` outcomes A lacks; A has `attempt` numbering C lacks.

### C-41 [CONFLICT-with-A] Uniqueness and retry
- A: one driver intent per (`stop_id`, operation) FOREVER (`where origin='driver_app'`), plus office retry = new row `supersedes` the refused/conflicted one (A:575-577, 675-681). C: one LIVE intent per (org, kind, company, target) while `queued|sent` (C:370-371); after a terminal, a new id may enqueue again; no office retry route; `stale_intent` tells the office to type it in McLeod (C:536).

### C-42 [CONFLICT-with-A] Who writes which row
| Row | A | C |
|---|---|---|
| request | `driver_complete_stop` SQL, same transaction as evidence (A:628-646); office retry route | TS `orchestration/driverStopToMcleod.ts` → `mcleod_write_enqueue` RPC, a second transaction (C:601-615) |
| outcome/attempt | agent intake route `.from("mcleod_write_outcomes").insert` (A:618, 669-671) | SQL `mcleod_write_claim` / `mcleod_write_settle` (C:486-511) |
| agent endpoints | `GET /api/tms/writes?limit=`, `POST /api/tms/writes/:id/outcome`, in `modules/mcleod/writes/` (A:666-671) | `POST /api/tms/mcleod-api/writes/claim`, `POST …/writes/:id/settle`, in `routes/tmsMcleodApi.ts` (C:576-582) |
| second terminal | 409 from unique index (A:671) | idempotent: returns status (C:506) |

### C-43 [CONFLICT-with-A] Arrival write and stop identity
- A: Arrive → no write; Complete → one `clearStop` with both dates (A:537-549). C: two kinds, arrival written on Arrive (C:617). A: stop resolved by `load_stops.mcleod_stop_id` (S0, A:41-60). C: by `mcleod_dispatch_stops … movement_sequence = seq` (C:612) — the churn A's C1 documents.

### C-44 [CONFLICT-with-A] Switches / company scope
- A: API env `MCLEOD_WRITE_COMPANIES` (comma list), `p_mcleod_write` computed by API (A:650-655). C: env bool `MCLEOD_API_WRITES` + per-(org,kind) switch table + VM `MCLEOD_API_WRITES=on` + VM `MCLEOD_WS_WRITE_COMPANIES` (C:702-704, 122). Two company lists in two places (A's env, C's VM line) plus C's table: three restatements of "which company may be written".

### C-45 [CONFLICT-with-A] Conflict rule, reasons, shared contract, budgets, UI
- Conflict detection: A compares status D, both times ±1 min, stop gone, movement differs (A:672-674); C compares one actual to the minute (C:560-562).
- Reason codes: A `arrival_unknown`, `stop_gone`, `mcleod_differs` (A:588); C `stale_intent`, `changed_in_mcleod`, `company_not_allowed`, `mcleod_role`, `not_found_in_mcleod`, `needs_delay_code`, `mcleod_said_no` (C:535-543). Shared names: A `MCLEOD_WRITE_STATES`, `MCLEOD_WRITE_REASON_TEXT` (driver words), `loadStopSchema.mcleod_write`; C `MCLEOD_WRITE_KINDS`, `MCLEOD_WRITE_REASONS` (office words) in a new `mcleodApi.ts`.
- Lifecycle budgets: A requests 700/day, outcomes 1,500/day (from 99.3 movements/day measured, A:611-613); C requests 2,000, attempts 4,000 (from "≈160 loads", C:864). Use A's measured base.
- Driver UI: A ships `McleodWriteIssues.tsx` (A:684-696); C says "unchanged UI in MK3 … a later plan item" (C:720-722).
- Ordering: A's tables migrate after S0b is live (A:552); C's PR-1 has no S0 dependency (C:878).

## Reconciled schema proposal (one pipeline, both specs, repo rules)

Principle: the INTENT and every FACT about it are append-only evidence (A's position, D-MK1's wording); the queue mechanics (who holds a lease) are derived from those facts, so nothing restates a status. Concurrency is per org, by advisory lock: there is ONE agent per org (the VM's `service.lock`, `service.mjs` `takeLock`), so a claim never contends and `SKIP LOCKED` buys nothing; the queue is tiny (≤ ~700/day, terminal rows excluded by partial index), so deriving the open set is cheap — C's rejection (a) does not apply at this size. One migration, `0637_mcleod_writes.sql` (number re-taken at merge), AFTER A's S0b is live.

```sql
-- 1. The intent. Immutable after insert. PK = client action id.
create table public.mcleod_write_requests (
  id              uuid primary key,                                  -- client action id / stop_completed event id; NO default
  org_id          uuid not null references public.organizations(id) on delete cascade,
  operation       text not null check (operation ~ '^[a-z][a-z_]{2,39}$'),  -- registry in @silvicom/shared (MCLEOD_WRITE_OPERATIONS); 'stop_clear' in MK3
  company_id      text not null check (length(company_id) between 1 and 10), -- OUR dbo.company.id; VM maps to AnywhereCompanyID
  target_type     text not null check (target_type in ('stop','movement','order','driver','tractor','trailer')),
  target_id       text not null check (length(target_id) between 1 and 40),  -- McLeod id (trimmed)
  load_id         uuid references public.loads(id) on delete restrict,       -- required for stop ops (check below)
  stop_id         uuid references public.load_stops(id) on delete restrict,
  movement_id     text,
  payload         jsonb not null check (jsonb_typeof(payload)='object' and octet_length(payload::text) <= 16384), -- stop_clear: {arrival_at|null, departure_at}
  expected        jsonb not null check (jsonb_typeof(expected)='object'),   -- McLeod as 360 last saw it (+ driver/movement for C-16)
  origin          text not null check (origin in ('driver_app','office_retry','prove')),
  supersedes      uuid references public.mcleod_write_requests(id) on delete restrict,
  requested_by    uuid not null references auth.users(id),
  requested_at    timestamptz not null default now(),
  constraint mcleod_write_requests_stop check (target_type <> 'stop' or (load_id is not null and stop_id is not null and movement_id is not null)),
  constraint mcleod_write_requests_retry check ((origin = 'office_retry') = (supersedes is not null))
);
create unique index on public.mcleod_write_requests (stop_id, operation) where origin = 'driver_app';
create unique index on public.mcleod_write_requests (supersedes) where supersedes is not null;
create index on public.mcleod_write_requests (org_id, requested_at);

-- 2. Every fact about an intent. Append-only. One row per lease, per McLeod call result, per expiry.
create table public.mcleod_write_events (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  request_id     uuid not null references public.mcleod_write_requests(id) on delete restrict,
  kind           text not null check (kind in ('leased','lease_expired','transient','applied_unverified','confirmed','refused','conflict')),
  lease_id       uuid not null,                       -- the lease this fact belongs to ('leased' row's own id space)
  lease_expires_at timestamptz,                       -- only on 'leased'
  not_before     timestamptz,                         -- only on 'transient' (backoff)
  reason_code    text check (reason_code ~ '^[a-z][a-z_]{2,39}$'),
  mcleod_status  integer check (mcleod_status between 100 and 599),
  mcleod_text    text check (length(mcleod_text) <= 500),
  observed       jsonb check (observed is null or jsonb_typeof(observed)='object'),
  instance_id    text not null check (length(instance_id) between 1 and 64),
  agent_version  text check (length(agent_version) <= 40),
  at             timestamptz not null default now(),
  constraint mcleod_write_events_lease check ((kind = 'leased') = (lease_expires_at is not null)),
  constraint mcleod_write_events_reason check (kind not in ('refused','conflict') or reason_code is not null)
);
create unique index mcleod_write_events_one_end on public.mcleod_write_events (request_id) where kind in ('confirmed','refused','conflict');
create index on public.mcleod_write_events (request_id, at desc);

-- 3. Who may be written: per org, operation AND McLeod company. Append-only; newest row wins.
create table public.mcleod_write_switches (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  operation         text not null check (operation ~ '^[a-z][a-z_]{2,39}$'),
  company_id        text not null check (length(company_id) between 1 and 10),
  mode              text not null check (mode in ('off','test','canary','live')),
  canary_targets    text[] check (canary_targets is null or cardinality(canary_targets) between 1 and 20),
  proven_by_request uuid references public.mcleod_write_requests(id) on delete restrict,
  changed_by        uuid not null references auth.users(id),
  reason            text not null check (length(btrim(reason)) between 5 and 500),
  changed_at        timestamptz not null default now(),
  constraint mcleod_write_switches_canary check ((mode = 'canary') = (canary_targets is not null)),
  constraint mcleod_write_switches_live check (mode <> 'live' or proven_by_request is not null)
);
create index on public.mcleod_write_switches (org_id, operation, company_id, changed_at desc);

alter table public.mcleod_write_requests enable row level security;
alter table public.mcleod_write_events   enable row level security;
alter table public.mcleod_write_switches enable row level security;
-- no client policies: service role only (deny-all on purpose)
```
Triggers: `forbid_org_change` on all three; one `mcleod_write_append_only` (`before update` → raise; DELETE left to the org cascade and refused for retention by `RETENTION_FORBIDDEN`, the 0532 shape); `mcleod_write_same_org` (request's load/stop and event's request in the row's org; a switch's `proven_by_request` is a `confirmed` request of the same operation+company issued under a `test` or `canary` row).

Functions (service role only):
- `mcleod_write_allowed(org, operation, company, target)` → newest switch for (org, operation, company): `off`→false; `test`/`live`→true; `canary`→`target = any(canary_targets)`. No `<>` against nullable columns.
- `driver_complete_stop(…, p_mcleod_writes_enabled boolean default false)` (A's in-transaction enqueue; the API passes the L1 env; the function itself calls `mcleod_write_allowed`; event payload records `mcleod_write: requested|off|no_mcleod_stop_id`). Cross-module waiver comment as A wrote.
- `mcleod_write_retry(org, request_id, actor)` (office) and `mcleod_write_prove(org, …)` (admin, test/canary only, C-19).
- `mcleod_write_claim(org, instance, version, operations[], companies[], max)`: `pg_advisory_xact_lock(hashtextextended('mcleod_write:'||org,0))`; for open requests (no terminal event) whose newest `leased` has expired and no later fact → insert `lease_expired`; then pick open requests with no live lease, newest `transient.not_before <= now()`, `requested_at > now() - 72h` (older → insert `conflict stale_intent`), allowed by `mcleod_write_allowed` → insert `leased` (≤ max). Returns them. Also writes `mcleod_api_agent_status` (claim is the only writer — C-36).
- `mcleod_write_settle(org, request_id, lease_id, kind, …)`: same advisory lock; a terminal already present → return it (idempotent, A's 409 becomes a 200 with the existing state); `lease_id` must be the newest `leased` for `refused/conflict/transient`; `confirmed` from any lease (a late truth). Never re-apply after an `applied_unverified` (C-15).
Derived state for UI/API (`queued|sent|confirmed|refused|conflict`, A's five): terminal event if any; else `sent` if any `applied_unverified`/`leased` exists; else `queued` — a SQL view or one TS function in shared, nowhere else.

Locks (D-MKT3, re-stated once): L1 API env `MCLEOD_WRITES_ENABLED` on every service that serves `/api/me` and `/api/tms`; L2 = the switch table per (operation, company) — replaces A's `MCLEOD_WRITE_COMPANIES` env (derive, don't restate); L3 = VM `MCLEOD_API_WRITES=on` + `MCLEOD_WS_WRITE_COMPANIES` (Alex's on-prem control; it is a lock, not a source of truth).

Gates: `lint:rls` (3 × enable RLS), `lint:table-modules` (module `mcleod`, layer `core`), `lint:table-lifecycle` (requests 700/day, events 2,100/day, switches 20, `time`, retention null) + `RETENTION_FORBIDDEN` for all three, `lint:table-producers` (requests: `driver_complete_stop` + two RPCs; events/switches: RPC bodies / switch route), `lint:schema-snapshot`, `lint:migration-ordering` (tables new → exempt; `driver_complete_stop`'s new parameter is defaulted), matrix `supabase/tests/mcleod-writes.test.mjs` (derived state, lease expiry, idempotent settle, one-end index, canary, no-null-trap), `rls.test.mjs` seeds.

Why: keeps A's append-only intent + outcome log and in-transaction enqueue (no lost-intent window, no W6 recovery), keeps C's lease/claim/settle mechanics (as events, not mutable columns), fixes the per-company and canary holes, and leaves one source for "which company may be written".

## Summary

Counts: WRONG 9 (C-1, C-4, C-6, C-7, C-10, C-11, C-12, C-13, C-21) · IMPRECISE 6 (C-2, C-3, C-18, C-22, C-32, C-34) · GAP 13 (C-8, C-9, C-14, C-15, C-16, C-17, C-19, C-20, C-23, C-24, C-25, C-29, C-30) · OPEN 5 (C-27, C-28, C-31, C-33, C-35) + 13 open items O1-O13 · CONFLICT-with-A 9 (C-37…C-45) · OK-with-note 3 (C-5, C-26, C-36).

Top 10:
1. C-37/38/39 — A and C define the same table name `mcleod_write_requests` with incompatible columns and opposite mutability; whichever lands second no-ops its `create table if not exists`. One schema must be chosen (proposal above).
2. C-12 — the canary fallback is circular: a `live` row needs a confirmed request that only `live` lets the agent claim. Add a `canary` mode.
3. C-14 + C-13 — switches are per kind, not per McLeod company (four legal entities go live together), and the live check `p_company <> test_company_id` is NULL on a live row, so every live write is silently refused.
4. C-15 + C-30 — the "exactly-once effect" breaks: after a 2xx with an absent read-back, or a write 500, the loop re-sends `clearStop` every lease for 72 h. Never re-apply after a 2xx; cap applies.
5. C-17 / C-43 — writing arrival via `clearStop` clears (departs) the stop; the departure then conflicts with itself. Use A's single `stop_clear` on Complete with both dates.
6. C-16 — read-before-write compares only one time field; D-MK1's conflict ("dispatch changed the load while offline") is not detected. Compare status, movement, stop presence, driver.
7. C-9 — the shared `/api/tms` limiter (300 / 15 min per IP, `app.ts:340-346`) would be exhausted by claim + health + settle traffic in a backlog, starving the loads feed.
8. C-6 — `node:crypto` cannot generate the self-signed cert `fakeMcleod` needs, and the VM installs nothing but runs every test before restart; commit a test-only cert.
9. C-7 + C-8 — office routes would mount at `/api/integrations/mcleod/...`, not `/api/mcleod/...`; and the 12 MB discovery body is refused by the router-wide 8 MB parser at `tmsIngest.ts:119`.
10. C-4 + C-21 + C-24 — Alex approved a Linux, read-only, two-destination VM (mail.md:38-42); writes, a new `/ws` egress, a moved AWS ingest host and an extra 15-min SQL read all need the A1 letter; and committing McLeod's crawled docs to this PUBLIC repo is a licence/leak risk.
