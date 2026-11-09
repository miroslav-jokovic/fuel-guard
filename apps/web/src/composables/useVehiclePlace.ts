import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { placeKey, placeLookupApplies, type LiveMapTruckPlace, type LiveMapVehicle, type LiveMapVehiclePlace } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

interface Envelope {
  ok: boolean;
  data?: LiveMapVehiclePlace;
  error?: { message?: string };
}

/**
 * The truck place the selected truck is at (D-LM31), for its card's "At" line.
 *
 * ── ASKED ONLY WHEN IT CAN HAVE AN ANSWER ────────────────────────────────────────────────────────
 * Enabled for a selected truck that is stopped or parked (`placeLookupApplies`, the API's own rule),
 * so selecting a moving truck costs nothing. The key carries the truck's fix as `placeKey` rounds it —
 * the same rounding the API caches under — so a truck that drives to another stop while its card is
 * open is asked about again, and the 5-second board poll repeating a parked truck's fix is not.
 *
 * ⚠ `retry: false` and no error surface on the card: a failed lookup (HERE down, or an api from
 * before this route mid-deploy answering 404) leaves the card exactly as it was before D-LM31 —
 * Location still shows Samsara's address. A retry loop on a card would be HERE requests nobody sees.
 */
export function useVehiclePlace(vehicle: Ref<LiveMapVehicle | null>) {
  const ask = computed(() => {
    const v = vehicle.value;
    if (!v || !placeLookupApplies(v.state)) return null;
    return { id: v.vehicleId, at: placeKey(v.position.lat, v.position.lng) };
  });
  const query = useQuery({
    queryKey: computed(() => ["livemap", "place", ask.value?.id ?? null, ask.value?.at ?? null] as const),
    enabled: computed(() => ask.value != null),
    // A truck stop does not move, and the key changes when the truck does.
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: async (): Promise<LiveMapVehiclePlace> => {
      const res = await apiFetch<Envelope>(`/api/livemap/vehicles/${ask.value!.id}/place`);
      const body = res.data;
      if (!res.ok || !body?.ok || !body.data) {
        throw new Error(body?.error?.message ?? res.error?.message ?? "Could not look up where this truck is");
      }
      return body.data;
    },
  });
  /**
   * The place, or null — null while it is being asked, when it failed, and whenever the truck is not
   * one the lookup applies to. A truck that drives off gets a new key, and a new key has no data, so it
   * stops showing the truck stop it left; the `vehicleId` check refuses an answer for another truck.
   */
  return computed<LiveMapTruckPlace | null>(() => {
    const data = query.data.value;
    if (!ask.value || !data || data.vehicleId !== ask.value.id) return null;
    return data.place;
  });
}
