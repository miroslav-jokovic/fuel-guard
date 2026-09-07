-- 0326 — Phase 4a of SCANNER-UPGRADE-PLAN.md: the columns the original of record needs, and NOTHING
-- that reads them.
--
-- ── WHY THESE COLUMNS ──────────────────────────────────────────────────────────────────────────
-- D-SCAN6 (audit finding F1, 2026-09-06): `originalOfRecord` on a `CapturedPage` is today a 1568 px
-- JPEG q80 derivative, and all four of the page's image fields alias ONE object — so the integrity
-- hash covers a re-encode rather than the bytes the OS scanner produced. D-SCAN11 splits that into
-- three outputs: ORIGINAL (untouched, evidentiary), ARCHIVE (human-readable) and MACHINE (what
-- extraction reads, never stored). `storage_path` + `sha256` (0092) keep meaning the ORIGINAL;
-- `archive_storage_path` is the second object. MACHINE is computed and discarded, so it gets no
-- column.
--
-- `original_bytes` / `archive_bytes` exist so the storage cost of a three-output capture is
-- MEASURABLE rather than discovered on an invoice — the plan's §7 risk register names that risk and
-- names these two columns as its mitigation. `capture_metrics` is where Step 5.1's shadow-mode
-- telemetry lands (device class, timings, and every metric score) so that Step 5.2 can derive a
-- threshold from a distribution instead of inventing one; jsonb, and NOT a new table, because it is
-- one document's provenance and it must not create a second RLS surface.
--
-- ── ⚠ ONE COLUMN THE PLAN ASKED FOR IS DELIBERATELY NOT HERE: `analysis_config_version` ─────────
-- §4 Step 4a lists five columns; this migration adds four. The plan was written on 2026-09-06,
-- before D-SCAN1's analysis scale had a home, and it reads as though the scale might be versioned
-- separately from the gate. It is not: `analysis.longEdgePx` is a FIELD of `CaptureConfig`
-- (`packages/capture-engine/src/config.ts`), versioned by that object's single `configVersion`, and
-- `registerDocument` already writes that exact string to `capture_config_version` (0133) from
-- `req.capture.configVersion`. An `analysis_config_version` column would therefore be equal to
-- `capture_config_version` on every row it was ever written to — a copy, which root CLAUDE.md's
-- register calls a workaround with a delay fuse, and which on an evidence table is worse than
-- redundant: two version columns are two answers to "which config produced this number", and a
-- verdict read against the wrong one is unreproducible in the way the column was meant to prevent.
-- The server's own gate version is likewise already recorded, as `usabilityGateVersion` on
-- `hazmat_runs.models` (`orchestrate.ts`), so there is no second meaning waiting for this column
-- either. If the analysis scale is ever versioned independently of the gate, that is a new fact and
-- it earns its own migration ahead of its own reader. Recorded in the plan's §8 log, not only here.
--
-- ── WHY IT IS ADDITIVE, NULLABLE, AND HAS NO BACKFILL ──────────────────────────────────────────
-- On 0133's model. `hazmat_documents` is INSERT-ONLY evidence, and `registerDocument` writes it with
-- `.upsert(row, { onConflict: "id", ignoreDuplicates: true })` — Postgres evaluates NOT NULL before
-- conflict arbitration, which is what `lint:upserts` exists for, so a NOT NULL column here would
-- reject an idempotent replay. Every row that exists today was captured before three outputs did,
-- and no derivative can be reconstructed from a derivative: NULL is the honest value and there is no
-- backfill. Both storage paths are computed at REGISTRATION (D-SCAN11), so nothing ever UPDATEs an
-- evidence row to fill these in later.
--
-- ── RLS ────────────────────────────────────────────────────────────────────────────────────────
-- Unchanged. 0092 already scopes `hazmat_documents` by org, restricts drivers to their own loads,
-- and makes the table immutable; 0293/0300 carry the manager-insert policy. Adding columns to a
-- table whose policies are row-level changes nothing about who may see it.
--
-- ── ⚠ TWO THINGS PHASE 4b MUST DO, DISCOVERED WHILE WRITING THIS AND RECORDED WHERE IT WILL BE ──
-- ── READ RATHER THAN IN A CHAT ─────────────────────────────────────────────────────────────────
-- `storageReconcileScheduler.ts` sweeps the `hazmat` bucket nightly with `apply: true`, and
-- `reconcileBucketOrphans` selects exactly one column — `storage_path`. So:
--
--   1. An ARCHIVE object whose path lives only in `archive_storage_path` is an object with no row
--      pointing at it. Twenty-four hours after it uploads, the sweep DELETES it. Phase 4b must add
--      `archive_storage_path` to that reconciler's row-path set in the same merge that starts
--      writing the column, or the archive is evidence with a one-day life.
--   2. D-SCAN11 defers the ORIGINAL's upload to an unmetered connection, so between registration and
--      the driver reaching Wi-Fi, `storage_path` names an object that does not exist yet. That is
--      the sweep's `missingObjects` case, which is FLAGGED as "possible evidence loss / restore gap
--      — D13" and never deleted. Nothing breaks, but a nightly warning that is routine is a signal
--      nobody reads, so 4b owes that reconciler a way to tell "not uploaded yet" from "gone".
--
-- Neither is fixable here: this migration ships with no reader by design (§3.2 — a merge is served
-- ~2m44s before its migration is applied, so a column and its first reader ship in two merges, and
-- `lint:migration-ordering` enforces it).
--
-- Safe to apply after 0325.

alter table public.hazmat_documents
  add column if not exists archive_storage_path    text,
  add column if not exists original_bytes          int,
  add column if not exists archive_bytes           int,
  add column if not exists capture_metrics         jsonb;

-- A byte count is a size, and a negative size is a bug that has already happened somewhere upstream.
-- NULL stays allowed: it means "not recorded", which every pre-Phase-4 row is.
alter table public.hazmat_documents
  drop constraint if exists hazmat_documents_output_bytes_chk;
alter table public.hazmat_documents
  add constraint hazmat_documents_output_bytes_chk
  check ((original_bytes is null or original_bytes >= 0) and (archive_bytes is null or archive_bytes >= 0));

comment on column public.hazmat_documents.archive_storage_path is
  'D-SCAN11: bucket ''hazmat'' key for the ARCHIVE derivative (human-readable, colour preserved, never binarised). `storage_path` remains the ORIGINAL of record. NULL for every row captured before Phase 4.';
comment on column public.hazmat_documents.original_bytes is
  'D-SCAN11: size of the untouched original. Exists so three outputs per page is a measured storage cost, not a discovered one (plan §7 risk register).';
comment on column public.hazmat_documents.archive_bytes is
  'D-SCAN11: size of the ARCHIVE derivative. Pairs with original_bytes; MACHINE is computed for extraction and never stored, so it has no column.';
comment on column public.hazmat_documents.capture_metrics is
  'D-SCAN10 / plan Step 5.1: shadow-mode capture telemetry — device class, OS version, capture and processing timings, and every measured metric score. Device class and timings only; nothing about the person. Which signed config produced these numbers is capture_config_version (0133) — the analysis scale is a field of that same CaptureConfig, so it is not recorded twice. Step 5.2 derives each threshold from this distribution.';
