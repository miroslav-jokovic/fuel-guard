# The read routine, for the carrier's review

> **2026-09-25 — the reply to Alex's approval:** [`REPLY-TO-ALEX-2026-09-25.md`](REPLY-TO-ALEX-2026-09-25.md),
> sent with the regenerated `SILVICOM-READ-ROUTINE.sql` (LR3's fields, the version he asked to see
> before it goes live). His 2026-09-24 reply is kept in `docs/plans/mcleod/mail.md`.
>
> **2026-09-24 — what to send Alex:** [`LETTER-TO-ALEX.md`](LETTER-TO-ALEX.md) (the letter, in the
> owner's voice), `SILVICOM-READ-ROUTINE.sql` (24 statements, **built from the code** by
> `build-routine.mjs` — never edit it by hand; `npm run routine` rebuilds it and `review.test.mjs`
> fails CI if it is stale) and [`CONNECTOR-ON-THE-VM.md`](CONNECTOR-ON-THE-VM.md). CA1–CA5 of
> `docs/plans/mcleod/COLLECTOR-AUDIT-2026-09-24.md` have landed, so every promise in the letter is
> true of the code. The historical notes below describe the hand-written file it replaced.
>
> **The zip for the VM is built from TRACKED files only**, so no `.env`, state file or password can
> ride along: `git archive --format=zip -o silvicom-connector.zip HEAD:tools/mcleod-agent` (then
> check it with `unzip -l`). Never zip the working folder — it holds `.env` (the LME password and the
> ingest token), `.env.sandbox` and `roster-state.json` (the carrier's driver codes).

`SILVICOM-READ-ROUTINE.sql` is the complete set of statements this integration runs against `lme`
with the `silvicom_dispatch_ro` login: the loads feed (1–4), the roster sync (5–7) and the by-hand
retirement reads (8–10). It exists because the carrier's IT asked for exactly this, on 2026-09-17:

> *"You can run any discovery queries on the live data but when you are ready to publish a routine
> that will query the live database systematically as we agreed please sent this to us first for a
> quick review."*

**Send them the `.sql` file.** It is written for a DBA who has never seen this repository, it is
valid T-SQL as it stands, and it returns the same rows our connector sees — verified by executing
it against live `lme` as one batch on 2026-09-23: ten result sets (0, 151, 309, 16, 165, 193, 223,
1,310, 459, 172), 212 ms, and `sys.dm_exec_sessions.program_name` read back as the
`"Silvicom 360 connector"` the letter tells Alex to look for.

## What it says, in one paragraph

One held connection, four loads statements — every 10 minutes to start, towards 60 seconds only if
it earns it — plus the roster's three every 2 minutes, from a machine inside the carrier's own
network that connects **outbound** to us — so there is no inbound firewall rule and no IP allow-list
for them to maintain. `LOCK_TIMEOUT 5000` and `DEADLOCK_PRIORITY LOW` mean we lose every contest
against one of their writers rather than making a dispatcher wait. `MAXDOP 1` means we never take a
parallel worker. `READ COMMITTED`, never `NOLOCK`. The login cannot write anything, anywhere.

Measured on their server with `SET STATISTICS TIME`, median of five runs: **16 ms of CPU and 26 ms
elapsed for all four statements**, 514 rows — **23 CPU-seconds a day** at a 60-second cadence, or
**0.0006%** of a 42-core box, and **0.036%** of its ~138 requests/second baseline.

## Honest scope — read before sending

The session settings in the file (`LOCK_TIMEOUT`, `DEADLOCK_PRIORITY LOW`, `READ COMMITTED`) and the
`OPTION (MAXDOP 1)` after each statement are what the **scheduled** connector will use. **No code in
this agent sets any of them today** — `git grep LOCK_TIMEOUT -- tools/mcleod-agent/*.mjs` finds only
the test. That includes the launchd roster sweep, which has run every 2 minutes against live `lme`
since 2026-09-22 without them (7 ms a cycle, measured 2026-09-23). Making them true is step L5 in
`docs/plans/mcleod/LOADS-GO-LIVE-PLAN.md`, which moves every call site behind one connection and adds
the gates that stop a future call site opting out.

The letter says this to Alex in so many words (under *How we stay out of your dispatchers' way*).
An earlier version of this README claimed every read had used the settings; it was not true. Do **not** let this document imply we have already shipped machinery we
have not: the plan's own rule is that a promise in writing must be true of the code, and L5 is what
makes the last of these promises true.

## The questions it carries

Rewritten 2026-09-22 in the owner's voice, as a letter to Alex, after checking each one against the
research already in `docs/plans/`; questions 1 and 4 made specific on 2026-09-23 from live `lme`:

1. **What are stop types `VA`, `VP`, `SP` and `SD`?** Probe P5 (`LIVE-MAP-PLAN.md` §4.2), run
   2026-09-23. All time: SO 289,780 · PU 281,879 · VA 1,441 · SD 853 · SP 853 · VP 17 · VN 2.
   **SD/SP are a split**: all 853 SD stops have an SP on the same order on a *different* movement
   (218 at the same location — Melrose Park, Floyd's Truck Center, Outpost, our own yard). **VA/VP
   sit at SAIA terminals** (512 of the last year's 638 VA), between two dealer deliveries on the
   Viking Packing runs (279 movements), and 586 of 633 VA arrivals equal the previous stop's
   departure to the minute — a stamped clearance, not a visit. The letter asks whether the truck
   physically stops there, and what separates VA from VP. Movement 291475 shows **5 of its 8
   stops**. Open today: 290911 (VA at Phoenix, no location name) and 291798 (SP at Cheyenne).
2. **Confirm `A` = available, `P` = dispatched.** Asked as a confirmation now, not an open question:
   the data fits (0% dispatcher and trailer on `A`), and `A`/`P`/`D`/`V` are the only four statuses.
3. **Encryption, as a choice.** The old wording asked for "the certificate hostname", but
   `MCLEOD-READ-ONLY-INTEGRATION-HANDOFF.md` §1.2 already recorded that the server presents SQL
   Server's **self-signed fallback certificate** — there is no hostname to give. Alex now picks:
   a trusted certificate, encrypt-without-verify, or unencrypted once the agent is on the Board VM.
4. **Where does a dispatcher's fleet live?** Answered from the data on 2026-09-23 and now asked
   as a confirmation: on 114 open `P` loads, `tractor.fleet_id` names the load's dispatcher on
   **95 of 97** person-dispatched loads (the other 2 are `marija` on `MIRO` trucks), while
   `tractor.dispatcher` agrees on 70. The "4 in 10 disagree" was mostly spelling — the fleet code is
   not the login (`ROMAN` ↔ `romann`, `IVO` ↔ `ivok`, and `users.roman` is a separate *inactive*
   account). 17 loads carry `loadmaster`; the fleet names their real owner. With that, the request
   for `driver.fleet_manager` + `driver.tractor_id` was **withdrawn** from the letter.
   It replaced the old "narrow the `dbo.driver` grant". That
   request was wrong: the eleven "extra" columns are exactly what the roster sync reads in
   `identity` mode (`DRIVER_IDENTITY` in `queries.mjs` — CDL, medical expiry, hire date, address, and
   the email the carrier keeps in `name_of_spouse`), and the launchd sweep runs in that mode against
   `lme` with this login. Narrowing it would have broken the roster.

## Keeping it true

`review.test.mjs` asserts all nine statements with a query builder behind them — the three board
statements, `rosterQueries("identity")` and `retirementQueries()` — are **character-identical** to
the ones in `queries.mjs`, and that the `program_name` the letter names is the `appName` in
`roster.mjs`. (Statement 1, the Change Tracking read, is illustrative until L5 writes it.) Change a query and that test fails, which is the point: the carrier must never
be reviewing a routine we no longer run. If it fails, update the file **and tell them what changed**.
