import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  DOCUMENTS_BUCKET,
  DOCUMENT_CONTENT_TYPES,
  type AuthorizationMethod,
  type AuthorizationPurpose,
  type DocumentContentType,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { sha256Hex } from "@/composables/useCompliance";
import { applicantChecklistKey } from "@/features/recruitment/useApplicantChecklist";

/**
 * The releases an applicant signed, for the office to read (B6, Q-HUI6).
 *
 * ── WHY THIS DID NOT EXIST UNTIL NOW ──────────────────────────────────────────────────────────
 * ⚠ `GET /api/recruitment/drivers/:driverId/authorizations` has existed since the authorizations
 * module shipped and **no screen in the office's half of the product ever called it**. B5 found it
 * the way a gap of this kind is usually found — it was the one artifact on the hiring checklist
 * with nowhere to go — and recorded it as Q-HUI6 rather than pointing the row at a page that shows
 * something else. This is the reader that closes it.
 *
 * It matters more than "a list is nice to have": the five releases are what make the MVR, the PSP
 * order and the previous-employer inquiries lawful (`SCREENING_PREREQUISITES`), and the FCRA
 * disclosure's **version** is the fact that decides a dispute about what somebody was shown. A
 * carrier relying on a release it cannot display is relying on something it cannot produce.
 */

/** One signed release, as the route returns it. `AUTH_COLS` in `routes/authorizations.ts` owns this. */
export interface AuthorizationDetail {
  id: string;
  driver_id: string;
  purpose: string;
  disclosure_version: string;
  disclosure_text: string;
  method: AuthorizationMethod;
  signed_name: string | null;
  intent_statement: string | null;
  esign_consent_at: string | null;
  accepted_at: string;
  evidence_document_id: string | null;
  /** The id of the grant this row revokes. Append-only: a revocation is a new row (D-REC3). */
  revokes: string | null;
  revoke_reason: string | null;
  created_at: string;
}

export const authorizationsKey = (driverId: string) =>
  ["recruitment", "authorizations", driverId] as const;

export function useAuthorizationsQuery(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => authorizationsKey(driverId.value)),
    enabled: computed(() => Boolean(driverId.value)),
    queryFn: async (): Promise<AuthorizationDetail[]> => {
      // ⚠ This route answers `{ authorizations }` with no `ok` flag, unlike its neighbours. That is
      // the route's shape, not a mistake to correct here — `apiFetch` reports transport success and
      // the body is read as it comes.
      const res = await apiFetch<{ authorizations: AuthorizationDetail[] }>(
        `/api/recruitment/drivers/${encodeURIComponent(driverId.value)}/authorizations`,
      );
      if (!res.ok || !res.data) {
        throw new Error(res.error?.message ?? "Could not load the signed releases.");
      }
      return res.data.authorizations;
    },
  });
}

export interface PaperAuthorizationInput {
  driverId: string;
  purpose: AuthorizationPurpose;
  /** The name as the driver wrote it on the paper. */
  signedName: string;
  /** The scan of the signed page — required: a paper signature is only as good as the paper (MV3). */
  file: File;
}

/**
 * Record a permission the driver signed on paper (MV3, D-MVR2).
 *
 * Register, upload, then file — `useRecordHiringAct`'s order and its reason: a scan in the bucket
 * that no row points at is an orphan the reconciler sweeps; a row citing bytes that never arrived is
 * a citation to nothing. The server composes the wording from the carrier's live text, exactly as it
 * does for the link, so a paper signature and an electronic one on the same instrument carry the
 * same words and version.
 */
export function useRecordPaperAuthorization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PaperAuthorizationInput): Promise<void> => {
      const contentType = input.file.type as DocumentContentType;
      if (!(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(contentType)) {
        throw new Error("Upload a PDF or an image (JPEG, PNG, WebP or HEIC).");
      }
      const bytes = await input.file.arrayBuffer();
      const registered = await apiFetch<{ documentId: string; token: string; storagePath: string }>(
        `/api/recruitment/drivers/${encodeURIComponent(input.driverId)}/authorizations/document`,
        {
          method: "POST",
          body: {
            document_id: crypto.randomUUID(),
            sha256: await sha256Hex(bytes),
            bytes: input.file.size,
            content_type: contentType,
          },
        },
      );
      if (!registered.ok || !registered.data) {
        throw new Error(registered.error?.message ?? "Could not register the scan.");
      }
      const { error } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .uploadToSignedUrl(registered.data.storagePath, registered.data.token, input.file, { contentType });
      // A 409 means the object is already there — a retry of an upload that in fact succeeded.
      if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(error.message);

      const filed = await apiFetch("/api/recruitment/authorizations", {
        method: "POST",
        body: {
          driver_id: input.driverId,
          purpose: input.purpose,
          method: "wet_signature",
          signed_name: input.signedName,
          evidence_document_id: registered.data.documentId,
        },
      });
      if (!filed.ok) throw new Error(filed.error?.message ?? "Could not record the paper signature.");
    },
    onSuccess: (_r, input) => {
      void qc.invalidateQueries({ queryKey: authorizationsKey(input.driverId) });
      void qc.invalidateQueries({ queryKey: applicantChecklistKey(input.driverId) });
    },
  });
}
