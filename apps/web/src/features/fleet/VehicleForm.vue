<script setup lang="ts">
import { reactive, ref } from "vue";
import {
  vehicleInputSchema,
  FUEL_TYPES,
  VEHICLE_STATUSES,
  APU_TYPES,
  APU_TYPE_LABELS,
  deriveHasApu,
  type Vehicle,
  type VehicleInput,
  type Driver,
  type ApuType,
} from "@fuelguard/shared";
import AppSelect from "@/components/AppSelect.vue";

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

const inputCls =
  "mt-1 block w-full rounded-md border-0 px-3 py-1.5 text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-600 sm:text-sm";
</script>

<template>
  <form class="space-y-4" @submit.prevent="onSubmit">
    <div>
      <label class="block text-sm font-medium text-gray-900">Unit number</label>
      <input v-model="form.unit_number" :class="inputCls" />
      <p v-if="errors.unit_number" class="mt-1 text-xs text-red-600">{{ errors.unit_number }}</p>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="block text-sm font-medium text-gray-900">Make</label>
        <input v-model="form.make" :class="inputCls" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-900">Model</label>
        <input v-model="form.model" :class="inputCls" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-900">Year</label>
        <input v-model="form.year" inputmode="numeric" :class="inputCls" />
        <p v-if="errors.year" class="mt-1 text-xs text-red-600">{{ errors.year }}</p>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-900">Plate</label>
        <input v-model="form.plate" :class="inputCls" />
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="block text-sm font-medium text-gray-900">Fuel type</label>
        <AppSelect
          v-model="form.fuel_type"
          class="mt-1"
          :options="FUEL_TYPES.map((f) => ({ value: f, label: f }))"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-900">Status</label>
        <AppSelect
          v-model="form.status"
          class="mt-1"
          :options="VEHICLE_STATUSES.map((s) => ({ value: s, label: s }))"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-900">Tank capacity (gal)</label>
        <input v-model="form.tank_capacity_gal" inputmode="decimal" :class="inputCls" />
        <p v-if="errors.tank_capacity_gal" class="mt-1 text-xs text-red-600">
          {{ errors.tank_capacity_gal }}
        </p>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-900">Baseline MPG</label>
        <input v-model="form.baseline_mpg" inputmode="decimal" :class="inputCls" />
        <p v-if="errors.baseline_mpg" class="mt-1 text-xs text-red-600">
          {{ errors.baseline_mpg }}
        </p>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="block text-sm font-medium text-gray-900">Current odometer</label>
        <input v-model="form.current_odometer" inputmode="decimal" :class="inputCls" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-900">Assigned driver</label>
        <AppSelect
          v-model="form.assigned_driver_id"
          class="mt-1"
          :options="[
            { value: '', label: '— Unassigned —' },
            ...drivers.map((d) => ({ value: d.id, label: d.full_name })),
          ]"
        />
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="block text-sm font-medium text-gray-900">Samsara vehicle ID</label>
        <input
          v-model="form.samsara_vehicle_id"
          :class="inputCls"
          placeholder="For telematics odometer reconciliation"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-900">Idle-reduction equipment</label>
        <AppSelect
          v-model="form.apu_type"
          class="mt-1"
          :options="[
            { value: '', label: 'Unknown' },
            ...APU_TYPES.map((t) => ({ value: t, label: APU_TYPE_LABELS[t] })),
          ]"
        />
        <p class="mt-1 text-xs text-gray-400">
          Lets the truck keep the cab comfortable with the engine off. Drives the 'avoidable idle'
          flag.
        </p>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="block text-sm font-medium text-gray-900"
          >OEM optimized idle (e.g. Cascadia)</label
        >
        <AppSelect
          v-model="form.has_optimized_idle"
          class="mt-1"
          :options="[
            { value: '', label: 'Unknown' },
            { value: 'true', label: 'Yes' },
            { value: 'false', label: 'No' },
          ]"
        />
        <p class="mt-1 text-xs text-gray-400">
          The engine auto start/stops on its own; its idling is the feature working, not driver
          waste.
        </p>
      </div>
    </div>

    <div class="flex justify-end gap-3 pt-2">
      <button
        type="button"
        class="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50"
        @click="emit('cancel')"
      >
        Cancel
      </button>
      <button
        type="submit"
        :disabled="submitting"
        class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
      >
        {{ submitting ? "Saving…" : "Save vehicle" }}
      </button>
    </div>
  </form>
</template>
