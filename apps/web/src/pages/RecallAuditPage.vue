<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import { useAuditSample, useRecallMetrics, useRecordVerdict, type SampledFill } from "@/features/anomalies/useRecallAudit";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useToastStore } from "@/stores/toast";
import type { AuditVerdict } from "@fuelguard/shared";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";

const toast = useToastStore();
const { data: sample, isLoading, isError, error, refetch, isFetching } = useAuditSample(20);
const { data: metrics } = useRecallMetrics();
const { data: vehicles } = useVehiclesQuery();
const record = useRecordVerdict();

const unit = (id: string | null) => (id ? (vehicles.value?.find((v) => v.id === id)?.unit_number ?? id) : "—");

// Locally hide a fill once judged, so the reviewer sees the batch shrink without a full refetch.
const done = ref<Set<string>>(new Set());
const pending = computed(() => (sample.value ?? []).filter((f) => !done.value.has(f.id)));

const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const usd = (n: number | null) => (n == null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const place = (f: SampledFill) => f.locationText || [f.city, f.state].filter(Boolean).join(", ") || "—";

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
    <p class="text-sm text-gray-500">
      Precision measures the cases we raise; recall measures the theft we <em>miss</em>. Since misses are
      invisible by definition, we sample a random batch of fills the engine <strong>cleared</strong> (and
      that telematics could actually see) and you judge each one. A "missed" verdict is a false negative —
      those measure recall. Judge a batch, then load another; the more you review, the tighter the estimate.
    </p>

    <!-- Measured recall -->
    <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
      <h2 class="text-sm font-semibold text-gray-900">Estimated recall <span class="font-normal text-gray-400">(all-time, from your audits)</span></h2>
      <template v-if="metrics && metrics.audited > 0">
        <div class="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Estimated recall</dt>
            <dd class="mt-1 text-2xl font-bold text-gray-900">{{ pct(metrics.estimatedRecall) }}</dd>
            <dd class="mt-0.5 text-xs text-gray-400">range {{ pct(metrics.recallLow) }}–{{ pct(metrics.recallHigh) }}</dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Sampled miss rate</dt>
            <dd class="mt-1 text-2xl font-bold text-gray-900">{{ pct(metrics.missRate) }}</dd>
            <dd class="mt-0.5 text-xs text-gray-400">95% CI {{ pct(metrics.missRateCiLow) }}–{{ pct(metrics.missRateCiHigh) }}</dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Audited</dt>
            <dd class="mt-1 text-2xl font-bold text-gray-900">{{ metrics.audited.toLocaleString() }}</dd>
            <dd class="mt-0.5 text-xs text-gray-400">{{ metrics.missed }} missed found</dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Est. missed in pool</dt>
            <dd class="mt-1 text-2xl font-bold text-gray-900">{{ metrics.estimatedMisses?.toLocaleString() ?? "—" }}</dd>
            <dd class="mt-0.5 text-xs text-gray-400">of {{ metrics.coveredClears.toLocaleString() }} covered clears</dd>
          </div>
        </div>
        <p class="mt-3 text-xs text-gray-400">Extrapolated from the sample — it's an estimate, and it tightens as you audit more. Sampling is drawn only from telematics-covered fills, so a miss is a real miss, not a blind spot.</p>
      </template>
      <p v-else class="mt-3 text-sm text-gray-500">No audits yet — judge the batch below and your measured recall appears here.</p>
    </div>

    <!-- Review batch -->
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold text-gray-900">Review batch <span class="font-normal text-gray-400">({{ pending.length }} left)</span></h3>
      <button
        :disabled="isFetching"
        class="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50"
        @click="loadNewBatch"
      >
        {{ isFetching ? "Loading…" : "Load new batch" }}
      </button>
    </div>

    <TableSkeleton v-if="isLoading" :cols="1" />
    <ErrorState v-else-if="isError" :message="error instanceof Error ? error.message : 'Failed to load sample'" :retrying="isFetching" @retry="refetch" />
    <div v-else-if="pending.length === 0" class="rounded-lg bg-white px-6 py-10 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
      Batch complete. <button class="font-medium text-indigo-600 hover:text-indigo-500" @click="loadNewBatch">Load another batch</button> to keep sharpening the estimate.
    </div>

    <div v-else class="space-y-3">
      <div v-for="f in pending" :key="f.id" class="rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <RouterLink v-if="f.vehicleId" :to="`/vehicles/${f.vehicleId}`" class="text-sm font-semibold text-indigo-600 hover:text-indigo-500">{{ unit(f.vehicleId) }}</RouterLink>
              <span v-else class="text-sm font-semibold text-gray-900">—</span>
              <span class="text-xs text-gray-400">{{ fmtDate(f.fueledAt) }}</span>
            </div>
            <dl class="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <div><dt class="text-xs text-gray-400">Gallons</dt><dd class="text-gray-800">{{ f.gallons ?? "—" }}</dd></div>
              <div><dt class="text-xs text-gray-400">Cost</dt><dd class="text-gray-800">{{ usd(f.totalCost) }}</dd></div>
              <div><dt class="text-xs text-gray-400">MPG</dt><dd class="text-gray-800">{{ f.computedMpg ?? "—" }}</dd></div>
              <div><dt class="text-xs text-gray-400">Odometer</dt><dd class="text-gray-800">{{ f.odometer?.toLocaleString() ?? "—" }}</dd></div>
              <div class="col-span-2"><dt class="text-xs text-gray-400">EFS location</dt><dd class="truncate text-gray-800">{{ place(f) }}</dd></div>
              <div class="col-span-2"><dt class="text-xs text-gray-400">Samsara saw</dt><dd class="truncate text-gray-800">{{ [f.observedCity, f.observedState].filter(Boolean).join(", ") || "—" }}</dd></div>
            </dl>
          </div>
          <div class="flex shrink-0 gap-2">
            <button
              :disabled="record.isPending.value"
              class="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
              @click="judge(f, 'clean')"
            >
              Clean
            </button>
            <button
              :disabled="record.isPending.value"
              class="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              title="This should have been flagged — a missed detection"
              @click="judge(f, 'missed')"
            >
              Missed
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
