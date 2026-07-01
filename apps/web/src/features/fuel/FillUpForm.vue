<script setup lang="ts">
import { reactive, ref, computed } from "vue";
import {
  fillUpInputSchema,
  computeFillUpWarnings,
  derivePricePerGal,
  type Vehicle,
  type FillUpInput,
} from "@fuelguard/shared";
import { genUuid } from "@/lib/uuid";
import AppSelect from "@/components/AppSelect.vue";

const props = defineProps<{
  vehicles: Vehicle[];
  defaultVehicleId?: string | null;
  submitting?: boolean;
}>();
const emit = defineEmits<{ submit: [payload: { input: FillUpInput; file: File | null }]; cancel: [] }>();

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const id = genUuid();
const form = reactive({
  vehicle_id: props.defaultVehicleId ?? props.vehicles[0]?.id ?? "",
  fueled_at_local: nowLocal(),
  odometer: "",
  gallons: "",
  total_cost: "",
  location_text: "",
});
const file = ref<File | null>(null);
const errors = ref<Record<string, string>>({});

const selectedVehicle = computed<Vehicle | undefined>(() =>
  props.vehicles.find((v) => v.id === form.vehicle_id),
);

const warnings = computed(() =>
  computeFillUpWarnings({
    gallons: Number(form.gallons) || 0,
    odometer: form.odometer === "" ? undefined : Number(form.odometer),
    tankCapacityGal: selectedVehicle.value?.tank_capacity_gal ?? 0,
    lastOdometer: selectedVehicle.value?.current_odometer ?? null,
    fuelType: selectedVehicle.value?.fuel_type ?? "diesel",
  }),
);

const pricePreview = computed(() => {
  const g = Number(form.gallons);
  const t = form.total_cost === "" ? null : Number(form.total_cost);
  return derivePricePerGal(g, t);
});

function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
}

function onSubmit() {
  const raw = {
    id,
    vehicle_id: form.vehicle_id,
    driver_id: selectedVehicle.value?.assigned_driver_id ?? undefined,
    fueled_at: form.fueled_at_local ? new Date(form.fueled_at_local).toISOString() : "",
    odometer: form.odometer,
    gallons: form.gallons,
    total_cost: form.total_cost,
    location_text: form.location_text,
  };
  const result = fillUpInputSchema.safeParse(raw);
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

  // Over-capacity is a critical theft signal — make the user confirm intentionally (audit M10).
  if (
    warnings.value.exceedsCapacity &&
    !window.confirm(
      "Gallons exceed this vehicle's tank capacity. This fill-up will be flagged for review. Submit anyway?",
    )
  ) {
    return;
  }

  emit("submit", { input: result.data, file: file.value });
}

const inputCls =
  "mt-1 block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-600";
</script>

<template>
  <form class="space-y-5" @submit.prevent="onSubmit">
    <div>
      <label class="block text-sm font-medium text-gray-900">Vehicle</label>
      <AppSelect
        v-model="form.vehicle_id"
        class="mt-1"
        :options="vehicles.map((v) => ({ value: v.id, label: `${v.unit_number} — ${[v.make, v.model].filter(Boolean).join(' ')}` }))"
      />
      <p v-if="errors.vehicle_id" class="mt-1 text-xs text-red-600">{{ errors.vehicle_id }}</p>
    </div>

    <div>
      <label class="block text-sm font-medium text-gray-900">Date &amp; time</label>
      <input v-model="form.fueled_at_local" type="datetime-local" :class="inputCls" />
    </div>

    <div>
      <label class="block text-sm font-medium text-gray-900">Odometer</label>
      <input v-model="form.odometer" inputmode="decimal" placeholder="Miles" :class="inputCls" />
      <p v-if="warnings.odometerBelowLast" class="mt-1 text-xs text-red-600">
        This is below the last recorded reading
        ({{ selectedVehicle?.current_odometer }}).
      </p>
      <p v-else-if="warnings.odometerMissing" class="mt-1 text-xs text-amber-600">
        Add the odometer so we can track MPG.
      </p>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="block text-sm font-medium text-gray-900">Gallons</label>
        <input v-model="form.gallons" inputmode="decimal" :class="inputCls" />
        <p v-if="errors.gallons" class="mt-1 text-xs text-red-600">{{ errors.gallons }}</p>
        <p v-if="warnings.exceedsCapacity" class="mt-1 text-xs text-red-600">
          Exceeds tank capacity ({{ selectedVehicle?.tank_capacity_gal }} gal).
        </p>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-900">Total cost ($)</label>
        <input v-model="form.total_cost" inputmode="decimal" :class="inputCls" />
        <p v-if="pricePreview" class="mt-1 text-xs text-gray-500">≈ ${{ pricePreview }}/gal</p>
      </div>
    </div>

    <div>
      <label class="block text-sm font-medium text-gray-900">Location</label>
      <input v-model="form.location_text" placeholder="Station / city" :class="inputCls" />
    </div>

    <div>
      <label class="block text-sm font-medium text-gray-900">Receipt photo (optional)</label>
      <input type="file" accept="image/*" capture="environment" class="mt-1 block w-full text-sm" @change="onFile" />
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
        class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
      >
        {{ submitting ? "Saving…" : "Log fill-up" }}
      </button>
    </div>
  </form>
</template>
