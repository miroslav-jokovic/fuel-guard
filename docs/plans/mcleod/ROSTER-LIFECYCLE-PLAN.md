# McLeod roster lifecycle — hires, departures and truck changes reach Silvicom 360 on their own

Status: **RULED 2026-10-30** (§5, §5a). RL1 + RL2 built in one PR; one VM update installs both (the owner has admin on the VM). Defers to
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
- **RL3 — "Needs a decision" list.** BUILT 2026-10-30 (§6). Surface the sweep's held items on the Drivers page next to the
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

- **Q-RL5 — Kenneth Satterwhite (KSATTERW): McLeod lists him active AND terminated on 11-07.** Asked
  2026-11-06. Read from `lme` at 21:00Z: `is_active = 'Y'`, termination date 2026-11-07 (the day after),
  hire date 2025-01-29. The 19:35Z retire run had received him as NOT active and terminated our row with
  that date. By 20:15Z McLeod listed him active again, so he went on the held list as a rehire to
  review, and the list tells the office he "worked here before". For him that reads backwards: he seems to
  be leaving, not returning. Candidate answers:
  (a) **leave it**. When McLeod sets him inactive the retire run keeps our row as it is and takes him off
  the list. Costs nothing, but if McLeod keeps `is_active = 'Y'` past 11-07 he stays held.
  (b) **a new rule: active in McLeod with a termination date still ahead means notice was given and the
  driver is still employed.** Our row goes back to active and keeps the date, and the retire run ends it on
  the day. This is right only if the office enters a last day ahead of time, and nothing measured says
  they do. One driver, one day.
  **Recommend (a)**, after asking the office what they changed on him today. Build (b) only if entering
  the last day in advance turns out to be their habit.

## 5a. Rulings (owner, 2026-10-30)

- **Q-RL1 — as recommended:** McLeod's hire record is when a driver comes to exist in 360.
- **Q-RL2 — every 15 minutes, with the roster** (rather than the recommended hourly). Checked before
  building: all three reads take about 210 ms on `lme` (1,317 / 464 / 172 rows, 190 KB) against about 150 ms
  for the roster read. On the API side, one select per entity (201 / 257 / 237 linked rows, under
  PostgREST's 1,000 cap), and writes happen only for rows whose status actually changes. No load concern
  either way. ⚠ **It needs Alex's agreement.** "Part 5 stays manual" is a condition in his 2026-09-24
  approval (`mail.md`), not just our wording. The request is `tools/mcleod-agent/review/REQUEST-TO-ALEX-2026-10-30-ROSTER.md`,
  for the owner to send.
- **Q-RL2a — the owner, later the same day: "we have admin privileges on the VM, we don't need Alex
  anymore."** The approval condition is the owner's to change, and they changed it. The request file
  stays in `review/` as an optional note to Alex, not a gate. Two conditions came with the ruling, and
  both were measured against `lme` before merging:
  - *No overload.* Under `SET STATISTICS TIME, IO`, the three Part 5 reads cost **15 ms CPU and 507
    logical reads** together (driver 356, tractor 109, trailer 42), the same as Part 3, which already runs
    every 15 minutes. They go through the same `withPool` as every read: one connection,
    `LOCK_TIMEOUT 5000`, `DEADLOCK_PRIORITY LOW`, `MAXDOP 1`, a 15-second ceiling, and the
    three-timeout breaker.
  - *Precise column names.* Every column referenced in the six roster and retire statements (18 / 15 /
    12 / 4 / 4 / 4) exists in `INFORMATION_SCHEMA.COLUMNS` for `dbo.driver` / `dbo.tractor` /
    `dbo.trailer`, and every one returns data. The only exception is `termination_date` on active
    drivers, which is correctly empty.
- **Q-RL3 — as recommended:** McLeod dispatch is the fallback only, and disagreements are flagged.
- **Q-RL4 — Ferguson is driving.** RL1 creates him on its first sweep.

## 5b. Rulings (owner, 2026-11-06)

- **D-RL5 — McLeod's hire is the hire, including for somebody who applied through 360.** The owner, about
  the held list's "finish the hire in Hiring": *"hiring is not done from 360"*. RL1's applicant hold waited
  for a Hire press that never comes, so Curtis Hairston (applied 10-21, hired in McLeod 10-28) was still
  missing from Drivers on 11-06. Now, when McLeod lists a driver active and exactly one open application
  matches on the licence **and** the name (full name, or given name and surname), the sweep links that
  application row to McLeod and hires it through `hire_applicant`, with McLeod's hire date and no person as
  the actor (`rosterApplicantHire.ts` → recruiting's `recordHireFromTms`). The application, its consents and
  every screening stay on the same row. Licence or name alone stays held: one archived application carried
  another driver's licence. **Relation to Q-HM5:** the 360 Hire button still refuses an unfinished file.
  The sweep cannot refuse a hire that has already happened, so it writes what the button would have refused
  for onto the `driver.hired_from_tms` audit row (`openSteps`), and the DQ file shows the gaps.
- **D-RL6 — McLeod taking back its own termination is a rehire.** Amable Rafael Nin Diaz was terminated
  in McLeod 10-28 (copied here by the 10-30 retire run). By 11-04 McLeod listed him active again with no
  termination date and his 2024 hire date, so D-MR7a's "hire date after termination" could not prove it.
  The held list also told the office to "unarchive" a row that was terminated, not archived. Now the sweep
  restores the row when McLeod sends `termination_date: null` for an active driver and nobody HERE ended
  the employment: no `driver.updated` audit row touching status or termination date, and no
  `driver.archived` by a member. A termination or archive done in 360 stays a review item (D-MR7's case).
  The audit row says which rule proved it (`proof`).

## 5c. Rulings (owner, 2026-11-09)

- **Q-RL5 answered — option (a) did not hold.** On 11-09 McLeod still listed KSATTERW `is_active = 'Y'`
  with termination date 11-07, two days past it; his last HOS segment was 11-06 and his last fuel 11-05.
  He left, and the held list was telling the office to set him back to Active.
- **D-RL9 — a row the cleanup archived without a termination date can be proven rehired.** The 09-14
  reconcile archived 120 rows with no termination date, so rule D-MR7a had nothing to compare and such a
  driver was a review item forever (WCHRISTO). Now the archive day stands in for the termination date:
  McLeod's hire date strictly after it, McLeod sending no termination date, and no person here having
  archived or terminated the row (`officeEndedEmployment`) restores it, audited `proof: hire_after_archive`.
- **D-RL10 — McLeod listing a driver active with a last day is an ending, not a rehire.** A McLeod record
  whose termination date is on or after its hire date is held as `ended_in_mcleod`, with the date, and the
  list tells the office to set the driver inactive in McLeod (or clear the date there if they are staying,
  which D-RL6 then restores). Nothing on our row moves, and no second row is created.

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
  Stop → copy → tests → Start). RL1 is safe before the release on today's data: the
  only applicant matching a McLeod driver by name (CHAIRSTO) also matches by licence, so the
  production API holds him either way.
- 2026-10-30 — RL1 + RL2 merged (#1858, `43f6abc`). The VM update is now a script,
  `tools/mcleod-agent/windows/update-connector.ps1`, built on `set-connector-line.ps1`'s pattern. It
  installs the WHOLE connector source (36 files) from one pinned commit rather than patching file by file,
  because after the 10/10, 10/12 and 10/14 patches nobody could say which version of each file the VM
  runs. Every file is checked by SHA-256 before the connector is stopped, the tests run on the VM, exactly
  one env line (`ROSTER_MODE`) changes, and any failure restores everything. Checksums come from git
  objects via `windows/manifest.mjs`. Rehearsed on the Mac from the public raw URLs at `43f6abc`: 36/36
  checksums match, 151/151 tests, and a create-mode `--roster --dry-run` against `lme` read 182 / 215 / 223
  and wrote no state.
- 2026-10-30 — **VM updated by the owner over RDP (20:04Z) and verified in production.** The first retire run
  terminated 9 drivers (the 7 in §2, plus JOVANB and RBRIGHT, both terminated in McLeod that day) and
  retired trucks 556, 571 and 583. The 20:16Z roster sweep created JBUREN, JFERGUSO and JKHALFAN with
  licence, medical card and hire date, one row each. CHAIRSTO is held as an applicant.
- 2026-10-30 — **RL3 built.** The sweep's held drivers are kept on their own `org_integrations` row
  (`mcleod_roster_held`), not on the checkpoint's config, which `stampRosterRead` replaces whole. Each
  driver POST updates only the drivers it carried (`mergeHeld`); the retire POST clears departures
  (`clearedByRetire`). It is read at `GET /api/integrations/mcleod/roster-held` (roster: view) and shown
  above the Drivers list (`RosterHeldList`) with the step that settles each reason. No agent change, no
  VM update. Found while building it: in create mode, a McLeod driver who answers only to an ARCHIVED
  former row whose rehire McLeod's dates do not prove was read as `unmatched` and would have been created
  a second time. `ingestDrivers` now never inserts for a `rehireReview` id. It had not happened yet:
  today's three hires have no former rows.
- 2026-11-06 — **D-RL5 + D-RL6 built** (§5b). Measured first, read-only, against `lme` and production:
  of McLeod's 185 active drivers, every one had a linked row here except CHAIRSTO (an application row, same
  licence, same name). AMABLER was linked but terminated (10-28, by the retire run) while McLeod listed him
  active with no termination date.
  Both are on the held list and re-sent every sweep (`retry`), so the first sweep after the release settles
  them without a VM change. Ten mutants against the new guards (the name check, the live-row check, the
  office check, `=== null`, the failed-audit-read answer, the system-archive exemption, the unfinished-file
  refusal, the null actor, the ended links, the refused-hire count), all ten caught. The held list's two
  wrong instructions were rewritten.
- 2026-11-06 — **Release v2026.11.06 checked against production, and D-RL7 built.** The deploy went live
  20:51:50Z. The 20:46Z sweep had run the old code, and the 21:01Z sweep was the first under D-RL5/D-RL6.
  **CHAIRSTO settled**: hired from his application, linked to McLeod, active with hire date 10-28, and off
  the list. **AMABLER did not**, and the entry above was wrong to say held drivers are "re-sent every
  sweep". `withRetry` names the unmatched, the ambiguous and the applicants. It never named
  `rehireReview`, so after the 11-04 sweep that held him he was never carried again, and D-RL6 never saw
  him. **D-RL7:** the driver route now names every driver on the held list after the POST in `retry`,
  carried or not, using the list itself rather than a list of buckets. `forgetUnsettled` forgets any id it
  is told, so AMABLER is re-sent on the sweep after the next driver POST, and D-RL6 restores him there.
  No VM change. With the union removed, the new route test fails. KSATTERW is a separate case and is
  Q-RL5.
- 2026-11-06 — **AMABLER restored; reconcile fixed (D-RL8).** McLeod sends driver rows only when one
  changes, so after D-RL7 shipped (`e0f6123`) AMABLER would still have waited for the next McLeod driver
  edit, about every few hours on weekdays and never at weekends (measured over 7 days). The owner ran
  `agent.mjs --roster --full` on the VM at 21:56Z with the connector stopped: 181 drivers sent, AMABLER
  restored (`driver.rehired_from_tms`, `proof: tms_termination_reversed`), and KSATTERW still held (Q-RL5).
  The run also held **WCHRISTO (Christopher Weaver)**. That was not McLeod: at 21:46Z the owner's
  **Reconcile duplicates (apply)** had merged 26 pairs, and for Weaver it folded his LIVE row (created by
  the sweep 11-03) into his ARCHIVED, Samsara-linked July row and deleted the live one. `planDriverMerges`
  read archived rows. **D-RL8:** an archived, terminated or inactive row is neither kept nor folded by an
  automatic merge, and the manual link refuses to keep one. The pairs are shown as "Needs a look" in the
  panel (`heldDriverMerges`, derived from the same planner). Weaver himself is unarchived by hand on
  Drivers. Mutation: with the filter removed, 4 shared tests and 1 API test fail; with the manual-link
  guard removed, 1 API test fails.
- 2026-11-09 — **"2 drivers in McLeod are not on this list yet" — D-RL9 + D-RL10 built.** Measured first:
  production already ran D-RL7 (`e0f6123`, `verify:live` green) and the pending release carried only
  D-RL8, which changes neither driver. WCHRISTO's only row was the July Samsara row archived 09-14 with
  no termination date — the 11-06 manual merge folded his new row into it, and the "unarchived by hand"
  above never happened (still archived on 11-09). McLeod: active, hired 11-03, no termination; HOS and
  fuel every day since 11-07. KSATTERW: see §5c. D-RL9 restores WCHRISTO on the first sweep that
  carries him (every sweep: D-RL7 re-sends the held list). D-RL10 relabels KSATTERW until the office
  sets him inactive in McLeod, after which the retire run takes him off the list. Mutations: without
  the archive stand-in 1 test fails; without the office check in it 2; without D-RL10 4; with creation
  no longer held back for `ended_in_mcleod` 1.
