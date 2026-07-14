<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { RouterLink } from "vue-router";
import { ArrowDownTrayIcon } from "@heroicons/vue/24/outline";
import { downloadReport } from "@/features/reports/download";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import AppSelect from "@/components/AppSelect.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { apiFetch } from "@/lib/api";
import type { DetectionMetrics, RecallMetrics } from "@fuelguard/shared";
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
  pct == null ? "text-ink-subtle" : pct >= 90 ? "text-success-700" : pct >= 70 ? "text-warning-700" : "text-danger-700";
const accColumns = computed<DataTableColumn[]>(() => [
  { key: "label", label: by.value === "vehicle" ? "Unit" : "Driver", cellClass: "font-medium text-ink" },
  { key: "fills", label: "Fills", numeric: true, cellClass: "text-ink-secondary" },
  { key: "checked", label: "Verifiable", numeric: true, cellClass: "text-ink-secondary" },
  { key: "mismatches", label: "Off > 5 mi", numeric: true, cellClass: "text-ink-secondary" },
  { key: "accuracyPct", label: "Accuracy", numeric: true },
  { key: "avgDeviation", label: "Avg dev", numeric: true, cellClass: "text-ink-secondary" },
  { key: "maxDeviation", label: "Max dev", numeric: true, cellClass: "text-ink-secondary" },
]);

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
const leadColumns: DataTableColumn[] = [
  { key: "label", label: "Signal" },
  { key: "decided", label: "Reviewed", numeric: true, cellClass: "text-ink-secondary" },
  { key: "confirmed", label: "Confirmed", numeric: true, cellClass: "text-ink-secondary" },
  { key: "precision", label: "Precision", numeric: true },
];

// Estimated recall (from the sampled audit) — shown alongside precision to complete the accuracy picture.
const recall = ref<RecallMetrics | null>(null);
async function loadRecall() {
  const res = await apiFetch<RecallMetrics>("/api/audit/recall-metrics");
  recall.value = res.ok && res.data ? res.data : null;
}
onMounted(loadRecall);
const precisionTone = computed(() => {
  const p = metrics.value?.precision;
  return p == null ? "text-ink-subtle" : p >= 0.9 ? "text-success-700" : p >= 0.75 ? "text-warning-700" : "text-danger-700";
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
    <BaseCard>
      <div class="flex items-start justify-between">
        <div>
          <h2 class="text-sm font-semibold text-ink">Detection accuracy <span class="font-normal text-ink-subtle">(all-time)</span></h2>
          <p class="text-sm text-ink-muted">Measured from reviewer outcomes — precision is how often a raised case was a real issue.</p>
        </div>
      </div>

      <div v-if="metricsLoading" class="mt-4 text-sm text-ink-subtle">Loading…</div>
      <template v-else-if="metrics && metrics.decided > 0">
        <div class="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Precision</dt>
            <dd class="mt-1 text-2xl font-bold" :class="precisionTone">{{ pct(metrics.precision) }}</dd>
            <dd class="mt-0.5 text-xs text-ink-subtle">95% CI {{ pct(metrics.precisionCiLow) }}–{{ pct(metrics.precisionCiHigh) }}</dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Non-issue rate</dt>
            <dd class="mt-1 text-2xl font-bold text-ink">{{ pct(metrics.nonIssueRate) }}</dd>
            <dd class="mt-0.5 text-xs text-ink-subtle">false alarms + legitimate, explained</dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Reviewed</dt>
            <dd class="mt-1 text-2xl font-bold text-ink">{{ metrics.decided.toLocaleString() }}<span class="text-base font-normal text-ink-subtle"> cases</span></dd>
            <dd class="mt-0.5 text-xs text-ink-subtle">{{ metrics.confirmed }} confirmed · {{ metrics.inconclusive }} inconclusive</dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Awaiting review</dt>
            <dd class="mt-1 text-2xl font-bold text-ink">{{ metrics.pending.toLocaleString() }}</dd>
            <dd class="mt-0.5 text-xs text-ink-subtle">label these to sharpen the number</dd>
          </div>
        </div>

        <div v-if="metrics.perLeadRule.length" class="mt-5">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Precision by lead signal</p>
          <DataTable :columns="leadColumns" :rows="metrics.perLeadRule" row-key="ruleId" :sticky-header="false">
            <template #cell-precision="{ value }">
              <span class="font-medium" :class="value == null ? 'text-ink-subtle' : value >= 0.9 ? 'text-success-700' : value >= 0.75 ? 'text-warning-700' : 'text-danger-700'">{{ pct(value) }}</span>
            </template>
          </DataTable>
        </div>
        <div class="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-edge-subtle pt-3 text-sm">
          <span class="text-ink-muted">Estimated recall:</span>
          <template v-if="recall && recall.audited > 0">
            <span class="font-semibold text-ink">{{ pct(recall.estimatedRecall) }}</span>
            <span class="text-xs text-ink-subtle">(range {{ pct(recall.recallLow) }}–{{ pct(recall.recallHigh) }}, from {{ recall.audited }} audits)</span>
          </template>
          <span v-else class="text-ink-subtle">not yet audited</span>
          <RouterLink to="/recall-audit" class="ml-auto text-xs font-medium text-brand-600 hover:text-brand-500">Review cleared fills →</RouterLink>
        </div>
        <p class="mt-3 text-xs text-ink-subtle">
          Precision and recall are both measured, not asserted — intervals widen on small samples. Recall is
          estimated from a random audit of cleared, telematics-covered fills.
        </p>
      </template>
      <p v-else class="mt-4 text-sm text-ink-muted">
        No reviewed cases yet. Resolve or dismiss cases in the Anomalies queue and record an outcome —
        once you've labeled a few, your measured precision appears here.
      </p>
    </BaseCard>

    <BaseCard padding="sm">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-sm font-semibold text-ink">Report period</h2>
          <p class="text-sm text-ink-muted">{{ rangeLabel }}</p>
        </div>
        <DateRangeFilter v-model:from="from" v-model:to="to" />
      </div>
    </BaseCard>

    <BaseCard padding="sm" class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 class="text-sm font-semibold text-ink">Weekly theft digest</h2>
        <p class="text-sm text-ink-muted">An AI summary of the week's risks, emailed to your notification recipients. Sends automatically each week — or send one now.</p>
      </div>
      <BaseButton variant="primary" class="shrink-0" :disabled="sendingDigest" @click="sendDigest">
        {{ sendingDigest ? "Sending…" : "Send digest now" }}
      </BaseButton>
    </BaseCard>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <BaseCard v-for="r in reports" :key="r.key" class="flex flex-col">
        <h3 class="text-sm font-semibold text-ink">{{ r.name }}</h3>
        <p class="mt-1 flex-1 text-sm text-ink-muted">{{ r.desc }}</p>
        <BaseButton variant="primary" class="mt-4" :disabled="busy === r.key" @click="run(r.path, r.file, r.key)">
          <ArrowDownTrayIcon class="size-4" /> {{ busy === r.key ? "Preparing…" : "Download" }}
        </BaseButton>
      </BaseCard>
    </div>

    <!-- Odometer accuracy -->
    <div class="space-y-3">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 class="text-sm font-semibold text-ink">Odometer accuracy</h3>
          <p class="text-sm text-ink-muted">Driver-entered odometer vs. Samsara reading. See <RouterLink to="/odometer" class="font-medium text-brand-600 hover:text-brand-500">Odometer Mismatches</RouterLink> for the fill-by-fill list.</p>
        </div>
        <div class="flex items-center gap-2">
          <AppSelect v-model="by" :options="[{ value: 'driver', label: 'By driver' }, { value: 'vehicle', label: 'By vehicle' }]" class="w-36" />
          <BaseButton
            size="sm"
            :disabled="busy === 'odo'"
            @click="run('/api/reports/odometer-accuracy.csv', 'fuelguard-odometer-accuracy.csv', 'odo', { by })"
          >
            <ArrowDownTrayIcon class="size-4" /> CSV
          </BaseButton>
        </div>
      </div>

      <DataTable
        :columns="accColumns"
        :rows="accTop"
        row-key="key"
        :loading="accLoading"
        empty-text="No verifiable odometer data yet (needs Samsara odometer readings). Run a Backfill to populate."
      >
        <template #cell-accuracyPct="{ value }">
          <span class="font-medium" :class="accTone(value)">{{ value != null ? `${value}%` : "—" }}</span>
        </template>
        <template #cell-avgDeviation="{ value }">{{ value != null ? `${value} mi` : "—" }}</template>
        <template #cell-maxDeviation="{ value }">{{ value != null ? `${value} mi` : "—" }}</template>
      </DataTable>
    </div>
  </div>
</template>
