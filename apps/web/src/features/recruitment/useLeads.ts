import { computed, type Ref } from "vue";
import { useInfiniteQuery, useQuery } from "@tanstack/vue-query";
import type { LeadContactRecord, LeadQueuePage, LeadRecord, OpeningListItem } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/** The office's reads of the lead queue (E4). "open" is the api's own default, so it sends no status at all. */
export const LEADS_OPEN = "open";
export const LEADS_PAGE_SIZE = 50;

/** Whose leads the queue shows: everyone's, or the signed-in recruiter's own (LQ2c, 0576). */
export const LEADS_EVERYONE = "everyone";
export const LEADS_MINE = "mine";

export function useLeadQueueQuery(show: Ref<string>, whose: Ref<string> = computed(() => LEADS_EVERYONE)) {
  return useInfiniteQuery({
    queryKey: computed(() => ["recruitment", "leads", "queue", show.value, whose.value] as const),
    initialPageParam: null as LeadQueuePage["next"],
    queryFn: async ({ pageParam }): Promise<LeadQueuePage> => {
      const params = new URLSearchParams({ limit: String(LEADS_PAGE_SIZE) });
      if (show.value !== LEADS_OPEN) params.set("status", show.value);
      if (whose.value === LEADS_MINE) params.set("mine", "1");
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

/** The openings a lead can be added to: only those still open, and only those with a title to show. */
export function useOpenOpeningsQuery() {
  return useQuery({
    queryKey: ["recruitment", "openings"],
    queryFn: async (): Promise<Array<{ value: string; label: string }>> => {
      const res = await apiFetch<{ openings: OpeningListItem[] }>("/api/recruitment/openings");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the openings.");
      return res.data.openings.flatMap((o) => (o.status === "open" && o.current ? [{ value: o.id, label: o.current.title }] : []));
    },
  });
}
