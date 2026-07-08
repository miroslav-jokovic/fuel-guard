<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { RouterLink } from "vue-router";
import { ArrowDownTrayIcon } from "@heroicons/vue/24/outline";
import { downloadReport } from "@/features/reports/download";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import AppSelect from "@/components/AppSelect.vue";
import { apiFetch } from "@/lib/api";
import type { DetectionMetrics } from "@fuelguard/shared";
import { useToastStore } from "@/stores/toast";

const toast = useToastStore();

const iso = (d: Date) => d.toISOString().slice(0, 10);
const from = ref<string | undefined>(iso(new Date(Date.now() - 30 * 86400_000)));
const to = ref<string | undefined>(iso(new Date()));

const rangeLabel = computed(() => (from.value && to.value ? `${from.value} → ${to.value}` : "last 30 days"));
function query(extra?: Record<string, string>) {
  const parts: string[] = [];
  if (from.value) parts.push(`from=${encodeURIComponent(`${from.value}T00:00:00`)}`);
  if (to.value) parts.push(`to=${encodeURIComponent(`${to.value}T23:59:59`)}`);
  for (const [k, v] of Object.entries(extra ?? {})) parts.push(`${k}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

const busy = ref<string | null>(null);
async function run(path: string, filename: string, key: string, extra?: Record<string, string>) {
  busy.value = key;
  try {
    await downloadReport(`${path}${query(extra)}`, filename);
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

// ── Odometer accuracy (entered vs Samsara) ──────────────────────────────────
interface AccRow {
  key: string;
  label: string;
  fills: number;
  checked: number;
  mismatches: number;
  accuracyPct: number | null;
  avgDeviation: number | null;
  maxDeviation: number | null;
}
const by = ref<"driver" | "vehicle">("driver");
const acc = ref<AccRow[]>([]);
const accLoading = ref(false);
async function loadAccuracy() {
  accLoading.value = true;
  const res = await apiFetch<{ rows: AccRow[] }>(`/api/reports/odometer-accuracy${query({ by: by.value })}`);
  accLoading.value = false;
  acc.value = res.ok && res.data ? res.data.rows : [];
}
const accTop = computed(() => acc.value.filter((r) => r.checked > 0).slice(0, 10));
const accTone = (pct: number | null) =>
  pct == null ? "text-gray-400" : pct >= 90 ? "text-green-700" : pct >= 70 ? "text-amber-700" : "text-red-700";

watch([from, to, by], loadAccuracy);
onMounted(loadAccuracy);

// ── Detection accuracy (measured precision from reviewer dispositions) ────────
const metrics = ref<DetectionMetrics | null>(null);
const metricsLoading = ref(false);
async function loadMetrics() {
  metricsLoading.value = true;
  const res = await apiFetch<DetectionMetrics>("/api/reports/detection-metrics");
  metricsLoading.value = false;
  metrics.value = res.ok && res.data ? res.data : null;
}
onMounted(loadMetrics);
const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const precisionTone = computed(() => {
  const p = metrics.value?.precision;
  return p == null ? "text-gray-400" : p >= 0.9 ? "text-green-700" : p >= 0.75 ? "text-amber-700" : "text-red-700";
});

const sendingDigest = ref(false);
async function sendDigest() {
  sendingDigest.value = true;
  const res = await apiFetch<{ sent: boolean; reason: string | null }>("/api/reports/digest", { method: "POST" });
  sendingDigest.value = false;
  if (res.ok && res.data?.sent) toast.success("Weekly digest sent", "Emailed to your notification recipients.");
  else if (res.ok) toast.info("Digest not sent", res.data?.reason ?? "Check notification recipients / mail settings.");
  else toast.error("Could not send digest", res.error?.message);
}
</script>

<template>
  <div class="space-y-6">
    <!-- Detection accuracy — the measured trust metric -->
    <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
      <div class="flex items-start justify-between">
        <div>
          <h2 class="text-sm font-semibold text-gray-900">Detection accuracy <span class="font-normal text-gray-400">(all-time)</span></h2>
          <p class="text-sm text-gray-500">Measured from reviewer outcomes — precision is how often a raised case was a real issue.</p>
        </div>
      </div>

      <div v-if="metricsLoading" class="mt-4 text-sm text-gray-400">Loading…</div>
      <template v-else-if="metrics && metrics.decided > 0">
        <div class="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Precision</dt>
            <dd class="mt-1 text-2xl font-bold" :class="precisionTone">{{ pct(metrics.precision) }}</dd>
            <dd class="mt-0.5 text-xs text-gray-400">95% CI {{ pct(metrics.precisionCiLow) }}–{{ pct(metrics.precisionCiHigh) }}</dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Non-issue rate</dt>
            <dd class="mt-1 text-2xl font-bold text-gray-900">{{ pct(metrics.nonIssueRate) }}</dd>
            <dd class="mt-0.5 text-xs text-gray-400">false alarms + legitimate, explained</dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Reviewed</dt>
            <dd class="mt-1 text-2xl font-bold text-gray-900">{{ metrics.decided.toLocaleString() }}<span class="text-base font-normal text-gray-400"> cases</span></dd>
            <dd class="mt-0.5 text-xs text-gray-400">{{ metrics.confirmed }} confirmed · {{ metrics.inconclusive }} inconclusive</dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Awaiting review</dt>
            <dd class="mt-1 text-2xl font-bold text-gray-900">{{ metrics.pending.toLocaleString() }}</dd>
            <dd class="mt-0.5 text-xs text-gray-400">label these to sharpen the number</dd>
          </div>
        </div>

        <div v-if="metrics.perLeadRule.length" class="mt-5">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Precision by lead signal</p>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200 text-sm">
              <thead class="text-left text-gray-500">
                <tr>
                  <th class="py-2 pr-4 font-medium">Signal</th>
                  <th class="py-2 pr-4 font-medium text-right">Reviewed</th>
                  <th class="py-2 pr-4 font-medium text-right">Confirmed</th>
                  <th class="py-2 font-medium text-right">Precision</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                <tr v-for="r in metrics.perLeadRule" :key="r.ruleId">
                  <td class="py-2 pr-4 text-gray-900">{{ r.label }}</td>
                  <td class="py-2 pr-4 text-right text-gray-700">{{ r.decided }}</td>
                  <td class="py-2 pr-4 text-right text-gray-700">{{ r.confirmed }}</td>
                  <td class="py-2 text-right font-medium" :class="r.precision == null ? 'text-gray-400' : r.precision >= 0.9 ? 'text-green-700' : r.precision >= 0.75 ? 'text-amber-700' : 'text-red-700'">{{ pct(r.precision) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p class="mt-3 text-xs text-gray-400">
          Precision is measured, not asserted — the interval widens on small samples. Recall (missed theft)
          needs sampled clears and is tracked separately.
        </p>
      </template>
      <p v-else class="mt-4 text-sm text-gray-500">
        No reviewed cases yet. Resolve or dismiss cases in the Anomalies queue and record an outcome —
        once you've labeled a few, your measured precision appears here.
      </p>
    </div>

    <div class="rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-sm font-semibold text-gray-900">Report period</h2>
          <p class="text-sm text-gray-500">{{ rangeLabel }}</p>
        </div>
        <DateRangeFilter v-model:from="from" v-model:to="to" />
      </div>
    </div>

    <div class="flex flex-col gap-3 rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 class="text-sm font-semibold text-gray-900">Weekly theft digest</h2>
        <p class="text-sm text-gray-500">An AI summary of the week's risks, emailed to your notification recipients. Sends automatically each week — or send one now.</p>
      </div>
      <button
        :disabled="sendingDigest"
        class="shrink-0 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        @click="sendDigest"
      >
        {{ sendingDigest ? "Sending…" : "Send digest now" }}
      </button>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="r in reports" :key="r.key" class="flex flex-col rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <h3 class="text-sm font-semibold text-gray-900">{{ r.name }}</h3>
        <p class="mt-1 flex-1 text-sm text-gray-500">{{ r.desc }}</p>
        <button
          :disabled="busy === r.key"
          class="mt-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          @click="run(r.path, r.file, r.key)"
        >
          <ArrowDownTrayIcon class="size-4" /> {{ busy === r.key ? "Preparing…" : "Download" }}
        </button>
      </div>
    </div>

    <!-- Odometer accuracy -->
    <div class="rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <div class="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 class="text-sm font-semibold text-gray-900">Odometer accuracy</h3>
          <p class="text-sm text-gray-500">Driver-entered odometer vs. Samsara reading. See <RouterLink to="/odometer" class="font-medium text-indigo-600 hover:text-indigo-500">Odometer Mismatches</RouterLink> for the fill-by-fill list.</p>
        </div>
        <div class="flex items-center gap-2">
          <AppSelect v-model="by" :options="[{ value: 'driver', label: 'By driver' }, { value: 'vehicle', label: 'By vehicle' }]" class="w-36" />
          <button
            :disabled="busy === 'odo'"
            class="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50"
            @click="run('/api/reports/odometer-accuracy.csv', 'fuelguard-odometer-accuracy.csv', 'odo', { by })"
          >
            <ArrowDownTrayIcon class="size-4" /> CSV
          </button>
        </div>
      </div>

      <div v-if="accLoading" class="px-5 py-8 text-sm text-gray-500">Loading…</div>
      <div v-else-if="accTop.length === 0" class="px-5 py-8 text-sm text-gray-500">
        No verifiable odometer data yet (needs Samsara odometer readings). Run a Backfill to populate.
      </div>
      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 whitespace-nowrap text-sm">
          <thead class="text-left text-gray-500">
            <tr>
              <th class="px-5 py-3 font-medium">{{ by === "vehicle" ? "Unit" : "Driver" }}</th>
              <th class="px-5 py-3 font-medium">Fills</th>
              <th class="px-5 py-3 font-medium">Verifiable</th>
              <th class="px-5 py-3 font-medium">Off &gt; 5 mi</th>
              <th class="px-5 py-3 font-medium">Accuracy</th>
              <th class="px-5 py-3 font-medium">Avg dev</th>
              <th class="px-5 py-3 font-medium">Max dev</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="r in accTop" :key="r.key">
              <td class="px-5 py-2.5 font-medium text-gray-900">{{ r.label }}</td>
              <td class="px-5 py-2.5 text-gray-700">{{ r.fills }}</td>
              <td class="px-5 py-2.5 text-gray-700">{{ r.checked }}</td>
              <td class="px-5 py-2.5 text-gray-700">{{ r.mismatches }}</td>
              <td class="px-5 py-2.5 font-medium" :class="accTone(r.accuracyPct)">{{ r.accuracyPct != null ? `${r.accuracyPct}%` : "—" }}</td>
              <td class="px-5 py-2.5 text-gray-700">{{ r.avgDeviation != null ? `${r.avgDeviation} mi` : "—" }}</td>
              <td class="px-5 py-2.5 text-gray-700">{{ r.maxDeviation != null ? `${r.maxDeviation} mi` : "—" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
