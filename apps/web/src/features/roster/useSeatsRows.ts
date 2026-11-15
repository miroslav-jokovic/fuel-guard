import { computed } from "vue";
import { isRunningTruck, matchesVehicleCheck, seatedDriverIds } from "@silvicom/shared";
import type { CountRow } from "@/components/ui/CountList.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import { useSessionStore } from "@/stores/session";

/**
 * The rows of "Seats", out of the card that draws them — why, in `features/dispatch/useFleetNowRows.ts`.
 *
 * ⚠ The drivers line keeps its own gate HERE, not in the card: it reads the roster, so it exists only
 * for a caller who may view `roster` (`session.canView`, never a role). Any reader of these rows —
 * the Seats card or the tab's "Needs action" card — gets the same answer, and the roster is not asked
 * at all for a caller it would refuse.
 */
export function useSeatsRows() {
  const session = useSessionStore();
  const { data: vehicles } = useVehiclesQuery();
  const { data: drivers } = useDriversQuery();

  const running = computed(() => (vehicles.value ? vehicles.value.filter(isRunningTruck) : null));
  // The seat checks ask nothing of a truck's file, so none is passed (`matchesVehicleCheck`).
  const noDriver = computed(() =>
    running.value ? running.value.filter((v) => matchesVehicleCheck(v, "no_driver", undefined)).length : null,
  );
  const unseated = computed(() => {
    if (!vehicles.value || !drivers.value) return null;
    const seated = seatedDriverIds(vehicles.value);
    return drivers.value.filter((d) => d.status === "active" && !d.archived_at && !seated.has(d.id)).length;
  });
  const ordered = computed(() => (vehicles.value ? vehicles.value.filter((v) => v.status === "ordered").length : null));
  const windingDown = computed(() =>
    vehicles.value ? vehicles.value.filter((v) => v.status === "active" && matchesVehicleCheck(v, "winding_down", undefined)).length : null,
  );

  const rows = computed<CountRow[]>(() => [
    { key: "no-driver", label: "Trucks without a driver", value: noDriver.value, caption: "running trucks nobody is assigned to", to: "/vehicles?check=no_driver", door: "Vehicles", alarm: true },
    ...(session.canView("roster")
      ? [{ key: "no-truck", label: "Drivers without a truck", value: unseated.value, caption: "active drivers holding no truck", to: "/drivers?status=active&seat=none", door: "Drivers" }]
      : []),
    { key: "winding-down", label: "Trucks being wound down", value: windingDown.value, caption: "sold or retiring in McLeod — not counted above", to: "/vehicles?check=winding_down", door: "Vehicles" },
    { key: "ordered", label: "Trucks on order", value: ordered.value, caption: "not in service yet", to: "/vehicles?status=ordered", door: "Vehicles" },
  ]);

  const seatedCount = computed(() => (running.value && noDriver.value != null ? running.value.length - noDriver.value : null));
  return { running, seatedCount, rows };
}
