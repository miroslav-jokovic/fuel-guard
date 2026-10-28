<#
  Silvicom print station — install on the office Windows PC (PRINTERS-AND-SCANNERS-PLAN.md PS3).

  Run in PowerShell AS ADMINISTRATOR, from this folder:

      powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Code ABCD-EFGH -Api https://<your Silvicom address>

  What it does, in order — each step says what it found:
    1. Checks Node.js 20 or newer is installed (winget install OpenJS.NodeJS.LTS if not).
    2. Copies the program to C:\Program Files\Silvicom\PrintStation.
    3. Pairs this PC with the code from Settings → Devices; the token is saved to
       C:\ProgramData\Silvicom\PrintStation\config.json, readable only by Administrators and SYSTEM.
    4. Registers a scheduled task "Silvicom Print Station" that starts with Windows (before anyone
       logs in), runs as SYSTEM, and restarts itself every minute if it ever stops.
    5. Turns sleep off on mains power, because a sleeping PC cannot print.
    6. Starts it now.

  To remove:  Unregister-ScheduledTask -TaskName "Silvicom Print Station" -Confirm:$false
#>
param(
  [Parameter(Mandatory = $true)][string]$Code,
  [Parameter(Mandatory = $true)][string]$Api
)
$ErrorActionPreference = 'Stop'
$TaskName = 'Silvicom Print Station'
$InstallDir = Join-Path $env:ProgramFiles 'Silvicom\PrintStation'
$DataDir = Join-Path $env:ProgramData 'Silvicom\PrintStation'
$Config = Join-Path $DataDir 'config.json'
$Log = Join-Path $DataDir 'station.log'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this in PowerShell opened with "Run as administrator".'
}

# 1. Node.js
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js is not installed. Run:  winget install OpenJS.NodeJS.LTS   then open a NEW PowerShell and run this again.' }
$major = [int]((& $node --version).TrimStart('v').Split('.')[0])
if ($major -lt 20) { throw "Node.js $major is too old; 20 or newer is needed. Run:  winget upgrade OpenJS.NodeJS.LTS" }
Write-Host "1. Node.js found: $node (v$major)"

# 2. Program files
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Force -Path (Join-Path $PSScriptRoot '*.mjs') -Destination $InstallDir -Exclude '*.test.mjs'
Write-Host "2. Program copied to $InstallDir"

# 3. Pair, then lock the folder holding the token down to Administrators and SYSTEM.
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
& icacls $DataDir /inheritance:r /grant:r 'Administrators:(OI)(CI)F' 'SYSTEM:(OI)(CI)F' | Out-Null
& $node (Join-Path $InstallDir 'station.mjs') pair $Code --api $Api --config $Config
if ($LASTEXITCODE -ne 0) { throw 'Pairing failed — see the message above. A code lasts 15 minutes; ask Settings → Devices for a new one.' }
Write-Host '3. Paired.'

# 4. The scheduled task: at startup, as SYSTEM, restart on failure, no time limit.
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$(Join-Path $InstallDir 'station.mjs')`" run --config `"$Config`" --log `"$Log`"" -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$task = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $task | Out-Null
Write-Host "4. Scheduled task '$TaskName' registered (starts with Windows)."

# 5. Never sleep on mains power. The screen may still turn off.
& powercfg /change standby-timeout-ac 0
& powercfg /change hibernate-timeout-ac 0
Write-Host '5. Sleep turned off on mains power.'

# 6. Start now.
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3
$state = (Get-ScheduledTask -TaskName $TaskName).State
Write-Host "6. Started — task state: $state. Settings → Devices should show this PC online within a minute."
Write-Host "   Its log: $Log"
