import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import { recordOrThrow } from "@silvicom/ui";
import type { UnitAttentionDto, UnitShopFileDto } from "@silvicom/shared";

/**
 * The truck's page, client side (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §4.3, M3; FleetPal F10/F11).
 *
 * Two reads, nothing computed here: the server judges every PM schedule (`pmStatus`) and derives
 * every "needs attention" reason once, and these hooks transport the answers. The attention list is
 * ONE query for the fleet, shared by the Trucks & trailers list and every truck's page — opening a
 * truck from the list costs no second request, and the page's first section says the sentence the
 * list did because it is the same row.
 */
export function useUnitsAttentionQuery(enabled: Ref<boolean> | boolean = true) {
  return useQuery({
    queryKey: ["maintenance", "units-attention"] as const,
    staleTime: 60_000,
    enabled,
    queryFn: async (): Promise<UnitAttentionDto[]> => {
      const r = await apiFetch<{ data: UnitAttentionDto[] }>("/api/maintenance/units/attention");
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load what needs attention");
      return r.data.data;
    },
  });
}

/** One unit's shop file. A 404 is `NotFoundError` (F21): a unit that is not on the fleet is not a failed read. */
export function useUnitShopFileQuery(kind: Ref<"tractor" | "trailer">, unitId: Ref<string>) {
  return useQuery({
    queryKey: ["maintenance", "unit-shop-file", kind, unitId] as const,
    enabled: computed(() => Boolean(unitId.value)),
    queryFn: async (): Promise<UnitShopFileDto> =>
      recordOrThrow(
        await apiFetch<{ data: UnitShopFileDto }>(`/api/maintenance/units/${kind.value}/${unitId.value}/shop-file`),
        "Could not load the shop's file on this unit",
      ).data,
  });
}

/** F9b's answer for the hub's bills line: the figure, or the reason it cannot be printed (D-FP4). */
export interface UnitRepairBills {
  total: number | null;
  repairCount: number;
  /** The coverage lower bound for the window, 0–1, or null when a month could not be measured. */
  ratioLowerBound: number | null;
  unavailable: string | null;
}

/**
 * One unit's repair bills for a window, through F9b's gated endpoint. A 409 is an ANSWER here — "the
 * ledger has no maintenance total for one of these months" — and the line prints it, because a
 * missing figure that said nothing would read as "no repairs".
 */
export function useUnitRepairBillsQuery(kind: Ref<"tractor" | "trailer">, unitId: Ref<string>, window: Ref<{ from: string; to: string }>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ["maintenance", "unit-repair-bills", kind, unitId, window] as const,
    staleTime: 5 * 60_000,
    enabled: computed(() => enabled.value && Boolean(unitId.value)),
    queryFn: async (): Promise<UnitRepairBills> => {
      const r = await apiFetch<{ totals: { total: number | null }; repairCount: number; coverage: { ratioLowerBound: number | null }[] }>(
        `/api/maintenance/units/${kind.value}/${unitId.value}/maintenance?from=${window.value.from}&to=${window.value.to}`,
      );
      if (!r.ok && r.error?.code === "coverage_unavailable") return { total: null, repairCount: 0, ratioLowerBound: null, unavailable: r.error.message };
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the repair bills");
      const bounds = r.data.coverage.map((m) => m.ratioLowerBound);
      return {
        total: r.data.totals.total,
        repairCount: r.data.repairCount,
        ratioLowerBound: bounds.length && bounds.every((b) => b !== null) ? Math.min(...(bounds as number[])) : null,
        unavailable: null,
      };
    },
  });
}
