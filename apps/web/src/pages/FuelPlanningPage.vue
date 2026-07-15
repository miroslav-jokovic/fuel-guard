<script setup lang="ts">
import { ref } from "vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import FuelPlanForm from "@/features/fueling/FuelPlanForm.vue";
import PlanStatusBanner from "@/features/fueling/PlanStatusBanner.vue";
import FuelPlanSummary from "@/features/fueling/FuelPlanSummary.vue";
import FuelStopsTable from "@/features/fueling/FuelStopsTable.vue";
import { useFuelPlan, type PlanRequest, type PlanResult } from "@/features/fueling/useFuelPlan";
import { useToastStore } from "@/stores/toast";

const plan = useFuelPlan();
const toast = useToastStore();
const result = ref<PlanResult | null>(null);

async function onSubmit(req: PlanRequest) {
  try {
    result.value = await plan.mutateAsync(req);
  } catch (e) {
    result.value = null;
    toast.error("Could not generate a plan", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Enter a route and a truck to get where-to-fuel suggestions — optimized for lowest net cost within the truck's range, reserve, and hours of service. Read-only: the dispatcher decides." />

    <FuelPlanForm :loading="plan.isPending.value" @submit="onSubmit" />

    <template v-if="result">
      <PlanStatusBanner :status="result.status" :message="result.message" />
      <FuelPlanSummary v-if="result.plan" :result="result" />
      <FuelStopsTable v-if="result.plan" :stops="result.plan.stops" />
    </template>
  </div>
</template>
