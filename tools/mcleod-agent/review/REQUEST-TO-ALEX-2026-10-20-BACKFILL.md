**Subject:** One more read statement, run once: delivered loads from before September

**Attach:** `SILVICOM-READ-ROUTINE.sql` (this folder, as on `main`; the new statements are Part 6) and
`silvicom-connector-update-2026-10-20.zip` (built by the owner's session from `main` with
`git archive`, tracked files only, `connector\` folder only; no Node, no `node_modules`, no secrets).

> **Why this exists (DISPATCH-LOADS-COUNTS-PLAN DLC4, D-DLC6).** The Loads page shows deliveries from
> the day the mirror began, 09/17/2026, and nothing earlier; the owner asked for six months. The
> connector's board read is `status IN ('P','A')` and its close read looks up ids it once held open,
> so a movement that was already `D` on 09/17 has never been read. Six months of them are in the live
> `movement` table (the finance read already reads June's trips from it). Diff of the VM's `connector\`
> against `main`, 2026-10-20: `queries.mjs`, `loads.mjs`, `agent.mjs`, `package.json` (one script),
> the tests, and the review files; `package-lock.json` is unchanged, so the installed `node_modules`
> stays. About 4,500 movements and 10,000 stops for six months, read a month at a time.

---

Hi Alex,

One more thing to read, for your review as agreed, and this one runs once rather than on the
schedule.

**What it reads.** Part 6 of the attached SQL file: delivered movements (`status = 'D'`) whose truck
left a stop between two dates, with the same columns as Part 1 (the open board) and their stops as in
Part 2. The window is on the stop's actual departure, so the far-future placeholder dates in `stop`
are never read. Same login, same tables, nothing that writes.

**Why.** Our Loads page can only show deliveries since 09/17, when the connector started. The office
wants to look back six months, and those loads are in `movement` already — they were just never
open while the connector was watching.

**If that's fine, the update takes a few minutes on the VM** (PowerShell as Administrator, in the
folder with `install-connector.ps1`):

    powershell -NoProfile -ExecutionPolicy Bypass -File .\install-connector.ps1 -Step Stop
    Expand-Archive .\silvicom-connector-update-2026-10-20.zip -DestinationPath .\update -Force
    Copy-Item .\update\connector\* .\connector\ -Recurse -Force
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install-connector.ps1 -Step Start

**Then the one-off read**, from the `connector` folder, a month at a time, dry run first so you can
see the counts before anything is sent:

    npm run loads:backfill -- --from=2026-04-01 --to=2026-05-01 --dry-run
    npm run loads:backfill -- --from=2026-04-01 --to=2026-05-01

and the same for May through September (`--to=2026-09-18` for the last slice, which overlaps the
first day the service was running; a load it already holds is simply rewritten with the same
values). The dates are McLeod's own days; the window is from the first date up to, not including,
the second. Each slice is a few seconds of CPU and prints counts only — no names, as always.

If anything in Part 6 looks wrong, say so and nothing runs.

Thanks,
Miki
