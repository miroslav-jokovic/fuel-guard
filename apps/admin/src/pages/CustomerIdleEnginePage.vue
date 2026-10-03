<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import {
  DECLARED_EQUIPMENT_LABELS,
  IDLE_BURN_LEARN_DAYS,
  IDLE_BURN_SOURCE_LABELS,
  IDLE_PARITY,
  formatDisplayDate,
  idleParityStage,
  type IdleBurnRatesView,
  type IdleEngineParityView,
} from "@silvicom/shared";
import { AppBadge, AppButton, AppCard, AppPageHeader, AppTable } from "@silvicom/ui";
import AppShell from "@/layouts/AppShell.vue";
import { apiGet } from "@/lib/api";

/**
 * IE-ADMIN (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md §4 Q-FSV15 ruling 3, Q-FSV17): one customer's idle
 * engine rollout checks — D-IE9's parity gate and D-IE5's learned burn rates. They are release controls
 * nobody in a carrier's office can act on, so they live on the platform plane. The verdicts are
 * `@silvicom/shared`'s, served by `GET /admin/orgs/:id/idle-engine`, the same functions the office
 * Idling panel reads; this page only lays them out. Until Q-FSV17 step (3) the office panel shows the
 * same gate, and the two must agree on the same night before that panel goes.
 */
const route = useRoute();
const id = route.params.id as string;

const parity = ref<IdleEngineParityView | null>(null);
const burn = ref<IdleBurnRatesView | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    const { idleEngine } = await apiGet<{ idleEngine: { parity: IdleEngineParityView; burnRates: IdleBurnRatesView } }>(
      `/admin/orgs/${id}/idle-engine`,
    );
    parity.value = idleEngine.parity;
    burn.value = idleEngine.burnRates;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Could not load the idle engine checks";
  } finally {
    loading.value = false;
  }
});

const STAGE = {
  pass: { label: "Ready to switch", tone: "success" },
  checking: { label: "Still checking", tone: "neutral" },
  disagreeing: { label: "Not agreeing yet", tone: "warning" },
} as const;
const stage = computed(() => (parity.value ? STAGE[idleParityStage(parity.value)] : null));
// Floored, like the office panel: 94.96% must not read as the 95% bar.
const share = computed(() => (parity.value?.share == null ? null : Math.floor(parity.value.share * 1000) / 10));
const pct = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`);
const gph = (n: number | null) => (n == null ? "—" : n.toFixed(2));
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

    <div v-if="loading" class="mt-4 text-sm text-ink-muted">Loading…</div>
    <div v-else-if="error" class="mt-4 text-sm text-danger-600">{{ error }}</div>

    <template v-else-if="parity && burn">
      <AppCard class="mt-5">
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
        <dl class="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt class="text-xs font-medium uppercase text-ink-muted">Finished days</dt>
            <dd class="mt-1 text-xl font-semibold text-ink">{{ parity.days.length }}<span class="text-base text-ink-muted">/{{ IDLE_PARITY.minDays }}</span></dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase text-ink-muted">Final through</dt>
            <dd class="mt-1 text-xl font-semibold text-ink">{{ parity.finalThrough ? formatDisplayDate(parity.finalThrough) : "—" }}</dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase text-ink-muted">Truck-days agreeing</dt>
            <dd class="mt-1 text-xl font-semibold text-ink">
              {{ share == null ? "—" : `${share}%` }}
              <span class="text-base text-ink-muted">of {{ parity.truckDays.judged }}</span>
            </dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase text-ink-muted">Idling vs Samsara</dt>
            <dd class="mt-1 text-xl font-semibold text-ink">
              {{ parity.truckDays.stoppedPassed }}<span class="text-base text-ink-muted">/{{ parity.truckDays.stoppedJudged }} within {{ IDLE_PARITY.stoppedTolerance * 100 }}%</span>
            </dd>
          </div>
        </dl>
        <p class="mt-3 text-xs text-ink-muted">Days are local to {{ parity.timezone }}.</p>
      </AppCard>

      <AppCard padding="none" class="mt-4">
        <h2 class="px-5 pt-5 text-sm font-semibold text-ink-secondary">Trucks that did not match</h2>
        <AppTable class="mt-3 w-full text-sm">
          <thead class="bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
            <tr>
              <th class="px-5 py-2">Truck</th>
              <th class="px-5 py-2 text-right">Days checked</th>
              <th class="px-5 py-2 text-right">Days that did not match</th>
              <th class="px-5 py-2 text-right">Days with data missing</th>
              <th class="px-5 py-2 text-right">Worst engine-hours miss</th>
              <th class="px-5 py-2 text-right">Idling vs Samsara</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in parity.disagreements" :key="d.vehicleId" class="border-t border-edge-subtle">
              <td class="px-5 py-2 text-ink">{{ d.unit }}</td>
              <td class="px-5 py-2 text-right tabular-nums text-ink-secondary">{{ d.judgedDays }}</td>
              <td class="px-5 py-2 text-right tabular-nums text-ink-secondary">{{ d.failedDays }}</td>
              <td class="px-5 py-2 text-right tabular-nums text-ink-secondary">{{ d.gapDays }}</td>
              <td class="px-5 py-2 text-right tabular-nums text-ink-secondary">{{ pct(d.worstRunningDiff) }}</td>
              <td class="px-5 py-2 text-right tabular-nums text-ink-secondary">{{ pct(d.worstStoppedDiff) }}</td>
            </tr>
            <tr v-if="parity.disagreements.length === 0">
              <td colspan="6" class="px-5 py-6 text-center text-ink-muted">
                {{ parity.truckDays.judged === 0 ? "No finished day checked yet." : "Every checked truck-day matched." }}
              </td>
            </tr>
          </tbody>
        </AppTable>
      </AppCard>

      <AppCard padding="none" class="mt-4">
        <div class="px-5 pt-5">
          <h2 class="text-sm font-semibold text-ink-secondary">Fuel burned while idling</h2>
          <p class="mt-1 text-sm text-ink-muted">
            Idle dollars use <strong class="text-ink">{{ gph(burn.configuredGalPerHour) }} gallons per hour</strong>, from
            the customer's idle settings. Below is what the trucks' own fuel counters measured while parked with
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
        <AppTable class="mt-3 w-full text-sm">
          <thead class="bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
            <tr>
              <th class="px-5 py-2">Equipment</th>
              <th class="px-5 py-2">Outside temperature</th>
              <th class="px-5 py-2 text-right">Trucks</th>
              <th class="px-5 py-2 text-right">Hours parked, engine on</th>
              <th class="px-5 py-2 text-right">Gallons per hour, measured</th>
              <th class="px-5 py-2 text-right">Accuracy (95%)</th>
              <th class="px-5 py-2">Rate used</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in burn.cells" :key="`${c.equipment}|${c.band ?? ''}`" class="border-t border-edge-subtle">
              <td class="px-5 py-2 text-ink">{{ DECLARED_EQUIPMENT_LABELS[c.equipment] }}</td>
              <td class="px-5 py-2 text-ink-secondary">{{ c.label }}</td>
              <td class="px-5 py-2 text-right tabular-nums text-ink-secondary">{{ c.trucks }}</td>
              <td class="px-5 py-2 text-right tabular-nums text-ink-secondary">{{ c.runningHours }}</td>
              <td class="px-5 py-2 text-right tabular-nums text-ink-secondary">{{ gph(c.measuredGalPerHour) }}</td>
              <td class="px-5 py-2 text-right tabular-nums text-ink-secondary">{{ c.ci95 == null ? "—" : `±${(c.ci95 * 100).toFixed(1)}%` }}</td>
              <td class="px-5 py-2">
                <AppBadge :tone="c.learned ? 'success' : 'neutral'">{{ IDLE_BURN_SOURCE_LABELS[c.source] }}</AppBadge>
              </td>
            </tr>
            <tr v-if="burn.cells.length === 0">
              <td colspan="7" class="px-5 py-6 text-center text-ink-muted">No parked hours with a fuel reading in the last {{ IDLE_BURN_LEARN_DAYS }} days yet.</td>
            </tr>
          </tbody>
        </AppTable>
      </AppCard>
    </template>
  </AppShell>
</template>
