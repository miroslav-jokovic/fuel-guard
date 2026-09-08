import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { closureRequestListResponseSchema, type ClosureRequest } from "@silvicom/shared";

import { apiFetch } from "@/lib/api";

/**
 * The fleet's account-closure queue (DIRECTION-B-PLAN §6 P4.4, table in 0330).
 *
 * Through `/api/driver-app` rather than PostgREST, and for the same reason the feature composables
 * next door are: 0330 ships the table RLS-on with zero policies, so there is deliberately no client
 * path to it. The API is the only door, and it audits both resolutions.
 */
const CLOSURE_KEY = ["driver_app", "closure_requests"] as const;

export function useClosureRequestsQuery() {
  return useQuery({
    queryKey: CLOSURE_KEY,
    queryFn: async (): Promise<ClosureRequest[]> => {
      const res = await apiFetch<unknown>("/api/driver-app/closure-requests");
      if (!res.ok) throw new Error(res.error?.message ?? "Failed to load closure requests.");
      // Parsed, never cast (D24). The web `apiFetch` has no `schema` option — that is the driver
      // app's — so the parse is explicit here, and a shape change in the API surfaces as a thrown
      // Zod error the query renders rather than as `undefined` reaching the template.
      return closureRequestListResponseSchema.parse(res.data).requests;
    },
  });
}

/**
 * Complete or decline one request.
 *
 * ⚠ `complete` is an ATTESTATION, not a tidy-up: the fleet manager is recording that the
 * non-retained data was deleted per the published privacy policy, and 0330 makes it permanent — the
 * row cannot be reopened. The card's copy says so before the button is pressed, and it must keep
 * saying so.
 *
 * A 409 here is not an error to apologise for: it means another manager resolved the same request
 * while this one was reading it. The card surfaces the message and refetches.
 */
export function useResolveClosureRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; outcome: "complete" | "decline"; note?: string }): Promise<void> => {
      const res = await apiFetch(
        `/api/driver-app/closure-requests/${encodeURIComponent(input.id)}/${input.outcome}`,
        { method: "POST", body: input.note ? { note: input.note } : {} },
      );
      if (!res.ok) throw new Error(res.error?.message ?? "Failed to resolve the request.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CLOSURE_KEY }),
  });
}
