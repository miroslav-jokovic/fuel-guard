# Silvicom 360 connector - change ONE line of C:\Silvicom\connector\connector.env, safely.
#
#   -Change Url    FUELGUARD_INGEST_URL   -> https://api.360.silvicominc.com  (no secret; Codex may run it)
#   -Change Token  FUELGUARD_INGEST_TOKEN -> a new token typed at a hidden prompt (a PERSON runs it)
#
# In an Administrator PowerShell:
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Silvicom\set-connector-line.ps1 -Change Url
#
# What it guarantees: the connector is stopped before the edit; exactly one line changes; every other
# line, the line endings and the file's ACL stay as they were; the file is written as UTF-8 without a
# BOM (PowerShell 5.1's Set-Content adds one and Node's --env-file then misreads line 1); a secret is
# never printed; any failure before the edit restarts the connector unchanged; a failed check after the
# edit puts the original file back. ASCII only on purpose: PowerShell 5.1 reads a BOM-less script as ANSI.
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Url", "Token")]
  [string]$Change
)

$ErrorActionPreference = "Stop"
$Task   = "Silvicom 360 connector"
$App    = "C:\Silvicom\connector"
$EnvF   = Join-Path $App "connector.env"
$Log    = Join-Path $App "connector.log"
$Backup = "C:\Silvicom\backup-" + $Change.ToLower()
$NewUrl = "https://api.360.silvicominc.com"
$Utf8   = New-Object Text.UTF8Encoding($false)
$Key    = if ($Change -eq "Url") { "FUELGUARD_INGEST_URL" } else { "FUELGUARD_INGEST_TOKEN" }

function Lock-File([string]$p) {
  & icacls $p /inheritance:r /grant:r "*S-1-5-18:R" "*S-1-5-32-544:F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "icacls failed on $p" }
}
function Mask([string]$l) { return ($l -replace 'fgtms_[A-Za-z0-9_\-]+', 'fgtms_***') }
# The ingest API checks the token BEFORE it reads the body (routes/tmsIngest.ts), so an empty body
# answers 400 "invalid_payload" for a good token and 401 for a bad one - and writes nothing either way.
function Probe([string]$origin, [string]$tok) {
  try {
    Invoke-WebRequest -Uri "$origin/api/tms/dispatch-movements" -Method Post -ContentType "application/json" -Body "{}" `
      -Headers @{ Authorization = "Bearer $tok" } -UseBasicParsing -TimeoutSec 20 -MaximumRedirection 0 | Out-Null
    return 200
  } catch {
    $r = $_.Exception.Response
    if ($r) { return [int]$r.StatusCode }
    throw "No answer from $origin ($($_.Exception.Message))"
  }
}
function Url-From([string[]]$ls) {
  $u = @($ls | Where-Object { $_ -like "FUELGUARD_INGEST_URL=*" })
  if ($u.Count -ne 1) { throw "FUELGUARD_INGEST_URL appears $($u.Count) times (expected 1). Nothing changed." }
  return (($u[0] -split '=', 2)[1]).Trim().Trim('"').TrimEnd('/')
}
function Agent-Pids {
  return @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*agent.mjs*" } | ForEach-Object { $_.ProcessId })
}

$p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Run this in an Administrator PowerShell." }
if (-not (Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue)) { throw "Task '$Task' not found. Nothing changed." }
if (Test-Path $Backup) { throw "$Backup already exists from an earlier run. Stop and tell Claude. Nothing changed." }

# ---- read and check the file as it is ------------------------------------------------------------
$orig = [IO.File]::ReadAllBytes($EnvF)
if ($orig.Length -ge 3 -and $orig[0] -eq 0xEF -and $orig[1] -eq 0xBB -and $orig[2] -eq 0xBF) { throw "connector.env already starts with a BOM. Stop and tell Claude. Nothing changed." }
$text  = $Utf8.GetString($orig)
$nl    = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
$lines = $text -split "\r?\n"
$hits  = @(for ($k = 0; $k -lt $lines.Count; $k++) { if ($lines[$k] -like "$Key=*") { $k } })
if ($hits.Count -ne 1) { throw "$Key appears $($hits.Count) times in connector.env (expected 1). Nothing changed." }
Write-Host ("Keys in connector.env: " + (($lines | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { ($_ -split '=', 2)[0] }) -join ", "))
if ($Change -eq "Url") {
  Write-Host "Current $($lines[$hits[0]])"
  if ($lines[$hits[0]] -eq "FUELGUARD_INGEST_URL=$NewUrl") { Write-Host "Already set. Nothing changed."; exit 0 }
}

# ---- the new address must answer before anything is stopped ---------------------------------------
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ($Change -eq "Url") {
  $v = Invoke-RestMethod -Uri "$NewUrl/api/version" -TimeoutSec 20 -UseBasicParsing
  if ($v.env -ne "production" -or -not $v.commit) { throw "$NewUrl/api/version did not answer as production. Nothing changed." }
  Write-Host "OK  $NewUrl answers: production, commit $($v.commitShort)"
  # The token in the file, against the NEW address, before anything is stopped.
  $cur = (($lines | Where-Object { $_ -like "FUELGUARD_INGEST_TOKEN=*" } | Select-Object -First 1) -split '=', 2)[1].Trim().Trim('"')
  $code = Probe $NewUrl $cur
  $cur = $null
  if ($code -ne 400) { throw "$NewUrl did not accept the current token (HTTP $code, expected 400). Nothing changed." }
  Write-Host "OK  $NewUrl accepts the current token (probe answered 400, nothing written)"
}

$edited = $false
try {
  # ---- stop, and make sure no connector process is left ---------------------------------------------
  Stop-ScheduledTask -TaskName $Task
  Start-Sleep -Seconds 5
  $left = Agent-Pids
  if ($left.Count -gt 0) { throw "A connector process is still running (PID $($left -join ', '))." }
  Write-Host "OK  connector stopped (task: $((Get-ScheduledTask -TaskName $Task).State))"

  # ---- backup, folder locked BEFORE the copy so the copy never has wider rights ---------------------
  New-Item -ItemType Directory -Path $Backup | Out-Null
  & icacls $Backup /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)R" "*S-1-5-32-544:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "icacls failed on $Backup" }
  [IO.File]::WriteAllBytes((Join-Path $Backup "connector.env.bak"), $orig)
  Lock-File (Join-Path $Backup "connector.env.bak")
  Write-Host "OK  backup in $Backup"

  # ---- the new value ----------------------------------------------------------------------------
  if ($Change -eq "Url") {
    $newLine = "FUELGUARD_INGEST_URL=$NewUrl"
  } else {
    Write-Host ""
    Write-Host "Connector is STOPPED. Now, on the Mac, run the issue script; it copies the new token." -ForegroundColor Cyan
    Write-Host "Then paste it here (nothing shows while you paste) and press Enter." -ForegroundColor Cyan
    $origin = Url-From $lines
    $tok = $null
    for ($try = 1; $try -le 3 -and -not $tok; $try++) {
      $s = Read-Host "Paste token" -AsSecureString
      $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
      try { $t = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
      if (-not ($t -cmatch '^fgtms_[A-Za-z0-9_\-]{43}$')) {
        Write-Host "Not a token (length $($t.Length); a token is 49 characters starting fgtms_). Try again." -ForegroundColor Yellow
      } else {
        $code = Probe $origin $t
        if ($code -eq 400) { $tok = $t } else { Write-Host "$origin refused that token (HTTP $code). Paste the NEWEST one again." -ForegroundColor Yellow }
      }
      $t = $null; $s = $null
    }
    if (-not $tok) { throw "No accepted token after 3 tries." }
    Write-Host "OK  $origin accepts the new token (probe answered 400, nothing written; length $($tok.Length))"
    $newLine = 'FUELGUARD_INGEST_TOKEN="' + $tok + '"'
    $tok = $null
  }

  # ---- write in place (keeps the file's ACL), UTF-8 without BOM, same line endings ----------------
  $lines[$hits[0]] = $newLine
  $newLine = $null
  [IO.File]::WriteAllText($EnvF, ($lines -join $nl), $Utf8)
  $edited = $true
  $lines = $null; [GC]::Collect()
  Lock-File $EnvF

  # ---- verify: no BOM, same line count, exactly the one key changed ---------------------------------
  $now = [IO.File]::ReadAllBytes($EnvF)
  if ($now.Length -ge 3 -and $now[0] -eq 0xEF -and $now[1] -eq 0xBB -and $now[2] -eq 0xBF) { throw "BOM found after the write." }
  $a = $Utf8.GetString($orig) -split "\r?\n"
  $n = $Utf8.GetString($now) -split "\r?\n"
  if ($a.Count -ne $n.Count) { throw "Line count changed ($($a.Count) -> $($n.Count))." }
  $diff = @(for ($k = 0; $k -lt $a.Count; $k++) { if ($a[$k] -cne $n[$k]) { ($n[$k] -split '=', 2)[0] } })
  $count = $n.Count
  $a = $null; $n = $null; [GC]::Collect()
  if ($diff.Count -ne 1 -or $diff[0] -ne $Key) { throw "Unexpected change: $($diff.Count) line(s) differ ($($diff -join ', '))." }
  Write-Host "OK  exactly 1 line changed ($Key), no BOM, $count lines, ACL re-applied"
}
catch {
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  if ($edited) {
    [IO.File]::WriteAllBytes($EnvF, $orig)
    Lock-File $EnvF
    Write-Host "connector.env put back exactly as it was." -ForegroundColor Yellow
  }
  Start-ScheduledTask -TaskName $Task
  Write-Host "Connector started again. Report this output to Claude." -ForegroundColor Yellow
  exit 1
}

# ---- start and read the first minute and a half of the log ------------------------------------------
$startUtc = (Get-Date).ToUniversalTime()
Start-ScheduledTask -TaskName $Task
Write-Host "Started at $($startUtc.ToString('HH:mm:ss')) UTC. Waiting 100 seconds for the first posts..."
Start-Sleep -Seconds 100
Write-Host "Task: $((Get-ScheduledTask -TaskName $Task).State)"
$fresh = @(Get-Content $Log -Tail 120 | Where-Object {
  $_ -match '^\[agent (\S+)\]' -and ([datetime]::Parse($matches[1])).ToUniversalTime() -ge $startUtc
} | ForEach-Object { Mask $_ })
$fresh | Select-Object -Last 25 | ForEach-Object { Write-Host "  $_" }
# A cycle with no changed movement posts nothing (agent.mjs serviceLoads), so "stored" may not appear
# in 100 s; the probe above already proved the token and address. What must NOT appear is a failure.
$bad    = @($fresh | Where-Object { $_ -match 'cycle failed|\(401\)|rejected the ingest token|refused the payload|unreachable after' })
$stored = @($fresh | Where-Object { $_ -match 'changed and stored' })

if ($bad.Count -gt 0) {
  Write-Host "FAILED after the restart (see the lines above). Backup kept in $Backup. Report this to Claude." -ForegroundColor Red
  exit 1
}
if ((Get-ScheduledTask -TaskName $Task).State -ne "Running") {
  Write-Host "The task is not Running. Backup kept in $Backup. Report this to Claude." -ForegroundColor Red
  exit 1
}
Remove-Item -Recurse -Force $Backup
Write-Host "SUCCESS: running, no failures since the restart, $($stored.Count) batch(es) stored so far. Backup removed. Restart time: $($startUtc.ToString('HH:mm:ss')) UTC." -ForegroundColor Green
