import { computed, type Ref } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import type {
  AssetDto,
  KitExpectationDto,
  KitExpectationInput,
  UnitKitDto,
} from "@silvicom/shared";

/**
 * Units and their kits, client side (INVENTORY-PLAN.md step I9).
 *
 * ── NOTHING HERE COMPUTES A KIT ───────────────────────────────────────────────────────────────
 * The API runs `deriveKitStatus` and sends its answer; these hooks transport it. I9's done-when is
 * that kit status comes from ONE shared function on api and web, and the way that is kept true is
 * that the web never runs the comparison a second time — a screen recomputing `held − expected`
 * from the lines it was given is how "short by one" and "complete" end up on two screens about the
 * same trailer.
 *
 * ── THE KEYS SHARE `["inventory", …]` WITH THE OTHER TWO HALVES ───────────────────────────────
 * Moving a tablet onto a truck changes the asset, the truck's kit AND the shop home's shortfall
 * count. One prefix means the move invalidates all three; three prefixes would be three chances to
 * forget the third.
 */

export interface UnitsFilter {
  /** The ROSTER's two words. A reefer is a trailer here — `unitKindOf` draws the kit distinction. */
  kind?: "tractor" | "trailer";
  shortOnly?: boolean;
}

export function useUnitsQuery(filter: Ref<UnitsFilter>) {
  return useQuery({
    queryKey: ["inventory", "units", filter] as const,
    queryFn: async (): Promise<{ units: UnitKitDto[]; total: number }> => {
      const params = new URLSearchParams();
      if (filter.value.kind) params.set("kind", filter.value.kind);
      if (filter.value.shortOnly) params.set("shortOnly", "true");
      const q = params.toString();
      const r = await apiFetch<{ units: UnitKitDto[]; total: number }>(
        `/api/maintenance/inventory/units${q ? `?${q}` : ""}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the fleet's kit");
      return r.data;
    },
  });
}

/**
 * One unit's kit and what it is carrying.
 *
 * This is also what D-AVI17's read-only card on the vehicle and trailer pages reads. That card is
 * gated `maintenance: view` and has no edit affordance at all — the equipment section owns the
 * truck's file, the shop owns what is in it, and a card that offered an Assign button would be the
 * second of those quietly taking a decision from the first.
 */
export function useUnitKitQuery(kind: Ref<"tractor" | "trailer">, unitId: Ref<string>) {
  return useQuery({
    queryKey: ["inventory", "unit", kind, unitId] as const,
    enabled: computed(() => Boolean(unitId.value)),
    queryFn: async (): Promise<{ unit: UnitKitDto; assets: AssetDto[] }> => {
      const r = await apiFetch<{ unit: UnitKitDto; assets: AssetDto[] }>(
        `/api/maintenance/inventory/units/${kind.value}/${unitId.value}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the unit's kit");
      return r.data;
    },
  });
}

export interface KitExpectationsFilter {
  unitKind?: string;
  vehicleId?: string;
  trailerId?: string;
  fleetOnly?: boolean;
}

export function useKitExpectationsQuery(filter: Ref<KitExpectationsFilter>) {
  return useQuery({
    queryKey: ["inventory", "kit-expectations", filter] as const,
    queryFn: async (): Promise<KitExpectationDto[]> => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filter.value)) if (v) params.set(k, String(v));
      const q = params.toString();
      const r = await apiFetch<{ expectations: KitExpectationDto[] }>(
        `/api/maintenance/inventory/kit-expectations${q ? `?${q}` : ""}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the kit rules");
      return r.data.expectations;
    },
  });
}

/**
 * Set one rule.
 *
 * `PUT`, because the operation's key is (type, unit kind, unit) and sending the same body twice must
 * not make two rules. The API is UPDATE-then-INSERT behind it, for the reason `setKitExpectation`
 * records: the conflict target is one of three PARTIAL unique indexes, and PostgREST's `onConflict`
 * names columns rather than a partial index.
 */
export function useSetKitExpectation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: KitExpectationInput): Promise<KitExpectationDto> => {
      const r = await apiFetch<{ expectation: KitExpectationDto }>(
        "/api/maintenance/inventory/kit-expectations",
        { method: "PUT", body: input },
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not save the kit rule");
      return r.data.expectation;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

/**
 * Remove one — a real delete, and the only one in this feature.
 *
 * An expectation is a rule about a unit that still exists, not evidence of anything that happened.
 * Removing a per-unit override puts that unit back on the fleet default, which is the whole point
 * of the two layers.
 */
export function useDeleteKitExpectation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const r = await apiFetch(`/api/maintenance/inventory/kit-expectations/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not remove the kit rule");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}
