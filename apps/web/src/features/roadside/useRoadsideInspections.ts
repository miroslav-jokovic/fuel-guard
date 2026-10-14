import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  CalendarDay,
  RoadsideAttributionDecision,
  RoadsideInspectionDetailDto,
  RoadsideInspectionDto,
  RoadsideSummary,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { recordOrThrow } from "@/lib/notFound";

/**
 * Our FMCSA roadside inspections (INSPECTION-CHALLENGE-PLAN §6's first slice; FLEET-MANAGER-HOME-PLAN
 * FM5, Q-FM7 (a)): the Roadside card's figures and the list they open. Each figure is that list's
 * length on the server (`summarizeRoadside`), so the card and the page cannot disagree.
 *
 * The feed refreshes once a day (`FMCSA_FEED_HOURS`), so neither read needs to be fresher than that.
 */
async function read<T>(path: string, what: string): Promise<T> {
  // A 404 is `NotFoundError` (F21) — only the one-inspection read can meet one.
  return recordOrThrow(await apiFetch<{ data: T }>(path), `Could not load ${what}`).data;
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

/** The API's refusal, kept whole: `changed` means the page is behind and must reload before deciding again. */
export class AttributionDecisionError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
  }
}

/**
 * A person confirming or correcting who was driving (IC5, plan §6). Settled either way, the inspection
 * is read again: after a success to show the decision, after `changed` to show what someone else did.
 */
export function useDecideAttribution(id: Ref<string>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (decision: RoadsideAttributionDecision): Promise<void> => {
      const res = await apiFetch(`/api/roadside-inspections/${encodeURIComponent(id.value)}/attribution`, { method: "POST", body: decision });
      if (!res.ok) throw new AttributionDecisionError(res.error?.message ?? "The decision could not be saved.", res.error?.code ?? null);
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["roadside-inspections", "one", id.value] }),
  });
}
