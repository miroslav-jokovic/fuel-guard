import { computed } from "vue";
import { shiftDay, todayInZone } from "@silvicom/shared";
import type { CountRow } from "@/components/ui/CountList.vue";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useFleetWidgetData } from "../fleetWidgetData";

/**
 * The rows of the Operations "Fuel" card, out of the card that draws them — why, in
 * `features/dispatch/useFleetNowRows.ts`.
 *
 * ── ITS WINDOW IS FIXED (D-FM5) ──────────────────────────────────────────────────────────────────
 * The Dashboard's own default — the last 30 days to the carrier's today — decided here so every
 * reader of these rows reads the same window the card prints.
 */
export function useOpsFuelRows() {
  const { zone } = useOrgTimezone();
  const range = computed(() => {
    const today = todayInZone(new Date(), zone.value);
    return { from: shiftDay(today, -30), to: today };
  });
  const data = useFleetWidgetData(range);

  const rows = computed<CountRow[]>(() => [
    { key: "cases", label: "Open fuel cases", value: data.s.value?.openAnomalies ?? null, caption: "open now", to: "/anomalies", door: "Cases" },
    { key: "idle", label: "Idle hours", value: data.s.value?.idleHours ?? null, caption: data.rangeLabel.value, to: "/idling", door: "Idling" },
  ]);
  return { ...data, rows };
}
