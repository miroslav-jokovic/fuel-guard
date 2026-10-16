import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { LiveMapDrivenPath } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

interface Envelope {
  ok: boolean;
  data?: LiveMapDrivenPath;
  error?: { message?: string };
}

/**
 * Where the load's truck has actually been since the pickup (DISPATCH-BOARD-V2-PLAN DBV6), fetched
 * beside `useLoadRoute` when the route toggle turns on — its own request, so the route draws without
 * waiting on Samsara. The server keeps an answer a minute; so does this, and the toggle redraws at
 * once inside it. A failure draws no driven line and leaves the route as it was.
 */
export function useDrivenPath(loadId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ["livemap", "driven", loadId.value] as const),
    enabled: computed(() => loadId.value != null),
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<LiveMapDrivenPath> => {
      const res = await apiFetch<Envelope>(`/api/livemap/loads/${loadId.value}/driven`);
      const body = res.data;
      if (!res.ok || !body?.ok || !body.data) {
        throw new Error(body?.error?.message ?? res.error?.message ?? "Could not draw where this truck has been");
      }
      return body.data;
    },
  });
}
