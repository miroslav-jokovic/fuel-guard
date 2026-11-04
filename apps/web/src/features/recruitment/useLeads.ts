import { computed, type Ref } from "vue";
import { useInfiniteQuery, useQuery } from "@tanstack/vue-query";
import type { LeadContactRecord, LeadQueuePage, LeadRecord } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/** The office's reads of the lead queue (E4). "open" is the api's own default, so it sends no status at all. */
export const LEADS_OPEN = "open";
export const LEADS_PAGE_SIZE = 50;

export function useLeadQueueQuery(show: Ref<string>) {
  return useInfiniteQuery({
    queryKey: computed(() => ["recruitment", "leads", "queue", show.value] as const),
    initialPageParam: null as LeadQueuePage["next"],
    queryFn: async ({ pageParam }): Promise<LeadQueuePage> => {
      const params = new URLSearchParams({ limit: String(LEADS_PAGE_SIZE) });
      if (show.value !== LEADS_OPEN) params.set("status", show.value);
      if (pageParam) {
        params.set("before_at", pageParam.before_at);
        params.set("before_id", pageParam.before_id);
      }
      const res = await apiFetch<LeadQueuePage>(`/api/recruitment/leads?${params}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the leads.");
      return res.data;
    },
    getNextPageParam: (last) => last.next,
  });
}

export function useLeadQuery(leadId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => ["recruitment", "leads", "one", leadId.value] as const),
    enabled: computed(() => leadId.value !== ""),
    queryFn: async (): Promise<LeadRecord> => {
      const res = await apiFetch<LeadRecord>(`/api/recruitment/leads/${encodeURIComponent(leadId.value)}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the lead.");
      return res.data;
    },
  });
}

export function useLeadContactsQuery(leadId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => ["recruitment", "leads", "contacts", leadId.value] as const),
    enabled: computed(() => leadId.value !== ""),
    queryFn: async (): Promise<LeadContactRecord[]> => {
      const res = await apiFetch<{ contacts: LeadContactRecord[] }>(`/api/recruitment/leads/${encodeURIComponent(leadId.value)}/contacts`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load who contacted this lead.");
      return res.data.contacts;
    },
  });
}
