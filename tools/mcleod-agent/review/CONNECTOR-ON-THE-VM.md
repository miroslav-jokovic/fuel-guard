# The connector on the VM: what it needs and how it runs

Alex, these are just the facts about the connector, so you can set up the VM however suits you.
Whatever you choose is fine by us. If it's easier, give us access and we'll do the install, or we
can do it together.


## What it needs

- **OS:** anything that runs Node.js. We'd expect Linux, the same as our other servers. It also
  runs on Windows.
- **Node.js 22 or newer.**
- **Resources:** very little.
  - Memory: about 90 MB normally, and about 180 MB at the peak of the nightly finance run.
  - Disk: about 65 MB for the folder, plus the log (about 300 KB a day).
  - CPU: next to nothing. Each run is a few seconds, one at a time.
- **Network:**
  - LME at 10.0.1.171, port 1433.
  - HTTPS (443) out to `fleetguardapi-production.up.railway.app`.
  - Nothing has to reach the VM from outside.


## What's in the folder

- The connector's code, with one dependency: the Microsoft SQL driver for Node (`mssql`). It's
  pinned in `package-lock.json`, so `npm ci --omit=dev` installs exactly the version we tested.
- `connector.example.env`: a template for the config. The real file is `connector.env`. It holds
  two secrets, the LME password and our upload token, which we'll send separately. Keep the quotes
  around both: Node reads an unquoted value only up to the first `#`.
- It writes two small files of its own next to the code:
  - `service-state.json`: what it has already sent.
  - `service.lock`: stops a second copy from starting.


## How it runs

It's one long-running process:

```
node --env-file=connector.env agent.mjs --service
```

- It keeps one connection to LME open and runs the feeds one after another:
  - open loads, every minute;
  - closing loads, every 10 minutes;
  - drivers/trucks/trailers, every 15 minutes;
  - finance, at 2:00 AM Central.
- It logs one line per step to standard output: counts, times and McLeod ids, never addresses or
  licence details. Under systemd that lands in the journal. It can also write to a file if
  `CONNECTOR_LOG` is set; that file rolls over at 20 MB.
- On SIGTERM it closes the LME connection and exits cleanly.
- If LME is busy (three timeouts in a row), it pauses for 15 minutes on its own.
- If the service is restarted, it carries on where it left off.

For reference, this is how we run services like it under systemd. Change anything that doesn't
match how you set things up:

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


## Before it goes on a schedule

We'd like to do these together once the VM is ready:

1. **A dry run:** `node --env-file=connector.env agent.mjs --loads --dry-run`. It reads the open
   loads once and prints what it would send. It sends nothing. The count should match the McLeod
   board (about 160 loads).
2. **A one-time cleanup:** we close the loads that Silvicom 360 still shows as open but that have
   since been delivered or voided in McLeod. That's about 180 movement ids, one keyed read.
3. **Start the service,** and watch the first few minutes of the log together.
4. **Switch off the roster sync** on my laptop.


## Later updates

When the connector changes, we'll send the new SQL file first. Updating it is just new files in
the folder, `npm ci --omit=dev`, and a restart. `connector.env` and `service-state.json` stay as
they are.

Thanks,
Miki
