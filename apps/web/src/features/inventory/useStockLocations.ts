import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import type { StockLocationDto, StockLocationInput } from "@silvicom/shared";

/**
 * The places stock is held, and the switch that makes one follow FleetPal (F13). Split out of
 * `useInventory.ts` on 2026-11-16 when F13's hook took it past the 500-line budget; `useInventory`
 * re-exports all four, so every caller and every `vi.mock("./useInventory")` is unchanged.
 */

/**
 * The shop's locations. `includeInactive` is for the manager screen, which has to show a closed bay
 * to reopen it; every picker takes the default, because a movement into a closed location is
 * refused by the RPC (`IV012`) and offering one would be an error the form could have prevented.
 */
export function useLocationsQuery(includeInactive = false) {
  return useQuery({
    queryKey: ["inventory", "locations", includeInactive] as const,
    queryFn: async (): Promise<StockLocationDto[]> => {
      const r = await apiFetch<{ locations: StockLocationDto[] }>(
        `/api/maintenance/inventory/locations${includeInactive ? "?includeInactive=true" : ""}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load stock locations");
      return r.data.locations;
    },
  });
}


/**
 * Create a stock location, and close or rename one.
 *
 * ⚠ **The plan assigned this write to no step at all**, and I4 found it the way the 2026-09-09
 * review found the missing `reorder_point` writer: by measuring. On 2026-09-09 production held
 * **zero rows in all four inventory tables**, and `stock_locations` is the one nothing could ever
 * put a row in — I3 shipped `POST /locations` and `PATCH /locations/:id` with no consumer, no step
 * owns the screen, and I11's settings drawer picks a DEFAULT location, which presumes some exist.
 * Without this the shelf picker on a part is an empty list, I5's receive drawer has nowhere to
 * receive into, and the whole feature is unreachable on day one for a reason no screen explains.
 */
export function useCreateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StockLocationInput): Promise<StockLocationDto> => {
      const r = await apiFetch<{ location: StockLocationDto }>("/api/maintenance/inventory/locations", {
        method: "POST",
        body: input,
      });
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not add the location");
      return r.data.location;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}


export function useUpdateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<StockLocationInput> }): Promise<void> => {
      const r = await apiFetch(`/api/maintenance/inventory/locations/${input.id}`, {
        method: "PATCH",
        body: input.patch,
      });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not save the location");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}


/**
 * Start or stop a place following FleetPal (F13). No date is sent: the server stamps its own now, so
 * nobody can start the shelf in the past and replay FleetPal's history onto it (D-FP23).
 */
export function useSetFleetpalShelf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; follows: boolean }): Promise<void> => {
      const r = await apiFetch(`/api/maintenance/inventory/locations/${input.id}/fleetpal`, {
        method: "POST",
        body: { follows: input.follows },
      });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not change whether the place follows FleetPal");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}
