import { computed } from "vue";
import { isInServiceVehicleStatus, matchesVehicleCheck, VEHICLE_CHECK_LABELS, type VehicleCheck } from "@silvicom/shared";
import type { CountRow } from "@/components/ui/CountList.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useUnitFilesQuery } from "@/composables/useCompliance";
import { PAPERS, PAPER_STATES, paperCheck, paperStateLabel, type Paper } from "./truckPapersGrid";

export interface PaperCell { check: VehicleCheck; value: number | null; to: string; alarm: boolean }

/**
 * The counts of "Truck paperwork", out of the card that draws them — why, in
 * `features/dispatch/useFleetNowRows.ts`.
 *
 * Two shapes of the same eight figures: `grid` is what the card draws (four states by two papers,
 * `truckPapersGrid.ts`), and `rows` is the same cells flat, each under the shared check label
 * (`VEHICLE_CHECK_LABELS` — "Annual inspection: overdue"), for a reader that lists rows rather than
 * a grid. `rows` is derived FROM `grid`, so the two cannot disagree.
 *
 * Both reads must be in before a count is shown — a truck whose file has not arrived answers no to
 * every paper check, and a zero printed then would be a claim, so the figure is `null`.
 */
export function useTruckPapersRows() {
  const { data: vehicles } = useVehiclesQuery();
  const unitFilesQ = useUnitFilesQuery("tractor");
  const fileById = computed(() =>
    unitFilesQ.data.value ? new Map(unitFilesQ.data.value.units.map((u) => [u.subject_id, u])) : null,
  );

  const count = (check: VehicleCheck) => {
    const files = fileById.value;
    if (!vehicles.value || !files) return null;
    // The fleet the Trucks card totals and the Vehicles page opens on (D-FM11): a truck in the shop still
    // needs its papers, and it was left out here while the door's list opened on `active` too.
    return vehicles.value.filter((v) => isInServiceVehicleStatus(v.status) && matchesVehicleCheck(v, check, files.get(v.id))).length;
  };

  const grid = computed(() =>
    PAPER_STATES.map((state) => ({
      state,
      label: paperStateLabel(PAPERS[0], state),
      cells: Object.fromEntries(
        PAPERS.map((paper) => {
          const check = paperCheck(paper, state);
          return [paper.key, { check, value: count(check), to: `/vehicles?check=${check}`, alarm: state === "overdue" }];
        }),
      ) as Record<Paper["key"], PaperCell>,
    })),
  );

  const rows = computed<CountRow[]>(() =>
    PAPERS.flatMap((paper) =>
      grid.value.map((r) => {
        const cell = r.cells[paper.key];
        return { key: cell.check, label: VEHICLE_CHECK_LABELS[cell.check], value: cell.value, caption: "active trucks", to: cell.to, door: "Vehicles", alarm: cell.alarm };
      }),
    ),
  );
  return { grid, rows };
}
