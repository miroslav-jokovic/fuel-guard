# Silvicom 360 connector - install the connector's code from ONE pinned commit, safely.
#
# In an Administrator PowerShell on the Board VM:
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Silvicom\update-connector.ps1 -Commit <40-hex> -RosterMode create
#
# Why a script and not hand-copied files (ROSTER-LIFECYCLE-PLAN, 2026-10-30): since the 10/07 install the
# VM has been patched file by file (10/10, 10/12, 10/14), so nobody can say from here which version of
# each file it runs. This script replaces the WHOLE source set with the files of one commit, so after it
# the VM's code is a commit anybody can read. node_modules stays: the only dependency (mssql) has not
# changed since 2026-09-24.
#
# What it guarantees: every file is downloaded and checked against the SHA-256 below BEFORE anything is
# stopped; the connector is stopped and confirmed gone before a file is touched; the old files and
# connector.env are backed up first; the connector's own tests must pass on the VM; exactly one line of
# connector.env changes (ROSTER_MODE), written UTF-8 without a BOM with the same line endings; any
# failure puts every file back exactly as it was and starts the connector again. connector.env's
# secrets are never printed, and the state files (service-state.json, roster-state.json) are never touched.
# ASCII only on purpose: PowerShell 5.1 reads a BOM-less script as ANSI.
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$Commit,
  [ValidateSet("identity", "create")]
  [string]$RosterMode = "create"
)

$ErrorActionPreference = "Stop"
$Task   = "Silvicom 360 connector"
$Base   = "C:\Silvicom"
$App    = Join-Path $Base "connector"
$Node   = Join-Path $Base "node\node.exe"
$EnvF   = Join-Path $App "connector.env"
$Log    = Join-Path $App "connector.log"
$Short  = $Commit.Substring(0, 7)
$Stage  = Join-Path $Base ("stage-" + $Short)
$Backup = Join-Path $Base ("backup-" + $Short)
$Raw    = "https://raw.githubusercontent.com/miroslav-jokovic/fuel-guard/$Commit/tools/mcleod-agent/"
$Utf8   = New-Object Text.UTF8Encoding($false)

# Generated on the Mac from the commit (sha256 of each file as git stores it). A file that does not match
# stops the update before the connector is touched.
$Files = [ordered]@{
  "agent.mjs" = "9c312182fa5c75609b5f54cba9b30a8ac61f583fb3b9f32fac9ea7342d52eb70"
  "billing.mjs" = "a125a4d3d2a18a8af2ad1b58f2f5334716159cf85818da68da8587ad40e4ef57"
  "billing.test.mjs" = "1b27936c0b7c6eaa582c3bb926cdd85185823e89dd626f9c15fa4b8511c0a1f1"
  "centralTime.mjs" = "331d9aad6e0f1cf0142500eecea2d06c620a3f7b6e4b8e8d79b13d05541ae4e7"
  "centralTime.test.mjs" = "3b61eb77e2dd3b9c63e9349392efbeb6b5d90f672b6fa62cdb48915a3413720e"
  "connection.mjs" = "6249435a23855be58d2bd0795934f75fc43089f0990bf9b66865d92d1c9c4041"
  "connection.test.mjs" = "f13ebcfc477a11804d5e4f420fa87f330a358646e4351c7eabfcc2d26a73d9ce"
  "dispatchMirror.test.mjs" = "c517c5eae97b52062d40bbd846439ec451ddec1dadf75a4e93459fbba54f5a88"
  "dryRun.mjs" = "7726428907cd9e15d91a6fee5c76f53aebb067df378d7afb54e71eae4f415828"
  "dryRun.test.mjs" = "d7844351b46ec841805d008e123f70643db8b40af6ea91c09365b87dd5253933"
  "expenses.mjs" = "15e116c0c47fa5b65f0f1ef33a0a6442d03e2c3ffbb49faa83ff01c09414eaa7"
  "fuelTaxReceipts.mjs" = "adcd26595a4aca0dd0b7a84508452448af78b88f23b0bde308894781aea9e827"
  "fuelTaxReceipts.test.mjs" = "a902ef16654e4f89ba708e9770ab3bbf5ca96d9264a71ab0a5bdc69fbfd39674"
  "inspect.mjs" = "35605b7ee79c4a33282c7b17ab8f93c846ac3470086237320ddeb24a04fc8b06"
  "ledger.mjs" = "017ddf61f4620176e0b054a622380fa9b7dad05ab1c161792a95ca3176d633ad"
  "ledger.test.mjs" = "cab14896d0377b0511801e42c6866d26d6796c4e13f1d7b7b3387c93c1b1fe00"
  "loads.mjs" = "d7bc12f47013938cb6da067e5839a86a253355dbb6913c9997924a6b06a359d6"
  "loads.test.mjs" = "b4421b9569ab5035e3353d8b584825563c5986d173b4989f7139c8d15431634f"
  "movements.mjs" = "adaef60fcce88fa48c87b138d9d8c662d04aea36e67d7f4785342764e232502e"
  "queries.mjs" = "ef0938cf8ce1d715d58eea272f5116cb1d8ca68ff4327add50bb395e15890a20"
  "queries.test.mjs" = "240cde2b2edd21bb3e7221daad01a69fdbeac836b56dab776459e8dc498dfc7a"
  "review.test.mjs" = "de3b04ba2a1267d4dfaf3d6baa8bbc442a2f2326da2b5693148a7d9fcce1cfab"
  "roster.mjs" = "64446f0761857d3766b675aee47578141bba3d4c181c9cd064a8c4f7f7e27c37"
  "roster.settle.test.mjs" = "d5cf0456820a8c13520f6a007159e4ba8f4efad9fdf2dfdd943e85e274e28a03"
  "schedule.mjs" = "1ed01a621137bfaeeeb3d0bb5b8ed23dd4c39a637773e70b31e88172067890a2"
  "schedule.test.mjs" = "527da5142cd44a6dd49ca3112e2d4d78f326ad35448efd896c94af500484ffb7"
  "service.mjs" = "700d91da51f3b78eee7bdcdcf46d5fe112a5290dcc56519e6a2229302fad7503"
  "service.test.mjs" = "8dd60cdc909927afdb5e2fd61be06840d99c39df49b4fa016e4512b811209ee9"
  "settlements.mjs" = "f3c5ed00eeda0cae661f1c686d7971c94d953715d844c72c7ffde2275f79d153"
  "settlements.test.mjs" = "dc863731bdc570be84727ce56dd14528665801297ec6bca890d030b740ff7adb"
  "windows.mjs" = "0384ebf635daf95bbb1e1d343ffe7aba7f8907eb1a7de796f326845327a095b4"
  "windows.test.mjs" = "2b897fc9f3974d76be55e2a3c1f6f13bdd013a7aa3faeb7af8e8ccaefd50e18b"
  "package.json" = "28c3e431bbe7ef4a978d4fb18d03bdd41a006adfa9cf0408a6025d0cd297e155"
  "review/build-routine.mjs" = "ac214249392338314993b03e7c6b0697d6f4bd294fbb821eb51ee23ab369ce22"
  "review/SILVICOM-READ-ROUTINE.sql" = "c32d48dc53d46991cd8d361affd68f0acb5b9497672c81377610b8370e6f5270"
  "review/SILVICOM-GRANTS.sql" = "99fdd575c7c1cd18b42d0214df0c2d69b728a48d09f46fd4bd9f8747bdb66688"
}

function Lock-File([string]$p) {
  & icacls $p /inheritance:r /grant:r "*S-1-5-18:R" "*S-1-5-32-544:F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "icacls failed on $p" }
}
function Mask([string]$l) { return ($l -replace 'fgtms_[A-Za-z0-9_\-]+', 'fgtms_***') }
function Agent-Pids {
  return @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*agent.mjs*" } | ForEach-Object { $_.ProcessId })
}

$p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Run this in an Administrator PowerShell." }
if (-not (Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue)) { throw "Task '$Task' not found. Nothing changed." }
if (-not (Test-Path $Node)) { throw "$Node not found. Nothing changed." }
if (-not (Test-Path (Join-Path $App "node_modules\mssql"))) { throw "$App\node_modules\mssql not found. Nothing changed." }
if (Test-Path $Backup) { throw "$Backup already exists from an earlier run. Stop and tell Claude. Nothing changed." }

# ---- 1. download and check every file, connector still running ---------------------------------------
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Path $Stage | Out-Null
foreach ($rel in $Files.Keys) {
  $dest = Join-Path $Stage $rel
  $dir = Split-Path $dest -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  Invoke-WebRequest -Uri ($Raw + $rel) -OutFile $dest -UseBasicParsing -TimeoutSec 60
  $h = (Get-FileHash -Algorithm SHA256 -Path $dest).Hash.ToLower()
  if ($h -ne $Files[$rel]) {
    Remove-Item -Recurse -Force $Stage
    throw "$rel does not match its checksum (got $h). Nothing changed."
  }
}
Write-Host "OK  $($Files.Count) files downloaded from commit $Short, every checksum matches"

# ---- 2. read connector.env as it is ------------------------------------------------------------------
$orig = [IO.File]::ReadAllBytes($EnvF)
if ($orig.Length -ge 3 -and $orig[0] -eq 0xEF -and $orig[1] -eq 0xBB -and $orig[2] -eq 0xBF) { throw "connector.env starts with a BOM. Stop and tell Claude. Nothing changed." }
$text  = $Utf8.GetString($orig)
$nl    = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
$lines = $text -split "\r?\n"
$hits  = @(for ($k = 0; $k -lt $lines.Count; $k++) { if ($lines[$k] -like "ROSTER_MODE=*") { $k } })
if ($hits.Count -ne 1) { throw "ROSTER_MODE appears $($hits.Count) times in connector.env (expected 1). Nothing changed." }
Write-Host "Current $($lines[$hits[0]])  ->  ROSTER_MODE=$RosterMode"

$copied = $false
$edited = $false
$added  = @()
try {
  # ---- 3. stop, and make sure no connector process is left ---------------------------------------------
  Stop-ScheduledTask -TaskName $Task
  Start-Sleep -Seconds 5
  $left = Agent-Pids
  if ($left.Count -gt 0) { throw "A connector process is still running (PID $($left -join ', '))." }
  Write-Host "OK  connector stopped (task: $((Get-ScheduledTask -TaskName $Task).State))"

  # ---- 4. backup: every file this update replaces, and connector.env ----------------------------------
  New-Item -ItemType Directory -Path $Backup | Out-Null
  & icacls $Backup /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)R" "*S-1-5-32-544:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "icacls failed on $Backup" }
  foreach ($rel in $Files.Keys) {
    $cur = Join-Path $App $rel
    if (Test-Path $cur) {
      $b = Join-Path $Backup $rel
      $bd = Split-Path $b -Parent
      if (-not (Test-Path $bd)) { New-Item -ItemType Directory -Path $bd | Out-Null }
      Copy-Item $cur $b -Force
    } else { $added += $rel }
  }
  [IO.File]::WriteAllBytes((Join-Path $Backup "connector.env.bak"), $orig)
  Lock-File (Join-Path $Backup "connector.env.bak")
  Write-Host "OK  backup in $Backup ($($Files.Count - $added.Count) files replaced, $($added.Count) new)"

  # ---- 5. copy the new code in --------------------------------------------------------------------------
  $copied = $true
  foreach ($rel in $Files.Keys) {
    $dest = Join-Path $App $rel
    $dd = Split-Path $dest -Parent
    if (-not (Test-Path $dd)) { New-Item -ItemType Directory -Path $dd | Out-Null }
    Copy-Item (Join-Path $Stage $rel) $dest -Force
  }
  Write-Host "OK  code copied"

  # ---- 6. the connector's own tests, on this machine ---------------------------------------------------
  Push-Location $App
  try {
    $tests = Get-ChildItem -Filter "*.test.mjs" | ForEach-Object { $_.Name }
    $out = & $Node --test @tests 2>&1 | ForEach-Object { "$_" }
  } finally { Pop-Location }
  $pass = ($out | Select-String -Pattern 'pass (\d+)\s*$' | Select-Object -Last 1)
  $fail = ($out | Select-String -Pattern 'fail (\d+)\s*$' | Select-Object -Last 1)
  if (-not $pass -or -not $fail) { throw "Could not read the test summary." }
  $np = [int]$pass.Matches[0].Groups[1].Value
  $nf = [int]$fail.Matches[0].Groups[1].Value
  if ($nf -ne 0 -or $np -eq 0) {
    $out | Select-String -Pattern 'not ok' | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" }
    throw "Tests: $np passed, $nf failed."
  }
  Write-Host "OK  tests: $np passed, 0 failed"

  # ---- 7. ROSTER_MODE: write in place (keeps the ACL), UTF-8 without BOM, same line endings ------------
  if ($lines[$hits[0]] -ne "ROSTER_MODE=$RosterMode") {
    $lines[$hits[0]] = "ROSTER_MODE=$RosterMode"
    [IO.File]::WriteAllText($EnvF, ($lines -join $nl), $Utf8)
    $edited = $true
    Lock-File $EnvF
    $now = [IO.File]::ReadAllBytes($EnvF)
    if ($now.Length -ge 3 -and $now[0] -eq 0xEF -and $now[1] -eq 0xBB -and $now[2] -eq 0xBF) { throw "BOM found after the write." }
    $a = $Utf8.GetString($orig) -split "\r?\n"
    $n = $Utf8.GetString($now) -split "\r?\n"
    if ($a.Count -ne $n.Count) { throw "Line count changed ($($a.Count) -> $($n.Count))." }
    $diff = @(for ($k = 0; $k -lt $a.Count; $k++) { if ($a[$k] -cne $n[$k]) { ($n[$k] -split '=', 2)[0] } })
    $a = $null; $n = $null; [GC]::Collect()
    if ($diff.Count -ne 1 -or $diff[0] -ne "ROSTER_MODE") { throw "Unexpected change: $($diff.Count) line(s) differ ($($diff -join ', '))." }
    Write-Host "OK  connector.env: exactly 1 line changed (ROSTER_MODE), no BOM, ACL re-applied"
  } else { Write-Host "OK  ROSTER_MODE already $RosterMode" }
}
catch {
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  if ($copied) {
    foreach ($rel in $Files.Keys) {
      $b = Join-Path $Backup $rel
      if (Test-Path $b) { Copy-Item $b (Join-Path $App $rel) -Force }
    }
    foreach ($rel in $added) { Remove-Item -Force (Join-Path $App $rel) -ErrorAction SilentlyContinue }
    Write-Host "Code put back exactly as it was." -ForegroundColor Yellow
  }
  if ($edited) {
    [IO.File]::WriteAllBytes($EnvF, $orig)
    Lock-File $EnvF
    Write-Host "connector.env put back exactly as it was." -ForegroundColor Yellow
  }
  Start-ScheduledTask -TaskName $Task
  Write-Host "Connector started again. Backup kept in $Backup. Report this output to Claude." -ForegroundColor Yellow
  exit 1
}
Remove-Item -Recurse -Force $Stage

# ---- 8. start and read the first two minutes of the log --------------------------------------------------
$startUtc = (Get-Date).ToUniversalTime()
Start-ScheduledTask -TaskName $Task
Write-Host "Started at $($startUtc.ToString('HH:mm:ss')) UTC. Waiting 120 seconds..."
Start-Sleep -Seconds 120
Write-Host "Task: $((Get-ScheduledTask -TaskName $Task).State)"
$fresh = @(Get-Content $Log -Tail 200 | Where-Object {
  $_ -match '^\[agent (\S+)\]' -and ([datetime]::Parse($matches[1])).ToUniversalTime() -ge $startUtc
} | ForEach-Object { Mask $_ })
$fresh | Where-Object { $_ -match 'service: started|roster|retire|cycle failed|REFUSED' } | Select-Object -Last 25 | ForEach-Object { Write-Host "  $_" }
$bad = @($fresh | Where-Object { $_ -match 'cycle failed|\(401\)|rejected the ingest token|refused the payload|unreachable after|REFUSED' })

if ($bad.Count -gt 0 -or (Get-ScheduledTask -TaskName $Task).State -ne "Running") {
  Write-Host "PROBLEM after the restart (see the lines above). Backup kept in $Backup. Report this to Claude." -ForegroundColor Red
  exit 1
}
Write-Host "SUCCESS: commit $Short running, ROSTER_MODE=$RosterMode, no failures since the restart. Backup kept in $Backup (delete it after a day of normal logs)." -ForegroundColor Green
Write-Host "The roster sweep runs within 15 minutes of its last run; look for 'roster: drivers ... created=' in $Log." -ForegroundColor Green
