<script setup lang="ts">
/**
 * Shop — what is broken or waiting on the shop? (FLEET-MANAGER-HOME-PLAN §4 card 5, FM3).
 *
 * Four counts from `GET /api/maintenance/shop-summary`, each the length of the list its door opens
 * (D-FM7, D-FM9): FleetPal's open work orders (`/shop/work-orders`), its open defects
 * (`/shop/defects`), the shelves at their reorder point (the Parts page's own `?stock=low` view,
 * whose reader the endpoint calls), and the units whose annual date FleetPal and our record disagree
 * on (`/shop/annual-dates`, DISPATCH-BOARD-V2-PLAN Q-DBV2). Q-FM6 (a) built the first two lists so
 * these figures could have doors at all.
 *
 * No money (D-FM6): repair spend stays on the shop home, behind its own screen. No severity: FleetPal
 * sends none (52 of 52 null, 2026-10-13). The oldest order's age is the caption under its count, on
 * the carrier's calendar day — `daysSince`, the definition the list's "Open for" column uses, so it
 * matches the page's top row.
 */
import { computed } from "vue";
import { WrenchIcon } from "@silvicom/ui/icons";
import { daysSince, todayInZone } from "@silvicom/shared";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList, { type CountRow } from "@/components/ui/CountList.vue";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { SHELF_COUNTING_SHOWN } from "@/lib/shelfCounting";
import { useShopSummaryQuery } from "./useShopBacklog";

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
</script>

<template>
  <ChartCard title="Shop" subtitle="What is broken or waiting on the shop" :icon="WrenchIcon" tone="warning" class="h-full">
    <CountList :rows="rows" />
  </ChartCard>
</template>
