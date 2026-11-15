import { computed } from "vue";
import type { CountRow } from "@/components/ui/CountList.vue";
import { useDispatchBoardQuery } from "./useDispatchBoard";
import { boardDoor, fleetNow, queueLabel } from "./boardCounts";

/**
 * The rows of "Fleet right now", out of the card that draws them (SMALL-SCREENS-PLAN.md D-SM12, C2).
 *
 * Every Operations card computed its rows inside its own `.vue` until 2026-11-15, so nothing but that
 * card could read them. The tab's "Needs action" card lists rows from all ten, and a second
 * computation of any of them would be a second answer to one question — so each card's rows now live
 * in a composable beside it, the card draws them, and the registry in `lib/opsRowSources.ts` reads
 * the same refs.
 *
 * Shares the board's query key, so a second reader costs no request.
 */
export function useFleetNowRows() {
  const { data: board } = useDispatchBoardQuery();
  const now = computed(() => (board.value ? fleetNow(board.value) : null));

  const pct = (n: number | undefined) =>
    now.value && now.value.total > 0 && n != null ? `${Math.round((n / now.value.total) * 100)}% of the board` : undefined;

  const rows = computed<CountRow[]>(() => [
    { key: "loaded", label: "Hauling a load", value: now.value?.loaded ?? null, caption: pct(now.value?.loaded) },
    { key: "empty", label: queueLabel("empty"), value: now.value?.empty ?? null, caption: pct(now.value?.empty), to: boardDoor("empty"), door: "Find a load" },
    { key: "in-shop", label: "In the shop", value: now.value?.inShop ?? null, caption: pct(now.value?.inShop) },
  ]);
  return { now, rows };
}
