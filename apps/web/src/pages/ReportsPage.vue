<script setup lang="ts">
import { ref } from "vue";
import { ArrowDownTrayIcon } from "@heroicons/vue/24/outline";
import { downloadReport } from "@/features/reports/download";
import { useToastStore } from "@/stores/toast";

const toast = useToastStore();
const days = ref(30);
const busy = ref<string | null>(null);

async function run(path: string, filename: string, key: string) {
  busy.value = key;
  try {
    await downloadReport(`${path}?days=${days.value}`, filename);
  } catch (e) {
    toast.error("Export failed", e instanceof Error ? e.message : undefined);
  } finally {
    busy.value = null;
  }
}

const reports = [
  { key: "txn", name: "Transactions (CSV)", desc: "Every fuel transaction in the period.", path: "/api/reports/transactions.csv", file: "fuelguard-transactions.csv" },
  { key: "anom", name: "Anomalies (CSV)", desc: "All active anomalies in the period.", path: "/api/reports/anomalies.csv", file: "fuelguard-anomalies.csv" },
  { key: "pdf", name: "Summary (PDF)", desc: "Spend, gallons, MPG and top risks.", path: "/api/reports/summary.pdf", file: "fuelguard-summary.pdf" },
];
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center gap-3">
      <span class="text-sm text-gray-500">Period:</span>
      <div class="flex gap-1 rounded-md bg-gray-100 p-1">
        <button v-for="d in [7, 30, 90]" :key="d" :class="['rounded px-3 py-1 text-sm font-medium', days === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500']" @click="days = d">{{ d }}d</button>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div v-for="r in reports" :key="r.key" class="flex flex-col rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <h3 class="text-sm font-semibold text-gray-900">{{ r.name }}</h3>
        <p class="mt-1 flex-1 text-sm text-gray-500">{{ r.desc }}</p>
        <button :disabled="busy === r.key" class="mt-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50" @click="run(r.path, r.file, r.key)">
          <ArrowDownTrayIcon class="size-4" /> {{ busy === r.key ? "Preparing…" : "Download" }}
        </button>
      </div>
    </div>

  </div>
</template>
