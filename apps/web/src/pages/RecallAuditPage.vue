<script setup lang="ts">
import { computed, ref } from "vue";
import { useAuditSample, useRecallMetrics, useRecordVerdict, type SampledFill } from "@/features/anomalies/useRecallAudit";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useToastStore } from "@/stores/toast";
import { useSessionStore } from "@/stores/session";
import GatedLink from "@/components/GatedLink.vue";
import type { AuditVerdict } from "@silvicom/shared";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppCard as BaseCard } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import { formatDate as fmtDate } from "@/lib/format";

const toast = useToastStore();
const { data: sample, isLoading, isError, error, refetch, isFetching } = useAuditSample(20);
const { data: metrics } = useRecallMetrics();
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
const usd = (n: number | null) => (n == null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
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
    <PageHeader>
      This page measures how much the system <em>misses</em>. It shows you a random batch of fills it did
      <strong>not</strong> flag, where Samsara could see the truck, and you mark each one Clean or Missed.
      Each Missed is a problem the system should have caught. The more fills you check, the closer the
      estimate gets.
    </PageHeader>

    <!-- Measured recall -->
    <BaseCard>
      <h2 class="text-sm font-semibold text-ink">Share of problems caught <span class="font-normal text-ink-tertiary">(all time, from your checks)</span></h2>
      <template v-if="metrics && metrics.audited > 0">
        <div class="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Caught</dt>
            <dd class="mt-1 text-2xl font-bold text-ink">{{ pct(metrics.estimatedRecall) }}</dd>
            <dd class="mt-0.5 text-xs text-ink-tertiary">range {{ pct(metrics.recallLow) }}–{{ pct(metrics.recallHigh) }}</dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Missed in your checks</dt>
            <dd class="mt-1 text-2xl font-bold text-ink">{{ pct(metrics.missRate) }}</dd>
            <dd class="mt-0.5 text-xs text-ink-tertiary">likely between {{ pct(metrics.missRateCiLow) }} and {{ pct(metrics.missRateCiHigh) }}</dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Fills checked</dt>
            <dd class="mt-1 text-2xl font-bold text-ink">{{ metrics.audited.toLocaleString() }}</dd>
            <dd class="mt-0.5 text-xs text-ink-tertiary">{{ metrics.missed }} marked Missed</dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Likely missed overall</dt>
            <dd class="mt-1 text-2xl font-bold text-ink">{{ metrics.estimatedMisses?.toLocaleString() ?? "—" }}</dd>
            <dd class="mt-0.5 text-xs text-ink-tertiary">of {{ metrics.coveredClears.toLocaleString() }} unflagged fills Samsara could see</dd>
          </div>
        </div>
        <p class="mt-3 text-xs text-ink-tertiary">These figures are estimates from the fills you checked, and they get closer as you check more. Only fills Samsara could see are shown, so a Missed is a real miss and not a gap in the data.</p>
      </template>
      <p v-else class="mt-3 text-sm text-ink-muted">No fills checked yet. Mark the batch below, and the figures appear here.</p>
    </BaseCard>

    <!-- Review batch -->
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold text-ink">Review batch <span class="font-normal text-ink-tertiary">({{ pending.length }} left)</span></h3>
      <BaseButton size="sm" :disabled="isFetching" @click="loadNewBatch">
        {{ isFetching ? "Loading…" : "Load new batch" }}
      </BaseButton>
    </div>

    <TableSkeleton v-if="isLoading" :cols="1" />
    <ErrorState v-else-if="isError" :message="error instanceof Error ? error.message : 'Could not load the batch'" :retrying="isFetching" @retry="refetch" />
    <BaseCard v-else-if="pending.length === 0" padding="none">
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
            <dl class="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <div><dt class="text-xs text-ink-tertiary">Gallons</dt><dd class="text-ink-secondary">{{ f.gallons ?? "—" }}</dd></div>
              <div><dt class="text-xs text-ink-tertiary">Cost</dt><dd class="text-ink-secondary">{{ usd(f.totalCost) }}</dd></div>
              <div><dt class="text-xs text-ink-tertiary">MPG</dt><dd class="text-ink-secondary">{{ f.computedMpg ?? "—" }}</dd></div>
              <div><dt class="text-xs text-ink-tertiary">Odometer</dt><dd class="text-ink-secondary">{{ f.odometer?.toLocaleString() ?? "—" }}</dd></div>
              <div class="col-span-2"><dt class="text-xs text-ink-tertiary">EFS location</dt><dd class="truncate text-ink-secondary">{{ place(f) }}</dd></div>
              <div class="col-span-2"><dt class="text-xs text-ink-tertiary">Samsara saw</dt><dd class="truncate text-ink-secondary">{{ [f.observedCity, f.observedState].filter(Boolean).join(", ") || "—" }}</dd></div>
            </dl>
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
  </div>
</template>
