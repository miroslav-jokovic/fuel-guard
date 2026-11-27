# C — McLeod API transport: MK0 (enable + client + discovery), MK1 (read parity), and the write pipeline

**Status:** BUILD SPEC, 2026-11-19, written against `origin/main` at `cc590a62b`
(`/Users/miroslavjokovic/Projects/FG-mcleod-api`). Nothing below is built. It implements the rulings in
`docs/plans/mcleod/MCLEOD-API-KIT-PLAN.md` (Q-MK1 = (a), D-MK1, D-MK3) and is bound by the verified surface
in `docs/plans/mcleod/MCLEOD-API-SURFACE-2026-11-19.md`.

**Prefixes.** Decisions in this spec: **D-MKT1…** (transport). Unknowns are the plan's **B-MK1…B-MK10**;
each is closed by the discovery procedure in §7 and resolved by its decision table into exactly one build
consequence. Owner sign-off is required at the two named moments in §9 only.

**Ruled, and not reopened here.**
1. API calls run from the on-prem connector on Alex's outbound-only Windows VM. It **pulls** queued write
   requests from our API over HTTPS, calls McLeod Direct-Hosted `/ws` on the LAN, and **posts results back**.
   Nothing connects inbound to the VM or to the LAN (Alex, `docs/plans/mcleod/mail.md:36-42`).
2. Writes go only through `/ws`, never SQL. The SQL login stays `SELECT`-only (`connection.mjs`).
3. No live write before it has passed on a McLeod test company (D-MK3) — machine-enforced in §5.9.
4. One append-only-friendly write-request table, keyed by the client action id; states
   `queued → sent → confirmed | refused | conflict` (D-MK1). Our evidence row is written first and never
   depends on McLeod.

**Verified surface (from MCLEOD-API-SURFACE-2026-11-19.md) the design uses — every item re-confirmed on OUR
`/ws/docs` at MK0 (§3.5), never assumed:**
- Auth: HTTP Basic, or a token (`Authorization: Bearer|Token <t>`) from LoadMaster "Smartphone Mobile
  Service" or from `POST /users/login` with Basic. **Token expiry undocumented** → handled by re-login on 401.
- Every call: `Authorization`, `Accept: application/json` (XML is the default), `AnywhereCompanyID`.
- Paging `recordLength`/`recordOffset`, **1,000-row cap** (raised only by `-Dloadmaster.api.maxresultsize`).
- `changedAfterDate` + `changedAfterType` (`Add`|`Update`), bounded by the audit "days to keep".
- **No webhooks on `/ws`** → polling only.
- `AuditTransactionService GET /auditTransactions/search` (R).
- Writes: **`POST /dispatch/clearStop/{stopId}`** (`arrivalDate`, `departureDate`, …; response
  `text/plain`), `POST /images/{rowType}/{rowId}/{documentTypeId}`, `PUT /drivers/create`,
  `TableRowService PUT /{table}/update`, `PUT /tractors/update`, `PUT /trailers/update`.
- `POST /dispatch/{stopId}/arrive|depart` is **LTL-only** — not used.

---

## 1. The shape (D-MKT1)

```
 driver app ──outbox(client action id)──▶ API ──RPC (evidence: load_events)──▶ Postgres
                                            └─▶ mcleod_write_enqueue(...)  ──▶ mcleod_write_requests (queued)
 VM connector (--service)                                                      ▲
   job "writes" every 15 s:  POST /api/tms/mcleod-api/writes/claim ────────────┘  (lease 120 s, ≤5 rows)
     for each request: adapter.precheck  → GET  /ws/stops/{id}         (read-before-write)
                       adapter.apply     → POST /ws/dispatch/clearStop/{id}?arrivalDate=…
                       adapter.verify    → GET  /ws/stops/{id}         (read-after-write)
                       POST /api/tms/mcleod-api/writes/{id}/settle  {attempt, outcome, observed}
   job "loads" every 60 s (unchanged SQL board read) brings McLeod's actual_arrival back into
   mcleod_dispatch_stops → load_stops.actual_arrival_at  (McLeod is the truth once it accepts, Q-MK3)
```

**D-MKT1 — one door per protocol.** `connection.mjs` is the only door to LME SQL; a new
`tools/mcleod-agent/mcleodApi.mjs` is the only door to `/ws`. `check-agent-syntax.mjs` enforces both (§3.3).
**D-MKT2 — delivery is at-least-once; the EFFECT is exactly-once by read-before-write.** A lease that
expires is re-claimable, and every apply is preceded by a read of McLeod's current value, so a crash after
McLeod accepted resolves to `confirmed` on the next claim without a second write (§5.7).
**D-MKT3 — three independent locks on every write**, all default OFF: API env `MCLEOD_API_WRITES`, the
org's per-kind switch row (`off | test | live`, `live` only after a proven test run), and the connector's
`MCLEOD_API_WRITES=on` line. Any one off → no McLeod write (§5.9).

---

## 2. Files touched (summary; detail in each section)

| Area | New | Changed |
|---|---|---|
| Agent | `mcleodApi.mjs`, `mcleodApi.test.mjs`, `apiDiscover.mjs`, `apiDiscover.test.mjs`, `apiParity.mjs`, `apiParity.test.mjs`, `writeLoop.mjs`, `writeLoop.test.mjs`, `writeAdapters.mjs`, `writeAdapters.test.mjs`, `fakeMcleod.mjs` (test-only server) | `agent.mjs` (CFG.mcleod block :180-197; `fetchFromMcleod` :333-470 moves into `mcleodApi.mjs`; `runService` feeds :1007, jobs :1015; new `--api-discover` flag), `schedule.mjs` (JOBS + `serviceJobs`), `service.mjs` (`serviceConfigProblems` :236), `connector.example.env`, `README.md`, `review/CONNECTOR-ON-THE-VM.md` |
| VM scripts | `windows/set-mcleod-api.ps1`, `windows/set-mcleod-api.test.ps1` | `windows/update-connector.ps1` (manifest regenerated by `windows/manifest.mjs`; nothing else) |
| Gates | — | `scripts/check-agent-syntax.mjs` (`AGENT_RULES` :71), `scripts/table-modules.json`, `scripts/table-writers.json`, `apps/api/src/modules/org/dataRetentionPolicy.ts` (parity rule), `dataRetentionForbidden.ts` (two evidence tables), `supabase/schema.generated.sql` (regenerated) |
| DB | `supabase/migrations/<next>_mcleod_api_transport.sql` (number = main's newest + 1 at merge; 0637 today) | — |
| Shared | `packages/shared/src/mcleodApi.ts` (+ `.test.ts`) — `tms.ts` is at 499/500 lines, so nothing is added there | `packages/shared/src/mcleodLoadProjection.ts` (export `parseMcleodLoadExternalId`, the inverse of the `${company_id}:${movement_id}` built at :240), `packages/shared/src/index.ts` |
| API | `modules/mcleod/mcleodApi/{discovery,health,parity,writeQueue,writeSwitches,writeWatch}.ts` + tests, `modules/mcleod/routes/tmsMcleodApi.ts` (agent side), `modules/mcleod/routes/mcleodApiControl.ts` (office side), `orchestration/driverStopToMcleod.ts` | `modules/mcleod/routes/tmsIngest.ts` (one `registerTmsMcleodApiRoutes(router)` line beside :126), `modules/mcleod/index.ts`, `routes/integrations.ts:21` (register control routes), `envCollectors.ts`, `schedulers.ts` (one entry after :92), `modules/driver-app/routes/me.ts` (stop route calls the orchestration) |
| Web | `components/McleodApiHealthLine.vue` (+test), `composables/useMcleodApiHealth.ts`, `components/McleodWriteSwitches.vue` (+test), `components/StopMcleodWriteBadge.vue` (+test) | `pages/McleodFleetsSettingsPage.vue` (the only McLeod settings page — `router/routes/settings.ts:16`), the load detail's stop row |
| Tests | `supabase/tests/mcleod-write-queue.test.mjs` | `supabase/tests/rls.test.mjs` (hand seeds) |

`tools/**` is outside `lint:filesize` (`SCAN_DIRS = ["apps","packages"]`, `check-file-size.mjs`), but every
new agent file is held to the same 450/500 budget by review — `agent.mjs` is already 1,156 lines and gains
only flag wiring (≤ 40 lines).

---

## 3. MK0 — enable `/ws`, the client module, discovery, health

### 3.1 Enablement checklist (Alex + McLeod). One message each (memory: IT requests are one complete list)

Sent as ONE email to Ron (McLeod) and ONE to Alex. Each line has the evidence that closes it.

| # | Who | Item | Evidence that closes it | Closes |
|---|---|---|---|---|
| E1 | McLeod | Enable Direct-Hosted `/ws` on our LoadMaster **22.1** production **and** on the test company/database; state whether 22.1 supports it or the 26.x upgrade is required | `GET https://<host>/ws/docs/` answers 200 from the VM | B-MK2 |
| E2 | McLeod | The `/ws` base URL, its TLS certificate (chain or self-signed), and whether the name on it is a DNS name | the URL + PEM file | B-MK3 |
| E3 | McLeod | `AnywhereCompanyID` for each of TMS, TMS2, TMS3, TMS4 and for the test company | a 4-5 row table | B-MK3 |
| E4 | McLeod | A **dedicated integration user** with the least role that can call: `GET /movements/search`, `GET /movements/{id}`, `GET /stops/{id}`, `POST /dispatch/clearStop/{id}`, `GET /auditTransactions/search` (later: `/images`, `/drivers/create`, `/tractors/update`, `/trailers/update`). Say whether a custom role is possible or only the stock `Users` role | user name; role name; list | B-MK4 |
| E5 | McLeod | A **write-capable test company** (or test server) with copies of our drivers/tractors/customers, or say there is none | company id + URL, or "none" in writing | B-MK5 |
| E6 | McLeod | Audit "days to keep" for `movement` and `stop`, and whether audit is on for both; current `maxresultsize` | two numbers | B-MK6 |
| E7 | McLeod | Confirm no webhook/event service on 22.1 `/ws` (surface doc says none) | yes/no | B-MK7 |
| E8 | McLeod | Symphony licensed? | yes/no | B-MK8 |
| E9 | McLeod | `clearStop`: date format, time zone of `arrivalDate`, arrival-only allowed?, behaviour on an already-cleared stop, required service-failure fields when late | doc page or answer | §7 U9-U11 |
| A1 | Alex | Written OK for **API writes** from the VM, scoped to the D-MK2 list, with the three-lock design and the test-company rule | his email | B-MK9 |
| A2 | Alex | Outbound 443 from the VM to the `/ws` host on the LAN (firewall); no inbound rule | `--api-discover` reaches it | — |
| A3 | Alex | Approval to put the McLeod token/password into `connector.env` by the hidden-prompt script (§6) | he runs it | — |

### 3.2 `tools/mcleod-agent/mcleodApi.mjs` — the only door to `/ws`

Pure where possible; all I/O injected (`requestImpl`, `now`, `sleep`, `log`) so `mcleodApi.test.mjs` drives
every branch against `fakeMcleod.mjs` (a `node:https` server with a self-signed test cert generated at test
time by `node:crypto`, no fixtures on disk).

**Configuration (connector.env; read once in `agent.mjs` CFG.mcleod, replacing :180-197):**

| Key | Required | Meaning |
|---|---|---|
| `MCLEOD_WS_URL` | yes | `https://<host>/ws` — `http:` refused at start (`validateWsUrl`, the twin of `validateIngestUrl`, `service.mjs:38`); no credentials, no query |
| `MCLEOD_WS_AUTH` | yes | `token` or `login` (no default — the operator types which) |
| `MCLEOD_WS_TOKEN` | if `token` | static token from Smartphone Mobile Service |
| `MCLEOD_WS_USERNAME` / `MCLEOD_WS_PASSWORD` | if `login` | integration user; the token from `POST /users/login` lives in memory only, never on disk |
| `MCLEOD_WS_CA_FILE` | yes | PEM of the server certificate or its issuing chain (path beside the code) |
| `MCLEOD_WS_CERT_SHA256` | yes | SHA-256 fingerprint of the leaf, colon or plain hex; **pinned** |
| `MCLEOD_WS_SERVERNAME` | if the URL host is an IP | the DNS name on the certificate (same rule as `MCLEOD_SQL_SERVERNAME`, `connection.mjs:68-84`) |
| `MCLEOD_WS_COMPANIES` | yes | `ourCompany=AnywhereCompanyID` pairs, e.g. `TMS=TMS,TMS2=TMS2,TEST=TMSTEST`. The API names `company_id` in OUR vocabulary (`dbo.company.id`); this map is the one translation |
| `MCLEOD_WS_WRITE_COMPANIES` | for writes | subset of the map's keys the connector may WRITE to; a claimed request for any other company is settled `refused` (`company_not_allowed`) without a call |
| `MCLEOD_API_FEED` | — | `on` runs MK1 parity; missing = off (LUMPER_FEED pattern, `schedule.mjs` `serviceJobs`) |
| `MCLEOD_API_WRITES` | — | `on` runs the `writes` job; missing = off |

**Request function — exact shape:**

```js
// mcleodApi.mjs
export const WS_READ_TIMEOUT_MS = 15_000;   // McLeod's own SQL cap is 15 s (connection.mjs); a /ws read is a read
export const WS_WRITE_TIMEOUT_MS = 30_000;  // clearStop runs dispatch logic + service-failure check
export const WS_MIN_INTERVAL_MS = 500;      // ≤ 2 calls/s, ONE in flight (the SQL letter's courtesy, applied to /ws)
export const WS_BREAKER_THRESHOLD = 3;      // consecutive transient failures
export const WS_BREAKER_PAUSE_MS = 15 * 60_000;
export const WS_PATH_ALLOWLIST = [          // the token's breadth is bounded by OUR code (§7 U4)
  { method: "GET",  re: /^\/movements\/search$/ },
  { method: "GET",  re: /^\/movements\/[A-Za-z0-9]+$/ },
  { method: "GET",  re: /^\/stops\/[A-Za-z0-9]+$/ },
  { method: "GET",  re: /^\/auditTransactions\/search$/ },
  { method: "POST", re: /^\/users\/login$/ },
  { method: "POST", re: /^\/dispatch\/clearStop\/[A-Za-z0-9]+$/ },
  // MK4/MK5 lines are added in the PR that adds their adapter, never ahead of it.
];
export class WsRefused extends Error {}      // 400/403/404/409/422: McLeod said no — never retried
export class WsAuthFailed extends Error {}   // 401 after one re-login
export class WsTransient extends Error {}    // network, timeout, 429, 5xx
export function createMcleodApi({ cfg, requestImpl = httpsRequest, now = Date.now, sleep, log }) {
  // returns { get(path, query, { company }), write(method, path, query, body, { company }), breakerState(), health() }
}
```

**Rules inside `createMcleodApi`:**
1. **TLS.** One `https.Agent({ ca: readFileSync(MCLEOD_WS_CA_FILE), servername, rejectUnauthorized: true,
   checkServerIdentity })`. `checkServerIdentity(host, cert)` first runs `tls.checkServerIdentity` (unless
   the certificate has no usable name — §7 U2), then requires `cert.fingerprint256` (normalised) to equal
   `MCLEOD_WS_CERT_SHA256`. A mismatch is `WsAuthFailed("certificate pin mismatch")` — health `tls_pin`,
   writes stop. `rejectUnauthorized: false` appears nowhere (gate rule, §3.3). Built on `node:https`, not
   `fetch`, because undici's `fetch` takes no per-request CA without a dispatcher dependency.
2. **Headers on every call:** `Accept: application/json`, `AnywhereCompanyID: <map[company]>`,
   `Authorization`. `User-Agent: Silvicom360-connector/<version>` (no person, no org name).
3. **Auth.** `token` mode: `Bearer <token>`. `login` mode: on first call, `POST /users/login` with Basic,
   `Accept: application/json`; the answer (string or `{token}` — both handled, test-pinned) is held in a
   closure. **401 handling:** `login` mode → drop the token, log in once, repeat the call once; a second 401
   → `WsAuthFailed`. `token` mode → `WsAuthFailed` at once (a static token cannot be refreshed). After
   `WsAuthFailed` the client refuses every call for 15 minutes (no hammering a locked account) and health
   says `auth_failed`.
4. **Responses.** JSON when `content-type` is JSON; `text/plain` kept as a string (dispatch writes answer
   text/plain). A write is accepted on **2xx only**; its text is returned to the caller, capped 500 chars.
5. **Retry/backoff** (reads only; a write is NEVER retried inside the client — §5.7 resolves it by reading):

   | Outcome | Read | Write |
   |---|---|---|
   | network error / timeout / 502-504 / 429 | retry 1 s, 2 s, 4 s, then `WsTransient` | `WsTransient` immediately (effect unknown) |
   | 500 | as above | `WsTransient` (effect unknown) |
   | 401 | per rule 3 | per rule 3 |
   | 400/403/404/409/422 | `WsRefused(status, text)` | `WsRefused(status, text)` |
   | 429 `Retry-After` | honoured, capped 60 s | `WsTransient` with `retryAfterMs` |

6. **Rate limit.** A single promise chain: the next call starts ≥ 500 ms after the previous ENDED, one in
   flight. No concurrency anywhere — `fetchFromMcleod`'s 6-way detail hydration (`agent.mjs:388-397`) is
   removed when it moves here.
7. **Breaker.** Three consecutive `WsTransient` open it for 15 minutes; `breakerState()` mirrors
   `connection.mjs` so `runService` logs it the same way (`agent.mjs:1036-1038`).
8. **Path allowlist.** A call whose method+path matches no `WS_PATH_ALLOWLIST` entry throws before any
   byte leaves (`WsRefused("path not allowed")`).
9. **Logging (mail.md:57 — "counts, times and McLeod ids. No addresses or licence numbers").** The client
   logs one line per call: `ws <METHOD> <path template> <status> <ms>` where the path template replaces ids
   with `{id}` unless the caller passes `logId` (a McLeod id). It never logs query strings, bodies, response
   text, the token, the username or headers. McLeod's refusal text is returned to the caller and travels to
   OUR API in the settle body (stored capped, §5.2) — it is not written to the VM log.

### 3.3 Gate rules (`scripts/check-agent-syntax.mjs`, appended to `AGENT_RULES` at :71)

```js
{ re: /\bAnywhereCompanyID\b|\/users\/login|\/dispatch\/clearStop/,
  why: "a /ws call outside mcleodApi.mjs — one door to McLeod's API (D-MKT1)", except: "mcleodApi.mjs" },
{ re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/,
  why: "TLS verification switched off — pin the certificate instead (D-MKT1)" },
```
`except` today names one file; it becomes `except: string | string[]` (one-line change in the loop at
:118). Each rule is proven by its self-check: add the violation to a scratch file, watch the script fail
(the file's own stated practice, :67). `fetchFromMcleod` moves out of `agent.mjs` in the same PR or the first
rule fails on `agent.mjs:347`.

### 3.4 Secrets on the VM

Same posture as today (`windows/set-connector-line.ps1`): `C:\Silvicom\connector\connector.env`, ACL
`SYSTEM:R`, `Administrators:F`, inheritance removed (`Lock-File`), UTF-8 without BOM. New lines are
written by `windows/set-mcleod-api.ps1` (§6): the token or password is typed at a **hidden prompt** by a
person, never passed as an argument, never printed (masked like `fgtms_***`). The CA file is copied into
`C:\Silvicom\connector\mcleod-ws.pem` with the same ACL. The login-mode token never touches disk.

### 3.5 `node --env-file=connector.env agent.mjs --api-discover`

Read-only; posts nothing but the report; runs with the service stopped or running (it uses `/ws`, not the SQL
connection). Two phases because the docs parser cannot be tested against pages nobody has seen yet:

**Phase A (first run; no parser needed).** For each company in `MCLEOD_WS_COMPANIES`:
1. TLS handshake: record leaf subject, SANs, issuer, validity, `fingerprint256`, and whether it equals the pin.
2. Auth: per `MCLEOD_WS_AUTH`; record `ok | 401 | 403` and, for login mode, whether a token came back.
3. `GET /movements/search?recordLength=1&recordOffset=0&orderBy=movement.id%20ASC` → status, `content-type`,
   row count, the JSON key list of the row (keys only — no values).
4. `GET /movements/search?changedAfterDate=t-<d>&changedAfterType=Update&recordLength=1` for
   d ∈ {1, 7, 30, 90}: status and whether rows come back → the effective audit reach (B-MK6), measured.
5. `GET /stops/{id}` for the first stop of the movement in (3) → key list only (the RowStop field names U12).
6. `GET /auditTransactions/search?recordLength=1` → status (403 = not granted).
7. Docs crawl: `GET /ws/docs/`, `/ws/docs/auth`, the services index and each service page it links, the
   types pages for `RowStop`, `RowMovement`, `RowTractor`, `RowTrailer`, `RowDriver`; at most 200 pages, one
   at a time at the rate limit. Each page: URL, status, bytes, sha256. Pages are McLeod's documentation, not
   data, so the raw HTML is gzipped and sent (≤ 8 MB total).
8. Response `Server` header and any version string on `/ws/docs/` (B-MK2: which `/ws` we actually run).

**Phase B (after the parser lands).** Same command; additionally parses the stored pages into
`{ service, operation, method, path, roles[], params[], produces[] }` with `docsParser.mjs`, whose tests use
the Phase-A pages of OUR install as fixtures (copied from the discovery row by
`pnpm mcleod:ws-docs-fixtures <discovery id>` — a new root script that writes them under
`tools/mcleod-agent/fixtures/ws-docs/`; these are McLeod's docs, no carrier data). Then it compares against
`tools/mcleod-agent/wsSurface.mjs` — the operations this repo depends on, one entry per kind and feed:

```js
export const REQUIRED_SURFACE = {
  "mk1.movements": [["GET", "/movements/search"], ["GET", "/movements/{id}"]],
  "write.stop_arrival":   [["GET", "/stops/{id}"], ["POST", "/dispatch/clearStop/{stopId}"]],
  "write.stop_departure": [["GET", "/stops/{id}"], ["POST", "/dispatch/clearStop/{stopId}"]],
  "conflict.audit":       [["GET", "/auditTransactions/search"]],
};
```
Output per entry: `present | absent | present_role_missing`, plus "operations on our install that the surface
doc does not list" and "surface-doc operations absent on our install" (the diff the coordinator asked for).

**Report contract** (`packages/shared/src/mcleodApi.ts`, Zod): `mcleodApiDiscoveryReportSchema` =
`{ agent_version, ran_at, ws_origin_host_hash /* sha256 of host, not the host */, companies: [{ company_id,
auth, search_status, audit_reach_days, row_keys[], stop_keys[], audit_service }], tls: {...}, docs: { pages:
[{ path, status, bytes, sha256 }], gz_base64? }, surface: [{ key, verdict }] | null, version_text | null }`.
Posted to `POST /api/tms/mcleod-api/discovery` (body limit raised to 12 MB on that route only). The CLI prints
the same verdict table to stdout (no values, no hosts).

### 3.6 Health, surfaced like the freshness stamps

**Not** `org_integrations`: it is owned by `org` (`table-modules.json:2502`), and the McLeod module's two
writers of it are grandfathered out-of-owner sites that may not grow (`lint:table-modules`). A new mcleod-owned
row instead: `mcleod_api_agent_status` (§5.2), one row per org, updated by every agent call:

- `POST /api/tms/mcleod-api/health` (each service cycle that ran an API job, and every claim): `{ agent_version,
  instance_id, ws: { last_ok_at, last_error_class: null|transient|auth_failed|tls_pin|refused, breaker_open_until },
  writes_enabled_on_vm, parity_enabled_on_vm }`.
- `GET /api/mcleod/api-health` (`requireOrg`, `requireAnySection(["dispatch","view"],["admin","view"])`) →
  `McleodApiHealth = { configured, lastOkAt, lastClaimAt, errorClass, writesOnVm, queue: { queued, oldestQueuedAt,
  conflicts7d, refused7d } }`.
- Web: `McleodApiHealthLine.vue`, the `RosterFreshnessLine.vue` pattern — "McLeod API reached 2 min ago" /
  caution colour after 10 minutes / danger with the error class in words ("McLeod rejected the integration
  login"). Shown on `McleodFleetsSettingsPage.vue` and above the dispatch board's stop list.
- `/api/version` is NOT extended: it is a public deploy probe (`routeLedger.ts:27`) and must not reveal a
  carrier's integration state.

---

## 4. MK1 — read parity (movements through `/ws` beside SQL)

**Purpose.** Prove the API returns what SQL returns before any SQL read is retired. SQL stays the source of
everything the store holds for the whole of MK1; the API read writes NOTHING into the mirror.

**Agent job `api_parity`** (`schedule.mjs` JOBS, after `close`: `{ name: "api_parity", everyMs: 15 * 60_000 }`,
scheduled only when `MCLEOD_API_FEED=on` — `serviceJobs` gains `apiFeed`, default off like lumper):
1. Run the existing open-board SQL read (the statement `serviceLoads` already sends — no new SQL, so the
   reviewed routine is unchanged) and keep `{movement_id → status, stop_id → (status, actual_arrival,
   actual_departure, movement_sequence)}` in memory.
2. Read the same set through `/ws`: `GET /movements/search?orderBy=movement.id ASC&recordLength=1000&
   recordOffset=k·1000&<open-status filter>` until a page < 1000 rows; then `GET /movements/{id}` for each id
   (one at a time, 500 ms apart: 160 movements ≈ 90 s, inside the 15-minute cadence). **Ordering by id
   ascending** makes offset paging stable under inserts (new movements sort last); a row lost to a delete
   mid-walk is re-read next cycle.
3. Change-read leg: `GET /movements/search?changedAfterDate=<watermark − 10 min>&changedAfterType=Update`
   paged the same way. The watermark is the START time of the previous successful leg (Central wall time via
   `centralTime.mjs`), stored in `service-state.json` under `apiParity.watermark`. If the watermark is older
   than `audit_reach_days − 1` (measured by discovery, §3.5 step 4), the leg is skipped and reported as
   `change_read: "beyond_audit"` — never silently trusted.
4. Diff per movement and per stop on the compared fields: movement status, tractor, trailer1, driver1, stop
   status, stop actual arrival/departure (minute precision, Central), stop sequence. A mismatch is re-read
   once from BOTH sources; one that agrees on re-read is `in_flight` (changed between reads), not a mismatch.
5. Post counts and McLeod ids only to `POST /api/tms/mcleod-api/parity`:
   `{ company_id, feed: "movements", ran_at, sql_count, api_count, matched, mismatched, in_flight, only_sql,
   only_api, field_mismatch: {field: n}, sample_ids: [≤50 movement/stop ids], page_cap_hit: bool,
   change_read: "ok"|"beyond_audit"|"skipped", change_rows }`.

**Retirement rule (per feed; D-MKT4).** A SQL read is retired only when ALL hold, computed by
`GET /api/mcleod/api-parity/verdict?feed=movements` from `mcleod_api_parity_runs`:
- 7 consecutive Central days, each with ≥ 90 % of its 96 scheduled runs present;
- `mismatched = 0`, `only_sql = 0`, `only_api = 0` on every run of those days (in-flight allowed);
- `page_cap_hit = false` on every run and `change_read = "ok"` on ≥ 95 % of runs;
- discovery's measured audit reach ≥ 7 days (an outage longer than the reach would lose changes; 7 days is
  the longest VM outage we plan around — a longer one triggers the full open-board re-read, which exists).
Then, in one PR: the agent's feed switches source, the statement leaves `review/SILVICOM-READ-ROUTINE.sql`
and the letter (Alex reviews the removal — "send the new SQL file before it goes live", mail.md), and the
grant can be given back. Feeds that can never pass stay SQL **by design**, named: finance (no GL/AP/fuel
service — surface doc "Money"), lumper (`other_charge` has no service), the close read until the change
read covers V/D status, and every roster field `/drivers` does not return.

---

## 5. The write pipeline

### 5.1 Table shape (D-MKT5) — and why not the alternatives

**Chosen:** `mcleod_write_requests` — one row per intent, PK = the **client action id**; its intent columns
are immutable by trigger and its `status` moves only forward through the two SQL functions below (the
`print_jobs` precedent, `0526_print_stations.sql`). `mcleod_write_attempts` — **append-only**: one row per
lease and one per outcome report; never updated, never deleted. The request's `status` is the request's
verdict; an attempt's `outcome` is one try's result (`transient`, `lease_expired`, `applied`,
`already_applied`, …) — two different facts, so neither restates the other.

**Rejected:** (a) pure event log with status derived from the newest event — the claim needs a partial index
on "claimable", and deriving it means a newest-event scan per claim under `SKIP LOCKED`; (b) a status column
with no attempt log — a crash-and-re-lease history would be overwritten, and "did we write twice?" must be
answerable forever (these are writes into the system of record); (c) `.upsert` of request rows — partial
payload, banned by `lint:upserts`, and a replay must be an `insert … on conflict do nothing`.

### 5.2 DDL — `supabase/migrations/<next>_mcleod_api_transport.sql`

Header carries the house register (gap / why this shape / rejected / error codes / rollback). Error codes
`MW001` another org's row named, `MW002` illegal status step, `MW003` intent changed after insert, `MW004`
attempt not current, `MW005` kind not switched on for this target.

```sql
create table if not exists public.mcleod_write_requests (
  id               uuid        primary key,                       -- the client action id (D-MK1); NO default
  org_id           uuid        not null references public.organizations(id) on delete cascade,
  kind             text        not null check (kind ~ '^[a-z][a-z_]{2,39}$'),  -- registry in @silvicom/shared, not here
  company_id       text        not null check (length(company_id) between 1 and 10),   -- dbo.company.id
  target_type      text        not null check (target_type in ('stop','movement','order','driver','tractor','trailer')),
  target_id        text        not null check (length(target_id) between 1 and 40),    -- McLeod's id
  payload          jsonb       not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  baseline         jsonb       not null check (jsonb_typeof(baseline) = 'object'),     -- our mirror's view at enqueue
  source_ref       text        not null check (length(source_ref) between 1 and 120),  -- e.g. 'load_event:<action id>'
  requested_by     uuid        references auth.users(id) on delete set null,
  status           text        not null default 'queued'
                   check (status in ('queued','sent','confirmed','refused','conflict')),
  reason_code      text        check (reason_code ~ '^[a-z][a-z_]{2,39}$'),
  reason_text      text        check (length(reason_text) <= 500),
  not_before       timestamptz not null default now(),
  lease_attempt_id uuid,                                           -- the current lease; null unless 'sent'
  lease_expires_at timestamptz,
  created_at       timestamptz not null default now(),
  settled_at       timestamptz,
  constraint mcleod_write_requests_lease_pair check ((status = 'sent') = (lease_attempt_id is not null and lease_expires_at is not null)),
  constraint mcleod_write_requests_settled check ((status in ('confirmed','refused','conflict')) = (settled_at is not null)),
  constraint mcleod_write_requests_reason check (status not in ('refused','conflict') or reason_code is not null)
);
-- One live intent per target and kind: two taps on one stop cannot race into McLeod.
create unique index if not exists mcleod_write_requests_one_live
  on public.mcleod_write_requests (org_id, kind, company_id, target_id) where status in ('queued','sent');
create index if not exists mcleod_write_requests_claimable
  on public.mcleod_write_requests (org_id, not_before) where status = 'queued';
create index if not exists mcleod_write_requests_leased
  on public.mcleod_write_requests (org_id, lease_expires_at) where status = 'sent';
create index if not exists mcleod_write_requests_org_recent
  on public.mcleod_write_requests (org_id, created_at desc);

create table if not exists public.mcleod_write_attempts (
  id            uuid        primary key default gen_random_uuid(),
  request_id    uuid        not null references public.mcleod_write_requests(id) on delete cascade,
  org_id        uuid        not null references public.organizations(id) on delete cascade,
  lease_id      uuid        not null,                -- = the request's lease_attempt_id while that lease lived
  event         text        not null check (event in ('leased','reported','lease_expired')),
  outcome       text        check (outcome in ('applied','already_applied','refused','conflict','transient')),
  instance_id   text        not null check (length(instance_id) between 1 and 64),
  agent_version text        check (length(agent_version) <= 40),
  mcleod_status integer     check (mcleod_status between 100 and 599),
  mcleod_text   text        check (length(mcleod_text) <= 500),
  observed      jsonb       check (observed is null or jsonb_typeof(observed) = 'object'),   -- McLeod's value read before/after
  at            timestamptz not null default now(),
  constraint mcleod_write_attempts_outcome check ((event = 'reported') = (outcome is not null))
);
create index if not exists mcleod_write_attempts_request on public.mcleod_write_attempts (request_id, at);

create table if not exists public.mcleod_write_switches (          -- append-only; newest row per (org, kind) wins
  id                uuid        primary key default gen_random_uuid(),
  org_id            uuid        not null references public.organizations(id) on delete cascade,
  kind              text        not null check (kind ~ '^[a-z][a-z_]{2,39}$'),
  mode              text        not null check (mode in ('off','test','live')),
  test_company_id   text        check (length(test_company_id) between 1 and 10),      -- required for 'test'
  canary_targets    text[]      check (canary_targets is null or cardinality(canary_targets) between 1 and 20),
  proven_by_request uuid        references public.mcleod_write_requests(id) on delete restrict,
  changed_by        uuid        references auth.users(id) on delete set null,
  reason            text        not null check (length(btrim(reason)) between 5 and 500),
  changed_at        timestamptz not null default now(),
  constraint mcleod_write_switches_test check (mode <> 'test' or test_company_id is not null),
  constraint mcleod_write_switches_live check (mode <> 'live' or proven_by_request is not null)
);
create index if not exists mcleod_write_switches_current on public.mcleod_write_switches (org_id, kind, changed_at desc);

create table if not exists public.mcleod_api_agent_status (
  org_id               uuid        primary key references public.organizations(id) on delete cascade,
  instance_id          text        not null check (length(instance_id) between 1 and 64),
  agent_version        text        check (length(agent_version) <= 40),
  last_ok_at           timestamptz,
  last_claim_at        timestamptz,
  last_error_class     text        check (last_error_class in ('transient','auth_failed','tls_pin','refused')),
  breaker_open_until   timestamptz,
  writes_enabled_on_vm boolean     not null default false,
  parity_enabled_on_vm boolean     not null default false,
  updated_at           timestamptz not null default now()
);

create table if not exists public.mcleod_api_discoveries (
  id         uuid        primary key default gen_random_uuid(),
  org_id     uuid        not null references public.organizations(id) on delete cascade,
  ran_at     timestamptz not null,
  report     jsonb       not null check (jsonb_typeof(report) = 'object'),
  docs_gz    bytea       check (docs_gz is null or octet_length(docs_gz) <= 8388608),
  created_at timestamptz not null default now()
);

create table if not exists public.mcleod_api_parity_runs (
  id             uuid        primary key default gen_random_uuid(),
  org_id         uuid        not null references public.organizations(id) on delete cascade,
  company_id     text        not null,
  feed           text        not null check (feed in ('movements')),
  ran_at         timestamptz not null,
  sql_count      integer     not null check (sql_count >= 0),
  api_count      integer     not null check (api_count >= 0),
  matched        integer     not null check (matched >= 0),
  mismatched     integer     not null check (mismatched >= 0),
  in_flight      integer     not null check (in_flight >= 0),
  only_sql       integer     not null check (only_sql >= 0),
  only_api       integer     not null check (only_api >= 0),
  field_mismatch jsonb       not null default '{}'::jsonb,
  sample_ids     text[]      not null default '{}' check (cardinality(sample_ids) <= 50),
  page_cap_hit   boolean     not null,
  change_read    text        not null check (change_read in ('ok','beyond_audit','skipped')),
  created_at     timestamptz not null default now()
);
create index if not exists mcleod_api_parity_runs_feed on public.mcleod_api_parity_runs (org_id, feed, ran_at desc);

alter table public.mcleod_write_requests enable row level security;
alter table public.mcleod_write_attempts enable row level security;
alter table public.mcleod_write_switches enable row level security;
alter table public.mcleod_api_agent_status enable row level security;
alter table public.mcleod_api_discoveries enable row level security;
alter table public.mcleod_api_parity_runs enable row level security;
```
Zero client policies on all six (service role only, deny-all to browsers — the 0526 posture). The
`forbid_org_change` trigger on each (0526's housekeeping loop). Guard triggers:
- `mcleod_write_requests_guard` (before insert/update): insert must be `queued` with null lease/settle;
  `id, org_id, kind, company_id, target_type, target_id, payload, baseline, source_ref, requested_by,
  created_at` fixed (MW003); status steps only `queued→sent`, `sent→queued` (lease expiry/transient),
  `sent→confirmed|refused|conflict`, `queued→conflict` (stale intent, §5.4); settled rows immutable (MW002).
- `mcleod_write_attempts_append_only`, `mcleod_write_switches_append_only`: refuse UPDATE and DELETE
  (cascade from the org's deletion excepted — the trigger allows `pg_trigger_depth() > 1`, the established
  evidence-table pattern).
- `mcleod_write_rows_same_org`: an attempt's `org_id` equals its request's; a switch's `proven_by_request`
  belongs to the same org and is `confirmed`, of the same kind, on `test_company_id` of a previous `test`
  row (MW001/MW005).

### 5.3 SQL functions (service role only; `revoke all … from public, anon, authenticated`)

```sql
-- Idempotent on the client action id: a replay returns the existing row's status, never a second intent.
mcleod_write_enqueue(p_org uuid, p_id uuid, p_kind text, p_company text, p_target_type text, p_target text,
                     p_payload jsonb, p_baseline jsonb, p_source_ref text, p_requested_by uuid)
  returns table (id uuid, status text, created boolean)
  -- insert … on conflict (id) do nothing; if a DIFFERENT live intent holds mcleod_write_requests_one_live,
  -- return that one with created=false (the caller shows its status; the tap is not lost — its evidence row exists).

-- The agent's call. Expires dead leases, then leases ≤ p_max claimable rows under SKIP LOCKED.
mcleod_write_claim(p_org uuid, p_instance text, p_agent_version text, p_kinds text[], p_companies text[],
                   p_max integer default 5, p_lease_seconds integer default 120, p_max_age interval default '72 hours')
  returns setof public.mcleod_write_requests
  -- 1. sent & lease_expires_at < now()  → status queued, not_before now(), attempt row event 'lease_expired'.
  -- 2. queued & created_at < now() - p_max_age → conflict, reason_code 'stale_intent' (office decides; never
  --    written to McLeod a week late).
  -- 3. select … where status='queued' and not_before <= now() and kind = any(p_kinds)
  --    and company_id = any(p_companies) and public.mcleod_write_allowed(p_org, kind, company_id, target_id)
  --    order by created_at limit p_max for update skip locked;
  -- 4. for each: new lease id; status 'sent', lease_attempt_id, lease_expires_at = now()+p_lease_seconds;
  --    attempt row event 'leased'.
  -- 5. upsert-free status write: update mcleod_api_agent_status set last_claim_at … ; insert when absent
  --    (insert … on conflict (org_id) do update set last_claim_at = excluded.last_claim_at — FULL row supplied,
  --    so lint:upserts' NOT NULL concern does not arise; it is SQL, not .upsert()).

-- The agent's report. Late reports of a truth still settle (the 0526 "unknown → printed" reasoning).
mcleod_write_settle(p_org uuid, p_id uuid, p_lease uuid, p_outcome text, p_reason_code text, p_reason_text text,
                    p_mcleod_status integer, p_mcleod_text text, p_observed jsonb, p_instance text, p_agent_version text)
  returns text   -- the request's status after the call
  -- always inserts an attempt row event 'reported' (the history is complete even for a stale lease).
  -- terminal request → return its status unchanged (idempotent re-report).
  -- p_outcome in (applied, already_applied) → confirmed (from sent OR queued: a late success is the truth).
  -- p_outcome = refused  → refused  (only if p_lease is the current lease, else attempt row only; MW004 not raised).
  -- p_outcome = conflict → conflict (same rule).
  -- p_outcome = transient → if current lease: status queued, not_before = now() + least(15 min, 30 s * 2^(n-1))
  --    where n = transient reports on this request; else attempt row only.

-- Is this kind switched on for this target right now? (read inside claim; also by the API before enqueue)
mcleod_write_allowed(p_org uuid, p_kind text, p_company text, p_target text) returns boolean
  -- newest switch row for (org, kind): off → false; test → p_company = test_company_id;
  -- live → p_company <> test_company_id is allowed, and if canary_targets is not null, p_target = any(canary_targets).
```
The API env lock (`MCLEOD_API_WRITES`) is checked in TypeScript before `mcleod_write_claim` is called, so the
DB functions never read process configuration. Every function ≤ 80 lines; matrix-tested (§8.3).

### 5.4 Kinds, payloads, adapters (one registry — derive, don't restate)

`packages/shared/src/mcleodApi.ts`:
```ts
export const MCLEOD_WRITE_KINDS = {
  stop_arrival:   { target: "stop", phase: "MK3", surface: "write.stop_arrival" },
  stop_departure: { target: "stop", phase: "MK3", surface: "write.stop_departure" },
} as const;   // MK4/MK5 kinds are added by the PR that builds their adapter, never ahead of it
export type McleodWriteKind = keyof typeof MCLEOD_WRITE_KINDS;
export const stopActualPayloadSchema = z.object({ at: z.string().datetime({ offset: true }) }).strict();
export const stopBaselineSchema = z.object({
  stop_status: z.string().nullable(), actual_arrival: z.string().nullable(), actual_departure: z.string().nullable(),
  mirror_last_seen_at: z.string(),           // mcleod_dispatch_stops.last_seen_at at enqueue
}).strict();
export const MCLEOD_WRITE_REASONS = { /* code → office sentence; e.g. */
  stale_intent: "Not sent: this was more than 72 hours old when McLeod could be reached. Enter it in McLeod if it is still right.",
  changed_in_mcleod: "McLeod already has a different time for this stop. Nothing was overwritten.",
  company_not_allowed: "The connector is not allowed to write to this McLeod company.",
  mcleod_role: "McLeod refused: the integration user is not allowed to do this.",
  not_found_in_mcleod: "McLeod no longer has this stop.",
  needs_delay_code: "McLeod needs a delay code for a late stop. Clear it in McLeod with the code.",
  mcleod_said_no: "McLeod refused it. Its message is shown below.",
} as const;
```
The DB checks only the kind's SHAPE; the API refuses an enqueue whose kind is not in the registry and the
agent refuses to claim kinds it has no adapter for (`p_kinds` = the adapter list) — so a kind exists in one
place and a half-built kind can never be leased.

**Agent `writeAdapters.mjs` contract** (one object per kind; `writeLoop.mjs` is kind-agnostic):
```js
export const ADAPTERS = {
  stop_arrival:   stopActualAdapter("arrival"),
  stop_departure: stopActualAdapter("departure"),
};
// adapter = { precheck(api, req) → {state:"absent"|"same"|"different", observed},
//             apply(api, req)    → {status, text},
//             verify(api, req)   → {state, observed} }
```
`stopActualAdapter(side)`:
- `precheck`: `GET /stops/{target_id}` → McLeod's actual for `side` (field names per §7 U12, held in
  `STOP_FIELDS` and pinned by a test against the Phase-A key list). Compare to `payload.at` truncated to the
  minute in Central (`centralTime.mjs`): equal → `same`; null → `absent`; other → `different`.
- `apply`: `POST /dispatch/clearStop/{target_id}?arrivalDate=<fmt(at)>` (or `departureDate`), format per
  §7 U9. Departure carries both dates when §7 U10 rules "both required", the arrival read from McLeod in
  precheck (never invented).
- `verify`: same read as precheck; must be `same`.

### 5.5 API endpoints

**Agent side** — `modules/mcleod/routes/tmsMcleodApi.ts`, registered inside `tmsIngestRouter` beside
`registerTmsLumperRoutes(router)` (`routes/tmsIngest.ts:126`), so it inherits the ingest-token middleware
(:96-117) and the `/api/tms` mount already in the route ledger (`testing/routeLedger.ts:45`) — no new mount,
no ledger entry. Each validates with a shared Zod schema; 400 `invalid_payload` with the first issue, as
`tmsLumper.ts:21-25`.

| Route | Body → answer | Calls |
|---|---|---|
| `POST /api/tms/mcleod-api/discovery` | report (12 MB limit on this route) → `{ id }` | `discovery.ts` insert |
| `POST /api/tms/mcleod-api/health` | health → `{ ok }` | `health.ts` update-or-insert of `mcleod_api_agent_status` (an UPDATE, then an INSERT of the full row when 0 rows — the `stampRosterRead` pattern, `tmsIngest.ts:157-179`; no `.upsert`) |
| `POST /api/tms/mcleod-api/parity` | parity run → `{ id }` | `parity.ts` insert |
| `POST /api/tms/mcleod-api/writes/claim` | `{ instance_id, agent_version, kinds[], companies[], max }` → `{ writes: "on"|"off", why?, requests: [...] }` | env lock → `rpc("mcleod_write_claim")` |
| `POST /api/tms/mcleod-api/writes/:id/settle` | `{ lease_id, outcome, reason_code?, mcleod_status?, mcleod_text?, observed? }` → `{ status }` | `rpc("mcleod_write_settle")`, then `writeWatch.onSettled` (bell for conflict/refused) |

`writes: "off"` answers 200 with `why` ∈ `env_off | no_kind_switched_on` so the connector logs it once per
change, not per cycle. Every query passes `org_id` from `req.tms.orgId` (`expectOrgScoped` in each test).

**Office side** — `modules/mcleod/routes/mcleodApiControl.ts`, registered from `routes/integrations.ts:21`:

| Route | Gate | Purpose |
|---|---|---|
| `GET /api/mcleod/api-health` | `requireAnySection(["dispatch","view"],["admin","view"])` | §3.6 |
| `GET /api/mcleod/writes?status=&since=` | `requireSection("dispatch","view")` | requests + attempts (no McLeod text for `view`; full for `manage`) |
| `GET /api/mcleod/writes/switches` | `requireAdminOnly("mcleod.connection")` | current mode per kind + history |
| `POST /api/mcleod/writes/switches` | `requireAdminOnly("mcleod.connection")` + step-up (the "Confirm it's you" flow other admin-only integration acts use) | append a switch row; `writeAudit("integration.mcleod.write_switch", meta: {kind, mode})` |
| `GET /api/mcleod/api-parity/verdict?feed=` | `requireAdminOnly("mcleod.connection")` | D-MKT4 verdict |
| `GET /api/mcleod/api-discoveries/latest` | `requireAdminOnly("mcleod.connection")` | verdict table (no raw docs) |

`POST …/switches` refuses `live` unless `proven_by_request` is a `confirmed` request of that kind on the org's
latest `test` row's company (the DB constraint repeats it — the database is the last word, MW005).

**Enqueue path for MK3** — `orchestration/driverStopToMcleod.ts` (not inside `loads` or `mcleod`: `mcleod`
already imports `../loads/index.js` (`dispatchProjection.ts:3`), so `loads → mcleod` would be an import cycle;
`orchestration/` is where cross-module composition lives, `nightlyReconcile.ts` precedent):
```ts
export async function completeStopAndQueueMcleod(admin, env, { orgId, driverId, loadId, stopId, actorUserId, input }):
  Promise<LoadResult & { mcleod?: { requestId: string; status: string } }>
// 1. completeStop(...) (loads; driverLoads.ts:284) — the evidence row, always first, never depends on McLeod.
// 2. if !env.MCLEOD_API_WRITES → return. Read the load's source/external_id via loads' exported reader.
// 3. source !== 'tms' → return. parseMcleodLoadExternalId(external_id) → { companyId, movementId }.
// 4. mcleod.queueStopActual(admin, orgId, { id: input.client_action_id, kind, companyId, movementId,
//    seq, at: input.occurred_at, requestedBy: actorUserId, sourceRef: `load_event:${input.client_action_id}` })
//    → resolves stop_id + baseline from mcleod_dispatch_stops (org, company, movement, movement_sequence = seq;
//    its own table), refuses quietly (no request) when mcleod_write_allowed is false for the kind, else enqueue.
// 5. Any throw in 4 → 503 to the phone; the outbox replays; 1 and 4 are both idempotent on the action id.
```
Requires N7 (`client_action_id` on stop actions, idempotent `driver_complete_stop`) — MK3 does not start
before N7 is merged. `status: "arrived"` → `stop_arrival`; `"completed"` → `stop_departure`; `"skipped"` →
no write (a skipped stop is McLeod's dispatcher's decision).

### 5.6 The agent's write loop (`writeLoop.mjs`; job `writes` in `schedule.mjs`)

`JOBS` gains `{ name: "writes", everyMs: 15_000 }` listed **after `loads`** (a board refresh is 1 s; a driver's
arrival can wait it). `serviceJobs` gains `writes` (default off: `MCLEOD_API_WRITES=on` required). The loop
never touches the SQL connection, so it does not affect the one-statement-at-a-time promise to Alex.

```
claim(kinds = Object.keys(ADAPTERS), companies = MCLEOD_WS_WRITE_COMPANIES, max = 5)
for each request, sequentially:
  if company ∉ MCLEOD_WS_WRITE_COMPANIES → settle refused company_not_allowed
  pre = adapter.precheck
     WsTransient   → settle transient            (nothing written)
     WsAuthFailed  → settle transient; stop the loop for this cycle; health auth_failed
     WsRefused 404 → settle refused not_found_in_mcleod
     WsRefused 403 → settle refused mcleod_role
  pre.state = same      → settle already_applied (confirmed; McLeod already has our value — our earlier
                          apply landed before a crash, or a dispatcher typed the same minute)
  pre.state = different → settle conflict changed_in_mcleod, observed = pre.observed
  pre.state = absent:
     res = adapter.apply
       WsRefused (400/409/422) → settle refused (needs_delay_code if §7 U11's marker matches, else mcleod_said_no)
       WsTransient / timeout   → do NOT re-apply; settle transient (next lease's precheck decides)
       2xx → post = adapter.verify
                same      → settle applied (confirmed)
                absent    → settle transient (accepted but not visible yet; next precheck decides)
                different → settle conflict changed_in_mcleod (someone wrote between our read and apply)
state written to service-state.json after each settle (atomic save, service.mjs saveServiceState)
```
A crash at ANY line leaves the request `sent`; after 120 s the next claim expires the lease and re-leases it,
and precheck answers whether McLeod already has it. **No path issues a second `clearStop` while McLeod holds
our value.** Residual window: a dispatcher writing the same stop in the < 1 s between our precheck and apply
would be overwritten; `verify` then sees our value, so it is invisible to the stop read. It is closed by the
audit check below when the service is granted, and stated in the office help text when it is not (§7 U14).

**Audit check (when `conflict.audit` is present):** after `applied`, `GET /auditTransactions/search` filtered
to the stop row since `baseline.mirror_last_seen_at`; any change by a user other than the integration user →
settle is still `confirmed` (McLeod holds our value) but `observed.audit_other_writer = <McLeod user id>` and
`writeWatch` raises a dispatch finding "McLeod stop changed by <user> just before Silvicom wrote it — check".

### 5.7 Conflict detection rules (the whole table)

| Baseline (our mirror at enqueue) | McLeod at precheck | Verdict |
|---|---|---|
| actual null | null | apply |
| actual null | = ours (minute) | confirmed `already_applied` |
| actual null | ≠ ours | conflict `changed_in_mcleod` |
| actual set, = ours | = ours | confirmed `already_applied` |
| actual set, ≠ ours | anything | **never enqueued**: `queueStopActual` refuses at step 4 and the driver's tap stays evidence; the load detail shows both times (Q-MK3) |
| any | stop 404 | refused `not_found_in_mcleod` |
| any | movement status V (void) in `observed` | refused `not_found_in_mcleod` |

Minute truncation is because McLeod stores minute-precision Central wall time (`centralTime.mjs` owns the
conversion; the same function the mirror uses to read it back).

### 5.8 Stall alerting — `modules/mcleod/mcleodApi/writeWatch.ts`

Scheduler `mcleod-write-watch`, lane `general`, registered in `schedulers.ts` after `financial-freshness`
(:92): `{ name: "mcleod-write-watch", lane: "general", start: startMcleodWriteWatch }`. Five-minute
interval, `inFlight` guard, each org in its own try — the `startFinancialFreshnessScheduler` shape
(`financialFreshness.ts:242-275`). One process fleet-wide by the lane lease (WORKER-DEPLOYMENT.md "Lanes and
leases"); it calls no vendor, so it is not in the vendor table there; the doc gets one row in its scheduler
list. Off unless `MCLEOD_API_WRITES`.

`planWriteFindings(now, snapshot)` is pure and unit-tested; findings go through `notify()` with day-scoped
dedupe keys and `keysAlreadySent` (the `runFinancialFreshnessOnce` pattern, :181-235), to
`sectionManagerIds(admin, orgId, "dispatch")` ∪ `surfaceHolders`-style holders of `mcleod.connection`, plus the
org's notification emails.

| # | Condition | Finding (severity) |
|---|---|---|
| W1 | oldest `queued` with `not_before <= now` older than 10 min, and the agent claimed within 10 min | "McLeod writes are waiting: the connector is claiming but not sending" (warning) |
| W2 | ≥ 1 `queued` and `last_claim_at` older than 10 min (or never) | "The McLeod connector has not asked for work for N minutes" (critical) |
| W3 | `last_error_class` ∈ auth_failed, tls_pin | "McLeod rejected the integration login / certificate changed" (critical) |
| W4 | a request with ≥ 3 `lease_expired` or ≥ 6 `transient` attempts | "A McLeod write keeps failing: stop <McLeod id>" (warning) |
| W5 | `confirmed` > 20 min ago and `mcleod_dispatch_stops.actual_*` still ≠ payload | "McLeod accepted a stop time the board still does not show" (warning) |
| W6 | evidence without request: `load_events` stop arrivals/departures on `source='tms'` loads, after the kind went `test`/`live`, carrying a `client_action_id` with no request (read through the `loads` export `readStopEventsSince`) | "A driver's stop time was not queued for McLeod" (critical — it means §5.5 step 4 was skipped) |
| W7 | each new `conflict`/`refused` (from `onSettled`, immediate, not the timer) | per request: reason sentence + McLeod id (warning) |

### 5.9 Kill switches and per-kind flags (D-MKT3)

| Lock | Where | Default | Effect when off |
|---|---|---|---|
| L1 env | `MCLEOD_API_WRITES` in `envCollectors.ts` (`z.enum(["true","false"]).default("false")`, the `ADS_ENABLED` form) | false (both staging and production) | `claim` answers `writes:"off"`; `queueStopActual` not called; watch scheduler idle. Flip = Railway/AWS variable + restart |
| L2 org/kind | newest `mcleod_write_switches` row per kind | no row = off | claim skips the kind; enqueue refused; `live` impossible without a proven test request (constraint) |
| L3 VM | `MCLEOD_API_WRITES=on` line in `connector.env` | absent = off | `writes` job not scheduled; second start-up log line says "writes OFF" |

Emergency stop is **any one**: set L1 false (seconds, no VM access), or post `mode:"off"` for a kind (admin,
one click, audited), or `set-mcleod-api.ps1 -Writes off` on the VM. Requests queued while off stay `queued`
and visible; the 72-hour stale rule (§5.3) stops a stale intent ever being written later.

`serviceConfigProblems` (`service.mjs:236`) refuses start when `MCLEOD_API_WRITES=on` and
`MCLEOD_WS_WRITE_COMPANIES` is empty, or names a company missing from `MCLEOD_WS_COMPANIES`, or
`MCLEOD_WS_CERT_SHA256` is unset.

### 5.10 What the office and driver see

- Load detail, per stop: `StopMcleodWriteBadge.vue` — "Sent to McLeod ✓ 10:42" / "Waiting for McLeod" /
  "Changed in McLeod — not overwritten" / "McLeod refused: <reason sentence>". Reads
  `GET /api/mcleod/writes?source_ref=…` through `useQuery`. McLeod's time and the driver's time side by side
  (N4 already adds McLeod actuals to the contract).
- Driver app: unchanged UI in MK3 — the stop completes on our side either way; a `refused`/`conflict` adds a
  line in the existing failed-sync list only when the office has not resolved it in 24 h (a later plan item;
  not a dependency of this spec).
- Settings › McLeod fleets: health line, switches card (`McleodWriteSwitches.vue`: kind, mode, who/when,
  "proven by" link; `live` button disabled with the reason until proven), discovery verdict table.

---

## 6. Agent deployment to the VM

Today: `windows/update-connector.ps1` installs the WHOLE source set of one pinned commit, checksummed against
the `$Files` manifest that `windows/manifest.mjs` regenerates from git objects; it backs up, stops the task,
runs the connector's own tests on the VM, starts, and reads two minutes of log (:96-238). New top-level
`.mjs` files are picked up by `manifest.mjs` automatically (it lists `*.mjs` at the agent root). The docs
fixtures ship as ONE file, `fixtures/ws-docs.json`, which `manifest.mjs` adds to its explicit list beside the
three review files — the VM runs every test before restarting, and a test that skipped for a missing fixture
would certify nothing.

Order on the VM (each a separate visit; Claude prepares, Alex or Miki runs):
1. **Code with everything off.** `update-connector.ps1 -Commit <sha>` — new code, no new lines in
   `connector.env` → `api_parity` and `writes` not scheduled; log line 2/3 says so. Rollback = the script's.
2. **McLeod API settings.** New `windows/set-mcleod-api.ps1 -Configure` (pattern: `set-lumper-feed.ps1`,
   which already adds a missing line safely): prompts for URL, auth mode, company map; secret at a hidden
   prompt; copies the PEM; computes and shows the leaf fingerprint for a person to compare with what McLeod
   sent (E2), writes it; runs `agent.mjs --api-discover` with the service stopped; refuses to write the
   lines unless discovery reports TLS ok + auth ok + search 200. Exactly the named keys change; ACL, line
   endings, no BOM verified (the script family's guarantees).
3. **Parity on.** `set-mcleod-api.ps1 -Parity on` → adds `MCLEOD_API_FEED=on`, waits for the first
   "api_parity: posted" line, else puts the file back.
4. **Writes on (test company).** Only after A1 (Alex's written OK). `set-mcleod-api.ps1 -Writes on
   -WriteCompanies TEST` → adds `MCLEOD_API_WRITES=on`, `MCLEOD_WS_WRITE_COMPANIES=TEST`; waits for
   "writes: claim ok". Adding a live company later is the same command with `TMS` — a separate, logged act.
`set-mcleod-api.test.ps1` rehearses each mode on the Mac against a temp root (the `set-lumper-feed.test.ps1`
pattern). README "Switch to live McLeod" (:96-107) and `review/CONNECTOR-ON-THE-VM.md` gain a "McLeod API"
section: what is called, how often, the allowlist, the three locks, the log lines.

---

## 7. MK0 discovery procedure and decision tables — every unknown, every answer, one consequence

**Procedure.** (1) E1–E9/A1–A3 sent. (2) On the answers: §6 steps 1–2 → `--api-discover` Phase A. (3) Claude
pulls the discovery row (`pnpm mcleod:ws-docs-fixtures <id>`), builds `docsParser.mjs` + tests on those pages
(PR). (4) §6 step 1 again (new code) → `--api-discover` Phase B → verdict table. (5) Each row below is
resolved from the report + McLeod's written answers; the resolution is appended to
`MCLEOD-API-KIT-PLAN.md` §8 with the discovery id. No row is resolved from memory or from <other-customer /ws> alone.

| # | Unknown | Answer | Exact build consequence |
|---|---|---|---|
| U1 | `/ws` on 22.1 (B-MK2) | Phase A: `/ws/docs` 200 and `movements/search` 200 | MK0/MK1 proceed on 22.1 |
| | | `/ws` 404 / not installed and McLeod says 26.x needed | MK1+ wait on the upgrade. **Proceeds meanwhile:** N1–N9; the whole DB pipeline (§5.2–5.3) and API routes merge with L1 off; agent client + adapters built and tested against `fakeMcleod.mjs` seeded from the surface doc; SQL feeds unchanged; MK2 finance unaffected (SQL by design). Upgrade then = re-run Phase A/B; no code path waits on a guess |
| | | present but `POST /dispatch/clearStop` absent (Phase B `write.stop_*` = absent) | MK1 proceeds; MK3 blocked; stop write recorded as "needs 26.x or TableRowService `PUT /stop/update`" — the latter only if McLeod states in writing it runs dispatch logic (it does not advance movement status otherwise; generic row update rejected for stop actuals) |
| U2 | TLS (B-MK3) | CA-issued chain, DNS name | `MCLEOD_WS_CA_FILE` = chain PEM; pin the leaf; `servername` = host |
| | | self-signed with a DNS name / IP-only URL | `CA_FILE` = the self-signed cert; pin; `MCLEOD_WS_SERVERNAME` = its CN/SAN |
| | | self-signed with NO usable name (CN ≠ any SAN/host) | name check replaced by **pin equality only** (`checkServerIdentity` returns the pin verdict); allowed only because the pin is set — `serviceConfigProblems` refuses this mode without a pin. Recorded in the letter to Alex |
| | | plain `http://` only | **blocked**: `validateWsUrl` refuses; ask Alex/McLeod for TLS (Alex's own rule for 1433: "Do not run unencrypted"). Nothing proceeds on `/ws` |
| | | certificate rotates later | pin mismatch → W3 critical, writes stop; `set-mcleod-api.ps1 -Repin` shows the new fingerprint for a person to confirm against McLeod |
| U3 | AnywhereCompanyID (B-MK3) | same strings as `dbo.company.id` | map is identity `TMS=TMS,…` |
| | | different strings | map translates; the API and DB keep OUR ids |
| | | one id for all companies + data filtered by role | refused: a write could reach the wrong legal entity. MK3 blocked until McLeod gives per-company ids |
| U4 | Token/roles (B-MK4) | static token | `MCLEOD_WS_AUTH=token`; 401 → `auth_failed`, W3; rotation = `set-mcleod-api.ps1 -Rotate` |
| | | login only, expiry unknown | `login` mode; 401 → one re-login (§3.2 rule 3). Discovery records time-to-first-401 over the parity week (health counter) — informational, no code depends on it |
| | | custom least role available | E4 list is the role |
| | | only stock `Users` role | accepted; `WS_PATH_ALLOWLIST` bounds the token to the listed operations in our code; letter to Alex says so; MK5 adds lines only with its adapter |
| U5 | Audit retention (B-MK6) | ≥ 7 days, audit on for movement+stop | change-read leg runs; D-MKT4 rule as written |
| | | < 7 days or audit off | change-read leg = `skipped`; parity uses the full open-board read every cycle; D-MKT4's audit clause fails → **the SQL close read is never retired**; the loads feed may still move to the API for the open board only |
| U6 | Row cap | 1,000 (default) | paging as §4; `page_cap_hit` = a full last page with no next → parity run fails that day. We do not ask to raise it |
| U7 | Webhooks (B-MK7) | none (surface doc) | polling only (§4/§5.6) |
| | | a webhook service exists on our install | still polling: a webhook needs McLeod to call into AWS or the VM to listen — not in Alex's terms. Recorded, not built |
| U8 | Test company (B-MK5) | test company on the same server | switch `test` with `test_company_id`; map entry `TEST=<id>`; proving run P1–P6 below |
| | | separate test server | second profile: `MCLEOD_WS_TEST_URL`/`_CA_FILE`/`_CERT_SHA256`; `createMcleodApi` per profile, chosen by company; same proving run |
| | | **none** | **Fallback, requires owner sign-off at that moment (§9 S2), and Alex's written OK:** live company, `mode:"live"` with `canary_targets` = the McLeod stop ids of ONE test order Alex creates: test customer code (non-billable, his choice), one dedicated McLeod driver record `<test driver code>` with no pay rate and excluded from settlements, a yard tractor, two stops at the carrier's own yard. `proven_by_request` must then reference a canary request (the constraint is satisfied by a `live`+canary row, mode stays canary-restricted). Steps: P1–P6 on that order only; Alex voids the order before billing and deletes any service-failure record clearStop created; the canary list is cleared (`mode:"off"`) the same day; widening to all stops is a separate switch row after the owner reads the P-report |
| U9 | `arrivalDate` format / zone | from Phase B param docs + E9 | `fmtMcleodDate(at)` in `writeAdapters.mjs`, Central wall time via `centralTime.mjs`; test pins format; P2 verifies by read-back |
| U10 | clearStop arrival-only? | arrival alone accepted | two kinds, two requests (as §5.4) |
| | | both dates required | `stop_arrival` kind is **not built**; arrival stays 360 evidence; `stop_departure` sends both dates, arrival = driver's tap if McLeod's is null, else McLeod's (never overwritten) |
| U11 | Already-cleared / late stop | refuses / overwrites / needs delay code | precheck prevents the first two by construction; P4 proves which; a "delay code required" refusal text becomes the `needs_delay_code` marker regex in `writeAdapters.mjs` (from P5's real text) |
| U12 | RowStop field names | Phase A `stop_keys` | `STOP_FIELDS = { arrival: "<key>", departure: "<key>", status: "<key>" }`, test-pinned against the stored key list |
| U13 | `text/plain` success body | any | not parsed for success (2xx is success); kept ≤ 500 chars in the attempt row |
| U14 | AuditTransactionService | granted | §5.6 audit check on |
| | | not granted | audit check off; the < 1 s window is stated in the office help text; W5 still checks the board |
| U15 | McLeod-side rate limits | 429 seen in parity week | `WS_MIN_INTERVAL_MS` raised to the observed safe rate in one constant; otherwise 500 ms stays |
| U16 | Symphony (B-MK8) | any | no effect on this spec (home time/driver status are MK6) |
| U17 | Alex's OK (B-MK9) | yes | §6 step 4 may run |
| | | no | writes stay off at L3 forever; MK1 parity may still run (reads only — confirm separately in A1) |

**Proving run on the test company (D-MK3), scripted as `agent.mjs --api-prove --company=TEST --stop=<id>`
(writes only to the allowlisted test company, refuses otherwise):** P1 arrival on a clean stop → `confirmed`
`applied`, read-back equal. P2 the same request replayed by forcing a lease expiry → `already_applied`, McLeod
audit shows ONE change. P3 kill the process between apply and settle (test hook `MCLEOD_PROVE_CRASH_AFTER=apply`)
→ restart → `already_applied`, one change. P4 a stop cleared in McLeod by hand to a different minute →
`conflict changed_in_mcleod`, McLeod untouched. P5 a late stop → record McLeod's refusal/behaviour. P6
departure. The P-report (counts, McLeod ids, outcomes) is posted as a discovery-shaped row and linked from the
switch's `proven_by_request`.

---

## 8. Tests

### 8.1 Agent (`node --test`, run by `lint:cli-streams`/`lint:agent-syntax` in CI and on the VM by the update script)
- `mcleodApi.test.mjs`: headers on every call (`Accept`, `AnywhereCompanyID` from the map, auth); Basic→login
  token, 401 → one re-login → success; second 401 → `WsAuthFailed` and 15-min refusal; static token 401 →
  immediate; pin mismatch refused even with a valid CA; IP host without servername refused; `http:` refused;
  read retry 1/2/4 s with fake sleep; **write never retried** on timeout; 4xx → `WsRefused`; text/plain kept;
  ≤ 1 in flight and ≥ 500 ms spacing (fake clock); breaker opens after 3; allowlist refuses an unlisted path
  before connecting; log lines contain no query, body, token or host (asserted on captured log).
- `writeLoop.test.mjs` (fake API + fake McLeod): each row of §5.6 and §5.7; crash between apply and settle →
  next run `already_applied`, exactly one `clearStop` seen by the fake; company not allowed → refused without a
  call; `writes:"off"` logged once.
- `writeAdapters.test.mjs`: minute truncation in Central across DST (2026-11-01); date format; both-dates mode.
- `apiParity.test.mjs`: paging by id ascending stops at < 1000; in-flight re-read; `beyond_audit`; payload has
  no names/addresses (schema-checked against the shared Zod, which has no such fields).
- `apiDiscover.test.mjs`: Phase A report shape; host hashed; docs gz under 8 MB; Phase B verdicts from fixtures.
- `schedule.test.mjs` / `service.test.mjs` extended: `api_parity`, `writes` off unless their lines say on;
  `serviceConfigProblems` cases of §5.9.

### 8.2 API (vitest)
- `tmsMcleodApi.test.ts`: every route rejects without/with a bad ingest token (401, before body parse);
  400 on schema; claim with L1 off → `writes:"off"`, no RPC; claim/settle pass `req.tms.orgId`
  (`supabaseRecorder` `expectOrgScoped`); discovery body limit.
- `driverStopToMcleod.test.ts`: evidence first (RPC called before enqueue); non-tms load → no enqueue;
  `skipped` → none; enqueue throw → 503 and replay produces one request; baseline ≠ ours → no request.
- `writeWatch.test.ts`: `planWriteFindings` W1–W6 table-driven; dedupe per day.
- `writeSwitches.test.ts`: `live` refused without proof; admin-only; audit written.
- Route gate tests: new office routes appear in `routeGateLedger`'s derivation (section/admin-only), no
  ledger entry needed.

### 8.3 PGlite matrix `supabase/tests/mcleod-write-queue.test.mjs` (all migrations, `readdirSync().sort()`;
`await db.close()` before `RESULT`)
enqueue idempotent on id; second live intent for same target returns the first; claim leases ≤ max under
`skip locked` from two sessions without overlap; expired lease → `queued` + `lease_expired` attempt; stale
intent → conflict; settle each outcome; stale-lease refusal does not change status but adds an attempt row;
late `applied` from a stale lease confirms; terminal rows immutable (MW002); intent immutable (MW003);
attempts/switches UPDATE and DELETE refused; `live` switch without proof refused; canary restricts targets;
cross-org attempt refused (MW001); anon/authenticated cannot execute any function or read any table.
`rls.test.mjs`: hand seeds for `mcleod_write_requests` (explicit id + valid shapes), `mcleod_write_attempts`
(chain), `mcleod_write_switches` (`off` row), `mcleod_api_agent_status`, `mcleod_api_discoveries`,
`mcleod_api_parity_runs` (the 0526 `print_jobs` seed form, `rls.test.mjs:2479-2487`).

### 8.4 Gates this work must keep green (and the manifest edits each needs)
| Gate | What this spec does for it |
|---|---|
| `lint:migrations`, `lint:migration-ordering` | one file, next number; functions in PR-1, their TS callers in PR-2 (a function reader ships a merge after its migration) |
| `lint:rls` (+ section-policies) | `enable row level security` spelled per table; no `auth_role()` lists (no client policies) |
| `lint:table-producers` | requests/attempts: DML in function bodies; discovery/parity/status/switches: `.from()` writers in the same PR as the table |
| `lint:table-writers` / `lint:table-modules` / `lint:schema-snapshot` | 6 entries in `table-modules.json` (module `mcleod`; layers: requests/attempts/switches `core`, status `infra`, discoveries/parity `raw`); writer pairs each inside `modules/mcleod/`; regenerate `schema.generated.sql` |
| `lint:table-lifecycle` | requests `time`, budget 2000/day (≈160 loads × 3 stops × 2 sides, ×2 headroom), retention null; attempts `time`, 4000; switches `time`, 20; status `fleet`; discoveries `time`, 5; parity `time`, 400, retention 120 → `RETENTION_RULES` entry in `dataRetentionPolicy.ts`; requests+attempts+switches into `RETENTION_FORBIDDEN` (they are the record of what we asked McLeod's system of record to change) |
| `lint:upserts` | no `.upsert()`; update-then-insert of full rows |
| `lint:boundaries`, `lint:table-access` | raw tables read only in `modules/mcleod/`; orchestration imports module indexes only |
| `lint:filesize`/`funcsize` | every new TS file < 450 lines, functions < 200 |
| `lint:agent-syntax` | new rules (§3.3) + their scratch proof |
| `lint:comment-claims` | comments that say "pinned by" quote the real test titles above |
| `lint:tests` | new test files are collected (agent tests by the `tools/mcleod-agent/*.test.mjs` glob) |

---

## 9. Build order (each a PR; titles for the office reader)

| PR | Content | Needs |
|---|---|---|
| 1 | Migration (6 tables, guards, 4 functions) + matrix + rls seeds + manifests + shared `mcleodApi.ts` + discovery/health/parity writers and routes (tables new → exempt) | — |
| 2 | Agent `mcleodApi.mjs` (+ move of `fetchFromMcleod`), gate rules, `--api-discover` Phase A, `set-mcleod-api.ps1`, README/VM doc | — |
| 3 | Write queue API (claim/settle/switch routes, `writeQueue.ts`, env L1), `writeWatch` scheduler, web health line + switches card | PR-1 merged (function readers behind their migration) |
| 4 | Agent `writeLoop`/`writeAdapters`/`--api-prove`, `writes` job, `fakeMcleod` | PR-2 |
| 5 | `docsParser.mjs` + Phase B | discovery Phase A ran (fixtures exist) |
| 6 | `api_parity` job + verdict route | U1 resolved present |
| 7 | MK3 enqueue (`driverStopToMcleod.ts`, `me.ts`), `StopMcleodWriteBadge` | N7 merged; U9–U12 resolved; P1–P6 passed on the test company |

PRs 1–5 ship with every lock off and change nothing a user sees except the health line. **Owner sign-off
is needed at exactly two moments:** **S1** — the first `test`→`live` switch for a kind (reads the P-report);
**S2** — only if U8 = none, before the canary order is used in the live company.

## 10. Decisions

| ID | Decision |
|---|---|
| D-MKT1 | `mcleodApi.mjs` is the only door to `/ws`, as `connection.mjs` is to SQL; gate-enforced |
| D-MKT2 | Delivery at-least-once (leases expire and re-lease); effect exactly-once by read-before-write and read-after-write; a write is never retried blind |
| D-MKT3 | Three independent locks (API env, org per-kind switch, VM line), all default off; `live` requires a confirmed test-company request in the database |
| D-MKT4 | A SQL read retires per feed only on the 7-day parity rule; finance, lumper and fields `/ws` lacks stay SQL by design |
| D-MKT5 | Immutable-intent request rows with a forward-only status + an append-only attempt log; switches append-only; all three in `RETENTION_FORBIDDEN` |
| D-MKT6 | Health lives in a mcleod-owned `mcleod_api_agent_status` row, not `org_integrations` (org-owned; mcleod's sites there may not grow) and not `/api/version` (public) |
| D-MKT7 | McLeod's refusal text is stored in OUR database (capped) and shown to the office; the VM log carries only status codes, times and McLeod ids (mail.md) |
