<script setup lang="ts">
import { computed } from "vue";
import { formatDisplayDate } from "@silvicom/shared";
import ExportButton from "@/components/ExportButton.vue";

/**
 * Generate the Fuel Costs report as a document, for the days and filters the page is showing.
 *
 * ── WHAT CHANGED AT FS-PDF (Q-FSV14) ──────────────────────────────────────────────────────────────
 * This used to ask `/api/fueling/spend-report.pdf`, which took dates, grain and trucks and nothing else, so a
 * page filtered to Texas exported every state, and it compared the last two weekly buckets while the page
 * compares the whole range with the equal-length range before it. It now asks `/api/fueling/report.pdf` with
 * the screen's own query string (`fuelReportQuery`), validated by the same parser as the screen's report, and
 * the document prints the screen's figures. The old endpoint stays for its other callers; this does not use it.
 *
 * Only two things are the report's own here: the address and the scope line (window, trucks, stations). The
 * button, busy state and toast moved to `components/ExportButton.vue` when export reached five more surfaces.
 */
const props = defineProps<{
  /** Everything the server needs, already encoded — `fuelReportQuery(params)`. */
  query: string;
  from: string;
  to: string;
  /** How many trucks are selected; 0 means the whole fleet. */
  truckCount: number;
  /** Whether a state, location or network filter narrows the figures. */
  stationFiltered: boolean;
  disabled?: boolean;
}>();

const days = computed(() =>
  Math.round((Date.parse(`${props.to}T00:00:00Z`) - Date.parse(`${props.from}T00:00:00Z`)) / 86_400_000) + 1,
);
const scope = computed(
  () =>
    `${formatDisplayDate(props.from)} → ${formatDisplayDate(props.to)} · ${days.value} days · ` +
    `${props.truckCount === 0 ? "all trucks" : `${props.truckCount} truck${props.truckCount === 1 ? "" : "s"}`} · ` +
    (props.stationFiltered ? "filtered stations" : "all stations"),
);
</script>

<template>
  <ExportButton
    :href="`/api/fueling/report.pdf?${query}`"
    :filename="`silvicom-fuel-costs-${from}-to-${to}.pdf`"
    :scope="scope"
    label="Export report"
    variant="secondary"
    :disabled="disabled"
  />
</template>
