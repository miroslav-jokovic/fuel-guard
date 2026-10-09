import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { LiveMapLoadRoute } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

interface Envelope {
  ok: boolean;
  data?: LiveMapLoadRoute;
  error?: { message?: string };
}

/**
 * The route of the load whose route toggle is on (TRUCK-CARD-ROUTE-PLAN D-TC7), or nothing.
 *
 * Fetched when the toggle turns on, not with the board: a route is a HERE call on a cold cache and a
 * fuel plan every time, and the board polls every five seconds. Kept two minutes, so switching the
 * toggle off and on again redraws at once; the split point is the truck's position at the fetch, so a
 * fresher one is a press away rather than a poll that would re-plan fuel for every viewer.
 */
export function useLoadRoute(loadId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ["livemap", "route", loadId.value] as const),
    enabled: computed(() => loadId.value != null),
    staleTime: 2 * 60_000,
    retry: false,
    queryFn: async (): Promise<LiveMapLoadRoute> => {
      const res = await apiFetch<Envelope>(`/api/livemap/loads/${loadId.value}/route`);
      const body = res.data;
      if (!res.ok || !body?.ok || !body.data) {
        throw new Error(body?.error?.message ?? res.error?.message ?? "Could not draw this route");
      }
      return body.data;
    },
  });
}
