<script setup lang="ts">
import { computed } from "vue";
import { CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon, XCircleIcon } from "@heroicons/vue/24/outline";
import type { PlanResultStatus } from "./useFuelPlan";

const props = defineProps<{ status: PlanResultStatus; message?: string }>();

const META: Record<PlanResultStatus, { tone: string; icon: unknown; title: string }> = {
  ok: { tone: "success", icon: CheckCircleIcon, title: "Plan ready" },
  emergency_used: { tone: "warning", icon: ExclamationTriangleIcon, title: "Plan ready — emergency stop used" },
  infeasible: { tone: "danger", icon: XCircleIcon, title: "Cannot plan safely — driver must act" },
  routing_unavailable: { tone: "info", icon: InformationCircleIcon, title: "Routing not configured" },
  no_stations: { tone: "info", icon: InformationCircleIcon, title: "No stations loaded for this corridor" },
  telematics_unavailable: { tone: "info", icon: InformationCircleIcon, title: "Live truck data unavailable" },
  error: { tone: "danger", icon: XCircleIcon, title: "Could not generate a plan" },
};
const m = computed(() => META[props.status]);
const PANEL: Record<string, string> = {
  success: "bg-success-50 ring-success-200 text-success-800",
  warning: "bg-warning-50 ring-warning-200 text-warning-800",
  danger: "bg-danger-50 ring-danger-200 text-danger-800",
  info: "bg-info-50 ring-info-200 text-info-800",
};
const ICON: Record<string, string> = {
  success: "text-success-600",
  warning: "text-warning-600",
  danger: "text-danger-600",
  info: "text-info-600",
};
</script>

<template>
  <div class="flex items-start gap-3 rounded-lg p-4 ring-1" :class="PANEL[m.tone]">
    <component :is="m.icon" class="mt-0.5 size-5 shrink-0" :class="ICON[m.tone]" aria-hidden="true" />
    <div class="min-w-0">
      <p class="text-sm font-semibold">{{ m.title }}</p>
      <p v-if="message" class="mt-0.5 text-sm">{{ message }}</p>
    </div>
  </div>
</template>
