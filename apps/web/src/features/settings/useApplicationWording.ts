import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { PublishWording, PublishableInstrument } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The carrier's own instrument wording — reading what is live, and publishing new text (0338).
 *
 * Everything goes through `/api/recruitment/wording`: `org_disclosures` ships RLS-on with zero
 * policies, so there is deliberately no PostgREST path. The API assigns the version, refuses a
 * 7001(c) consent missing any of its six statutory clauses, and audits every publish.
 */

const KEY = ["recruitment", "wording"] as const;

export interface WordingInstrumentView {
  instrument: PublishableInstrument;
  version: string;
  title: string;
  intent: string;
  /** The five authorizations. Null for the consent, which is published as clauses. */
  body: string | null;
  /** The consent's six statutory clauses. Null for the five authorizations. */
  clauses: Record<string, string> | null;
  published: boolean;
}

export interface WordingHistoryRow {
  instrument: PublishableInstrument;
  version: string;
  title: string;
  publishedAt: string;
  publishedBy: string | null;
}

export interface WordingView {
  instruments: WordingInstrumentView[];
  outstanding: PublishableInstrument[];
  /**
   * The one number the office can act on. ⚠ Until it is zero, nothing an applicant does works —
   * not sending the form, not signing anything, not a PSP order or an employer inquiry.
   */
  outstandingCount: number;
  history: WordingHistoryRow[];
}

export function useApplicationWordingQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<WordingView> => {
      const res = await apiFetch<WordingView>("/api/recruitment/wording");
      if (!res.ok) throw new Error(res.error?.message ?? "Could not load the wording.");
      return res.data!;
    },
  });
}

export function usePublishWording() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PublishWording): Promise<{ version: string }> => {
      // ⚠ `body` is the object, never a JSON string — `apiFetch` serialises it. A double-encoded
      // body is refused by express and surfaces as a generic 500 with no audit row.
      const res = await apiFetch<{ version: string }>("/api/recruitment/wording", {
        method: "POST",
        body: input,
      });
      if (!res.ok) throw new Error(res.error?.message ?? "That could not be published.");
      return res.data!;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
