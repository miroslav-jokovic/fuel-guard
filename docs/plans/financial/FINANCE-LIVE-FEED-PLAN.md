# Finance live feed: McLeod LME → Silvicom 360, nightly, provably complete

**Status:** PROPOSED. **Owner:** Miki. **Written:** 2026-11-22, from a line-by-line read of `origin/main`
`7f2b2a187`. The Board VM runs connector commit `4b93c6e` (LOAD-RATES-VM-UPDATE, 2026-11-20), and
`git log 4b93c6e..origin/main -- tools/mcleod-agent` is empty, so everything said here about the
connector is also what the VM runs.

**The request.** "Turn on live data from the VM. Make sure the connector will not overload the
servers. 100% precise and reliable. Plan it properly, without assumptions."

**Rule of this document.** Every statement is one of three kinds and says which:
- **Code**: read in the code, with `file:line`.
- **Measured**: a number someone took, with the date and who took it.
- **Unknown**: not yet known. It gets a row in §2 with the step that finds out. Nothing is built on an
  Unknown until that step has answered it.

**Scope.** This plan covers the feed: getting McLeod's finance tables into 360 every night,
completely, without loading McLeod or our database too much, and proving it did. It does **not**
cover the per-truck calculation. That is [TRUCK-DRIVER-PNL-PLAN](./TRUCK-DRIVER-PNL-PLAN.md) and
[FINANCE-REPORTS-V2-PLAN](./FINANCE-REPORTS-V2-PLAN.md) F1–F7, worked in a parallel chat. Writing
money back to McLeod through `/ws` is [MCLEOD-API-KIT-PLAN](../mcleod/MCLEOD-API-KIT-PLAN.md).

**What it replaces.** FINANCE-REPORTS-V2-PLAN's **F0** (a laptop re-read of the `lme_analytics` copy).
That copy is the 2026-10-09 restore (Measured 11-18 and 11-22). Re-reading it would still leave the
data six weeks old. Once LME is granted, the live VM sweep (§4) is F0. A laptop run against the copy
is retired (D-LF1).

---

## 1. What is true today

### 1.1 The connector's finance sweep (Code)

| # | Fact | Where |
|---|---|---|
| C1 | One sweep, statements one after another, never two at once. Order: settlements + deductions → AP vouchers (and fuel, see C6) → movement facts → billing → GL accounts → GL control → tractor periods → office lines → per month: ledger totals, then ledger key lines → fuel-tax receipts (2 years) | `agent.mjs:718-835` |
| C2 | Scheduled daily at 02:00 Central. A failure retries every 30 min until it succeeds. | `schedule.mjs:39`, `dueJobs` |
| C3 | Window = trailing 75 days ending tomorrow. On days 1–3 of a month, also the two previous months, read whole. `FINANCIAL_WINDOW_DAYS` overrides the 75. | `agent.mjs:120`, `windows.mjs:52` |
| C4 | Ledger totals and key lines are read per calendar month the window touches, whole months, each replacing that month in 360. | `agent.mjs:799-819` |
| C5 | Every statement: `SET LOCK_TIMEOUT 5000`, `OPTION (MAXDOP 1)`, a 15 s cap, and a breaker that pauses all McLeod reads for 15 min after 3 failures. | `connection.mjs:27,32-35` |
| C6 | The sweep reads fuel purchases **and** `FUEL_LEDGER_LINES` every night, then posts neither ("Fuel purchases are deliberately NOT posted"). Only the vouchers from the same call are sent. `FUEL_LEDGER_LINES` filters `gl_ledger` by `post_key IN (…)` with no date bound on `gl_ledger` itself. | `agent.mjs:741,832`, `expenses.mjs:110`, `queries.mjs:512-524` |
| C7 | Office lines read the ledger for the whole window (`fetchLedgerControl`, :790). The month loop then reads the same ledger again month by month (:800). So the ledger is read twice a night. | `agent.mjs:790,800` |
| C8 | `FINANCE_FEED=off` removes finance from the schedule. Unset means on. The template ships `off`. | `agent.mjs:129`, `connector.example.env:43` |
| C9 | A first start with no record seeds `runs.financial = now`, so a daytime first start waits for 02:00. **But the seed only happens once.** On the VM the record was seeded at the first install. Turning the feed on and restarting at any hour after 02:00 makes the sweep due **immediately**, because the stored success is older than today's 02:00. | `agent.mjs:1006`, `schedule.mjs` `dueJobs` |
| C10 | Only `--service` takes the lock. A one-shot `--financial --dry-run` runs beside the service, as a second connection. | `agent.mjs:976` |
| C11 | `--financial --dry-run` runs every statement and posts nothing. | `agent.mjs:710-725` |
| C12 | No connector change is needed for go-live itself. The VM's settings scripts change only `Url` or `Token` (`set-connector-line.ps1` `ValidateSet`) and the lumper switch (`set-lumper-feed.ps1`). **No script turns `FINANCE_FEED` on**, so today that is a hand edit of `connector.env`. | `windows/*.ps1` |
| C13 | The template and the VM guide still name the old Railway address (owner rule: AWS only). The VM's own `connector.env` works: the loads feed posts every minute. | `connector.example.env:9`, `review/CONNECTOR-ON-THE-VM.md:19` |

### 1.2 Our side (Code)

| # | Fact | Where |
|---|---|---|
| S1 | **Every** finance POST stamps "financial synced now". The first post of the night (settlements) marks the whole sweep fresh, even if it dies at billing. | `routes/tmsFinancial.ts:49,66,83,103,120,188,207,241` |
| S2 | The stale alarm exists: no sweep for 26 h → an office notification and email, critical after 72 h, once a day. Because of S1 it measures "something arrived", not "the night completed". | `financial/financialFreshness.ts:29,114` |
| S3 | The projection into `financial_entries` runs 90 s after the API boots and then every 24 h from that moment, not after the sweep. The release deploys at 01:07 CT, so on release nights it runs about 01:10, **before** the 02:00 sweep, and the pages show yesterday's sweep until the next night. | `financial/projectionScheduler.ts:68-69` |
| S4 | Each month's ledger lands through one RPC call (`replace_mcleod_gl_days`, `replace_mcleod_gl_key_lines`). PostgREST runs it under `authenticator`'s 8 s statement limit (`service_role` has no override). That limit has failed a real job before (0348: 11.2 s > 8 s, every run). | `mcleod/ledgerControlIngest.ts:66`, `ledgerKeyLines.ts:39`, `supabase/migrations/0348…:27` |
| S5 | `/api/tms` has one limiter, 300 requests per 15 min, **shared** by loads (every minute), close, roster, retire, lumper and finance. | `app.ts:351-358` |

### 1.3 Data state (Measured 2026-11-22, production, by the assistant)
Last financial sweep landed 2026-10-09 18:59Z. `bill_type` set on 0 of 14,156 billing rows,
`void_date` 0, `mcleod_gl_control` / `mcleod_gl_key_lines` / `mcleod_tractor_periods` 0 rows,
`mcleod_gl_days` June–October only. July: the per-truck tabs add up to $5,201,876.04 against ledger
BILL $4,815,320.41 (8.0% high, Measured 11-18). The October fixes are released but have done nothing,
because nothing has been re-read since.

### 1.4 Grants (Code + Unknown)
`review/SILVICOM-GRANTS.sql:153-174` lists Part 4 (finance tables on LME) as "added 2026-11-13, NOT
YET RUN". The owner believes Alex has since run it. **The file cannot tell us. Only a read as the VM's
login can** (U1). The assistant's own check against LME was refused by its permission rules
(2026-11-22), and it is not retried another way.

---

## 2. Unknowns, and the step that answers each

| # | Unknown | Why it matters | Answered by |
|---|---|---|---|
| U1 | Are Part 4's 15 tables (and the earlier tables the sweep reads) readable on LME by `silvicom_dispatch_ro`? | No grant = the sweep fails at 02:00 and every 30 min after, all day. | **LF0** dry run: any `permission denied` names the table |
| U2 | How long each statement takes on **live** LME, at night, beside the service. Only the copy was ever timed. | The 15 s cap (C5) fails a slow statement, and the breaker then pauses loads too. | LF0 prints per-statement timings |
| U3 | How long `FUEL_LEDGER_LINES` takes on LME (C6). | Its `gl_ledger` side has no date bound. | LF0. Removed anyway by LF1 |
| U4 | How long one month's `replace_mcleod_gl_days` / `replace_mcleod_gl_key_lines` takes on our micro database, at the largest month (about 15k key lines). | Over 8 s = that month fails every night (S4). | **LF3** measurement, in a rolled-back transaction on staging with a real month's payload size |
| U5 | How many `/api/tms` requests the VM sends per 15 min today. | Finance adds a few dozen posts a night (an estimate from the batch sizes, not measured). A catch-up month adds a few more. Over 300 = 429s for loads **and** finance (S5). | VM `connector.log`, one hour, counted. Owner pastes it, or LF0's output |
| U6 | Has the office been getting "McLeod financial sweep is N days old" every day since 10-12? | If yes, the alarm works and was ignored. If no, the alarm is broken. Either way it changes LF4. | One query on `notifications` (owner runs, or grants the assistant the read) |
| U7 | Which McLeod report(s) the owner compares our numbers against (name, the settings used, the date basis). | "100% precise" needs a target. Without the report we can only tie to the ledger, which is not what the owner looks at. | **Q-LF1**, owner |
| U8 | Is the October 9 data in 360 different from LME for Sep–Oct (late entries, voids)? | It sizes how much the first live night moves numbers, so nobody reads a jump as a bug. | LF6 night-one diff |

---

## 3. Decisions proposed

**D-LF1 — LME is the only finance source. The laptop and the copy are retired for finance.**
A laptop run posts whatever database its `.env` names. `tools/mcleod-agent/.env.sandbox` names
`lme_analytics` (the 10-09 copy), and a run from it after go-live would overwrite live months with
six-week-old figures. So: after LF6, `--financial` without `--dry-run` refuses to run outside
`--service`, unless `MCLEOD_SQL_DATABASE` is the production database name set on the VM. The CLI
dry runs stay.

**D-LF2 — A night is complete or it did not happen.** The connector sends a closing
`POST /api/tms/financial-sweep` with the window, the statements run, and each one's row count and
sum. 360 stamps "financial synced" **only** there (not on every post, S1). The stale alarm (S2) then
means "no complete night in 26 h". A sweep that dies halfway leaves the previous complete stamp in
place and raises the alarm. Its partial rows stay, as they do today, because every table is replaced
per window or month, and the next good night overwrites them.

**D-LF3 — The projection runs because the sweep finished, not on a timer.** The closing post
(D-LF2) queues the existing `financial_projection` job for that org and that window. The 24 h timer
stays as a safety net. This fixes S3.

**D-LF4 — Catch-up is one month a night, oldest first, until done.** The nightly window stays 75 days
(C3). On top of it, each night also re-reads **one** extra month from a list (2026-01 … 2026-08), and
records it in `service-state.json` only when the closing post (D-LF2) succeeds. Eight nights. Each night reads about four months instead of three, so roughly a third more (an estimate, confirmed by LF0 timings). Not chosen: one `FINANCIAL_WINDOW_DAYS=322` night. It is the
heaviest read we would ever make on LME, it was only ever timed on the copy, and one failure repeats
the whole year every 30 minutes (C2).

**D-LF5 — The first live sweep runs only at 02:00.** Fixes C9: when the service starts and the feed
has just been turned on (the stored record predates the switch), it re-seeds the record so the sweep
waits for the next 02:00. A forced run stays possible by hand (`--financial`, under D-LF1).

**D-LF6 — The nightly sweep stops reading what it throws away.** `FUEL_LEDGER_LINES` and fuel
purchases come out of `--service`. They stay in the CLI tie-out, where they are printed (C6). The
office-lines read reuses the month loop's ledger read instead of a second whole-window read (C7).
That saves load on LME, and removes the one statement with no date bound on `gl_ledger`.

**D-LF7 — The finance switch gets a script like the lumper's.** `set-finance-feed.ps1 -On|-Off`, the
same guarantees as `set-lumper-feed.ps1` (stop, one line, no BOM, restore on failure). No hand edit of
`connector.env` (C12). The same PR fixes the Railway address in the template and the VM guide (C13).

---

## 4. Build steps — one PR each unless noted

| Step | What | Who | Done when |
|---|---|---|---|
| **LF0** | Dry run on the VM, after 18:00 CT: `node --env-file=connector.env agent.mjs --financial --dry-run` from `C:\Silvicom\connector`. Posts nothing. | **owner / VM admin** | Output pasted. Answers U1, U2, U3. Any denied table → one complete request to Alex (memory rule: never "also") |
| **LF1** | Connector: D-LF6 (drop fuel reads from the sweep, single ledger read), D-LF5 (first run at 02:00), D-LF4 (one catch-up month a night), D-LF1 (refuse a non-service posting run against the copy). Tests in `schedule.test.mjs` / `windows.test.mjs` for each. | assistant | gates green; dry run on the copy shows fewer statements and the catch-up month |
| **LF2** | API: `POST /api/tms/financial-sweep` (D-LF2), the stamp moved there, queue `financial_projection` (D-LF3), connector sends it last. Matrix/unit tests: a sweep without the closing post leaves the stamp alone. | assistant | gates green; staging shows the stamp move only on the closing post |
| **LF3** | Measure U4 on staging: the largest month's RPC, timed. If it is over 4 s (half the limit), split the RPC per module inside one transaction or raise `service_role`'s `statement_timeout` for these two functions only (`SET statement_timeout` in the function, a migration). | assistant | a number in §6, and the fix if needed |
| **LF4** | `set-finance-feed.ps1` + the Railway-address fix in template and guide (D-LF7, C13). | assistant | script tested like `set-lumper-feed.test.ps1` |
| — | **Release** LF1–LF4 to production (release train). Update the VM to that commit with `update-connector.ps1 -Commit <sha>`. | owner approves release; VM admin runs update | VM log shows the new commit's tests passed |
| **LF5** | Go-live: VM admin runs `set-finance-feed.ps1 -On` **before 18:00 CT**. The service restarts and waits for 02:00 (D-LF5). | VM admin | log line: `financial ON`, next run 02:00 |
| **LF6** | Night one check (assistant, next morning): closing post landed. Every table's row count and sum vs the connector's own reported counts. `bill_type`, `void_date`, `gl_control`, key lines, tractor periods all non-zero. Sep–Nov ledger totals = the LME ledger totals the connector reported. Size U8: what moved vs the 10-09 data. | assistant | §6 Night one table filled. Owner told in one message what moved and why |
| **LF7** | Catch-up nights 2–9 (Jan–Aug, D-LF4). Each morning: that month's totals tie (§5 checks 1–3). | automatic; assistant checks | all 2026 months tie; `mcleod_gl_days` January–May present |
| **LF8** | Re-measure July. Per-truck total vs BILL. This is the hand-off point to the calculation plan (FINANCE-REPORTS-V2 F1+). | assistant | number recorded; the parallel calculation work starts on live data |

LF1–LF4 do not depend on LF0's answer, and can be built while the owner runs LF0. LF5 waits for LF0
(grants proven) **and** the release.

---

## 5. What "100% precise" is checked against — every night, automatically

Each check is a sum in 360 against a sum the connector read from McLeod **in the same night**, sent in
the closing post (D-LF2). Each is shown on the finance page as passed / failed, with the difference
in dollars. Nothing is shown as "ties" by construction (today's badge is, see FINANCE-REPORTS-V2 audit
2026-11-22).

1. **Rows arrived.** Per table: rows 360 holds for the window = rows the connector read.
2. **Ledger.** Per month and per posting module: `mcleod_gl_totals` = `gl_ledger` sum on LME, to the cent.
3. **Sub-ledger to ledger.** Per month: billing posted (`post_key` in BILL key lines) = BILL ledger
   revenue. Settlements = SET/SETV. AP vouchers = AP. Each with the unexplained difference shown.
4. **Per truck adds up.** Sum of every truck's revenue + "no truck" bucket = BILL revenue (check 3).
   The same for each cost family that is attributed. This is the calculation plan's to build. This
   plan only provides the data and the targets.
5. **The owner's McLeod report** (Q-LF1): once named, the same figures, same basis, reproduced for one
   closed month and held there by a test on a saved copy of that month's numbers.

An open period (`gl_control`) is labelled open, never final.

---

## 6. Open questions

- **Q-LF1 — Which McLeod report is "the" number?** Name, menu path, the settings used (by bill date
  or delivery date? posted only?), and a saved copy for one closed month (July or September). Without
  it §5.5 cannot exist. *Recommendation:* the owner sends one PDF/export for September and the settings
  screen.
- **Q-LF2 — Who receives the "night failed" alarm?** Today the office finance recipients
  (`officeRecipients.ts`). *Recommendation:* add the owner by name for the first two weeks.
- **Q-LF3 — Catch-up range.** January–August 2026 only, or also 2025 (needed for year-over-year)?
  *Recommendation:* 2026 first (8 nights), then decide. 2025 adds 12 nights and no current page reads it.

---

## 7. Progress log

- 2026-11-22 — Plan written from `origin/main` `7f2b2a187`. Not yet run: LF0 (owner).
