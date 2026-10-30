**Subject:** One change to the connector's schedule: the "who has left" reads every 15 minutes

**Attach:** `SILVICOM-READ-ROUTINE.sql` (this folder, as on `main`; Part 5's header is the only change,
and its three statements are the same ones you reviewed).

> **Optional since the owner's ruling Q-RL2a (2026-10-30):** the owner has admin on the VM and does
> not need Alex's agreement. This is kept as a courtesy note the owner may send. It is not a gate.
>
> **Why this exists (ROSTER-LIFECYCLE-PLAN RL2, owner's ruling Q-RL2 2026-10-30).** Alex's approval of
> 2026-09-24 set a condition: "Part 5 stays manual." Putting Part 5 on a timer changes that condition,
> so it is asked for, not just announced. The other half of the same VM update (RL1, `ROSTER_MODE=create`)
> runs no new SQL and is not part of this request. Measured 2026-10-30 against `lme` under the connector's
> guards: all three reads together take about 210 ms and return 1,317 / 464 / 172 rows (190 KB). The
> Part 3 roster read on the same cycle takes about 150 ms. Do not send before the owner has read it.

---

Hi Alex,

One change to ask you about before we make it.

**What.** Part 5 of the SQL file, the three "who has left" reads (inactive drivers, retired trucks,
retired trailers), would run every 15 minutes, right after the driver/truck/trailer read, instead of
by hand. The statements are unchanged. Only the schedule changes.

**Why.** We ran Part 5 by hand last in September. This week seven drivers you terminated between
10/23 and 10/28 were still active on our side, still holding trucks and tablets. Hiring is picking up
(eight more next week), so doing this by hand no longer keeps up.

**How much.** About 210 ms for all three together, measured on LME today with the same settings as
every other read (one core, 5-second lock timeout, 15-second ceiling, the 15-minute back-off after three
timeouts). That is one extra short read every 15 minutes, run one after another with the others on
the same connection, never at the same time.

**What it still won't do.** Nothing is ever inferred from a record that is simply missing. We only act
on what McLeod itself marks inactive, with its termination date. That is why the "reconcile" mode
stays switched off on the VM, as you asked. On our side, one call can never retire more than half the
active list, so a bad read can't empty the roster.

If you're OK with it, we'll install it on the VM the same way as the 10/12 update. If not, Part 5
stays manual and we'll run it by hand more often.

Thanks,
Miki
