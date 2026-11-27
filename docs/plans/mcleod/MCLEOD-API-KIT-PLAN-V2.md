# McLeod API Kit plan, v2 (index)

**Status:** PLAN, written 2026-11-27 against `origin/main` `6c13bf033` (migrations end at `0653_warning_desk.sql`).
Nothing below is built. Track documents:

| Track | Document | Written by |
|---|---|---|
| T1 driver loads and data fixes (Track N, store track, Hire again's roster side) | `v2/T1-driver-and-data.md` | chat 2 (`HANDOFF-2026-11-27-V2-CHAT2.md`) |
| T2 transport and the write pipeline (Track T) | `v2/T2-transport.md` | chat 1 (this commit) |
| T3 office, documents, finance (Track D), re-rulings, the two messages | `v2/T3-office-docs-finance.md`, `v2/RE-RULINGS.md`, `v2/ALEX-MESSAGE-DRAFT.md`, `v2/MCLEOD-MESSAGE-DRAFT.md` (drafts, not sent) | chat 3 (2026-11-27, `HANDOFF-2026-11-27-V2-CHAT3.md`) |

**Superseded.** This file and its three track documents replace `MCLEOD-API-KIT-PLAN.md` (v1, PR #2572) as the build
plan. v1 stays as the record of the 2026-11-19 rulings; where the two differ, v2 and the register win. The ranking is
the register's (`DECISION-REGISTER-2026-11-20-API-KIT.md` top): the register outranks every API Kit document,
including this one; on a point it does not cover, round 4, then round 3, then the council, then the audit, then the specs.

**Public repository.** No `/ws` host, McLeod or SQL user name, token, IP address, company id or McLeod document is
written in any v2 file (D-MK14). On 2026-11-27 the older McLeod documents on this branch were scrubbed of those values
in favour of placeholders (`<customer-hosted /ws docs>`, `<LME SQL LAN IP>`, `<VM LAN IP>`, `<LME SQL host>`,
`<imaging host>`, `<read-only SQL login>`, `<analytics SQL login>`, `<integration user>`, `<test driver code>`). The
same values remain in `tools/mcleod-agent/**` (config examples, review files the VM's manifest checksums) and in 13
documents outside `docs/plans/mcleod/`; T-2 removes them from the agent tree in the PR that lands the gate (see
`v2/T2-transport.md` §T-2), because a review file changed outside a connector commit breaks the VM's checksum list.

---

## 1. Decisions

D-MK1..D-MK5 are v1's, ruled 2026-11-20 (AUDIT §5 O-1) with the register's amendments. D-MK6..D-MK40 are the register's,
one line each; the register's text is the decision, this line is its index.

| ID | Decision (one line) | Track |
|---|---|---|
| D-MK1 | One write pipeline whose evidence is written first and never depends on McLeod; its shape is now D-MK6 | T2 |
| D-MK2 | 360 writes only the facts listed (O-2: medical-card expiry, CDL expiry, a new hire, termination/rehire, stop times, unit status, papers), each through `/ws`, never SQL | T2/T3 |
| D-MK3 | No write on a live company before it is proven; the proof chain is now D-MK12 (test company, or a `stop_clear` canary with the owner's `approval_ref`) | T2 |
| D-MK4 | Loads are still created and edited in McLeod | — |
| D-MK5 | No money writes (vouchers, tolls, deductions) | — |
| D-MK6 | Three append-only tables in one migration: `mcleod_write_requests`, `mcleod_write_events` (one `seq`, every fact, retention-forbidden), `mcleod_write_switches`; no `auth.users` FKs | T2 |
| D-MK7 | `origin` ∈ driver_app, office, office_retry, sweep, job, prove; each operation's required subject from `packages/shared/src/mcleodWriteOperations.ts` | T2 |
| D-MK8 | One partial unique `(operation, subject_ref) where origin <> 'office_retry'`; retries chain by `unique (supersedes)`; `mcleod_image_sends` unique `(stop_id, kind, sha256)` | T2/T3 |
| D-MK9 | `enqueue_failed` is a `stop_completed` payload value, not a write event; the sub-transaction re-raises only 40001/40P01; `on conflict do nothing` stays | T2 |
| D-MK10 | Agent timing tunables in `packages/shared/src/mcleodWriteTunables.ts`, served in the claim; `quiet ≥ begin_send timeout + write deadline + 30 s`; unknown-outcome images and creates never re-sent | T2 |
| D-MK11 | Already cleared with our times (to the K13-measured precision) → `confirmed already_applied`; different → terminal `already_in_mcleod`; already `D` at enqueue → no request | T2 |
| D-MK12 | Switch modes off/test/canary/live per org × operation × company; non-`off` rows only from the platform console; `mcleod_test_companies`; `is_mcleod_test_company()`; scoped canary; `live` needs `approval_ref` + canary per stop type (+ EDI) | T2 |
| D-MK13 | A separate write token on every claim and settle; egress IP recorded and alerted, refused only after Alex confirms it static; own limiter | T2 |
| D-MK14 | `observed` allowlisted, refusal text redacted on the VM, SSN stripped in `write()`, new gate `lint:mcleod-secrets` | T2 |
| D-MK15 | A stop McLeod no longer lists is kept with `mcleod_removed_at`, at the tail; compute-readers skip it, display-readers label it | T1 |
| D-MK16 | Stop mirror: one RPC, each load in its own sub-block, band at `seq + 1000`, tail refusal `stop_mirror_refused`; check widened to 1..1999 | T1 |
| D-MK17 | S0c keeps `idx_load_stops_load_seq` and the band; it re-keys 0453's ETA predictions to `stop_id` in three merges | T1 |
| D-MK18 | Migration order B2 → S0a → M-A → pipeline → MK4 images; B1 before S0b; numbers taken at merge | all |
| D-MK19 | `driver_complete_stop` changes signature once (M-A: `p_action_id`, per-photo `p_sha256`, `p_mcleod_write` = fleet kill only); the pipeline migration rewrites M-A's body with a cross-module waiver | T1/T2 |
| D-MK20 | Evidence from a driver ever dispatched the load is stored and answered 200 `late_evidence`; nothing enqueued | T1 |
| D-MK21 | The outbox never dead-letters on network/5xx (backoff ≤ 15 min); every API error carries `{code}`; "Not sent yet" after 60 min; no phone FIFO | T1 |
| D-MK22 | Office sees "Driver's phone last reached us at HH:MM" after 60 min silence on an active load, derived on the server | T1 |
| D-MK23 | `action_id` required on every driver load action from the first store build, after R3-21's install count is recorded | T1 |
| D-MK24 | `occurred_at` at most 5 min in the future (tunable, D-MK10's file), re-set from the measured p99 of `occurred_at - recorded_at` | T1/T2 |
| D-MK25 | Driver's delivered window 14 days on `coalesce(external_closed_at, completed_at)`; late evidence always accepted | T1 |
| D-MK26 | `driver-store.yml`: `fetch-depth: 0`, fetch `production`, `is-ancestor` on every trigger; every new field has a default | T1 |
| D-MK27 | C-A2 rebased onto the merged V5–V7 screens | T1 |
| D-MK28 | "Hire again" reopens the former row; sweep hires a reopened row only on McLeod's own reactivation while `driver_reactivate` is not `live`; managers only until Q-3 | T1/T3 |
| D-MK29 | 360's images in a distinct McLeod category, beside the capture app; filed = returned id listed or exactly one new match; echo guard | T3 |
| D-MK30 | Where a `/ws` image lands: a build per McLeod answer (stored / staged / module / invisible to billing) | T3 |
| D-MK31 | Alerts through `alertRouting.ts`, new category `mcleod_write` with its CHECK migration, recipients by section capability; critical ones also to the org's notification emails; no after-hours paging | T2 |
| D-MK32 | Both `load_events` reads in `exceptions.ts` page through `fetchAllPagedIn` | T2 (T-5) |
| D-MK33 | EDI customers: read a selectable field, else Alex lists them; until known, canary customers are Alex-named non-EDI and no `live` delivery row | T2/T3 |
| D-MK34 | Each `canary`/`live` switch row carries a plain-words briefing in `reason`, read by the Q-9 contact before the console accepts it | T2 |
| D-MK35 | `--schema-check` mode; on a McLeod upgrade: writes and parity off the night before, SQL feeds resume per statement, MK0 re-run before any switch returns | T2 |
| D-MK36 | Each Lockwood condition maps to a lock or one new tested rule (`allowed_hours`); unmapped → `off`; withdrawal → every switch `off` the same day | T2 |
| D-MK37 | If disabling the McLeod user does not revoke a token, drop "instant stop" and use short-lived login tokens with logout; re-login near expiry when tokens < 15 min | T2 |
| D-MK38 | Load-rates R4 (PR #2602) ships alone; B4's statements + test-company read + `/ws` client (all off) are one later connector update, one SQL review, one VM visit; settings in `mcleod-ws.env`; `update-connector.ps1` learns `/ws` failures | T2 |
| D-MK39 | MK0 Phase B parses on the API side from the uploaded `docs_gz` | T2 |
| D-MK40 | Termination reason: K25 reads `reason_for_leaving`; else Alex lists it; the office picks McLeod's code | T3 |

## 2. The complete PR order

`Rel` is what must be true before the next dependent step: `stg` = merged and applied on staging; `prod` = carried by an
owner-approved release (01:07 CT, Sun–Thu) and `pnpm verify:live` green; `VM` = installed on the VM by a visit.
Migration numbers are never fixed here (D-MK18): each is the next free number at merge.

| # | PR | Track | Needs | Rel | Outside gate |
|---|---|---|---|---|---|
| 1 | N-1 B1 one required-photo rule | T1 | — | stg (before N-7) | — |
| 2 | N-2 B2 reference/BOL/unmatched columns (migration, merged alone) | T1 | — | stg | — |
| 3 | T-1 MK0 tables + agent report routes (new tables) | T2 | — | prod | — |
| 4 | T-3 write token table + middleware + limiter (new table) | T2 | — | prod | — |
| 5 | N-3 C-23 claim defect | T1 | — | stg | — |
| 6 | N-6 S0a stable stop identity, band, `mcleod_removed_at`, check 1..1999 | T1 | N-2 applied | stg | — |
| 7 | N-7 S0b projection through the RPC | T1 | N-1, N-6 stg | prod | — |
| 8 | N-8 M-A driver loads SQL (the one `driver_complete_stop` signature change) | T1 | N-6 applied | stg | — |
| 9 | N-9 C-A1 API + shared + web for M-A | T1 | N-8 stg | prod | — |
| 10 | T-2 agent `/ws` client, VM scripts, `lint:mcleod-secrets`, agent-tree scrub | T2 | T-1 prod | merged (reaches the VM only in CU-1) | — |
| 11 | T-4 pipeline migration + `mcleod-writes.test.mjs` | T2 | N-8 applied, T-1 | stg | — |
| 12 | T-4b `mcleod_write` alert category (messaging migration + shared category) | T2 | — | stg (before T-5) | — |
| 13 | T-5 write API, platform-console switch routes, watch scheduler, office UI, D-MK32 paging | T2 | T-4, T-4b stg; T-3 prod | prod | AWS: L1 stays `false` |
| 14 | T-7 Phase B docs parser, API side | T2 | T-1 prod | prod | — |
| 15 | T-8 agent write loop, `--api-prove`, `--schema-check` | T2 | T-5 prod, T-2 | merged (reaches the VM in CU-1) | — |
| 16 | N-10 B4 API half (reference numbers, BOL, customer) | T1 | N-2 stg | prod | — |
| 17 | **CU-1 connector update**: B4 statements + test-company read + T-2/T-8 agent code, all API lines off | T2 | N-10, T-2, T-8 prod | VM | Alex: one SQL review, one visit (D-MK38) |
| 18 | T-6 VM configure + Phase A discovery (operation) | T2 | CU-1 on VM | — | McLeod: `/ws` on 22.1, URL, cert; Alex: secret entry |
| 19 | T-9 parity job on + verdict | T2 | T-6 K1 present | VM line | — |
| 20 | N-4 C-16, N-5 B3, N-11 V1, N-12 B5, N-13 B6, N-14 B7 | T1 | as T1 | as T1 | as T1 |
| 21 | N-15a/b/c S0c ETA re-key (column + backfill, recorder, readers) | T1 | N-7 prod ≥ 1 release | prod | — |
| 22 | N-16 Hire again (360 half) | T1/T3 | N-4 | prod | Q-3 sets who may press it |
| 23 | S-1 `driver-store.yml` gate; N-17 C-A2 driver app; S-2..S-4 store releases | T1 | N-9 prod | store | Q-5, Apple conversion |
| 24 | D-1 MK4 tables (after T-4, D-MK18) … D-13 | T3 | as T3 | as T3 | as T3 |
| 25 | T-10 test company registered in the console | T2 | T-5 prod, T-6 K4 | — | McLeod/Alex: test company exists |
| 26 | T-11 proving run P1–P6 (`prove` requests on the test company) | T2 | T-8 on VM, T-10, K6/K13 | — | Lockwood's OK; Alex `clearStop` effects + undo rehearsal |
| 27 | T-12 `stop_clear` canary → live | T2 | T-11 (or `approval_ref` path), N-17 in drivers' hands, office dispatching through Send | — | owner `approval_ref`; Q-9 contact; EDI list |

Load-rates R4 (PR #2602) is not in this table: it ships alone under its own plan (D-MK38).

T1 (written 2026-11-27, `v2/T1-driver-and-data.md` §1) adds two rows and fixes one dependency: **N-19** (Send
reaches the driver's and co-driver's app) and **N-18** (`action_id` required, before any store tag; D-MK23's install
count recorded there); and **N-8 needs PR #2684 (`0655`) merged first** — T1 builds the action door on 0655's
visibility rule instead of spec A's `driver_visible_load_ids`. S-2..S-4 are held by the owner's D-DA12 (driver builds
stay local until the app is finished).

**Corrections, chat 3 (2026-11-27):** PR #2684 (0655) is **merged** to main, so N-8's precondition holds. **N-19 is
built by PR #2689**, not by a T1 PR: a Send to a driver with an active app login writes one `load_dispatches` row
`channel='app', outcome='sent'` (else the held `sms` row) and notifies the driver and, when the dispatch names McLeod's
driver, `loads.co_driver_id` under the **existing `load_offered` category** ("New load from dispatch", deep link
`/loads/:id`, dedupe `load_dispatch:<row id>:<user id>`); the Dispatch drawer says beforehand whether the load reaches
the app; boundary edge `loads -> messaging`. There is no `load_dispatched` category. T3 (D-1..D-13) is in
`v2/T3-office-docs-finance.md`; the re-rulings and the preamble of rulings made inside T1/T2 are in `v2/RE-RULINGS.md`;
the two outside messages are drafts, not sent (`ALEX-MESSAGE-DRAFT.md`, `MCLEOD-MESSAGE-DRAFT.md`).

## 3. Outside answers (register §6, with the build per outcome in the track documents)

| What we wait on | Who answers | What it blocks | Silence (10 business days, then escalate) | Builds per outcome |
|---|---|---|---|---|
| `/ws` on 22.1, URL, certificate | McLeod | the whole API program | API program paused; Track N and finance continue | T2 §T-6 (K1, K2) |
| Write-capable test company | McLeod or Alex | every switch except a `stop_clear` canary | only a `stop_clear` canary with `approval_ref` | T2 §T-10, §T-12 |
| Lockwood's written OK (and any conditions) | Alex Lockwood | every write | hard stop on writes | T2 §T-11 (D-MK36) |
| `clearStop` effects + undo rehearsal | Alex Tzakov | stop canary | stop canary waits | T2 §T-12 |
| Where `/ws` images land | McLeod | MK4 live | MK4 `off` | T3 (D-MK30) |
| Date mode and precision | MK0 K6, K13 | every time write | — | T2 §T-8 |
| Token revocation | MK0, McLeod | the instant-stop claim | D-MK37 | T2 §T-6 |
| Static egress IP | CloudWatch, Alex | the IP refusal rule | recorded + alert only | T2 §T-3 |
| Store release | owner (Q-5) | every driver benefit | Android first, iOS via external TestFlight | T1 |
| EDI customers | Alex (code read 2026-11-27: our login's `customer` grant is column-limited to `id, name, city, state_id, company_id`, `tools/mcleod-agent/review/SILVICOM-GRANTS.sql:79-83`, so no EDI field is selectable — D-MK33 step 3 applies) | `live` for deliveries | D-MK33 step 4 | T2 §T-12 |
| `reason_for_leaving` codes | MK0 K25, else Alex | termination write | D-MK40 | T3 §D-6 |
| Where a `/ws` image lands | McLeod (message item 14) | MK4 | both image operations `off` | T3 §D-4 |
| Lumper receipts in McLeod (enterprise plan X6) | billing | D-2 only | not built | T3 §D-2 |

Facts recorded since the register (2026-11-27):
- **DB7 was run (2026-11-24/25, `DISPATCH-BOARD-PLAN.md:595-672`):** p90 error 689 min within 4 h of arrival, so no
  ETA is written (spec D D-MK6-1b); T3 D-12 re-applies the gate after Q-DB4's reset fix.
- **Dispatch to a driver is the office's act.** The owner re-confirmed D-LMR5 on 2026-11-27: a McLeod load reaches a
  driver only when the office presses Dispatch → Send in 360. Production on 2026-11-27: **0 `load_dispatches` rows ever**;
  99 `in_transit` and 39 `pending_approval` loads with `source='tms'`. So no `driver_app` stop request can exist until
  the office dispatches through Send (D-MK20's predicate needs a dispatch), and T-12's canary is gated on that practice.
- **Staging cannot exercise any McLeod path.** Staging has no McLeod feed (the VM posts only to production) and no test
  company exists; `mcleod_test_companies` is still only proposed (T-4 creates it). Every T2 staging check is therefore a
  schema/route check, and every behaviour check is a production check with the switches `off`, or the matrix.
- **The driver track has a consumer.** `docs/plans/drivers-app/DRIVER-APP-ENTERPRISE-PLAN.md` (rev 2, on main,
  2026-11-26/27) consumes this plan's driver track in its segments S1 (`:290-310`) and S9 (`:553-575`). The owner ruled
  ~100 % company drivers, so there are no pay, settlement, detention or lumper request screens (D-DA1, `:173`).
- **`driver_complete_stop` has a sibling on main.** `0645_driver_late_stop_photos.sql` adds
  `driver_add_stop_photos` (late photos on a completed stop) and re-sets `load_events_kind_check` (adds
  `stop_photo_added`). M-A and T-4's re-creations of `load_events_kind_check` must carry that kind; T1 owns the check.

## 4. Owner questions (register §5; unanswered on 2026-11-27)

| # | Question | Recommendation | Default while unanswered |
|---|---|---|---|
| Q-1 | A new hire or reactivation carries name, DOB and CDL number once; O-2's no-write rule covers later edits only | Yes | create/reactivate stay `off` |
| Q-2 | Clearing a stop creates a non-reportable, uncoded service-failure record; keep `isReportable=false` | Yes | stop canary waits on the answer |
| Q-3 | May recruiters press "Hire again"? | Yes | managers only |
| Q-4 | The O-7 sentence: the new hiring rule in your own words | — | create stays `off` |
| Q-5 | Start the Apple Individual → Organization conversion and store filings now | Yes, today | Android first |
| Q-6 | Standing OK for hotfix releases of `tools/mcleod-agent` and `/api/tms` routes during MK0 | Yes | one release per round-trip |
| Q-7 | If McLeod user security does not apply to `/ws`: VM-only credentials, every call logged, weekly review | Yes | stop before L3 |
| Q-8 | Drivers see delivered loads for 14 days | Yes | 14 days |
| Q-9 | Name the go-live contact who reads each briefing (D-MK34) | a name | no `canary`/`live` row can be accepted |
| Q-10 | Any charge beyond the quoted ~$750/month pauses the affected operation until approved | Yes | the operation pauses |

Also requested once: the 11-11 meeting notes and the Ron emails, if they exist.
