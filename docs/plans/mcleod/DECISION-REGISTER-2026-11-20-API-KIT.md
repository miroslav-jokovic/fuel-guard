# McLeod API Kit decision register (2026-11-20)

**What this is.** One document that replaces the precedence chain across rounds 1–4. It holds:
- the **final decision** on every point the four review rounds left contradicted, broken or undecided;
- the remaining **owner questions**;
- the **outside answers** the plan waits on, each with a build for every possible outcome.

The v2 plan writer reads this file **instead of** applying ROUND3, COUNCIL and AUDIT by hand.

**How it ranks.**
- **This file outranks every other McLeod API Kit document.**
- On a point this file does not cover, the latest round's report on that point applies: round 4, then round 3, then the council, then the audit, then the specs.
- A report finding that contradicts this file is rejected.

**Where the evidence is.** Each decision cites it:
- `api-kit-audit/` for round 1;
- `api-kit-council/` for round 2;
- `api-kit-round3/` for round 3;
- `api-kit-round4/` for round 4:
  - `1-verify-round3.md` (PGlite-tested);
  - `2-v2-writer.md` (dry run);
  - `3-outcomes.md` (every possible answer, plus unseen risks).

**Decision ids.** v1's D-MK1..D-MK5 stand as ruled on 2026-11-20 (AUDIT §5 O-1), with the amendments below. New decisions are **D-MK6 onwards**, and v2 uses these numbers as they are. Spec-local ids (spec A's and spec B's "M-A", the "D-MK2-1"-style ids, and C-, O-, Q-, R3-, SEQ-, DR-, OPS-, OF-, P- and V4- ids) are cited as evidence only, never as decision ids.

**State of main** (re-read at write time, 2026-11-20):
- Migrations 0637–0640 are merged.
- Driver visual plan V5, V6 and V7 are merged (#2597, #2601, #2603).
- Load-rates R1–R3 are merged; R4 is PR #2602.
- `DispatchLoadsPage.vue` is 498 lines.
- Every file:line in older documents must be re-read by the v2 writer. None is to be trusted as "do not re-derive".

---

## 1. The write pipeline

**D-MK6, three tables in one migration, all append-only**:
- **`mcleod_write_requests`**: the intent. The id is the client action id, or a random uuid for office, sweep, job and prove requests.
- **`mcleod_write_events`**: every fact, in one table. Events are ordered by an identity `seq`, not by `now()`.
  - Fact kinds: leased, send_started, transient, applied_unverified, confirmed, refused, conflict, already_in_mcleod.
  - Lease expiry is computed from `seq` order and the lease length; it is never stored.
  - The table is retention-forbidden.
  - The round-3 split into a separate `mcleod_write_attempts` table is **rejected**. It broke single ordering and could not be purged (V4 §2.15). The volume of about 700 requests a day × 4 events ≈ 1M rows a year is acceptable (council P-21 sizing).
- **`mcleod_write_switches`**.
- **No `auth.users` foreign keys.** Columns are `requested_by uuid null` and `driver_id uuid null`.

**D-MK7, `origin`** is one of `driver_app`, `office`, `office_retry`, `sweep`, `job`, `prove`. Each operation's required subject is checked against a registry in `packages/shared/src/mcleodWriteOperations.ts`:

| Operation kind | Required subject |
|---|---|
| Stop operations | `stop_id`, `load_id`, `movement_id` |
| Image operations | `image_send_id` |
| Driver operations | `driver_id` |
| Unit operations | `vehicle_id` or `trailer_id` |

**D-MK8, uniqueness.**
- **On requests:** one partial unique index, `(operation, subject_ref) where origin <> 'office_retry'`. `subject_ref` is the generated text of the subject id. This uses R3-9's predicate and **rejects ROUND3 §2.5's**, which let a sweep enqueue the same image twice (V4).
- **Retries:** an `office_retry` row has `supersedes` set, with `unique (supersedes)`. "Send again" chains from the latest retry.
- **On `mcleod_image_sends`:** `unique (stop_id, kind, sha256)`. It is **not** unique per order and category, because a multi-stop order carries two BOLs in one category.

**D-MK9, `enqueue_failed`** is **not** a write event, because no request exists when the enqueue failed. It is recorded in the `stop_completed` event's payload (`mcleod_write: 'enqueue_failed'`) and raises the critical alert (D-MK31).
- The enqueue sub-transaction catches every error except 40001 and 40P01. Those two are re-raised so the whole call retries.
- The enqueue keeps `on conflict do nothing`.
- This was tested: evidence survived 23514, 23505, 22P02 and custom codes (V4 §2.8).

**D-MK10, agent timing.** These are tunables in one shared file, `packages/shared/src/mcleodWriteTunables.ts`. The agent reads them from the claim response, so the API stays the single source.

| Tunable | First value | Set by |
|---|---|---|
| Claim size | 1 | — |
| Lease length | 300 s | MK0 measurement of clearStop p99 |
| `begin_send` | one call, 10 s timeout, **no retry**; a lost answer means "do not send" | — |
| Write deadline | 30 s absolute | MK0 measurement of clearStop p99 |
| Quiet period after `send_started` | 300 s | — |
| Settle | idempotent; may retry four times with 60 s timeouts (the settle POST cannot cause a second send, V4 §2.7) | — |
| Sends per request, if the outcome is unknown | at most 3 | — |
| Re-read after a 2xx that is not yet visible | 60 s, then back off; 3 reads, then `conflict accepted_not_visible` | — |

- **Startup invariant, asserted by the agent and pinned by a matrix title:** `quiet ≥ begin_send timeout + write deadline + 30 s margin`.
- **Never re-sent automatically:** an image or a driver create whose outcome is unknown. It goes to the office as `outcome_unknown`.

**D-MK11, outcomes for a stop already cleared in McLeod.**
- If McLeod's times equal ours **to the second**: `confirmed already_applied`.
- If McLeod's times differ: terminal `already_in_mcleod`, which is not an exception.
- If the stop is already `D` at enqueue time: no request is created.

The second-level equality depends on MK0 probe K13, which writes a non-zero second and reads it back. If K13 shows McLeod rounds, equality is checked at the precision K13 measured, and that precision is stored in `mcleod_api_capabilities`.

**D-MK12, switches**. This replaces ROUND3 §2.4, which V4 broke on five counts.
- **Modes:** `off`, `test`, `canary`, `live`. There is one row per org × operation × company.
- **Who creates rows:**
  - Rows other than `off` are created **only through the internal platform console** (`apps/admin-api`, Silvicom staff). Tenant admins can only insert `off` rows, which is the kill.
  - So no tenant admin can turn writes on, and a second McLeod tenant cannot be switched on by its own admin without our recorded approval (R4-7).
- **`test`** writes only to companies in **`mcleod_test_companies`**:
  - a new append-only table;
  - rows inserted only through the platform console;
  - each row stores the `/metadata` company name MK0 read.
  - Every report, census, seat count, board and Ask AI reader excludes these companies through one SQL function, `is_mcleod_test_company(org, company_id)`. It is **not** in `org_integrations.config`, which is mutable and could open `test` on the live company (V4 §2.4).
- **`canary`** requires both of:
  - `canary_scope jsonb`: `{"stop_types": [non-empty subset of "pickup","delivery"], "customer_ids": [non-empty]}` for stop operations, or `{"subject_ids": [non-empty]}` for the others. Enforced by a CHECK plus a trigger. An empty scope is refused.
  - **Either** a confirmed `test` request for the operation, **or**, for `stop_clear` only when the org has no test company, a non-empty `approval_ref` (the owner's written OK, quoted with its date). Every other operation needs a test company (R4-3).
- **Stop requests** carry `stop_type` and `customer_id` columns, so the claim can evaluate the scope.
- **`live`** requires all three:
  1. A non-empty `approval_ref`. This is the owner's first sign-off, ruled 2026-11-19.
  2. Confirmed canary requests covering **each** stop type the live row allows.
  3. If any customer flagged as EDI is in scope, a confirmed canary request on an EDI customer (D-MK33).
- Every `leased` event records the switch row id that allowed it.
- A tenant `off` row takes effect at the next claim. A request already leased finishes its current send, and then nothing more is sent (council P-24).
- The fleet environment flag `MCLEOD_API_WRITES` is a **global kill only**. Turning it on enables nothing by itself.

**D-MK13, the agent credential**:
- A separate write token is required for every claim and settle call.
- The VM's egress IP is recorded on the token's row on every claim, and a change raises an alert (R3-13, R4-7).
- The IP becomes a refusal rule only after Alex confirms in writing that it is static.
- The write routes get their own limiter, keyed by token.

**D-MK14, personal data**:
- `observed` stores allowlisted keys only.
- McLeod's refusal text is redacted on the VM.
- The SSN strip happens in the client's `write()` on the final body.
- A new gate, `lint:mcleod-secrets`, refuses `/ws` hosts, McLeod user names, tokens and McLeod docs using OPS-16's patterns, and allowlists the strings already public by exact match (V4 §2.12).

## 2. Driver loads and stops

**D-MK15, removed stops are kept, not deleted.** This reverses ROUND3 §2.3, which V4 broke: the `load-photos` reconciler (`storageReconcile.ts:160-213`) deletes photo objects without a stop row after 24 hours.
- A stop McLeod no longer lists gets `mcleod_removed_at` and moves to the tail.
- **Readers that compute** next stop, ETA, counts or the board skip removed stops.
- **Readers that display** stops show them labelled "Removed in McLeod", so the office sees the driver's evidence. The v2 writer lists both sets of readers by code read (`2-v2-writer.md` §2a.3).
- A queued action on a removed stop is accepted: HTTP 200, flagged `late_evidence`, never sent to McLeod.

**D-MK16, the stop mirror algorithm**. This is one RPC, with **each load in its own sub-block**, so a refused load does not abort the batch (V4 §2.2):
1. Move all of the load's stops to `seq + 1000`, including worked stops McLeod removed.
2. Upsert McLeod's current stops by `mcleod_stop_id` at McLeod's seq.
3. Give removed stops `mcleod_removed_at` (if not already set) and `seq = max(McLeod seq) + n`, in their previous order.
4. Assert that no seq ≥ 1000 remains, so the band is empty at commit.

Constraints:
- S0a widens `load_stops_seq_check` from `1..50` (`0423:101-102`) to `1..1999`.
- A load whose tail would pass 200 is refused by name, as exception kind `stop_mirror_refused`.
- Tested across two consecutive sweeps, an added stop and a swap (`api-kit-round4/pg/tail.mjs`).

**D-MK17, S0c** keeps `idx_load_stops_load_seq` and the band. Its only jobs:
- re-key 0453's ETA predictions: an `eta_predictions.stop_id` column, backfilled from `(load_id, stop_seq)` at migration time;
- then a separate merge for the recorder that writes `stop_id`;
- then the readers.

There is **no** "cannot roll back past S0b" (V4 §2.19/2.21).

**D-MK18, order of the stop migrations:** B2 → S0a → M-A (`driver_complete_stop`) → the pipeline migration → MK4 images. B1 precedes S0b. Each number is the next free one at merge.

**D-MK19, `driver_complete_stop` has exactly one signature change.**
- **M-A** carries every new parameter: `p_action_id` and `p_sha256` per photo (from spec D's M-D2), and `p_mcleod_write`.
- `p_mcleod_write` carries only the fleet global kill (D-MK12). The SQL reads the switch table itself.
- The 0141 signatures are dropped explicitly and the grants re-issued.
- The pipeline migration rewrites the function from M-A's body, with a `cross-module-waiver` line.

**D-MK20, driver evidence for a load the driver no longer holds** (this is ruling O-5). The predicate: the driver was **ever** dispatched the load. That covers:
- the current dispatch;
- any earlier `load_events` dispatch;
- a McLeod repower recorded in raw;
- either current seat.

For such evidence:
- the function **returns a status rather than raising**, because raising rolls the evidence back;
- the API answers 200 `{status:'late_evidence'}`;
- the event is flagged;
- nothing is enqueued;
- the office sees exception `late_evidence`.

`late_evidence` is the **only** name; `evidence_after_reassignment` is dropped. It covers: actions from a driver who is no longer current, and actions on a removed stop.

**D-MK21, the outbox**:
- **Never dead-letters** on network failures or 5xx, using backoff capped at 15 min. R3-5's "a 500 counts toward 8 attempts" is **rejected**.
- **A 4xx** with a code goes to Needs attention as today.
- The API returns `{code}` in every error body, and `SyncError` keeps it (V4 §2.6).
- Each record gets `first_failed_at`.
- After 60 min of failure, the phone shows "Not sent yet. Keep the app open where you have signal."
- **No phone-side FIFO.** Complete carries its own Arrive time and action id, and the agent clears a movement's stops in order.

**D-MK22, the office signal for a silent phone** is derived on the server. On an active load, the office sees "Driver's phone last reached us at HH:MM" when the last contact is more than 60 min old. This replaces ROUND3 §2.6's "alert per load", which cannot be built for a phone with no signal. Last contact is the latest of the driver's `load_events.recorded_at` and their push-registration `updated_at`; the v2 writer confirms both columns by code read.

**D-MK23, `action_id`** is required on **every** driver load action (accept, decline, start, stop actions) from the first store build. It is safe because no driver build is installed. Before the API starts refusing actions without one, the v2 writer runs R3-21's install count on `app_version` (`notifications.ts:182`) and records the result.

**D-MK24, plausible times.**
- `occurred_at` may be at most **5 min** in the future. It is a tunable in D-MK10's file.
- The real skew is measured as `occurred_at - recorded_at`, p99, from `load_events` (V4 §2.9 sign fix), and the tunable is set from that measurement.

**D-MK25, the driver's delivered window** is 14 days, keyed on `coalesce(external_closed_at, completed_at)` (V4 §2.18). Late evidence is always accepted regardless. Reads use the existing `fetchAllPagedIn`.

**D-MK26, store build.** `driver-store.yml` uses `fetch-depth: 0`, fetches `production`, and runs `is-ancestor` on every trigger, `workflow_dispatch` included. Every newly read field has a default.

**D-MK27, C-A2 is rebased onto the merged V5–V7 screens.** It no longer "merges first". Every spec-A line reference into `[id].tsx` and `stop/[stopId].tsx` is re-read.

## 3. Office, roster and documents

**D-MK28, "Hire again"** reopens the former row: terminated → applicant, keeping the McLeod id, audited.
- **N-16's roster migration** re-creates `hire_applicant` so the close clears `termination_date` and `archived_at`.
- **While `driver_reactivate` is not `live`:** the D-RL5 sweep hires a reopened row **only** when McLeod shows that driver active with a `hire_date` on or after the reopen date. That is a hand reactivation in McLeod. Otherwise it skips the row (V4 §2.10).
- **C-16's link** (`linkHiredDriverToTms`) runs only for 360-hired rows with no McLeod id.
- **Who may press it:** managers only, until Q-3 is ruled.

**D-MK29, images.**
- 360's copies go into a **distinct McLeod image category**, picked once per kind by a person from `documentTypes`, so billing can tell them from the capture app's.
- Filing runs **beside** the capture app (ROUND3 §2.17).
- **The confirmation rule** (council OF-8): an image is filed if the returned id appears in the order's list, or if exactly one new image matches; two or more matches are ambiguous and never re-sent.
- **The echo guard:** the revised-RC reader skips known 360 image ids.

**D-MK30, where a `/ws` image lands** has a build for every answer (closes `2-v2-writer.md` §2d.1):

| McLeod's answer | Build |
|---|---|
| Stored on the order and visible in `GET /images/O/{id}` | MK4 as designed |
| Staged for batch | Confirmation by a later list read, re-read at 15 min, 1 h and 24 h, then `conflict accepted_not_visible` |
| Needs a DocumentPower module we do not own | MK4 stays `off`; Q-10 cost rule applies |
| Lands somewhere billing cannot see | MK4 stays `off` |

## 4. Operations, alerts, staff

**D-MK31, alerts** go through the existing alert-routing catalogue (`alertRouting.ts`). A new category, `mcleod_write`, ships with its CHECK migration. Recipients follow the operation's section:

| Operation | Recipients |
|---|---|
| Stops | Dispatch |
| Medical card, CDL | Safety |
| Hire, reactivate | Recruiting |
| Units | Fleet |

- **Critical alerts** (pipeline stopped, `enqueue_failed`, two connectors claiming) also go to the org's notification email list.
- **There is no after-hours paging in the product**, and v2 says so plainly. That is safe because a stopped pipeline loses nothing: requests wait and evidence is kept.
- **Recipients** are resolved by section capability, never through `surfaceHolders()` on `mcleod.connection` (R4-6).

**D-MK32, the exceptions feed.** Both `load_events` reads in `exceptions.ts` page through `fetchAllPagedIn` (R4-8).

**D-MK33, which customers are EDI.**
1. The v2 writer reads `queries.mjs` for a selectable EDI field on McLeod's `customer` row.
2. If one exists, the next connector update reads it.
3. If none exists, the Alex message asks for the list.
4. Until either is known, `canary_scope.customer_ids` holds only customers Alex names in writing as non-EDI, and **no `live` row for deliveries** can be created.

**D-MK34, staff go-live step.** Every operation's switch to `canary` and to `live` comes with a briefing note written in plain words. It says who stops doing what by hand, for example "dispatchers no longer clear stops for these customers". The note is stored in the switch row's `reason`, and the person named in Q-9 reads it before the platform console accepts the row.

**D-MK35, McLeod upgrade.**
- A new agent mode, `--schema-check`, built on `inspect.mjs`, verifies every column `queries.mjs` names.
- On notice of an upgrade:
  1. Writes and parity go `off` the night before.
  2. Each SQL feed resumes only when its statements pass.
  3. The `/ws` MK0 checks re-run before any switch returns to its previous mode (R4-1).

**D-MK36, Lockwood's conditions**:
- Each condition he attaches maps either to an existing lock or to one new tested rule. One such rule is `allowed_hours` on the switch row.
- A condition that maps to nothing keeps its operation `off`.
- If he withdraws his OK, every switch goes `off` in the platform console the same day (R4-2).

**D-MK37, token revocation**:
- If MK0 shows that disabling the McLeod user does **not** revoke an issued token, v2 drops the "instant stop" claim and uses short-lived login tokens with logout.
- If tokens shorter than 15 min stall against the re-login cap, the cap becomes "re-login when the token is within 2 min of expiry".

**D-MK38, the connector update.**
- **Load-rates R4 (PR #2602) ships alone**, as its plan rules ("no request to Alex"). ROUND3 §2.22's bundle is **withdrawn**: it overturned a recorded owner ruling.
- **B4's reference-number statements**, the test-company read and the `/ws` client (all lines off) form **one later connector update**, with **one** SQL review by Alex and **one** VM visit.
- Every API Kit setting lives in `mcleod-ws.env`, which Alex places on the VM during that visit.
- `update-connector.ps1`'s success check gains the `/ws` failure lines. That is a change to the script, and it ships in the same PR.

**D-MK39, MK0 Phase B** parses on the **API side** from the uploaded `docs_gz`. This keeps the agent minimal, and the parser is tested in CI and on staging.

**D-MK40, termination reason**:
- MK0 reads McLeod's `reason_for_leaving` code table (probe K25).
- If it is not readable, the Alex message asks for the list.
- The office picks a code from McLeod's list, and nothing is guessed.

## 5. Owner questions, the complete list (nothing else waits on the owner)

| # | Question | Recommendation |
|---|---|---|
| Q-1 | A new hire or reactivation carries name, DOB and CDL number **once**; the O-2 no-write rule covers later edits only. | Yes |
| Q-2 | Clearing a stop creates a non-reportable, uncoded service-failure record. Keep `isReportable=false` and let the test company and Alex decide whether dispatchers want those records. | Yes |
| Q-3 | May recruiters press "Hire again"? (Managers only until ruled.) | Yes |
| Q-4 | The O-7 sentence: the new hiring rule in your own words. | — |
| Q-5 | Start the Apple Individual → Organization conversion and the store filings now. | Yes, today |
| Q-6 | A standing OK for hotfix releases of `tools/mcleod-agent` and `/api/tms` routes during MK0. | Yes |
| Q-7 | If McLeod user security does not apply to `/ws`, proceed only with credentials on the VM alone, every call logged, and a weekly review. | Yes |
| Q-8 | Drivers see delivered loads for 14 days. | Yes |
| Q-9 | Name the go-live contact who reads each briefing (D-MK34), for example the dispatch lead. | A name |
| Q-10 | Cost rule: any charge beyond the quoted ~$750/month (per call, per seat, a module, an upgrade) pauses the affected operation until you approve it. | Yes |

Also requested once: the 11-11 meeting notes and the Ron emails, if they exist.

## 6. Outside answers the plan waits on

Every row has a build for every outcome in `api-kit-round4/3-outcomes.md` Part A, plus D-MK30, D-MK33, D-MK35, D-MK36, D-MK37 and D-MK40.

| What we wait on | Who answers | What it blocks | Answer if never given (10 business days, then escalate) |
|---|---|---|---|
| `/ws` on 22.1, plus URL and certificate | McLeod | the whole API program | API program paused; the N-steps and finance continue |
| Write-capable test company | McLeod or Alex | every switch except a `stop_clear` canary | Only a `stop_clear` canary with `approval_ref` is possible |
| Lockwood's written OK | Alex Lockwood | every write | Hard stop on writes |
| `clearStop` effects and undo rehearsal | Alex Tzakov | stop canary | Stop canary waits |
| Where `/ws` images land | McLeod | MK4 live | MK4 `off` |
| Date mode and precision | MK0 probes K6, K13 | every time write | — |
| Token revocation | MK0, McLeod | the instant-stop claim | D-MK37 |
| Static IP | CloudWatch, Alex | the IP refusal rule | IP recorded and alerting only |
| Store release | Owner (Q-5) | every driver benefit | Android first, iOS through external TestFlight |
| EDI customers | queries.mjs, Alex | `live` for deliveries | D-MK33 |

**The messages.** One to **Alex Tzakov, Cc Alex Lockwood**, and one to **McLeod via Ron**. The full item lists are in `api-kit-round3/3-external.md`, with these items added:
- the EDI list (D-MK33);
- the `reason_for_leaving` codes (D-MK40);
- the test-company SQL, inside the one SQL review (D-MK38).

**What "nothing left open" means for v2.** Every step is either fully determined, or blocked on one named answer in this table or §5, with its build for each outcome written out.
