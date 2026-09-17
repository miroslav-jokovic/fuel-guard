# Handoff — loads from live McLeod, 2026-09-17

**START HERE** for the McLeod loads feed. Read this, then `LOADS-GO-LIVE-PLAN.md` — and read **the
dated log at its END**, not its status header. ⚠ This file goes stale the moment a step lands; where
it names a position, `git log` outranks it.

`main` is at **`ed9774c`**. Nothing is open. Migration **`0344` is applied in production.**

---

## 1. What exists, in one paragraph

A carrier read-only login (`silvicom_dispatch_ro`) reads the **live** McLeod database `lme` over the
VPN. The shipped agent turns the open board into a payload and posts it to `POST /api/tms/loads`,
which lands every load as **`pending_approval`** — a feed cannot put work on a driver's phone. That
has been run **twice against production**: 158 loads and 335 stops are in the database now and
visible on **Dispatch → Loads**. Nothing is scheduled; every run so far was by hand.

| Step | State |
|---|---|
| **L0** token | **DONE** — it was already the live org's; nothing needed rotating |
| **L1** first real pull | **DONE** — 158 loads / 335 stops, all `pending_approval` |
| **L2** review routine for Alex | **DONE, NOT SENT** — `tools/mcleod-agent/review/SILVICOM-READ-ROUTINE.sql` |
| **L3** migration `0344` | **DONE, APPLIED** — `tms_dispatchers` + `loads.dispatcher_external_id` |
| **L11** set-based ingest | **DONE** — 52.1 s → **3.1 s** |
| **L4** write the dispatcher | **NEXT — start here** |
| L5 · L6 · L7 | agent chain: connection policy, change detector, wire it up |
| L8 · L9 · L10 · L11b | blocked on Alex / the VM / sequencing |

PRs: #855 (plan) · #859 (review routine + §4.1) · #861 + #862 (set-based ingest, measured) · #863
(migration 0344).

---

## 2. How to run it — the exact commands

```bash
cd tools/mcleod-agent
node --env-file=.env agent.mjs --loads --dry-run   # reads live lme, posts nothing
node --env-file=.env agent.mjs --loads             # posts to production
```

⚠ **The agent does not read `.env` itself.** It takes plain environment variables, so `--env-file` is
not optional — without it you get `FATAL: --roster needs MCLEOD_SQL_SERVER`, which looks like a
config error and is not.

**Credentials** live in `tools/mcleod-agent/.env` (gitignored, `.gitignore:6-7`). It points at live
`lme`; the old sandbox settings are preserved beside it in `.env.sandbox`.
`docs/plans/mcleod/mail.md` has been **scrubbed** — the password is only in `.env` now.

**The owner has authorised running `--loads` directly.** Do not hand the command back each time.

---

## 3. L4, precisely — the next step

**Why.** `movement.dispatcher_user_id` is populated on **110 of 110** dispatched loads. The agent
reads it, the contract carries it, and the ingest **still discards it** — `tms_dispatchers` holds 0
rows and `loads.dispatcher_external_id` is null on all 158. `0344` gave it somewhere to go.

**Files.** `apps/api/src/modules/mcleod/tmsLoadIngest.ts` (persist the column — note the classify
function builds the insert row and the patch, so it goes in there), `routes/tmsIngest.ts`, new
`tmsDispatcherIngest.ts`, and `tools/mcleod-agent/agent.mjs` (turn on the dispatcher push LM1b left
off — `fetchDispatchLoads` already returns `res.dispatchers`, it is simply never posted).

**Do.**
- `ingestLoads` writes `dispatcher_external_id`.
- New `POST /api/tms/dispatchers` upserts `tms_dispatchers` with **complete** rows (`lint:upserts`)
  and **never touches `user_id`** — that link is an office act (LM11), and a re-sync must not undo it.
- Set `is_system` for `loadmaster` and `lmeadm` from configuration, never from the display name.

**Done when.** `expectOrgScoped` asserts both writers; a test proves a re-sync leaves `user_id`
untouched; a test proves `is_system` is set for the two system accounts; **the `tms_dispatchers`
waiver is REMOVED from `scripts/check-table-producers.mjs`** (see §5); a real `--loads` run shows
`tms_dispatchers` at ~15 rows, 2 of them `is_system`, and `dispatcher_external_id` populated on the
`P` loads.

---

## 4. Traps — each of these cost time today

1. **`node --env-file` truncates an unquoted value at `#`.** A 16-character password parsed as 13 and
   produced a bare `Login failed for user 'silvicom_dispatch_ro'` — no TLS error, no permission
   error, and the same credential worked in a direct probe. **Quote every secret in a `.env`.**
   Diagnose by comparing LENGTHS, never values:
   `node --env-file=.env -e 'console.log(process.env.X.length)'`.
2. **Type every SQL parameter.** `movement.id` is `char(32)`; an untyped `mssql` `.input()` binds
   NVARCHAR, the predicate stops being sargable, and the same query goes **17 ms → 1,977 ms**.
   Silent. All 20 `.input()` calls in the agent are typed — keep it that way.
3. **The full board sweep costs 16 ms of CPU; change detection costs 76 ms.** MC1/MC2's premise is
   inverted at this volume. Keep the detector, but argue it from *our* ingest and from seeing
   cancellations — **never from protecting the carrier's server**, which measurement says it does not.
4. **A composite foreign key containing a NULL is never enforced** (MATCH SIMPLE). A matrix asserting
   "there is deliberately no FK here" passed 14/14 *with the FK added*, because the fixture left
   `loads.provider` null.
5. **Run every `lint:*` script before pushing — there are 39.** Running the handful that look
   relevant shipped a red CI today. `for g in $(node -e "console.log(Object.keys(require('./package.json').scripts).filter(k=>k.startsWith('lint:')).join(' '))"); do pnpm -s $g || echo "FAIL $g"; done`
6. **PostgREST rejects a bulk insert whose rows do not share a key set**, which is why the ingest
   groups creates by whether `hazmat` was sent.
7. **A fresh worktree needs `pnpm install`**, or suites fail for reasons that are not your change.
8. **`lint:table-writers` and `check-table-modules.mjs` both pin write sites by PATH.** Splitting a
   file means repointing both — and a split that leaves the old file writing *nothing* is cheaper
   than one that leaves it writing something, because both lists ratchet.

---

## 5. Debts this work deliberately took on

- **`scripts/check-table-producers.mjs` carries a waiver for `tms_dispatchers`.** It is there because
  two gates genuinely contradict each other: the producer gate wants a writer in the same PR as the
  migration, the ordering gate forbids exactly that for a new column. **L4 must delete that entry**;
  the gate reports a stale waiver by itself.
- **`applyOverwrites` still writes one row at a time**, with bounded concurrency. Labelled in the
  code. Removed by **L11b**, a set-based UPDATE RPC — deliberately sequenced *after* L7, because the
  change detector shrinks that path by an order of magnitude and the migration may then not be worth
  it. **Re-measure before building it.**

---

## 6. Owner actions — nothing below is a code task

1. **Email Alex `tools/mcleod-agent/review/SILVICOM-READ-ROUTINE.sql`.** He asked to review the
   routine before anything runs systematically, and **L9 is blocked on his reply by design.** The
   file carries four questions: what `VA` and `SP` stops are, whether `A` means uncovered, the TLS
   certificate hostname, and narrowing the `driver` grant (it includes **eleven PII columns we did
   not ask for** — birth date, home address, spouse, licence — though not the SSN).
2. **Email Alex for the Board VM.** He said to ask this week. Nothing should run on a laptop.
3. **Decide the roster sync.** One load's driver, `JFERGUSO`, is unmatched — hired 2026-09-14, and
   our roster sweep last ran 2026-09-14 19:11. It is a **stale roster, not a broken link**. Running
   the roster sync then re-running `--loads` fixes it; the sync writes `drivers`, which carries the
   `identity_source` and `merge_driver` traps, and `ROSTER_MODE` is not set in the rebuilt `.env`.
4. **Note `drivers.employee_id` is populated on ZERO of 299 rows.** Every driver match runs on
   `mcleod_driver_id` alone. Not urgent, but it is a single point of failure nobody chose.

---

## 7. What NOT to do

- **Do not re-issue the ingest token** from Settings → Integrations. That is the rotate path, and the
  roster and financial sweeps authenticate with the same token.
- **Do not add the foreign key** from `loads.dispatcher_external_id` to `tms_dispatchers`. Loads and
  dispatchers are two separate pushes; one unknown account would reject a whole board. The matrix
  pins the absence — if it starts failing, read `0344`'s header before "fixing" it.
- **Do not trust an announced sandbox refresh.** `lme_analytics` has now been announced as refreshed
  twice and been frozen at 2026-09-10 both times. Verify from `msdb.dbo.restorehistory` and from
  `CHANGE_TRACKING_CURRENT_VERSION()`, which is frozen on a restored copy and moves constantly on a
  live one.
- **Do not schedule anything** before §6.1 and L5. The review file describes a politeness policy that
  is not yet enforced in one shared helper — that is L5, and the README says so in writing.
