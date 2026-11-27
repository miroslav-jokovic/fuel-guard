# Round 3 — assumption hunt (COUNCIL §2–§5, AUDIT §1–§2, §5)

Repo `/Users/miroslavjokovic/Projects/FG-mcleod-api` at `1c8ed3583` (last migration 0636). Docs: C = `docs/plans/mcleod/COUNCIL-2026-11-20-API-KIT.md`,
A = `AUDIT-2026-11-20-API-KIT-SPECS.md`. "<other-customer /ws>" = `<customer-hosted /ws docs>` (`?role=-1`), **another
carrier's install**: a PROVEN-DOC there proves McLeod's product docs, never our site settings.

Things I re-ran or re-opened myself this round:
- `node docs/plans/mcleod/api-kit-council/pg/t2.mjs` → `RESULT: 15 passed, 0 failed`. t3 → claim 47–57 ms at 260,000 requests.
  t1 → `delete stop 200: ERR … violates RESTRICT … reqs_stop_id_fkey` and the same for `loads` (finding N-3 below).
- The <other-customer /ws> Date type page (fetched 2026-11-20): "When vmparam set to `true`, pattern `yyyyMMddHHmmss`; `false`, pattern
  `yyyyMMddHHmmssZ`. Currently, vmparam set to `false`." `ss` = "Second in minute".
- `gh repo view` → PUBLIC. `gh run list --workflow driver-store.yml` → **one run** (workflow_dispatch, 2026-09-07, failure).

Classes: **PC** proven-code · **PD** proven-doc · **AS** assumed · **W** wrong · **IM** imprecise (true core, wrong detail).

## Table

| # | Statement | Where | Class | Evidence / closure (and what is built per answer) |
|---|---|---|---|---|
| 1 | `test` sends only admin prove requests, only to companies on `org_integrations.config` test-company list | C:38 | AS (design) | No such key exists (`git grep test_compan` in migrations/api → none). Needs: which company IS a test company (row 23). Build: owner act writes list from `GET /metadata` (K1). |
| 2 | Each `leased` event records the switch row | C:40 | PD | 1-pipeline P-5, pg/t2 "test mode does not lease a driver_app request" passes (re-run). |
| 3 | McLeod times equal ours → `confirmed already_applied` | C:42 | AS | "Equal" needs McLeod to store exactly what we send. Unknown: second-precision storage, rounding, McLeod adjusting arrival (e.g. arrival > departure, arrival before prior stop). Closure: K13 with seconds ≠ 0 and arrival = departure − 1 s; build: compare at the measured precision (RT-6), else minute-truncate + store raw. |
| 4 | A dispatcher cleared first → terminal `already_in_mcleod` | C:43 | AS | We cannot tell *who* cleared from RowStop unless a "cleared by" field exists; audit read is one day on <other-customer /ws> (A:44). A crash-after-apply whose stored times were rounded/adjusted would be mis-filed as `already_in_mcleod` (harmless label, wrong history). Closure: K9 (type page: any `entered_by`/`updated_by` on RowStop) + K5 audit 200/403. Build: field exists → classify by user; else by time-equality only, label wording "cleared in McLeod". |
| 5 | Stop already `D` at enqueue gets no request | C:44 | PC (mechanism) / AS (freshness) | `mcleodStopDeparted` `packages/shared/src/mcleodLoadProjection.ts:111-118`. But `external_status` is the mirror, ≤ one sweep old (15 min), so "D at enqueue" is "D as of last sweep"; the write-time precheck covers the rest. Fine — state the lag. |
| 6 | McLeod dates carry seconds | C:45 | PD | <other-customer /ws> Date page `ss` (fetched). What McLeod STORES is AS → K13 (row 3). |
| 7 | Time zone proven against the SQL mirror before canary; a wrong zone confirms itself on read-back | C:45-46 | PC + AS | SQL side is Central: `tools/mcleod-agent/centralTime.mjs:5-6` ("server itself reported `…-05`"). `/ws` side zone is AS → K6 (raw `actual_arrival` string of a cleared stop vs the SQL `CONVERT(…,126)` value of the same stop). Build: offset string → `offset` mode; bare → `server_central` mode + RT-22 fall-back rule. |
| 8 | `claimNext` does not keep order today | C:47 | PC | `apps/driver/src/data/outbox.ts:95-108` orders by `created_at` over all due records; a due Complete overtakes an Arrive in backoff. Audit A:69 was **W**. |
| 9 | FIFO per load "built in the tested `pickNext`" | C:48 | PC | `policy.ts:55-62`, `policy.test.ts:138-142`. Today it is global oldest-due, not per load: the change is real work. |
| 10 | Agent clears a movement's stops in order | C:50 | AS (need) | Whether McLeod refuses / clears both / clears one out of order is undocumented (WS.md:41). Closure K16 (test company). Build: refused → hold later stop while an earlier has a queued request (DR-9); clears-both → forbid, office exception. |
| 11 | No `auth.users` FK, add `driver_id` | C:51 | PC | `driverCredentials.ts` calls `admin.auth.admin.deleteUser` (≈:252); an FK would block it. |
| 12 | O-5 predicate: a driver **ever** dispatched (incl. McLeod repower or **co-driver seat**) is accepted | C:52-54 | IM | `load_dispatches.driver_id` exists (`0370:63`), one driver per dispatch. Co-driver seats are not kept (DR-7: mirror overwrites seats, `mirrorLoads.ts:62-63`). So "co-driver seat" is satisfiable only through `load_events` carrying `driver_id` (needs A-15). DR-7's residual (co-driver whose FIRST act is offline across a reassignment is refused) must be written in v2, not "holds". |
| 13 | "VM's existing lines" do not exist | C:55 | PC | `grep MCLEOD_API_WRITES tools/` → none (RT-2). |
| 14 | Alex disabling the McLeod user/token is "the true instant stop" | C:56 | AS | Nobody knows whether disabling a web user revokes an already-issued `/ws` token at once or only at next login. Closure: question to McLeod + test-company probe (disable user, next call within 5 s → 401?). Build: instant → keep as switch #1; lazy → switch #1 = "delete the token" (token mode) and state its latency. |
| 15 | API master switch | C:55 | PC (latency) | Settings come from SSM at container start (`infra/server/fetch-settings.sh:32-36`); a change needs a redeploy/restart → minutes, not seconds (OPS-3 right). |
| 16 | W9: `PUT /equipstatus/create` through TableRowService is a documented route | C:58 | PD (<other-customer /ws>) | WS.md:174-176. Whether OUR Users login may call it: AS → K21-type probe on test company. |
| 17 | Home time never writes `pta_date` | C:59 | ruling | design. |
| 18 | We read `tractor_status` | C:60 | PC | `tools/mcleod-agent/queries.mjs:91`. RowTractor key carrying S/I: AS → OF-5 probe (`GET /tractors/{id}` for an S and an I truck). |
| 19 | Trailers write only `is_active` + `outservice_date` | C:61 | AS (writability) | Field writability undocumented (W4/W12). Closure K21. Build: not writable → trailer status stays office-in-McLeod. |
| 20 | Only a public test cert committed; gitleaks would fail on a key | C:62-63 | PC | `.gitleaks.toml` exists with the "TEMPORARY… committing private keys defeats…" allowlist (RT-9). |
| 21 | pdf-lib 1.17.1 deterministic with `updateMetadata:false` | C:64 | PC (version) / PD (behaviour) | `apps/api/package.json:54` pins 1.17.1. Behaviour cited from pdf-lib source by OF report (`PDFContext.js:32` `SimpleRNG.withSeed(1)`); I could not re-open node_modules in this worktree. Close with a unit test: build twice, compare sha256. |
| 22 | `(stop, kind)` unique index for images | C:65 | W (conflicts) | DR-11/C-12 lets a second Complete ADD photos; AUDIT §2.6 "Send again = new request with `supersedes`", key `(bytes, order, category)` (A:103). A unique `(stop, kind)` refuses the second, larger PDF and every re-send row. v2 must say: unique `(stop, kind, sha256)` or `(stop, kind)` only among non-superseded rows. |
| 23 | Finance message is a follow-up to the 11-13 request | C:66 | PC | `tools/mcleod-agent/review/REQUEST-TO-ALEX-2026-11-13-FINANCE-ON-LME-AND-LUMPER.md` exists. |
| 24 | One agent, one connection (Alex's words) | C:68 | PD | `mail.md:38` "one program, one connection, SELECTs only". |
| 25 | Test company posted to a **test org in production** | C:69 | AS (unbuilt + blast radius) | No `is_test_org` anywhere (`git grep`). Every report, census, billing count, seat count and Ask-AI query must exclude it. Closure: list of readers (graphify `affected organizations`), or choose the alternative (staging env, second egress host, Alex's OK). |
| 26 | **A test company exists in our LoadMaster** | C:68, A:74, OPS probe table | **AS — biggest single assumption** | Repo knows companies TMS, TMS2–4 only; `connector.example.env:19` "TMS2/TMS3 are never read". Nothing says any is a test company. K13–K22 (10 of 24 probes) need one. Closure: question to Alex + McLeod (E5: is a test company/test server licensed?). Build: yes → MK0 T-probes; no → build from McLeod's written answers, switches stay `off` except `stop_clear` via OPS-2 live-company canary (non-EDI, non-billable test customer). |
| 27 | No new egress host | C:69 | PD + IM | True for the agent → our API. But the destination itself changed: Alex approved `fleetguardapi-production.up.railway.app` (`mail.md:40`); repo still shows it (`connector.example.env:9`, `review/CONNECTOR-ON-THE-VM.md:19`). Whether the VM was repointed to `api.360…` (AWS2b) is not recorded as done in `AWS-MIGRATION-PLAN.md:127`. Closure: CloudWatch `/silvicom/production` for `/api/tms/ingest` requests (also yields row 33's IP). |
| 28 | 0453 ETA predictions keyed on `stop_seq` | C:70 | PC | `0453_load_stop_eta_predictions.sql:24` index `(org_id, load_id, stop_seq)`. |
| 29 | C-1 lease 300 s | C:76 | AS (tunable, half-derived) | P-1 derives worst case for ONE request ≈ 164 s (4×15+7 precheck + 30 write + 67 verify). 300 s covers one request, **not a batch**: claim returns ≤ 5 (C-transport:44) processed sequentially → 5th request starts ≈ 656 s after lease. Fence makes it safe (begin_send refuses) but it wastes leases and costs re-claims. Fix: lease per request at processing start, or claim size 1 (OPS-9 already says 1 in canary). Measurement: p99 of precheck+write+verify from the P-run; lease = 2× that, recorded as tunable. |
| 30 | 90 s left on the lease | C:75 | AS (tunable) | Derivation given: > 30 s write deadline + settle POST. Settle POST via `postJson` is up to 4 × 60 s + 7 s (`service.mjs:24-25`) — longer than 90 s. Harmless only because C-2 accepts facts from any lease; v2 must say the 90 s guards the McLeod call only (30 s) and settle is outside the window. Then 90 = 3× write deadline: state as tunable. |
| 31 | Absolute 30 s write deadline | C:76 | AS | No measurement of `clearStop` latency, and no knowledge of McLeod's server-side timeout (a call we abandon at 30 s may still commit). Closure: K13 records latency; McLeod question "server-side request timeout for `/ws`". Build: deadline = max(30 s, 3× p99). |
| 32 | One claim loop at a time | C:76 | AS (enforcement) | The single-copy lock is a local file (`agent.mjs:95, 976`); a second VM/copy is not fenced by the DB. P-11 / C-20 "alert when two connectors claim" covers detection, not prevention; advisory lock serialises claims, OK. |
| 33 | Write routes only from **the VM's egress IP** | C:91-92 | **AS** | The VM is on the carrier's LAN; its public IP is the carrier ISP NAT address — static or not is unknown, may change with ISP failover. API side can see it: `app.set("trust proxy", 1)` (`app.ts:320`, comment still says Railway) behind Caddy `reverse_proxy` (`infra/server/Caddyfile:17`) → `req.ip` = the client. Closure: (1) CloudWatch: distinct source IPs of `/api/tms/*` over 30 days; (2) ask Alex "static public IP, and failover link?". Build: one static → pin; several → CIDR list in SSM; dynamic → no pin, rely on write token + short rotation. |
| 34 | Own limiter for agent write routes | C:92 | PC (need) | `/api/tms` shares `limit: 300 / 15 min` (`app.ts:340-346`). |
| 35 | Wait 300 s when outcome unknown (quiet period) | C:80 | AS (tunable) | Same number as the lease by coincidence; rationale "McLeod may still be applying" has no measurement. Closure: McLeod's server timeout (row 31). Quiet ≥ that timeout + margin. |
| 36 | At most 3 sends | C:80 | AS (tunable) | No derivation. Reasonable; name as tunable, measured against P-run transient rate. |
| 37 | Re-read after 60 s, back off, 3 re-reads → `accepted_not_visible` | C:81-82 | AS | Assumes read-after-write lag < 60 s (P-8 adds 2/5/15 min). Is McLeod's `/ws` read even eventually consistent? It is one DB, so lag is likely 0 — then the real cause is a 200-with-failure text. Closure: K13 read immediately after write; collect the exact 200 failure texts (P-8 probe). |
| 38 | A 200 with failure text counts as a refusal | C:83 | PD | WS.md:37-39 `text/plain` "string representing success or failure". The failure **wording** is AS → probe (stop not next, already cleared, bad date). Until known: any 200 body ≠ known success string → `applied_unverified` and read-back decides. |
| 39 | Image upload / driver create unknown → never re-sent | C:84 | PD (reason) | W5: result id is batch-or-record, indistinguishable. |
| 40 | Enqueue in own subtransaction, named codes | C:86 | design | DR-17; MW010/011 taken (`0551` greps). |
| 41 | `occurred_at` not in the future | C:88 | AS (tolerance) | Zero tolerance refuses every phone whose clock runs ahead. OPS-7 had "> 5 min after receive"; C dropped the number. Measurement: `load_events` skew `created_at − occurred_at` distribution for driver events (p99.9 negative skew) → tolerance. |
| 42 | `occurred_at` not before the stop was dispatched | C:89 | AS | Which time? `load_dispatches.created_at` (360 press) or McLeod dispatch? With C-11 the driver sees the load at McLeod dispatch; a pickup arrival can precede the 360 dispatch row. Decide the anchor; measure on staging. |
| 43 | Agent refuses to write until date setting known | C:89 | design | OPS-13 env line. |
| 44 | DST fall-back handled by offset-qualified times | C:89-90 | AS | Only if our `useServerTimezone=false`. <other-customer /ws> is `false` (fetched) — ours unknown. If `true`, no offset can be sent; RT-22's "earlier instant" rule applies. Closure K6. Also percent-encode `+`/`-` in query params (RT-22) — a test, not an assumption. |
| 45 | SSN strip in client `write()` | C:96 | design | OPS-15; K11 records key names. |
| 46 | Gate refusing committed `/ws` host etc. | C:97 | design | — |
| 47 | C-9 scratch band (seq 101–150) | C:98 | PC (premise) | `load_stops_seq_check` 1–50 (`0423:102`); unique `(load_id, seq)` non-deferrable (`0085:162-163`); seq = `movement_sequence` (`mcleodLoadProjection.ts:207-209`). AS: movement_sequence ≤ 50 always (constraint already enforces; violations would already fail today). |
| 48 | C-10 soft-remove | C:100 | PC (need) | pg/t1 shows a request FK RESTRICT blocks stop and load deletes (re-run) — so any hard delete of a stop/load that has a request will error. v2 must list every existing deleter of `loads`/`load_stops` (S0 pending-stop delete, retention, manual load delete) and state each one's behaviour. |
| 49 | OTA and APK lanes deleted 2026-10-22 | C:102 | PC | `git show d313fa8a1` (2026-10-22) removes `driver-ota.yml`, `driver-android.yml`. |
| 50 | Store lane: `driver-store.yml` "has never run" (DR-3) | C:101 via DR-3 | W (minor) | It ran once, 2026-09-07, workflow_dispatch, failed (`gh run list`). The point holds: never succeeded. |
| 51 | First store release must include the action-id client | C:102-103 | AS (timing) | No store release date exists; Apple account Individual is "the open launch blocker" (`RELEASE-GATE.md:132`); sign-off table empty (`:184-189`). Every driver-facing condition (C-11..C-14) waits on it. Closure: owner — store launch date and Apple Organization conversion status. Build: v2 orders MK3 after first store release, server stays tolerant of old builds. |
| 52 | C-13: stop action retries "instead of stopping after 8 attempts" | C:106 | PC | `policy.ts:24` `MAX_ATTEMPTS = 8`, backoff 2 s→5 min (`:26-27`). |
| 53 | C-14 window "current plus last 14 days" | C:108 | AS (invented, inconsistent) | DR-15 recommended **30 days**; C says 14 with no derivation. 1,000 cap is not the driver: at ~2.6 stops/load (`mcleodLoadProjection.ts:113`) 1,000 stops ≈ 385 loads — 14 or 30 days is far below it. So the window is a product choice (what a driver needs to look back on: detention/lumper disputes). Owner/ops question; chunking is needed regardless. |
| 54 | Reads chunked under the 1,000-row cap | C:109 | PC (need) | `driverLoads.ts:121-132` unwindowed, `.in(...)` unchunked (DR-15). |
| 55 | C-15 "Hire again" reopens terminated → applicant | C:111 | PC (gap) | No writer today (OF-1: `applicationLink.ts:88-90`, `0386:119-128`). `hire_applicant` does not clear `termination_date`/`archived_at` — v2 must. |
| 56 | C-16 sweep matches by licence and name | C:115 | PC | `rosterApplicantHire.ts:51-53` `sameName` (OF-3). |
| 57 | C-17 14-day trial, ≥ 98% readable | C:117-118 | AS (invented) | No sample size, no derivation. 98% of what n? At ~230 stops/day × some BOL share, 14 days is a few thousand papers — or a few dozen if one pilot fleet. Closure: owner + billing clerk set the bar; v2 states n ≥ (e.g.) 200 and the clerk's baseline for McLeod-capture images on the same rubric (compare, don't assume capture app = 100%). |
| 58 | Known-360-image skip prevents revised-RC echo | C:118 | PD | `LUMPER-REVISED-RC-PLAN.md:387-393` (OF-9). |
| 59 | Image "filed" = returned id or exactly one new match | C:119 | PD + AS | Image list has no uploader (WS.md:218-219). Staging vs stored timing AS → K19. |
| 60 | C-18 14-day accuracy check from B7's release | C:120 | PD (spec) / AS (thresholds) | Thresholds median ≤ 30 min, p90 ≤ 90 min, n ≥ 300 are spec D's D-MK6-1a, never derived from what a dispatcher's typed ETA achieves. Measurement: compute the same error on McLeod's current dispatcher `eta` vs `actual_arrival` (SQL, last 90 days) — 360 must beat that, not a fixed number. |
| 61 | Call-in probe checks four things; Alex confirms customer messages | C:121-122 | AS → question | Correctly framed as a probe + question (OF-15, RT-8). Also: does Samsara already post call-ins (OF-15 7-day read). |
| 62 | C-19 clearStop effects (EDI 214, ready-to-bill, pay, status, service failure) | C:124 | AS → question | Only doc text: "Clears the stop … and creates a service failure record if necessary" (OPS-1). Correctly a written Alex question. Alex says loadmaster loads include EDI (`mail.md:86`). Build: per answer, rollout order pickups → non-EDI deliveries → EDI. |
| 63 | Pickups have no billing effect (OPS-18 premise of rollout order) | C:126 | AS | A pickup clear may still emit EDI 214 "picked up" (AF/X3) and start detention. Must be in the C-19 question, not presumed. |
| 64 | Canary on a non-EDI, non-billable test customer | C:125 | AS | Existence of such a customer/driver/tractor in LoadMaster unknown (OPS-2). Alex question. |
| 65 | C-20 72 h stale rule | C:129 | AS (tunable) | From spec C; no derivation. Rule only forbids apply after a precheck (OPS-6), so the number just bounds how old a write we still send: tie it to the business (detention/billing close) — ask dispatch: after how many hours is a phone-supplied time no longer wanted? |
| 66 | C-21 token mode preferred | C:138 | AS | Whether our install issues Smartphone Mobile Service tokens to an integration user — K3. Licence seat per login — K23 (McLeod). |
| 67 | `update-connector.ps1` refuses unless exactly one line differs | C:135 via OPS-5 | PD (council) | OPS-5 cites `:194-197`; `update-connector.ps1:9,99` confirms mssql is the only dependency and must exist. |
| 68 | C-23 three readers move into a new shared file | C:141 | PC | `wouldClaimFromTelematics` `packages/shared/src/driverEditMeaning.ts:42`; `resolveDriverUpdate` + `DRIVER_IDENTITY_FIELDS` `packages/shared/src/rosterContract.ts:360,403` (file 452 lines, over the 450 warn → new file is forced). |
| 69 | Q-2: `isReportable=false` does not stop the SF record | C:149 | PD | <other-customer /ws> clearStop param text (RT-7). Whether our site refuses a late clear without `delayCode`: AS → K17. |
| 70 | Direction: append-only beats mutable status "at this volume" | C:155-156 | PD (PGlite) / AS (prod) | PGlite in-process numbers. Production DB is a micro instance that swaps (memory). Measurement: run t3's claim on staging Supabase with 260k rows (EXPLAIN ANALYZE). |
| 71 | 15/15 PGlite checks pass | C:157 | PC | Re-ran t2: 15 passed. |
| 72 | 260,000 requests claim ≈ 55 ms | C:157-158 | PC (PGlite) | Re-ran t3: 57/49/47 ms, sweep 130 ms. Where does 260,000 come from? ≈ 700/day × 365 = 255,500 — consistent with A's budget (row 79). |
| 73 | Org delete still cascades | C:158 | PC | t2 "org cascade deletes the whole pipeline". |
| 74 | 12 R, 9 T, 3 A probes | C:160-161 | W (count) | `3-ops.md` table has 24 rows: R = K1–K12 + K24 (13); T only = K13–K17, K19, K22 (7); A+T = K18, K20, K21 (3); A+R = K23 (1). Fix the sentence to the table. |
| 75 | No password ever committed; repo public | C:162 | PC (public) / PD (history) | `gh repo view` PUBLIC; history claim from OPS-16 `git log -S` (not re-run). |
| 76 | Alex 13 items, McLeod 15 items | C:164 | not verified | count when v2 drafts the messages. |
| 77 | W1 settlement/deduction/billing writable | A:37 | PD (<other-customer /ws>) | WS.md. |
| 78 | W2 trailer fields | A:38 | PD (<other-customer /ws>) | ours = K9. |
| 79 | W3 `GET /metadata` without login | A:39 | PD (<other-customer /ws>) | ours = K1. |
| 80 | W4 nulls omitted; keys from type page | A:40 | PD | WS.md. |
| 81 | W5 image upload raw body, rowType letter, result ambiguous | A:41 | PD | WS.md. |
| 82 | W6 date format by vmparam | A:42 | PD | Fetched; ours = K6. |
| 83 | W7 partial update, `NULL` word, no optimistic concurrency | A:43 | PD | WS.md; "read-before-write is the only conflict guard" = race window between precheck and write remains (dispatcher clears in between). Accept + verify catches it. |
| 84 | W8 audit keeps one day | A:44 | IM | <other-customer /ws> text says "based upon purge settings" — site setting (RT-12). Ours AS → K5 + Alex. |
| 85 | W9 EquipStatus Drivers-only → `next_home_date`/`pta_date` | A:45 | W | Superseded by C §2.8 (RT-11). |
| 86 | W10 call-in `new_eta` candidate | A:46 | PD | WS.md:91-94. |
| 87 | W11 75 services | A:47 | IM | SURFACE doc says 73 (`MCLEOD-API-SURFACE-2026-11-19.md:6`). One number in v2. |
| 88 | W12 undocumented list → MK0 | A:48 | PD | — |
| 89 | Per-org advisory lock, "one agent per org" | A:57 | AS | Not enforced (row 32). |
| 90 | `loads → mcleod` boundary edge `:399` | A:58 | IM | `scripts/check-feature-boundaries.mjs:399` exists; argument is about TS imports, the SQL enqueue is a table-ownership question (RT-4). |
| 91 | MW010/MW011 taken by 0551 | A:62 | PC | `0551_recruiting_message_wording.sql`. |
| 92 | `claimNext` keeps FIFO per stop | A:69 | W | row 8. |
| 93 | Exact match at **minute** precision | A:70 | W | seconds exist (row 6). |
| 94 | Connector reads one company (`connector.example.env:19-20`) | A:73 | PC | `MCLEOD_COMPANY_ID=TMS`. |
| 95 | Test lane "mirrored to a staging org only" | A:74 | W | superseded by C §2.13. |
| 96 | 0412 re-grant needed | A:79 | IM | RT-15. |
| 97 | Tests that turn red (`load-lifecycle.test.mjs:151`, `loadOnTruck.test.ts:100`); `tmsIngest.dispatchProjection.test.ts` | A:82 | PC (files exist) | lines not re-opened. |
| 98 | File budgets tms.ts 499, rosterContract 452, homeTime 456 | A:112 | PC | `wc -l`: `packages/shared/src/tms.ts` 499, `rosterContract.ts` 452, `apps/api/src/modules/roster/homeTime/homeTime.ts` 456. |
| 99 | Agent reads `MCLEOD_WS_*` (`agent.mjs:180-197`) | A:117 | PC | `agent.mjs:180-185`. |
| 100 | Only dependency mssql; script cannot install | A:118 | PC | `update-connector.ps1:9,99`; `tools/mcleod-agent/package.json:28`. |
| 101 | `node:crypto` cannot self-sign | A:119 | PD | Node has no X.509 creation API; true. |
| 102 | `/api/tms` limiter at `app.ts:340-346` | A:120 | PC | 300 / 15 min. |
| 103 | 02:00 finance sweep | A:121 | PC | `agent.mjs:1005`. |
| 104 | Repo public | A:122 | PC | `gh`. |
| 105 | Alex message: "the AWS host instead of Railway" | A:135 | AS (state) | Whether the VM already moved is not in the repo (row 27). |
| 106 | Next free migration 0637 | A:142 | PC | last file `0636_toll_plazas_and_observations.sql`. Will race with parallel chats — re-check at build. |
| 107 | pdf-lib, sharp, expo-crypto present | A:146 | PC | `apps/api/package.json:54,59`; `apps/driver/package.json:46`. |
| 108 | O-2 ruled narrow | A:172-174 | W (internally) | Makes O-6/O-7 unbuildable — Q-1 (RT-3). |
| 109 | O-4 ruled `isReportable=false`, "as today" | A:176-177 | W ("as today") | RT-7: a record is still created; dispatchers no longer "record lateness as today". |
| 110 | O-8 call-in if the probe shows ETA moves | A:186-188 | AS | Plus customer-message question (OF-15). |
| 111 | O-7 "rest of v2 does not wait on it" | A:185 | W | RT-19: `driver_reactivate` and the manual-hire link depend on it; C-16 fixes. |
| 112 | 700 requests/day budget | spec A:611-612 | PD (measured) | "live lme 2026-09-24: 99.3 movements/day × ~2.3 PU/SO stops ≈ 230 × 3". Three volume figures disagree across specs (X:184: A 99.3×2.3, C 160×3×2, D 210/day). v2 needs ONE measured number (SQL: cleared PU/SO stops per day, last 90 days). |
| 113 | Release train 01:07 CT Sun–Thu | RT-10 → C §2.13 | PC | `.github/workflows/release.yml:8, 193`. Consequence (each agent-facing API change waits a release) is real; v2 must budget round-trips or a standing hotfix OK. |
| 114 | AWS settings in SSM; change needs restart | OPS-3 | PC | `infra/server/fetch-settings.sh:32-36`, `deploy.sh:6` (SSM Run Command). |

## ASSUMED items that block a build step

1. **A test company exists and is reachable through our `/ws`** (row 26). Blocks MK0 T-probes K13–K22 and every switch beyond `off`. Question: Alex + McLeod. No → build on written answers, only `stop_clear` via OPS-2 canary.
2. **`/ws` is enabled on our 22.1 at all, base URL/TLS** (K1/K2). Blocks MK1+. Read-only probe.
3. **Our `useServerTimezone` and the stored precision** (rows 3, 6, 7, 44). Blocks writes (agent refuses) and the equality rule of C §2.2. K6 + K13.
4. **clearStop's downstream effects and undo** (rows 62–64, incl. "pickups have no billing effect"). Blocks MK3 canary. Alex in writing.
5. **Late clear without `delayCode`: refused or SF created** (row 69, K17). Blocks deliveries going live (pickups may be early).
6. **Out-of-order clear behaviour** (row 10, K16). Blocks the agent's ordering rule choice.
7. **VM egress IP static?** (row 33). Blocks C-7's IP pin as designed. CloudWatch + Alex.
8. **Is the VM already on `api.360` (AWS2b)?** (rows 27, 105). Blocks the Alex message's text and the IP measurement. CloudWatch.
9. **Store release exists** (row 51). Blocks every driver-facing condition (C-11..C-14) reaching a driver. Owner: Apple Organization status + date.
10. **Test org in production** (row 25). Blocks the test-company read lane: needs an `is_test_org` flag and a reader audit, or a different lane.
11. **Disabling the McLeod user stops `/ws` at once** (row 14). Blocks the kill-switch table v2 must publish. McLeod question / test probe.
12. **Q-1 (O-2a) and Q-4 (O-7 sentence)** — rulings; block `driver_create`/`driver_reactivate` only.
13. **Token mode available; licence seat per login** (row 66, K3/K23). Blocks choosing the auth mode.
14. **`(stop, kind)` image uniqueness** (row 22) — design contradiction to settle before the image migration.
15. **Every deleter of `loads`/`load_stops` vs the RESTRICT FK** (row 48) — code read before the pipeline migration.

## ASSUMED items safe to settle during build (with the measurement)

| Item | Tunable / measurement that sets it |
|---|---|
| Lease 300 s (row 29) | P-run p99 of precheck+write+verify; lease ≥ 2× p99; claim size 1 until measured (or lease at processing start). |
| Send window 90 s (row 30) | ≥ 3× write deadline; document that settle is outside it. |
| Write deadline 30 s (row 31) | K13 latency p99 × 3, and ≥ McLeod's server timeout (McLeod question). |
| Quiet 300 s (row 35) | McLeod's server-side timeout + margin. |
| Max 3 sends (row 36) | P-run transient rate; alert on 2nd send. |
| Re-read 60 s, 2/5/15 min, 3 reads (row 37) | K13: read immediately after a write; if visible at 0 s, cut to "one read, then conflict". |
| 200-with-failure text (row 38) | MK0 probe collecting exact texts; until then unknown text → `applied_unverified`. |
| Future-time tolerance (row 41) | `load_events` `created_at − occurred_at` skew, p99.9. |
| Dispatch anchor for "not before dispatched" (row 42) | Code decision + staging check. |
| 14-day driver window (row 53) | Owner/dispatch: how far back a driver needs; DR-15 said 30. |
| 98% / 14 days paper gate (row 57) | Owner + billing; state n and compare against McLeod-capture baseline on the same rubric. |
| DB7 thresholds (row 60) | SQL: dispatcher `eta` vs `actual_arrival` error, last 90 days → 360 must beat it. |
| 72 h stale (row 65) | Dispatch: age after which a phone time is unwanted. |
| Volume 700/day, 15,000 parity GETs (row 112) | One SQL count, last 90 days; K24 parity week at 500 ms. |
| Claim cost at scale (row 70) | EXPLAIN ANALYZE on staging Supabase with 260k rows. |
| Image staged vs stored (row 59) | K19. |
| Tractor S/I key, trailer field writability (rows 18–19) | K9 + K21. |
| pdf-lib determinism (row 21) | Unit test: build twice, compare sha256. |
| Probe count sentence, W11 73 vs 75 (rows 74, 87) | Text fixes. |

## Summary

Counts (114 rows): PC 39 · PD 25 · AS 35 · W 9 · IM 6 (rows with a split class are counted by their first class).

Top 15:
1. A test company is assumed and never confirmed. Ten of the 24 probes, and every switch past `off`, depend on it (row 26).
2. The C-7 VM egress-IP pin assumes the carrier's public IP is static. Nobody has measured it, and the API can see it (rows 33, 27).
3. The time zone and stored precision on our install are unknown. The DST fix "sends offset times", which works only if our vmparam is `false`. <other-customer /ws> is `false`; ours has not been read (rows 3, 6, 44).
4. "McLeod's times equal ours → already_applied" assumes McLeod stores exactly what we send (row 3).
5. The council does not show where the lease of 300 s comes from. It covers one request (≈164 s), not a claimed batch of five (row 29).
6. The derivation of the 90 s window ignores settle's 4 × 60 s POST. That is safe only because of C-2, and v2 must say so (row 30).
7. The 30 s deadline and the 300 s quiet period have no measured McLeod latency or server timeout behind them (rows 31, 35).
8. The `(stop, kind)` unique image index contradicts "add photos on a second Complete" and "Send again" (row 22, WRONG).
9. A request FK with RESTRICT blocks deleting a stop or load, as the PGlite t1 output shows. Every existing deleter needs an answer (row 48).
10. C-14's 14 days contradicts DR-15's 30, and neither is derived. The 1,000-row cap is not what forces the window (row 53).
11. C-17's 98% over 14 days and C-18's DB7 thresholds are invented. Each needs a baseline: McLeod capture and the dispatcher's own ETA (rows 57, 60).
12. "Not in the future" has zero tolerance for phone clock skew. OPS-7's 5 min was dropped (row 41).
13. The test org in production needs an `is_test_org` flag that does not exist, plus every reader excluded (row 25).
14. Both claims below need written answers:
    - "Pickups have no billing effect" (EDI 214 pickup messages, detention) is presumed.
    - "Disabling the McLeod user is instant" is presumed (rows 63, 14).
15. Several smaller errors:
    - The probe count "12/9/3" does not match the table (13 R / 7 T / 3 A+T / 1 A+R).
    - The O-5 "co-driver seat" wording is overstated.
    - `driver-store.yml` did run once and failed.
    - W11's 75 conflicts with SURFACE's 73 (rows 74, 12, 50, 87).
