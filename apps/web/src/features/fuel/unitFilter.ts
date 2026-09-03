import { computed, type ComputedRef } from "vue";
import { useVehiclesQuery } from "@/composables/useVehicles";

/**
 * The shared truck filter, in the two shapes the Fuel Log's tabs need (FUEL-C2).
 *
 * The URL carries a UNIT NUMBER — see `useFuelLogFilters`' header for why that and not a vehicle id.
 * The two raw-feed tabs filter on it directly, because `efs_transactions` and `declined_transactions`
 * key on the text `unit` EFS printed. The fills tab cannot: `fuel_transactions` has a `vehicle_id`
 * and no unit column, so it resolves the shared value against the fleet.
 *
 * Both halves live here so the option list and the resolution read the SAME fleet query. Building
 * the menu from one source and resolving the choice against another is how a picker offers a value
 * that then matches nothing.
 *
 * ⚠ **This deliberately does NOT fix D-FUI16.** The options come from `vehicles.unit_number`, so the
 * four EFS units with no vehicle row (measured 2026-09-01) stay unfilterable while their rows still
 * appear in the list. That is the defect P1 exists to close, by deriving the facet from
 * `efs_transactions.unit`. C2 is a merge and inherits the defect rather than half-fixing it in a
 * place P1 would then have to undo.
 */

export interface UnitOption {
  value: string;
  label: string;
}

/** `All units` plus one entry per unit number in the fleet, sorted the way a human reads them. */
export function useUnitOptions(): ComputedRef<UnitOption[]> {
  const { data: vehicles } = useVehiclesQuery();
  return computed(() => [
    { value: "", label: "All units" },
    ...[...new Set((vehicles.value ?? []).map((v) => v.unit_number))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((u) => ({ value: u, label: u })),
  ]);
}

/**
 * A unit number that exists in no fleet, for the case where the shared filter names a truck this org
 * does not have — a link forwarded after the truck was retired, or a hand-edited URL.
 *
 * It is a real UUID so PostgREST accepts it on a `uuid` column, and the nil UUID specifically because
 * no row can carry it. The alternative — leaving `vehicleId` undefined when the lookup fails — shows
 * the WHOLE fleet's fills under a filter bar that says "654", which is the confidently-wrong answer
 * this section spent FUEL-T5 removing. An empty list under a filter for a truck that is not here is
 * the true answer.
 */
const NO_SUCH_VEHICLE = "00000000-0000-0000-0000-000000000000";

export interface ResolvedUnit {
  /** What to pass to a `vehicle_id` filter, or `undefined` when no unit is selected. */
  vehicleId: ComputedRef<string | undefined>;
  /**
   * True while a unit IS selected and the fleet has not arrived yet.
   *
   * The caller renders its table as loading for exactly this long. Without it the resolution reads as
   * "no such truck" for the tick before `vehicles` lands, and the reader sees an empty log flash under
   * a filter that is about to work.
   */
  pending: ComputedRef<boolean>;
}

export function useVehicleIdForUnit(unit: ComputedRef<string | undefined>): ResolvedUnit {
  const { data: vehicles } = useVehiclesQuery();
  const pending = computed(() => !!unit.value && vehicles.value === undefined);
  const vehicleId = computed(() => {
    if (!unit.value) return undefined;
    if (pending.value) return NO_SUCH_VEHICLE;
    return (vehicles.value ?? []).find((v) => v.unit_number === unit.value)?.id ?? NO_SUCH_VEHICLE;
  });
  return { vehicleId, pending };
}
