<script setup lang="ts">
/**
 * Hazmat to review (FLEET-MANAGER-HOME-PLAN §4 card 8) — the nav badge's own count
 * (`GET /api/hazmat/review-count`, `status = needs_review`), so the card, the badge and the queue it
 * opens are one number. Catalogued with `module: "hazmatguard"`, so an org without the module never
 * mounts it and the query is always allowed when it runs.
 */
import { ShieldExclamationIcon } from "@silvicom/ui/icons";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList from "@/components/ui/CountList.vue";
import { useHazmatReviewRows } from "./useHazmatReviewRows";

const { rows } = useHazmatReviewRows();
</script>

<template>
  <ChartCard title="Hazmat to review" subtitle="Before the load moves" :icon="ShieldExclamationIcon" tone="warning" class="h-full">
    <CountList :rows="rows" />
  </ChartCard>
</template>
