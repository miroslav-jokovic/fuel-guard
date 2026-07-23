<script setup lang="ts">
import { computed } from "vue";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/stores/toast";
import { useJob } from "./useJob";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";

const props = defineProps<{
  title: string;
  description: string;
  kind: string;
  endpoint: string;
  actionLabel: string;
  confirm?: string;
  disabled?: boolean;
  /** Optional JSON body sent with the primary POST (e.g. { full: true }). */
  body?: Record<string, unknown>;
  /** Optional SECONDARY action on the same job/endpoint (e.g. "Re-check all history" → { full: true }).
   *  Keeps two variants of one job on ONE card so they share one status chip instead of misleading duplicates. */
  secondaryLabel?: string;
  secondaryBody?: Record<string, unknown>;
  secondaryConfirm?: string;
  /** Optional: map the last successful run's stats to a short outcome line (e.g. EFS found/imported/quarantined). */
  resultSummary?: (stats: Record<string, unknown>) => { label: string; warn?: boolean } | null;
}>();

const toast = useToastStore();
const { isRunning, failed, progressPct, progressLabel, freshnessLabel, refresh, markRunning, lastDone } = useJob(props.kind);

// Outcome of the last successful run (e.g. EFS "found 2, imported 0, quarantined 2"), so a "successful" sync
// that actually landed nothing is visible instead of a silent green chip.
const runSummary = computed(() => {
  if (isRunning.value || !props.resultSummary || !lastDone.value?.stats) return null;
  return props.resultSummary(lastDone.value.stats);
});

async function run(body?: Record<string, unknown>, confirmMsg?: string) {
  if (confirmMsg && !window.confirm(confirmMsg)) return;
  // Engage the progress bar + polling on THIS click. The endpoint keeps the request open for the whole run, so
  // we can't wait on the POST to show progress — the job row is created server-side as the run starts and the
  // poll takes over from here.
  markRunning();
  try {
    const res = await apiFetch(props.endpoint, { method: "POST", body });
    if (res.ok) {
      toast.success(`${props.title} started`, "Running in the background — progress shows here.");
    } else if (res.status === 409) {
      toast.info("Already running", "Watch the progress below.");
    } else {
      toast.error(`Could not start ${props.title.toLowerCase()}`, res.error?.message);
    }
  } catch {
    // A long sync can outlast the request/proxy timeout; the job keeps running server-side, so let the poll
    // report the real outcome instead of showing a scary error.
  } finally {
    refresh();
  }
}
</script>

<template>
  <BaseCard class="flex h-full flex-col">
    <div class="min-w-0">
      <h3 class="text-sm font-semibold text-ink">{{ title }}</h3>
      <p class="mt-1 text-sm text-ink-muted">{{ description }}</p>
    </div>

    <!-- Actions: their own row so a secondary button never squeezes the title in a narrow column. -->
    <div class="mt-4 flex flex-wrap items-center justify-end gap-2">
      <BaseButton
        v-if="secondaryLabel"
        :disabled="isRunning || disabled"
        @click="run(secondaryBody, secondaryConfirm)"
      >
        {{ secondaryLabel }}
      </BaseButton>
      <BaseButton variant="primary" :disabled="isRunning || disabled" @click="run(body, confirm)">
        {{ isRunning ? "Running…" : actionLabel }}
      </BaseButton>
    </div>

    <!-- Progress bar while a run is active -->
    <div v-if="isRunning" class="mt-4">
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
        <div
          class="h-full rounded-full bg-brand-500 transition-all"
          :style="{ width: (progressPct ?? 15) + '%' }"
        />
      </div>
      <p class="mt-1 text-xs text-ink-muted">{{ progressLabel ?? "working…" }}</p>
    </div>

    <!-- Freshness / failure chip when idle -->
    <p
      v-else
      class="mt-3 inline-flex items-center gap-1.5 text-xs"
      :class="failed ? 'text-danger-600' : 'text-ink-subtle'"
    >
      <span
        class="inline-block size-1.5 rounded-full"
        :class="failed ? 'bg-danger-500' : 'bg-success-400'"
        aria-hidden="true"
      />
      {{ freshnessLabel }}
    </p>
    <p v-if="runSummary" class="mt-1 text-xs" :class="runSummary.warn ? 'text-caution-700' : 'text-ink-muted'">
      {{ runSummary.label }}
    </p>
  </BaseCard>
</template>
