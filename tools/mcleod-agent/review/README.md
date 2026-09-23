# The read routine, for the carrier's review

`SILVICOM-READ-ROUTINE.sql` is the complete set of statements the LOADS feed runs against LME. It
exists because the carrier's IT asked for exactly this, on 2026-09-17:

> *"You can run any discovery queries on the live data but when you are ready to publish a routine
> that will query the live database systematically as we agreed please sent this to us first for a
> quick review."*

**Send them the `.sql` file.** It is written for a DBA who has never seen this repository, it is
valid T-SQL as it stands, and it returns the same rows our connector sees — verified by executing
it against live `lme` on 2026-09-17: four result sets, 178 ms.

## What it says, in one paragraph

One held connection, four statements, every 60 seconds, from a machine inside the carrier's own
network that connects **outbound** to us — so there is no inbound firewall rule and no IP allow-list
for them to maintain. `LOCK_TIMEOUT 5000` and `DEADLOCK_PRIORITY LOW` mean we lose every contest
against one of their writers rather than making a dispatcher wait. `MAXDOP 1` means we never take a
parallel worker. `READ COMMITTED`, never `NOLOCK`. The login cannot write anything, anywhere.

Measured on their server with `SET STATISTICS TIME`, median of five runs: **16 ms of CPU and 26 ms
elapsed for all four statements**, 514 rows — **23 CPU-seconds a day** at a 60-second cadence, or
**0.0006%** of a 42-core box, and **0.036%** of its ~138 requests/second baseline.

## Honest scope — read before sending

The session settings in the file are the ones **every read we have made has used**, and they are the
ones the scheduled connector will use. They are **not yet enforced in a single shared helper** in the
agent — that is step L5 in `docs/plans/mcleod/LOADS-GO-LIVE-PLAN.md`, which moves every call site
behind one connection and adds the gates that stop a future call site opting out.

Say that plainly if asked. Do **not** let this document imply we have already shipped machinery we
have not: the plan's own rule is that a promise in writing must be true of the code, and L5 is what
makes the last of these promises true.

## The questions it carries

Rewritten 2026-09-22 in the owner's voice, as a letter to Alex, after checking each one against the
research already in `docs/plans/`:

1. **What are stop types `VA`, `VP`, `SP` and `SD`?** Nothing in our docs answers it — probe P5 in
   `docs/plans/livemap/LIVE-MAP-PLAN.md` §4.2 was designed for exactly this and has never been run.
   Until it is, the question stays open-ended. Movement 290837 still shows **6 of its 10 stops**.
2. **Confirm `A` = available, `P` = dispatched.** Asked as a confirmation now, not an open question:
   the data fits (0% dispatcher and trailer on `A`), and `A`/`P`/`D`/`V` are the only four statuses.
3. **Encryption, as a choice.** The old wording asked for "the certificate hostname", but
   `MCLEOD-READ-ONLY-INTEGRATION-HANDOFF.md` §1.2 already recorded that the server presents SQL
   Server's **self-signed fallback certificate** — there is no hostname to give. Alex now picks:
   a trusted certificate, encrypt-without-verify, or unencrypted once the agent is on the Board VM.
4. **Where does a dispatcher's fleet live?** Replaces the old "narrow the `dbo.driver` grant". That
   request was wrong: the eleven "extra" columns are exactly what the roster sync reads in
   `identity` mode (`DRIVER_IDENTITY` in `queries.mjs` — CDL, medical expiry, hire date, address, and
   the email the carrier keeps in `name_of_spouse`), and the launchd sweep runs in that mode against
   `lme` with this login. Narrowing it would have broken the roster. The new question asks which of
   `tractor.fleet_id`, `tractor.dispatcher` or `driver.fleet_manager` is the fleet assignment, and
   for the two columns we asked for and did not get (`driver.fleet_manager`, `driver.tractor_id`).

⚠ **The roster sync's queries are not in the `.sql` yet.** The letter says so and promises them
separately; until they are sent, the file must not be described as everything we run.

## Keeping it true

`review.test.mjs` asserts the three board statements in the `.sql` are **character-identical** to the
ones in `queries.mjs`. Change a query and that test fails, which is the point: the carrier must never
be reviewing a routine we no longer run. If it fails, update the file **and tell them what changed**.
