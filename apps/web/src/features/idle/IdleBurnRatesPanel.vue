<script setup lang="ts">
import { computed } from "vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { burnRateRows, useIdleBurnRates } from "./useIdleBurnRates";

/**
 * IE4, D-IE5: the measured burn rate beside the configured one, until the owner accepts the switch.
 * Shown under "How idle is scored", because it is the other half of how an idle hour becomes money.
 */
const { data, isLoading, isError, error, isFetching, refetch } = useIdleBurnRates();
const rows = computed(() => (data.value ? burnRateRows(data.value) : []));
const gph = (n: number) => n.toFixed(2);

const columns: DataTableColumn[] = [
  { key: "equipment", label: "Equipment" },
  { key: "temperature", label: "Outside temperature" },
  { key: "runningHours", label: "Hours parked, engine on", numeric: true },
  { key: "measured", label: "Gallons per hour, measured", numeric: true },
  { key: "learned", label: "Enough hours?" },
];
</script>

<template>
  <section class="space-y-2">
    <p class="text-sm text-ink-secondary">
      <span class="font-semibold text-ink">Fuel burned while idling.</span>
      <template v-if="data">
        Idle dollars on this page use <strong>{{ gph(data.configuredGalPerHour) }} gallons per hour</strong>, from
        idle settings. Below is what the trucks' own fuel counters measured while parked with the engine on, over
        the last 60 days. A measurement is trusted once its group has {{ data.minHours }} hours; before that, the
        starting estimate of {{ gph(data.priorGalPerHour) }} gallons per hour stands in for it.
        <template v-if="data.fleet.measuredGalPerHour != null">
          Whole fleet: <strong>{{ gph(data.fleet.measuredGalPerHour) }}</strong> over {{ data.fleet.runningHours }} hours.
        </template>
      </template>
    </p>
    <DataTable
      dense
      :columns="columns"
      :rows="rows"
      row-key="key"
      :loading="isLoading"
      :error="isError ? (error?.message ?? 'Could not read the idle burn rates') : null"
      :retrying="isFetching"
      empty-text="No parked hours with a fuel reading in the last 60 days yet."
      @retry="refetch"
    >
      <template #cell-measured="{ row }">{{ row.measured == null ? "—" : gph(row.measured) }}</template>
      <template #cell-learned="{ row }">
        <span :class="[BADGE_BASE, toneClass(row.learned ? 'success' : 'neutral')]">
          {{ row.learned ? "Yes — measured rate" : "Not yet — estimate" }}
        </span>
      </template>
    </DataTable>
  </section>
</template>
