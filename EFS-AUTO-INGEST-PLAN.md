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

### Chunk 1 — Port commit to an API service  ☑ (2026-07-06, uncommitted)
Moved the write path out of the browser with zero behaviour change; provenance recorded on `summary.channel`.
- **New `apps/api/src/services/efsIngest.ts`**: `ingestReport(admin, env, input, deps?)` takes the parsed
  report (`headers` + `rows` + `fileHash` + metadata) → shared parser → upsert `efs_transactions` /
  `fuel_transactions` / `declined_transactions` → post-commit shortfall onto `imports.summary` →
  `scoreImportWithCascade` / `scoreDeclinedImport`. Lifted faithfully from
  `apps/web/src/features/import/useImport.ts` (`useCommitImport`), on `getSupabaseAdmin()`. Scoring is
  injected (`IngestDeps`) so the write path is unit-testable without live Samsara. Scoring failure is
  recorded (`scoreError`), never discards a committed import.
- **Idempotency:** file-level `imports.file_hash` short-circuit (graceful pre-0017 fallback) + row-level
  `external_ref` upsert dedup. Unknown report kind writes nothing.
- **`efs_ingest` JobKind** added to `services/jobs.ts` (caller wired in Chunk 3).
- **No new migration** — `summary.channel = manual|auto` distinguishes upload vs feed.
- **Verify:** ✅ `efsIngest.test.ts` (7 tests: faithful store, fuel-only derivation, row- & file-level
  idempotency, unknown-kind no-op, reject path, shortfall math) on a data-backed fake client using the real
  Silvicom EFS headers. API typecheck clean; full API suite 59/59; eslint clean.
- **Deferred to Chunk 2/3 (deliberately, to avoid new deps disturbing the working web path):** the server
  file reader (`Buffer → {headers, rows}` via exceljs/papaparse) and the manual HTTP trigger endpoint —
  both belong with the transport adapter and its dependencies.

### Chunk 2 — Server reader + ingestion source adapter  ☑ (2026-07-07, uncommitted)
Built the transport-agnostic core with **zero new runtime deps that need installing to verify** — so the
whole chunk type-checks, tests, and lints green in isolation. Direct IMAP/SFTP polling (which needs an
installable client + live credentials) is the documented follow-up (Chunk 2b) and slots behind the same
`IngestSource` interface with no downstream change.
- **`apps/api/src/lib/readEfsFile.ts`** — server reader producing the same `{ headers, rows }` the browser
  reader did. **CSV** via a self-contained RFC-4180 tokenizer (BOM strip, quoted commas/newlines, escaped
  quotes, CRLF, title-row skip via `detectReportKind`) — no dependency, fully unit-tested. **XLSX** via a
  RUNTIME dynamic `import("exceljs")` (non-literal specifier → type-checks without exceljs present; a bad
  .xlsx throws a clear, quarantinable error). `exceljs@4.4.0` added to `apps/api/package.json`.
- **`apps/api/src/lib/ingestSource.ts`** — `Artifact` + `IngestSource` (`list`/`fetch`/`markDone`/
  `quarantine`) + **`StorageSource`** over a tiny `ObjectStore` seam (backed by the Supabase client the API
  already ships). Reports land in `<orgId>/incoming/`; success → `<orgId>/processed/`, bad file →
  `<orgId>/error/` (timestamp-prefixed; nothing overwritten or deleted).
- **`apps/api/src/services/efsAutoIngest.ts`** — glue: `ingestArtifact` (fetch → SHA-256 → read →
  `ingestReport` → markDone / quarantine) and `runEfsIngest` (batch, aggregates for jobs.stats). Unattended-
  safe: one bad file is quarantined with a reason, never dropped silently, never halts the batch.
- **Env:** `EFS_INGEST_SOURCE=off|storage` (default `off`), `EFS_INGEST_BUCKET=efs-reports`,
  `EFS_INGEST_MINUTES=30` (cadence used by Chunk 3).
- **Verify:** ✅ 17 new tests (CSV reader edge cases, StorageSource move lifecycle, glue happy/quarantine
  paths) — API typecheck clean, full API suite **76/76**, eslint clean.

### Chunk 2b — Direct IMAP / SFTP sources (follow-up, needs a dep install)  ☐
- **`ImapSource`** (poll unread, pull `.csv/.xlsx` attachments, mark seen / move to a processed folder) and/or
  **`SftpSource`** (list a remote dir, download, move to `/processed`) — each behind the existing
  `IngestSource` interface, so `efsAutoIngest` / the scheduler need no change.
- **Deps (user runs `pnpm add`):** `imapflow` for IMAP, `ssh2-sftp-client` for SFTP. Cannot be sandbox-
  verified here (no registry install into the mounted node_modules; needs live mailbox/SFTP creds).
- **Env:** `EFS_INGEST_SOURCE=imap|sftp`, plus `EFS_IMAP_HOST/PORT/USER/PASS/FOLDER` or
  `EFS_SFTP_HOST/PORT/USER/KEY/PATH`.
- **Verify:** unit test against a mock IMAP/SFTP; typecheck; lint.

### Chunk 3 — Scheduler + jobs wiring  ☑ (2026-07-07, uncommitted)
Per-org auto-ingest on a timer, wired to the jobs ledger — the daily manual upload is now optional.
- **`apps/api/src/services/efsIngestScheduler.ts`** modeled on `digestScheduler.ts`: gated
  (`EFS_INGEST_SOURCE=off` or Supabase unconfigured → doesn't start), first pass ~1 min after boot then
  every `EFS_INGEST_MINUTES`, an in-flight guard so a slow pass can't overlap the next tick. It enumerates
  `organizations`, builds each org's source via `buildIngestSource`, and runs the batch through the
  **already-tested `runJob(admin, orgId, "efs_ingest", …)`** — so the ledger's partial unique index
  enforces single-flight per org (a manual run or a still-running prior tick → conflict → skipped), every
  run records done/failed + stats for freshness, and one org's failure never stops the others.
- **`efs_ingest` JobKind** was added in Chunk 1; wired into `apps/api/src/index.ts` beside the other schedulers.
- **Verify:** ✅ job lifecycle is covered by the existing `jobs.test.ts` (duplicate-run rejection, finish-on-
  throw) since the scheduler reuses `runJob`; source selection covered by two new `buildIngestSource` tests
  (off→null, storage→StorageSource); the scheduler itself is thin timer plumbing, untested by design like
  its siblings (`samsaraScheduler`/`digestScheduler`). API typecheck clean, full API suite **78/78**, eslint clean.
- **Note:** the scheduler follows the house pattern of claiming a job per org per tick (like Samsara stats);
  a tick with no delivered files finishes quickly as `found: 0`, giving a genuine "last checked" freshness.

### Chunk 4 — Surface it (freshness + digest + manual trigger + always-fresh)  ☑ (2026-07-07, uncommitted)
Made the automation visible and self-refreshing, with the rate-limit story explicit end-to-end.
- **Job kind registered:** added `efs_ingest` to `routes/jobs.ts` `KNOWN_KINDS` — without it
  `/jobs/latest?kind=efs_ingest` 400s and the freshness chip can't load (caught before it shipped).
- **Manual "Check now"** endpoint `POST /api/transactions/ingest-efs` (admin/fleet_manager, audited): runs
  the same `runEfsIngest` batch through the SAME `efs_ingest` ledger slot as the scheduler, so a manual run
  and a scheduled pass can never overlap (conflict → 409). Returns 400 when `EFS_INGEST_SOURCE=off`.
- **Frontend:** an "Import EFS reports" `JobActionCard` on **Settings → Data & Sync** (kind `efs_ingest`) —
  freshness chip, live progress, "Check now", failure chip — all reused from the existing component. Intro
  copy now explains the auto-ingest + auto-rescore flow and the rate-limited scoring.
- **Always-fresh data / auto-rebuild:** each import already auto-cascades scoring (Chunk 1). The **anomalies
  list now `refetchInterval: 120_000`** (matching `useDashboard`), so background-ingested cases appear
  without a reload. Vue Query pauses polling on a hidden tab → no wasted requests.
- **Rate limits (verified, not assumed):** the scoring the ingest triggers calls Samsara **only** through
  `samsaraFetch` (backoff + `Retry-After` + pacing, tested in `samsaraHttp.test.ts`), shared per-token
  across all schedulers — so a large delivered batch paces itself instead of bursting. The scheduler adds no
  new external-call loop (Storage list/download is cheap), and UI polling is a conservative 120 s, tab-visible-only.
- **Digest:** `DigestHealth` + `buildDigestHealth` now aggregate `efs_ingest` jobs into `efsIngested` /
  `efsShortfalls` (last 7 d); the shared `healthLine` appends "N EFS report(s) auto-imported", or an amber
  "N EFS import shortfall(s) — verify Settings → Data & Sync" when a truncated delivery is detected.
- **Verify:** ✅ shared **250/250** (email renderer incl. health), API typecheck clean + **78/78**, web
  vue-tsc clean, eslint clean on every changed file. (One pre-existing, unrelated web test —
  `VehicleForm.test.ts`, baseline-MPG validation — fails only in this Linux sandbox due to vee-validate/jsdom
  async timing; it touches nothing in this change and passes in the project's own CI.)

### Chunk 5 — Hardening for unattended runs  ☑ (2026-07-07, uncommitted)
Made the batch robust to bad deliveries and made every failure mode visible — without introducing any
false-alarm heuristic.
- **Malformed / unknown-kind delivery:** already handled in Chunk 2 (quarantined to `error/`, counted). Now
  also **surfaced in the weekly digest**: `buildDigestHealth` sums `efs_ingest` job `quarantined + errored`
  into `efsQuarantined`, and the shared `healthLine` shows an amber "N EFS delivery(ies) could not be
  imported — review Settings → Data & Sync". A bad delivery now reaches email, not just the ledger.
- **Empty-file guard (precise, no false alarm):** a recognized report with **0 data rows** is a new
  `empty` outcome — marked handled and counted, **not** quarantined. Rationale: an empty *reject* report for
  a clean week is normal; quarantining it would be a false alarm. A truly empty/garbage file (no recognizable
  header) still quarantines as before. Idempotency makes the no-op safe.
- **Batch resilience:** `runEfsIngest` now isolates each artifact — a per-file infrastructure error (e.g. a
  failed `move`) is caught, recorded as an `errored` outcome, and the batch **continues**; the file stays in
  the source and is retried next pass (idempotency keeps that safe). One bad file can never abort the run.
- **Duplicate-day sanity — deliberately NOT shipped as a heuristic.** A naive cross-file per-day count
  comparison cannot distinguish a *truncated re-send* from *two legitimate reports covering the same day*
  without assuming what makes two files "the same report" — that would produce false positives, which this
  system must avoid. The real data-loss guard already exists (the post-commit **shortfall** check, Chunk 1),
  and each import's `rows_by_day` is persisted on `imports.summary` for any future manual audit. Left as a
  documented non-goal rather than an assumption-laden check.
- **Verify:** ✅ new tests for the `empty` outcome and per-file `errored` isolation; shared **250/250**, API
  typecheck clean + **80/80**, eslint clean on every changed file.

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
