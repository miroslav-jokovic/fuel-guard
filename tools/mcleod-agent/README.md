# FuelGuard ⇄ McLeod sync agent

A tiny program that runs **on your network** (on the McLeod server, or any Windows/Linux box that can reach
it). It reads dispatch data from McLeod LoadMaster and sends it **out** to FuelGuard over HTTPS.

**It never opens your network to the outside.** The only connections it makes are to McLeod (inside your
network) and to FuelGuard's HTTPS address (outbound, like any web browser). No inbound firewall changes.

## What it sends

- **Movements / loads** — including whether each was a **temperature-controlled (reefer) load**. FuelGuard
  uses this to stop false "reefer fuel diversion" alerts on trucks whose reefer wasn't actually running.
- **Driver home time / time-off** windows.

## Requirements

- **Node.js 18 or newer** (free: https://nodejs.org — pick the LTS installer). Check with `node --version`.

## Setup (once)

1. Copy this whole folder to the machine that will run it.
2. In FuelGuard, an admin goes to **Settings → Integrations → McLeod**, clicks **Enable**, and copies the
   **ingest token** (it starts with `fgtms_` and is shown only once).
3. Copy `config.example.env` to a new file named `.env` and fill in:
   - `FUELGUARD_INGEST_URL` — your FuelGuard address.
   - `FUELGUARD_INGEST_TOKEN` — the `fgtms_…` token from step 2.
   - Leave `SOURCE=mock` for now.

## Prove the FuelGuard connection first (mock mode)

Before wiring McLeod, confirm the pipe works. Edit `.env`, set the three `REPLACE_…` values in mock mode is
not needed — mock posts sample rows; to see them match, open `agent.mjs` and set the mock `vehicle_unit` /
`driver_employee_id` to real values from your fleet. Then run:

```
npm start
```

You should see `sync ok`, with `received` / `upserted` counts. If it says `UNMATCHED units`, that unit number
isn't in FuelGuard yet — expected until you use a real one. A `401` means the token is wrong.

## Switch to live McLeod

1. Set `SOURCE=mcleod` in `.env` and fill in `MCLEOD_WS_URL`, `MCLEOD_COMPANY`, `MCLEOD_WS_TOKEN` (your McLeod
   admin / eisolution provides these once the LoadMaster **web services API** is enabled).
2. Open `agent.mjs` and complete the small mapping in `fetchFromMcleod` — the comments mark exactly which
   McLeod fields to point at (most importantly, the field that marks a load temperature-controlled). This is
   confirmed against one real movement during the connectivity test; FuelGuard's team will help.

## Run it on a schedule

- **Simplest:** leave `INTERVAL_MINUTES=0` and let **Windows Task Scheduler** (or cron) run `npm start` every,
  say, 30 minutes.
- **Always-on:** set `INTERVAL_MINUTES=30` and keep the program running; it syncs every 30 minutes itself.

The agent remembers the last successful sync time in `state.json`, so each run only pulls what changed.

## Safe by design

- Read-only against McLeod; only ever sends data out to FuelGuard.
- The FuelGuard token can be revoked/rotated anytime from Settings — the agent stops working immediately.
- Re-running is safe (idempotent): re-sending the same movements just updates them, never duplicates.
