import { computed } from "vue";
import { isOnDispatchBoard, matchesVehicleCheck, seatedDriverIds, type Vehicle } from "@silvicom/shared";
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
 *
 * ── THE BOARD'S TRUCKS, NOT A SECOND TOTAL (FLEET-MANAGER-HOME-PLAN D-FM10, 2026-11-26) ─────────
 * Population: `isOnDispatchBoard` — the trucks Fleet right now totals as "Trucks on the board", the
 * truck in the shop included. Every other truck in service is ONE line, "Off the board", its caption
 * splitting it into the reasons, which partition it. Ordered trucks are not in service and are not a
 * seat question; the Vehicles page lists them under status "ordered".
 *
 * The doors carry `status=any` because the board's trucks include the shop's (`maintenance`) and the
 * Vehicles page opens on `active`: without it, "4 without a driver" would open a list of 3.
 */
export function useSeatsRows() {
  const session = useSessionStore();
  const { data: vehicles } = useVehiclesQuery();
  const { data: drivers } = useDriversQuery();

  // The card reads no loads (they are `dispatch`'s), hence `false` — the one gap, at `isOnDispatchBoard`.
  const onBoard = computed(() => (vehicles.value ? vehicles.value.filter((v) => isOnDispatchBoard(v, false)) : null));
  // The seat checks ask nothing of a truck's file, so none is passed (`matchesVehicleCheck`).
  const noDriver = computed(() =>
    vehicles.value ? vehicles.value.filter((v) => matchesVehicleCheck(v, "no_driver", undefined)).length : null,
  );
  const offBoard = computed(() => (vehicles.value ? vehicles.value.filter((v) => matchesVehicleCheck(v, "off_board", undefined)) : null));
  const unseated = computed(() => {
    if (!vehicles.value || !drivers.value) return null;
    const seated = seatedDriverIds(vehicles.value);
    return drivers.value.filter((d) => d.status === "active" && !d.archived_at && !seated.has(d.id)).length;
  });

  const rows = computed<CountRow[]>(() => [
    { key: "no-driver", label: "Trucks on the board without a driver", value: noDriver.value, caption: "nobody assigned, trucks in the shop included", to: "/vehicles?status=any&check=no_driver", door: "Vehicles", alarm: true },
    ...(session.canView("roster")
      ? [{ key: "no-truck", label: "Drivers without a truck", value: unseated.value, caption: "active drivers holding no truck", to: "/drivers?status=active&seat=none", door: "Drivers" }]
      : []),
    { key: "off-board", label: "Off the board", value: offBoard.value?.length ?? null, caption: offBoardCaption(offBoard.value), to: "/vehicles?status=any&check=off_board", door: "Vehicles" },
  ]);

  const seatedCount = computed(() => (onBoard.value && noDriver.value != null ? onBoard.value.length - noDriver.value : null));
  return { onBoard, seatedCount, rows };
}

/**
 * Why each off-board truck is off, as a partition of the line's figure: wound down first (whatever its
 * status), then the pool's in-shop and parked trucks — a truck in service that is neither wound down nor
 * in the pool is on the board, so the last two are the pool's by construction. A driver still assigned
 * to one is said, because that driver counts as holding a truck that is on no board (units 664 and
 * 683 on 2026-11-26).
 */
export function offBoardCaption(trucks: readonly Pick<Vehicle, "status" | "winding_down" | "assigned_driver_id">[] | null): string | undefined {
  if (!trucks) return undefined;
  if (trucks.length === 0) return "every truck in service is on the board";
  const wound = trucks.filter((v) => v.winding_down === true).length;
  const shop = trucks.filter((v) => v.winding_down !== true && v.status === "maintenance").length;
  const parked = trucks.length - wound - shop;
  const held = trucks.filter((v) => v.assigned_driver_id != null).length;
  return [
    parked ? `${parked} parked in the Unassigned pool` : null,
    shop ? `${shop} in the shop` : null,
    wound ? `${wound} sold or retiring` : null,
    held ? `${held} still ${held === 1 ? "has" : "have"} a driver` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
