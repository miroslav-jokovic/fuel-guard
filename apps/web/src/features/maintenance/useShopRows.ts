import { computed } from "vue";
import { daysSince, todayInZone } from "@silvicom/shared";
import type { CountRow } from "@/components/ui/CountList.vue";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { SHELF_COUNTING_SHOWN } from "@/lib/shelfCounting";
import { useShopSummaryQuery } from "./useShopBacklog";

/**
 * The rows of "Shop", out of the card that draws them — why, in `features/dispatch/useFleetNowRows.ts`.
 *
 * The oldest order's age is the caption under its count, on the carrier's calendar day — `daysSince`,
 * the definition the list's "Open for" column uses, so it matches the page's top row.
 */
export function useShopRows() {
  const { zone } = useOrgTimezone();
  const { data: summary } = useShopSummaryQuery();

  const oldestCaption = computed(() => {
    const at = summary.value?.oldestOpenWorkOrderAt;
    if (!at) return "repairs in progress in FleetPal";
    const days = daysSince(at, todayInZone(new Date(), zone.value), zone.value);
    return days === 0 ? "oldest opened today" : `oldest open ${days === 1 ? "1 day" : `${days} days`}`;
  });

  const rows = computed<CountRow[]>(() => [
    { key: "work-orders", label: "Open work orders", value: summary.value?.openWorkOrders ?? null, caption: oldestCaption.value, to: "/shop/work-orders", door: "Work orders" },
    { key: "defects", label: "Open defects", value: summary.value?.unresolvedDefects ?? null, caption: "found on inspections, not resolved", to: "/shop/defects", door: "Defects", alarm: true },
    // Shelf counting is hidden (Q-MX8, `lib/shelfCounting.ts`), and with it the row that counts shelves to reorder.
    ...(SHELF_COUNTING_SHOWN
      ? [{ key: "low-stock", label: "Shelves to reorder", value: summary.value?.lowStockLines ?? null, caption: "at or below their reorder point", to: "/shop/inventory?stock=low", door: "Shop parts" }]
      : []),
    { key: "annual-dates", label: "Annual dates to check", value: summary.value?.annualDisagreements ?? null, caption: "FleetPal and our record disagree", to: "/shop/annual-dates", door: "Annual dates" },
  ]);
  return { rows };
}
