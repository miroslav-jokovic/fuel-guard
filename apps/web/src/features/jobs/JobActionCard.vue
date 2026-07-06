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
}>();

const toast = useToastStore();
const { isRunning, failed, progressPct, progressLabel, freshnessLabel, refresh } = useJob(props.kind);

async function run() {
  if (props.confirm && !window.confirm(props.confirm)) return;
  const res = await apiFetch(props.endpoint, { method: "POST" });
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
      <button
        :disabled="isRunning || disabled"
        class="shrink-0 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
        @click="run"
      >
        {{ isRunning ? "Running…" : actionLabel }}
      </button>
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
