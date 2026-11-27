import type { Ref } from "vue";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { BrokerMailAdmin, BrokerMailClose, BrokerMailCompose, BrokerMailDetail, BrokerMailList, BrokerMailQueueDraft, BrokerMailSettings, BrokerMailTab, BrokerMailWeek } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The Broker mail page and Settings › Broker mail against `/api/broker-mail` (BROKER-MAIL-READER-PLAN
 * P2). WHOSE rows arrive is the API's answer (the caller's own mailbox, or everyone's for a holder of
 * `dispatch.broker_mail_all`); nothing here filters by owner, so nothing here can widen it.
 */
const KEY = ["broker-mail"] as const;

/** The gateway reads a mailbox once a minute; a minute's refresh keeps "waiting 22 min" honest. */
const REFRESH_MS = 60_000;

export function useBrokerMailQuery(tab: Ref<BrokerMailTab>, owner: Ref<string | undefined>) {
  return useQuery({
    queryKey: [...KEY, "messages", tab, owner] as const,
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<BrokerMailList> => {
      const qs = new URLSearchParams({ tab: tab.value });
      if (owner.value) qs.set("owner", owner.value);
      const r = await apiFetch<BrokerMailList>(`/api/broker-mail/messages?${qs.toString()}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load broker mail");
      return r.data;
    },
  });
}

export function useBrokerMailAdminQuery() {
  return useQuery({
    queryKey: [...KEY, "admin"] as const,
    queryFn: async (): Promise<BrokerMailAdmin> => {
      const r = await apiFetch<BrokerMailAdmin>("/api/broker-mail/admin");
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the broker mail settings");
      return r.data;
    },
  });
}

/** The measure-only week's report (§8): seven days from `from`, or the seven ending today when empty. */
export function useBrokerMailWeekQuery(from: Ref<string>) {
  return useQuery({
    queryKey: [...KEY, "week", from] as const,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<BrokerMailWeek> => {
      const qs = from.value ? `?from=${encodeURIComponent(from.value)}` : "";
      const r = await apiFetch<BrokerMailWeek>(`/api/broker-mail/week${qs}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the measure week");
      return r.data;
    },
  });
}

export function useSaveBrokerMailSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: BrokerMailSettings): Promise<BrokerMailSettings> => {
      const r = await apiFetch<BrokerMailSettings>("/api/broker-mail/settings", { method: "PUT", body: next });
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not save");
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSetLeftOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { userId: string; leftOut: boolean }) => {
      const r = await apiFetch(`/api/broker-mail/mailboxes/${v.userId}/left-out`, { method: "PUT", body: { leftOut: v.leftOut } });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not change it");
      return v;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Q-BM10: an admin replaces one dispatcher's backups. */
export function useSaveBackups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { userId: string; backupUserIds: string[] }) => {
      const r = await apiFetch(`/api/broker-mail/mailboxes/${v.userId}/backups`, { method: "PUT", body: { backupUserIds: v.backupUserIds } });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not save the backups");
      return v;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/**
 * P4 (D-BMR11): one email's panel, and the owner's three acts on it. While a draft is on its way to
 * Outlook the panel re-reads every 10 s, so "In your Outlook" appears without a reload.
 */
export function useBrokerMailDetail(id: Ref<string | null>) {
  return useQuery({
    queryKey: [...KEY, "detail", id] as const,
    enabled: () => id.value !== null,
    refetchInterval: (q) => (q.state.data?.draft && ["queued", "claimed"].includes(q.state.data.draft.state) ? 10_000 : false),
    queryFn: async (): Promise<BrokerMailDetail> => {
      const r = await apiFetch<BrokerMailDetail>(`/api/broker-mail/messages/${id.value}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not open the email");
      return r.data;
    },
  });
}

export function useComposeDraft() {
  return useMutation({
    mutationFn: async (id: string): Promise<BrokerMailCompose> => {
      const r = await apiFetch<BrokerMailCompose>(`/api/broker-mail/messages/${id}/compose`, { method: "POST", body: {} });
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not write a draft");
      return r.data;
    },
  });
}

export function useQueueDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; body: BrokerMailQueueDraft }) => {
      const r = await apiFetch(`/api/broker-mail/messages/${v.id}/draft`, { method: "POST", body: v.body });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not put the draft in Outlook");
      return v;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCloseBrokerMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; how: BrokerMailClose["how"] }) => {
      const r = await apiFetch(`/api/broker-mail/messages/${v.id}/close`, { method: "POST", body: { how: v.how } });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not close it");
      return v;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
