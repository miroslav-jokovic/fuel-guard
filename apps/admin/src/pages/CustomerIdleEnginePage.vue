<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import {
  DECLARED_EQUIPMENT_LABELS,
  IDLE_BURN_LEARN_DAYS,
  IDLE_BURN_SOURCE_LABELS,
  IDLE_PARITY,
  formatDisplayDate,
  idleParityStage,
} from "@silvicom/shared";
import { AppBadge, AppButton, AppCard, AppPageHeader, DataTable, QueryState, StatCard, type DataTableColumn } from "@silvicom/ui";
import AppShell from "@/layouts/AppShell.vue";
import { useIdleEngineQuery } from "@/lib/queries";

/**
 * IE-ADMIN (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md §4 Q-FSV15 ruling 3, Q-FSV17): one customer's idle
 * engine rollout checks — D-IE9's parity gate and D-IE5's learned burn rates. They are release controls
 * nobody in a carrier's office can act on, so they live on the platform plane. The verdicts are
 * `@silvicom/shared`'s, served by `GET /admin/orgs/:id/idle-engine`; this page only lays them out. Since
 * Q-FSV17 step (3) it is the only screen that shows the gate (the office Idling page keeps the burn
 * rates, beside the carrier's "use measured rates" switch).
 */
const route = useRoute();
const id = computed(() => String(route.params.id));
const checks = useIdleEngineQuery(id);
const parity = computed(() => checks.data.value?.parity ?? null);
const burn = computed(() => checks.data.value?.burnRates ?? null);

const STAGE = {
  pass: { label: "Ready to switch", tone: "success" },
  checking: { label: "Still checking", tone: "neutral" },
  disagreeing: { label: "Not agreeing yet", tone: "warning" },
} as const;
const stage = computed(() => (parity.value ? STAGE[idleParityStage(parity.value)] : null));
// Floored: 94.96% must not read as the 95% bar.
const share = computed(() => (parity.value?.share == null ? null : Math.floor(parity.value.share * 1000) / 10));
const pct = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`);
const gph = (n: number | null) => (n == null ? "—" : n.toFixed(2));

const DISAGREEMENT_COLUMNS: DataTableColumn[] = [
  { key: "unit", label: "Truck", cellClass: "text-ink" },
  { key: "judgedDays", label: "Days checked", numeric: true },
  { key: "failedDays", label: "Days that did not match", numeric: true },
  { key: "gapDays", label: "Days with data missing", numeric: true },
  { key: "worstRunningDiff", label: "Worst engine-hours miss", numeric: true },
  { key: "worstStoppedDiff", label: "Idling vs Samsara", numeric: true },
];
const BURN_COLUMNS: DataTableColumn[] = [
  { key: "equipment", label: "Equipment", cellClass: "text-ink" },
  { key: "label", label: "Outside temperature" },
  { key: "trucks", label: "Trucks", numeric: true },
  { key: "runningHours", label: "Hours parked, engine on", numeric: true },
  { key: "measuredGalPerHour", label: "Gallons per hour, measured", numeric: true },
  { key: "ci95", label: "Accuracy (95%)", numeric: true },
  { key: "source", label: "Rate used" },
];
</script>

<template>
  <AppShell>
    <AppPageHeader
      title="Idle engine checks"
      description="Whether the new idle measurement can replace today's figures for this customer, and what their engines burn while parked."
    >
      <template #back>
        <AppButton size="sm" variant="ghost" :to="{ name: 'customer', params: { id } }">← Customer</AppButton>
      </template>
    </AppPageHeader>

    <QueryState
      class="mt-5"
      :loading="checks.isPending.value"
      :error="checks.error.value"
      error-text="Could not load the idle engine checks."
      not-found-text="No customer has that id."
      loading-text="Loading the idle engine checks…"
      :retrying="checks.isFetching.value"
      @retry="() => checks.refetch()"
    >
      <template v-if="parity && burn">
        <AppCard>
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold text-ink-secondary">Parity gate</h2>
            <AppBadge v-if="stage" :tone="stage.tone">{{ stage.label }}</AppBadge>
          </div>
          <p class="mt-1 text-sm text-ink-muted">
            Passes when engine hours agree with each truck's own computer within
            {{ IDLE_PARITY.runningTolerance * 100 }}% on {{ IDLE_PARITY.passShare * 100 }}% of truck-days over
            {{ IDLE_PARITY.minDays }} finished days. Idling against Samsara's is shown, not judged: Samsara starts
            counting a stop as idling only after 2–3 minutes, so ours reads higher by design. A day where ours
            is missing {{ IDLE_PARITY.maxNoDataSec / 3600 }} hour or more that Samsara recorded whole fails, however
            the engine hours compare.
          </p>
          <div class="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Finished days" :value="`${parity.days.length}/${IDLE_PARITY.minDays}`" />
            <StatCard label="Final through" :value="parity.finalThrough ? formatDisplayDate(parity.finalThrough) : '—'" />
            <StatCard label="Truck-days agreeing" :value="share == null ? '—' : `${share}%`" :sub="`of ${parity.truckDays.judged}`" />
            <StatCard
              label="Idling vs Samsara"
              :value="`${parity.truckDays.stoppedPassed}/${parity.truckDays.stoppedJudged}`"
              :sub="`within ${IDLE_PARITY.stoppedTolerance * 100}%`"
            />
          </div>
          <p class="mt-3 text-xs text-ink-muted">Days are local to {{ parity.timezone }}.</p>
        </AppCard>

        <AppCard padding="none" class="mt-4">
          <h2 class="px-5 pt-5 text-sm font-semibold text-ink-secondary">Trucks that did not match</h2>
          <DataTable
            class="mt-3"
            embedded
            :columns="DISAGREEMENT_COLUMNS"
            :rows="parity.disagreements"
            row-key="vehicleId"
            :empty-text="parity.truckDays.judged === 0 ? 'No finished day checked yet.' : 'Every checked truck-day matched.'"
          >
            <template #cell-worstRunningDiff="{ value }">{{ pct(value) }}</template>
            <template #cell-worstStoppedDiff="{ value }">{{ pct(value) }}</template>
          </DataTable>
        </AppCard>

        <AppCard padding="none" class="mt-4">
          <div class="px-5 pt-5">
            <h2 class="text-sm font-semibold text-ink-secondary">Fuel burned while idling</h2>
            <p class="mt-1 text-sm text-ink-muted">
              Idle dollars use <strong class="text-ink">{{ gph(burn.configuredGalPerHour) }} gallons per hour</strong>, from
              the customer's idle settings. For the new idle measurement the customer has chosen
              <strong class="text-ink">{{ burn.pricing === "learned" ? "the rates measured by their trucks" : "that configured rate" }}</strong>
              (their Idling page; it reaches their figures when the new measurement replaces the old). Below is what the trucks' own fuel counters measured while parked with
              the engine on, over the last {{ IDLE_BURN_LEARN_DAYS }} days.
              Only whole hours parked with no driving either side count. A group's measurement is trusted once
              it comes from at least {{ burn.minTrucks }} trucks and is accurate to within
              {{ Math.round(burn.maxCi95 * 100) }}% (95% confidence); until then the nearest trusted figure stands
              in — the same equipment at any temperature, else the whole fleet, else the starting estimate of
              {{ gph(burn.priorGalPerHour) }} gallons per hour.
              <template v-if="burn.fleet.measuredGalPerHour != null">
                Whole fleet: <strong class="text-ink">{{ gph(burn.fleet.measuredGalPerHour) }}</strong> over
                {{ burn.fleet.runningHours }} hours.
              </template>
            </p>
          </div>
          <DataTable
            class="mt-3"
            embedded
            :columns="BURN_COLUMNS"
            :rows="burn.cells"
            :row-key="(c) => `${c.equipment}|${c.band ?? ''}`"
            :empty-text="`No parked hours with a fuel reading in the last ${IDLE_BURN_LEARN_DAYS} days yet.`"
          >
            <template #cell-equipment="{ value }">{{ DECLARED_EQUIPMENT_LABELS[value as keyof typeof DECLARED_EQUIPMENT_LABELS] }}</template>
            <template #cell-measuredGalPerHour="{ value }">{{ gph(value) }}</template>
            <template #cell-ci95="{ value }">{{ value == null ? "—" : `±${(value * 100).toFixed(1)}%` }}</template>
            <template #cell-source="{ row }">
              <AppBadge :tone="row.learned ? 'success' : 'neutral'">{{ IDLE_BURN_SOURCE_LABELS[row.source as keyof typeof IDLE_BURN_SOURCE_LABELS] }}</AppBadge>
            </template>
          </DataTable>
        </AppCard>
      </template>
    </QueryState>
  </AppShell>
</template>
