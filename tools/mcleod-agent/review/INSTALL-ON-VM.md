# Silvicom 360 connector: installing it on the Board VM

Alex, these are the install steps my letter mentions. It takes about 20 minutes, and I'm happy to
do it with you on a call. Nothing gets scheduled until you've OK'd the letter and the SQL file.


## 1. What the VM needs

- Windows Server 2019 or later, or any current Linux. 2 vCPU, 4 GB RAM and 20 GB disk is plenty.
- Node.js 22 LTS from nodejs.org. That's the only thing we install besides our own folder.
- Network:
  - LME at 10.0.1.171, port 1433.
  - HTTPS (443) out to `fleetguardapi-production.up.railway.app`.
  - Nothing connects in to the VM from outside.


## 2. Install (Windows)

Run these in PowerShell as an administrator.

1. Install Node.js 22 LTS. Check it with `node --version`, which should print v22 or later.

2. Unzip the folder we send you to `C:\Silvicom\connector`. Then install its one dependency (the
   Microsoft SQL driver for Node), pinned to the exact version we tested:

   ```powershell
   cd C:\Silvicom\connector
   npm ci --omit=dev
   ```

3. Create the config file from the template, then fill in the LME password and our upload token.
   I'll send the token separately.

   ```powershell
   Copy-Item connector.example.env connector.env
   notepad connector.env
   ```

   Keep the quotes around both secrets. Then limit the file to administrators and SYSTEM:

   ```powershell
   icacls connector.env /inheritance:r /grant:r "SYSTEM:R" "Administrators:F"
   ```

4. Test run. This reads the open loads once, prints what it would send, and sends nothing:

   ```powershell
   node --env-file=connector.env agent.mjs --loads --dry-run
   ```

   You should see about 160 loads. In SSMS you'll see the session as program_name
   "Silvicom 360 connector" while it runs.

5. Register it as a background task that starts with the VM and restarts itself if it stops:

   ```powershell
   $action   = New-ScheduledTaskAction -Execute "cmd.exe" `
                 -Argument '/c node --env-file=connector.env agent.mjs --service >> connector.log 2>&1' `
                 -WorkingDirectory "C:\Silvicom\connector"
   $trigger  = New-ScheduledTaskTrigger -AtStartup
   $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
                 -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
   Register-ScheduledTask -TaskName "Silvicom 360 connector" -Action $action -Trigger $trigger `
                 -Settings $settings -User "SYSTEM" -RunLevel Highest
   ```

   **Please don't start it yet.** Registering the task is fine, but it should only start after the
   check in section 4.


## 2b. Install (Linux)

1. Install Node 22.
2. Put the folder in `/opt/silvicom/connector` and run `npm ci --omit=dev` there.
3. Create `connector.env` as in step 3 above, then run `chmod 600 connector.env`.
4. Add this unit as `/etc/systemd/system/silvicom-connector.service`:

   ```ini
   [Unit]
   Description=Silvicom 360 connector
   After=network-online.target

   [Service]
   WorkingDirectory=/opt/silvicom/connector
   ExecStart=/usr/bin/node --env-file=connector.env agent.mjs --service
   Restart=always
   RestartSec=60
   User=silvicom

   [Install]
   WantedBy=multi-user.target
   ```

5. Run `systemctl daemon-reload`. As on Windows, don't enable it yet.


## 3. Starting, stopping, logs

| | Windows | Linux |
|---|---|---|
| start | `Start-ScheduledTask "Silvicom 360 connector"` | `systemctl enable --now silvicom-connector` |
| stop | `Stop-ScheduledTask "Silvicom 360 connector"` | `systemctl stop silvicom-connector` |
| log | `C:\Silvicom\connector\connector.log` | `journalctl -u silvicom-connector` |

You can always stop us from SQL Server's side too: `KILL` the session whose program_name is
"Silvicom 360 connector", or disable the login. The connector backs off, retries later, and never
opens more than one connection.

Only one copy can run at a time. A second copy sees the first one's lock file and refuses to start.

The log grows by one line per feed run, about 150 KB a day. It holds counts and times, never
driver details.


## 4. Go-live check, together

1. Run the test from step 4 and compare the load count with your board.
2. We run the one-time cleanup: the loads we still show as open that have since been delivered or
   voided in LME. We'll send you the file of movement ids (about 180 today). It's one keyed read:

   ```
   node --env-file=connector.env agent.mjs --close --ids-file=open-ids.txt
   ```

3. Start the service (section 3), then watch the log for a few minutes. You should see a
   "loads: … on the board" line every minute, and "none changed" once nothing has moved.
4. After that, I switch off the roster sync on my laptop, and you can disable the NikiAnalytics
   login for us.


## 5. Updating it later

When the connector changes, we'll send you the new SQL file first, as promised. Then:

1. Stop the service.
2. Replace the folder's files. Keep `connector.env` and `service-state.json`.
3. Run `npm ci --omit=dev`.
4. Start the service again.

Thanks,
Miki
