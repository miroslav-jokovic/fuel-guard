import { useQuery } from "@tanstack/vue-query";
import type { Invite } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The org's invitations, as a query (F2, US6b). Before, the Users page fetched them by hand into a
 * ref that started as `[]`, so a failed read drew "No invitations yet" and the only sign of the
 * failure was a toast that faded. A query keeps the failure as state the table can draw.
 */
export const useInvitesQuery = () =>
  useQuery({
    queryKey: ["settings", "invites"],
    queryFn: async (): Promise<Invite[]> => {
      const res = await apiFetch<{ invites: Invite[] }>("/api/invites");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the invitations.");
      return res.data.invites;
    },
  });
