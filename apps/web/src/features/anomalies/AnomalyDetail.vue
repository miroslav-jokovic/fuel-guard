<script setup lang="ts">
import { ref, computed } from "vue";
import { formatRuleId, type Anomaly } from "@fuelguard/shared";
import { useTransaction, useAnomalyTransition } from "./useAnomalies";
import { useAiVerification, useAiExamine } from "@/features/ai/useAiVerification";
import AiAssessmentCard from "@/features/ai/AiAssessmentCard.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import { useToastStore } from "@/stores/toast";

const props = defineProps<{ anomaly: Anomaly; vehicleUnit: string }>();
const emit = defineEmits<{ changed: [] }>();

const txnId = computed(() => props.anomaly.transaction_id);
const { data: txn } = useTransaction(txnId);
const { data: assessment, isFetching: aiLoading } = useAiVerification(txnId);
const aiExamine = useAiExamine();
const transition = useAnomalyTransition();

const toast = useToastStore();
const note = ref("");

const sevBadge = computed(() => {
  switch (props.anomaly.severity) {
    case "critical":
      return "bg-red-100 text-red-800";
    case "high":
      return "bg-orange-100 text-orange-800";
    case "medium":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-gray-100 text-gray-600";
  }
});

const evidenceRows = computed(() => Object.entries(props.anomaly.evidence ?? {}));
const fmt = (iso: string) => new Date(iso).toLocaleString();
const formatKey = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const STATUS_LABELS: Record<string, string> = {
  investigating: "Marked as investigating",
  resolved: "Anomaly resolved",
  dismissed: "Anomaly dismissed",
  false_alarm: "Marked as false alarm",
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
    <div class="flex flex-wrap items-center gap-2">
      <span :class="['inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize', sevBadge]">{{ anomaly.severity }}</span>
      <StatusBadge :status="anomaly.status" />
      <span class="text-xs text-gray-500" :title="anomaly.rule_id">{{ formatRuleId(anomaly.rule_id) }}</span>
    </div>

    <p class="text-sm text-gray-900">{{ anomaly.message }}</p>

    <!-- Why this fired -->
    <div class="rounded-md bg-gray-50 p-4">
      <h4 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Why this fired</h4>
      <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <template v-for="[k, v] in evidenceRows" :key="k">
          <dt class="text-gray-500">{{ formatKey(k) }}</dt>
          <dd class="text-right font-medium text-gray-900">{{ typeof v === "object" ? JSON.stringify(v) : v }}</dd>
        </template>
      </dl>
    </div>

    <!-- Transaction -->
    <div v-if="txn" class="rounded-md border border-gray-200 p-4">
      <h4 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Transaction</h4>
      <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt class="text-gray-500">Vehicle</dt><dd class="text-right text-gray-900">{{ vehicleUnit }}</dd>
        <dt class="text-gray-500">When</dt><dd class="text-right text-gray-900">{{ fmt(txn.fueled_at) }}</dd>
        <dt class="text-gray-500">Odometer</dt><dd class="text-right text-gray-900">{{ txn.odometer ?? "—" }}</dd>
        <dt class="text-gray-500">Gallons</dt><dd class="text-right text-gray-900">{{ txn.gallons }}</dd>
        <dt class="text-gray-500">MPG</dt><dd class="text-right text-gray-900">{{ txn.computed_mpg ?? "—" }}</dd>
        <dt class="text-gray-500">Location</dt><dd class="text-right text-gray-900">{{ txn.location_text ?? "—" }}</dd>
      </dl>
    </div>

    <!-- AI assessment -->
    <div class="space-y-2">
      <AiAssessmentCard :assessment="assessment ?? null" :loading="aiLoading || aiExamine.isPending.value" />
      <button class="text-xs font-medium text-indigo-600 hover:text-indigo-500 disabled:opacity-50" :disabled="aiExamine.isPending.value" @click="reexamine">
        {{ aiExamine.isPending.value ? "Running…" : "AI re-examine" }}
      </button>
    </div>

    <!-- Workflow -->
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
          <button v-if="anomaly.status === 'open'" :disabled="transition.isPending.value" class="rounded-md bg-amber-100 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-200 disabled:opacity-50" @click="doTransition('investigating')">
            Start investigating
          </button>
          <button :disabled="transition.isPending.value" class="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50" @click="doTransition('resolved')">
            Resolve
          </button>
          <button :disabled="transition.isPending.value" class="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50" @click="doTransition('dismissed')">
            Dismiss
          </button>
        </div>
      </div>
    </div>
    <div v-else class="border-t border-gray-200 pt-4 text-sm text-gray-500">
      <p v-if="anomaly.status === 'resolved'">
        Resolved<span v-if="anomaly.resolution_note"> — {{ anomaly.resolution_note }}</span>
      </p>
      <p v-else-if="anomaly.resolution_note === 'False alarm'">
        Marked as false alarm
      </p>
      <p v-else>
        Dismissed<span v-if="anomaly.resolution_note"> — {{ anomaly.resolution_note }}</span>
      </p>
    </div>
  </div>
</template>
