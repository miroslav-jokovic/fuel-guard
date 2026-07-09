<script setup lang="ts">
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/stores/toast";
import { useJob } from "./useJob";

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
}>();

const toast = useToastStore();
const { isRunning, failed, progressPct, progressLabel, freshnessLabel, refresh } = useJob(props.kind);

async function run(body?: Record<string, unknown>, confirmMsg?: string) {
  if (confirmMsg && !window.confirm(confirmMsg)) return;
  const res = await apiFetch(props.endpoint, { method: "POST", body });
  if (res.ok) {
    toast.success(`${props.title} started`, "Running in the background — progress shows here.");
    refresh();
  } else if (res.status === 409) {
    toast.info("Already running", "Watch the progress below.");
    refresh();
  } else {
    toast.error(`Could not start ${props.title.toLowerCase()}`, res.error?.message);
  }
}
</script>

<template>
  <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h3 class="text-sm font-semibold text-gray-900">{{ title }}</h3>
        <p class="mt-1 text-sm text-gray-500">{{ description }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <button
          v-if="secondaryLabel"
          :disabled="isRunning || disabled"
          class="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
          @click="run(secondaryBody, secondaryConfirm)"
        >
          {{ secondaryLabel }}
        </button>
        <button
          :disabled="isRunning || disabled"
          class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
          @click="run(body, confirm)"
        >
          {{ isRunning ? "Running…" : actionLabel }}
        </button>
      </div>
    </div>

    <!-- Progress bar while a run is active -->
    <div v-if="isRunning" class="mt-4">
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          class="h-full rounded-full bg-indigo-500 transition-all"
          :style="{ width: (progressPct ?? 15) + '%' }"
        />
      </div>
      <p class="mt-1 text-xs text-gray-500">{{ progressLabel ?? "working…" }}</p>
    </div>

    <!-- Freshness / failure chip when idle -->
    <p
      v-else
      class="mt-3 inline-flex items-center gap-1.5 text-xs"
      :class="failed ? 'text-red-600' : 'text-gray-400'"
    >
      <span
        class="inline-block size-1.5 rounded-full"
        :class="failed ? 'bg-red-500' : 'bg-emerald-400'"
        aria-hidden="true"
      />
      {{ freshnessLabel }}
    </p>
  </div>
</template>
