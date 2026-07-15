<script setup lang="ts">
import { reactive, computed } from "vue";
import { PlusIcon, XMarkIcon, MapIcon } from "@heroicons/vue/24/outline";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import FormField from "@/components/ui/FormField.vue";
import { HAZMAT_OPTIONS, type PlanRequest } from "./useFuelPlan";

const props = defineProps<{ loading?: boolean }>();
const emit = defineEmits<{ submit: [req: PlanRequest] }>();

const { data: vehicles } = useVehiclesQuery();
const trucks = computed(() => (vehicles.value ?? []).filter((v) => v.status !== "retired"));

const SELECT_CLS = "w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-sm text-ink";

const form = reactive({
  vehicleId: "",
  origin: "",
  destination: "",
  waypoints: [] as string[],
  loadGrossLb: "",
  hazmat: "",
});

const canSubmit = computed(() => form.vehicleId && form.origin.trim() && form.destination.trim() && !props.loading);

function addWaypoint() {
  form.waypoints.push("");
}
function removeWaypoint(i: number) {
  form.waypoints.splice(i, 1);
}
function submit() {
  if (!canSubmit.value) return;
  emit("submit", {
    vehicleId: form.vehicleId,
    origin: { text: form.origin.trim() },
    destination: { text: form.destination.trim() },
    waypoints: form.waypoints.map((w) => w.trim()).filter(Boolean).map((text) => ({ text })),
    loadGrossLb: form.loadGrossLb ? Number(form.loadGrossLb) : null,
    hazmat: form.hazmat ? [form.hazmat] : [],
  });
}
</script>

<template>
  <BaseCard as="form" @submit.prevent="submit">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField v-slot="{ id }" label="Truck">
        <select :id="id" v-model="form.vehicleId" :class="SELECT_CLS">
          <option value="" disabled>Select a truck…</option>
          <option v-for="t in trucks" :key="t.id" :value="t.id">{{ t.unit_number }}</option>
        </select>
      </FormField>
      <FormField v-slot="{ id }" label="Hazmat class" hint="Per load — changes the legal truck route.">
        <select :id="id" v-model="form.hazmat" :class="SELECT_CLS">
          <option v-for="h in HAZMAT_OPTIONS" :key="h.value" :value="h.value">{{ h.label }}</option>
        </select>
      </FormField>
      <FormField v-slot="{ id }" label="Start">
        <BaseInput :id="id" v-model="form.origin" placeholder="City, ST or address" />
      </FormField>
      <FormField v-slot="{ id }" label="Destination">
        <BaseInput :id="id" v-model="form.destination" placeholder="City, ST or address" />
      </FormField>
    </div>

    <div v-if="form.waypoints.length" class="mt-4 space-y-2">
      <FormField v-for="(_, i) in form.waypoints" :key="i" v-slot="{ id }" :label="`Stop ${i + 1}`">
        <div class="flex items-center gap-2">
          <BaseInput :id="id" v-model="form.waypoints[i]" placeholder="City, ST or address" />
          <BaseButton variant="ghost" size="sm" type="button" @click="removeWaypoint(i)"><XMarkIcon class="size-4" /></BaseButton>
        </div>
      </FormField>
    </div>

    <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
      <BaseButton variant="ghost" size="sm" type="button" @click="addWaypoint">
        <PlusIcon class="-ml-0.5 size-4" aria-hidden="true" /> Add stop
      </BaseButton>
      <div class="flex items-center gap-3">
        <FormField v-slot="{ id }" label="" class="w-40">
          <BaseInput :id="id" v-model="form.loadGrossLb" inputmode="numeric" placeholder="Load lb (opt.)" />
        </FormField>
        <BaseButton variant="primary" type="submit" :disabled="!canSubmit">
          <MapIcon class="-ml-0.5 size-5" aria-hidden="true" />
          {{ loading ? "Planning…" : "Generate plan" }}
        </BaseButton>
      </div>
    </div>
  </BaseCard>
</template>
