import type { Ref } from "vue";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  FollowUpActionRequest,
  FollowUpCategory,
  FollowUpDetail,
  FollowUpList,
  FollowUpRuleSave,
  FollowUpRules,
  FollowUpVideo,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The warning desk against `/api/follow-ups` (WARNING-DESK-PLAN WD4/WD5). WHICH categories arrive is the
 * API's answer — every one for the desk, Route alone for dispatch's screen (D-WD13) — so nothing here
 * filters by permission, and nothing here can widen it.
 */
const KEY = ["follow-ups"] as const;

/** The desk's tick is five minutes; a minute's refresh keeps "2 h ago" and a colleague's call current. */
const REFRESH_MS = 60_000;

export function useFollowUpsQuery(category: Ref<FollowUpCategory | "all">, closed: Ref<boolean>, mine: Ref<boolean>) {
  return useQuery({
    queryKey: [...KEY, "list", category, closed, mine] as const,
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<FollowUpList> => {
      const qs = new URLSearchParams({ category: category.value, status: closed.value ? "closed" : "open" });
      if (mine.value) qs.set("mine", "1");
      const r = await apiFetch<FollowUpList>(`/api/follow-ups?${qs.toString()}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the follow-ups");
      return r.data;
    },
  });
}

export function useFollowUpDetailQuery(id: Ref<string | null>) {
  return useQuery({
    queryKey: [...KEY, "detail", id] as const,
    enabled: () => id.value !== null,
    queryFn: async (): Promise<FollowUpDetail> => {
      const r = await apiFetch<FollowUpDetail>(`/api/follow-ups/${id.value}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load this follow-up");
      return r.data;
    },
  });
}

/** One action. A 409 means a colleague acted first: the lists refresh either way, so the drawer shows their act. */
export function useFollowUpAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string } & FollowUpActionRequest) => {
      const { id, ...body } = v;
      const r = await apiFetch(`/api/follow-ups/${id}/actions`, { method: "POST", body });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not save that");
      return v;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** A fresh signed link, asked on the click and never cached: it lives about 8 hours (D-WD7). */
export function useFollowUpVideo() {
  return useMutation({
    mutationFn: async (v: { id: string; eventId: string }): Promise<FollowUpVideo> => {
      const r = await apiFetch<FollowUpVideo>(`/api/follow-ups/${v.id}/video/${encodeURIComponent(v.eventId)}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not fetch the video");
      return r.data;
    },
  });
}

export function useFollowUpRulesQuery() {
  return useQuery({
    queryKey: [...KEY, "rules"] as const,
    queryFn: async (): Promise<FollowUpRules> => {
      const r = await apiFetch<FollowUpRules>("/api/follow-ups/rules");
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the follow-up rules");
      return r.data;
    },
  });
}

export function useSaveFollowUpRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { key: string; rule: FollowUpRuleSave }) => {
      const r = await apiFetch(`/api/follow-ups/rules/${encodeURIComponent(v.key)}`, { method: "PUT", body: v.rule });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not save the rule");
      return v;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, "rules"] }),
  });
}

export function useResetFollowUpRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      const r = await apiFetch(`/api/follow-ups/rules/${encodeURIComponent(key)}`, { method: "DELETE" });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not reset the rule");
      return key;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, "rules"] }),
  });
}
