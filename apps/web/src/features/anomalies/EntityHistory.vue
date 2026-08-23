<script setup lang="ts">
import { AppButton as BaseButton } from "@fuelguard/ui";
/**
 * Entity-intelligence panel (2026-08, Phases 1–2) — CONTEXT for the reviewer, never a score input.
 * Phase 1: the derived-on-read risk snapshot for the case's driver / vehicle / card (open cases,
 * reviewer-confirmed history, near-threshold fills, suspicious declines). Phase 2: the persisted
 * retrospective pattern report (recurring sub-threshold signals, near-miss timeline, station
 * concentration, decline→retry sequences); live-scored alerts generate it automatically, and the
 * button covers rebuild-created cases.
 */
import { ref, onMounted } from "vue";
import { formatRuleId } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";

const props = defineProps<{ anomalyId: string }>();

interface RiskEntry {
  openCases: number;
  confirmed: number;
  rejected: number;
  nearThresholdFills: number;
  suspiciousDeclines: number;
}
interface RiskContext {
  driver: RiskEntry | null;
  vehicle: RiskEntry | null;
  card: RiskEntry | null;
  windows: { dispositionDays: number; activityDays: number; nearThresholdScore: number };
}
interface PatternAnalysis {
  fills: number;
  totalGallons: number;
  levelCounts: Record<string, number>;
  recurringSignals: { ruleId: string; count: number }[];
  nearThresholdTimeline: { fueledAt: string; score: number; signals: string[] }[];
  nearThresholdTotal: number;
  topStations: { station: string; count: number; share: number }[];
}
interface PatternReport {
  report: {
    version: number;
    lookbackDays: number;
    vehicle: PatternAnalysis | null;
    driver: PatternAnalysis | null;
    cardDeclines: { total: number; suspicious: number; sequences: { declinedAt: string; errorCode: string | null; minutesToFill: number | null }[] } | null;
  };
  generated_at: string;
}

const risk = ref<RiskContext | null>(null);
const report = ref<PatternReport | null>(null);
const loading = ref(true);
const sweeping = ref(false);
const sweepMsg = ref<string | null>(null);

async function load() {
  loading.value = true;
  const [r, p] = await Promise.all([
    apiFetch<RiskContext>(`/api/anomalies/${props.anomalyId}/risk-context`),
    apiFetch<PatternReport>(`/api/anomalies/${props.anomalyId}/pattern-report`),
  ]);
  risk.value = r.ok ? (r.data ?? null) : null;
  report.value = p.ok ? (p.data ?? null) : null;
  loading.value = false;
}
onMounted(load);

async function sweep() {
  sweeping.value = true;
  sweepMsg.value = null;
  const res = await apiFetch(`/api/anomalies/${props.anomalyId}/sweep`, { method: "POST" });
  if (res.ok) {
    sweepMsg.value = "Analyzing history… refresh in a few seconds.";
    setTimeout(() => void load(), 4000);
  } else {
    sweepMsg.value = res.status === 409 ? "Analysis already running." : (res.error?.message ?? "Could not start analysis");
  }
  sweeping.value = false;
}

const entryLabel: Record<string, string> = { driver: "Driver", vehicle: "Vehicle", card: "Card" };
const entries = (r: RiskContext) =>
  (["driver", "vehicle", "card"] as const).flatMap((k) => (r[k] ? [{ key: k, e: r[k]! }] : []));
const declineRetries = (rep: PatternReport) =>
  (rep.report.cardDeclines?.sequences ?? []).filter((s) => s.minutesToFill != null).length;
</script>

<template>
  <div class="space-y-3 border-t border-edge pt-4">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold text-ink">Entity history</h3>
      <BaseButton
        class="text-xs font-medium text-link hover:text-link-hover disabled:opacity-50"
        :disabled="sweeping"
        @click="sweep"
      >
        {{ report ? "Re-analyze history" : "Analyze history" }}
      </BaseButton>
    </div>
    <p v-if="sweepMsg" class="text-xs text-ink-tertiary">{{ sweepMsg }}</p>
    <p v-if="loading" class="text-sm text-ink-tertiary italic">Loading history…</p>

    <!-- Phase 1: risk snapshot per entity -->
    <div v-else-if="risk" class="space-y-2">
      <div
        v-for="{ key, e } in entries(risk)"
        :key="key"
        class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-control bg-surface-subtle px-3 py-2 text-xs"
      >
        <span class="w-14 font-semibold text-ink-secondary">{{ entryLabel[key] }}</span>
        <span :class="e.confirmed > 0 ? 'font-semibold text-danger-700' : 'text-ink-muted'">
          {{ e.confirmed }} confirmed ({{ risk.windows.dispositionDays }}d)
        </span>
        <span class="text-ink-muted">{{ e.openCases }} open</span>
        <span class="text-ink-muted">{{ e.rejected }} rejected</span>
        <span :class="e.nearThresholdFills > 3 ? 'font-semibold text-warning-700' : 'text-ink-muted'">
          {{ e.nearThresholdFills }} near-miss fills ({{ risk.windows.activityDays }}d)
        </span>
        <span v-if="key === 'card' && e.suspiciousDeclines > 0" class="font-semibold text-warning-700">
          {{ e.suspiciousDeclines }} suspicious declines
        </span>
      </div>
      <p class="text-2xs text-ink-tertiary">
        Near-miss = a fill whose case stayed clear but scored ≥ {{ risk.windows.nearThresholdScore }}.
        History is shown for context only — it never changes this case's score.
      </p>
    </div>

    <!-- Phase 2: retrospective pattern report -->
    <div v-if="report" class="space-y-2 text-xs">
      <div class="text-ink-tertiary">
        Pattern analysis · last {{ report.report.lookbackDays }} days · generated
        {{ new Date(report.generated_at).toLocaleString() }}
      </div>
      <template v-for="axis in (['driver', 'vehicle'] as const)" :key="axis">
        <div v-if="report.report[axis]" class="rounded-control bg-surface-subtle px-3 py-2">
          <div class="mb-1 font-semibold text-ink-secondary">
            {{ entryLabel[axis] }} · {{ report.report[axis]!.fills }} fills ·
            {{ report.report[axis]!.nearThresholdTotal }} near-miss
          </div>
          <div v-if="report.report[axis]!.recurringSignals.length" class="text-ink-muted">
            Recurring signals:
            <span v-for="(sig, i) in report.report[axis]!.recurringSignals.slice(0, 4)" :key="sig.ruleId">
              <span v-if="i > 0">, </span>{{ formatRuleId(sig.ruleId) }} ×{{ sig.count }}
            </span>
          </div>
          <div v-if="report.report[axis]!.topStations.length" class="text-ink-muted">
            Top station: {{ report.report[axis]!.topStations[0]!.station }}
            ({{ report.report[axis]!.topStations[0]!.share }}% of fills)
          </div>
        </div>
      </template>
      <div v-if="report.report.cardDeclines && report.report.cardDeclines.total > 0" class="rounded-control bg-surface-subtle px-3 py-2">
        <div class="font-semibold text-ink-secondary">
          Card declines: {{ report.report.cardDeclines.total }}
          <span v-if="report.report.cardDeclines.suspicious > 0" class="text-warning-700">
            ({{ report.report.cardDeclines.suspicious }} suspicious)</span>
          · {{ declineRetries(report) }} decline→retry sequences
        </div>
      </div>
    </div>
    <p v-else-if="!loading" class="text-xs text-ink-tertiary italic">
      No pattern analysis yet — “Analyze history” sweeps this case's driver, truck, and card for
      recurring near-miss patterns and decline sequences.
    </p>
  </div>
</template>
