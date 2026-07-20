<script setup lang="ts">
import { reactive, ref, computed } from "vue";
import {
  fillUpInputSchema,
  computeFillUpWarnings,
  derivePricePerGal,
  PAYMENT_METHODS,
  type Vehicle,
  type FillUpInput,
} from "@fuelguard/shared";
import { genUuid } from "@/lib/uuid";
import AppSelect from "@/components/AppSelect.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import FormField from "@/components/ui/FormField.vue";

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
  payment_method: "",
});
// Tender options for a manual fill (a leading blank = "not specified"); EFS-card fills never reach this form.
const paymentOptions = [{ value: "", label: "Not specified" }, ...PAYMENT_METHODS.map((p) => ({ value: p.value, label: p.label }))];
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
    payment_method: form.payment_method,
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
</script>

<template>
  <form class="space-y-5" @submit.prevent="onSubmit">
    <FormField label="Vehicle" :error="errors.vehicle_id">
      <AppSelect
        v-model="form.vehicle_id"
        :options="vehicles.map((v) => ({ value: v.id, label: `${v.unit_number} — ${[v.make, v.model].filter(Boolean).join(' ')}` }))"
      />
    </FormField>

    <FormField v-slot="{ id: fieldId }" label="Date &amp; time">
      <BaseInput :id="fieldId" v-model="form.fueled_at_local" type="datetime-local" />
    </FormField>

    <FormField v-slot="{ id: fieldId }" label="Odometer">
      <BaseInput :id="fieldId" v-model="form.odometer" inputmode="decimal" placeholder="Miles" />
      <p v-if="warnings.odometerBelowLast" class="mt-1 text-xs text-danger-600">
        This is below the last recorded reading
        ({{ selectedVehicle?.current_odometer }}).
      </p>
      <p v-else-if="warnings.odometerMissing" class="mt-1 text-xs text-warning-600">
        Add the odometer so we can track MPG.
      </p>
    </FormField>

    <div class="grid grid-cols-2 gap-3">
      <FormField v-slot="{ id: fieldId }" label="Gallons" :error="errors.gallons">
        <BaseInput :id="fieldId" v-model="form.gallons" inputmode="decimal" :invalid="!!errors.gallons" />
        <p v-if="warnings.exceedsCapacity" class="mt-1 text-xs text-danger-600">
          Exceeds tank capacity ({{ selectedVehicle?.tank_capacity_gal }} gal).
        </p>
      </FormField>
      <FormField v-slot="{ id: fieldId }" label="Total cost ($)">
        <BaseInput :id="fieldId" v-model="form.total_cost" inputmode="decimal" />
        <p v-if="pricePreview" class="mt-1 text-xs text-ink-muted">≈ ${{ pricePreview }}/gal</p>
      </FormField>
    </div>

    <FormField v-slot="{ id: fieldId }" label="Location">
      <BaseInput :id="fieldId" v-model="form.location_text" placeholder="Station / city" />
    </FormField>

    <FormField label="Payment method">
      <AppSelect v-model="form.payment_method" :options="paymentOptions" />
      <p class="mt-1 text-xs text-ink-muted">How this fill was paid when it wasn't on an EFS card (cash, check, personal/fleet card…).</p>
    </FormField>

    <FormField v-slot="{ id: fieldId }" label="Receipt photo (optional)">
      <input :id="fieldId" type="file" accept="image/*" capture="environment" class="block w-full text-sm" @change="onFile" />
    </FormField>

    <div class="flex justify-end gap-3 pt-2">
      <BaseButton @click="emit('cancel')">Cancel</BaseButton>
      <BaseButton type="submit" variant="primary" :disabled="submitting">
        {{ submitting ? "Saving…" : "Log fill-up" }}
      </BaseButton>
    </div>
  </form>
</template>
