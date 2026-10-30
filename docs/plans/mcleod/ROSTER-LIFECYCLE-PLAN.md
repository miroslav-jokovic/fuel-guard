# McLeod roster lifecycle — hires, departures and truck changes reach Silvicom 360 on their own

Status: **RULED 2026-10-30** (§5). RL1 + RL2 built in one PR; the VM update waits on the release and on Alex's reply about Part 5. Defers to
`MCLEOD-ROSTER-SYNC-PLAN.md` (M5 creation, M6 deactivation) and does not restate it.

## 1. What the owner saw

New hires could not be given a tablet because they were not in 360's driver list. Eight more hires
are expected the week of 2026-11-02, and drivers who switched trucks or left were not reflected
either. The owner asked for the VM to do this on every sweep, not for a one-off fix.

## 2. Measured 2026-10-30 (McLeod read-only from the office network; production read-only)

**The VM is healthy and complete.** Roster checkpoint 18:15Z: 182 drivers, 215 trucks, 223 trailers.
A direct read of McLeod with the same reviewed queries gave the same three numbers.

**Trucks and trailers: 0 missing.** All 215 and 223 are linked in 360.

**Hires: 15 since 10/19, 11 of them this week (10/26–10/30). 4 are not in 360, plus 1 held as an applicant.**

| McLeod | Driver | Hired | In 360 |
|---|---|---|---|
| JBUREN | John Buren | 10/30 | no row |
| JKHALFAN | Jelani Khalfani | 10/30 | no row |
| JFERGUSO | Johnzarric Ferguson | 09/14 | no row (seven weeks) |
| SVIRGIN | Streetie Virgin | 10/29 | EFS fuel-card row created 10/30 18:04, no licence yet: not linked, but active and assignable |
| CHAIRSTO | Curtis Hairston | 10/28 | still `applicant` in Hiring: held out of matching on purpose (rosterMatch) |

**Why the other 11 got in: McLeod has never created a driver row.** The chain that works today is
indirect: the fuel card is issued → the EFS import creates a name-only row (`identity_source='efs'`) →
the Samsara sync fills a licence once the driver has an ELD login → the McLeod sweep claims the row on
that licence (D-MR16, #1543). The Samsara sync no longer inserts drivers: the org is TMS roster master
(`org_integrations.mcleod.config.roster_master = true`), so it is link-only. So **a hire shows up in 360
only after the fuel card is issued, typically 1–3 days after the McLeod hire date**, and never if no card
is issued (Ferguson). The VM runs `ROSTER_MODE=identity`. `create` mode was built in August (M5) but has
never been switched on.

The agent already re-sends unmatched drivers every sweep (`retry` / `forgetUnsettled`, #1543, on the VM
since 10/14). So once a row exists, linking takes no more than 15 minutes. The gap is creation only.

**Departures: 7 drivers are inactive in McLeod but `active` in 360.** AMABLER, TSMITH, GGIBSON, DAWILLIA,
DCHANCE, MNEWKIRK, BMCSWAIN. The explicit retirement sweep exists (`agent.mjs --retire`: McLeod's own
`is_active` plus `termination_date`, with the API's mass-deactivation guard), but it is **not in the
VM's schedule** (`schedule.mjs` JOBS: loads 1 min, close 10 min, roster 15 min, financial nightly). This
is deliberate: the routine sent to Alex says **"PART 5 — WHO HAS LEFT (by hand only, never on a
timer)"**. It was last run by hand in September.

**Truck changes: 115 of 118 trucks on an in-transit McLeod load show the same driver in 360.** 360's
truck→driver link (`vehicles.assigned_driver_id`) comes from Samsara (who is logged into the ELD), not
from McLeod. The 3 that disagree: 717 (McLeod Guajardo, Samsara Garza), 729 (McLeod Sital, Samsara Feagin)
and 641 (McLeod Alfaro, Samsara nobody). McLeod's roster query carries no truck→driver field. Its
dispatch truth is the load's driver and tractor, which the VM already sends every minute.

## 3. Root causes

1. **Nothing creates a driver from the carrier's hire record.** Creation depends on two downstream
   systems (EFS card, then Samsara login), so day-one actions such as a tablet, the driver app or
   equipment have no row to attach to.
2. **Departures stop at the VM because we told the carrier they would.** "By hand only" made sense when
   the only retirement design was by absence (`reconcile`). The explicit-status sweep that replaced it
   is safe to schedule, but the promise in the letter was never revisited.
3. **Nobody is shown the drivers that need a decision.** Applicant collisions, EFS rows waiting for a
   licence and rehires to review are counted in the VM's log and the API response, and appear on no
   screen.

## 4. Steps (one PR each, then ONE VM update carrying RL1+RL2)

- **RL1 — Create on hire.** Turn on `ROSTER_MODE=create` for drivers (trucks and trailers already
  link 100%, and create covers future units). Before switching it on:
  - prove in a test that the downstream systems link to a McLeod-created row instead of duplicating
    it: the EFS import (`driversToProvision` name match), the Samsara link-only sync (id → phone → name),
    and Hiring's hire step (an applicant who becomes a hire);
  - prove that when an EFS row already exists without a licence (the Virgin case), create does not
    insert a second row. The name match plus `mayClaimIdentity` refusal should hold it as `retry`;
  - run `--roster --dry-run` with create against live McLeod and confirm the only rows it would create
    are the 3 in §2 (report mode writes nothing).
  - **Done when:** a McLeod hire appears in the 360 driver list within 15 minutes, before any fuel card
    or ELD login, and later acquires its `samsara_driver_id` (M5's original Done-when).
- **RL2 — Departures on a timer.** Add `{ name: "retire", ... }` to `schedule.mjs` JOBS, after roster.
  It sends McLeod's explicit status and date, never absence (`reconcile` stays refused by `service.mjs`).
  Rewrite Part 5 of `SILVICOM-READ-ROUTINE.sql` and the letter's cadence section in the same PR
  (`schedule.mjs` header requires it). It sends about 1,300 inactive drivers plus trucks and trailers,
  is idempotent, and already-retired rows cost one comparison. Dry run first to list exactly whom the
  first run retires (expected: the 7 in §2 plus any trucks and trailers).
  - **Done when:** a driver made inactive in McLeod is `terminated` in 360 within one cadence, with
    McLeod's termination date.
- **RL3 — "Needs a decision" list.** Surface the sweep's held items on the Drivers page next to the
  McLeod freshness line: applicant collisions (finish the hire), EFS rows waiting for a licence,
  rehires to review, ambiguous matches. Read from the last roster checkpoint, which needs a small
  addition to what the checkpoint stores. No new sync.
- **RL4 — Truck changes** (only if the owner rules for it, Q-RL3). Use McLeod's dispatched driver as the
  fallback when Samsara shows nobody on the truck, and flag trucks where the two disagree. Samsara stays
  primary because it is who is physically logged in.

## 5. Open questions for the owner

- **Q-RL1 — Is McLeod's hire record the moment a driver exists in 360?** Recommend **yes**. It is the
  carrier's system of record, it has the licence and hire date, and the tablet hand-out needs the row on
  day one. Alternative: Hiring creates the row at "hired". That only covers hires that went through
  360's applicant flow, and 4 of the 5 here did not.
- **Q-RL2 — Run departures every 15 minutes with the roster, or once an hour?** Recommend **hourly**. A
  departure is rarely urgent to the minute, and it reads the larger inactive list. The owner or Alex
  must also agree to the letter change, since Part 5 promised "by hand only".
- **Q-RL3 — Should McLeod dispatch fill in a truck's driver when Samsara shows none?** Recommend
  **yes, fallback only**. Disagreements are flagged, never overwritten.
- **Q-RL4 — Ferguson (hired 09/14, no card, no ELD row).** Is he actually driving? RL1 would create him
  on its first sweep.

## 5a. Rulings (owner, 2026-10-30)

- **Q-RL1 — as recommended:** McLeod's hire record is when a driver comes to exist in 360.
- **Q-RL2 — every 15 minutes, with the roster** (rather than the recommended hourly). Checked before
  building: all three reads take about 210 ms on `lme` (1,317 / 464 / 172 rows, 190 KB) against about 150 ms
  for the roster read. On the API side, one select per entity (201 / 257 / 237 linked rows, under
  PostgREST's 1,000 cap), and writes happen only for rows whose status actually changes. No load concern
  either way. ⚠ **It needs Alex's agreement.** "Part 5 stays manual" is a condition in his 2026-09-24
  approval (`mail.md`), not just our wording. The request is `tools/mcleod-agent/review/REQUEST-TO-ALEX-2026-10-30-ROSTER.md`,
  for the owner to send.
- **Q-RL3 — as recommended:** McLeod dispatch is the fallback only, and disagreements are flagged.
- **Q-RL4 — Ferguson is driving.** RL1 creates him on its first sweep.

## 6. Progress log

- 2026-10-30 — measured and written (this document). Nothing built, nothing changed on the VM or in
  production.
- 2026-10-30 — rulings recorded (§5a). Preview of RL2's first run, computed from a read of `lme`
  against production: 7 drivers (the 7 in §2) and trucks 556, 571 and 583 (the same three the parity
  check already reports). 0 trailers.
- 2026-10-30 — RL1 + RL2 built. RL1 found one real hole: an applicant was held back only when their
  licence matched, so an applicant with a blank or mistyped licence fell through to `unmatched`, which in
  create mode means INSERT, making a second driver row beside Hiring's. `rosterMatch` now holds an
  applicant reached by name, and two applicants sharing the name count as ambiguous. Both new tests fail
  with the hold removed. RL2 adds `retire` to `schedule.mjs` JOBS. The reconcile refusal stays, and the
  routine's Part 5 header changes while its SQL stays byte-identical. The letter to Alex is left as
  sent. The change is asked for in the request file.
- **VM update (after release):** `agent.mjs`, `schedule.mjs`, `service.mjs`, the routine file, and in
  `connector.env` `ROSTER_MODE=create`. Same method as 10/12 (download at a pinned commit, SHA-256,
  Stop → copy → tests → Start). If Alex has not answered, install RL1 alone: the env change plus the
  released API. RL1 needs no agent change.
