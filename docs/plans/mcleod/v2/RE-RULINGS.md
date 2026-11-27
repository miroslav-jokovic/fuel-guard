# RE-RULINGS — the text that replaces every "McLeod is read-only" ruling (McLeod API Kit v2)

**Status:** PLAN, 2026-11-27. Index: `../MCLEOD-API-KIT-PLAN-V2.md`. Source list: `../api-kit-audit/X.md` §5 (5.1, 5.2,
5.3), every file:line re-read on 2026-11-27 against `origin/main` merged into this branch.

**How this file is used.** Nothing below is applied by the PR that adds it. Each replacement is **appended** to its
document as a dated note (an owner's quoted words are never rewritten, `plan-progress-log-not-table-rows`), by the PR
named in the "Applied by" column — the first PR that builds a write the old ruling forbids. A row whose old ruling is
the owner's own sentence needs the owner's own sentence before it is applied (marked **owner's words**); "go ahead" is
not enough there (X.md §5.1, D-RL5 note).

---

## Preamble A — register defects closed inside the track documents

Four places where the register (`../DECISION-REGISTER-2026-11-20-API-KIT.md`) could not be built as written. Each was
closed by the smallest change that keeps the register's intent; none needs an owner answer.

1. **D-MK8's single index `(operation, subject_ref)` would allow one medical-card update per driver forever.** T2 makes
   `subject_ref` for driver and unit operations `<subject id>:md5(payload)` (T2 §T-4.3), so two updates with different
   values are two requests and the same value twice is one (matrix title "two medical-card updates with different
   values are two requests, the same value twice is one").
2. **D-MK12's "tenant admins can only insert `off`" is enforced by a CHECK:** a non-`off` switch row must name an
   active `platform_admins` row (MK013, T2 §T-4.4); the console is `apps/admin-api` `/admin/mcleod-writes`.
3. **D-MK33's "no `live` row for deliveries" is MK016's refusal of `dropoff` in `live_stop_types`**, lifted only by a
   later `mcleod_edi_customers` migration (T2 §T-12 outcome table).
4. **(T3) D-MK12's canary scope `{"subject_ids"}` for "the others" cannot be written for images:** an image's subject
   id exists only after the paper does. T3 D-1 scopes image canaries by `customer_ids` (the request's `customer_id`);
   driver and unit operations keep `subject_ids` (T3 §D-1, matrix title "an image canary scope of subject ids is
   refused").

## Preamble B — rulings made inside T1 (`v2/T1-driver-and-data.md`, "Rulings made in this document")

1. **0655 is the visibility rule; M-A derives the action door from it**: one parameterised body,
   `driver_visible_tms_load_ids`, with 0655's helper re-created as its wrapper; `assert_driver_load` and every driver
   function admit whom 0655 shows. Spec A's `driver_visible_load_ids` and its status list are superseded by 0655's five
   statuses.
2. **D-MK20's "repower recorded in raw" arm is subsumed by the dispatch arm** (raw keeps no seat history), and the
   "either current seat" arm requires the load to have been dispatched at all.
3. **D-MK19's "every new parameter" includes `p_arrived_at` and `p_arrive_action_id`** (D-MK21 needs them).
4. **Late evidence changes no `load_stops`/`loads` column**; it stores photos and a flagged event only.
5. **A second Complete with photos uses 0645's `stop_photo_added` kind**; `driver_add_stop_photos` keeps its signature
   and gains the McLeod status gate and `sha256`.
6. **M-A never refuses evidence for a time**; it flags `time_flags`, and T-4 answers `implausible_time`.
7. **DR-14's reasons re-derived against 0655**: `no_app_login`, `uncovered_in_mcleod`, `closed`, plus a `seatNote` when
   McLeod seats someone else.
8. **N-19 (Send reaches the app) is built by PR #2689** (corrected 2026-11-27 by chat 3; T1's first draft, a new
   `load_dispatched` category with no `channel='app'` row, is withdrawn): a Send to a driver with an active app login
   writes ONE `load_dispatches` row `channel='app', outcome='sent'` (else the held `sms` row) and notifies the driver
   and, when the dispatch names McLeod's driver, `loads.co_driver_id`, under the existing `load_offered` category
   ("New load from dispatch", deep link `/loads/:id`, dedupe `load_dispatch:<row id>:<user id>`); the Dispatch drawer
   says beforehand whether the load reaches the app; boundary edge `loads -> messaging`. N-9's `reachable.no_app_login`
   derives from #2689's `inApp` predicate (one function).
9. **Hire again's "managers" = a new editable permission `recruitment.reopen_former_driver`** shipped to fleet and
   safety managers (Q-3 becomes a Settings tick).
10. **D-MK22's push-registration column is `device_push_tokens.last_seen_at`**, not `updated_at`.
11. **S0c has no reader merge**: no reader of the ETA predictions table exists.

## Preamble C — rulings made inside T3 (`v2/T3-office-docs-finance.md`, "Rulings made in this document")

1. Image canary scope by customer (= Preamble A item 4).
2. Termination alerts go to the `roster` section (the gate the act used).
3. Two image operations, `image_file_stop` (BOL, delivery copy) and `image_file_office` (revised RC), each with its
   own proof and switch.
4. D-MK30's staged re-read schedule (15 min, 1 h, 24 h) lives in `mcleodWriteTunables.ts` and is passed by the agent;
   T-4's back-off cap rises to 86,400 s.
5. Driver field edits beyond medical-card and CDL expiry are not built (O-2 narrow); the phone-claim defect is fixed
   alone (D-9a).
6. Late photos on a filed stop are filed as a new paper of only the new photos.
7. T3's `/ws` adapters ride CU-1 when merged before it is cut, else one CU-2; T3's SQL rides CU-1's one SQL review.
8. Non-stop prove requests use `mcleod_write_prove_subject` with synthetic ids for test-company rows.

---

## 1. Rulings listed in v1 §1 (X.md §5.1)

| # | Document:line (re-read 2026-11-27) | Says today | Replacement text (appended, dated) | Applied by |
|---|---|---|---|---|
| R-1 | `docs/plans/mcleod/LOADS-GO-LIVE-PLAN.md:678` | "Owner ruling: loads are a read-only mirror of McLeod." | "2026-11-27 — re-ruled by MCLEOD-API-KIT v2 (D-MK2, D-MK4): loads are still created and edited in McLeod (D-LMR1 kept). 360 writes to McLeod only the facts D-MK2 lists — stop times, papers, a new hire, termination and rehire, medical-card and CDL expiry, unit status — each through McLeod's own API, never SQL, each off until proven." | T-12 (first stop write) |
| R-2 | `LOADS-MIRROR-PLAN.md:1`, `:14` (title; the owner's quote "Loads are read-only on our dashboard…") | | Below `:14`, keeping the quote: "Since MCLEOD-API-KIT v2: the dashboard still never edits a load; a driver's stop completion and papers are written to McLeod by the API (D-MK2)." | T-12 |
| R-3 | `LOADS-MIRROR-PLAN.md:18` D-LMR1 | "McLeod is the only author of a load" | "Kept. A load's creation, edit and assignment stay McLeod's (D-MK4). Stop facts and papers the driver records are written to McLeod by the API (D-MK2, T2/T3)." | T-12 |
| R-4 | `LOADS-MIRROR-PLAN.md:23` D-LMR2 | status = projection | "Kept: `loads.status` stays McLeod's, also after a driver completes every stop (T1 N-8: completing a McLeod stop never changes `loads.status`)." | N-8 |
| R-5 | `LOADS-MIRROR-PLAN.md:338` D-LMR5 | a load reaches a driver when the office SENDS it | "Kept and re-confirmed by the owner 2026-11-27. No Accept/Decline on McLeod loads; the driver confirms with Got it (T1 N-8/N-9). Send puts the load in the app of a driver with a login (PR #2689)." | N-9 |
| R-6 | `LOADS-MIRROR-PLAN.md` Q-LMR2, Q-LMR4, Q-LMR5, Q-LMR10 (open questions table) | open | Q-LMR2 "closed by B7 for display only: McLeod's arrival first, the driver's labelled, never merged (T1 N-14)"; Q-LMR4 "closed by 0655 + T1 N-8 (whom the app shows = who may act)"; Q-LMR5 "closed by V1/B5 (T1 N-11/N-12)"; Q-LMR10 "closed by spec B's reference statements (T1 N-10, CU-1)" | N-14, N-8, N-12, N-10 respectively |
| R-7 | `roster/FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md:16` (§0.1 D-FC0) and `:375` | McLeod owns drivers, trucks, trailers, loads | "Kept as mastery. 360 may ASK McLeod to change the fields D-MK2 lists, through the API; McLeod's answer comes back on the sweep, and 360's column keeps one writer (the sweep)." | D-8 |
| R-8 | `FLEET-CENSUS…:537` Q-7 (and option text `:553`) | status read-only on McLeod rows (decided 2026-09-22) | "Q-7b, 2026-11-27: with `tractor_status`/`trailer_status` on, a linked unit's status is editable again and asks McLeod (T3 D-8); `isStatusFromTms` keeps its meaning; while off, read-only as decided." | D-8 |
| R-9 | `mcleod/ROSTER-LIFECYCLE-PLAN.md:152-153` D-RL5 | owner: *"hiring is not done from 360"* | **owner's words** (Q-4): "D-RL5a, <date>: <the owner's sentence>. When `driver_create` is live, Close application in 360 creates the McLeod driver; a driver hired in McLeod first is still handled by `rosterApplicantHire` as today." Until Q-4 is on file, `driver_create` stays `off` and this row is not applied. | D-7, after Q-4 |
| R-10 | `mcleod/MCLEOD-ROSTER-SYNC-PLAN.md:296` D-MR6 | McLeod-sourced CDL/medical/… refreshed every sweep; an office edit reverts | "D-MR6a, 2026-11-27: unchanged for every field except medical-card and CDL expiry, which the safety office may send to McLeod with one click (T3 D-9b); and a phone edit no longer claims a McLeod row (T3 D-9a, `phone@samsara`)." | D-9a |
| R-11 | `drivers-app/BOL-READING-RELIABILITY-PLAN.md:629` Q6 and `:632` Q9 | "Writes are expensive … the service writes nothing" | Q6: "CLOSED 2026-11-27: yes — 360 files the pickup BOL and the signed delivery copy onto the McLeod order through the API Kit (fixed price), one paper per (stop, kind), beside the capture app (T3 D-1..D-5). D-EXR12 unchanged: the image is sent, no field read from it." Q9: "CLOSED: imaging is read through the API or Part 6 (spec D MK4.4); no folder or e-mail import." | D-3 |
| R-12 | `mcleod/MCLEOD-CPM-DATA-SOURCE-SPEC.md:669` | "any write to McLeod" out of scope | strike "any write to McLeod," and append "(McLeod writes: MCLEOD-API-KIT v2)" | T-12 |
| R-13 | `maintenance/MAINTENANCE-MONEY-CONTROL-PLAN.md:296` | "Writing anything to FleetPal, McLeod or EFS" | "Writing anything to FleetPal or EFS. McLeod money writes stay out under D-MK5." | T-12 |
| R-14 | `mcleod/mail.md:38`, `:42`, `:36`, `:89` (Alex's terms) | SELECTs only; no insert/update/delete; nothing inbound; email never written back | **not edited** (a record of Alex's words). Alex Lockwood's written reply to `ALEX-MESSAGE-DRAFT.md` item 1 is appended below it, dated. `:89` stands unchanged: no T3 write carries an email (T3 D-6 `rowMap`). | the day the reply arrives |
| R-15 | SILVICOM360-TMS `HANDOFF.md:80`, `RESEARCH-RESOLUTIONS.md` §126(7) | — | outside this repository; the owner rules it in that repository (v1 :77). Listed so it is not forgotten. | owner, other repo |

## 2. Rulings not in v1 §1 (X.md §5.2)

| # | Document:line | Says today | Replacement text (appended, dated) | Applied by |
|---|---|---|---|---|
| R-16 | `mcleod/MCLEOD-READ-ONLY-INTEGRATION-HANDOFF.md:6` | "Write policy: no SQL writes, no DDL, no stored-procedure execution, no direct McLeod mutations" | "2026-11-27: SQL stays SELECT-only. API writes through McLeod's `/ws` are governed by MCLEOD-API-KIT v2 (D-MK2, D-MK12) and Alex Lockwood's written OK." | T-12 |
| R-17 | `dispatch-loads/HOME-TIME-PLAN.md:100` D-HT5 and `:444` | "Nothing is written to McLeod"; "No writes to McLeod" | "D-HT5 stands until T3 D-13's 14-day probe: H3 → stands as a measured fact; H1/H2 → D-HT5a writes the home period to McLeod (T3 D-13 table)." | D-13 (probe result) |
| R-18 | `dispatch-loads/DISPATCH-BOARD-PLAN.md:332` | "No assignment, dispatch or status writes to McLeod" | "Kept, except an ETA under D-MK6-1a if DB7's re-run passes (T3 D-12); none today." | D-12 (only if built) |
| R-19 | `dispatch-loads/DISPATCH-BOARD-V2-PLAN.md:296` | "No writes to McLeod (D-LMR1)." | "No assignment writes to McLeod (D-LMR1); stop writes per MCLEOD-API-KIT v2." | T-12 |
| R-20 | `dispatch-loads/DISPATCH-LOADS-COUNTS-PLAN.md:226` | "No writes to McLeod (D-LMR1)." | as R-19 | T-12 |
| R-21 | `mcleod/COLLECTOR-AUDIT-2026-09-24.md:306` | "SELECTs only … nothing writes to McLeod" (historical) | dated pointer: "Superseded for API writes by MCLEOD-API-KIT v2; SQL stays SELECT-only." | T-12 |
| R-22 | `drivers-app/BOL-READING-RELIABILITY-PLAN.md:86`, `:130`, `:138`, `:333` | "whether any of this is written into McLeod is an owner question"; "Q6 answered by default — no writes" | "See Q6 (closed 2026-11-27, R-11)." | D-3 |
| R-23 | `dispatch-loads/LUMPER-REVISED-RC-PLAN.md:328` | route (a) "with a read-only API user" | "The API user now also writes (T3 D-4); route (a)/(b) switch rule per spec D MK4.4; the echo guard skips 360's own uploads (T3 D-4)." | D-4 |
| R-24 | `docs/MCLEOD-SELF-HOSTED-INTEGRATION.md:30` | "a read-only internal integration" (the old request text to McLeod) | "Superseded by `v2/MCLEOD-MESSAGE-DRAFT.md` (sent <date>)." | the day the McLeod message is sent |
| R-25 | `docs/plans/MCLEOD-SQL-SOURCE-OF-TRUTH.md:14` | read-only SQL as the integration | pointer: "SQL stays the read path; writes through `/ws`, MCLEOD-API-KIT v2." | T-12 |
| R-26 | `mcleod/CODEBASE-IMPACT-ANALYSIS.md:72` | pairing "⛔ NEVER WRITE" | **checked, no change**: trailer pairing is still never written (D-TL1). | — |
| R-27 | `roster/FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md:553` | Q-7 option (a) "make the field read-only" | covered by R-8 | D-8 |

## 3. The ruling the specs violated (X.md §5.3)

`mail.md:89` — "The name_of_spouse email convention stays on your side. Do not write it back to McLeod." **Kept, and
enforced:** no T3 operation carries an email (`toRowDriver` has no email key; test "no McLeod body carries an email or
SSN key", T3 D-6). Spec D's `email → name_of_spouse` row and its round-trip assertion are withdrawn. No question is put
to Alex about it.
