<script setup lang="ts">
import { computed, ref } from "vue";
import { useAuditSample, useRecallMetrics, useRecordVerdict, type SampledFill } from "@/features/anomalies/useRecallAudit";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useToastStore } from "@/stores/toast";
import { useSessionStore } from "@/stores/session";
import GatedLink from "@/components/GatedLink.vue";
import type { AuditVerdict } from "@silvicom/shared";
import QueryState from "@/components/ui/QueryState.vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppCard as BaseCard } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import StatCard from "@/components/ui/StatCard.vue";
import FactList, { type Fact } from "@/components/ui/FactList.vue";
import { formatDate as fmtDate } from "@/lib/format";

const toast = useToastStore();
const { data: sample, isLoading, isError, refetch, isFetching } = useAuditSample(20);
// Both reads draw their own failure (F7, US6b): a failed metrics read said "No fills checked yet", and
// a failed batch read "Review batch (0 left)" — the two answers a reviewer acts on, both wrong.
const {
  data: metrics,
  isLoading: metricsLoading,
  isError: metricsFailed,
  isFetching: metricsFetching,
  refetch: refetchMetrics,
} = useRecallMetrics();
const { data: vehicles } = useVehiclesQuery();
const record = useRecordVerdict();
/**
 * The page is `settings` VIEW; recording a verdict is `POST /api/audit/transaction/:id`, which is
 * `requireSection("settings")` — manage (SP5, plan §4b). Before SP5 the two buttons showed to every
 * reader of the page and a viewer's press came back 403. A viewer now reads the batch without them.
 */
const session = useSessionStore();
const canJudge = computed(() => session.can("settings"));

const unit = (id: string | null) => (id ? (vehicles.value?.find((v) => v.id === id)?.unit_number ?? id) : "—");

// Locally hide a fill once judged, so the reviewer sees the batch shrink without a full refetch.
const done = ref<Set<string>>(new Set());
const pending = computed(() => (sample.value ?? []).filter((f) => !done.value.has(f.id)));

const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const usd = (n: number | null) => (n == null ? null : n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const place = (f: SampledFill) => f.locationText || [f.city, f.state].filter(Boolean).join(", ") || null;

/** One sampled fill's facts (D-US6). A blank is `null`, so `FactList` draws its em dash. */
const fillFacts = (f: SampledFill): Fact[] => [
  { label: "Gallons", value: f.gallons, numeric: true },
  { label: "Cost", value: usd(f.totalCost), numeric: true },
  { label: "MPG", value: f.computedMpg, numeric: true },
  { label: "Odometer", value: f.odometer?.toLocaleString(), numeric: true },
  { label: "EFS location", value: place(f) },
  { label: "Samsara saw", value: [f.observedCity, f.observedState].filter(Boolean).join(", ") || null },
];

async function judge(f: SampledFill, verdict: AuditVerdict) {
  try {
    await record.mutateAsync({ id: f.id, verdict });
    done.value.add(f.id);
    toast.success(verdict === "missed" ? "Recorded as a missed detection" : "Recorded as correctly cleared");
  } catch (e) {
    toast.error("Could not record", e instanceof Error ? e.message : undefined);
  }
}
function loadNewBatch() {
  done.value = new Set();
  refetch();
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader>
      This page measures how much the system <em>misses</em>. It shows you a random batch of fills it did
      <strong>not</strong> flag, where Samsara could see the truck, and you mark each one Clean or Missed.
      Each Missed is a problem the system should have caught. The more fills you check, the closer the
      estimate gets.
    </PageHeader>

    <!-- Measured recall -->
    <BaseCard>
      <h2 class="text-sm font-semibold text-ink">Share of problems caught <span class="font-normal text-ink-tertiary">(all time, from your checks)</span></h2>
      <div class="mt-3">
        <QueryState
          compact
          :loading="metricsLoading"
          :error="metricsFailed"
          :retrying="metricsFetching"
          loading-text="Loading the figures…"
          error-text="Could not load the figures."
          @retry="refetchMetrics()"
        >
          <template v-if="metrics && metrics.audited > 0">
            <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard
                embedded
                label="Caught"
                :value="pct(metrics.estimatedRecall)"
                :sub="`range ${pct(metrics.recallLow)}–${pct(metrics.recallHigh)}`"
              />
              <StatCard
                embedded
                label="Missed in your checks"
                :value="pct(metrics.missRate)"
                :sub="`likely between ${pct(metrics.missRateCiLow)} and ${pct(metrics.missRateCiHigh)}`"
              />
              <StatCard embedded label="Fills checked" :value="metrics.audited.toLocaleString()" :sub="`${metrics.missed} marked Missed`" />
              <StatCard
                embedded
                label="Likely missed overall"
                :value="metrics.estimatedMisses?.toLocaleString() ?? '—'"
                :sub="`of ${metrics.coveredClears.toLocaleString()} unflagged fills Samsara could see`"
              />
            </div>
            <p class="mt-3 text-xs text-ink-tertiary">These figures are estimates from the fills you checked, and they get closer as you check more. Only fills Samsara could see are shown, so a Missed is a real miss and not a gap in the data.</p>
          </template>
          <p v-else class="text-sm text-ink-muted">No fills checked yet. Mark the batch below, and the figures appear here.</p>
        </QueryState>
      </div>
    </BaseCard>

    <!-- Review batch -->
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold text-ink">Review batch <span v-if="sample" class="font-normal text-ink-tertiary">({{ pending.length }} left)</span></h3>
      <BaseButton size="sm" :disabled="isFetching" @click="loadNewBatch">
        {{ isFetching ? "Loading…" : "Load new batch" }}
      </BaseButton>
    </div>

    <QueryState
      :loading="isLoading"
      :error="isError"
      :retrying="isFetching"
      loading-text="Loading the batch…"
      error-text="Could not load the batch."
      @retry="refetch()"
    >
      <BaseCard v-if="pending.length === 0" padding="none">
        <div class="px-6 py-10 text-center text-sm text-ink-muted">
          Batch complete. <BaseButton class="font-medium text-link hover:text-link-hover" @click="loadNewBatch">Load another batch</BaseButton> to make the estimate more exact.
        </div>
      </BaseCard>

      <div v-else class="space-y-3">
        <BaseCard v-for="f in pending" :key="f.id" padding="sm">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <GatedLink v-if="f.vehicleId" :to="`/vehicles/${f.vehicleId}`" class="text-sm font-semibold text-link hover:text-link-hover" plain-class="text-sm font-semibold text-ink">{{ unit(f.vehicleId) }}</GatedLink>
                <span v-else class="text-sm font-semibold text-ink">—</span>
                <span class="text-xs text-ink-tertiary">{{ fmtDate(f.fueledAt) }}</span>
              </div>
              <FactList class="mt-2" :facts="fillFacts(f)" />
            </div>
            <div v-if="canJudge" class="flex shrink-0 gap-2">
              <BaseButton
                :disabled="record.isPending.value"
                class="rounded-control bg-success-600 px-3 py-2 text-sm font-semibold text-ink-inverse hover:bg-success-500 disabled:opacity-50"
                @click="judge(f, 'clean')"
              >
                Clean
              </BaseButton>
              <BaseButton
                variant="danger"
                :disabled="record.isPending.value"
                title="This should have been flagged"
                @click="judge(f, 'missed')"
              >
                Missed
              </BaseButton>
            </div>
          </div>
        </BaseCard>
      </div>
    </QueryState>
  </div>
</template>
