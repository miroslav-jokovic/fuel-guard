import { computed, type ComputedRef } from "vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useEfsFacets } from "./useEfsData";

/**
 * The shared truck filter, in the two shapes the Fuel Log's tabs need (FUEL-C2, FUEL-P1).
 *
 * The URL carries UNIT NUMBERS — see `useFuelLogFilters`' header for why those and not vehicle ids,
 * and why the parameter is still called `unit` now that it holds a list. The two raw-feed tabs filter
 * on them directly, because `efs_transactions` and `declined_transactions` key on the text `unit` EFS
 * printed. The fills tab cannot: `fuel_transactions` has a `vehicle_id` and no unit column, so it
 * resolves the shared values against the fleet.
 *
 * Both halves live here so the option list and the resolution read the SAME sources. Building the menu
 * from one place and resolving the choice against another is how a picker offers a value that then
 * matches nothing.
 *
 * ── D-FUI16: THE MENU IS THE UNION, AND THAT IS THE WHOLE POINT OF P1 ───────────────────────────
 * This used to list `vehicles.unit_number` and nothing else, so a unit EFS printed that the fleet has
 * no row for was unfilterable while its lines sat in the list. Measured in production 2026-09-04:
 * **four such units — 696 (43 lines), T005 (6), T001 (5), T004 (2)** — 56 visible, unselectable lines.
 *
 * So the menu is the union of the fleet's own units and the units the two raw feeds actually carry
 * (migrations 0313/0314, via `useEfsFacets`). One shared control across three tabs has to offer
 * everything any of those tabs can show; a per-tab list would be narrower and would also drop the
 * reader's choice as they moved between tabs, which is the opposite of what C2 merged them for.
 *
 * A unit that is not in the fleet says so in its label. It is honest on the raw tabs, where its rows
 * are, and honest on the Fills tab, where it correctly matches nothing — a fill can only exist against
 * a truck the fleet has. The alternative, silently offering it as though it were a truck, is how a
 * reader concludes the fills are missing rather than that the roster is.
 */

export interface UnitOption {
  value: string;
  label: string;
}

/**
 * Every unit a reader could be looking at, sorted the way a human reads them.
 *
 * ⚠ No `All units` entry. `FilterSelect` renders that row itself for a multi-select — it is the
 * "clear" affordance, ticked when nothing is chosen — and a second one in the options would be a row
 * that looks selectable and means the absence of a selection.
 */
export function useUnitOptions(): ComputedRef<UnitOption[]> {
  const { data: vehicles } = useVehiclesQuery();
  const { data: facets } = useEfsFacets();
  return computed(() => {
    const fleet = new Set((vehicles.value ?? []).map((v) => v.unit_number));
    const seen = new Set<string>([...fleet, ...(facets.value?.txnUnits ?? []), ...(facets.value?.rejUnits ?? [])]);
    return [...seen]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((u) => ({ value: u, label: fleet.has(u) ? u : `${u} · not in the fleet` }));
  });
}

export interface ResolvedUnits {
  /**
   * What to pass to a `vehicle_id` filter.
   *
   * `undefined` when no unit is selected — the whole fleet. An EMPTY ARRAY when units are selected and
   * none of them names a truck this org has, which is the true answer and not the same thing: PostgREST
   * renders it `vehicle_id=in.()` and returns nothing (verified against the hosted API, 2026-09-04),
   * and `fuel_range_totals` reads an empty `p_vehicles` the same way (migration 0312).
   *
   * The alternative — falling back to `undefined` when the lookup fails — shows the WHOLE fleet's fills
   * under a filter bar naming two trucks, which is the confidently-wrong answer this section spent
   * FUEL-T5 removing. An empty list under a filter for trucks that are not here is the true answer.
   */
  vehicleIds: ComputedRef<string[] | undefined>;
  /**
   * True while units ARE selected and the fleet has not arrived yet.
   *
   * The caller renders its table as loading for exactly this long. Without it the resolution reads as
   * "no such truck" for the tick before `vehicles` lands, and the reader sees an empty log flash under
   * a filter that is about to work.
   */
  pending: ComputedRef<boolean>;
}

export function useVehicleIdsForUnits(units: ComputedRef<string[]>): ResolvedUnits {
  const { data: vehicles } = useVehiclesQuery();
  const pending = computed(() => units.value.length > 0 && vehicles.value === undefined);
  const vehicleIds = computed(() => {
    if (units.value.length === 0) return undefined;
    if (pending.value) return [];
    const wanted = new Set(units.value);
    return (vehicles.value ?? []).filter((v) => wanted.has(v.unit_number)).map((v) => v.id);
  });
  return { vehicleIds, pending };
}
