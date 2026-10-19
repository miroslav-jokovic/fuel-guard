/**
 * Which trailer is on which truck, from both sources (TRAILER-LINK-PLAN D-TL1, TL4). Its own file, not
 * `useTrailers.ts`, so the many tests that mock that module whole keep working unchanged.
 *
 * McLeod: the trailer on the load each truck is hauling now, from the API. GPS: the trailer row's own
 * `assigned_vehicle_id`, with its age (`pairing_confirmed_at`, 0488). The two disagreed on 72 of 114
 * trucks on 2026-10-19 with the GPS two months old, so a screen shows both, labelled, never one answer
 * that is silently the other. The line saying how old a GPS pairing is lives in `@/lib/trailerPairingNote`,
 * free of the API client, so a page test needs no mock to render it.
 */
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { TrailerOnLoad } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

export function useTrailersOnLoadsQuery() {
  const q = useQuery({
    queryKey: ["trailers", "on-loads"] as const,
    // A carrier without the dispatch module gets a 403; the page then shows the GPS half alone.
    retry: false,
    refetchInterval: 60_000,
    queryFn: async (): Promise<TrailerOnLoad[]> => {
      const res = await apiFetch<{ trailers: TrailerOnLoad[] }>("/api/dispatch/trailers-on-loads");
      if (!res.ok) throw new Error(res.error?.message ?? "Could not read which trailers are on loads.");
      return res.data?.trailers ?? [];
    },
  });
  const byTrailerId = computed(() => new Map((q.data.value ?? []).map((t) => [t.trailerId, t])));
  return { ...q, byTrailerId };
}
