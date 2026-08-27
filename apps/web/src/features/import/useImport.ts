import { useMutation, useQueryClient } from "@tanstack/vue-query";
import {
  detectReportKind,
  normalizeTransactionRows,
  normalizeAllTransactionLines,
  normalizeRejectRows,
  reconcileFuelLines,
  type RawRow,
  type ReportKind,
  type ReconciledFuelLine,
  type ParsedDeclined,
  type EfsTransactionLine,
  type Vehicle,
  type Driver,
} from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";
import { apiFetch } from "@/lib/api";
import { readFile } from "@/lib/readFile";

export interface ImportPreview {
  kind: ReportKind;
  source: "xlsx" | "csv";
  filename: string;
  totalRows: number;
  fileHash: string;
  /** Raw parsed file content — the COMMIT payload. The server re-runs the shared parser and the full
   *  identity dedup (P0-1); everything else on this preview is display-only. */
  headers: string[];
  rows: RawRow[];
  alreadyImported: boolean; // true if this exact file was committed before
  // transaction
  allLines: EfsTransactionLine[]; // faithful, every line (preview + system of record)
  newFuel: ReconciledFuelLine[]; // derived fuel events for scoring
  duplicateFuelCount: number;
  /** Faithful EFS lines already present from an earlier import (won't be re-inserted). */
  duplicateEfsCount: number;
  unattributedCount: number;
  skippedCount: number;
  // reject
  newDeclined: ParsedDeclined[];
  duplicateDeclinedCount: number;
  // the period the file covers (YYYY-MM-DD), for at-a-glance validation
  reportFrom: string | null;
  reportTo: string | null;
  /** Rows per business day in the FILE — persisted so silent data loss is detectable after commit. */
  rowsByDay: Record<string, number>;
}

/** Per-day row counts (business date) — the reconciliation fingerprint of a report file. */
function countByDay(dates: (string | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of dates) {
    if (!d) continue;
    const day = d.slice(0, 10);
    out[day] = (out[day] ?? 0) + 1;
  }
  return out;
}

/** Min/max date (YYYY-MM-DD) across a set of ISO timestamps. */
function dateSpan(isos: (string | null)[]): { from: string | null; to: string | null } {
  const days = isos.filter((d): d is string => !!d).map((d) => d.slice(0, 10)).sort();
  return { from: days[0] ?? null, to: days[days.length - 1] ?? null };
}

/** SHA-256 hex digest of the file contents using the Web Crypto API. */
async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function existingRefs(table: string, refs: string[]): Promise<Set<string>> {
  // Query in batches: a month of data can be thousands of refs, and a single .in() would blow past the
  // request URL limit and silently return nothing (making every row look "new" in the preview).
  // 150/chunk (was 200): refs grew ~11 chars each when they became date-scoped — keep URL headroom.
  const found = new Set<string>();
  const CHUNK = 150;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const slice = refs.slice(i, i + CHUNK);
    const { data, error } = await supabase.from(table).select("external_ref").in("external_ref", slice);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) found.add((r as { external_ref: string }).external_ref);
  }
  return found;
}

/** Read + classify + reconcile + dedup a file into a review preview (no writes). */
export async function analyzeImport(
  file: File,
  vehicles: Vehicle[],
  drivers: Driver[],
): Promise<ImportPreview> {
  const [{ headers, rows }, fileHash] = await Promise.all([readFile(file), hashFile(file)]);
  const kind = detectReportKind(headers);
  const source: "xlsx" | "csv" = file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";

  // Check whether this exact file was already imported (by SHA-256 hash).
  // Gracefully degrade if migration 0017 (file_hash column) has not been applied yet.
  let alreadyImported = false;
  try {
    const { data: existing } = await supabase
      .from("imports")
      .select("id")
      .eq("file_hash", fileHash)
      .limit(1);
    alreadyImported = (existing ?? []).length > 0;
  } catch {
    // file_hash column not yet in schema — treat as not-yet-imported
  }

  const base = {
    kind,
    source,
    filename: file.name,
    totalRows: rows.length,
    fileHash,
    headers,
    rows,
    alreadyImported,
    allLines: [] as EfsTransactionLine[],
    newFuel: [] as ReconciledFuelLine[],
    duplicateFuelCount: 0,
    duplicateEfsCount: 0,
    unattributedCount: 0,
    skippedCount: 0,
    newDeclined: [] as ParsedDeclined[],
    duplicateDeclinedCount: 0,
    reportFrom: null as string | null,
    reportTo: null as string | null,
    rowsByDay: {} as Record<string, number>,
  };

  if (kind === "transaction") {
    const allLines = normalizeAllTransactionLines(rows); // faithful, every column/row
    const { fuelLines, skipped } = normalizeTransactionRows(rows);
    const reconciled = reconcileFuelLines(fuelLines, vehicles, drivers);
    const [seen, efsSeen] = await Promise.all([
      existingRefs("fuel_transactions", reconciled.map((l) => l.external_ref)),
      existingRefs("efs_transactions", allLines.map((l) => l.external_ref)),
    ]);
    const newFuel = reconciled.filter((l) => !seen.has(l.external_ref));
    // Business dates (as printed on the report), not UTC dates of the instants — an evening local
    // fill crosses the UTC boundary and would otherwise show the wrong covered period.
    const span = dateSpan(allLines.map((l) => l.tran_date));
    return {
      ...base,
      allLines,
      newFuel,
      duplicateFuelCount: reconciled.length - newFuel.length,
      duplicateEfsCount: allLines.filter((l) => efsSeen.has(l.external_ref)).length,
      unattributedCount: newFuel.filter((l) => l.vehicle_id == null).length,
      skippedCount: skipped.length,
      reportFrom: span.from,
      reportTo: span.to,
      rowsByDay: countByDay(allLines.map((l) => l.tran_date)),
    };
  }

  if (kind === "reject") {
    const { declined, skipped } = normalizeRejectRows(rows);
    const seen = await existingRefs("declined_transactions", declined.map((d) => d.external_ref));
    const newDeclined = declined.filter((d) => !seen.has(d.external_ref));
    const span = dateSpan(declined.map((d) => d.declined_at));
    return {
      ...base,
      newDeclined,
      duplicateDeclinedCount: declined.length - newDeclined.length,
      skippedCount: skipped.length,
      reportFrom: span.from,
      reportTo: span.to,
      rowsByDay: countByDay(declined.map((d) => d.declined_at)),
    };
  }

  return base;
}

/** Result of a commit: how many expected-new rows did NOT land (null = could not verify). */
export interface CommitResult {
  shortfallRows: number | null;
}

/**
 * Commit a reviewed preview — P0-1 (2026-08 audit): the browser no longer writes
 * fuel_transactions/efs_transactions itself. It POSTs the raw rows to the server, which runs the SAME
 * ingestReport pipeline as the email/SOAP channels: file-hash idempotency, external_ref dedup, the
 * cross-channel transaction-id identity split AND the content-identity backstop (the guards the old
 * client-side upsert bypassed — the twin-minting class of the duplication incident), the faithful
 * store, declines, background scoring, and the post-commit shortfall reconciliation.
 */
export function useCommitImport() {
  const qc = useQueryClient();
  const session = useSessionStore();
  return useMutation({
    mutationFn: async (preview: ImportPreview): Promise<CommitResult> => {
      if (!session.orgId) throw new Error("No organization in session");
      const res = await apiFetch<{ shortfallRows: number | null; alreadyImported: boolean }>(
        "/api/transactions/import-report",
        {
          method: "POST",
          body: {
            filename: preview.filename,
            source: preview.source,
            fileHash: preview.fileHash,
            headers: preview.headers,
            rows: preview.rows,
          },
        },
      );
      if (!res.ok) {
        throw new Error(
          res.status === 409
            ? "An import or scoring run is already in progress for your organization — try again when it finishes."
            : (res.error?.message ?? "Import failed"),
        );
      }
      return { shortfallRows: res.data?.shortfallRows ?? null };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["efs_transactions"] });
      qc.invalidateQueries({ queryKey: ["fuel_transactions"] });
      qc.invalidateQueries({ queryKey: ["declined_transactions"] });
      qc.invalidateQueries({ queryKey: ["imports"] });
    },
  });
}
