<script setup lang="ts">
import { computed } from "vue";
import { AppBadge } from "@silvicom/ui";
import { stockLevelBadge } from "@/lib/badges";
import type { StockLevel } from "@silvicom/shared";

/**
 * On-hand, with its level (INVENTORY-PLAN.md I4).
 *
 * A component rather than an inline `#cell-` template because two surfaces render it — the Parts
 * page's low-stock view and the part detail's shelves — and the badge must not be decided twice.
 * `InspectionExpiryCell` is the same shape for the same reason.
 *
 * The verdict is `stockLevelBadge`'s and that asks `isLowStock`, so the rule lives once, in
 * `inventoryRules.ts`, where the API reads it too. Nothing here compares a quantity to anything.
 */
const props = defineProps<{ line: StockLevel }>();

const badge = computed(() => stockLevelBadge(props.line));
</script>

<template>
  <span class="inline-flex items-center gap-2">
    <span class="font-semibold tabular-nums">{{ line.quantityOnHand }}</span>
    <AppBadge v-if="badge" :tone="badge.tone">{{ badge.label }}</AppBadge>
  </span>
</template>
