# Council member 3 — OPS / McLeod side / security (round 2), 2026-11-20

Repo read: `/Users/miroslavjokovic/Projects/FG-mcleod-api` @ `4876449c7`. Nothing edited. `/ws` facts re-checked
live on `https://tms-map.mcleodhosted.com/ws/docs/` (`?role=-1`) for clearStop, AuditTransactionService,
MetadataService and Roles, 2026-11-20: all the WS.md quotes I rely on hold verbatim.

Round-1 claims I re-verified and rely on: C-4 (VM is Windows, task "Silvicom 360 connector", Alex's mail said Linux);
C-5 (update script installs nothing, `update-connector.ps1:8-10`, `:99`); C-9 (`app.ts:340-346` 300/15 min per IP);
C-24 (repo is PUBLIC, `gh repo view` → PUBLIC); WS W5/W8/W9 (image result ambiguity, audit_log_tx keeps one day,
EquipStatus Drivers-only). Round-1 claims I correct: see OPS-3, OPS-5, OPS-12.

---

## Findings

### OPS-1 [BLOCKER] No spec says what `clearStop` does to McLeod BEYOND the stop's two dates, and there is no documented undo
- Evidence: the only text is "Clears the stop with the given dates and creates a service failure record if
  necessary" (clearStop page, fetched 2026-11-20). Spec A §6.1 (`A-driver-loads.md:537-547`) and C §5.4/§7 cover
  dates, conflict and delay codes only. `grep -n "EDI\|214\|ready to bill\|unclear\|undo"` over spec A finds nothing
  about downstream effects; spec C has nothing either. Alex: "Loadmaster loads are real McLeod loads, including EDI"
  (`mail.md:85-86`). DispatchService's write list (WS.md batch 1/3) has `cancel`, `changeEquipment`,
  `clearPreassignments`, `reconsign`, `split`, `unsplit`, `moveTrailer`, `locateTractor` — **no un-clear**. So an
  erroneous write cannot be reversed through `/ws`; it is a person in LoadMaster.
- What clearing a stop plausibly sets in motion in LoadMaster (each is a QUESTION for Alex/McLeod, not a fact):
  movement and order status (last stop → delivered), EDI 214 arrival/delivery status messages to the shipper,
  customer track-and-trace notifications, "ready to bill"/billing queue, driver pay on delivered movements
  (settlements), the tractor's current location/hub and next-stop/PTA computation, service-failure records
  (late vs appointment), `prior_uncleared_stops` handling when stops are cleared out of order.
- Fix text (v2, MK3 gate): "MK3 does not go `canary` until Alex has answered in writing, for OUR LoadMaster:
  (1) which of the effects above a stop clear triggers, per stop type (PU/SO), first vs last stop;
  (2) the exact LoadMaster steps to undo a wrong clear, including after EDI has been sent and after the order is
  ready-to-bill; (3) whether a dispatcher can tell an integration clear from a manual one (entered-by user).
  The answers are filed as `docs/plans/mcleod/MCLEOD-STOP-CLEAR-EFFECTS.md` (no host, no ids) and the office help
  text on a `confirmed` badge links the undo steps. First canary customers are **non-EDI** customers only (a list
  Alex names), so a wrong time never leaves the building as a 214 during the canary."

### OPS-2 [BLOCKER] The canary-in-live fallback (U8 = none) has no safe shape until OPS-1 is answered
- Evidence: C U8 "none" row (`C-transport.md:788-790`): live company, one test order, "Alex voids the order before
  billing and deletes any service-failure record clearStop created". C-12 already showed it is unreachable as
  written; even fixed (canary mode), voiding does not recall an EDI 214, a customer notification, or a settlement
  line, and `drivers/create`/image probes on live create permanent rows (driver ids are ≤ 8 chars and consumed;
  images on an order can land in an invoice packet).
- Fix text: "The live-company canary needs, in Alex's written OK: a test customer with no EDI trading partner and
  no notification contacts, flagged non-billable; a dedicated McLeod driver `S360TEST` excluded from settlements;
  a yard tractor; the undo steps of OPS-1 rehearsed once by Alex by hand on that order BEFORE our first call. The
  canary covers `stop_clear` only. `drivers/create`, `TableRowService` updates and image upload are NEVER probed on
  the live company — if there is no test company they wait for one (or for McLeod's written answer on required
  fields/writability, which is enough to build but not to switch on)."

### OPS-3 [WRONG] "Emergency stop … set L1 false (seconds, no VM access)" — on AWS it is not seconds, and Alex holds none of the three locks he can reach without us except the VM line
- Evidence: C §5.9 (`C-transport.md:702-713`). Production settings are SSM Parameter Store on AWS EC2 and a change
  needs a redeploy/restart (memory `never-railway-we-are-on-aws`; owner rule). L2 is `requireAdminOnly` in 360 —
  Alex has no 360 admin. L3 needs RDP + a script + a service restart.
- The kill switches that actually exist, fastest first:
  1. **McLeod side, Alex alone, instant:** disable the integration web user in LoadMaster (or delete its Smartphone
     Mobile Service token). Every `/ws` call 401s; the agent's `WsAuthFailed` stops calls for 15 min and raises W3.
     Not in any spec — it is the one Alex should be told first.
  2. **360 DB, our admin, ≤ 15 s + the in-flight batch:** L2 switch `off` (claim stops leasing). Requests already
     leased (≤ 5) still run — see OPS-9.
  3. **VM, Alex or us via RDP, ~1 min:** `Stop-ScheduledTask "Silvicom 360 connector"` (stops reads too) or
     `set-mcleod-api.ps1 -Writes off` (writes only).
  4. **API env L1, minutes:** SSM parameter + restart of every service that serves `/api/me` and `/api/tms`.
  5. **Ingest token:** `org_integrations.enabled=false` (`modules/mcleod/tmsIngest.ts:39-44`) — 401 on every agent
     route, i.e. reads stop too.
- Fix text: replace the §5.9 sentence with the five above, mark (1) and (3) as Alex's, and put (1) and (3) verbatim
  in the Alex message and in `review/CONNECTOR-ON-THE-VM.md`.

### OPS-4 [GAP] The VM task's restart behaviour is not in the repo; a fatal exit can leave the connector dead
- Evidence: `agent.mjs` `fail()` → `process.exit(1)` for config and lock problems; `runService` exits on a lost
  lock. The task was registered by `install-connector.ps1` from an untracked zip (memory
  `aws-migration-position` 10/27 18:00Z: "Real installer: Desktop/Email-to-Alex/silvicom-connector-win.zip"); the
  repo has no `New-ScheduledTaskSettingsSet` for this task (`git grep RestartCount` → only
  `tools/print-station/install-windows.ps1:57-59`). Nobody can say from the repo whether the task restarts.
- Fix text: "MK0 PR-2 commits `windows/register-connector-task.ps1` with the settings the VM must have
  (`-AtStartup`, `-RestartCount 999 -RestartInterval 1 min`, `-ExecutionTimeLimit 0`, `-MultipleInstances
  IgnoreNew`, run as SYSTEM — the print-station form), and a read-only `-Check` mode that prints the live task's
  settings. Step 1 of §6 runs `-Check` and records the output in the plan." Also add `process.version` and the
  task's last-start time to the health POST so Node drift is visible (Node is `C:\Silvicom\node\node.exe`,
  version not recorded anywhere in the repo).

### OPS-5 [GAP] `update-connector.ps1` cannot carry the API Kit as written, and its post-start check is blind to `/ws`
- Evidence (`windows/update-connector.ps1`): the `$Files` manifest is a hard-coded list of 39 files (`:41-83`);
  step 7 refuses unless EXACTLY one line, `ROSTER_MODE`, differs (`:194-197`); the post-restart failure regex is
  `'cycle failed|\(401\)|rejected the ingest token|refused the payload|unreachable after|REFUSED'` (`:232`) — a
  `ws … auth_failed`, `tls pin mismatch` or `writes: claim refused` line passes as SUCCESS.
- Spec C §6 step 1 is right that new code lands with every line off; but (a) the manifest must also list
  `fixtures/fake-mcleod-*.pem` (C-6) and anything under a new folder, and (b) the success regex must grow the new
  failure words, or the script reports success on a connector whose API half is broken.
- Fix text: "PR-2 extends `update-connector.ps1`'s `$bad` pattern with `ws .* (401|403|auth_failed|tls_pin)|writes:
  .*(refused|failed)|api_parity: .*failed`, and `manifest.mjs` lists every non-`.mjs` file the tests read. A test
  in `review.test.mjs` asserts every file a `*.test.mjs` opens is in the manifest."

### OPS-6 [RISK] When our API or `/ws` is down for hours — what happens, and two places it goes wrong
- Our API down: `postJson` tries 4× (1+2+4 s) then throws (`service.mjs:60-99`); the `writes` job fails, retries
  next tick; requests stay `queued`. Nothing is written to McLeod. Correct.
- `/ws` down, API up: precheck `WsTransient` → settle `transient`, backoff ≤ 15 min (C §5.3). Breaker opens after 3.
  Correct, BUT:
  - **(a) alert storm.** W4 fires per request after 6 transients; a 3-hour `/ws` outage with 40 queued stops is 40
    warnings plus W1/W2. Fix: W4 is suppressed while `mcleod_api_agent_status.last_error_class='transient'` and the
    breaker is open — one W3-style "McLeod's API has not answered since HH:MM; N stop times are waiting" instead.
  - **(b) the 72-hour stale rule mislabels an applied write.** C §5.3 step 2 turns any `queued` older than 72 h into
    `conflict stale_intent`. After an outage > 72 h (a long weekend with the VM off, or an API outage), a request
    that was applied before the outage but whose settle never reached us (lease expired → `queued`) becomes
    `stale_intent` though McLeod HAS it. Fix: the stale rule only forbids the APPLY; the agent still prechecks a
    stale request and settles `already_applied` when McLeod holds our minute; only an `absent` precheck becomes
    `stale_intent`.
- During any outage dispatchers keep clearing stops by hand (today's process). On recovery every such stop is a
  precheck `different` → `conflict changed_in_mcleod` → W7 per request. Fix: a precheck that finds McLeod's stop
  already cleared by a person with a time within the minute-precision of ours → `already_applied`; with a
  different time → a quiet `superseded_in_mcleod` (no bell), because McLeod being ahead of us is the normal state
  after an outage, not an anomaly. Bell only for `different` when McLeod was NOT cleared at enqueue and the
  dispatcher's time differs by > 15 min.

### OPS-7 [RISK] Phone-supplied times go into McLeod's system of record with no bound
- Evidence: `driver_complete_stop` takes `p_occurred_at` and uses it as-is (`0141_driver_load_rpc_contract.sql:287`
  `v_now := coalesce(p_occurred_at, now())`); the contract is `occurred_at: z.string().optional()`
  (`loadsLifecycle.ts:139,145`). A phone with a wrong clock (manual time, wrong zone, dead RTC after a battery swap)
  writes a wrong arrival into McLeod, which then drives detention, on-time KPI, service failures and (OPS-1) the
  customer's 214.
- Fix text: "The enqueue (in `driver_complete_stop`, R §2.1) refuses to create a McLeod request — the evidence row
  is still written — when `occurred_at` is more than 5 min after the server's receive time, earlier than the
  load's dispatch (`approved`) event, or when arrival > departure; the event payload records
  `mcleod_write: 'time_out_of_bounds'` and the office sees it as an exception (O-5's list). An offline replay's
  `occurred_at` hours in the past is legitimate and allowed."

### OPS-8 [RISK] One `fgtms_` ingest token now authorises claiming and settling McLeod writes
- Evidence: every `/api/tms` route authenticates by one bearer, hashed and looked up per org
  (`modules/mcleod/tmsIngest.ts:34-51`, `routes/tmsIngest.ts:100-117`); spec C mounts claim/settle under the same
  middleware (`C-transport.md:571-575`). Today a leaked token can inject reads; tomorrow it can also (i) claim
  requests and read their payloads (driver create = names/licence/hire data under O-2), (ii) settle them
  `confirmed`/`refused` without any McLeod call — a silent loss of every McLeod update, invisible to W1–W6 because
  the requests look settled. The token sits in `connector.env` on the VM; the 08/28 token lived on the owner's
  laptop until 10/27 (memory `aws-migration-position`, rotated to prefix `fgtms_<redacted>`).
- Fix text: "Write routes require a second credential: a write-scoped token (`fgtmw_…`, its own hash column in a
  new mcleod-owned table, issued by `issueMcleodToken.ts --scope=writes`, stored only in the VM's connector.env by
  `set-mcleod-api.ps1`), and the API refuses claim/settle from any source address other than the VM's egress IP
  recorded at issue (`MCLEOD_AGENT_EGRESS_IP` in SSM; Caddy passes the client IP). Settle of `confirmed` must
  carry `observed` with the compared keys; a `confirmed` without them is refused 400." Rotation procedure = the
  10/27 one (open the VM prompt first, issue last).

### OPS-9 [GAP] L2 `off` does not stop a batch already leased
- Evidence: claim returns ≤ 5 requests; the loop then applies them sequentially (`C-transport.md:626-649`) with no
  re-check. A switch to `off` mid-batch still sends up to 5 `clearStop`s, each up to 30 s + reads ≈ 2–3 min.
- Fix text: "claim `max = 1` while a kind is in `canary`; in `live`, the agent re-reads the switch verdict
  (returned by every settle response: `{ status, allowed_next: bool }`) and abandons the rest of the batch (settle
  `transient`, no apply) when `allowed_next=false`."

### OPS-10 [GAP] Login-mode tokens may consume a LoadMaster licence seat or session; nothing logs out
- Evidence: `POST /users/login` "returns a new token" (auth page) and `POST /users/logout` exists (WS.md "Users");
  the login Try-Out lists `X-com.mcleodsoftware.LicensingAgent` (C-31). Spec C logs in on first call and after any
  401, never logs out (`C-transport.md:162-167`). If each login holds a concurrent web-user licence, a restart loop
  (OPS-4) or 401 storm could hold seats office users need.
- Fix text: "Prefer `MCLEOD_WS_AUTH=token` (Smartphone Mobile Service token, no login calls). In `login` mode:
  re-login at most once per 15 min, `POST /users/logout` on SIGTERM/SIGINT and before every re-login, and the McLeod
  message asks whether a `/ws` login occupies a licence seat and what `LicensingAgent` value an integration sends."

### OPS-11 [GAP] Least privilege: `/ws` roles are web-user TYPES, and `Users` reaches money and generic DELETE
- Evidence: Roles page (fetched): "For the user to access endpoint, the users web user type m[ust] be on endpoint."
  The `Users` type can call `PUT /billing/update`, `POST /billing/postBills`, `PUT /settlements/create`,
  `PUT /deductions/create`, `PUT /orders/create`, and TableRowService `DELETE /{table}/{id}` (WS.md batch 1 and
  "Money — WRONG"). C U4's answer "only stock `Users` role → accepted; `WS_PATH_ALLOWLIST` bounds the token in our
  code" bounds OUR code, not a stolen credential. TableRowService says "auditing, permissions and validation code
  runs" — so LoadMaster's own user security probably applies; `GET /metadata` returns `currentUser` and a `deny`
  list (WS.md batch 4) that would show it.
- Roles exactly: the integration user is web-user type **Users only**. Not Drivers (EquipStatus is Drivers-only →
  home time goes through TableRowService `equipstatus` as Users, or waits), not Symphony MC, not Fusion Partners.
- Fix text: "The McLeod message asks for the integration user's LoadMaster security profile to deny billing,
  settlement, deduction, payroll, wire, order entry and every delete, and to allow only: stop clear, image add,
  driver create, driver/tractor/trailer/stop update, call-in create, and the reads. MK0 records `/metadata`'s `deny`
  list for that user and probes one denied read (`GET /billing/...` list) expecting 403. If McLeod says user
  security does not apply to `/ws`, the residual risk (a stolen credential can post bills) goes to the owner as a
  ruling before L3 is turned on."

### OPS-12 [WRONG] U3's likely outcome is misread: `AnywhereCompanyID` may be the instance code, and the probe for it is free
- Evidence: `agent.mjs:173-174`: "dbo.company.id (TMS, TMS2, …) — NOT dbo.company.company_id, which is the
  LoadMaster instance code and reads 'TMS' on all four rows." C U3 rules "one id for all companies → refused, MK3
  blocked". If the header is the instance code, that row is the normal case and blocks MK3 on a misreading; if it
  is `dbo.company.id`, the map is identity.
- Fix text: "U3 is decided by reads only: `GET /metadata` (no login) lists the enabled companies; then
  `GET /stops/{id}` for one known stop of TMS and one of TMS2 (ids from the SQL mirror) under each candidate
  header. Pass = a stop is returned only under its own company's header and its `company_id` field equals that
  company. If one header returns all companies' rows, writes are still safe PROVIDED the precheck compares the
  read stop's `company_id` with the request's — add that compare to the precheck (R §2.2's list) regardless of U3."

### OPS-13 [GAP] Date format is chosen per install by a vmparam; the agent must refuse to write until it knows ours
- Evidence: Date type page: `yyyyMMddHHmmssZ` when `loadmaster.ws.useServerTimezone=false`, else `yyyyMMddHHmmss`
  in the SERVER's zone (WS.md batch 2). Our LME server reported `-05` in September (`centralTime.mjs:6-8`), i.e.
  Central. If `true`, a time sent with an offset may be refused or misread; if `false`, a zoneless time is read as
  something.
- Fix text: "`MCLEOD_WS_DATE_MODE=offset|server_central` in connector.env, written by `set-mcleod-api.ps1` from the
  MK0 reading of OUR Date page AND a response date from `GET /stops/{id}` of a cleared stop (a value ending in
  `-0600` → offset). `serviceConfigProblems` refuses `MCLEOD_API_WRITES=on` without it. `fmtMcleodDate` uses
  `centralTime.mjs` for `server_central`. P-run read-back pins it across the DST boundary (next: 2027-03-14)."

### OPS-14 [RISK] PII travels into `observed`, `mcleod_text`, discovery rows and the agent's memory
- Evidence: `GET /stops/{id}` returns `__directions`, `location` child, `signed_for_name`, stop notes children
  (WS.md "Stops"); `GET /drivers/{id}` / `drivers/create` result return the whole RowDriver incl.
  `social_security_no`, `birth_date`, `license_no`, address (WS.md "RowDriver", "Drivers"). C stores `observed jsonb`
  unbounded in shape (`C-transport.md:389`); McLeod's refusal text (no error schema, `Response` "has no fields")
  is free text that can echo submitted values, stored up to 500 chars and shown to `dispatch.manage`
  (`C-transport.md:592`). Alex's condition: "Logs should stay counts, times, and McLeod ids. No addresses or licence
  numbers" (`mail.md:89-90`).
- Fix text: "`observed` is built only by a per-adapter allowlist (`STOP_OBSERVED_KEYS = [status, actual_arrival,
  actual_departure, movement_id, company_id]`; driver adapters: only the fields being written + `id`,
  `is_active`) — a shared Zod `.strict()` schema per kind, so an extra key is a 400 at settle. `mcleod_text` passes
  through `redactMcleodText` (9+ digit runs, `\d{3}-\d{2}-\d{4}`, e-mail shapes → `▮`) on the AGENT before it
  leaves the VM. Test: a stub McLeod that answers 422 with an SSN and a licence number in the text; the settle
  body the fake API receives has neither."

### OPS-15 [OK-with-fix] SSN never sent — the strip-the-final-body design (D-59) is right; three holes to close
- Verified design: R §2.6 "the agent strips every SSN-shaped key from the FINAL body, including `/drivers/new`
  defaults; the test asserts the exact body the stub receives". `toRowDriver` emits none (D spec `:597-598`).
- Holes: (1) the regex must also cover `tax_id`, `fed_id`, `ssn_*`, `social*`, and any key whose VALUE matches
  `^\d{3}-?\d{2}-?\d{4}$` (a default copied into a free-text field); (2) the create RESPONSE and any
  `GET /drivers/{id}` read-back are never stored whole (OPS-14); (3) the strip is in `mcleodApi.mjs`'s `write()`
  for every `driver`-table body, not in the driver adapter, so a later adapter cannot forget it — gate rule in
  `check-agent-syntax.mjs`: `social_security_no` may appear only in that file. MK0 records whether
  `GET /drivers/new` returns a `social_security_no` key (D-59 (3)); whether create REFUSES without it is a
  test-company probe only (OPS-2).

### OPS-16 [RISK] The public repo already carries McLeod network and login facts; the API Kit must add none
- Found in tracked files (no secret, verified through history — `mail.md` was first committed already redacted,
  `48ed31845`, 2026-09-23; `git log -S` shows no password in `tools/mcleod-agent`):
  - LME server IP `10.0.1.171` in **18** tracked files (e.g. `tools/mcleod-agent/connector.example.env:15`,
    `config.example.env`, `connection.mjs`, `review/CONNECTOR-ON-THE-VM.md:21`, `docs/plans/mcleod/mail.md`,
    `MCLEOD-COLLECTOR-PLAN.md`, `LIVE-MAP-PLAN.md`, `FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md`, api-kit-audit `C.md`);
  - SQL server name `APPNEW` (10 files incl. `connector.example.env:30`, `connection.mjs`);
  - database names `lme`, `lme_analytics`; SQL login `silvicom_dispatch_ro` (23 files);
  - company ids `TMS…TMS4`; the full grant script `review/SILVICOM-GRANTS.sql` and read routine;
  - Alex's correspondence verbatim (`docs/plans/mcleod/mail.md`).
  RFC 1918 address, not routable from outside, so this is reconnaissance aid, not exposure. But the API Kit adds
  credentials with WRITE reach, so: nothing new goes in.
- Fix text: "Never committed: the `/ws` URL or host, its certificate or fingerprint, AnywhereCompanyIDs beyond the
  four already public, the integration user name, the test company id, raw or parsed docs of OUR install (C-24).
  `connector.example.env` uses `MCLEOD_WS_URL=https://REPLACE_ME/ws`. A new gate `lint:mcleod-secrets` (chained onto
  `lint:agent-syntax`, documented in its `//lint:*` comment) fails on `MCLEOD_WS_URL=https?://(?!REPLACE_ME)`,
  any 64-hex `CERT_SHA256=` value, and `-----BEGIN` outside `tools/mcleod-agent/fixtures/fake-mcleod-*` (C-6).
  Note for the owner: the VM's update path downloads from `raw.githubusercontent.com` unauthenticated
  (`update-connector.ps1:37`), so making the repo private breaks VM updates until the script fetches a signed zip
  instead — decide before relying on privacy."

### OPS-17 [GAP] Secrets on the VM: one plaintext file now holds three credentials of three different strengths
- Evidence: `connector.env` ACL SYSTEM:R, Administrators:F (`update-connector.ps1:85-88`); C §3.4 adds the McLeod
  token/password to the same file. Every VM administrator (Alex's IT, our RDP account) can read the write
  credential. Backups: `update-connector.ps1:153` copies `connector.env.bak` into `C:\Silvicom\backup-<sha>` on every
  update, never deleted by the script ("delete it after a day" is advice, `:238`) — each backup is another copy.
- Fix text: "The McLeod `/ws` secret lives in its own file `mcleod-ws.env` (same ACL), loaded by a second
  `--env-file`, so the update script's `connector.env.bak` never copies it and a person sharing `connector.env` for
  support never shares it. `set-mcleod-api.ps1 -Rotate` and `-Remove` exist. Backups older than 7 days are deleted by
  the next update run. The Alex message states who on his side holds VM admin."

### OPS-18 [RISK] Business control: who clears stops after MK3, and how dispatchers keep control
- Today dispatchers clear stops in LoadMaster. After MK3 a driver's Complete clears it. Dispatchers lose the
  moment of review (e.g., "driver says delivered but receiver refused part"), and a dispatcher clearing by hand in
  parallel races our write (handled by precheck/verify, R §2.2, but they see two processes).
- Fix text: "MK3 goes live per CUSTOMER list and per stop type, not per kind: first pickups only (no billing
  effect), then deliveries for non-EDI customers, then EDI customers after one week of zero `conflict`. A
  dispatcher-visible marker in McLeod: the integration user name on the stop's audit (`entered_by`/audit user) is
  `S360API` so a dispatcher can see who cleared it; Alex confirms dispatchers know an un-clear path (OPS-1 (2)).
  The office can hold a load from writing (`mcleod_write_holds (load_id)` — or simpler: the existing `conflict`
  path plus a 'do not send' action on the stop badge that settles the queued request `refused office_held`)."

### OPS-19 [GAP] Rate and volume McLeod's app server will see are not stated to McLeod
- Evidence: C §4 parity ≈160 `GET /movements/{id}` per 15 min ≈ 15,000/day (C-21); writes ≈ 99 movements/day ×
  ~2.3 stops (A's measured base, X §1.25) ≈ 230 clears/day, each with 2–3 reads; images later. One in flight,
  ≥ 500 ms apart (C §3.2 rule 6). McLeod is self-hosted on the same box family as LME.
- Fix text: the McLeod message states the peak and daily volume and asks for any limit; MK1 parity reads use the
  loads job's last result (C-21's fix) and only `GET /movements/{id}` for movements whose SQL hash changed, cutting
  parity to ≈ the change rate.

### OPS-20 [OK] Things that hold up operationally
- One copy only: pid + heartbeat lock, heartbeat on a timer (`service.mjs:101-160`); state file atomic with `.bak`
  (`:175-218`); ingest URL https-only, no redirects carry the token (`:37-99`).
- Code integrity on the VM: whole source set of one pinned commit, SHA-256 per file checked before the service is
  stopped, tests run on the VM, full rollback on any failure (`update-connector.ps1:102-219`).
- Time zone: one owner of Central (`centralTime.mjs`, Intl-based, DST pinned by tests); the VM's own clock zone
  does not matter, only its accuracy (NTP — ask Alex to confirm the VM syncs time).
- Logs: one local file `CONNECTOR_LOG`, rolled at 20 MB, no values (C §3.2 rule 9 keeps it so).
- In-DB kill of all agent traffic exists (`org_integrations.enabled`).

### OPS-21 [IMPROVE] Is the integration better than today? Yes, if contained — the risk register
Today: SQL read connector (reviewed, SELECT-only, one connection) + dispatchers type every stop time, every new
hire, every expiry date and file every paper in LoadMaster by hand; 360's driver taps are evidence only.
Gains: one entry instead of two; McLeod's stop times become the driver's real times instead of call-in estimates;
hire/medical lag of 1–3 days ends; documents reach the order the day they are taken.

| # | Risk introduced | Contained by |
|---|---|---|
| 1 | A wrong tap/phone clock writes McLeod and leaves the building (EDI 214, notifications) | OPS-7 bounds; OPS-1 effects list; non-EDI customers first (OPS-18); conflict/verify |
| 2 | Duplicate or replayed writes | R §2.1 no re-send after 2xx; read-before-write; P2/P3 proving |
| 3 | Write credential stolen from the VM or a backup | OPS-11 security profile; OPS-17 separate file; Alex's McLeod-side disable (OPS-3 #1) |
| 4 | Ingest token leak becomes write-queue tampering | OPS-8 write-scoped token + egress IP pin |
| 5 | Office loses control / cannot undo | OPS-1 undo steps; OPS-18 staged rollout + hold action |
| 6 | Alert noise trains people to ignore McLeod findings | OPS-6 storm suppression, quiet `superseded_in_mcleod` |
| 7 | McLeod licence seats / server load | OPS-10 token mode + logout; OPS-19 volume stated |
| 8 | VM single point (dead task, Node drift) | OPS-4 task settings + health carries version; W2 critical |
| 9 | PII leaves McLeod into our DB/logs | OPS-14 allowlisted `observed`, redacted text; SSN strip (OPS-15) |
| 10 | Public repo leaks the new host/ids | OPS-16 gate |
| 11 | Alex's approval scope (read-only mirror, Linux VM, two destinations) silently widened | One Alex message (below), nothing on before his written OK (U17) |

---

## MK0 probe table — every unknown about OUR `/ws`

Rules: all probes run from the VM with the service stopped (`agent.mjs --api-discover`), one call in flight, ≥ 500 ms
apart. **R** = read-only, safe on production. **T** = writes; test company only. **A** = answered only in writing by
McLeod/Alex. Results go to `mcleod_api_discoveries` / `mcleod_api_capabilities` (R §2.1), never the repo.

| # | Unknown | Exact probe | Pass criterion | Build per outcome |
|---|---|---|---|---|
| K1 | `/ws` present on our 22.1; version | R: `GET {WS}/metadata` (no auth); then `GET {WS}/docs/` | 200 JSON with `lmeVersion`, `serviceVersion`; docs 200 | present → MK0/MK1 proceed. 404 → MK1+ wait for McLeod; DB pipeline, routes and agent client merge dark (C U1). `clearStop` absent on our docs → MK3 blocked, no TableRowService fallback without McLeod's written "it runs dispatch logic" (C-32) |
| K2 | Base URL, TLS, cert name | R: TLS handshake from VM to `{host}:443` (Node `tls.connect`, `rejectUnauthorized:true` with the PEM McLeod sent); record subject, SANs, issuer, validity, `fingerprint256` | handshake ok with pinned PEM; fingerprint equals the one McLeod sent (read aloud/compared by a person) | CA chain + DNS → pin leaf, `servername`=host. Self-signed with name → CA_FILE=cert + pin. No usable name → pin-only (refused without pin). `http:` only → blocked; ask for TLS |
| K3 | Auth mode, token lifetime | R: token mode: `GET /movements/search?recordLength=1` with `Bearer`. Login mode: `POST /users/login` (Basic, `Accept: application/json`), record body shape; reuse token on parity reads every 15 min, record time-to-first-401; `POST /users/logout` at end | 200; login returns a token (string or `{token}`) | token → `MCLEOD_WS_AUTH=token`. login → re-login ≤ 1/15 min + logout (OPS-10). Lifetime is informational only |
| K4 | AnywhereCompanyID mapping | R: `/metadata` `company` list; `GET /stops/{id}` for a known TMS stop and a known TMS2 stop (ids from `mcleod_dispatch_stops`) under each candidate header | each stop returned only under its own header, `company_id` field = that company | identity/translated map (C U3). One header sees all → still OK because precheck compares `company_id` (OPS-12) |
| K5 | Roles / security profile of the integration user | R: `/metadata` `currentUser`, `deny`; `GET /auditTransactions/search?recordLength=1`; `GET /billing/...`-family list read expecting 403 | user type `Users`; deny list contains money/order/delete ops; audit 200 or 403 recorded | money reachable → owner ruling before L3 (OPS-11). Audit 403 → U14 audit check off |
| K6 | Date format (`useServerTimezone`) | R: `GET {WS}/docs/types?type=com.tms.common.lib.Date`; `GET /stops/{id}` of a CLEARED stop → raw `actual_arrival` string | page text names `false`/`true`; response string ends `-0600`/`-0500` or has none | `MCLEOD_WS_DATE_MODE=offset|server_central` (OPS-13); writes refused until set |
| K7 | Absolute `changedAfterDate`, audit reach | R: `GET /movements/search?changedAfterDate=t-{1,7,30,90}&changedAfterType=Update&recordLength=1`; same with an absolute value in each format (`yyyyMMddHHmmssZ`, `MM/dd/yyyy HHmmss`) | 200 + rows; absolute form accepted | ≥ 7 d → change leg; else parity full-read only, SQL close read never retired (C U5, C-27) |
| K8 | Row cap / offset honoured | R: two pages `recordLength=1000&recordOffset=0|1000`, `orderBy=movement.id+ASC` | page 2's first id > page 1's last id | else parity walks SQL's id list (C-33) |
| K9 | RowStop / RowDriver / RowTractor / RowTrailer / RowCallin keys | R: OUR type pages (`types?type=…RowStop` etc.) — not one sample row (nulls omitted, WS W4) | every key the adapters use is listed | missing key → that adapter/field dropped by the one capability row |
| K10 | Status-code semantics | R: `GET /stops/NOSUCHID0` (404?), `GET /nosuchpath` (404?), bad token (401) | distinct, documented in capabilities | wire C-29's 403/404 rules to what we saw |
| K11 | `GET /drivers/new` defaults incl. SSN key | R: `GET /drivers/new` — record KEY NAMES only, values discarded on the VM | key list stored | SSN key present → strip (already designed, OPS-15) |
| K12 | Webhooks | R: services index; RemoteNotificationService page (500 on tms-map) | none | polling only (C U7) |
| K13 | `clearStop` both dates on a clean stop; read-back; who is recorded | T: P1 on test company stop; read back `actual_*`, audit row `user_id` | `confirmed`; times equal at minute; audit user = integration user | as R §2.2 |
| K14 | Departure-only accepted? | T: clean stop, `departureDate` only | 2xx/4xx recorded | 2xx → `arrival_unknown` path may send departure only; 4xx → `refused arrival_unknown` (A §6.1) |
| K15 | Second call on a cleared stop | T: replay P1 by hand with a different minute | refused / overwritten / ignored | precheck already prevents it; overwritten → precheck is the ONLY guard, stated in help text |
| K16 | Out-of-order clear | T: clear stop 2 while stop 1 open | refused / clears both / clears 2 only | refused → enqueue requires prior stops cleared in our mirror; clears both → forbidden, office exception |
| K17 | Late stop → service failure / delay-code demand | T: stop with appointment in the past, `isReportable=false`, no `delayCode` (O-4); then `GET /serviceFailures?stop…` | refusal text or SF row recorded | refusal → `needs_delay_code` regex from the real text; SF created → `isReportable=false` verified on it; count reported to Alex |
| K18 | Downstream effects (EDI 214, billing, settlements, status) | A + T: Alex answers OPS-1 list; on test company observe movement/order status after last-stop clear | written answer filed | gates MK3 canary (OPS-1) |
| K19 | Image staging vs stored | T: `POST /images/O/{order}/{type}` PDF; `GET /images/O/{order}` immediately and after 30 min | listed immediately = stored; later = staged | stored → `filed_seen_at` from first list; staged → poll window per D-19 |
| K20 | `drivers/create` required fields; SSN refusal | A (mandatory-field list for driver) + T (create without SSN on test company) | answer + 2xx/4xx | refused naming SSN → `driver_create` stays off, office enters in McLeod (D-59) |
| K21 | Field writability (TableRowService) | A (McLeod: which fields of stop/driver/tractor/trailer accept update) + T (update one field, read back) | value persists | non-writable → field out of capability row |
| K22 | Call-in `new_eta` moves stop ETA (O-8) | T: `PUT /callins/create` with `new_eta`, `current_stop_id`; read `GET /stops/{id}` `eta` | `eta` = sent | yes → call-in; no → RowStop `eta` via TableRowService (O-8 as ruled) |
| K23 | Licence seat / session per login | A (McLeod) + R (count sessions in LoadMaster user monitor before/after a login, Alex reads it) | no seat, or seat released on logout | seat held → token mode mandatory |
| K24 | Rate tolerance | R: parity week at 500 ms; record any 429/5xx | none | else raise `WS_MIN_INTERVAL_MS` (C U15) |

**Unknowns with NO safe production probe** (K13–K17, K19–K22): every write. Safe route, in order: (1) McLeod's
test company/server (E5); (2) McLeod's written answer, which lets us BUILD but not switch on; (3) only for
`stop_clear`, and only with the owner's S2 sign-off and Alex's written OK, the live-company canary of OPS-2 on a
non-EDI test customer. Never: `drivers/create`, TableRowService updates or image upload on the live company as a
probe. Also never "probe" a write endpoint on production with a fake id to read its 403/404 — it is still a write
call the role may be allowed to make.

---

## ONE message to Alex — complete item list

1. **What changes in the posture you approved on 2026-09-24.** 360 stops being only a read-only mirror: through
   McLeod's API (never SQL), it will (a) clear stops when a driver completes them, (b) file papers to the order,
   (c) create a new hire's driver record and update medical-card/CDL expiry, termination/rehire, (d) set truck/
   trailer in/out of service, (e) write an ETA. Each is off until proven on a test company and switched on
   separately; SQL login `silvicom_dispatch_ro` stays SELECT-only. We ask for your written OK on this scope.
2. **The VM, as it really is.** It is the Windows Board VM (task "Silvicom 360 connector", SYSTEM), not the Linux VM
   in your note. Confirm: who on your side holds admin on it; that its clock syncs time (NTP); that the task
   restarts on failure (we send `register-connector-task.ps1 -Check` to read it).
3. **Network egress, complete list:** LME `10.0.1.171:1433` (unchanged); HTTPS 443 to `api.360.silvicominc.com`
   (replaced `fleetguardapi-production.up.railway.app` on 2026-10-27 — please confirm your firewall record); NEW:
   HTTPS to the McLeod `/ws` host on the LAN (host from McLeod). Still nothing inbound.
4. **Secrets:** the McLeod API credential is typed by a person at a hidden prompt into its own file
   (`mcleod-ws.env`, SYSTEM + Administrators only), separate from `connector.env`; it never leaves the VM, never
   appears in a log or in our repository. You may hold it instead of us.
5. **The integration user in LoadMaster** (McLeod creates it, you set its security): web-user type `Users` only;
   security profile that denies billing, settlements, deductions, payroll, wires, order entry and every delete;
   name it so a dispatcher recognises it on a stop's history (e.g. `S360API`).
6. **How you stop it instantly, without us:** (a) disable that user (or delete its API token) in LoadMaster — every
   call stops at once; (b) on the VM: `set-mcleod-api.ps1 -Writes off` (writes only) or stop the task (everything).
   Our side: per-operation switch (seconds) and the API master switch.
7. **Stop clearing — what it does in YOUR LoadMaster** (we need this in writing before the first live write):
   which of these a clear triggers, per pickup/delivery and first/last stop: movement/order status, EDI 214 to the
   shipper, customer notifications, ready-to-bill/billing queue, driver pay/settlement, tractor location/hub,
   service failure when late (we send `isReportable=false`, no delay code); and the exact LoadMaster steps to
   undo a wrong clear, including after a 214 went out and after ready-to-bill.
8. **Dispatch process:** after go-live a driver's Complete clears the stop. Rollout order we propose: pickups first,
   then deliveries for non-EDI customers (please list which customers are EDI), then EDI customers. Dispatchers can
   still clear by hand; 360 never overwrites a time McLeod already has.
9. **Test company:** is there a write-capable test company or server with copies of drivers/tractors/customers? If
   not, for the stop write only: a test customer with no EDI partner and no notification contacts, non-billable;
   a driver `S360TEST` excluded from settlements; a yard tractor; one test order with two yard stops; and you
   rehearse the undo once by hand before our first call. Driver create, record updates and image upload are never
   tried on the live company.
10. **Volume on McLeod's app server:** ≤ 2 calls per second, one at a time; ≈ 230 stop clears/day plus 2–3 reads each;
    a parity read during the trial week of ≈ the number of changed movements per 15 min (not the whole board).
    Parity reuses the existing open-loads statement's last result — no new SQL and no new cadence. If any of that
    changes, we send the SQL file first, as agreed.
11. **Logs:** unchanged rule — counts, times, McLeod ids; no addresses, licence numbers or McLeod's message text in
    the VM log.
12. **SQL grants still owed (from the other plans, so this is the only message):** Parts 2/3/4/5 of
    `SILVICOM-GRANTS.sql` incl. `drs_check` and `gl_summary`; Part 2 re-run on `lme_analytics` for the finance
    comparison night; the test-company read (SELECT on the same tables for the test company, if it lives in `lme`);
    the reference-number routine review (B's file) with its apply-after date.
13. **Order of visits** (each one we prepare, you or Miki run): code update with everything off → API settings +
    discovery (read-only) → parity on → writes on for the test company → (after your OK on item 7 and the owner's
    sign-off) the first live operation.

## ONE message to McLeod (via Ron) — complete item list

1. Enable the Direct-Hosted `/ws` API on our self-hosted LoadMaster **22.1** production and on a test company/
   server; if 22.1 cannot, say what version is needed.
2. The `/ws` base URL; its TLS certificate (PEM) and SHA-256 fingerprint, and whether the name on it is a DNS name;
   the value of `loadmaster.ws.useServerTimezone`; `loadmaster.api.maxresultsize`.
3. `AnywhereCompanyID` for each of our companies TMS, TMS2, TMS3, TMS4 and the test company; is it `company.id` or
   the instance code?
4. A dedicated integration web user of type `Users`, with no other type. Does LoadMaster user security (menu/
   table permissions) apply to `/ws` calls made by that user? Can it be denied billing, settlement, deduction,
   payroll, wire, order entry and all deletes while keeping the operations in item 5?
5. Operations that user must reach (full list): reads `GET /metadata`, `/movements/search`, `/movements/{id}`,
   `/stops/{id}`, `/auditTransactions/search`, `/drivers/new`, `/drivers/{id}`, `/drivers/search`, `/tractors/{id}`,
   `/trailers/{id}`, `/images/{rowType}/{rowId}`, `/images/{rowType}/{rowId}/documentTypes`,
   `/serviceFailures`; writes `POST /dispatch/clearStop/{id}`, `POST /images/{rowType}/{rowId}/{documentTypeId}`,
   `PUT /drivers/create`, `PUT /driver/update`, `PUT /tractors/update`, `PUT /trailers/update`, `PUT /stop/update`,
   `PUT /callins/create`, `PUT /equipstatus/create` (as `Users`, since EquipStatusService is Drivers-only);
   `POST /users/login|logout`.
6. Auth: Smartphone Mobile Service token or `/users/login`? Token lifetime? Does a login hold a concurrent licence
   seat, and what `X-com.mcleodsoftware.LicensingAgent` value should an integration send?
7. `clearStop` behaviour: departure-only accepted? must the stop be the next uncleared one? second call on a cleared
   stop? late stop with no `delayCode` — refused, or service failure auto-created? does it run the same logic as a
   dispatcher's clear in LoadMaster (status, EDI 214, notifications, billing, pay)? HTTP codes and the text of a
   refusal.
8. Is there any `/ws` way to un-clear a stop? (We expect no; then the LoadMaster steps.)
9. TableRowService: which fields of `stop`, `driver`, `tractor`, `trailer` accept updates; does `PUT /stop/update`
   with `eta` run dispatch logic; any optimistic-concurrency check.
10. `drivers/create`: required fields on our install (mandatory-field settings), is `social_security_no` required —
    we will never send it.
11. Images: on our install does `POST /images/...` store immediately or stage for a batch, and how long until it is
    visible; may we read our own `/ws/docs` pages for our tests (we will not redistribute them).
12. Audit: is audit on for `movement` and `stop`, days to keep, and `audit_log_tx` purge (docs say one day).
13. Webhooks/events: any on 22.1 (RemoteNotificationService page returns 500 on the public docs)?
14. Rate: any limit on calls; our plan is ≤ 2/s, one at a time, ≈ 1,000 calls/day.
15. Symphony licensed on our install? (affects home time only)

---

## Summary

Counts: BLOCKER 2 (OPS-1, OPS-2) · WRONG 2 (OPS-3, OPS-12) · GAP 8 (OPS-4, 5, 9, 10, 11, 13, 17, 19) · RISK 6 (OPS-6, 7, 8, 14, 16, 18) · OK 2 (OPS-15 with fixes, OPS-20) · IMPROVE 1
(OPS-21). MK0: 24 probes (12 read-only safe on production, 9 test-company-only writes, 3 written-answer-only).

Top 10:
1. OPS-1 — No spec knows what `clearStop` does beyond two dates (EDI 214, billing, pay, status, service failures),
   and `/ws` has no un-clear; MK3 canary must wait for Alex's written effects list and undo steps; non-EDI first.
2. OPS-2 — The live-company canary needs a no-EDI, non-billable test customer and a rehearsed undo; driver create,
   updates and image upload are never probed on live.
3. OPS-8 — The single `fgtms_` ingest token would authorise claiming and settling McLeod writes; add a write-scoped
   token and pin claim/settle to the VM's egress IP.
4. OPS-3 — "L1 in seconds" is wrong on AWS; the real instant kill is Alex disabling the McLeod integration user —
   tell him first; L2/L3/L1/token switches listed with real latencies.
5. OPS-11 — `/ws` roles are web-user types; `Users` reaches billing, settlements and generic DELETE. Ask McLeod
   whether LoadMaster user security applies and deny money/delete; Users-only, never Drivers/Symphony.
6. OPS-7 — Phone clock times go into McLeod unbounded; bound `occurred_at` at enqueue.
7. OPS-6 — Outage behaviour: per-request alert storms, the 72-h stale rule mislabels already-applied writes, and
   post-outage manual clears become conflict noise.
8. OPS-14/15 — `observed` and McLeod's refusal text carry PII (RowDriver incl. SSN, stop directions); allowlist
   `observed`, redact text on the VM; SSN strip belongs in the client's `write()` with a gate.
9. OPS-4/5 — The VM task's restart policy is not in the repo, and `update-connector.ps1` cannot add the new lines
   and reports SUCCESS on a broken `/ws` half.
10. OPS-16/12 — The public repo already holds LME IP (18 files), server name, login, db names and Alex's mail (no
    password — verified); the Kit must add nothing (new gate). U3's company-id probe is free via `/metadata` and
    must not block MK3 on a misreading.
