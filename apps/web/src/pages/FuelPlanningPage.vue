<script setup lang="ts">
import { ref } from "vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import FuelPlanForm from "@/features/fueling/FuelPlanForm.vue";
import PlanStatusBanner from "@/features/fueling/PlanStatusBanner.vue";
import FuelPlanSummary from "@/features/fueling/FuelPlanSummary.vue";
import RouteMap from "@/features/fueling/RouteMap.vue";
import RouteSummary from "@/features/fueling/RouteSummary.vue";
import RouteDirections from "@/features/fueling/RouteDirections.vue";
import PriceUploadCard from "@/features/fueling/PriceUploadCard.vue";
import { useSessionStore } from "@/stores/session";
import FuelStopsTable from "@/features/fueling/FuelStopsTable.vue";
import { useFuelPlan, type PlanRequest, type PlanResult } from "@/features/fueling/useFuelPlan";
import { useToastStore } from "@/stores/toast";

const plan = useFuelPlan();
const toast = useToastStore();
const session = useSessionStore();
const result = ref<PlanResult | null>(null);
const routeLabels = ref<{ origin: string; destination: string; waypoints: string[] } | null>(null);

async function onSubmit(req: PlanRequest, labels: { origin: string; destination: string; waypoints: string[] }) {
  try {
    result.value = await plan.mutateAsync(req);
    routeLabels.value = labels;
  } catch (e) {
    result.value = null;
    toast.error("Could not generate a plan", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Enter a route and a truck to get where-to-fuel suggestions — optimized for lowest net cost within the truck's range, reserve, and hours of service. Read-only: the dispatcher decides." />

    <PriceUploadCard v-if="session.canManage" />

    <FuelPlanForm :loading="plan.isPending.value" @submit="onSubmit" />

    <template v-if="result">
      <PlanStatusBanner :status="result.status" :message="result.message" />
      <FuelPlanSummary v-if="result.plan" :result="result" />
      <RouteSummary
        v-if="result.route"
        :route="result.route"
        :origin="routeLabels?.origin"
        :destination="routeLabels?.destination"
        :waypoints="routeLabels?.waypoints"
        :stop-count="result.plan?.stops.length"
      />
      <RouteMap v-if="result.route" :route="result.route" :stops="result.plan?.stops ?? []" :origin="result.origin" :destination="result.destination" />
      <RouteDirections v-if="result.route" :directions="result.route.directions" />
      <FuelStopsTable v-if="result.plan" :stops="result.plan.stops" />
    </template>
  </div>
</template>
