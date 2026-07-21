import { defineStore } from "pinia";
import { ref } from "vue";
import { apiGet, apiPost, type Grant } from "@/lib/api";

/** Tracks the caller's active read-only support sessions (grants) and drives the global banner. */
export const useImpersonationStore = defineStore("impersonation", () => {
  const grants = ref<Grant[]>([]);
  const loaded = ref(false);

  async function load() {
    const { grants: g } = await apiGet<{ grants: Grant[] }>("/admin/impersonation");
    grants.value = g;
    loaded.value = true;
  }

  function activeForOrg(orgId: string): Grant | null {
    return grants.value.find((g) => g.orgId === orgId) ?? null;
  }

  async function start(orgId: string, reason: string): Promise<Grant> {
    const { grant } = await apiPost<{ grant: Grant }>(`/admin/orgs/${orgId}/impersonation`, { reason });
    await load();
    return grant;
  }

  async function revoke(grantId: string) {
    await apiPost(`/admin/impersonation/${grantId}/revoke`, {});
    await load();
  }

  return { grants, loaded, load, activeForOrg, start, revoke };
});
