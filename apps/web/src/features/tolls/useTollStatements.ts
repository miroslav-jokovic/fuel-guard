import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  TOLL_STATEMENT_MAX_BYTES,
  tollStatementFormatOf,
  type TollProvider,
  type TollStatementDto,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { sha256Hex } from "@/composables/useCompliance";

/**
 * The Tolls page's reads and acts against `/api/tolls/statements` (TOLLS-PER-TRUCK-PLAN.md TL4a).
 *
 * An upload is three steps, as a lumper RC's is: ask for a place, put the bytes there, then tell the
 * API what was sent. The API reads the stored bytes back and keeps the statement only if they are the
 * file picked, so the list never shows a statement whose upload broke half-way.
 */
const KEY = ["toll-statements"] as const;

export function useTollStatementsQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<TollStatementDto[]> => {
      const r = await apiFetch<{ statements: TollStatementDto[] }>("/api/tolls/statements");
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the toll statements.");
      return r.data.statements;
    },
  });
}

/**
 * Why a picked file cannot be a statement, in words for the person; null when it may be sent. The
 * format is read from the first bytes, the way the API reads it (D-TL5), so a photo named `.pdf` is
 * turned away here instead of after its upload.
 */
export async function tollStatementRefusal(file: File): Promise<string | null> {
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > TOLL_STATEMENT_MAX_BYTES) return `${file.name} is larger than 25 MB.`;
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  if (!tollStatementFormatOf(head)) return `${file.name} is not a PDF, spreadsheet or CSV inside, whatever its name says.`;
  return null;
}

export interface PutBytes { (url: string, file: File): Promise<void> }
const putBytes: PutBytes = async (url, file) => {
  const res = await fetch(url, { method: "PUT", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
  if (!res.ok) throw new Error(`${file.name} did not finish uploading. Try it again.`);
};

/** The API refused the file for a reason the person can act on (a copy already kept, wrong bytes). */
export class TollStatementRefused extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "TollStatementRefused";
  }
}

export function useUploadTollStatement(put: PutBytes = putBytes) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ provider, file }: { provider: TollProvider; file: File }): Promise<TollStatementDto> => {
      const refusal = await tollStatementRefusal(file);
      if (refusal) throw new TollStatementRefused(refusal, "not_a_statement");
      const sha256 = await sha256Hex(await file.arrayBuffer());
      const place = await apiFetch<{ fileId: string; uploadUrl: string }>("/api/tolls/statements/upload", {
        method: "POST",
        body: { provider, fileName: file.name, byteSize: file.size },
      });
      if (!place.ok || !place.data) throw new Error(place.error?.message ?? `${file.name} could not be started.`);
      await put(place.data.uploadUrl, file);
      const kept = await apiFetch<{ statement: TollStatementDto }>("/api/tolls/statements", {
        method: "POST",
        body: { fileId: place.data.fileId, provider, fileName: file.name, byteSize: file.size, sha256 },
      });
      if (!kept.ok || !kept.data) {
        if (kept.error?.code) throw new TollStatementRefused(kept.error.message ?? `${file.name} was not kept.`, kept.error.code);
        throw new Error(kept.error?.message ?? `${file.name} was not kept.`);
      }
      return kept.data.statement;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRemoveTollStatement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }): Promise<void> => {
      const r = await apiFetch(`/api/tolls/statements/${id}/remove`, { method: "POST", body: { reason } });
      if (!r.ok) throw new Error(r.error?.message ?? "The statement could not be removed.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** A five-minute link to the file as uploaded, opened in a new tab. */
export async function openTollStatement(id: string): Promise<void> {
  const r = await apiFetch<{ url: string }>(`/api/tolls/statements/${id}/link`);
  if (!r.ok || !r.data) throw new Error(r.error?.message ?? "The file could not be opened.");
  window.open(r.data.url, "_blank", "noopener");
}
