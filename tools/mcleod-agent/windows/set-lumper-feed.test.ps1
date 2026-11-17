# Rehearsal of set-lumper-feed.ps1 on a Mac or Linux PowerShell 7 (pwsh). NOT run by CI: there is no
# PowerShell on the runners, so this is run by hand before a change to the script reaches the VM:
#
#   pwsh -NoProfile -File tools/mcleod-agent/windows/set-lumper-feed.test.ps1
#   pwsh -NoProfile -File tools/mcleod-agent/windows/set-lumper-feed.test.ps1 -RealAgentDir <dir> -RealEnv <file>
#
# Each case builds a fake C:\Silvicom in a temp folder: connector.env, a fake agent.mjs whose dry run
# answers as the case says, a node.exe that runs the real node, and a local HTTP server standing in for
# 360. The Windows-only commands (scheduled task, process list, icacls, the admin check) are functions
# here, which PowerShell prefers over cmdlets and programs of the same name. Starting the "task" writes
# the log lines the real connector writes at start, so the script's watch runs as it would on the VM.
#
# -RealAgentDir / -RealEnv add one case with the REAL agent.mjs of a commit (a `git archive` of
# tools/mcleod-agent with node_modules beside it) and a real connector settings file: its dry run reads
# McLeod for real, and the case asserts the script acts on that answer and leaves the file as it was
# unless the read succeeded.
param([string]$RealAgentDir = "", [string]$RealEnv = "")

$ErrorActionPreference = "Stop"
$Script = Join-Path $PSScriptRoot "set-lumper-feed.ps1"
$RealNode = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$Utf8 = New-Object Text.UTF8Encoding($false)
$script:failures = 0

# ---- the stand-ins for Windows ----------------------------------------------------------------------
function global:Test-SilvicomAdmin { return $true }
function global:icacls { $global:LASTEXITCODE = 0 }
function global:Get-CimInstance { return @() }
function global:Get-ScheduledTask { param($TaskName, $ErrorAction) return [pscustomobject]@{ State = $global:TaskState } }
function global:Stop-ScheduledTask { param($TaskName) $global:Calls += "stop"; $global:TaskState = "Ready" }
function global:Start-ScheduledTask {
  param($TaskName)
  $global:Calls += "start"
  $global:TaskState = "Running"
  # What the connector logs when it starts, as agent.mjs writes it, from the settings it would read.
  $on = ([IO.File]::ReadAllText($global:EnvPath)) -match '(?m)^LUMPER_FEED=on\r?$'
  $t = (Get-Date).ToUniversalTime().AddSeconds(1).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $lines = @("[agent $t] service: started (pid 1); schedule loads every 1 min")
  if ($on) {
    $lines += "[agent $t] service: lumper ON (LUMPER_FEED=on) - Part 7 of the review file, once an hour"
    if ($global:SweepOutcome -eq "sent") { $lines += "[agent $t] lumper: sent orders=87 charges=90 payments=170 bills=109 (700 ms); 360 removed charges=0 payments=0 bills=0, opened cases=87" }
    if ($global:SweepOutcome -eq "failed") { $lines += "[agent $t] lumper: cycle failed (12 ms), will retry on schedule: 360 refused the payload" }
  } else {
    $lines += "[agent $t] service: lumper OFF - it is scheduled only when connector.env says LUMPER_FEED=on"
  }
  Add-Content -Path $global:LogPath -Value $lines
}

# ---- 360 stand-in: answers POST /api/tms/lumper with the case's status, anything else 404 -----------
$serverJs = @'
const http = require("http");
const status = Number(process.argv[2]);
const s = http.createServer((q, r) => {
  r.statusCode = q.url === "/api/tms/lumper" && q.method === "POST" && q.headers.authorization === "Bearer fgtms_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG" ? status : (q.url === "/api/tms/lumper" ? 401 : 404);
  r.end("{}");
});
s.listen(0, "127.0.0.1", () => console.log(s.address().port));
'@

function New-Case([string]$name, [string]$envText, [string]$dry, [int]$http, [string]$agentDir = "") {
  $root = Join-Path ([IO.Path]::GetTempPath()) ("lumper-feed-" + $name + "-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
  $app = Join-Path $root "connector"
  New-Item -ItemType Directory -Path (Join-Path $root "node") -Force | Out-Null
  $nodeExe = Join-Path (Join-Path $root "node") "node.exe"
  # "misread": a node whose read-back of the settings says off, so the check AFTER the write fails.
  $wrap = if ($dry -eq "misread") { "#!/bin/sh`nfor a in `"`$@`"; do [ `"`$a`" = `"-e`" ] && { printf off; exit 0; }; done`nexec `"$RealNode`" `"`$@`"`n" } else { "#!/bin/sh`nexec `"$RealNode`" `"`$@`"`n" }
  [IO.File]::WriteAllText($nodeExe, $wrap, $Utf8)
  & chmod +x $nodeExe
  if ($agentDir) {
    # The real connector: its own files, and its node_modules, as the VM holds them.
    New-Item -ItemType SymbolicLink -Path $app -Target $agentDir | Out-Null
  } else {
    New-Item -ItemType Directory -Path $app -Force | Out-Null
    $agentJs = @"
// fake agent: lumperFeedOn(process.env.LUMPER_FEED)
if (process.argv.includes("--lumper") && process.argv.includes("--dry-run")) {
  console.log(JSON.stringify({ orders: { rows: 87 } }, null, 2));
  if ("$dry" === "ok" || "$dry" === "misread") console.log("[agent x] lumper: read orders=87; this sweep would be sent");
  else { console.error("[agent] FATAL: The SELECT permission was denied on the object 'drs_deduct_hist'"); process.exit(1); }
}
"@
    if ($dry -ne "old") { [IO.File]::WriteAllText((Join-Path $app "agent.mjs"), $agentJs, $Utf8) }
    else { [IO.File]::WriteAllText((Join-Path $app "agent.mjs"), "// an agent from before the lumper feed`n", $Utf8) }
  }
  $srvFile = Join-Path $root "server.cjs"
  [IO.File]::WriteAllText($srvFile, $serverJs, $Utf8)
  $psi = New-Object Diagnostics.ProcessStartInfo($RealNode, "`"$srvFile`" $http")
  $psi.RedirectStandardOutput = $true
  $psi.UseShellExecute = $false
  $proc = [Diagnostics.Process]::Start($psi)
  $port = $proc.StandardOutput.ReadLine()
  $envPath = Join-Path $app "connector.env"
  [IO.File]::WriteAllBytes($envPath, $Utf8.GetBytes($envText.Replace("__URL__", "http://127.0.0.1:$port")))
  $logPath = Join-Path $app "connector.log"
  if (Test-Path $logPath) { Remove-Item $logPath }
  return @{ Root = $root; Env = $envPath; Log = $logPath; Server = $proc; Orig = [IO.File]::ReadAllBytes($envPath) }
}

function Run-Case([string]$name, [hashtable]$c, [string]$feed, [string]$sweep, [scriptblock]$check) {
  $global:EnvPath = $c.Env; $global:LogPath = $c.Log; $global:SweepOutcome = $sweep
  $global:TaskState = "Running"; $global:Calls = @()
  $code = $null; $thrown = $null
  $global:LASTEXITCODE = 0
  try {
    $out = @(& $Script -Feed $feed -Root $c.Root -WaitSeconds 8 6>&1 2>&1 | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
  } catch {
    $thrown = $_.Exception.Message
    $out = @()
  }
  $c.Server.Kill()
  $now = [IO.File]::ReadAllBytes($c.Env)
  try {
    & $check $code $thrown ($out -join "`n") $now
    Write-Host "PASS  $name" -ForegroundColor Green
  } catch {
    $script:failures += 1
    Write-Host "FAIL  $name : $($_.Exception.Message)" -ForegroundColor Red
    if ($thrown) { Write-Host "      thrown: $thrown" }
    $out | ForEach-Object { Write-Host "      $_" }
  } finally {
    # The real-agent case links `connector` to a real folder: remove the LINK, never what it points at.
    $app = Get-Item -Force (Join-Path $c.Root "connector")
    if ($app.LinkType) { $app.Delete() }
    Remove-Item -Recurse -Force $c.Root -ErrorAction SilentlyContinue
  }
}
function Assert([bool]$cond, [string]$msg) { if (-not $cond) { throw $msg } }
function Same([byte[]]$a, [byte[]]$b) { return [Convert]::ToBase64String($a) -ceq [Convert]::ToBase64String($b) }
function Text([byte[]]$b) { return $Utf8.GetString($b) }
function Calls { return ($global:Calls -join ",") }

$tok = "FUELGUARD_INGEST_TOKEN=`"fgtms_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG`""
$lf = "MCLEOD_SQL_SERVER=10.0.1.171`nMCLEOD_SQL_DATABASE=lme`nMCLEOD_COMPANY_ID=TMS`nFUELGUARD_INGEST_URL=__URL__`n$tok`nROSTER_MODE=create`nFINANCE_FEED=off`n"
$crlfNoFinal = ($lf.TrimEnd("`n") -replace "`n", "`r`n")

# 1. The VM today: no LUMPER_FEED line, LF endings with a final newline. On, and the sweep is sent.
$c = New-Case "add-lf" $lf "ok" 400
Run-Case "on: no line yet -> one line added before the final newline; sweep sent; SUCCESS" $c "on" "sent" {
  param($code, $thrown, $out, $now)
  Assert ($null -eq $thrown) "threw: $thrown"
  Assert ($code -eq 0) "exit $code"
  $want = (Text $c.Orig) + "LUMPER_FEED=on`n"
  Assert ((Text $now) -ceq $want) "file is not the original plus one line: [$(Text $now)]"
  Assert ((Calls) -eq "stop,start") "task calls: $(Calls)"
  Assert ($out -match "SUCCESS: LUMPER_FEED=on") "no SUCCESS line"
  Assert ($out -match "this sweep would be sent") "dry run output not shown"
  Assert ($out -notmatch "fgtms_[A-Za-z0-9]") "a token was printed"
  Assert ($out -match "FINANCE_FEED=off") "FINANCE_FEED not reported"
}

# 2. CRLF endings and no final newline: the line goes at the end, with CRLF, nothing else moves.
$c = New-Case "add-crlf" $crlfNoFinal "ok" 400
Run-Case "on: CRLF file without a final newline -> appended with CRLF" $c "on" "sent" {
  param($code, $thrown, $out, $now)
  Assert ($code -eq 0) "exit $code / $thrown"
  Assert ((Text $now) -ceq ((Text $c.Orig) + "`r`nLUMPER_FEED=on")) "unexpected bytes: [$(Text $now)]"
  Assert ($now[0] -ne 0xEF) "BOM written"
}

# 3. An existing off line is changed in place.
$c = New-Case "change" ($lf + "LUMPER_FEED=off`n") "ok" 400
Run-Case "on: an existing LUMPER_FEED=off line is changed in place" $c "on" "sent" {
  param($code, $thrown, $out, $now)
  Assert ($code -eq 0) "exit $code / $thrown"
  Assert ((Text $now) -ceq (Text $c.Orig).Replace("LUMPER_FEED=off", "LUMPER_FEED=on")) "unexpected bytes: [$(Text $now)]"
  Assert ((Text $now).Length -eq (Text $c.Orig).Length - 1) "length is not the original's less one character"
}

# 4. The dry run fails (LME still refuses a table): nothing written, connector restarted.
$c = New-Case "dryfail" $lf "denied" 400
Run-Case "on: dry run refused by McLeod -> file untouched, connector started again, exit 1" $c "on" "sent" {
  param($code, $thrown, $out, $now)
  Assert ($code -eq 1) "exit $code / $thrown"
  Assert (Same $now $c.Orig) "file changed"
  Assert ((Calls) -eq "stop,start") "task calls: $(Calls)"
  Assert ($out -match "SELECT permission was denied") "McLeod's refusal not shown"
}

# 5. The first sweep fails after the start: the switch is put back.
$c = New-Case "sweepfail" $lf "ok" 400
Run-Case "on: first sweep fails after start -> file put back byte for byte, restarted, exit 1" $c "on" "failed" {
  param($code, $thrown, $out, $now)
  Assert ($code -eq 1) "exit $code / $thrown"
  Assert (Same $now $c.Orig) "file not restored"
  Assert ((Calls) -eq "stop,start,stop,start") "task calls: $(Calls)"
  Assert ($out -match "the lumper sweep failed") "reason not said"
}

# 6. No lumper line within the wait: also put back.
$c = New-Case "silent" $lf "ok" 400
Run-Case "on: no lumper line within the wait -> put back, exit 1" $c "on" "none" {
  param($code, $thrown, $out, $now)
  Assert ($code -eq 1) "exit $code / $thrown"
  Assert (Same $now $c.Orig) "file not restored"
}

# 6b. The file is written but Node reads it back wrong: the check after the write fails, and the catch
#     must put the original back before restarting.
$c = New-Case "misread" $lf "misread" 400
Run-Case "on: Node reads the switch back wrong -> file put back byte for byte, restarted, exit 1" $c "on" "sent" {
  param($code, $thrown, $out, $now)
  Assert ($code -eq 1) "exit $code / $thrown"
  Assert (Same $now $c.Orig) "file not restored"
  Assert ((Calls) -eq "stop,start") "task calls: $(Calls)"
  Assert ($out -match "Node reads LUMPER_FEED as 'off'") "reason not said"
}

# 7. Production without the route: nothing stopped, nothing written.
$c = New-Case "noroute" $lf "ok" 404
Run-Case "on: 360 has no lumper route (404) -> refused before anything is stopped" $c "on" "sent" {
  param($code, $thrown, $out, $now)
  Assert ($thrown -match "has no /api/tms/lumper") "not refused for the route: $thrown"
  Assert ((Calls) -eq "") "task touched: $(Calls)"
  Assert (Same $now $c.Orig) "file changed"
}

# 8. An agent from before the feed: refused before anything is stopped.
$c = New-Case "oldagent" $lf "old" 400
Run-Case "on: installed agent predates the feed -> refused, nothing touched" $c "on" "sent" {
  param($code, $thrown, $out, $now)
  Assert ($thrown -match "does not know the lumper feed") "not refused: $thrown"
  Assert ((Calls) -eq "") "task touched"
}

# 9. Two LUMPER_FEED lines: refused.
$c = New-Case "dup" ($lf + "LUMPER_FEED=off`nLUMPER_FEED=on`n") "ok" 400
Run-Case "on: two LUMPER_FEED lines -> refused, nothing touched" $c "on" "sent" {
  param($code, $thrown, $out, $now)
  Assert ($thrown -match "appears 2 times") "not refused: $thrown"
  Assert ((Calls) -eq "") "task touched"
}

# 10. Not the live database: refused.
$c = New-Case "notlme" ($lf -replace "DATABASE=lme", "DATABASE=lme_analytics") "ok" 400
Run-Case "on: MCLEOD_SQL_DATABASE is not lme -> refused, nothing touched" $c "on" "sent" {
  param($code, $thrown, $out, $now)
  Assert ($thrown -match "not 'lme'") "not refused: $thrown"
  Assert ((Calls) -eq "") "task touched"
}

# 11. Already on: nothing at all.
$c = New-Case "already" ($lf + "LUMPER_FEED=on`n") "ok" 400
Run-Case "on: already on -> nothing touched, exit 0" $c "on" "sent" {
  param($code, $thrown, $out, $now)
  Assert ($code -eq 0) "exit $code / $thrown"
  Assert ((Calls) -eq "") "task touched"
  Assert (Same $now $c.Orig) "file changed"
}

# 12. Off: the line changes, the log says OFF.
$c = New-Case "off" ($lf + "LUMPER_FEED=on`n") "ok" 400
Run-Case "off: LUMPER_FEED=on -> off in place, service says lumper OFF, exit 0" $c "off" "none" {
  param($code, $thrown, $out, $now)
  Assert ($code -eq 0) "exit $code / $thrown"
  Assert ((Text $now) -ceq ((Text $c.Orig) -replace "LUMPER_FEED=on", "LUMPER_FEED=off")) "unexpected bytes"
  Assert ((Calls) -eq "stop,start") "task calls: $(Calls)"
}

# 13. Off with no line: nothing to do.
$c = New-Case "offnone" $lf "ok" 400
Run-Case "off: no line -> already off, nothing touched" $c "off" "none" {
  param($code, $thrown, $out, $now)
  Assert ($code -eq 0) "exit $code / $thrown"
  Assert ((Calls) -eq "") "task touched"
}

# 14. The real agent of a commit, reading McLeod for real (counts only).
if ($RealAgentDir -and $RealEnv) {
  $real = [IO.File]::ReadAllText($RealEnv)
  # The probe goes to the local stand-in, never to production, and the settings are the real ones.
  $real = ($real -split "\r?\n" | Where-Object { $_ -notlike "FUELGUARD_INGEST_URL=*" -and $_ -notlike "FUELGUARD_INGEST_TOKEN=*" -and $_ -notlike "LUMPER_FEED=*" }) -join "`n"
  $real = $real.TrimEnd("`n") + "`nFUELGUARD_INGEST_URL=__URL__`n$tok`n"
  $envCopy = Join-Path $RealAgentDir "connector.env"
  $c = New-Case "real" $real "" 400 $RealAgentDir
  $realLog = Join-Path $RealAgentDir "connector.log"
  Run-Case "on, REAL agent against McLeod: success only if the read is sendable, else file untouched" $c "on" "sent" {
    param($code, $thrown, $out, $now)
    $sendable = $out -match "OK  dry run: the sweep would be sent"
    if ($sendable) { Assert ($code -eq 0) "read was sendable but exit $code" }
    else {
      Assert ($code -eq 1) "read not sendable but exit $code / $thrown"
      Assert (Same $now $c.Orig) "file changed after a failed read"
      Assert ((Calls) -eq "stop,start") "task calls: $(Calls)"
    }
    Write-Host ($out -split "`n" | Where-Object { $_ -match "dry run|lumper|FATAL|denied|FAILED" } | Select-Object -First 12 | Out-String)
  }
  Remove-Item -Force $envCopy, $realLog -ErrorAction SilentlyContinue
}

if ($script:failures -gt 0) { Write-Host "$($script:failures) case(s) FAILED" -ForegroundColor Red; exit 1 }
Write-Host "every case passed" -ForegroundColor Green
