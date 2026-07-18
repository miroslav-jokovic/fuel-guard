# EFS Auto-Ingest — Setup & Connection Runbook

**Date:** 2026-07-07 · How to turn on automated EFS ingestion (Chunks 1–5) and connect scheduled EFS
reports to it. No code changes — this is configuration + the delivery bridge.

---

## How it works (the contract you're wiring to)

The API runs a per-org scheduler (`efsIngestScheduler`) that, every `EFS_INGEST_MINUTES`, looks in a
**Supabase Storage bucket** for reports delivered under **`<orgId>/incoming/`**, ingests each one through
the same idempotent path the manual upload uses, then **moves** it:

```
efs-reports/                         ← the bucket (name = EFS_INGEST_BUCKET)
  <orgId>/incoming/report.csv        ← drop reports here
  <orgId>/processed/2026-07-07T…-report.csv   ← moved here on success (timestamp-prefixed)
  <orgId>/error/2026-07-07T…-bad.csv          ← moved here if unreadable/unrecognized
```

- **Accepted files:** the EFS **Transaction Detail** and **Reject** reports, as **`.csv`** (no extra
  dependency) or **`.xlsx`/`.xls`** (needs `exceljs`, already installed). Same column formats the manual
  upload accepts.
- **Safe to re-drop:** ingestion is idempotent (file SHA-256 + per-row `external_ref`), so re-delivering
  the same file — or overlapping periods — is a no-op. Nothing is double-counted.
- **Scoring is rate-limited:** each import auto-rescopes the affected vehicles through your rate-limited
  Samsara client, so a large batch paces itself.
- **Nothing is deleted:** processed and error files are preserved (moved), for audit.

---

## Part A — Turn the feature on (one-time)

**1. Create the bucket.** In Supabase → Storage, create a **private** bucket named **`efs-reports`**
(or any name — you'll set `EFS_INGEST_BUCKET` to match). Private is correct: the API reads it with the
service-role key, which bypasses Storage RLS. No public access, no extra policies needed.

**2. Set env vars on the API service** (Railway → the API service → Variables):

| Var | Value | Meaning |
|---|---|---|
| `EFS_INGEST_SOURCE` | `storage` | Turns the scheduler on (default `off`). |
| `EFS_INGEST_BUCKET` | `efs-reports` | Must match the bucket name. |
| `EFS_INGEST_MINUTES` | `30` | Poll cadence. 30 is a good default; lower = fresher, still cheap. |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are already set for the app — the ingester reuses them.

**3. Redeploy / restart the API.** On boot you should see in the logs:

```
[efs-ingest] auto-ingest enabled — source=storage, every 30m
```

If you don't see it: `EFS_INGEST_SOURCE` isn't `storage`, or Supabase env isn't set.

**4. Find your org id.** In Supabase → SQL editor:

```sql
select id, name from organizations;
```

Copy Silvicom's `id`. Reports for that tenant must live under **`<that-id>/incoming/`**. (The scheduler
runs per org, so the folder name is how a file is attributed to a tenant.)

---

## Part B — Verify it works (before automating delivery)

Prove the pipeline end-to-end with a manual drop — no EFS scheduling involved yet:

1. Export a real **Transaction Detail** report from eManager (`.csv` or `.xlsx`).
2. In Supabase → Storage → `efs-reports`, create the path `<orgId>/incoming/` and **upload** the file.
3. Either wait up to `EFS_INGEST_MINUTES`, or go to **Settings → Data & Sync → Import EFS reports →
   "Check now"** to run it immediately.
4. Confirm:
   - the file moved to `<orgId>/processed/…`,
   - the freshness chip shows "updated just now",
   - new rows appear on **Transactions / Fuel Log**, and anomalies/dashboard update,
   - anything unreadable landed in `<orgId>/error/…` instead (and the weekly digest would flag it).

Once this works, the only thing left is getting EFS to drop files into `incoming/` automatically.

---

## Part C — Connect scheduled EFS reports (the delivery bridge)

The bucket is the landing zone; something has to put EFS's scheduled report into `<orgId>/incoming/`.
There are three ways, in increasing order of "hands-off":

### Option 1 — Manual / assisted drop (works today, zero setup)
Whoever runs the report drops it into the bucket instead of the app's upload page. Good for a pilot or a
low-frequency period. Fully functional now.

### Option 2 — Email → bucket (if EFS delivers the report by email)
1. In eManager, schedule the **Transaction Detail** and **Reject** reports to email a **dedicated address**
   (e.g. `efs-feed@silvicominc.com`).
2. Point that address at an **inbound-email service** — Mailgun Routes, CloudMailin, SendGrid Inbound
   Parse, or Resend Inbound — which POSTs each message (with attachments) to a webhook.
3. The webhook (a small Supabase **Edge Function** or an API route) saves the attachment to
   `efs-reports/<orgId>/incoming/<filename>`. That's the only glue code — ~30 lines; the ingester does the
   rest.

### Option 3 — SFTP → app (cleanest, if EFS delivers by SFTP)
If EFS can deliver to **SFTP** (common for fleet data feeds), the simplest architecture is to skip the
bucket bridge and have the app **poll the SFTP directly**. That's the "Chunk 2b" adapter — it slots behind
the same `IngestSource` interface, so nothing downstream changes. It needs one dependency
(`ssh2-sftp-client`) and the SFTP host/user/key. **Recommended if SFTP is available** — fewest moving parts,
no bucket, no email service.
(Interim: an `rclone`/cron job can also copy an SFTP folder into the bucket to use Option-1/2 plumbing.)

### On the EFS side (all options)
In eManager, set the **Transaction Detail** and **Reject** reports to a **recurring schedule** delivering to
your chosen channel, in the **same format** you export today (so the column mapping holds). If eManager
doesn't expose a scheduled/recurring delivery option, call EFS (**888-824-7378** / your account manager) to
enable it — this is the one external dependency.

---

## Part D — Day-to-day operations

- **Freshness & manual run:** Settings → Data & Sync → *Import EFS reports* shows "updated N min ago",
  live progress, and a **Check now** button (shares the scheduler's slot, so they can't overlap).
- **Problems reach you:** the weekly digest's data-health line flags **import shortfalls** (possible row
  loss) and **deliveries that couldn't be imported** (files sitting in `error/`). Check `error/` when it does.
- **Re-processing:** to re-ingest a file, drop it back in `incoming/` — idempotency makes it safe.
- **Kill switch:** set `EFS_INGEST_SOURCE=off` and restart to pause all automated ingestion (manual upload
  still works).

---

## Recommended path

1. Do **Part A + B** now — that's the whole system live, verified with a manual drop.
2. Ask EFS what scheduled delivery they support. **If SFTP → build the direct SFTP adapter (Chunk 2b)** and
   skip the bucket bridge. **If email-only → Option 2** (bucket + inbound-email function).
3. Keep the storage bucket as the universal testing/fallback path regardless of which you pick.
