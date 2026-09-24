import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { AuthorizationMethod } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

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
