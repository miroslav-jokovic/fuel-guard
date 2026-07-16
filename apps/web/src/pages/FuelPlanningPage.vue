<script setup lang="ts">
import { ref, watch } from "vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import { ArrowPathIcon } from "@heroicons/vue/24/outline";
import FuelPlanForm from "@/features/fueling/FuelPlanForm.vue";
import PlanStatusBanner from "@/features/fueling/PlanStatusBanner.vue";
import FuelPlanSummary from "@/features/fueling/FuelPlanSummary.vue";
import RouteMap from "@/features/fueling/RouteMap.vue";
import RouteSummary from "@/features/fueling/RouteSummary.vue";
import TripPlan from "@/features/fueling/TripPlan.vue";
import ManualTelematicsPanel from "@/features/fueling/ManualTelematicsPanel.vue";
import { useFuelPlan, type PlanRequest, type PlanResult } from "@/features/fueling/useFuelPlan";
import { useToastStore } from "@/stores/toast";

const plan = useFuelPlan();
const toast = useToastStore();
const formRef = ref<InstanceType<typeof FuelPlanForm> | null>(null);
const result = ref<PlanResult | null>(null);
const routeLabels = ref<{ origin: string; destination: string; waypoints: string[] } | null>(null);
const lastRequest = ref<PlanRequest | null>(null);

// Persist the last plan across a page refresh so a reload never wipes the dispatcher's work.
const RESULT_KEY = "fuelguard:fuelplan:result";
try {
  const saved = localStorage.getItem(RESULT_KEY);
  if (saved) {
    const p = JSON.parse(saved) as { result: PlanResult | null; labels: typeof routeLabels.value; request?: PlanRequest | null };
    result.value = p.result ?? null;
    routeLabels.value = p.labels ?? null;
    lastRequest.value = p.request ?? null;
  }
} catch { /* ignore corrupt storage */ }
watch([result, routeLabels], () => {
  try {
    if (result.value) localStorage.setItem(RESULT_KEY, JSON.stringify({ result: result.value, labels: routeLabels.value, request: lastRequest.value }));
    else localStorage.removeItem(RESULT_KEY);
  } catch { /* quota/private mode */ }
}, { deep: true });

/** Start a fresh plan: clear the form and the last result (and their persisted copies). */
function newPlan() {
  result.value = null;
  routeLabels.value = null;
  lastRequest.value = null;
  formRef.value?.reset();
}

async function runPlan(req: PlanRequest) {
  try {
    result.value = await plan.mutateAsync(req);
    lastRequest.value = req;
  } catch (e) {
    result.value = null;
    toast.error("Could not generate a plan", e instanceof Error ? e.message : undefined);
  }
}

async function onSubmit(req: PlanRequest, labels: { origin: string; destination: string; waypoints: string[] }) {
  routeLabels.value = labels;
  await runPlan(req);
}

/** Re-run the plan with a dispatcher-entered fuel level when live telematics is unavailable. */
async function onManualSubmit(manual: { fuelPct: number; hos: PlanRequest["manualHos"] }) {
  if (!lastRequest.value) return;
  await runPlan({ ...lastRequest.value, manualFuelPct: manual.fuelPct, manualHos: manual.hos });
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Enter a route and a truck to get where-to-fuel suggestions — optimized for lowest net cost within the truck's range, reserve, and hours of service. Read-only: the dispatcher decides.">
      <template #actions>
        <BaseButton variant="secondary" size="sm" @click="newPlan">
          <ArrowPathIcon class="-ml-0.5 size-4" aria-hidden="true" /> New plan
        </BaseButton>
      </template>
    </PageHeader>

    <FuelPlanForm ref="formRef" :loading="plan.isPending.value" @submit="onSubmit" />

    <template v-if="result">
      <PlanStatusBanner :status="result.status" :message="result.message" />
      <ManualTelematicsPanel
        v-if="result.status === 'telematics_unavailable'"
        :message="result.message"
        :loading="plan.isPending.value"
        @submit="onManualSubmit"
      />
      <p v-if="result.manualFuelUsed" class="rounded-md bg-caution-50 px-3 py-2 text-sm text-caution-800">
        Planned from a manually-entered fuel level — live Samsara data was unavailable for this truck.
      </p>
      <FuelPlanSummary v-if="result.plan" :result="result" />
      <RouteSummary
        v-if="result.route"
        :route="result.route"
        :origin="routeLabels?.origin"
        :destination="routeLabels?.destination"
        :waypoints="routeLabels?.waypoints"
        :stop-count="result.plan?.stops.length"
        :truck="result.truck"
        :break-advice="result.breakAdvice"
      />
      <RouteMap v-if="result.route" :route="result.route" :stops="(result.plan?.stops ?? []).filter((s) => s.kind === 'fuel')" :origin="result.origin" :destination="result.destination" />
      <TripPlan
        v-if="result.plan && result.route"
        :stops="result.plan.stops"
        :origin="routeLabels?.origin"
        :destination="routeLabels?.destination"
        :start-fuel-pct="result.truck?.fuelPct ?? null"
        :tank-capacity-gal="result.truck?.tankCapacityGal ?? null"
        :distance-miles="result.route.distanceMiles"
        :arrival-fuel-pct="result.plan.arrivalFuelPct"
        :directions="result.route.directions"
      />
    </template>
  </div>
</template>
