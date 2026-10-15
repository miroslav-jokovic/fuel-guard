import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { IdleBurnRatesView, IdleEngineParityView } from "@silvicom/shared";
import {
  apiGet,
  apiPost,
  apiRecord,
  type AlertRecipient,
  type Me,
  type OrgDetail,
  type OrgMember,
  type OrgOverview,
  type ViewAnomaly,
} from "@/lib/api";

/**
 * Every read the console makes, as a query (US7, D-US11).
 *
 * Until US7 each page fetched in `onMounted` into its own refs: no Retry, no refetch after a change,
 * and one `error` ref that a FAILED TOGGLE also wrote, so a refused module switch replaced the whole
 * customer page with a red line. A query per read gives every page the web app's read states
 * (`QueryState`, `DataTable`'s loading / error / empty), and a change invalidates the read it moved.
 */

export const useMeQuery = () => useQuery({ queryKey: ["me"], queryFn: () => apiGet<Me>("/admin/me") });

export const useOrgsQuery = () =>
  useQuery({
    queryKey: ["orgs"],
    queryFn: async () => (await apiGet<{ orgs: OrgOverview[] }>("/admin/orgs")).orgs,
  });

export const useOrgQuery = (id: Ref<string>) =>
  useQuery({
    queryKey: ["org", id],
    queryFn: async () => (await apiRecord<{ org: OrgDetail }>(`/admin/orgs/${id.value}`)).org,
  });

export const useOrgMembersQuery = (id: Ref<string>) =>
  useQuery({
    queryKey: ["org", id, "members"],
    queryFn: async () => (await apiGet<{ members: OrgMember[] }>(`/admin/orgs/${id.value}/members`)).members,
  });

export interface IdleEngineChecks {
  parity: IdleEngineParityView;
  burnRates: IdleBurnRatesView;
}
export const useIdleEngineQuery = (id: Ref<string>) =>
  useQuery({
    queryKey: ["org", id, "idle-engine"],
    queryFn: async () =>
      (await apiRecord<{ idleEngine: IdleEngineChecks }>(`/admin/orgs/${id.value}/idle-engine`)).idleEngine,
  });

/** Only asked while a read-only support session is open for this org: the API refuses it otherwise. */
export const useViewAnomaliesQuery = (id: Ref<string>, open: Ref<boolean>) =>
  useQuery({
    queryKey: ["org", id, "view", "anomalies"],
    queryFn: async () => (await apiGet<{ anomalies: ViewAnomaly[] }>(`/admin/orgs/${id.value}/view/anomalies`)).anomalies,
    enabled: computed(() => open.value),
  });

export const useAlertRecipientsQuery = () =>
  useQuery({
    queryKey: ["alert-recipients"],
    queryFn: async () => (await apiGet<{ recipients: AlertRecipient[] }>("/admin/alert-recipients")).recipients,
  });

/** A switch on one org (an integration's kill switch, a module entitlement): the org is read again after. */
export function useOrgSwitch(id: Ref<string>, kind: "modules" | "entitlements") {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      apiPost(`/admin/orgs/${id.value}/${kind}/${key}`, { enabled }),
    onSettled: () => client.invalidateQueries({ queryKey: ["org", id] }),
  });
}

export function useAlertRecipientChange() {
  const client = useQueryClient();
  const settle = () => client.invalidateQueries({ queryKey: ["alert-recipients"] });
  return {
    add: useMutation({
      mutationFn: (body: { channel: "sms" | "email"; address: string; label?: string }) =>
        apiPost("/admin/alert-recipients", body),
      onSettled: settle,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiPost(`/admin/alert-recipients/${id}/remove`, {}),
      onSettled: settle,
    }),
  };
}
