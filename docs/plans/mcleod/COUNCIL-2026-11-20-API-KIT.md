# Review council, round 2 — McLeod API Kit plan, 2026-11-20

**What this is.** On 2026-11-20 the owner asked for one more audit plus a review council, so that the
plan is precise, reliable and better than what we have today. Five independent reviewers each took one
lens and treated the round-1 audit (`AUDIT-2026-11-20-API-KIT-SPECS.md`) as fallible. Their full reports,
with file:line and URL evidence and exact fix text, are in `api-kit-council/`:

| Report | Lens | Findings |
|---|---|---|
| `1-pipeline.md` (+ `pg/`, runnable PGlite checks) | Write pipeline: failure windows, DDL, switches | 30: 3 blocker, 5 wrong, 16 gap |
| `2-driver.md` | Driver app end to end, today vs planned, 10 scenarios | 26: 1 blocker, 3 wrong, 1 regression, 13 gap |
| `3-ops.md` | McLeod side, Windows VM operations, security, MK0 probes, message lists | 21: 2 blocker, 2 wrong, 8 gap, 6 risk |
| `4-office.md` | Office writes, documents, roster/hire, ETA/home time, finance | 23: 1 blocker, 4 wrong, 12 gap, 1 regression risk |
| `5-redteam.md` | Re-verified 46 round-1 claims: 34 confirmed, 4 wrong, 5 overstated, 1 stale | 26 (8 audit-wrong, 11 missed) |

**Precedence.** Where this file and the round-1 audit disagree, **this file wins**. Where a council report
and this file disagree, this file wins; it is the reconciled reading. v2 is written from both files, in
this order.

## 1. Verdict: is the plan better than today?

**Yes, on every flow, once the conditions below are built into v2.** Without them, four places are worse
than today or unsafe.

| Area | Today | Planned (with council fixes) | Condition |
|---|---|---|---|
| Stop times in McLeod | A dispatcher keys them by hand, late | The driver's real taps, one `clearStop` per Complete | C-1, C-2, C-5, C-6 |
| Driver sees the dispatched load | Only after the pickup is cleared in McLeod | As soon as it is dispatched, co-driver included | C-11 (store lane) |
| Stop ids | Change on every sync, and worked stops get overwritten | Stable McLeod stop ids | C-9, C-10 |
| Offline work | Replays dead-letter, and arrivals can be lost | Action ids, ordered per load, Complete carries its own arrival | C-12, C-13 |
| Papers into McLeod | McLeod's capture app only | Filed to the order the same day | C-17 (quality gate) |
| Hire / medical / termination | Entered twice, with lag | Written once in 360 | C-15, C-16, Q-1 |
| ETA in McLeod | Dispatcher types it | Written by 360 | C-18 (accuracy gate) |
| Security / control | Read-only SQL login | Scoped write login, five switches, proof before live | C-3, C-4, C-7 |

## 2. Corrections to the round-1 audit (v2 uses these, not the audit's text)

1. **Switch modes need proof at each step** (P-5, RT-1). `test` sends only admin proving requests, and only to companies on the org's
   test-company list (`org_integrations.config`). `canary` needs a confirmed proving request. `live` needs a confirmed canary request
   on the **same** company. Each `leased` event records the switch row that allowed it.
2. **"Already cleared in McLeod" is not a conflict** (P-2, DR-8):
   - If McLeod's times equal ours, the outcome is `confirmed already_applied`.
   - If a dispatcher cleared the stop first, the outcome is a terminal `already_in_mcleod`, which is not an exception.
   - A stop already `D` at enqueue time gets no request at all.
3. **McLeod dates carry seconds**, not minutes (RT-6, P-14). The time zone is proven against the SQL mirror before the canary, because
   a wrong zone would confirm itself on read-back.
4. **`claimNext` does not keep order today** (RT-5, P-19, DR-9). The fix has three parts:
   - The outbox becomes first-in-first-out **per load**, built in the tested `pickNext`.
   - Complete carries its own arrival time and action id.
   - The agent clears a movement's stops in order.
5. **No `auth.users` foreign keys** on `requested_by` / `changed_by`; add `driver_id` instead (P-7, RT-20).
6. **O-5 needs a predicate** (RT-18, DR-7). A driver who was **ever** dispatched the load (including a McLeod repower or a co-driver
   seat) has their evidence accepted. The event is flagged, nothing is enqueued, and the office sees an exception. This holds for
   first-time actions, not only for replays.
7. **The "VM's existing lines" do not exist** (RT-2). The switches are: the switch table, the API master switch, Alex disabling the
   McLeod user/token (the true instant stop, OPS-3), the agent's own env line, and the office "do not send" action (OPS-18). v2 lists
   all five with who can pull each and how fast it takes effect.
8. **W9 equipstatus**: `PUT /equipstatus/create` through TableRowService is a documented route, and an MK0 probe decides it
   (RT-11, OF report). Home time never writes `pta_date`.
9. **Tractor status key** is not settled for **our** install. We read `tractor_status` (`queries.mjs:91`), so it is an MK0 check.
   Trailers write only `is_active` plus `outservice_date` (OF-5/6).
10. **The test certificate**: only a public test certificate is committed, never a private key, because gitleaks would fail
    (RT-9).
11. **Image determinism**: pdf-lib 1.17.1 is deterministic with `updateMetadata:false` (it needs no fixed dates). Add a
    `(stop, kind)` unique index, because bytes change with the pdf-lib version (OF report).
12. **Finance message**: a follow-up to the 2026-11-13 request already on file, adding only `drs_check` and `gl_summary` to Part 4.
    The Part 2 additions are dropped (OF report).
13. **Test-company reads** (RT-10): one agent and one connection (Alex's "one program, one connection", `mail.md:38`). It posts the
    test company to a **test org in production**. There is no new egress host.
14. **ETA predictions are keyed on `stop_seq`** (0453). They are re-keyed to the stable stop id, not given a tie-break (RT-14).

## 3. Conditions v2 must build (C-items; each closes a blocker, regression or must-fix gap)

- **C-1 Lease guard** (P-1). A `mcleod_write_begin_send` RPC runs right before every McLeod write. It records `send_started` and
  allows the send only if all three hold: the lease is newest, the lease has at least 90 s left on the database clock, and no 2xx is on
  record. Leases last 300 s, there is one claim loop at a time, and each write has an absolute 30 s deadline.
- **C-2 Late facts accepted from any lease** (P-3). Events are ordered by an identity `seq`, not `now()`. Lease expiry is computed,
  not stored (P-4).
- **C-3 Bounded retries** (P-8/9):
  - When the outcome is unknown, wait 300 s and allow at most 3 sends.
  - When McLeod answered 2xx but the change is not visible: re-read after 60 s, then back off; after 3 re-reads the outcome is
    `conflict accepted_not_visible`.
  - A 200 that carries failure text counts as a refusal.
- **C-4 Never re-send what cannot be read back** (P-12). An image upload or a driver create whose outcome is unknown goes to the office
  as `outcome_unknown` and is never re-sent automatically.
- **C-5 Enqueue never fails the driver's evidence** (P-17, DR-17). It runs in its own subtransaction, catches only the pipeline's
  named codes, and records `enqueue_failed`.
- **C-6 Plausible times** (OPS-7, P-16). The phone's `occurred_at` is bounded at enqueue: not in the future, and not before the stop
  was dispatched. The agent refuses to write until our date-format setting is known (OPS-13). DST fall-back is handled by sending
  offset-qualified times (RT-22).
- **C-7 Write-scoped agent credential** (OPS-8). The claim and settle routes accept only a separate write token, only from the VM's
  egress IP, on their own limiter.
- **C-8 Personal data** (OPS-14/15):
  - `observed` stores allowlisted keys only.
  - McLeod's refusal text is redacted on the VM.
  - The SSN strip lives in the client's `write()`, with a gate rule and a wide pattern.
  - A new gate refuses any committed `/ws` host, company id, McLeod user name or McLeod doc (OPS-16).
- **C-9 No frozen loads between S0b and S0c** (DR-5). Widen `load_stops_seq_check` with a scratch band and move a load's stops through
  it inside the RPC. There is no deferral.
- **C-10 Removed stops are soft-removed**, not deleted, so a queued action still lands and is shown to the office (DR-6).
- **C-11 Store build only from production** (DR-4). `driver-store.yml` adds an `is-ancestor origin/production` step, and every field the
  app newly reads gets a default. The rollout text uses the store lane; the OTA and APK lanes were deleted on 2026-10-22 (DR-3). The
  first store release must include the action-id client (C-A2).
- **C-12 Second Complete keeps its photos** (DR-11). The RPC stores the photos before returning "already done". A team's second phone
  tapping Arrive on a completed stop is accepted as a no-op (DR-12).
- **C-13 Bad signal does not dead-letter stop actions** (DR-10). A stop action retries with backoff until it is accepted, instead of
  stopping after 8 attempts.
- **C-14 The driver load list is bounded** (DR-15). It shows a recent window (current plus the last 14 days), but late evidence is
  still accepted by the visibility rule. Reads are chunked under the 1,000-row cap (RT-13).
- **C-15 Returning driver path** (OF-1):
  - A "Hire again" action reopens the former row (terminated → applicant). It keeps the McLeod id and is audited.
  - The new application is a second invitation on that row.
  - The hire close sends `driver_reactivate` to the same McLeod id.
  - A former driver 360 never knew ends as `former_driver_in_mcleod` for the office.
- **C-16 Hand-entered McLeod hires get linked while create is off** (RT-19, OF-3). When the sweep matches a 360-hired row by licence
  and name, it calls `linkHiredDriverToTms`. The O-7 switch also covers `driver_reactivate`.
- **C-17 Paper quality gate before BOL/POD go live** (OF-11). One of two must hold: the scanner is attached to stops, or a 14-day trial
  in which billing marks at least 98% of 360-filed papers readable. A known-360-image skip prevents the revised-RC echo loop (OF-9).
  The image "filed" rule is the returned id, or exactly one new match; two or more matches are ambiguous and never re-sent (OF-8).
- **C-18 ETA write waits for DB7** (OF-16). The 14-day accuracy check, on the window that starts at B7's release, must pass first. The
  call-in probe on the test company checks four things: the ETA moves, no status change, no service failure, and no customer message.
  Alex confirms the customer-message point in writing (OF-15).
- **C-19 Business effects of `clearStop` known before the canary** (OPS-1/2):
  - Alex lists in writing what a clear triggers (EDI 214, ready-to-bill, pay, status, service failure) and how each is undone by hand.
  - The canary runs on a non-EDI, non-billable test customer, after Alex has rehearsed the undo.
  - Rollout order: pickups, then non-EDI deliveries, then EDI.
- **C-20 One alert per outage** (OPS-6):
  - Alerts are grouped, not raised per request.
  - The 72 h stale rule never marks a request McLeod already has.
  - Stops a dispatcher cleared during the outage are `already_in_mcleod`, not conflicts.
  - Monitoring: an alert per agent instance, an office exception feed, an API health endpoint, and an alert when two connectors claim
    (P-11, P-25).
- **C-21 VM operations** (OPS-4/5/10/17):
  - The VM task's restart policy is committed to the repo.
  - `update-connector.ps1` learns to add new env lines.
  - Its post-restart check covers the `/ws` half.
  - The `/ws` credential lives in its own `mcleod-ws.env`.
  - Token mode is preferred over login mode; in login mode the agent logs out.
- **C-22 Rollback per step** (RT-23). Every PR in v2 states its rollback: what is reverted, and whether data written meanwhile stays
  valid.
- **C-23 Claim-defect fix covers three readers** (OF-2): the trigger, `resolveDriverUpdate` and `wouldClaimFromTelematics`, moved together
  into a new shared file.

## 4. Questions back to the owner (only these; everything else is decided above)

| # | Question | Recommendation |
|---|---|---|
| Q-1 (O-2a) | O-2 ("names, DOB, CDL number are not written") makes a new-hire create (O-7) and a reactivation (O-6) impossible, because McLeod needs name and licence to create a driver. | O-2 governs **updates** only. A create or reactivation carries name, DOB and CDL number **once**. Answer in the same message as the O-7 sentence. |
| Q-2 (O-4 revisited) | `isReportable=false` does not stop `clearStop` creating a service-failure record; it only hides it from the customer. | Keep `isReportable=false`. The test-company probe reads back what McLeod creates, and Alex says whether dispatchers want those records. If not, stop writes go to pickups only until McLeod confirms a way to clear without one. |
| Q-3 | May a recruiter use "Hire again" on a former driver, or only managers? | Yes, recruiters too. It only reopens the application; the hire close is still gated as today. |
| Q-4 | O-7 sentence (still owed): the new hiring rule in the owner's own words, replacing "hiring is not done from 360". | — |

## 5. What the council confirmed

- The direction holds: a fixed request, an append-only event log, state derived from the events, and the enqueue inside the
  driver's transaction. It beats a mutable status row at this volume (P-27).
- The corrected schema passed 15 of 15 PGlite scenario checks (`api-kit-council/pg/`). A claim over 260,000 requests ran in about
  55 ms, and an org delete still cascades.
- The round-1 code citations hold. The errors were in the round-1 **summary**, and §2 above corrects them.
- 12 MK0 probes are read-only and safe on production. 9 are writes and run on the test company only. 3 need McLeod's or Alex's
  answer in writing. No write is ever probed on production (`3-ops.md` probe table).
- No password has ever been committed. The repo is public and already holds internal host names and logins. The API Kit adds nothing
  to it, and a gate enforces that.
- The two message item lists (Alex: 13 items; McLeod via Ron: 15 items) are drafted in `3-ops.md`. v2 turns them into the two
  messages, with the finance follow-up (§2.12) and the C-19 questions folded in.
