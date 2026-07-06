<script setup lang="ts">
import { ref, computed } from "vue";
import { formatRuleId, type Anomaly } from "@fuelguard/shared";
import { useTransaction, useAnomalyTransition, useRelatedCardFills } from "./useAnomalies";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useDriversQuery } from "@/features/fleet/useDrivers";
import { useAiVerification, useAiExamine } from "@/features/ai/useAiVerification";
import AiAssessmentCard from "@/features/ai/AiAssessmentCard.vue";
import AnomalyAudit from "./AnomalyAudit.vue";
import { useOrgSettingsQuery } from "@/features/settings/useOrgSettings";
import StatusBadge from "@/components/StatusBadge.vue";
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
    location:    "bg-orange-100 text-orange-700",
    volume:      "bg-red-100 text-red-700",
    consumption: "bg-amber-100 text-amber-700",
    odometer:    "bg-violet-100 text-violet-700",
    behavior:    "bg-blue-100 text-blue-700",
    reefer:      "bg-cyan-100 text-cyan-700",
  };
  return map[axis] ?? "bg-gray-100 text-gray-600";
};
const weightBarClass = (w: number): string => {
  if (w >= 75) return "bg-red-500";
  if (w >= 50) return "bg-orange-400";
  if (w >= 25) return "bg-amber-400";
  return "bg-gray-300";
};

// ── formatting ────────────────────────────────────────────────────────────────
const fmt     = (iso: string) => new Date(iso).toLocaleString();
const fmtShort = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtOdo  = (n: number | null) => (n != null ? n.toLocaleString() + " mi" : "—");
const fmtMoney = (n: number | null, prefix = "$") => (n != null ? prefix + n.toFixed(2) : "—");
const formatKey = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ── workflow ──────────────────────────────────────────────────────────────────
const toast = useToastStore();
const note  = ref("");

const STATUS_LABELS: Record<string, string> = {
  investigating: "Marked as investigating",
  resolved:      "Anomaly resolved",
  dismissed:     "Anomaly dismissed",
};

async function doTransition(status: "investigating" | "resolved" | "dismissed") {
  try {
    await transition.mutateAsync({ id: props.anomaly.id, status, note: note.value || undefined, version: props.anomaly.version });
    note.value = "";
    toast.success(STATUS_LABELS[status] ?? "Status updated");
    emit("changed");
  } catch (e) {
    toast.error("Update failed", e instanceof Error ? e.message : undefined);
  }
}

async function doFalseAlarm() {
  try {
    await transition.mutateAsync({ id: props.anomaly.id, status: "dismissed", note: "False alarm", version: props.anomaly.version });
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
      <span class="text-xs text-gray-500" :title="anomaly.rule_id">{{ formatRuleId(anomaly.rule_id) }}</span>
    </div>

    <p class="text-sm leading-relaxed text-gray-900">{{ anomaly.message }}</p>

    <!-- ② Case score banner (theft_case only) -->
    <div
      v-if="isCase && caseScore != null"
      class="flex flex-wrap items-center gap-4 rounded-lg bg-amber-50 px-4 py-3 ring-1 ring-amber-200"
    >
      <div class="flex flex-1 flex-col gap-1 min-w-[10rem]">
        <div class="flex items-center justify-between text-xs">
          <span class="font-semibold text-gray-700">Correlation score</span>
          <span class="font-bold text-gray-900">{{ caseScore }}<span class="font-normal text-gray-400"> / 200</span></span>
        </div>
        <div class="h-2 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            class="h-2 rounded-full transition-all"
            :class="caseLevel === 'alert' ? 'bg-red-500' : 'bg-amber-400'"
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
    <div class="flex gap-1 border-b border-gray-200 text-sm">
      <button
        class="-mb-px border-b-2 px-3 py-1.5 font-medium"
        :class="tab === 'overview' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'"
        @click="tab = 'overview'"
      >
        Overview
      </button>
      <button
        class="-mb-px border-b-2 px-3 py-1.5 font-medium"
        :class="tab === 'audit' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'"
        @click="tab = 'audit'"
      >
        Odometer &amp; Location
      </button>
    </div>

    <!-- AUDIT TAB -->
    <AnomalyAudit v-if="tab === 'audit' && txn" :txn="txn" :odometer-offset="odometerOffset" :tz="orgTz" />
    <p v-else-if="tab === 'audit'" class="text-sm text-gray-400 italic">Loading transaction…</p>

    <!-- OVERVIEW TAB -->
    <template v-if="tab === 'overview'">
    <!-- ③ Contributing signals / Why this fired -->
    <div class="rounded-lg bg-gray-50 p-4 ring-1 ring-gray-200">
      <h4 class="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
              <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
                <div
                  class="h-1.5 rounded-full"
                  :class="weightBarClass(s.weight)"
                  :style="{ width: `${s.weight}%` }"
                />
              </div>
              <span class="shrink-0 text-xs text-gray-400">{{ s.weight }}/100</span>
            </div>
            <p class="text-sm text-gray-800">{{ s.message }}</p>
            <p v-if="s.ruleId === 'card_multi_vehicle'" class="mt-0.5 text-xs font-medium text-indigo-600">
              ↓ Sibling fills shown below
            </p>
          </div>
        </li>
      </ul>

      <!-- Single rule: formatted evidence key/value -->
      <dl v-else class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <template v-for="[k, v] in evidenceRows" :key="k">
          <dt class="text-gray-500">{{ formatKey(k) }}</dt>
          <dd class="text-right font-medium text-gray-900">
            {{ Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : v }}
          </dd>
        </template>
      </dl>
    </div>

    <!-- ④ Same-card fills — appears whenever card_multi_vehicle is in play -->
    <div v-if="hasCardSignal" class="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
      <div class="mb-3 flex flex-wrap items-baseline gap-2">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-gray-600">Same-card fills</h4>
        <span v-if="cardRef" class="font-mono text-xs text-gray-500">card {{ cardRef }}</span>
        <span class="text-xs text-gray-400">· ±{{ windowHours }}h window</span>
      </div>

      <p v-if="!txn" class="text-sm text-gray-400 italic">Loading transaction…</p>
      <p v-else-if="!cardRef" class="text-sm text-gray-400 italic">No card reference on this transaction.</p>
      <p v-else-if="siblingLoading" class="text-sm text-gray-400">Loading related fills…</p>
      <p v-else-if="!siblingFills?.length" class="text-sm text-gray-400 italic">No other fills found in this window.</p>

      <div v-else class="-mx-1 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="border-b border-amber-200 text-xs text-gray-500">
              <th class="px-2 py-1.5 text-left font-medium">Vehicle</th>
              <th class="px-2 py-1.5 text-left font-medium">When</th>
              <th class="px-2 py-1.5 text-right font-medium">Gallons</th>
              <th class="px-2 py-1.5 text-right font-medium">$/gal</th>
              <th class="px-2 py-1.5 text-right font-medium">Odometer</th>
              <th class="px-2 py-1.5 text-left font-medium">Driver</th>
              <th class="px-2 py-1.5 text-left font-medium">Location</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-amber-100">
            <tr
              v-for="fill in siblingFills"
              :key="fill.id"
              :class="fill.id === txn?.id
                ? 'bg-amber-100 ring-1 ring-inset ring-amber-300'
                : 'bg-white/70 hover:bg-amber-50'"
            >
              <td class="px-2 py-2">
                <div class="font-semibold text-gray-900">{{ unitNumber(fill.vehicle_id) }}</div>
                <div class="text-xs text-gray-400">{{ vehicleDesc(fill.vehicle_id) }}</div>
                <span v-if="fill.id === txn?.id" class="mt-0.5 inline-flex rounded bg-amber-200 px-1 py-0.5 text-xs font-medium text-amber-800">
                  this fill
                </span>
              </td>
              <td class="whitespace-nowrap px-2 py-2 text-gray-700">{{ fmtShort(fill.fueled_at) }}</td>
              <td class="px-2 py-2 text-right font-medium text-gray-900">{{ fill.gallons }}</td>
              <td class="px-2 py-2 text-right text-gray-600">{{ fmtMoney(fill.price_per_gal) }}</td>
              <td class="px-2 py-2 text-right text-gray-700">{{ fmtOdo(fill.odometer) }}</td>
              <td class="px-2 py-2 text-gray-700">{{ driverName(fill.driver_id) }}</td>
              <td class="px-2 py-2 text-xs text-gray-500">
                {{ [fill.city, fill.state].filter(Boolean).join(", ") || fill.location_text || "—" }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ⑤ Transaction details (full) -->
    <div v-if="txn" class="rounded-lg border border-gray-200 p-4">
      <h4 class="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Transaction</h4>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <!-- Vehicle -->
        <dt class="text-gray-500">Vehicle</dt>
        <dd class="text-right">
          <span class="font-semibold text-gray-900">{{ vehicleUnit }}</span>
          <span v-if="vehicleDesc(txn.vehicle_id)" class="ml-1 text-xs text-gray-400">
            {{ vehicleDesc(txn.vehicle_id) }}
          </span>
        </dd>
        <!-- Driver -->
        <dt class="text-gray-500">Driver</dt>
        <dd class="text-right text-gray-900">{{ driverName(txn.driver_id) }}</dd>
        <!-- Card -->
        <template v-if="txn.card_ref">
          <dt class="text-gray-500">Card #</dt>
          <dd class="text-right font-mono text-gray-900">{{ txn.card_ref }}</dd>
        </template>
        <!-- When -->
        <dt class="text-gray-500">When</dt>
        <dd class="text-right text-gray-900">{{ fmt(txn.fueled_at) }}</dd>
        <!-- Odometer -->
        <dt class="text-gray-500">Odometer</dt>
        <dd class="text-right text-gray-900">{{ fmtOdo(txn.odometer) }}</dd>
        <!-- Gallons -->
        <dt class="text-gray-500">Gallons</dt>
        <dd class="text-right font-semibold text-gray-900">{{ txn.gallons }}</dd>
        <!-- $/gal -->
        <template v-if="txn.price_per_gal != null">
          <dt class="text-gray-500">$/gal</dt>
          <dd class="text-right text-gray-900">{{ fmtMoney(txn.price_per_gal) }}</dd>
        </template>
        <!-- Total cost -->
        <template v-if="txn.total_cost != null">
          <dt class="text-gray-500">Total cost</dt>
          <dd class="text-right font-semibold text-gray-900">{{ fmtMoney(txn.total_cost) }}</dd>
        </template>
        <!-- MPG -->
        <dt class="text-gray-500">MPG</dt>
        <dd class="text-right text-gray-900">{{ txn.computed_mpg ?? "—" }}</dd>
        <!-- Location -->
        <dt class="text-gray-500">Location</dt>
        <dd class="text-right text-xs text-gray-700">
          {{
            txn.location_text
              ? txn.location_text
              : [txn.city, txn.state].filter(Boolean).join(", ") || "—"
          }}
        </dd>
        <!-- Samsara location check -->
        <template v-if="txn.samsara_location_matched != null">
          <dt class="text-gray-500">Samsara location</dt>
          <dd class="text-right">
            <span v-if="txn.samsara_location_matched" class="text-xs font-medium text-green-700">✓ Confirmed</span>
            <span v-else class="text-xs font-semibold text-red-700">✗ Mismatch</span>
          </dd>
        </template>
        <!-- Source -->
        <dt class="text-gray-500">Source</dt>
        <dd class="text-right capitalize text-gray-700">{{ txn.source }}</dd>
      </dl>
    </div>

    <!-- ⑥ AI assessment -->
    <div class="space-y-2">
      <AiAssessmentCard :assessment="assessment ?? null" :loading="aiLoading || aiExamine.isPending.value" />
      <button
        class="text-xs font-medium text-indigo-600 hover:text-indigo-500 disabled:opacity-50"
        :disabled="aiExamine.isPending.value"
        @click="reexamine"
      >
        {{ aiExamine.isPending.value ? "Running…" : "AI re-examine" }}
      </button>
    </div>

    </template>

    <!-- ⑦ Workflow -->
    <div v-if="anomaly.status === 'open' || anomaly.status === 'investigating'" class="space-y-4 border-t border-gray-200 pt-5">
      <div>
        <p class="mb-1.5 text-xs font-medium text-gray-500">Quick action</p>
        <button
          :disabled="transition.isPending.value"
          class="rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100 disabled:opacity-50"
          title="Checked and confirmed not real — dismiss without re-raising"
          @click="doFalseAlarm"
        >
          Mark as false alarm
        </button>
      </div>
      <div class="space-y-3">
        <p class="text-xs font-medium text-gray-500">Advance status</p>
        <textarea
          v-model="note"
          rows="2"
          placeholder="Resolution note (optional for investigating, recommended for resolve / dismiss)"
          class="block w-full rounded-md border-0 px-3 py-2 text-sm text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-600"
        ></textarea>
        <div class="flex flex-wrap gap-2">
          <button
            v-if="anomaly.status === 'open'"
            :disabled="transition.isPending.value"
            class="rounded-md bg-amber-100 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-200 disabled:opacity-50"
            @click="doTransition('investigating')"
          >
            Start investigating
          </button>
          <button
            :disabled="transition.isPending.value"
            class="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
            @click="doTransition('resolved')"
          >
            Resolve
          </button>
          <button
            :disabled="transition.isPending.value"
            class="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50"
            @click="doTransition('dismissed')"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
    <div v-else class="border-t border-gray-200 pt-4 text-sm text-gray-500">
      <p v-if="anomaly.status === 'resolved'">
        Resolved<span v-if="anomaly.resolution_note"> — {{ anomaly.resolution_note }}</span>
      </p>
      <p v-else-if="anomaly.resolution_note === 'False alarm'">Marked as false alarm</p>
      <p v-else>
        Dismissed<span v-if="anomaly.resolution_note"> — {{ anomaly.resolution_note }}</span>
      </p>
    </div>

  </div>
</template>
