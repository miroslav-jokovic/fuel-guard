import { type Ref } from "vue";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/vue-query";
import {
  LUMPER_FILE_MAX_BYTES,
  LUMPER_FILE_TYPES,
  type LumperCaseClose,
  type LumperCasesResponse,
  type LumperFileMime,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { sha256Hex } from "@/composables/useCompliance";

/**
 * The lumper cases page's reads and acts (LUMPER-REVISED-RC-PLAN LRC3) against `/api/lumper-cases`.
 * The state of a case arrives worked out by the API from the one shared rule; nothing here decides it.
 */
const KEY = ["lumper-cases"] as const;

export function useLumperCasesQuery(scope: Ref<"open" | "all">) {
  return useQuery({
    queryKey: [...KEY, scope] as const,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<LumperCasesResponse> => {
      const r = await apiFetch<LumperCasesResponse>(`/api/lumper-cases?scope=${scope.value}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the lumper fees");
      return r.data;
    },
  });
}

/** Which kind of file this is, from its name; null for anything a revised RC cannot be filed as. */
export function lumperFileMimeOf(fileName: string): LumperFileMime | null {
  const lower = fileName.toLowerCase();
  for (const [mime, kind] of Object.entries(LUMPER_FILE_TYPES)) {
    if (kind.extensions.some((ext) => lower.endsWith(ext))) return mime as LumperFileMime;
  }
  return null;
}

/** Why a picked file cannot be filed, in words for the person; null when it can. */
export function lumperFileRefusal(file: Pick<File, "name" | "size">): string | null {
  if (!lumperFileMimeOf(file.name)) return `${file.name} is not a PDF, JPEG or PNG. Save the broker's email as a PDF and file that.`;
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > LUMPER_FILE_MAX_BYTES) return `${file.name} is larger than 25 MB.`;
  return null;
}

export const LUMPER_FILE_ACCEPT = Object.values(LUMPER_FILE_TYPES).flatMap((k) => k.extensions).join(",");

export interface PutBytes { (url: string, file: File, mime: string): Promise<void> }
const putBytes: PutBytes = async (url, file, mime) => {
  const res = await fetch(url, { method: "PUT", headers: { "content-type": mime }, body: file });
  if (!res.ok) throw new Error("The file did not finish uploading.");
};

/**
 * File the revised RC: ask for a place, send the bytes there, then tell the API what was sent. The
 * API reads the stored bytes back and files the paper only if they match, so the case never says
 * "RC on file" for an upload that broke half-way.
 */
export function useFileRevisedRc(put: PutBytes = putBytes) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ caseId, file }: { caseId: string; file: File }): Promise<void> => {
      const refusal = lumperFileRefusal(file);
      if (refusal) throw new Error(refusal);
      const mime = lumperFileMimeOf(file.name)!;
      const sha256 = await sha256Hex(await file.arrayBuffer());
      const place = await apiFetch<{ file_id: string; upload_url: string }>(`/api/lumper-cases/${caseId}/files/upload`, { method: "POST", body: {} });
      if (!place.ok || !place.data) throw new Error(place.error?.message ?? "The file could not be started.");
      await put(place.data.upload_url, file, mime);
      const filed = await apiFetch(`/api/lumper-cases/${caseId}/files`, {
        method: "POST",
        body: { file_id: place.data.file_id, file_name: file.name, mime, byte_size: file.size, sha256 },
      });
      if (!filed.ok) throw new Error(filed.error?.message ?? "The file could not be filed on the case.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

function act<V>(path: (v: V) => string, body: (v: V) => object, failure: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: V): Promise<void> => {
      const r = await apiFetch(path(v), { method: "POST", body: body(v) });
      if (!r.ok) throw new Error(r.error?.message ?? failure);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export const useRemoveRevisedRc = () =>
  act<{ fileId: string; reason: string }>((v) => `/api/lumper-cases/files/${v.fileId}/remove`, (v) => ({ reason: v.reason }), "The file could not be removed.");
export const useCloseLumperCase = () =>
  act<{ caseId: string } & LumperCaseClose>((v) => `/api/lumper-cases/${v.caseId}/close`, (v) => ({ reason: v.reason, note: v.note }), "The case could not be closed.");
export const useReopenLumperCase = () =>
  act<{ caseId: string }>((v) => `/api/lumper-cases/${v.caseId}/reopen`, () => ({}), "The case could not be reopened.");

/** A five-minute link to a filed paper, opened in a new tab. */
export async function openRevisedRc(fileId: string): Promise<void> {
  const r = await apiFetch<{ url: string }>(`/api/lumper-cases/files/${fileId}/link`);
  if (!r.ok || !r.data) throw new Error(r.error?.message ?? "The file could not be opened.");
  window.open(r.data.url, "_blank", "noopener");
}
