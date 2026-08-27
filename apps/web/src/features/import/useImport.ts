import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type {
  RawRow,
  ReportKind,
  ReconciledFuelLine,
  ParsedDeclined,
  EfsTransactionLine,
} from "@silvicom/shared";
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
  previewLines: EfsTransactionLine[]; // first rows of the faithful parse, for the review table
  allLinesCount: number;
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

/** SHA-256 hex digest of the file contents using the Web Crypto API. */
async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Read a report file into a review preview — P1.9 (D-SEP11, 2026-08-27): the browser decodes the
 * container and asks; the efs collector parses and answers. Until this step the browser ran the
 * EFS report parsers itself and probed duplicates straight over PostgREST with a variable table
 * name — the one dynamic `.from()` in the codebase, invisible to every table gate. No writes:
 * nothing lands until the reviewed preview is committed via /import-report.
 */
export async function analyzeImport(file: File): Promise<ImportPreview> {
  const [{ headers, rows }, fileHash] = await Promise.all([readFile(file), hashFile(file)]);
  const source: "xlsx" | "csv" = file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";

  const res = await apiFetch<Omit<ImportPreview, "source" | "filename" | "totalRows" | "fileHash" | "headers" | "rows">>(
    "/api/transactions/import-preview",
    { method: "POST", body: { fileHash, headers, rows } },
  );
  if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not analyze the report");

  return {
    ...res.data,
    source,
    filename: file.name,
    totalRows: rows.length,
    fileHash,
    headers,
    rows,
  };
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
