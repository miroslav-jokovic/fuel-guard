<script setup lang="ts">
import { computed } from "vue";
import { IDLE_PARITY, formatDisplayDate } from "@silvicom/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useIdleEngineParity } from "./useIdleEngineParity";

/**
 * IE5, D-IE9: the new idle engine runs beside today's figures until it has agreed with the trucks' own
 * computers — engine hours within 3%, idling within 5% of Samsara's — on 95% of truck-days over 14
 * finished days. This says how far along that is, and which trucks disagree.
 */
const { data, isLoading, isError, error, isFetching, refetch } = useIdleEngineParity();
const pct = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`);
const share = computed(() => (data.value?.share == null ? null : Math.floor(data.value.share * 1000) / 10));
const rows = computed(() => (data.value?.disagreements ?? []).map((d) => ({ ...d, key: d.vehicleId })));
const status = computed(() => {
  const d = data.value;
  if (!d) return null;
  if (d.pass) return { label: "Ready to switch", tone: "success" };
  if (d.daysNeeded > 0) return { label: "Still checking", tone: "neutral" };
  return { label: "Not agreeing yet", tone: "warning" };
});

const columns: DataTableColumn[] = [
  { key: "unit", label: "Truck" },
  { key: "judgedDays", label: "Days checked", numeric: true },
  { key: "failedDays", label: "Days that did not match", numeric: true },
  { key: "worstRunningDiff", label: "Worst engine-hours miss", numeric: true },
  { key: "worstStoppedDiff", label: "Worst idling miss", numeric: true },
];
</script>

<template>
  <section class="space-y-2">
    <p class="text-sm text-ink-secondary">
      <span class="font-semibold text-ink">Measurement update status.</span>
      A new way of measuring idling runs beside the figures above. It replaces them once its engine hours agree
      with each truck's own computer within {{ IDLE_PARITY.runningTolerance * 100 }}%, and its idling with
      Samsara's within {{ IDLE_PARITY.stoppedTolerance * 100 }}%, on {{ IDLE_PARITY.passShare * 100 }}% of
      days over {{ IDLE_PARITY.minDays }} finished days.
      <template v-if="data && status">
        <span :class="[BADGE_BASE, toneClass(status.tone)]" class="ml-1">{{ status.label }}</span>
        <template v-if="data.days.length === 0"> No day is finished yet; the first one is finished by the next nightly run.</template>
        <template v-else>
          {{ data.days.length }} of {{ IDLE_PARITY.minDays }} days finished, through
          {{ formatDisplayDate(data.finalThrough) }}:
          <strong>{{ share }}%</strong> of {{ data.truckDays.judged }} days agree.
        </template>
      </template>
    </p>
    <DataTable
      v-if="isLoading || isError || rows.length > 0"
      dense
      :columns="columns"
      :rows="rows"
      row-key="key"
      :loading="isLoading"
      :error="isError ? (error?.message ?? 'Could not read the idle engine check') : null"
      :retrying="isFetching"
      @retry="refetch"
    >
      <template #cell-worstRunningDiff="{ row }">{{ pct(row.worstRunningDiff) }}</template>
      <template #cell-worstStoppedDiff="{ row }">{{ pct(row.worstStoppedDiff) }}</template>
    </DataTable>
  </section>
</template>
