<script setup lang="ts">
import { computed } from "vue";
import { AppBadge } from "@silvicom/ui";
import type { TruckPmVerdict } from "@silvicom/shared";
import { formatDate } from "@/lib/format";
import { pmVerdictLabel, pmVerdictTone } from "./pmVerdictWords";

/**
 * The Vehicles list's "Next PM due" (FleetPal Q11): the truck's verdict as F11 wrote it — `pmStatus`'s,
 * the same judgement the truck's Due card shows — and the due point beside it. Nothing is judged here.
 * A truck with no FleetPal schedule shows a dash, not "OK": "no schedule" is not a verdict.
 */
const props = defineProps<{ verdict?: TruckPmVerdict | null; dueAt?: string | null; dueOdometer?: number | string | null }>();
const point = computed(() =>
  [props.dueAt ? formatDate(props.dueAt) : null, props.dueOdometer != null ? `at ${Number(props.dueOdometer).toLocaleString("en-US")} mi` : null]
    .filter(Boolean)
    .join(" or "),
);
</script>

<template>
  <span v-if="!verdict" class="text-ink-muted" title="FleetPal has no service schedule for this truck">—</span>
  <span v-else class="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
    <AppBadge :tone="pmVerdictTone(verdict)">{{ pmVerdictLabel(verdict) }}</AppBadge>
    <span v-if="point" class="text-ink-secondary">{{ point }}</span>
  </span>
</template>
