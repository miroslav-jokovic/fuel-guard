import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { CalendarDay, RoadsideInspectionDetailDto, RoadsideInspectionDto, RoadsideSummary } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * Our FMCSA roadside inspections (INSPECTION-CHALLENGE-PLAN §6's first slice; FLEET-MANAGER-HOME-PLAN
 * FM5, Q-FM7 (a)): the Roadside card's figures and the list they open. Each figure is that list's
 * length on the server (`summarizeRoadside`), so the card and the page cannot disagree.
 *
 * The feed refreshes once a day (`FMCSA_FEED_HOURS`), so neither read needs to be fresher than that.
 */
async function read<T>(path: string, what: string): Promise<T> {
  const r = await apiFetch<{ data: T }>(path);
  if (!r.ok || !r.data) throw new Error(r.error?.message ?? `Could not load ${what}`);
  return r.data.data;
}

export function useRoadsideSummaryQuery() {
  return useQuery({
    queryKey: ["roadside-inspections", "summary"] as const,
    staleTime: 10 * 60_000,
    queryFn: () => read<RoadsideSummary>("/api/roadside-inspections/summary", "the roadside inspections"),
  });
}

/** The list from `from` (the whole record when null). Whole, never a page: the page counts it. */
export function useRoadsideInspectionsQuery(from: Ref<CalendarDay | null>) {
  return useQuery({
    queryKey: computed(() => ["roadside-inspections", "list", from.value] as const),
    staleTime: 10 * 60_000,
    queryFn: () =>
      read<RoadsideInspectionDto[]>(
        from.value ? `/api/roadside-inspections?from=${from.value}` : "/api/roadside-inspections",
        "the roadside inspections",
      ),
  });
}

/** One inspection with its units and violations — the row the list opens. */
export function useRoadsideInspectionQuery(id: Ref<string>) {
  return useQuery({
    queryKey: computed(() => ["roadside-inspections", "one", id.value] as const),
    staleTime: 10 * 60_000,
    queryFn: () => read<RoadsideInspectionDetailDto>(`/api/roadside-inspections/${encodeURIComponent(id.value)}`, "the roadside inspection"),
  });
}
