# Silvicom 360 connector - switch the lumper read on or off, safely (LUMPER-REVISED-RC-PLAN LRC1).
#
# In an Administrator PowerShell on the Board VM:
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Silvicom\set-lumper-feed.ps1 -Feed on
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Silvicom\set-lumper-feed.ps1 -Feed off
#
# Why its own script and not set-connector-line.ps1: that one changes an EXISTING line and refuses any
# change to the line count, and the VM's connector.env has no LUMPER_FEED line at all (a missing line
# means off, schedule.mjs). Switching the feed on also needs three things that script does not do: the
# installed code must know the feed, 360 must have the route, and the read must run cleanly on LME with
# the connector stopped BEFORE the switch is written.
#
# What -Feed on guarantees, in this order:
#   1. Nothing is stopped until these pass: the installed agent knows LUMPER_FEED; connector.env has at
#      most one LUMPER_FEED line and no BOM; 360 answers POST /api/tms/lumper with 400 for an empty body
#      (the route exists and accepts this token; nothing is written).
#   2. The connector is stopped and confirmed gone, and connector.env is backed up.
#   3. The dry run (agent.mjs --lumper --dry-run) reads LME once, with the connector stopped so the server
#      never sees two of our statements at once, and must say "this sweep would be sent". It prints counts
#      and dollars only, never a row.
#   4. Exactly one line changes or is added (LUMPER_FEED=on); every other line, the line endings and the
#      ACL stay; UTF-8 without a BOM; and Node itself reads the file back as LUMPER_FEED=on.
#   5. The connector starts, and the script waits up to 6 minutes for the first lumper sweep in the log.
#      "lumper: sent" is success. A failed sweep puts connector.env back as it was and restarts the
#      connector, so the VM is never left with a switch that fails every hour.
# Any failure before the edit restarts the connector unchanged. Secrets are never printed (tokens masked).
# -Feed off: stop, write LUMPER_FEED=off, check, start, confirm "service: lumper OFF" in the log.
# ASCII only on purpose: PowerShell 5.1 reads a BOM-less script as ANSI.
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("on", "off")]
  [string]$Feed,
  # The Silvicom folder. Only the Mac rehearsal (set-lumper-feed.test.ps1) passes another one.
  [string]$Root = "C:\Silvicom",
  # Seconds to wait for the first lumper sweep after the start. The rehearsal passes a few.
  [int]$WaitSeconds = 360
)

$ErrorActionPreference = "Stop"
$Task   = "Silvicom 360 connector"
$App    = Join-Path $Root "connector"
$Node   = Join-Path $Root (Join-Path "node" "node.exe")
$EnvF   = Join-Path $App "connector.env"
$Log    = Join-Path $App "connector.log"
$Stamp  = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
$Backup = Join-Path $Root ("backup-lumper-feed-" + $Stamp)
$Utf8   = New-Object Text.UTF8Encoding($false)
$Key    = "LUMPER_FEED"
$Want   = "$Key=$Feed"

function Lock-File([string]$p) {
  & icacls $p /inheritance:r /grant:r "*S-1-5-18:R" "*S-1-5-32-544:F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "icacls failed on $p" }
}
function Mask([string]$l) { return ($l -replace 'fgtms_[A-Za-z0-9_\-]+', 'fgtms_***') }
function Agent-Pids {
  return @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*agent.mjs*" } | ForEach-Object { $_.ProcessId })
}
# The rehearsal on the Mac defines its own; on the VM this is the real check.
if (-not (Get-Command Test-SilvicomAdmin -ErrorAction SilentlyContinue)) {
  function Test-SilvicomAdmin {
    $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  }
}
# A native program's stderr must not end the script under "Stop" (Windows PowerShell 5.1 turns each
# stderr line into an error when it is captured). Output and exit code are returned; the caller decides.
function Run-Node([string[]]$argv) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  Push-Location $App
  try {
    $out = & $Node @argv 2>&1 | ForEach-Object { Mask "$_" }
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
    $ErrorActionPreference = $prev
  }
  return @{ Out = @($out); Code = $code }
}
function Value-Of([string[]]$ls, [string]$k) {
  $v = @($ls | Where-Object { $_ -like "$k=*" })
  if ($v.Count -eq 0) { return $null }
  return (($v[0] -split '=', 2)[1]).Trim().Trim('"')
}
# The ingest API checks the token BEFORE it reads the body (routes/tmsIngest.ts): an empty body answers
# 400 for a good token on a route that exists, 401 for a bad token, 404 when the route is not there.
function Probe([string]$origin, [string]$tok) {
  try {
    Invoke-WebRequest -Uri "$origin/api/tms/lumper" -Method Post -ContentType "application/json" -Body "{}" `
      -Headers @{ Authorization = "Bearer $tok" } -UseBasicParsing -TimeoutSec 20 -MaximumRedirection 0 | Out-Null
    return 200
  } catch {
    $r = $_.Exception.Response
    if ($r) { return [int]$r.StatusCode }
    throw "No answer from $origin ($($_.Exception.Message))"
  }
}
function Fresh-Log([datetime]$since) {
  if (-not (Test-Path $Log)) { return @() }
  return @(Get-Content $Log -Tail 400 | Where-Object {
    $_ -match '^\[agent (\S+)\]' -and ([datetime]::Parse($matches[1])).ToUniversalTime() -ge $since
  } | ForEach-Object { Mask $_ })
}

# ---- 0. checks: nothing is stopped or written here ------------------------------------------------
if (-not (Test-SilvicomAdmin)) { throw "Run this in an Administrator PowerShell." }
if (-not (Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue)) { throw "Task '$Task' not found. Nothing changed." }
if (-not (Test-Path $Node)) { throw "$Node not found. Nothing changed." }
if (-not (Test-Path $EnvF)) { throw "$EnvF not found. Nothing changed." }
$agent = Join-Path $App "agent.mjs"
if (-not (Select-String -Path $agent -SimpleMatch "lumperFeedOn(process.env.LUMPER_FEED)" -Quiet)) {
  throw "The installed connector does not know the lumper feed. Run update-connector.ps1 first. Nothing changed."
}

$orig = [IO.File]::ReadAllBytes($EnvF)
if ($orig.Length -ge 3 -and $orig[0] -eq 0xEF -and $orig[1] -eq 0xBB -and $orig[2] -eq 0xBF) { throw "connector.env starts with a BOM. Stop and tell Claude. Nothing changed." }
$text  = $Utf8.GetString($orig)
$nl    = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
$lines = [Collections.Generic.List[string]]($text -split "\r?\n")
$hits  = @(for ($k = 0; $k -lt $lines.Count; $k++) { if ($lines[$k] -like "$Key=*") { $k } })
if ($hits.Count -gt 1) { throw "$Key appears $($hits.Count) times in connector.env (expected 0 or 1). Nothing changed." }
$current = if ($hits.Count -eq 1) { $lines[$hits[0]] } else { "(no $Key line: the feed is off)" }
# What else this file switches, by value: none of these is a secret.
$db      = Value-Of $lines "MCLEOD_SQL_DATABASE"
$finance = Value-Of $lines "FINANCE_FEED"
$roster  = Value-Of $lines "ROSTER_MODE"
Write-Host "connector.env now: $current"
Write-Host "  MCLEOD_SQL_DATABASE=$db  ROSTER_MODE=$roster  FINANCE_FEED=$(if ($null -eq $finance) { '(no line: ON)' } else { $finance })"
if ($hits.Count -eq 1 -and $lines[$hits[0]] -eq $Want) { Write-Host "Already $Want. Nothing changed." -ForegroundColor Green; exit 0 }
if ($Feed -eq "off" -and $hits.Count -eq 0) { Write-Host "No $Key line, so the feed is already off. Nothing changed." -ForegroundColor Green; exit 0 }

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ($Feed -eq "on") {
  if ($db -ne "lme") { throw "MCLEOD_SQL_DATABASE is '$db', not 'lme'. The lumper read is for the live database only. Nothing changed." }
  $origin = (Value-Of $lines "FUELGUARD_INGEST_URL")
  if (-not $origin) { throw "FUELGUARD_INGEST_URL is missing. Nothing changed." }
  $origin = $origin.TrimEnd('/')
  $tok = Value-Of $lines "FUELGUARD_INGEST_TOKEN"
  $code = Probe $origin $tok
  $tok = $null
  if ($code -eq 404) { throw "$origin has no /api/tms/lumper (HTTP 404): the release that carries it is not live there. Nothing changed." }
  if ($code -ne 400) { throw "$origin answered HTTP $code to the lumper probe (expected 400). Nothing changed." }
  Write-Host "OK  $origin has the lumper route and accepts this token (probe answered 400, nothing written)"
}

$stopped = $false
$edited  = $false
try {
  # ---- 1. stop, and make sure no connector process is left ------------------------------------------
  Stop-ScheduledTask -TaskName $Task
  $stopped = $true
  Start-Sleep -Seconds 5
  $left = Agent-Pids
  if ($left.Count -gt 0) { throw "A connector process is still running (PID $($left -join ', '))." }
  Write-Host "OK  connector stopped (task: $((Get-ScheduledTask -TaskName $Task).State))"

  # ---- 2. backup, folder locked BEFORE the copy so the copy never has wider rights -------------------
  New-Item -ItemType Directory -Path $Backup | Out-Null
  & icacls $Backup /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)R" "*S-1-5-32-544:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "icacls failed on $Backup" }
  [IO.File]::WriteAllBytes((Join-Path $Backup "connector.env.bak"), $orig)
  Lock-File (Join-Path $Backup "connector.env.bak")
  Write-Host "OK  backup in $Backup"

  # ---- 3. the dry run on LME, with the connector stopped -------------------------------------------
  if ($Feed -eq "on") {
    Write-Host "Dry run: reading the lumper facts from LME once (counts only)..."
    $dry = Run-Node @("--env-file=connector.env", "agent.mjs", "--lumper", "--dry-run")
    $dry.Out | Select-Object -Last 40 | ForEach-Object { Write-Host "  $_" }
    if ($dry.Code -ne 0) { throw "The dry run failed (exit $($dry.Code)). See the lines above." }
    if (-not ($dry.Out | Where-Object { $_ -match 'this sweep would be sent' })) { throw "The dry run did not say 'this sweep would be sent'." }
    Write-Host "OK  dry run: the sweep would be sent"
  }

  # ---- 4. write in place (keeps the ACL), UTF-8 without BOM, same line endings ---------------------
  $added = $false
  if ($hits.Count -eq 1) {
    $lines[$hits[0]] = $Want
  } else {
    # Appended as the last line, before the file's final newline if it has one.
    $at = if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq "") { $lines.Count - 1 } else { $lines.Count }
    $lines.Insert($at, $Want)
    $added = $true
  }
  [IO.File]::WriteAllText($EnvF, ($lines -join $nl), $Utf8)
  $edited = $true
  Lock-File $EnvF

  # ---- 5. verify: no BOM, one line changed or added, every other line as it was ----------------------
  $now = [IO.File]::ReadAllBytes($EnvF)
  if ($now.Length -ge 3 -and $now[0] -eq 0xEF -and $now[1] -eq 0xBB -and $now[2] -eq 0xBF) { throw "BOM found after the write." }
  $a = @($Utf8.GetString($orig) -split "\r?\n")
  $n = @($Utf8.GetString($now) -split "\r?\n")
  $expect = if ($added) { $a.Count + 1 } else { $a.Count }
  if ($n.Count -ne $expect) { throw "Line count is $($n.Count), expected $expect." }
  $others = @($n | Where-Object { $_ -notlike "$Key=*" })
  $before = @($a | Where-Object { $_ -notlike "$Key=*" })
  if ($others.Count -ne $before.Count) { throw "Another line changed." }
  for ($k = 0; $k -lt $others.Count; $k++) { if ($others[$k] -cne $before[$k]) { throw "Line $($k + 1) other than $Key changed." } }
  $mine = @($n | Where-Object { $_ -like "$Key=*" })
  if ($mine.Count -ne 1 -or $mine[0] -cne $Want) { throw "$Key is not exactly '$Want' after the write." }
  $a = $null; $n = $null; $others = $null; $before = $null; [GC]::Collect()
  # Node reads the file the way the connector will.
  $read = Run-Node @("--env-file=connector.env", "-e", "process.stdout.write(String(process.env.LUMPER_FEED))")
  if ($read.Code -ne 0 -or (($read.Out -join "").Trim()) -cne $Feed) { throw "Node reads LUMPER_FEED as '$(($read.Out -join '').Trim())', not '$Feed'." }
  Write-Host "OK  connector.env: $(if ($added) { 'one line added' } else { 'one line changed' }) ($Want), no BOM, Node reads it, ACL re-applied"
}
catch {
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  if ($edited) {
    [IO.File]::WriteAllBytes($EnvF, $orig)
    Lock-File $EnvF
    Write-Host "connector.env put back exactly as it was." -ForegroundColor Yellow
  }
  if ($stopped) {
    Start-ScheduledTask -TaskName $Task
    Write-Host "Connector started again, unchanged. Report this output to Claude." -ForegroundColor Yellow
  }
  exit 1
}

# ---- 6. start, and watch the log for what the switch was for ---------------------------------------
$startUtc = (Get-Date).ToUniversalTime()
Start-ScheduledTask -TaskName $Task
Write-Host "Started at $($startUtc.ToString('HH:mm:ss')) UTC. Waiting up to $WaitSeconds seconds for the lumper line..."
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$verdict = $null
do {
  Start-Sleep -Seconds 5
  $fresh = Fresh-Log $startUtc
  if ($Feed -eq "off") {
    if ($fresh | Where-Object { $_ -match 'service: lumper OFF' }) { $verdict = "ok" }
  } else {
    if ($fresh | Where-Object { $_ -match 'lumper: sent ' -and $_ -notmatch 'did not apply' }) { $verdict = "ok" }
    elseif ($fresh | Where-Object { $_ -match 'lumper: cycle failed|lumper sweep not sent|did not apply' }) { $verdict = "failed" }
  }
  if ($fresh | Where-Object { $_ -match 'FATAL|\(401\)|rejected the ingest token' }) { $verdict = "failed" }
} while (-not $verdict -and (Get-Date) -lt $deadline)

$fresh | Where-Object { $_ -match 'service: |lumper' } | Select-Object -Last 15 | ForEach-Object { Write-Host "  $_" }
$state = (Get-ScheduledTask -TaskName $Task).State
Write-Host "Task: $state"

if ($verdict -eq "ok" -and $state -eq "Running") {
  Write-Host "SUCCESS: $Want, the connector is running$(if ($Feed -eq 'on') { ' and the first lumper sweep reached Silvicom 360' }). Backup kept in $Backup." -ForegroundColor Green
  exit 0
}

# Not proven: put the switch back as it was, so the VM does not keep a feed that fails every hour.
Write-Host "PROBLEM: $(if ($verdict -eq 'failed') { 'the lumper sweep failed (lines above)' } elseif ($state -ne 'Running') { "the task is $state" } else { "no lumper line within $WaitSeconds seconds" }). Putting connector.env back..." -ForegroundColor Red
Stop-ScheduledTask -TaskName $Task
Start-Sleep -Seconds 5
[IO.File]::WriteAllBytes($EnvF, $orig)
Lock-File $EnvF
Start-ScheduledTask -TaskName $Task
Write-Host "connector.env put back exactly as it was and the connector started again. Backup kept in $Backup. Report this output to Claude." -ForegroundColor Yellow
exit 1
