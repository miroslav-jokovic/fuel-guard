import { computed } from "vue";
import { BOARD_HOS_LOW_MS } from "@silvicom/shared";
import type { CountRow } from "@/components/ui/CountList.vue";
import { useDispatchBoardQuery } from "./useDispatchBoard";
import { boardDoor, boardRows, queueLabel } from "./boardCounts";
import type { BoardQueue } from "./dispatchBoardView";

/**
 * The rows of "On the road", out of the card that draws them — why, in `useFleetNowRows.ts`.
 *
 * One row per board exception queue, counted by the board's own filter and named with the board's own
 * label, each linking to that queue (D-FM7).
 */
export function useRoadAttentionRows() {
  const { data: board } = useDispatchBoardQuery();
  const count = (q: BoardQueue) => (board.value ? boardRows(board.value, q).length : null);
  const hosHours = BOARD_HOS_LOW_MS / 3_600_000;

  const rows = computed<CountRow[]>(() => [
    { key: "late", label: queueLabel("late"), value: count("late"), caption: "loads late or at risk of it", to: boardDoor("late"), door: "Review", alarm: true },
    { key: "hos-low", label: queueLabel("hos-low"), value: count("hos-low"), caption: `drivers under ${hosHours} h of drive time, with a load`, to: boardDoor("hos-low"), door: "Review", alarm: true },
    { key: "no-gps", label: queueLabel("no-gps"), value: count("no-gps"), caption: "trucks not reporting a position", to: boardDoor("no-gps"), door: "Review" },
    { key: "no-next", label: queueLabel("no-next"), value: count("no-next"), caption: "hauling now, nothing booked after", to: boardDoor("no-next"), door: "Plan" },
    {
      key: "uncovered",
      label: "Uncovered loads",
      value: board.value?.uncoveredCount ?? null,
      caption: "open loads no truck carries",
      to: "/loads?queue=uncovered&scope=all",
      door: "Cover",
    },
  ]);
  return { board, rows };
}
