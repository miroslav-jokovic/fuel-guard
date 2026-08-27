<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { apiDownload } from "@/lib/api";
import { useToastStore } from "@/stores/toast";

/**
 * Generate the fuel-spend report for whatever the page is currently filtered to.
 *
 * ── WHY IT LIVES ON THE PAGE AND NOT ON ONE TAB ─────────────────────────────────────────────────
 * It used to sit inside "Spend & trend", so from the California or ONE9 tab there was no way to
 * produce anything — even though the report covers those sections. The document is about the whole
 * page, so the control belongs beside the filters that define it.
 *
 * ── WHY IT NAMES ITS OWN SCOPE ──────────────────────────────────────────────────────────────────
 * The filter bar already controls the period and the trucks, and the export has always followed it —
 * but nothing SAID so, so a 90-day default read as "the report is stuck on three months" rather than
 * as "the filter is set to three months". The button states the range and the truck count it will use,
 * which turns an invisible coupling into an obvious one.
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

const toast = useToastStore();
const busy = ref(false);

const days = computed(() =>
  Math.round((Date.parse(`${props.to}T00:00:00Z`) - Date.parse(`${props.from}T00:00:00Z`)) / 86_400_000) + 1,
);
const scope = computed(
  () => `${props.from} → ${props.to} · ${days.value} days · ${props.truckCount === 0 ? "all trucks" : `${props.truckCount} truck${props.truckCount === 1 ? "" : "s"}`}`,
);

async function run() {
  if (busy.value) return;
  busy.value = true;
  try {
    await apiDownload(
      `/api/fueling/spend-report.pdf?${props.query}`,
      `fuelguard-fuel-spend-${props.from}-to-${props.to}.pdf`,
    );
  } catch (e) {
    toast.error("Could not build the report", e instanceof Error ? e.message : undefined);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex items-center gap-2">
    <span class="hidden text-2xs text-ink-tertiary sm:inline">{{ scope }}</span>
    <BaseButton variant="secondary" :disabled="disabled || busy" @click="run">
      {{ busy ? "Building…" : "Export report" }}
    </BaseButton>
  </div>
</template>
