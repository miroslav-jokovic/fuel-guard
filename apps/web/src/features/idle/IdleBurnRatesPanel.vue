<script setup lang="ts">
import { computed } from "vue";
import { AppRadioGroup as RadioGroup } from "@silvicom/ui";
import type { IdleBurnPricing } from "@silvicom/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { burnRateRows, useIdleBurnRates } from "./useIdleBurnRates";
import { useSetIdleBurnPricing } from "./useIdleSettings";

/**
 * IE4, D-IE5: the measured burn rate beside the configured one, and the carrier's switch between them
 * (0420, §4 Q-IE14). Shown under "How idle is scored", because it is the other half of how an idle hour
 * becomes money. The switch sits beside the table on purpose: a manager reads the measured rates before
 * choosing them. It prices the idle engine's figures, which reach this page at IE5b; until then the
 * page's dollars stay at the configured rate whatever is chosen, and the wording says so.
 *
 * Offered behind `session.can("safety")`, the same section × role matrix `idle_settings_write` (0300)
 * checks, so a role the database would refuse never sees a control.
 */
const { data, isLoading, isError, error, isFetching, refetch } = useIdleBurnRates();
const rows = computed(() => (data.value ? burnRateRows(data.value) : []));
const gph = (n: number) => n.toFixed(2);

const session = useSessionStore();
const toast = useToastStore();
const setPricing = useSetIdleBurnPricing();
const pricingOptions = computed(() => [
  { value: "configured", label: `Idle settings — ${data.value ? gph(data.value.configuredGalPerHour) : "…"} gallons per hour` },
  { value: "learned", label: "Measured by your trucks — the rate used, row by row, in the table above" },
]);
const pricingWords: Record<IdleBurnPricing, string> = { configured: "idle settings", learned: "measured by your trucks" };
async function onPricing(v: string | number) {
  try {
    await setPricing.mutateAsync(v as IdleBurnPricing);
    toast.success("Idle rate saved");
  } catch (e) {
    toast.error("Couldn't save the idle rate", e instanceof Error ? e.message : undefined);
  }
}

const columns: DataTableColumn[] = [
  { key: "equipment", label: "Equipment" },
  { key: "temperature", label: "Outside temperature" },
  { key: "trucks", label: "Trucks", numeric: true },
  { key: "runningHours", label: "Hours parked, engine on", numeric: true },
  { key: "measured", label: "Gallons per hour, measured", numeric: true },
  { key: "learned", label: "Rate used" },
];
</script>

<template>
  <section class="space-y-2">
    <p class="text-sm text-ink-secondary">
      <span class="font-semibold text-ink">Fuel burned while idling.</span>
      <template v-if="data">
        Idle dollars on this page use <strong>{{ gph(data.configuredGalPerHour) }} gallons per hour</strong>, from
        idle settings. Below is what the trucks' own fuel counters measured while parked with the engine on, over
        the last 60 days, counting only whole hours parked with no driving either side. A group's measurement is
        trusted once it comes from at least {{ data.minTrucks }} trucks and is accurate to within
        {{ Math.round(data.maxCi95 * 100) }}%; until then the nearest trusted figure stands in — the same equipment
        at any temperature, else the whole fleet, else the starting estimate of {{ gph(data.priorGalPerHour) }}
        gallons per hour.
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
          {{ row.status }}
        </span>
      </template>
    </DataTable>
    <div v-if="data" class="space-y-1 text-sm text-ink-secondary">
      <RadioGroup
        v-if="session.can('safety')"
        legend="Rate for the new idle measurement"
        :model-value="data.pricing"
        :options="pricingOptions"
        :disabled="setPricing.isPending.value"
        @update:model-value="onPricing"
      />
      <p v-else>
        The new idle measurement uses the rate <strong>{{ pricingWords[data.pricing] }}</strong>.
      </p>
      <p class="text-ink-tertiary">
        The new measurement replaces this page's idle figures once its checks pass. Until then this choice
        changes no figure on this page.
      </p>
    </div>
  </section>
</template>
