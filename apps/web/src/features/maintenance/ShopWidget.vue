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
import { WrenchIcon } from "@silvicom/ui/icons";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList from "@/components/ui/CountList.vue";
import { useShopRows } from "./useShopRows";

const { rows } = useShopRows();
</script>

<template>
  <ChartCard title="Shop" subtitle="What is broken or waiting on the shop" :icon="WrenchIcon" tone="warning" class="h-full">
    <CountList :rows="rows" />
  </ChartCard>
</template>
