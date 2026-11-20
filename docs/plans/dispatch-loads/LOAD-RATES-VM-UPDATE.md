# Load rates: updating the connector on the Board VM — step by step

Companion to `LOAD-RATES-PLAN.md` (§4). Every command below was checked against
`tools/mcleod-agent/windows/update-connector.ps1` and `tools/mcleod-agent/agent.mjs` on main
(2026-11-20). Each step says what you should see, and what to do if you see something else.

> **⛔ Do not start yet.** The connector change (plan step R4) and the server change (R2/R3) are not
> built. This guide has exactly two values left blank, `<R4_COMMIT>` and `<SCRIPT_SHA256>`. Claude
> fills them in only after both of these are true:
> 1. R1–R4 are merged and the owner-approved release is serving in production (checked with
>    `pnpm verify:live`).
> 2. A test post with the new rate keys was stored in production.
>
> Starting earlier loses rates. The connector only re-sends a load when something on it changes, so
> rates sent before production can store them are dropped and never re-sent (plan §1.3).

**Where:** the Board VM (`WIN-BU9IBG1NIHH`), over RDP, in an **Administrator** PowerShell.
To open one: Start → type `PowerShell` → right-click **Windows PowerShell** → **Run as administrator**.

**Pasting rule:** paste ONE line at a time and press Enter. A long pasted line that wraps can break
(seen on 2026-10-12).

**Time needed:** about 10 minutes for Part B, about 5 for Part C.

---

## The VM as read on 2026-11-20 (B1 and B2 done)

| Read on the VM | Value | Matches |
|---|---|---|
| Task state | `Running` | — |
| `agent.mjs` SHA-256 | `a5cf3c9a…de35c2` | commit `b86466537` (its manifest line) |
| `queries.mjs` SHA-256 | `405449e9…98437e` | commit `b86466537` |
| `update-connector.ps1` SHA-256 | `bda8be45…d526e` | the script as of `b86466537` |
| `ROSTER_MODE` | `create` | pass `-RosterMode create` |
| `FINANCE_FEED` / `LUMPER_FEED` | `off` / `on` | the update leaves both lines as they are |
| `C:\Silvicom\update-connector-before-rates.ps1` | copied (B2) | the rollback script for `b86466537` |
| Backup folders | `backup-A`, `backup-949f417`, `backup-b864665`, `backup-lumper-feed-20261117-171223` | — |

So **`<OLD_COMMIT>` = `b86466537547025df9aef158566ee1e4df70b3e7`**, `<OLD7>` = `b864665`, `<MODE>` = `create`.
`backup-b864665` exists, so a rollback MUST rename it first (D1). Without that, the old script refuses
to run.

**The update will also install one connector change already on main** that the VM does not run yet:
`0cf39defa` (merged after `b86466537`), which sweeps the ledger lines per posting key. It changes
`agent.mjs`, `ledger.mjs` and `queries.mjs`, but only inside the **finance** sweep, and the VM has
`FINANCE_FEED=off`, so that code does not run there. Claude re-checks this at R4 for anything else
merged by then.

## Part A — what Claude does first (you wait)

1. R1–R4 merged; the release approved by you and serving in production.
2. Claude confirms production stores rates (a test post), then sends you `<R4_COMMIT>` (40 characters)
   and `<SCRIPT_SHA256>` (64 characters), and both values are written into this file.

---

## Part B — install the update

### B1. Record how the VM is now (read-only, changes nothing)

Paste each line:

```powershell
Get-ScheduledTask -TaskName "Silvicom 360 connector" | Select-Object TaskName, State
```
```powershell
Get-ChildItem C:\Silvicom | Select-Object Name, LastWriteTime
```
```powershell
(Get-FileHash C:\Silvicom\connector\agent.mjs).Hash.ToLower()
```
```powershell
(Get-FileHash C:\Silvicom\connector\queries.mjs).Hash.ToLower()
```
```powershell
(Get-FileHash C:\Silvicom\update-connector.ps1).Hash.ToLower()
```
```powershell
Select-String -Path C:\Silvicom\connector\connector.env -Pattern '^ROSTER_MODE=','^LUMPER_FEED=','^FINANCE_FEED='
```

The last line prints only those three settings, never the password or the token.

**Send Claude the whole output.** From the two file fingerprints, Claude names the exact commit the VM
runs today (`<OLD_COMMIT>`). That is what a rollback returns to. Claude also tells you which
`ROSTER_MODE` value to pass in B4, which is the one already in the file, so the update changes nothing
there.

**Stop and tell Claude if:** the task's State is not `Running`; or a folder named
`backup-<first 7 characters of R4_COMMIT>` already exists (the script refuses to run then); or any line
shows an error.

### B2. Keep the current update script (for a rollback)

```powershell
Copy-Item C:\Silvicom\update-connector.ps1 C:\Silvicom\update-connector-before-rates.ps1
```

Expected: no output. If PowerShell says the file does not exist, stop and tell Claude.

### B3. Download the new update script and check its fingerprint

The script holds the list of files and their fingerprints for the new commit, so it must be the copy
from that same commit. Paste one line at a time:

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
```
```powershell
$c = "<R4_COMMIT>"
```
```powershell
$u = "https://raw.githubusercontent.com/miroslav-jokovic/fuel-guard/$c/tools/mcleod-agent/windows/update-connector.ps1"
```
```powershell
Invoke-WebRequest -Uri $u -OutFile C:\Silvicom\update-connector.ps1 -UseBasicParsing
```
```powershell
(Get-FileHash C:\Silvicom\update-connector.ps1).Hash.ToLower()
```

The last line must print exactly `<SCRIPT_SHA256>`.
**If it does not match: STOP.** Put the old script back and tell Claude:

```powershell
Copy-Item C:\Silvicom\update-connector-before-rates.ps1 C:\Silvicom\update-connector.ps1 -Force
```

### B4. Run the update

In the same window (it uses `$c` from B3). Replace `<MODE>` with the value Claude gave you in B1:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Silvicom\update-connector.ps1 -Commit $c -RosterMode <MODE>
```

It takes about 3 minutes (it waits 120 seconds after the restart on purpose). What the script does, in
order: downloads every connector file and checks each fingerprint while the connector is still
running → stops the connector → backs up the old files and `connector.env` into
`C:\Silvicom\backup-<7 chars>` → copies the new files → runs the connector's own tests → restarts →
reads the log of the first two minutes.

**Expected lines, in this order** (the numbers N are filled in at R4):

```
OK  N files downloaded from commit xxxxxxx, every checksum matches
Current ROSTER_MODE=<MODE>  ->  ROSTER_MODE=<MODE>
OK  connector stopped (task: …)
OK  backup in C:\Silvicom\backup-xxxxxxx (… files replaced, … new)
OK  code copied
OK  tests: N passed, 0 failed
OK  ROSTER_MODE already <MODE>
Started at hh:mm:ss UTC. Waiting 120 seconds...
Task: Running
  … service: started (pid …) …
SUCCESS: commit xxxxxxx running, …
```

**If you see `FAILED:`** (red): the script has already put every file and `connector.env` back as they
were and started the connector again. The VM is unchanged. Send Claude the full output. Nothing else
to do.

**If you see `PROBLEM after the restart`** (red): the new code is installed but its first minutes
logged a failure, for example `loads: cycle failed … SELECT permission was denied`. While it lasts the
board on Silvicom 360 stops updating, so **go straight to Part D (rollback)**, then send Claude the
output.

### B5. Check that the rate read works (read-only)

Wait 2 more minutes after SUCCESS, then:

```powershell
Get-Content C:\Silvicom\connector\connector.log -Tail 80 | Select-String 'loads:|mirror:|cycle failed'
```

Expected, for the latest minute:
- `loads: N on the board, N dispatcher(s)`
- `loads: N of M loaded movements carry a rate` (the new line from R4; counts only, never amounts)
- `mirror: stored {…}` with no `refused`
- **no** `cycle failed`

The first cycle after the update re-sends every open load once (each load's fingerprint now includes
the rate). That is expected.

Send Claude the output. Claude then checks production: the number of open loaded loads with a rate
must equal the number of open loaded loads.

---

## Part C — rates for loads already delivered (history)

Do this only after Claude confirms B5 in production. It reads delivered loads again, now with their
rates, from live LME, and stores them. A load already stored is rewritten in place: no duplicates, and
nothing about it changes except the rate. That rewrite is the same mechanism the 10-21 backfill used.

Why on the VM and not from the Mac as on 10-21: that run read the analytics copy, which stops at
10/09/2026, so it cannot supply rates for loads delivered after that. The VM reads live LME.

The connector is stopped during this so only one of our reads hits LME at a time (the same rule the
service keeps). The open board is not updated for those ~5 minutes.

### C1. Stop the connector and confirm it is gone

```powershell
Stop-ScheduledTask -TaskName "Silvicom 360 connector"
```
```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*agent.mjs*" } | Select-Object ProcessId
```

Expected: the second line prints **nothing**. If it prints a ProcessId, wait 10 seconds and run it
again. If it still prints one, start the connector again (C5) and tell Claude.

### C2. Go to the connector folder

```powershell
Set-Location C:\Silvicom\connector
```

### C3. One trial read, sending nothing

```powershell
& C:\Silvicom\node\node.exe --env-file=connector.env agent.mjs --loads-backfill --from=2026-03-15 --to=2026-04-01 --dry-run
```

Expected: a line starting `DRY RUN — backfill: delivered movements …`, then counts. No `FATAL`.
If you see `FATAL`, go to C5 (start the connector) and send Claude the output.

### C4. The real read, in two-week slices

The earliest delivery stored is 03/27/2026 (10-21 backfill log), so the slices start at 03/15. The
last one ends 12/01. A slice reaching into the future is harmless, because the window is on a stop's
actual departure. Paste one line at a time:

```powershell
$n = "C:\Silvicom\node\node.exe"
```
```powershell
$d = "2026-03-15","2026-04-01","2026-04-15","2026-05-01","2026-05-15","2026-06-01","2026-06-15","2026-07-01","2026-07-15"
```
```powershell
$d += "2026-08-01","2026-08-15","2026-09-01","2026-09-15","2026-10-01","2026-10-15","2026-11-01","2026-11-15","2026-12-01"
```
```powershell
for ($i = 0; $i -lt $d.Count - 1; $i++) { & $n --env-file=connector.env agent.mjs --loads-backfill "--from=$($d[$i])" "--to=$($d[$i+1])"; if ($LASTEXITCODE -ne 0) { Write-Host "STOPPED at $($d[$i])" -ForegroundColor Red; break } }
```

That is 17 slices. Each prints `backfill: stored {…}`. On 10-21, eleven slices took 2 min 17 s.
If one fails, the loop prints `STOPPED at <date>` and runs nothing more. A failed slice changes nothing
it did not store, and re-running a slice is safe. Go to C5 and send Claude the output.

### C5. Start the connector again (always, whatever happened)

```powershell
Start-ScheduledTask -TaskName "Silvicom 360 connector"
```
```powershell
Get-ScheduledTask -TaskName "Silvicom 360 connector" | Select-Object TaskName, State
```

Expected: `Running`. Then repeat B5's log check after 2 minutes.

---

## Part D — rollback (only if B4 said PROBLEM, or Claude asks)

This puts the VM back on `<OLD_COMMIT>` (named by Claude from B1) with the script that matches it.
The old connector works against the new production. The new rate fields are optional until plan
step R5, and R5 is not merged until the VM has run the new connector cleanly for a day.

### D1. Clear the way for the old script

The old script refuses to run if a backup folder for that commit already exists (left by the update
that installed it). Rename it rather than delete it:

```powershell
Get-ChildItem C:\Silvicom -Directory -Filter "backup-*" | Select-Object Name
```

If the list has `backup-<first 7 characters of OLD_COMMIT>`, rename it:

```powershell
Rename-Item C:\Silvicom\backup-<OLD7> C:\Silvicom\backup-<OLD7>-earlier
```

### D2. Run the old script with the old commit

Claude confirms first that `update-connector-before-rates.ps1` matches `<OLD_COMMIT>`. Its file list
must be the one generated for that commit. If it does not match, Claude gives you the right copy's
address and fingerprint, downloaded the same way as B3.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Silvicom\update-connector-before-rates.ps1 -Commit <OLD_COMMIT> -RosterMode <MODE>
```

Expected: the same `OK` lines as B4, ending in `SUCCESS`. The board updates again within a minute.

---

## Part E — clean-up (a day later, after normal logs)

The script's own advice is to delete the backup after a day of normal logs:

```powershell
Remove-Item -Recurse -Force C:\Silvicom\backup-<first 7 characters of R4_COMMIT>
```

Keep `update-connector-before-rates.ps1` until R5 is merged.

---

## What Claude checks on its side, step by step

| After | Claude checks |
|---|---|
| Part A | Production serves the release (`pnpm verify:live`); a test post with rate keys is stored |
| B1 | Names the VM's current commit and ROSTER_MODE from the fingerprints |
| B5 | Production: open loaded loads with a rate = open loaded loads; a dispatcher's board response carries no `charges` |
| C4 | Production: delivered loaded loads with a rate, by month, against the slices' counts |
| +1 day | Logs clean → R5 (rate fields required) may merge; the backup may be deleted |
