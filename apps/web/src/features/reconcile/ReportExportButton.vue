<script setup lang="ts">
import { computed } from "vue";
import ExportButton from "@/components/ExportButton.vue";

/**
 * Generate the fuel-spend report for whatever the page is currently filtered to.
 *
 * ── WHY IT LIVES ON THE PAGE AND NOT ON ONE TAB ─────────────────────────────────────────────────
 * It used to sit inside "Spend & trend", so from the California or ONE9 tab there was no way to
 * produce anything — even though the report covers those sections. The document is about the whole
 * page, so the control belongs beside the filters that define it.
 *
 * ── WHAT IS LEFT HERE AFTER FUEL-P2 ─────────────────────────────────────────────────────────────
 * Only the two things that are the spend REPORT's: its address, and the fact that its scope is a
 * window plus a truck count. The button, the busy state, the toast and the scope line moved to
 * `components/ExportButton.vue` when P2 put an export on five more surfaces — five near-identical
 * controls is how a section grows five that look almost but not quite alike.
 */
const props = defineProps<{
  /** Everything the server needs, already encoded — see `useSpendFilters.asQuery`. */
  query: string;
  from: string;
  to: string;
  grain: string;
  /** How many trucks are selected; 0 means the whole fleet. */
  truckCount: number;
  disabled?: boolean;
}>();

const days = computed(() =>
  Math.round((Date.parse(`${props.to}T00:00:00Z`) - Date.parse(`${props.from}T00:00:00Z`)) / 86_400_000) + 1,
);
const scope = computed(
  () => `${props.from} → ${props.to} · ${days.value} days · ${props.truckCount === 0 ? "all trucks" : `${props.truckCount} truck${props.truckCount === 1 ? "" : "s"}`}`,
);
</script>

<template>
  <ExportButton
    :href="`/api/fueling/spend-report.pdf?${query}`"
    :filename="`fuelguard-fuel-spend-${from}-to-${to}.pdf`"
    :scope="scope"
    label="Export report"
    variant="secondary"
    :disabled="disabled"
  />
</template>
