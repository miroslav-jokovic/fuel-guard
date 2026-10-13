import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { Invite } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { useMembersQuery } from "@/features/permissions/usePermissions";

/**
 * The Users page's two lists, as queries (F2, US6b). Before, they were refs that started as `[]` and
 * were filled by hand, so a failed read drew "0 members · No members match" and "No invitations yet",
 * and the only sign of the failure was a toast that faded. A query keeps the failure as state the
 * table can draw. The members query is the one the Permissions page reads, so a write here refreshes
 * that page's list too.
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

export function useMemberLists() {
  const membersQuery = useMembersQuery();
  const invitesQuery = useInvitesQuery();
  return {
    membersQuery,
    invitesQuery,
    members: computed(() => membersQuery.data.value ?? []),
    invites: computed(() => invitesQuery.data.value ?? []),
    /** After every write: ask both lists again, so the page shows what the API now holds. */
    reload: async () => {
      await Promise.all([membersQuery.refetch(), invitesQuery.refetch()]);
    },
  };
}
