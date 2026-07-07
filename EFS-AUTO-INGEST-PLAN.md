# EFS Auto-Ingest Plan — scheduled report → automated pickup

**Date:** 2026-07-06 · Analysis + build plan, no code changed. Companion to `AUTOMATION-PLAN.md` / `AUTOMATION-BUILD-PLAN.md`.
**Goal:** remove the daily manual "export from eManager → upload to the Import page" step. A recurring EFS
report is delivered to a channel our backend polls; the API parses, dedups, commits, and scores it
automatically — with the same faithful-store + reconciliation guarantees the manual path has today.

Legend: ☐ not started · ◐ in progress · ☑ done

---

## Decision (locked with Miki, 2026-07-06)
- **Delivery channel: scheduled report → email or SFTP.** We do *not* depend on EFS's partner Data-Feed
  program (Fleetio/Datatruck-style). We keep the exact `Transaction Detail` / `Reject` report formats the
  parser already handles and change only *how the file arrives*.
- **Data Feed (official partner feed) stays a future drop-in:** the pipeline below is built so the "source
  adapter" is the only thing that would change if EFS ever onboards FuelGuard as a data-sharing partner.
  Everything from the parser inward is reused unchanged.
- **No new infrastructure.** Runs in-process on the single Railway instance, like every other scheduler.

---

## What we reuse (this is why the build is small)

The import already exists — it just runs in the browser. The plan moves it server-side and puts a scheduler
in front of it. Almost nothing is rewritten.

- **Parser + dedup: `packages/shared/src/efsImport.ts`** — already imported by the API. We reuse
  `detectReportKind`, `normalizeAllTransactionLines`, `normalizeTransactionRows`, `reconcileFuelLines`,
  `normalizeRejectRows`, `buildFuelExternalRef`, `deriveFuelEventsFromEfsStore`. **No parser changes.**
- **Commit logic: `apps/web/src/features/import/useImport.ts`** — the only real port. Its
  faithful-store upsert (`efs_transactions`), derived-events upsert (`fuel_transactions`), declined upsert
  (`declined_transactions`), and the **post-commit shortfall reconciliation** move into a new API service.
  All upserts are already idempotent (`onConflict: org_id,external_ref, ignoreDuplicates`).
- **Idempotency: file-level `imports.file_hash` (SHA-256) + row-level `external_ref`.** Re-delivered or
  overlapping reports are safe — the same file is a no-op, the same rows dedup. This is what makes
  unattended ingestion "precise."
- **Jobs ledger: `apps/api/src/services/jobs.ts`** — `runJob(admin, orgId, kind, fn)` with the partial
  unique index preventing concurrent duplicate runs. We add one `JobKind`: `efs_ingest`.
- **Scheduler pattern: `apps/api/src/services/{samsara,digest,nightlyReconcile}Scheduler.ts`** — copy the
  shape (per-org loop, staggered, env-gated cadence, wired in `index.ts`).
- **Scoring: `scoreImportWithCascade` + the existing auto-cascade** — called exactly as the manual commit
  calls it today, so MPG baselines of neighboring fills re-score without a manual Rebuild.

---

## Architecture

```
EFS eManager (scheduled recurring report: Transaction Detail + Reject, xlsx/csv)
        │  delivered to →
        ▼
┌─────────────────────────┐     one of (pluggable "source adapter"):
│  Ingestion source        │  • IMAP mailbox   (report emailed as attachment)
│  (poll on a schedule)    │  • SFTP dropbox   (report dropped as a file)
└───────────┬─────────────┘  • Supabase Storage bucket (uploaded/forwarded)
            ▼
   efsIngestScheduler  ── per org, env cadence, single-flight, staggered (jobs ledger)
            ▼
   efsIngest service (NEW, apps/api)
     1. fetch new artifacts from the source (unread mail / new files)
     2. hash → skip if imports.file_hash already seen (idempotent)
     3. readFile → detectReportKind → parse (SHARED, unchanged)
     4. reconcile vehicles/drivers  (SHARED, unchanged)
     5. upsert efs_transactions / fuel_transactions / declined_transactions (ported from useImport.ts)
     6. post-commit shortfall reconciliation → imports.summary  (ported)
     7. scoreImportWithCascade  (existing) → anomalies + notifications
     8. archive/mark the source artifact as processed
            ▼
   result recorded in jobs.stats  → freshness chip + digest, exactly like the other schedulers
```

**Why the reconciliation carries over unchanged:** the manual path already computes `expected_new − db_inserted`
per file and writes `shortfall_*` onto `imports.summary`. Unattended ingestion needs that *more*, not less —
it becomes the alarm that a silently-truncated or malformed delivery didn't fully land. We surface it via the
digest instead of a toast (no human is watching the screen).

---

## Source adapter — the one thing to pick

All three deliver the *same file* the parser already reads; they differ only in transport. Recommended default
is **IMAP** (a dedicated inbox) for fastest setup, with the adapter interface written so SFTP/Storage are
swap-ins.

| Adapter | EFS setup | Backend setup | Notes |
|---|---|---|---|
| **IMAP inbox** (recommended first) | Schedule report emailed to a dedicated address (e.g. `efs-feed@…`) | IMAP creds in env; poll unread, save attachment, mark read | Fastest to stand up; watch for provider attachment-size limits |
| **SFTP dropbox** | Ask EFS/eManager to deliver report to an SFTP path (or you run the SFTP endpoint) | SFTP host/user/key in env; list + fetch + move to `/processed` | Cleanest audit trail; needs an SFTP endpoint we host or EFS pushes to |
| **Storage bucket** | A forwarding rule / small mail-hook drops the file into Supabase Storage | Poll bucket prefix; move to `processed/` | Good if a mail service already lands attachments in object storage |

`interface IngestSource { list(): Promise<Artifact[]>; fetch(a): Promise<Buffer>; markDone(a): Promise<void> }`
— the scheduler and `efsIngest` depend only on this, so the transport is a config choice, not a rewrite.

> Action item on the EFS side (business, parallel to the build): in eManager, confirm the *Transaction Detail*
> and *Reject* reports can be **scheduled/recurring** with delivery to the chosen channel. If eManager only
> supports on-demand export, we fall back to a thin scheduled export step or revisit the Data-Feed path.

---

## Build order (chunks — each self-contained, verified, left uncommitted per house style)

### Chunk 1 — Port commit to an API service  ☐
Move the write path out of the browser with zero behavior change.
- **New `apps/api/src/services/efsIngest.ts`**: `ingestReport(admin, env, orgId, { buffer, filename, requestedBy })`
  → parse (shared) → upsert the three tables → post-commit shortfall summary → `scoreImportWithCascade`.
  Lift the exact logic from `apps/web/src/features/import/useImport.ts` (`useCommitImport`), swapping the
  browser Supabase client for `getSupabaseAdmin()` and `crypto.subtle` for Node `crypto`.
- **Reuse `imports.file_hash`** for the already-imported short-circuit (same SHA-256).
- **Verify:** unit tests feeding the real EFS sample exports (149-line transaction + reject) through
  `ingestReport` against a stub client — assert row counts, dedup on re-run, shortfall = 0; api typecheck; lint.

### Chunk 2 — Ingestion source adapter (IMAP first)  ☐
- **`apps/api/src/lib/ingestSource.ts`**: the `IngestSource` interface + an `ImapSource` implementation
  (poll unread, extract `.xlsx/.csv` attachments, `markDone` = mark read / move to a processed folder).
  Stub `SftpSource` / `StorageSource` behind the same interface.
- **Env:** `EFS_INGEST_SOURCE=imap|sftp|storage|off`, plus `EFS_IMAP_HOST/PORT/USER/PASS/FOLDER`
  (mirror the `SAMSARA_*` env conventions in `apps/api/src/env.ts`).
- **Verify:** adapter unit test against a mock IMAP server (fetch + markDone); typecheck; lint.

### Chunk 3 — Scheduler + jobs wiring  ☐
- **`apps/api/src/services/efsIngestScheduler.ts`** modeled on `samsaraScheduler.ts`: per-org loop, staggered,
  cadence `EFS_INGEST_MINUTES` (default e.g. 30; `0` = off/kill-switch). Each run goes through
  `runJob(admin, orgId, "efs_ingest", …)` so two runs can't overlap and progress/freshness are visible.
- **Add `"efs_ingest"` to `JobKind`** in `services/jobs.ts`.
- **Wire in `apps/api/src/index.ts`** next to `startSamsaraScheduler(env)` etc.
- **Verify:** scheduler test (cadence gating, single-flight via the jobs conflict path); typecheck; lint.

### Chunk 4 — Surface it (freshness + digest + manual trigger)  ☐
- **Freshness:** the existing `useJob`/`lastDoneJob` gives "EFS feed as of HH:MM" on the Import/Data & Sync
  page for free (kind = `efs_ingest`).
- **Manual "Check for new reports now"** endpoint (`POST /api/transactions/ingest-efs`, admin-only, audited)
  that enqueues the same job — same pattern as the other Settings → Data & Sync buttons.
- **Digest:** add ingested-file count + any `shortfall_*` > 0 in the last 7d (from `imports.summary` / `jobs`)
  to the weekly digest, so a truncated delivery reaches email, not just the dashboard.
- **Import page copy:** note that files now arrive automatically; keep manual upload as the fallback.
- **Verify:** endpoint auth/audit test; digest aggregation includes the new fields; web typecheck; lint.

### Chunk 5 — Hardening for unattended runs  ☐
- **Malformed/`unknown`-kind delivery:** don't throw the whole run — record `skipped` on `jobs.stats` and
  alert via digest (a human's eye is not on it).
- **Partial/empty file guard:** if `detectReportKind` = `unknown` or 0 rows, quarantine the artifact
  (leave in source / move to `error/`) rather than marking done, so nothing is silently dropped.
- **Duplicate-day sanity:** compare `rows_by_day` against the prior file for the same span to catch a
  re-sent-but-changed report; log to `jobs.stats`.
- **Verify:** tests for unknown-kind, empty-file, and re-delivered-file cases; typecheck; lint.

---

## Cross-cutting verification (every chunk)
`packages/shared` vitest · `apps/api` tsc + vitest · `apps/web` vue-tsc · eslint on changed files. Leave
uncommitted; you deploy + run any SQL. **Golden test:** the real EFS sample exports must produce byte-for-byte
the same rows through `ingestReport` (server) as through the current `useCommitImport` (browser) — same
`efs_transactions`, `fuel_transactions`, `declined_transactions`, same shortfall = 0.

## Deploy checklist (accumulates)
- New env: `EFS_INGEST_SOURCE`, `EFS_INGEST_MINUTES`, `EFS_IMAP_*` (or `EFS_SFTP_*` / storage prefix).
- No new migrations required — reuses `imports` (incl. `file_hash` + `summary`), `efs_transactions`,
  `fuel_transactions`, `declined_transactions`, `jobs`. (Only add one if you want an `imports.channel`
  column to distinguish `manual` vs `auto` uploads — optional, nice for auditing.)
- After deploy: set up the recurring eManager report → chosen channel; scheduler self-starts; first pickup
  runs within `EFS_INGEST_MINUTES`.

---

## Open items to confirm (business, parallel to the build)
1. **eManager scheduled/recurring report** with delivery to email or SFTP — confirm it exists for the
   *Transaction Detail* and *Reject* reports (call EFS 888-824-7378 / account manager if the option isn't
   visible). This is the one external dependency.
2. **Report contents must match today's export** (same columns) so `detectReportKind` classifies it and the
   column mapping holds — schedule the *same* report you export by hand now.
3. **Dedicated delivery channel** (an `efs-feed@…` inbox or SFTP path) provisioned and its creds in env.

## Not doing now (deferred)
- Official EFS **Data Feed** partner onboarding (near-real-time, format-stable). Worth pursuing later; if
  granted, it's a new `IngestSource` implementation only — Chunks 1, 3, 4, 5 are unchanged.
- WEX Developer Portal API — EFS uses a separate integration path; unlikely to be the fast route.
