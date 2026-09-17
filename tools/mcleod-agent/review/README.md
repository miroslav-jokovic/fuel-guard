# The read routine, for the carrier's review

`SILVICOM-READ-ROUTINE.sql` is the complete set of statements Silvicom 360 runs against LME. It
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

## The four questions it carries

1. **What are stop types `VA` and `SP`?** We refuse to guess a stop kind, because our mapping drives
   the driver's photo checklist — a yard move called a delivery asks for a bill of lading that does
   not exist. Today that refusal leaves movement 290837 showing **6 of its 10 stops**.
2. **Does `movement.status = 'A'` mean available / not yet covered?** 46 of them carry no dispatcher
   and no trailer, which is what the data looks like, but we would rather be told.
3. **The TLS certificate hostname**, so we stop connecting unencrypted. TLS will not accept an IP
   address as a server name.
4. **Please narrow the `dbo.driver` grant.** It currently includes eleven columns we never asked for
   — birth date, home address, city, state, zip, spouse's name, licence number/state/date, medical
   certificate expiry, hire date. We need six: `id`, `company_id`, `first_name`, `name`, `is_active`,
   `termination_date`.

## Keeping it true

`review.test.mjs` asserts the three board statements in the `.sql` are **character-identical** to the
ones in `queries.mjs`. Change a query and that test fails, which is the point: the carrier must never
be reviewing a routine we no longer run. If it fails, update the file **and tell them what changed**.
