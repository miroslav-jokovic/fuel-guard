import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  HOME_TIME_PERMISSION,
  homeTimeListResponseSchema,
  type HomeTimeChange,
  type HomeTimeDriverOption,
  type HomeTimeListResponse,
  type HomeTimeMark,
  type HomeTimePeriod,
} from "@silvicom/shared";
import { apiFetch, type ApiResult } from "@/lib/api";
import { useSessionStore } from "@/stores/session";

/**
 * Home time's data layer (HOME-TIME-PLAN §3.3, step HT3): `/api/roster/home-time`, one cache for the
 * three places it is shown — the truck drawer, the Home time tab and the driver's page — so marking a
 * driver in one updates the other two without a second request shape.
 *
 * Every write refreshes this list AND the dispatch board: the board's Available cell and Warnings chips
 * are the same fact (D-HT9), and the server reads home time past its row cache, so the board's next
 * answer already agrees.
 */
export const HOME_TIME_KEY = ["home-time"] as const;
const BOARD_KEY = ["dispatch", "board"] as const;

/** A failed call as a thrown message; the caller's toast shows it. */
async function read<T>(call: Promise<ApiResult<T>>, fallback: string): Promise<T> {
  const res = await call;
  if (!res.ok || res.data === undefined) throw new Error(res.error?.message ?? fallback);
  return res.data;
}

/** May this person mark, change and end home time (D-HT7)? The API's gate decides; this hides the buttons. */
export function useCanMarkHomeTime() {
  const session = useSessionStore();
  return computed(() => session.hasPermission(HOME_TIME_PERMISSION));
}

/**
 * Everyone scheduled, home or overdue, then what closed lately. A minute's tempo, the board's own, so a
 * period that turns overdue is seen without a reload; off while `enabled` is false, so a closed drawer
 * asks nothing.
 */
export function useHomeTimeList(enabled: Ref<boolean> = computed(() => true)) {
  return useQuery({
    queryKey: [...HOME_TIME_KEY, "list"] as const,
    enabled,
    queryFn: async (): Promise<HomeTimeListResponse> =>
      homeTimeListResponseSchema.parse(await read(apiFetch<HomeTimeListResponse>("/api/roster/home-time"), "Could not load home time.")),
    refetchInterval: 60_000,
    // The page's tab badge and the drawer are two observers of this one list: without a fresh window the
    // drawer opening would ask again for what the page read seconds ago. A write invalidates it anyway.
    staleTime: 30_000,
  });
}

/** Who the form can be opened on from the tab: active drivers, each with the truck the roster pairs to him. */
export function useHomeTimeDrivers(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: [...HOME_TIME_KEY, "drivers"] as const,
    enabled,
    queryFn: async (): Promise<HomeTimeDriverOption[]> =>
      (await read(apiFetch<{ drivers: HomeTimeDriverOption[] }>("/api/roster/home-time/drivers"), "Could not load the drivers.")).drivers,
    staleTime: 60_000,
  });
}

function useHomeTimeWrite<V>(call: (v: V) => Promise<ApiResult<{ period: HomeTimePeriod }>>, fallback: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: V): Promise<HomeTimePeriod> => (await read(call(v), fallback)).period,
    // Settled, not only success: a 409 means somebody else changed it first, and the fresh list is the answer.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: HOME_TIME_KEY });
      void qc.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });
}

const one = (id: string, act = "") => `/api/roster/home-time/${id}${act}`;

export const useMarkHomeTime = () =>
  useHomeTimeWrite<HomeTimeMark>((body) => apiFetch("/api/roster/home-time", { method: "POST", body }), "Could not mark the home time.");

export const useChangeHomeTime = () =>
  useHomeTimeWrite<{ id: string; change: HomeTimeChange }>((v) => apiFetch(one(v.id), { method: "PATCH", body: v.change }), "Could not change the home time.");

export const useEndHomeTime = () =>
  useHomeTimeWrite<{ id: string }>((v) => apiFetch(one(v.id, "/end"), { method: "POST", body: {} }), "Could not end the home time.");

export const useCancelHomeTime = () =>
  useHomeTimeWrite<{ id: string }>((v) => apiFetch(one(v.id, "/cancel"), { method: "POST", body: {} }), "Could not cancel the home time.");

export const useReopenHomeTime = () =>
  useHomeTimeWrite<{ id: string }>((v) => apiFetch(one(v.id, "/reopen"), { method: "POST", body: {} }), "Could not reopen the home time.");
