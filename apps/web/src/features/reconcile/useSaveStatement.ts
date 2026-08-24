/**
 * Save a parsed weekly statement so the trend outlives the upload.
 *
 * The browser sends the positioned WORDS and the original bytes, never its own conclusions: the server
 * re-parses and refuses anything that cannot reproduce the totals Pilot printed (D-FR3). So a rejection
 * here is not a transport failure — it means the file did not add up — and its reasons are surfaced
 * verbatim rather than flattened into "save failed".
 */
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { StatementWord } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";

export interface SaveStatementResult {
  ok: boolean;
  statementId?: string;
  invoiceNo?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  lines?: number;
  fills?: number;
  supersededStatementId?: string;
  unresolvedSites?: string[];
  sourceStored?: boolean;
}

/** Base64 without blowing the call stack on a ~370 KB statement (`String.fromCharCode(...bytes)` does). */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export class StatementRejected extends Error {
  constructor(message: string, readonly reasons: string[]) {
    super(message);
    this.name = "StatementRejected";
  }
}

export function useSaveStatement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { words: StatementWord[]; bytes: ArrayBuffer; filename: string }): Promise<SaveStatementResult> => {
      const res = await apiFetch<SaveStatementResult>("/api/fueling/statements", {
        method: "POST",
        body: { words: input.words, filename: input.filename, sourceBase64: toBase64(input.bytes) },
      });
      if (!res.ok || !res.data) {
        // `detail` is the full error body — the API returns the tie-out reasons beside `error`
        // precisely so the person holding the PDF is told which number disagreed, not just "rejected".
        const reasons = Array.isArray(res.detail?.tieOutFailures) ? (res.detail.tieOutFailures as string[]) : [];
        throw new StatementRejected(res.error?.message ?? "Could not save the statement", reasons);
      }
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fuel_statements"] }),
  });
}
