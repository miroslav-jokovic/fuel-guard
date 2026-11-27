import { computed } from "vue";
import { fleetGroup, matchesVehicleCheck, seatedDriverIds, type FleetGroup, type Vehicle } from "@silvicom/shared";
import type { CountRow } from "@/components/ui/CountList.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import { useSessionStore } from "@/stores/session";

/**
 * The rows of "Trucks" (key `ops.seats`), out of the card that draws them — why, in
 * `features/dispatch/useFleetNowRows.ts`.
 *
 * ⚠ The drivers line keeps its own gate HERE, not in the card: it reads the roster, so it exists only
 * for a caller who may view `roster` (`session.canView`, never a role). Any reader of these rows —
 * the card or the tab's "Needs action" card — gets the same answer, and the roster is not asked at all
 * for a caller it would refuse.
 *
 * ── A LEDGER OF THE FLEET (FLEET-MANAGER-HOME-PLAN D-FM11, 2026-11-27) ────────────────────────────
 * The total is every truck in service (`isInServiceVehicleStatus`) — what the Vehicles page opens on —
 * and `fleetGroup` puts each in exactly one of three groups, so the three group rows add up to the
 * total and the caption under it says so in figures. "Under dispatch" is the dispatch board's own
 * total. Ordered trucks are beside the total, never in it: they are not delivered. "No driver" is a part
 * of "Under dispatch", and "Drivers without a truck" counts people, so neither is in the sum.
 *
 * Every door opens the Vehicles page on its default, In service, so no door spells a status but the
 * ordered one.
 */
export function useSeatsRows() {
  const session = useSessionStore();
  const { data: vehicles } = useVehiclesQuery();
  const { data: drivers } = useDriversQuery();

  const fleet = computed(() => (vehicles.value ? groupFleet(vehicles.value) : null));
  const noDriver = computed(() =>
    vehicles.value ? vehicles.value.filter((v) => matchesVehicleCheck(v, "no_driver", undefined)).length : null,
  );
  const ordered = computed(() => (vehicles.value ? vehicles.value.filter((v) => v.status === "ordered").length : null));
  const unseated = computed(() => {
    if (!vehicles.value || !drivers.value) return null;
    const seated = seatedDriverIds(vehicles.value);
    return drivers.value.filter((d) => d.status === "active" && !d.archived_at && !seated.has(d.id)).length;
  });

  const rows = computed<CountRow[]>(() => {
    const f = fleet.value;
    const dispatch = f?.under_dispatch.length ?? null;
    const parked = f?.parked ?? [];
    const parkedShop = parked.filter((v) => v.status === "maintenance").length;
    const parkedHeld = parked.filter((v) => v.assigned_driver_id != null).length;
    return [
      {
        key: "under-dispatch", label: "Under dispatch", value: dispatch,
        caption: dispatch != null && noDriver.value != null ? `on the Dispatch board · ${dispatch - noDriver.value} with a driver` : "on the Dispatch board",
        to: "/vehicles?check=under_dispatch", door: "Vehicles",
      },
      { key: "no-driver", label: "Under dispatch, no driver", value: noDriver.value, caption: "nobody assigned to the truck", to: "/vehicles?check=no_driver", door: "Vehicles", alarm: true },
      {
        key: "parked", label: "Parked in the Unassigned pool", value: f ? parked.length : null,
        caption: f ? ["not dispatched", parkedShop ? `${parkedShop} in the shop` : null, parkedHeld ? `${parkedHeld} still ${parkedHeld === 1 ? "has" : "have"} a driver` : null].filter(Boolean).join(" · ") : undefined,
        to: "/vehicles?check=parked", door: "Vehicles",
      },
      { key: "winding-down", label: "Sold or retiring, still in McLeod", value: f?.winding_down.length ?? null, caption: "until McLeod takes it out of service", to: "/vehicles?check=winding_down", door: "Vehicles" },
      { key: "ordered", label: "Ordered, not delivered yet", value: ordered.value, caption: "not counted in the fleet", to: "/vehicles?status=ordered", door: "Vehicles" },
      ...(session.canView("roster")
        ? [{ key: "no-truck", label: "Drivers without a truck", value: unseated.value, caption: "active drivers holding no truck", to: "/drivers?status=active&seat=none", door: "Drivers" }]
        : []),
    ];
  });

  return { fleet, rows };
}

export type GroupedFleet = Record<FleetGroup, Vehicle[]> & { total: number };

/** Every truck in service, in its one group (`fleetGroup`). `total` is their sum, by construction. */
export function groupFleet(vehicles: readonly Vehicle[]): GroupedFleet {
  const out: GroupedFleet = { under_dispatch: [], parked: [], winding_down: [], total: 0 };
  for (const v of vehicles) {
    const g = fleetGroup(v);
    if (!g) continue;
    out[g].push(v);
    out.total++;
  }
  return out;
}

/** "181 under dispatch + 21 parked + 8 sold or retiring" — the total's caption, so the sum is shown. */
export function fleetSum(f: GroupedFleet): string {
  return `${f.under_dispatch.length} under dispatch + ${f.parked.length} parked + ${f.winding_down.length} sold or retiring`;
}
