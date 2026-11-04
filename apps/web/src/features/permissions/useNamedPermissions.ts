import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { EditablePermissionKey, RolePermissionsResponse, UserRole } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { apiRefusal } from "@/composables/useStepUpRetry";

/**
 * Named permissions a carrier switches per role (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.1).
 *
 * The read brings its own yardstick — the catalogue with each permission's shipped roles — so nothing
 * here rebuilds a default (D-PERM4). The write is behind the page's password step-up like every other
 * change on Settings → Permissions, so its refusal keeps the API's code (`apiRefusal`).
 */
const KEY = ["permissions", "named"] as const;

export const useNamedPermissionsQuery = () =>
  useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const res = await apiFetch<RolePermissionsResponse>("/api/role-permissions");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load permissions");
      return res.data;
    },
  });

export function useSetNamedPermission() {
  const qc = useQueryClient();
  return useMutation({
    // ⚠ `apiFetch` serialises the body itself.
    mutationFn: async (v: { role: UserRole; permission: EditablePermissionKey; allowed: boolean | null }) => {
      const res = await apiFetch("/api/role-permissions", { method: "PUT", body: v });
      if (!res.ok) throw apiRefusal(res.error, "Could not save that change");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
