<script setup lang="ts">
import { reactive, ref, computed } from "vue";
import {
  vehicleInputSchema,
  FUEL_TYPES,
  VEHICLE_STATUSES,
  APU_TYPES,
  APU_TYPE_LABELS,
  deriveHasApu,
  suggestIdleEquipment,
  type Vehicle,
  type VehicleInput,
  type Driver,
  type ApuType,
} from "@fuelguard/shared";
import AppSelect from "@/components/AppSelect.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import FormField from "@/components/ui/FormField.vue";

const props = defineProps<{
  vehicle?: Vehicle | null;
  drivers: Driver[];
  submitting?: boolean;
}>();
const emit = defineEmits<{ submit: [input: VehicleInput]; cancel: [] }>();

// Local form state as strings (inputs) — the schema coerces/validates on submit.
const form = reactive({
  unit_number: props.vehicle?.unit_number ?? "",
  make: props.vehicle?.make ?? "",
  model: props.vehicle?.model ?? "",
  year: props.vehicle?.year?.toString() ?? "",
  plate: props.vehicle?.plate ?? "",
  vin: props.vehicle?.vin ?? "",
  fuel_type: props.vehicle?.fuel_type ?? "diesel",
  tank_capacity_gal: props.vehicle?.tank_capacity_gal?.toString() ?? "",
  baseline_mpg: props.vehicle?.baseline_mpg?.toString() ?? "",
  current_odometer: props.vehicle?.current_odometer?.toString() ?? "0",
  status: props.vehicle?.status ?? "active",
  assigned_driver_id: props.vehicle?.assigned_driver_id ?? "",
  samsara_vehicle_id: props.vehicle?.samsara_vehicle_id ?? "",
  // Idle-reduction equipment (drives has_apu, derived on submit) + OEM optimized idle. Strings for the selects:
  // "" = unknown. has_apu is NOT a separate form field so equipment and "engine-off capable" can't contradict.
  apu_type: props.vehicle?.apu_type ?? "",
  has_optimized_idle:
    props.vehicle?.has_optimized_idle == null
      ? ""
      : props.vehicle.has_optimized_idle
        ? "true"
        : "false",
});

const errors = ref<Record<string, string>>({});

// In-form idle-equipment suggestion from make/model/year (admin confirms with one click; never auto-applied).
const idleSuggestion = computed(() =>
  suggestIdleEquipment({
    make: form.make || null,
    model: form.model || null,
    year: form.year ? Number(form.year) : null,
  }),
);
const showOptimizedSuggestion = computed(
  () => idleSuggestion.value?.hasOptimizedIdle === true && form.has_optimized_idle !== "true",
);
function applyOptimizedSuggestion() {
  form.has_optimized_idle = "true";
}

function onSubmit() {
  // has_apu (engine-off capable) is DERIVED from the equipment type so a truck can't be "has APU" with no
  // equipment, or vice-versa. "" equipment -> has_apu unset (unknown).
  const has_apu =
    form.apu_type === "" ? "" : deriveHasApu(form.apu_type as ApuType) ? "true" : "false";
  const result = vehicleInputSchema.safeParse({ ...form, has_apu });
  if (!result.success) {
    const map: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !map[key]) map[key] = issue.message;
    }
    errors.value = map;
    return;
  }
  errors.value = {};
  emit("submit", result.data);
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="onSubmit">
    <FormField v-slot="{ id }" label="Unit number" :error="errors.unit_number">
      <BaseInput :id="id" v-model="form.unit_number" :invalid="!!errors.unit_number" />
    </FormField>

    <div class="grid grid-cols-2 gap-3">
      <FormField v-slot="{ id }" label="Make">
        <BaseInput :id="id" v-model="form.make" />
      </FormField>
      <FormField v-slot="{ id }" label="Model">
        <BaseInput :id="id" v-model="form.model" />
      </FormField>
      <FormField v-slot="{ id }" label="Year" :error="errors.year">
        <BaseInput :id="id" v-model="form.year" inputmode="numeric" :invalid="!!errors.year" />
      </FormField>
      <FormField v-slot="{ id }" label="Plate">
        <BaseInput :id="id" v-model="form.plate" />
      </FormField>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <FormField label="Fuel type">
        <AppSelect
          v-model="form.fuel_type"
          :options="FUEL_TYPES.map((f) => ({ value: f, label: f }))"
        />
      </FormField>
      <FormField label="Status">
        <AppSelect
          v-model="form.status"
          :options="VEHICLE_STATUSES.map((s) => ({ value: s, label: s }))"
        />
      </FormField>
      <FormField v-slot="{ id }" label="Tank capacity (gal)" :error="errors.tank_capacity_gal">
        <BaseInput
          :id="id"
          v-model="form.tank_capacity_gal"
          inputmode="decimal"
          :invalid="!!errors.tank_capacity_gal"
        />
      </FormField>
      <FormField v-slot="{ id }" label="Baseline MPG" :error="errors.baseline_mpg">
        <BaseInput
          :id="id"
          v-model="form.baseline_mpg"
          inputmode="decimal"
          :invalid="!!errors.baseline_mpg"
        />
      </FormField>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <FormField v-slot="{ id }" label="Current odometer">
        <BaseInput :id="id" v-model="form.current_odometer" inputmode="decimal" />
      </FormField>
      <FormField label="Assigned driver">
        <AppSelect
          v-model="form.assigned_driver_id"
          :options="[
            { value: '', label: '— Unassigned —' },
            ...drivers.map((d) => ({ value: d.id, label: d.full_name })),
          ]"
        />
      </FormField>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <FormField v-slot="{ id }" label="Samsara vehicle ID">
        <BaseInput
          :id="id"
          v-model="form.samsara_vehicle_id"
          placeholder="For telematics odometer reconciliation"
        />
      </FormField>
      <FormField
        label="Idle-reduction equipment"
        hint="Lets the truck keep the cab comfortable with the engine off. Drives the 'avoidable idle' flag."
      >
        <AppSelect
          v-model="form.apu_type"
          :options="[
            { value: '', label: 'Unknown' },
            ...APU_TYPES.map((t) => ({ value: t, label: APU_TYPE_LABELS[t] })),
          ]"
        />
      </FormField>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <FormField
          label="OEM optimized idle (e.g. Cascadia)"
          hint="The engine auto start/stops on its own; its idling is the feature working, not driver waste."
        >
          <AppSelect
            v-model="form.has_optimized_idle"
            :options="[
              { value: '', label: 'Unknown' },
              { value: 'true', label: 'Yes' },
              { value: 'false', label: 'No' },
            ]"
          />
        </FormField>
        <button
          v-if="showOptimizedSuggestion"
          type="button"
          class="mt-1 rounded bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-100"
          :title="idleSuggestion?.reason"
          @click="applyOptimizedSuggestion"
        >
          Suggested: {{ idleSuggestion?.label }} — apply
        </button>
      </div>
    </div>

    <div class="flex justify-end gap-3 pt-2">
      <BaseButton @click="emit('cancel')">Cancel</BaseButton>
      <BaseButton type="submit" variant="primary" :disabled="submitting">
        {{ submitting ? "Saving…" : "Save vehicle" }}
      </BaseButton>
    </div>
  </form>
</template>
