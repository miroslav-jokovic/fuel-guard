# Audit of the McLeod API Kit build specs — 2026-11-20

**What this is.** On 2026-11-20 the owner asked for an audit of the McLeod API Kit plan, to confirm that
everything in it is 100% correct, precise and free of assumptions. The audit covers four build specs
(`api-kit-specs/A–D`), the `/ws` surface doc, the v1 plan (`MCLEOD-API-KIT-PLAN.md`) and the 2026-11-19
handoff. Six independent audits ran, each read-only against main at `22f3f0540` (migrations up to 0636)
and against McLeod's public `/ws` docs. Every finding below cites evidence (path:line or URL) in its
report under `api-kit-audit/`:

| Report | Audits | Findings |
|---|---|---|
| `api-kit-audit/A.md` | Spec A, driver loads (S0, N1–N3, N7, MK3) | 57: 9 wrong, 22 gaps, 4 open, 11 imprecise |
| `api-kit-audit/B.md` | Spec B, data fixes (N4–N6, N8, N9) | 44: 4 wrong, 8 gaps, 5 open, 5 imprecise |
| `api-kit-audit/C.md` | Spec C, transport (MK0, agent client, write pipeline) | 45: 9 wrong, 13 gaps, 5 open, 9 conflicts with A |
| `api-kit-audit/D.md` | Spec D, office, finance and documents (MK2, MK4–MK6) | 72: 13 wrong, 21 gaps, 3 open, 13 imprecise |
| `api-kit-audit/WS.md` | Every `/ws` claim against McLeod's docs pages | 5 wrong, many new facts |
| `api-kit-audit/X.md` | Consistency across all documents, dependencies, IDs, re-rulings, coverage | 10 headline items |

**Verdict.** The specs cite the code accurately: almost every file:line holds. The direction holds too:
SQL-only steps (N), then MK0 discovery, then writes from the outbound on-prem agent, then nothing live
before it is proven on a test company, and finance stays on SQL. **They cannot be built as written,
though.** There are four kinds of problem:
- two incompatible designs for the write pipeline;
- function and migration changes that would fail in Postgres;
- tests that would turn red or cannot catch what they claim to;
- McLeod facts that were assumed, not read.

The v2 plan is written from this file. The R-items say what v2 adopts. The O-items are the rulings
only the owner can make.

---

## 1. McLeod `/ws` facts corrected or newly established (WS.md)

| # | Was | Is (source: McLeod's `/ws/docs` on tms-map, `?role=-1`) |
|---|---|---|
| W1 | Settlement, Deduction and Billing are read-only | All three have writes (`/settlements/create`, `/deductions/create`, `/billing/update`, `/billing/postBills`, …). Finance still stays on SQL, because there is **no GL, AP-voucher or fuel service**. This plan writes nothing to billing or settlement. |
| W2 | Trailer status = `status` / `service_status` | That is **tractor only** (`status` is 2 characters). RowTrailer has `is_active` (1), `statuscode` (4), `disposition_code` (4), `inservice_date`, `outservice_date`. |
| W3 | Version read from a header or a docs string | `GET /metadata` (no login needed) returns `lmeVersion`, `lmeRevision`, `serviceVersion`, `serviceRevision` and the enabled companies. MK0 reads it. |
| W4 | RowStop keys taken from one `GET /stops/{id}` | Null fields are **left out** of responses, so the key list comes from the **type page**. RowStop has `eta`, `actual_arrival`, `actual_departure`, `sched_arrive_early/late`, `projected_arrival`, `status`, `operational_status`, `prior_uncleared_stops`. Whether each field is writable is not documented. |
| W5 | Image upload shape assumed | `rowType` is one letter (**O** order, M movement, D driver, T tractor, E trailer, …). The body is the **raw file** with `Content-Type` `application/pdf` or an image type; it is not multipart and takes no file-name parameter. The optional `movementId` is a query parameter. The result is a String: either a staged batch id or the stored record id, and **you cannot tell which**. |
| W6 | Date format unknown | Dates are `yyyyMMddHHmmssZ` (e.g. `20160816170100-0500`) when `loadmaster.ws.useServerTimezone=false`. MK0 reads **our** setting from our own copy of the Date type page. |
| W7 | Partial update unknown | Documented: "callers may omit fields … not nulled out; to send null pass the word NULL". JSON rows carry `"__type":"<table>"`. **No optimistic concurrency is documented**, so the agent's read-before-write is the only conflict guard. |
| W8 | Audit-search filters assumed | `GET /auditTransactions/search` returns `table_name, primary_key_values, changed_values, change_date_time(_utc), user_id, transaction_id`. It filters with `excludeAdd/Delete/Update` and **keeps one day only**, so any audit read-back runs the same day. |
| W9 | Home time via `PUT /equipStatus/create` | EquipStatusService is **Drivers-role only**, so an office Users login cannot call it. That leaves RowDriver `next_home_date` / `pta_date` through TableRowService. |
| W10 | ETA write not found | RowCallin has `new_eta` and `current_stop_id`, so `PUT /callins/create` is a candidate ETA write, alongside RowStop `eta`. MK0 decides between them (O-list, §4). |
| W11 | Service count 73 | It is 75. RemoteNotificationService and SysAdminService return HTTP 500 every time, so "no webhooks" is confirmed only for the services we could read. |
| W12 | Not documented anywhere | Token lifetime; login JSON shape; error-body format; required fields of `drivers/create` (including SSN); `clearStop` behaviour on a second call, with departure only, or on a stop that is not the next one. Each becomes an MK0 probe on the **test company**, with the build for each outcome fixed in v2. |

## 2. Resolutions v2 adopts (closes the WRONG, GAP and CONFLICT findings)

### 2.1 One write pipeline (A-46, C-37..39, D-18..21, X-1)
- **Three append-only tables in one migration** (C.md "Reconciled schema proposal"):
  - `mcleod_write_requests`: intent; id = client action id; immutable.
  - `mcleod_write_events`: leased, lease_expired, transient, applied_unverified, confirmed, refused, conflict.
  - `mcleod_write_switches`: per **org × operation × McLeod company**; modes `off`, `test`, `canary`, `live`. A `live` row needs a confirmed `test`- or `canary`-proven request. This fixes the canary deadlock (C-12) and the null-column comparison (C-13).
- **Status is derived from events, never stored.** A lease is an event. Concurrency is a per-org advisory lock, because there is one agent per org.
- The **stop request is enqueued inside `driver_complete_stop`**, in the same transaction as the evidence (A's design). `loads → mcleod` is already an allowed boundary edge (`check-feature-boundaries.mjs:399`), so the import-cycle argument in C and D does not apply.
- **No re-send after a 2xx.** A 2xx with no read-back is recorded as `applied_unverified`, and the read-back alone settles it. Sends are capped per request (C-15, C-30).
- **More than one live request per target is allowed** (D-20): the uniqueness is `(stop_id, operation)` for driver-app stops and `supersedes` for replacements. Many documents per order and many edits per driver are therefore fine.
- **One switch mechanism** (A-35, X-6): the switch table plus one API environment master switch (`MCLEOD_WRITES=off|on`). The VM's existing lines are the third lock. A's `MCLEOD_WRITE_COMPANIES` and D's `mcleod_write_kinds_enabled` are dropped.
- `requested_by` is **not** a foreign key to `auth.users`, so it does not block `revokeDriverLogin` (A-33). New SQLSTATE codes use free numbers; MW010 and MW011 are taken by 0551 (A-38).
- One `mcleod_api_capabilities` table records what MK0 found (one row per operation × field, read from **our** `/ws/docs`). D's readers read it. It ships in the MK0 merge (D-18).

### 2.2 Stop write (A-36/37, C-16/17, X-2)
- **Only Complete writes.** It sends one `clearStop` with `arrivalDate` = the driver's Arrive tap and `departureDate` = the Complete tap. Arrive and Skip send nothing.
- Service-failure parameters are fixed by ruling **O-4**.
- The pre-write check compares: the stop still exists in McLeod, its status is not already cleared, the movement and stop ids are unchanged, and the dispatched driver is unchanged. Any difference is recorded as `conflict` with a reason.
- **The arrival must be in order** (A-21): `outbox.ts` `claimNext` keeps first-in-first-out order per stop, so an Arrive is never overtaken by its Complete.
- Exact-match rules for times use the minute precision of the `/ws` Date format (W6). There is no invented ±1 min tolerance.

### 2.3 Test company actually reachable (X-4, C-19)
- The connector reads one company today (`connector.example.env:19-20`).
- v2 adds a **test-company read lane**: the movements of the test company in `MCLEOD_TEST_COMPANY_ID`, mirrored to a staging org only.
- `--api-prove` creates its request through `mcleod_write_prove()` (admin role; `test` or `canary` mode only).

### 2.4 Postgres and test correctness (A-10..15, A-12, A-18, A-24/25, A-27, A-30, A-47, A-52)
- **Changing a function's signature:**
  - `drop function` the 0141 signatures explicitly and re-grant, because 0412 closes new functions by default. `create or replace` with a new parameter would make a second overload (PGRST203).
  - `assert_driver_load` keeps returning `text`.
- **Order of checks:** the action-id dedupe runs right after the driver-in-org check, before visibility. The dedupe key is `(org, load, stop, action id)`.
- **Tests that turn red:** `load-lifecycle.test.mjs:151` and `loadOnTruck.test.ts:100` are updated in the same merge. The stop-write tests live in `tmsIngest.dispatchProjection.test.ts`, not in a file the spec named that does not exist.
- **S0 (stable stop ids):** the removed-stop/same-`seq` case is handled. Every `(load_id, seq)` reader gets a tie-break (the 0453 ETA predictions are one). The stop-writing RPC's column list includes B's `reference_numbers`. B1 lands **before** S0b, or is rewritten into S0b; X-7 fixes the order.
- **Org filters:** the stop and photo reads in `getDriverLoads` get org filters.

### 2.5 Data fixes (B.md)
- **Mixed-shape upserts:** supabase-js sends the union of keys and fills a missing one with NULL. The guard must check every stop (B-7).
- **Mirror hash:** gets a version salt (B-6/30).
- **Drivers link:** uses `q` (B-19).
- **No tooltip component exists:** use `title`, as the Status cell does (B-13).
- **File budget:** extracting the Load # cell takes the page to about 489 lines, which is enough (B-14).
- **DB7's 14-day window restarts** at the release that puts the driver's arrival into `arrivedAt` (B-24).
- **Relink compare:** treats null and `[]` as equal (B-35).
- **Qualifier labels:** none are guessed. Every code (PU, P8, SI, CR, DO, BM) is labelled only after the V1 production count plus a dispatcher's reading of three loads (B-31/32).
- **"Fix the roster" action:** named for each reason (B-20).

### 2.6 Office, documents, finance (D.md)
- **Images:**
  - A 2xx from McLeod settles the request as `confirmed`. Whether the image is visible is tracked separately on `mcleod_image_sends.filed_seen_at` (D-19).
  - The PDF is built with `updateMetadata:false` and fixed dates, so the same input gives the same bytes and the same sha256 (D-53).
  - `stopPhotoInputSchema` gains `sha256` (D-58).
  - Retention: the image-send table is append-only evidence with **no** retention rule (D-52).
  - "Send again" = a new request with `supersedes`. The duplicate key is (bytes, order, category), not bytes alone (D-54).
- **Hire link:** a new roster export, `linkHiredDriverToTms`, sets the McLeod id **and** `identity_source='mcleod'`. `handApplicationToTms` cannot do it after a close, because it updates only applicants (D-30/31). The returning-driver path is ruling **O-6**.
- **Claim defect:** the database trigger **and** `resolveDriverUpdate` / `DRIVER_IDENTITY_FIELDS` change in the same PR (D-26/27).
- **SSN:** never sent. The agent strips every SSN-shaped key from the **final** body, including McLeod's `/drivers/new` defaults. The test asserts the exact body the stub receives (D-59).
- **Email:** never written into `name_of_spouse`. Alex forbade it in writing (`mail.md:89`; X-3, D-23).
- **Finance:**
  - `FUEL_PURCHASES` is 28 columns (D-44).
  - No M-D6 migration: `source_db` goes into `org_integrations.config` (D-45).
  - The comparison run needs Part 2 of the grants re-run on `lme_analytics`. That is in the one message to Alex (D-17).
- **File budgets:** `tms.ts` (499 lines), `rosterContract.ts` (452) and `homeTime.ts` (456) get no additions. New code goes in new files (D-63).
- **Routes:** office routes live under `/api/integrations/mcleod/...` and are entered in the route-gate ledger (C-7, D-64).
- **Discovery upload:** gets its own body limit, above the router's 8 MB (C-8).

### 2.7 Agent and network (C.md)
- The agent already reads `MCLEOD_WS_URL`, `MCLEOD_WS_TOKEN`, `MCLEOD_WS_USERNAME/PASSWORD` and `MCLEOD_COMPANY` (`agent.mjs:180-197`). The client is built on them.
- It is not dependency-free (it uses `mssql`). `update-connector.ps1` cannot install anything new, so the `/ws` client uses Node built-ins only.
- **Test certificate:** a test-only certificate is committed, because `node:crypto` cannot self-sign (C-6).
- **Rate limiting:** the agent's write routes get their own limiter, keyed by agent identity, so they cannot starve the `/api/tms` loads feed limited at `app.ts:340-346` (C-9).
- **Scheduling:** write claims run on their own timer, not in the agent's one-at-a-time job loop, so parity and the 02:00 finance sweep cannot hold writes back (C-20).
- **Repo is PUBLIC:** McLeod's crawled docs are never committed as fixtures. Tests use hand-written minimal stubs (C-24).

### 2.8 Rulings and coverage (X.md)
- **Re-rulings list:** v1 §1 gains the nine documents it missed (X-9), and v1's money-control citation is corrected to `:296`. The full list with file:line is in X.md §5.
- **Decision IDs:** v2 numbers its decisions once, as D-MK1..n. Spec-local IDs (D-MK2-1, D-MK4-x, D-MK5-0a…) and colliding step labels are renamed. D-TL1, D-DB4, D-FS2 and LR4 are always qualified with their plan's name.
- **Coverage:** every v1 §5/§6 item gets a step or an explicit "not in this plan, because …":
  - detention/lumper, fuel receipt, roadside, home-time request, ETA, navigation;
  - real phone, stores, "Approve and run";
  - RC-received flag, unit papers, delivered history;
  - D-IP5 no-write.
- **Messages:** exactly **one** drafted message to McLeod (via Ron) and **one** to Alex. The Alex message covers:
  - writes;
  - the new `/ws` destination;
  - the AWS host instead of Railway;
  - the parity read cadence;
  - the grant Parts 2/3/4/5, `drs_check` and `gl_summary`;
  - the test-company read.
- **"Dispatch planned" pin:** limited to loads in `loadsDispatchedTo` (B-22).

## 3. What is NOT a problem (confirmed)
- Migration numbering: the next free number is 0637, and the column → reader ordering per merge is sound.
- The claim-trigger defect is real.
- Every SILVICOM-GRANTS citation is correct.
- `load_stop_photos` has no sha256.
- `pdf-lib`, `sharp` and `expo-crypto` are present.
- The agent re-posts only movements whose hash changed.
- `pickup_number` has no writer.
- `references` is a reserved word.
- Accept/Decline can never work on McLeod loads.
- Dispatched-not-started loads are invisible to drivers.
- The live hole is real: a driver can act on a McLeod load never dispatched to them.

## 4. Rulings only the owner can make (v2 shows each with a recommendation; nothing is built against them until ruled)

| # | Question | Recommendation |
|---|---|---|
| O-1 | Confirm in writing the v1 recommendations Q-MK1..15 → D-MK1..5. "Go ahead" is not recorded anywhere in the repo (A-6, D-60). | Approve, as v2 lists them. |
| O-2 | Which driver fields 360 writes to McLeod. Q-MK13/D-MK2 = medical-card expiry, CDL expiry, new hire, termination/rehire. Spec D widened this to names, DOB, address, email, CDL number and hire date (D-61). | Keep it narrow for the first release. Widen per field later, each with Alex's OK. |
| O-3 | Co-driver: may both seats see the load when the current dispatch names either one (Q-MK5a)? | Yes. |
| O-4 | `clearStop` service-failure fields. A driver's tap must not create a reportable service failure by itself. | Send `isReportable=false` and no delay code. Dispatchers record lateness in McLeod as today. |
| O-5 | Evidence (photos, stop actions) arriving for a load that was re-dispatched away from the driver while their phone was offline (Q-MK5b). | Accept and store it, show it to the office as an exception, never send it to McLeod. |
| O-6 | A returning driver: reuse their old 360 record and old McLeod id, or create new ones? (D-32) | Reuse: reactivate the old 360 record and send a TableRowService update to the same McLeod driver, never a second create. |
| O-7 | D-RL5 is a verbatim owner quote ("hiring is not done from 360"). The new hire → McLeod create reverses it. | The owner restates it in their own words. |
| O-8 | ETA write route: RowStop `eta` (TableRowService) or a call-in with `new_eta` (W10). | A call-in, because it is McLeod's own ETA mechanism and keeps a history. Final pick after the MK0 test-company probe. |

## 5. Owner rulings — 2026-11-20

The owner answered §4 with "go ahead" (2026-11-20). Recorded as ruled, each as its recommendation:

- **O-1 ruled:** v1's Q-MK1..15 recommendations are approved as D-MK decisions, as v2 lists them.
- **O-2 ruled:** 360 writes to McLeod only medical-card expiry, CDL expiry, new hire and termination/rehire.
  Names, DOB, address, email and CDL number are not written. Widening needs a new ruling per field plus
  Alex's OK.
- **O-3 ruled:** both seats see the load when the current dispatch names either driver.
- **O-4 ruled:** `clearStop` is sent with `isReportable=false` and no delay code. Dispatchers record
  lateness in McLeod as today.
- **O-5 ruled:** evidence for a load re-dispatched away from the driver is stored and shown to the office
  as an exception. It is never sent to McLeod.
- **O-6 ruled:** a returning driver reuses their old 360 record and their McLeod driver id (TableRowService
  update). There is never a second create.
- **O-7 accepted, wording still owed:** "go ahead" accepts reversing D-RL5 ("hiring is not done from 360")
  so that a 360 hire creates the McLeod driver. The owner's own sentence for the re-ruled D-RL5 text is
  still to be supplied. v2 shows the proposed text, and the hire → McLeod create step stays switched off
  (switch row `off`) until that sentence is on file. The rest of v2 does not wait on it.
- **O-8 ruled:** the ETA is written as a call-in carrying `new_eta`, provided the MK0 probe on the test
  company shows the call-in updates the stop's ETA. If it does not, the ETA is written to RowStop `eta`
  through TableRowService. Both outcomes are built as written in v2.
