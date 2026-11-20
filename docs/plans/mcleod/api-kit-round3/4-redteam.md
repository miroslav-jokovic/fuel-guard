# Round 3 red team: COUNCIL-2026-11-20-API-KIT.md and api-kit-council/{1..5}.md

Repo `/Users/miroslavjokovic/Projects/FG-mcleod-api` at `1c8ed3583`. Read-only. My own executable checks are in
`/private/tmp/claude-501/-Users-miroslavjokovic-Projects-FuelGuard/77d282ee-6821-4d7e-bafa-eb3616447ed2/scratchpad/round3/pg/`
(`band.mjs`, `pdf.mjs`). The McLeod pages were fetched live on 2026-11-20 into `round3/ws/`.

## 0. The council's PGlite checks, re-run

To run them, `cd docs/plans/mcleod/api-kit-council/pg && node t1.mjs` (then t2, t3). They are self-contained, but they
import PGlite by an **absolute path** into `/Users/miroslavjokovic/Projects/FuelGuard/node_modules`, so they do not run
on a fresh clone or in CI. They are not `supabase/tests` matrices.

| Script | Result today | Matches the council? |
|---|---|---|
| t1 | org delete cascades; deleting a referenced stop or load is refused with "violates RESTRICT" | yes (P-20/P-21) |
| t2 | `RESULT: 15 passed, 0 failed` | yes |
| t3 | claim 63/44/54 ms; daily sweep 146 ms; driver read 2 ms | yes ("about 55 ms") |

The tests pass, but they cover less than COUNCIL §5 says. See R3-1.

## 1. Verification table (52 claims)

| # | Claim (where) | Source opened | Verdict | Evidence |
|---|---|---|---|---|
| 1 | pdf-lib 1.17.1 is deterministic with `updateMetadata:false`, and writes no `/ID` (COUNCIL §2.11, OF-10) | `FuelGuard/node_modules/pdf-lib/package.json:3`; `cjs/api/PDFDocument.js:139-150`; `core/PDFContext.js:32`; **executed** `round3/pg/pdf.mjs` | CONFIRMED | two builds 1.1 s apart: identical sha256 with `false`, different with `true`; output has no `/ID`, no `CreationDate`, no `Producer` |
| 2 | `claimNext` takes the oldest due record over all records (`outbox.ts:94-110`) | `apps/driver/src/data/outbox.ts:95-110` | CONFIRMED | `where status in ('pending','failed') and next_attempt_at <= ? order by created_at asc limit 1` |
| 3 | In airplane mode nothing is claimed (`sync.ts:175-178`) | `apps/driver/src/data/sync.ts:175-178` | CONFIRMED | `if (!onlineManager.isOnline()) { await refreshCounters(); return; }` |
| 4 | 8 attempts, then dead-letter (`policy.ts:24, 99-101`) | `policy.ts:24`, `outcomeAfterFailure` | CONFIRMED | `MAX_ATTEMPTS = 8`; `!transient \|\| attempts >= MAX_ATTEMPTS → 'dead'` |
| 5 | 429 never dead-letters | `policy.ts` 429 branch | CONFIRMED | returns `failed` before the cap check |
| 6 | A 5xx counts as transient | `policy.ts` `isTransient` | CONFIRMED | `return status >= 500` (this matters for R3-5) |
| 7 | Pure `pickNext` restates `claimNext` (DR-9) | `policy.ts:55-62` | CONFIRMED | oldest eligible by `createdAt` |
| 8 | Same-status replay returns before the photos are inserted (`0141:310-312` vs `:350`) | `0141_driver_load_rpc_contract.sql:310-312, 349-350` | CONFIRMED | `if v_stop_status = p_status then return;` sits before `insert into public.load_stop_photos` |
| 9 | `v_now := coalesce(p_occurred_at, now())` (`0141:287`) | same file `:287` | CONFIRMED | verbatim |
| 10 | Stop actions need load `accepted\|in_transit` (`0141:304-306`) | `:304-306` | CONFIRMED | DL003 |
| 11 | A Complete from pending fabricates the arrival (`0141:342`) | `:342` | CONFIRMED | `arrived_at = case … arrived_at is null then v_now` |
| 12 | `p_actor_user` defaults to null (`0141:274`) | `:274` | CONFIRMED | `p_actor_user uuid default null` |
| 13 | 0141 is today's `driver_complete_stop` | `grep -rlE "function (public\.)?driver_complete_stop" supabase/migrations` | CONFIRMED | only 0087 and 0141 define it |
| 14 | `load_stops_seq_check` is 1–50 | `0085_driver_loads.sql:123`; `0423…:101-102` | CONFIRMED | `check (seq >= 1 and seq <= 50)` |
| 15 | OTA and APK lanes were deleted in `d313fa8a1` on 2026-10-22 | `git show --stat d313fa8a1` | CONFIRMED | −`driver-android.yml` (236 lines), −`driver-ota.yml` (164), −`apps/driver-dist/*`; dated Thu Oct 22 2026 |
| 16 | `driver-store.yml` says "NOTHING BELOW HAS EVER RUN" | `.github/workflows/driver-store.yml:12-15` | CONFIRMED, header stale | `:9-10` still says the store lane and `driver-android.yml` "coexist", but that workflow was deleted |
| 17 | `driver-store.yml` has no "is this commit in production" check (DR-4) | `driver-store.yml:28-62` | CONFIRMED | `checkout@v4` (shallow), `require-ci-green` only; also a `workflow_dispatch` trigger from any ref |
| 18 | The application link refuses non-applicants (`applicationLink.ts:88`) | `apps/api/src/modules/recruiting/applicationLink.ts:88-90` | CONFIRMED | 409 `not_an_applicant` |
| 19 | The hire refuses non-applicants (`hireApplicant.ts:210`) | `hireApplicant.ts:210-212` | CONFIRMED | `not_an_applicant` |
| 20 | `hire_applicant` raises on non-applicants; it sets only status and hire_date (`0386:119,126-128`) | `0386_applicant_hire_guard.sql:118-130` | CONFIRMED | HA010; `set status='active', hire_date=…, updated_at` — `termination_date`/`archived_at` untouched |
| 21 | Moves into `applicant` are allowed (`0386` header) | `0386:33-34` | CONFIRMED | "Moves INTO 'applicant', and inserts, are untouched" |
| 22 | MD010 refuses merging a row with a filed application (`0387:45`) | `0387_packet_countersignatures.sql:44-45` | CONFIRMED (a comment that cites MD010, not its definition) | "MD010 refuses a driver with a filed application" |
| 23 | `uq_drivers_org_mcleod` (`0239:62`) | `0239_mcleod_roster_links.sql:62-63` | CONFIRMED | partial unique `(org_id, mcleod_driver_id)` |
| 24 | A rehire's second application is a second invitation (`0337:23-25`) | `0337_application_edits.sql:23-25` | CONFIRMED | verbatim |
| 25 | `wouldClaimFromTelematics` is a third reader of `DRIVER_IDENTITY_FIELDS` (`driverEditMeaning.ts:42-48`) | `packages/shared/src/driverEditMeaning.ts:42-48` | CONFIRMED | `DRIVER_IDENTITY_FIELDS.some(...)`; also imported at `:2` |
| 26 | The drivers claim trigger includes `phone` (`0241:124-129`) | `0241_identity_provenance_claim.sql:124-129` | CONFIRMED | args `'full_name','first_name','middle_name','last_name','phone'` |
| 27 | A parity test pins the trigger to the list (`claimParity.test.ts:113-116`) | `rosterFields.claimParity.test.ts:113-116` | CONFIRMED | `toEqual(new Set(DRIVER_IDENTITY_FIELDS))` |
| 28 | Stop photos are 1600 px at q0.6 (`stopCapture.ts:21-22`) | `apps/driver/src/features/loads/stopCapture.ts:21-22` | CONFIRMED | `MAX_WIDTH = 1600`, `JPEG_QUALITY = 0.6` |
| 29 | Our SQL reads `tractor_status` (`queries.mjs:91`) | `tools/mcleod-agent/queries.mjs:91` | CONFIRMED | `NULLIF(LTRIM(RTRIM(t.tractor_status)),'') AS tractor_status` |
| 30 | The lock is a file, and a stale lock is removed even when its pid is alive (`service.mjs:125-160`) | `service.mjs:107-160` | CONFIRMED | `LOCK_STALE_MS = 2 min`, `LOCK_HEARTBEAT_MS = 30 s`; `alive && fresh` is needed to refuse |
| 31 | `POST_ATTEMPTS = 4` (`service.mjs:25`) | `service.mjs:24-25, 45-80` | CONFIRMED, **incomplete** | also `POST_TIMEOUT_MS = 60_000` per attempt, which neither P-1 nor P-10 uses (R3-4) |
| 32 | 0453 is keyed on `stop_seq` | `0453_load_stop_eta_predictions.sql:45,63` | CONFIRMED | `stop_seq integer not null`; index `(org_id, load_id, stop_seq)` |
| 33 | `.gitleaks.toml` calls committed private keys TEMPORARY | `.gitleaks.toml:14-28` | CONFIRMED | "committing private keys defeats secret-scanning signal" |
| 34 | Alex said "one program, one connection" (`mail.md:38`) | `docs/plans/mcleod/mail.md:38` | CONFIRMED | verbatim |
| 35 | Alex forbade `name_of_spouse` writes (`mail.md:89`) | `mail.md:~88` | CONFIRMED | verbatim |
| 36 | `update-connector.ps1` refuses any change other than ROSTER_MODE (OPS-5, C-21) | `update-connector.ps1:1-25, 184-197` | CONFIRMED, OVERSTATED | It is a self-check on the script's **own** `-RosterMode` write. It does not stop another script, such as the existing `set-connector-line.ps1`, from adding lines (R3-15) |
| 37 | The post-restart check is blind to `/ws` failures (`:232`) | `update-connector.ps1:232` | CONFIRMED | regex has no `ws`/`tls` words |
| 38 | `/api/tms` limiter is 300 per 15 min per IP (`app.ts:340-346`) | `apps/api/src/app.ts:340-347`, `:320` | CONFIRMED | plus `trust proxy 1` at `:320`, whose comment still says "Railway" |
| 39 | clearStop "creates a service failure record if necessary"; `isReportable` defaults true; text/plain "success or failure" | live `DispatchService&operation=clearStop&role=-1` | CONFIRMED | verbatim |
| 40 | Date pattern depends on `useServerTimezone`; it has seconds; tms-map is `false` | live `types?type=com.tms.common.lib.Date&role=-1` | CONFIRMED | "Currently, this vmparam is set to false" — a fact about **tms-map**, not ours |
| 41 | EquipStatusService is Drivers-only | live `services?service=EquipStatusService&role=-1` | CONFIRMED | all 5 operations list role Drivers |
| 42 | addImage may stage; its result is a batch id OR a record id | live ImagingService addImage | CONFIRMED | verbatim |
| 43 | The mirror deletes pending stops, then upserts `onConflict: load_id,seq` | `apps/api/src/modules/loads/mirrorLoads.ts:102-128` | CONFIRMED | path is `modules/loads/`, not `modules/mcleod/` |
| 44 | Stop and photo reads are not chunked (`driverLoads.ts:142-149`) | `driverLoads.ts:141-149` | CONFIRMED | a single `.in("load_id", loadIds)` each |
| 45 | `occurred_at` is optional and unchecked | `loadsContract.ts:148`; `loadsLifecycle.ts:139,145` | CONFIRMED | the field is declared in two shared files (P-16 and OPS-7 each cite one) |
| 46 | "Reads are chunked under the 1,000-row cap" is enough (C-14, DR-15 "`chunks()`") | `packages/shared/src/paging.ts:40-80` | WRONG TOOL | `chunks()` bounds the URL, not the rows; the house helper for both limits is `fetchAllPagedIn` (R3-12) |
| 47 | The schema "passed 15 of 15" (COUNCIL §5) | `pg/schema.sql` vs `1-pipeline.md` final DDL | CONFIRMED that it ran, MISLEADING about what it covers | see R3-1 |
| 48 | The image send id equals the request id, and identical bytes are refused | `api-kit-specs/D-office-finance-docs.md:204-255` | CONFIRMED | `id = mcleod_write_requests.id (same uuidv5)`; `unique (… sha256, page_no)` → R3-9 |
| 49 | The purge cannot delete a former driver (relevant to C-15) | `0380_purge_applicant.sql:18-35` | CONFIRMED | PA010 on hire/termination date or a `compliance.applicant_hired` audit row; PA012 on a McLeod link |
| 50 | Rehire clears `termination_date` by house precedent (C-15) | `apps/api/src/modules/roster/driverRehire.ts:1-45` | CONFIRMED | `restoreRehiredDriver` sets `status active, archived_at null, termination_date null`, with the old date in the audit row |
| 51 | The D-RL5 sweep hires applicant rows that match McLeod by licence and name | `apps/api/src/modules/mcleod/rosterApplicantHire.ts:1-80` | CONFIRMED | applies to a reopened row too → R3-11 |
| 52 | Committed company ids and the SQL login appear widely (OPS-16) | `git grep -l "TMS2\|silvicom_dispatch_ro"` | CONFIRMED | 57 tracked files → R3-14 |

Tally: 52 checked. CONFIRMED 46 (2 with stale or incomplete context). OVERSTATED 1 (#36). WRONG TOOL 1 (#46). MISLEADING 1 (#47). Plus line-drift notes. The council's file:line citations hold. As in round 2, the errors sit in the **reconciliation**: COUNCIL contradicts itself, drops findings, and carries fixes that break on the second run.

## 2. Findings

### R3-1 [COUNCIL-WRONG] "The corrected schema passed 15 of 15": the schema tested is not the one COUNCIL adopts
- `pg/schema.sql` is not `1-pipeline.md`'s final DDL. It has an extra event kind `office_closed` with an `actor_user` column. It allows `not_before` on `send_started`. It has no canary-proof check (only `mws_live`), no `MK013` proof trigger, no test-company list, no `settle`, no idempotent event ids, no `retry`, no per-movement order, and no `already_in_mcleod`.
- t2 inserts a `canary` row with `proven_by_request` NULL, and the insert succeeds. Under the adopted DDL (`mcleod_write_switches_proof`) that insert fails. So the 15 checks never touched the proof chain of §2.1.
- **Proven:** lease exclusivity, fence go / switched_off / already_applied, the quiet period, MK012, append-only, and the cascade.
- **Not proven:** §2.1's proof chain, C-2/C-3 settle rules, P-10 idempotency, OPS-6b stale-after-outage, §2.2's new outcomes.
- Fix (COUNCIL §5): "The pipeline core (lease, fence, quiet period, end-once, append-only, cascade) passed 15 PGlite checks on a sketch schema. The proof chain, settle, idempotent event ids, the test-company list and `already_in_mcleod` are untested. v2's pipeline migration ships with `supabase/tests/mcleod-write-pipeline.test.mjs` running the v2 DDL itself, and the sketch is deleted."

### R3-2 [COUNCIL-WRONG] C-9's scratch band collides on the very next sweep
- DR-5 steps (2) and (3): incoming stops move to `seq + 100`, and a worked stop McLeod removed is "also moved to the band (it then sorts last)".
- Executed (`round3/pg/band.mjs`), starting from A1 B2 C3(worked) D4:
  - Sweep 1: McLeod removes C and puts D at 3. It commits A1 B2 D3 **C103**.
  - Sweep 2, on any ETA change (DR-1 says that happens many times a day): step (2) moves D from 3 to 103 and fails with `duplicate key value violates unique constraint "idx_load_stops_load_seq"`.
  - The whole RPC fails, so the load freezes, and now permanently, not just until S0c. That is the regression C-9 exists to remove.
- C-10 makes this worse. Soft-removed pending stops also keep a `seq` that collides with McLeod's stops, and C-10's text never says where they go.
- I also checked the obvious alternative, a DEFERRABLE `idx_load_stops_load_seq`. It is not possible while rollback-target code upserts `onConflict: load_id,seq`. PGlite: `ON CONFLICT does not support deferrable unique constraints/exclusion constraints as arbiters`. So the band is the right kind of fix; only the parking rule is wrong.
- Fix (C-9): "The 101–150 band is scratch and is empty when the RPC returns. A worked or soft-removed stop McLeod no longer has is renumbered to the tail of the normal range (after McLeod's stops, ≤ 50), never parked in the band. This is RT-14's renumbering, and it also keeps every `seq` reader (0453, `nextStop`) meaningful. If more than 50 stops result, the load is refused by name and the office sees it. Matrix: 'two consecutive sweeps after McLeod removed a worked stop both apply'; 'a soft-removed pending stop does not block McLeod's stop at its old sequence'."

### R3-3 [CONTRADICTION] C-19's live-company canary cannot be reached through §2.1's proof chain, and its rollout order cannot be expressed by the switch table
- **(a) Deadlock.** §2.1 says `test` is legal only for companies on the org's test-company list, and `canary` needs a confirmed `prove` request.
  - C-19 and OPS-2 prescribe the fallback when no test company exists: a canary on a non-EDI test customer **of the live company TMS**.
  - TMS is not a test company, so no `test` row and no `prove` request can exist for it. `canary` then has no proof and is unreachable. This is C-12's canary deadlock, reintroduced.
- **(b) Granularity.** P-6 keys `canary` on the completing **driver's** McLeod id.
  - A driver chosen for the canary carries every customer's stops, EDI ones included.
  - C-19's "pickups, then non-EDI deliveries, then EDI" needs stop type and customer. The switch row has neither, and the request does not carry them as columns.
- **(c) Cross-org proof.** §2.13 posts the test company to a **test org in production**.
  - P-5 and the switch trigger require the proof request to be in the **same org** as the switch row.
  - So a test-company proof cannot unlock a canary in the real org.
- Fix (one rule for all three):
  - A `test` row names `test_targets`: McLeod order ids, set by an owner act. These are either all orders of a test company or the one test order of C-19.
  - `prove` requests are allowed only on those targets.
  - Requests carry `stop_type` and `customer_id` columns.
  - A switch row carries nullable `allow_stop_types text[]` and `allow_customers text[]`, plus `canary_keys` (drivers).
  - Proof is valid from the org itself or from the org named in `org_integrations.config.test_org_id`.
  - Matrix titles: "a canary on a live-company test order is reachable"; "a delivery is not leased while the switch allows pickups only"; "a proof from the declared test org unlocks the canary".

### R3-4 [COUNCIL-WRONG] C-1's arithmetic ignores the agent's real POST timing, and P-10 contradicts the retry loop it runs inside
- The agent's API calls go through `postJson`: `POST_TIMEOUT_MS = 60_000`, `POST_ATTEMPTS = 4`, gaps 1+2+4 s (`service.mjs:24-80`). One claim, `begin_send` or settle call can therefore take up to **247 s**.
- P-1 sizes the 90 s window as "write deadline 30 s + settle POST". But a `begin_send` answer alone can arrive 60 s after the database check.
- P-10 says "a lost `begin_send` answer is treated as **not** go". Yet `postJson` retries automatically. A first attempt that committed but timed out on the client is followed by a second `begin_send`, which returns `go` again and counts a **second** `send_started` against `max_sends = 3`.
- What actually prevents a double send in flight is **P-9's quiet period** (no re-lease for 300 s after a `send_started`), not the 90 s window. That only holds if `quiet_s > write deadline + worst-case settle POST` = 30 + 247 = 277 s < 300. It holds by 23 s, and no document states it.
- Fix:
  - (1) `begin_send` and settle use a **no-retry, 10 s** POST variant, and a timeout means "did not go".
  - (2) Write the invariant `quiet_s ≥ WS_WRITE_DEADLINE + settle_timeout + margin` as a startup assertion in the agent and a matrix title.
  - (3) Drop the "≥ 90 s left" rule (R3-17).

### R3-5 [CONTRADICTION] C-13 "retries until accepted", together with §2.4's per-load FIFO, gives an unbounded head-of-line block
- `isTransient` treats every 5xx as transient (`policy.ts`). A deterministic server fault on one record never ends under C-13, for example a bug in the new `driver_complete_stop` that raises and maps to 500.
- §2.4 makes the outbox FIFO **per load**, so every later action on that load (photos, the next stop's Complete) waits behind it forever, with no "Needs attention" signal.
- Today's 8-attempt cap was the circuit breaker. C-3 caps McLeod sends at 3, and C-4 refuses blind re-sends. The phone layer alone is unbounded.
- Fix (C-13): "Never dead-letter on no response, 408, 429, 502, 503 or 504 (connectivity). A 500 counts toward `MAX_ATTEMPTS` as today. After 30 min of failures the record shows 'Waiting to send — tap for details' (not dead). A `dead` record releases its load's queue." DR-9 already has the test title "a dead record of the load no longer holds the queue". Keep it, and add "a 500 that never clears dead-letters after 8 attempts and frees the load". But see R3-16: the per-load FIFO itself is not needed.

### R3-6 [CONTRADICTION] C-5's title cannot be true with its own mechanism
- C-5 says "Enqueue never fails the driver's evidence … catches only the pipeline's **named** codes" (DR-17's choice over P-17's `when others`).
- Any error that is not named still aborts the stop, the photos and the event. Examples: a CHECK on payload size (23514), a NOT NULL (23502), a cast error, a bug in a later operation's branch. The guarantee in the title is then false.
- DR-17's worry (bugs hidden) is already answered by P-17's W6 invariant: "a `stop_completed` whose payload says `enqueue_failed` → critical".
- Fix: "`exception when others` (the evidence commits). Re-raise `40001`/`40P01`, so the whole transaction is retried by the outbox. Record `enqueue_failed:<sqlstate>`. W6 alerts critical on the first one." PL/pgSQL's OTHERS does not catch `query_canceled`, so a statement timeout still aborts, which is correct.

### R3-7 [CONTRADICTION] C-6 "offset-qualified times" is valid on only one of the two server settings, and COUNCIL dropped both rival rules for the other one
- The Date page: `useServerTimezone=true` → `yyyyMMddHHmmss`, with **no zone**.
- C-6 says "DST fall-back is handled by sending offset-qualified times". That is impossible if our install is `true`, and OPS-13 makes the setting an MK0 unknown.
- For the zone-less case the reports disagree, and COUNCIL picks neither:
  - P-15: refuse the repeated hour as `conflict ambiguous_local_time`.
  - RT-22: resolve it to the earlier instant and record that.
- More parts of C-6 are underspecified:
  - "Not in the future" has no tolerance. P-16 allows 2 min and OPS-7 allows 5 min; a phone a few seconds fast would lose its write.
  - "Not before the stop was dispatched" must mean the **first** dispatch to this driver. A re-dispatch after the pickup was worked would otherwise refuse a legitimate Complete.
  - The **arrival** carried by Complete (C-12, §2.4) is also a phone time, and C-6 bounds only `occurred_at`.
- Fix (C-6):
  - "With `Z` available, send `-0500/-0600`, percent-encoded. Zone-less: the repeated hour is refused as `conflict ambiguous_local_time` (P-15; about 1 h a year, no guessing).
  - Bounds on both arrival and departure: `≤ now() + 2 min`, `≥` the first `load_dispatches.sent_at` naming this driver − 5 min, and `arrival ≤ departure`."

### R3-8 [COUNCIL-WRONG] C-11's `is-ancestor` step fails closed on every run as written
- `driver-store.yml` uses `actions/checkout@v4` with the default shallow fetch. `origin/production` does not exist in that clone, so `git merge-base --is-ancestor "$GITHUB_SHA" origin/production` errors, and the build never runs.
- The workflow also has a `workflow_dispatch` trigger from any ref, which bypasses the tag-only intent.
- Fix: "`git fetch --no-tags --filter=blob:none origin production` (or `fetch-depth: 0`), then the `is-ancestor` check, for BOTH the tag and the dispatch triggers. Workflow test: a dispatch from `main` ahead of production is refused."
- Related: the header at `:9-10` still describes the deleted `driver-android.yml` "coexisting". Correct it in the same PR (it is evidence of DR-3).

### R3-9 [CONTRADICTION] Deterministic PDFs plus two unique indexes make "Send again" impossible
- Spec D's sends table uses `id = mcleod_write_requests.id` (a uuidv5 of the source key and sha), with `unique (org, company, row_type, row_id, doc_type, sha256, page_no)`.
- COUNCIL §2.11 adds unique `(stop, kind)`. AUDIT §2.6 keeps "Send again = a new request with `supersedes`".
- Because the bytes are deterministic (confirmed, #1), a Send again of a refused or conflicted paper has the **same** sha. It violates the bytes index, the `(stop, kind)` index, and, through uuidv5, the request's primary key.
- C-4's "office decides" path for an `outcome_unknown` image therefore has no action that works.
- Fix (simpler, derived): the duplicate guard moves onto the request table that already exists. Use a partial unique `(stop_id, operation) where origin <> 'office_retry'`, the same shape as `mcleod_write_requests_driver_stop`. A retry is an `office_retry` row with a **random** id and `supersedes`. `mcleod_image_sends` keeps file facts only (path, sha, mime, `mcleod_image_id`), keyed by request id, with **no** uniqueness of its own. One guard, not three.

### R3-10 [CONTRADICTION] COUNCIL drops RT-20, yet its DDL still cannot carry D's writes
- COUNCIL cites RT-20 only for the FK (§2.5). The adopted DDL (`1-pipeline.md`) still has `origin in ('driver_app','office_retry','prove')` and `(origin='office_retry') = (supersedes is not null)`.
- D's writes have no legal origin: a hire create or reactivate (an office act), image sends (a sweep), the ETA (a job), and the medical/CDL "Update McLeod" button.
- The precedence rule ("this file wins") then hands v2 a DDL that refuses half the operations it must carry.
- Fix: adopt RT-20's list `('driver_app','office','sweep','job','office_retry','prove')`. Allow `supersedes` for `office_retry` only. Add `subject_ref text` (`image_send:<id>`, `driver:<id>`) with a per-operation check. COUNCIL §2 gets a line: "the DDL in `1-pipeline.md` is amended by RT-20".

### R3-11 [MISSED] C-15 "Hire again" interacts with two existing sweeps that no report read
- The D-RL5 sweep (`rosterApplicantHire.ts`) hires any **applicant** row matching an active McLeod driver by licence and name.
- A reopened former driver is an applicant row that still holds its McLeod id and licence. While `driver_reactivate` is off (C-16 puts it under O-7's switch), dispatch reactivates the driver in McLeod by hand, as today. The next sweep then **hires the reopened row from McLeod**. That skips the 360 close and its Q-HM5 file checks (recorded as `openSteps`, by D-RL5 design).
- The 360 close then finds `not_an_applicant`. Or, if the close came first, `driver_reactivate` targets an already-active McLeod driver.
- `rosterDriverSettle`/`restoreRehiredDriver` skip applicant rows (`:135`), so those sweeps do not collide. Only D-RL5 does.
- Fix (C-15):
  - (a) State that the D-RL5 path stays the fallback while the switch is off, and is the expected outcome for a reopened row.
  - (b) `driver_reactivate`'s precheck: McLeod already active with our hire date → `confirmed already_applied`; active with another date → `already_in_mcleod`.
  - (c) The drawer while off: "Reactivate this driver in McLeod; 360 completes the hire on the next sync."
  - (d) Matrix: "a reopened former driver whom McLeod reactivates by hand is hired by the sweep once, and the close then reports already hired".

### R3-12 [BETTER-SOLUTION] C-14: use the house helper, not `chunks()`, and the window is not what fixes the cap
- `chunks()` (`paging.ts:56`, 50 ids) bounds the **URL** only. Fifty loads × stops × photos can still pass 1,000 rows and be silently truncated.
- `fetchAllPagedIn` (`paging.ts:68-80`) exists for exactly this: "one helper, so the next set-based reader gets both ceilings by using it".
- With it, the 14-day window is a product choice, not a correctness fix. COUNCIL also picks 14 days while DR-15 proposed 30, and neither gives a reason.
- If the window stays, base it on `external_closed_at`/`completed_at`, not `updated_at`. The mirror rewrites `updated_at` on every projected change, so the window would not bound anything.
- Fix: "Stop and photo reads use `fetchAllPagedIn`, org-scoped, and throw on error. The list shows closed loads for N days (owner's pick; recommend 30, so a driver can check last month's pay week), keyed on `completed_at`."

### R3-13 [BETTER-SOLUTION] C-7's egress-IP pin is brittle and weak; the write token alone is the control
- The VM sits on Alex's LAN behind NAT. Its egress IP is the office's public address: shared by every office PC (weak), and possibly dynamic (an ISP change silently stops all writes).
- The API's client IP depends on `trust proxy 1` (`app.ts:320`, comment still "Railway") being right for Caddy on EC2.
- Fix: "A separate write-scoped token (OPS-8) is the control. Record the source IP on every claim and alert when it changes. Do not refuse on it. A refusal pin is added only if Alex confirms a static egress address in writing."

### R3-14 [COUNCIL-WRONG] C-8's new gate, as COUNCIL words it, is red on main the day it lands
- C-8: "A new gate refuses any committed `/ws` host, **company id**, **McLeod user name** or McLeod doc."
- Company ids `TMS…TMS4` and the SQL login `silvicom_dispatch_ro` are already in 57 tracked files (#52).
- OPS-16 scoped the gate correctly: no `/ws` URL other than `REPLACE_ME`, no 64-hex `CERT_SHA256`, no `-----BEGIN` outside fixtures, and "company ids **beyond the four already public**". COUNCIL dropped the qualifier.
- Fix: use OPS-16's exact patterns, and add "the test company id and the integration user name are never committed (they live only in `mcleod-ws.env`)".

### R3-15 [OVER-ENGINEERED] C-21 "`update-connector.ps1` learns to add new env lines" removes a safety property for no gain
- `update-connector.ps1`'s "exactly one line changes" is a deliberate guarantee (header `:12-17`). The house pattern for changing other lines is a separate script (`set-connector-line.ps1`, `set-lumper-feed.ps1`).
- C-21's own fourth bullet puts the `/ws` credential in `mcleod-ws.env`, written by `set-mcleod-api.ps1`, so no new line ever goes into `connector.env`.
- Fix: "`update-connector.ps1` is unchanged except its manifest and `$bad` regex (OPS-5). Every API Kit setting (`MCLEOD_API_WRITES`, `MCLEOD_WS_DATE_MODE`, the credential) lives in `mcleod-ws.env`, written by `set-mcleod-api.ps1` in the `set-connector-line.ps1` shape (stop, one change, verify, restore on failure)."

### R3-16 [OVER-ENGINEERED] §2.4's three ordering mechanisms: the phone's per-load FIFO is redundant once Complete carries its Arrive
- The two server-side parts already cover it:
  - Complete carries arrival plus `arrive_action_id`, so a late Arrive dedupes, and McLeod's arrival no longer depends on phone order.
  - The agent clears a movement's stops in sequence, so McLeod's order is enforced where McLeod is written.
- The phone's per-load FIFO then protects nothing. Its only effect is the head-of-line block of R3-5.
- Fix: "`claimNext` calls the pure `pickNext` (deriving beats restating), oldest due first, as today. No per-load FIFO. The ordering guarantees live on the server, where they are tested in one place." Keep DR-9's matrix title "a Complete that carries its Arrive records the arrival once".

### R3-17 [OVER-ENGINEERED] C-1 has four overlapping guards; two would do
- The guards are: lease (300 s), "≥ 90 s left", P-9's 300 s quiet period after `send_started`, and single-flight.
- The quiet period alone prevents a re-lease while a send can still be in flight (R3-4). "Lease is newest and live" prevents a stale holder sending. The 90 s rule adds nothing once the begin_send POST is short and has no retry.
- Keep: lease + `begin_send` (newest live lease, switch, cap, no `applied_unverified`) + the quiet period with its invariant. Drop "≥ 90 s left".

### R3-18 [BETTER-SOLUTION] C-10 soft-remove costs 14 readers; DR-6(b) keeps the evidence with none
- C-10 adds `mcleod_removed_at`. That means a column merge, a reader merge, and a filter on 14 `.from("load_stops")` call sites, each of which must remember it (a restated rule). It also creates the seq problem of R3-2.
- The case is rare: a pending stop removed while a driver is offline at it. DR-6(b): DL005 on a **tms** load returns 410 `stop_removed`. The RPC records the evidence as a `load_events` row (`stop_evidence_orphaned`, with the action id, the stop snapshot from the payload, and the photo rows on the load) and lists it in the exceptions feed. No reader changes.
- Recommend (b). Keep worked stops as today, renumbered per R3-2. If the office wants "Removed by dispatch" on worked stops, derive it from the latest mirrored movement, not a column.

### R3-19 [CONTRADICTION] RT-21 vs P-27: lease rows as permanent evidence. COUNCIL is silent, and the precedence rule does not settle it
- P-27 keeps `leased`/`send_started`/`transient` in an append-only table inside `RETENTION_FORBIDDEN`. That is about 4 events per request, roughly 2,800 per day, so about 1M rows a year kept forever. Memory: the database is micro and swapping, and growth is already three tables.
- RT-21 proposed a mutable lease row. COUNCIL never mentions RT-21. "This file wins" applies only to disagreements, so v2's author faces two live, conflicting reports.
- Better than both: keep P-27's single event log (no second source of truth), but put only `mcleod_write_requests` and the **terminal** facts in `RETENTION_FORBIDDEN`.
  - Move `leased`, `send_started` and `transient` into a sibling table, `mcleod_write_attempts`. It is append-only, with retention of 180 days after the request ends.
  - The forensic question "did we write McLeod twice?" is answered by `send_started`, so the retention period must cover the audit horizon: 180 days, the owner's to set.
- State the row budget in `table-lifecycle`.

### R3-20 [MISSED] COUNCIL silently drops findings that v2 still needs; the precedence rule makes them ambiguous
- Dropped from COUNCIL, with no disposition:
  - RT-8: ETA writes only on change ≥ 30 min, never on a timer. That is ≈ 2,400 call-ins/day otherwise. C-18 has no cadence rule.
  - RT-17: orphan sweep and backup of the `mcleod-outbound` bucket.
  - RT-25: O-1 approves a v2 list that does not exist yet.
  - OPS-12: the precheck compares the stop's `company_id`.
  - P-13: no older open request on the same target. It is in the claim but not in COUNCIL.
  - P-20: `prove` requests carry no stop FK, otherwise the mirror fails every sweep.
  - DR-19: C-A3.
  - DR-14: a dispatch nobody can see.
  - OF-17/OF-18: home time.
- Fix (COUNCIL §0): "Every report finding not named here is **adopted as written** unless listed in §6 'Rejected'". Then list the rejections with a reason: DR-17's named-codes rule (R3-6), RT-21 (R3-19), the 90 s window (R3-17), the phone per-load FIFO (R3-16).

### R3-21 [MISSED] DR-19 / C-A3 are simpler than any report says, because no driver build exists
- "Today no driver uses the app at all", and C-11 requires that the first store release carries the action-id client. So no installed build will ever post without `action_id`.
- The state-based fallback and the adoption gate (DR-19) protect a population of zero.
- Fix: "`action_id` is required from the first store release. The optional path and its gate are not built." One condition first: query `app_version` in the push registrations (`notifications.ts:182`) for any device from the retired APK lane. If there are none, ship it required.

### R3-22 [MISSED] C-17's 98%-readable trial needs work that the rule already makes unnecessary
- OF-11 itself says: until the gate passes, "360 files them beside McLeod capture, and drivers are not told to stop using it".
- In that state billing still has McLeod's scan, so a readability trial has nothing to protect. The gate only matters when McLeod capture is **retired**, which is not in this plan.
- Fix: "BOL/POD filing goes live beside McLeod capture with no trial. Retiring McLeod capture is a separate decision, and that decision carries the readable-rate gate (or the scanner on stops)."
- C-17's echo-loop skip (OF-9) and the seen-rule (OF-8) stay.

### R3-23 [MISSED] §2.13's test org in production needs a second ingest token and agent code; COUNCIL says only "one connection, no new egress host"
- Ingest tokens are per org (hashed, looked up per org, `tmsIngest.ts:34-51`). The agent has one `FUELGUARD_INGEST_TOKEN` and one `companyId` (`agent.mjs:175`).
- Posting the test company to a test org therefore needs a second token in `connector.env`, a code path to post per (company → token), and an `is_test_org` exclusion in every cross-org aggregate (admin console, seats, billing).
- Simpler alternative: keep the test company in the real org. Rows are already per company (`prefix`, `res.companyId`). Hide `company_id ∈ test_companies` from the boards with one shared predicate. No second token, no second org, and the proof chain stays same-org (R3-3c disappears).
- Recommend the alternative. If the owner prefers the test org, R3-3's `test_org_id` rule is required.

### R3-24 [OK] Items that hold
- C-2 (facts from any lease; `seq` ordering; expiry derived), C-3 (with the precision "a 200 whose text matches a failure text MK0 recorded"), C-4, C-12, C-16, C-20, C-22 and C-23 are the right fixes.
- C-23's `phone@samsara` argument encoding is acceptable. It keeps one trigger and one list.
- §2.11's pdf-lib claim is exactly right (#1).
- §2.14's re-key of 0453 is right. With R3-2's renumbering, the re-key becomes optional; keep it anyway, because a stop id is the honest key.

## 3. Summary

**Verification:** 52 claims checked. 46 CONFIRMED (2 with stale or incomplete context), 1 OVERSTATED, 1 wrong tool, 1 misleading scope, plus line-drift notes.

**PGlite:** t1 OK, t2 15/15, t3 ≈ 55 ms, all reproduced. The tested schema is not the adopted DDL (R3-1). My own run shows C-9's band breaks on the second sweep (R3-2).

**Findings (24):** COUNCIL-WRONG 5 (R3-1, 2, 4, 8, 14) · CONTRADICTION 8 (R3-3, 5, 6, 7, 9, 10, 19, plus R3-20's precedence gap) · BETTER-SOLUTION 4 (R3-12, 13, 18, 23) · OVER-ENGINEERED 3 (R3-15, 16, 17) · MISSED 4 (R3-11, 20, 21, 22) · OK 1 (R3-24).

**Top 10**
1. **R3-2:** C-9's scratch band leaves removed worked stops at seq+100, and the next sweep hits a unique violation, so the load freezes permanently (executed). The band must be empty at commit, with the tail renumbered. A deferrable index is impossible while old code uses `ON CONFLICT (load_id,seq)` (executed).
2. **R3-3:** §2.1's proof chain deadlocks C-19's live-company canary, cannot cross into §2.13's test org, and the switch cannot express "pickups, then non-EDI, then EDI". Fix: test targets, stop-type and customer columns, and a declared test org.
3. **R3-9:** deterministic PDFs plus the bytes-unique, `(stop, kind)`-unique and uuidv5 keys make "Send again" impossible. Use one partial unique on requests; retries get random ids.
4. **R3-10:** the adopted DDL's `origin` list still refuses every office, sweep or job write (RT-20 was dropped).
5. **R3-5 + R3-16:** "retry until accepted" plus per-load FIFO lets one 5xx block a load forever. Drop the phone FIFO; keep the 500 cap.
6. **R3-4 + R3-17:** C-1 ignores `postJson`'s 60 s × 4 retries; the quiet period is the real guard, with 23 s of margin. Make begin_send/settle no-retry; drop the 90 s rule.
7. **R3-6:** C-5 "named codes only" contradicts its own title; use `when others` with the W6 alert.
8. **R3-11:** "Hire again" plus the D-RL5 sweep hires the reopened row from McLeod while reactivate is off. State it, precheck it, test it.
9. **R3-8 + R3-14:** two COUNCIL fixes are red on day one. `is-ancestor` against a shallow clone with no `origin/production` fails every build. The secrets gate as worded fails on 57 tracked files.
10. **R3-1 + R3-20:** "15/15" covers a sketch, not the adopted DDL. COUNCIL silently drops RT-8, RT-17, OPS-12, P-20, DR-14 and more. Add "adopted unless rejected" and a rejected list.
