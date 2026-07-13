<script setup lang="ts">
import { ref, computed } from "vue";
import { formatRuleId, ANOMALY_DISPOSITIONS, DISPOSITION_LABELS, type Anomaly, type AnomalyDisposition } from "@fuelguard/shared";
import { useTransaction, useAnomalyTransition, useRelatedCardFills } from "./useAnomalies";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useDriversQuery } from "@/features/fleet/useDrivers";
import { useAiVerification, useAiExamine } from "@/features/ai/useAiVerification";
import AiAssessmentCard from "@/features/ai/AiAssessmentCard.vue";
import AnomalyAudit from "./AnomalyAudit.vue";
import { stationDateTime } from "@/lib/stationTime";
import { useOrgSettingsQuery } from "@/features/settings/useOrgSettings";
import StatusBadge from "@/components/StatusBadge.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import { BADGE_BASE, severityTone } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";

const props = defineProps<{ anomaly: Anomaly; vehicleUnit: string }>();
const emit = defineEmits<{ changed: [] }>();

// ── data fetching ────────────────────────────────────────────────────────────
const txnId = computed(() => props.anomaly.transaction_id);
const { data: txn } = useTransaction(txnId);
const { data: assessment, isFetching: aiLoading } = useAiVerification(txnId);
const aiExamine = useAiExamine();
const transition = useAnomalyTransition();
const { data: vehicles } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();

// ── evidence / signal parsing ────────────────────────────────────────────────
interface CaseSignal { ruleId: string; axis: string; weight: number; severity: string; message: string }
const ev = computed(() => (props.anomaly.evidence ?? {}) as Record<string, unknown>);
const caseSignals = computed<CaseSignal[]>(() =>
  Array.isArray(ev.value.signals) ? (ev.value.signals as CaseSignal[]) : [],
);
const isCase = computed(() => caseSignals.value.length > 0);
const caseScore  = computed(() => ev.value.score  as number   | undefined);
const caseLevel  = computed(() => ev.value.level  as string   | undefined);
const caseAxes   = computed(() => (ev.value.axes  as string[] | undefined) ?? []);
const evidenceRows = computed(() =>
  Object.entries(ev.value).filter(([k]) => !["signals", "level", "score", "axes"].includes(k)),
);

// ── card multi-vehicle / sibling fills ───────────────────────────────────────
const hasCardSignal = computed(
  () =>
    props.anomaly.rule_id === "card_multi_vehicle" ||
    caseSignals.value.some((s) => s.ruleId === "card_multi_vehicle"),
);
const cardRef    = computed(() => txn.value?.card_ref ?? null);
const fueledAt   = computed(() => txn.value?.fueled_at ?? undefined);
const windowHours = computed(() => {
  if (props.anomaly.rule_id === "card_multi_vehicle")
    return Number(ev.value.windowHours ?? 48);
  return 48;
});
const { data: siblingFills, isLoading: siblingLoading } = useRelatedCardFills(
  cardRef,
  fueledAt,
  txnId,
  windowHours,
);

// ── lookup helpers ────────────────────────────────────────────────────────────
const vehicleById = (id: string | null) =>
  id ? (vehicles.value?.find((v) => v.id === id) ?? null) : null;
const driverName  = (id: string | null) =>
  id ? (drivers.value?.find((d) => d.id === id)?.full_name ?? "—") : "—";
const unitNumber  = (id: string | null) =>
  id ? (vehicleById(id)?.unit_number ?? "—") : "Unattributed";
const vehicleDesc = (id: string | null) => {
  const v = vehicleById(id);
  return v ? [v.year, v.make, v.model].filter(Boolean).join(" ") : "";
};

// ── audit tab (odometer / time / location precision) ───────────────────────────
const tab = ref<"overview" | "audit">("overview");
const { data: org } = useOrgSettingsQuery();
const orgTz = computed(() => (org.value?.operating_hours as { tz?: string } | null)?.tz ?? null);
const odometerOffset = computed(() => Number(vehicleById(txn.value?.vehicle_id ?? null)?.odometer_offset ?? 0));

// ── styling helpers ───────────────────────────────────────────────────────────
const axisClass = (axis: string): string => {
  const map: Record<string, string> = {
    location:    "bg-caution-100 text-caution-700",
    volume:      "bg-danger-100 text-danger-700",
    consumption: "bg-warning-100 text-warning-700",
    odometer:    "bg-brand-100 text-brand-700",
    behavior:    "bg-info-100 text-info-700",
    reefer:      "bg-info-100 text-info-700",
  };
  return map[axis] ?? "bg-surface-muted text-ink-secondary";
};
const weightBarClass = (w: number): string => {
  if (w >= 75) return "bg-danger-500";
  if (w >= 50) return "bg-caution-400";
  if (w >= 25) return "bg-warning-400";
  return "bg-neutral-300";
};

// ── formatting ────────────────────────────────────────────────────────────────
// Fueling times render in the STATION's local timezone so they match the printed EFS report.
const fmt = (iso: string, state: string | null) => stationDateTime(iso, state);
const fmtShort = (iso: string, state: string | null) => stationDateTime(iso, state, { short: true });
const fmtOdo  = (n: number | null) => (n != null ? n.toLocaleString() + " mi" : "—");
const fmtMoney = (n: number | null, prefix = "$") => (n != null ? prefix + n.toFixed(2) : "—");
const formatKey = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ── workflow ──────────────────────────────────────────────────────────────────
const toast = useToastStore();
const note  = ref("");
// Ground-truth outcome, required when closing a case — this is what the accuracy metrics measure.
const disposition = ref<AnomalyDisposition | "">("");
const DISPOSITION_OPTIONS = ANOMALY_DISPOSITIONS.map((d) => ({ value: d, label: DISPOSITION_LABELS[d] }));

const STATUS_LABELS: Record<string, string> = {
  investigating: "Marked as investigating",
  resolved:      "Anomaly resolved",
  dismissed:     "Anomaly dismissed",
};

async function doTransition(status: "investigating" | "resolved" | "dismissed") {
  // Closing a case must record whether the flag was right — no silent, unlabeled closes.
  if ((status === "resolved" || status === "dismissed") && !disposition.value) {
    toast.error("Pick an outcome", "Select whether this was a confirmed issue, a false alarm, legitimate, or inconclusive.");
    return;
  }
  try {
    await transition.mutateAsync({
      id: props.anomaly.id,
      status,
      note: note.value || undefined,
      disposition: disposition.value || undefined,
      version: props.anomaly.version,
    });
    note.value = "";
    disposition.value = "";
    toast.success(STATUS_LABELS[status] ?? "Status updated");
    emit("changed");
  } catch (e) {
    toast.error("Update failed", e instanceof Error ? e.message : undefined);
  }
}

async function doFalseAlarm() {
  try {
    await transition.mutateAsync({ id: props.anomaly.id, status: "dismissed", note: "False alarm", disposition: "false_positive", version: props.anomaly.version });
    toast.success("Marked as false alarm");
    emit("changed");
  } catch (e) {
    toast.error("Could not update", e instanceof Error ? e.message : undefined);
  }
}

async function reexamine() {
  try {
    const result = await aiExamine.mutateAsync(props.anomaly.id);
    if (result.cleared) {
      toast.success("Anomaly auto-cleared", result.message ?? undefined);
      emit("changed");
    } else if (result.assessment) {
      toast.success("AI assessment ready");
    } else {
      toast.info("AI produced no assessment", result.message ?? undefined);
    }
  } catch (e) {
    toast.error("AI verification failed", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-5">

    <!-- ① Header badges + rule label -->
    <div class="flex flex-wrap items-center gap-2">
      <span :class="[BADGE_BASE, severityTone(anomaly.severity)]">{{ anomaly.severity }}</span>
      <StatusBadge :status="anomaly.status" />
      <span class="text-xs text-ink-muted" :title="anomaly.rule_id">{{ formatRuleId(anomaly.rule_id) }}</span>
    </div>

    <p class="text-sm leading-relaxed text-ink">{{ anomaly.message }}</p>

    <!-- ② Case score banner (theft_case only) -->
    <div
      v-if="isCase && caseScore != null"
      class="flex flex-wrap items-center gap-4 rounded-lg bg-warning-50 px-4 py-3 ring-1 ring-warning-200"
    >
      <div class="flex flex-1 flex-col gap-1 min-w-[10rem]">
        <div class="flex items-center justify-between text-xs">
          <span class="font-semibold text-ink-secondary">Correlation score</span>
          <span class="font-bold text-ink">{{ caseScore }}<span class="font-normal text-ink-subtle"> / 200</span></span>
        </div>
        <div class="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
          <div
            class="h-2 rounded-full transition-all"
            :class="caseLevel === 'alert' ? 'bg-danger-500' : 'bg-warning-400'"
            :style="{ width: `${Math.min(100, (caseScore / 200) * 100)}%` }"
          />
        </div>
      </div>
      <div class="flex flex-wrap gap-1">
        <span
          v-for="ax in caseAxes"
          :key="ax"
          :class="['inline-flex rounded px-1.5 py-0.5 text-xs font-semibold uppercase', axisClass(ax)]"
        >{{ ax }}</span>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 border-b border-edge text-sm">
      <button
        class="-mb-px border-b-2 px-3 py-1.5 font-medium"
        :class="tab === 'overview' ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-muted hover:text-ink-secondary'"
        @click="tab = 'overview'"
      >
        Overview
      </button>
      <button
        class="-mb-px border-b-2 px-3 py-1.5 font-medium"
        :class="tab === 'audit' ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-muted hover:text-ink-secondary'"
        @click="tab = 'audit'"
      >
        Odometer &amp; Location
      </button>
    </div>

    <!-- AUDIT TAB -->
    <AnomalyAudit v-if="tab === 'audit' && txn" :txn="txn" :odometer-offset="odometerOffset" :tz="orgTz" />
    <p v-else-if="tab === 'audit'" class="text-sm text-ink-subtle italic">Loading transaction…</p>

    <!-- OVERVIEW TAB -->
    <template v-if="tab === 'overview'">
    <!-- ③ Contributing signals / Why this fired -->
    <div class="rounded-lg bg-surface-subtle p-4 ring-1 ring-edge">
      <h4 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {{ isCase ? "Contributing signals" : "Why this fired" }}
      </h4>

      <!-- Case: signal list with axis + weight bars -->
      <ul v-if="isCase" class="mt-3 space-y-4">
        <li v-for="s in caseSignals" :key="s.ruleId" class="flex gap-3">
          <div class="flex shrink-0 flex-col items-start gap-1 pt-0.5">
            <span :class="['inline-flex rounded px-1.5 py-0.5 text-xs font-semibold uppercase', axisClass(s.axis)]">
              {{ s.axis }}
            </span>
            <span :class="[BADGE_BASE, severityTone(s.severity)]">{{ s.severity }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="mb-1 flex items-center gap-2">
              <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
                <div
                  class="h-1.5 rounded-full"
                  :class="weightBarClass(s.weight)"
                  :style="{ width: `${s.weight}%` }"
                />
              </div>
              <span class="shrink-0 text-xs text-ink-subtle">{{ s.weight }}/100</span>
            </div>
            <p class="text-sm text-ink-secondary">{{ s.message }}</p>
            <p v-if="s.ruleId === 'card_multi_vehicle'" class="mt-0.5 text-xs font-medium text-brand-600">
              ↓ Sibling fills shown below
            </p>
          </div>
        </li>
      </ul>

      <!-- Single rule: formatted evidence key/value -->
      <dl v-else class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <template v-for="[k, v] in evidenceRows" :key="k">
          <dt class="text-ink-muted">{{ formatKey(k) }}</dt>
          <dd class="text-right font-medium text-ink">
            {{ Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : v }}
          </dd>
        </template>
      </dl>
    </div>

    <!-- ④ Same-card fills — appears whenever card_multi_vehicle is in play -->
    <div v-if="hasCardSignal" class="rounded-lg border border-warning-200 bg-warning-50/50 p-4">
      <div class="mb-3 flex flex-wrap items-baseline gap-2">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Same-card fills</h4>
        <span v-if="cardRef" class="font-mono text-xs text-ink-muted">card {{ cardRef }}</span>
        <span class="text-xs text-ink-subtle">· ±{{ windowHours }}h window</span>
      </div>

      <p v-if="!txn" class="text-sm text-ink-subtle italic">Loading transaction…</p>
      <p v-else-if="!cardRef" class="text-sm text-ink-subtle italic">No card reference on this transaction.</p>
      <p v-else-if="siblingLoading" class="text-sm text-ink-subtle">Loading related fills…</p>
      <p v-else-if="!siblingFills?.length" class="text-sm text-ink-subtle italic">No other fills found in this window.</p>

      <div v-else class="-mx-1 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="border-b border-warning-200 text-xs text-ink-muted">
              <th class="px-2 py-1.5 text-left font-medium">Vehicle</th>
              <th class="px-2 py-1.5 text-left font-medium">When</th>
              <th class="px-2 py-1.5 text-right font-medium">Gallons</th>
              <th class="px-2 py-1.5 text-right font-medium">$/gal</th>
              <th class="px-2 py-1.5 text-right font-medium">Odometer</th>
              <th class="px-2 py-1.5 text-left font-medium">Driver</th>
              <th class="px-2 py-1.5 text-left font-medium">Location</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-warning-100">
            <tr
              v-for="fill in siblingFills"
              :key="fill.id"
              :class="fill.id === txn?.id
                ? 'bg-warning-100 ring-1 ring-inset ring-warning-300'
                : 'bg-surface/70 hover:bg-warning-50'"
            >
              <td class="px-2 py-2">
                <div class="font-semibold text-ink">{{ unitNumber(fill.vehicle_id) }}</div>
                <div class="text-xs text-ink-subtle">{{ vehicleDesc(fill.vehicle_id) }}</div>
                <span v-if="fill.id === txn?.id" class="mt-0.5 inline-flex rounded bg-warning-200 px-1 py-0.5 text-xs font-medium text-warning-800">
                  this fill
                </span>
              </td>
              <td class="whitespace-nowrap px-2 py-2 text-ink-secondary">{{ fmtShort(fill.fueled_at, fill.state) }}</td>
              <td class="px-2 py-2 text-right font-medium text-ink">{{ fill.gallons }}</td>
              <td class="px-2 py-2 text-right text-ink-secondary">{{ fmtMoney(fill.price_per_gal) }}</td>
              <td class="px-2 py-2 text-right text-ink-secondary">{{ fmtOdo(fill.odometer) }}</td>
              <td class="px-2 py-2 text-ink-secondary">{{ driverName(fill.driver_id) }}</td>
              <td class="px-2 py-2 text-xs text-ink-muted">
                {{ [fill.city, fill.state].filter(Boolean).join(", ") || fill.location_text || "—" }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ⑤ Transaction details (full) -->
    <div v-if="txn" class="rounded-lg border border-edge p-4">
      <h4 class="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Transaction</h4>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <!-- Vehicle -->
        <dt class="text-ink-muted">Vehicle</dt>
        <dd class="text-right">
          <span class="font-semibold text-ink">{{ vehicleUnit }}</span>
          <span v-if="vehicleDesc(txn.vehicle_id)" class="ml-1 text-xs text-ink-subtle">
            {{ vehicleDesc(txn.vehicle_id) }}
          </span>
        </dd>
        <!-- Driver -->
        <dt class="text-ink-muted">Driver</dt>
        <dd class="text-right text-ink">{{ driverName(txn.driver_id) }}</dd>
        <!-- Card -->
        <template v-if="txn.card_ref">
          <dt class="text-ink-muted">Card #</dt>
          <dd class="text-right font-mono text-ink">{{ txn.card_ref }}</dd>
        </template>
        <!-- When -->
        <dt class="text-ink-muted">When</dt>
        <dd class="text-right text-ink">{{ fmt(txn.fueled_at, txn.state) }}</dd>
        <!-- Odometer -->
        <dt class="text-ink-muted">Odometer</dt>
        <dd class="text-right text-ink">{{ fmtOdo(txn.odometer) }}</dd>
        <!-- Gallons -->
        <dt class="text-ink-muted">Gallons</dt>
        <dd class="text-right font-semibold text-ink">{{ txn.gallons }}</dd>
        <!-- $/gal -->
        <template v-if="txn.price_per_gal != null">
          <dt class="text-ink-muted">$/gal</dt>
          <dd class="text-right text-ink">{{ fmtMoney(txn.price_per_gal) }}</dd>
        </template>
        <!-- Total cost -->
        <template v-if="txn.total_cost != null">
          <dt class="text-ink-muted">Total cost</dt>
          <dd class="text-right font-semibold text-ink">{{ fmtMoney(txn.total_cost) }}</dd>
        </template>
        <!-- MPG -->
        <dt class="text-ink-muted">MPG</dt>
        <dd class="text-right text-ink">{{ txn.computed_mpg ?? "—" }}</dd>
        <!-- Location -->
        <dt class="text-ink-muted">Location</dt>
        <dd class="text-right text-xs text-ink-secondary">
          {{
            txn.location_text
              ? txn.location_text
              : [txn.city, txn.state].filter(Boolean).join(", ") || "—"
          }}
        </dd>
        <!-- Samsara location check -->
        <template v-if="txn.samsara_location_matched != null">
          <dt class="text-ink-muted">Samsara location</dt>
          <dd class="text-right">
            <span v-if="txn.samsara_location_matched" class="text-xs font-medium text-success-700">✓ Confirmed</span>
            <span v-else class="text-xs font-semibold text-danger-700">✗ Mismatch</span>
          </dd>
        </template>
        <!-- Source -->
        <dt class="text-ink-muted">Source</dt>
        <dd class="text-right capitalize text-ink-secondary">{{ txn.source }}</dd>
      </dl>
    </div>

    <!-- ⑥ AI assessment -->
    <div class="space-y-2">
      <AiAssessmentCard :assessment="assessment ?? null" :loading="aiLoading || aiExamine.isPending.value" />
      <button
        class="text-xs font-medium text-brand-600 hover:text-brand-500 disabled:opacity-50"
        :disabled="aiExamine.isPending.value"
        @click="reexamine"
      >
        {{ aiExamine.isPending.value ? "Running…" : "AI re-examine" }}
      </button>
    </div>

    </template>

    <!-- ⑦ Workflow -->
    <div v-if="anomaly.status === 'open' || anomaly.status === 'investigating'" class="space-y-4 border-t border-edge pt-5">
      <div>
        <p class="mb-1.5 text-xs font-medium text-ink-muted">Quick action</p>
        <button
          :disabled="transition.isPending.value"
          class="rounded-md bg-warning-50 px-3 py-2 text-sm font-medium text-warning-800 ring-1 ring-warning-200 hover:bg-warning-100 disabled:opacity-50"
          title="Checked and confirmed not real — dismiss without re-raising"
          @click="doFalseAlarm"
        >
          Mark as false alarm
        </button>
      </div>
      <div class="space-y-3">
        <p class="text-xs font-medium text-ink-muted">Advance status</p>
        <div>
          <p class="mb-1.5 text-xs text-ink-muted">Outcome <span class="text-ink-subtle">(required to resolve or dismiss — this is what measures our accuracy)</span></p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="opt in DISPOSITION_OPTIONS"
              :key="opt.value"
              type="button"
              class="rounded-full px-3 py-1 text-sm ring-1 ring-inset transition-colors"
              :class="disposition === opt.value ? 'bg-brand-600 text-ink-inverse ring-brand-600' : 'bg-surface text-ink-secondary ring-edge-strong hover:bg-surface-subtle'"
              @click="disposition = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
        <textarea
          v-model="note"
          rows="2"
          placeholder="Resolution note (optional for investigating, recommended for resolve / dismiss)"
          class="block w-full rounded-md border-0 bg-surface px-3 py-1.5 text-base text-ink ring-1 ring-inset ring-edge-strong placeholder:text-ink-subtle focus:ring-2 focus:ring-brand-600 sm:text-sm"
        ></textarea>
        <div class="flex flex-wrap gap-2">
          <button
            v-if="anomaly.status === 'open'"
            :disabled="transition.isPending.value"
            class="rounded-md bg-warning-100 px-3 py-2 text-sm font-medium text-warning-800 hover:bg-warning-200 disabled:opacity-50"
            @click="doTransition('investigating')"
          >
            Start investigating
          </button>
          <button
            :disabled="transition.isPending.value"
            class="rounded-md bg-success-600 px-3 py-2 text-sm font-semibold text-ink-inverse hover:bg-success-500 disabled:opacity-50"
            @click="doTransition('resolved')"
          >
            Resolve
          </button>
          <BaseButton :disabled="transition.isPending.value" @click="doTransition('dismissed')">
            Dismiss
          </BaseButton>
        </div>
      </div>
    </div>
    <div v-else class="border-t border-edge pt-4 text-sm text-ink-muted">
      <p v-if="anomaly.status === 'resolved'">
        Resolved<span v-if="anomaly.resolution_note"> — {{ anomaly.resolution_note }}</span>
      </p>
      <p v-else-if="anomaly.resolution_note === 'False alarm'">Marked as false alarm</p>
      <p v-else>
        Dismissed<span v-if="anomaly.resolution_note"> — {{ anomaly.resolution_note }}</span>
      </p>
      <p v-if="anomaly.disposition" class="mt-1 text-xs">
        Outcome: <span class="font-medium text-ink-secondary">{{ DISPOSITION_LABELS[anomaly.disposition] }}</span>
      </p>
    </div>

  </div>
</template>
