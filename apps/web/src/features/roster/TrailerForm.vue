<script setup lang="ts">
import { reactive, ref } from "vue";
import {
  TRAILER_TYPE_LABELS,
  TRAILER_TYPES,
  trailerInputSchema,
  VEHICLE_STATUSES,
  type Trailer,
  type TrailerInput,
  type Vehicle,
} from "@silvicom/shared";
import { AppSelect } from "@silvicom/ui";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppCheckbox as BaseCheckbox } from "@silvicom/ui";
import { AppFormField as FormField } from "@silvicom/ui";

const props = defineProps<{ trailer?: Trailer | null; vehicles: Vehicle[]; submitting?: boolean }>();
const emit = defineEmits<{ submit: [input: TrailerInput]; cancel: [] }>();

const form = reactive({
  unit_number: props.trailer?.unit_number ?? "",
  make: props.trailer?.make ?? "",
  model: props.trailer?.model ?? "",
  year: props.trailer?.year?.toString() ?? "",
  plate: props.trailer?.plate ?? "",
  trailer_type: props.trailer?.trailer_type ?? "",
  // H-C2: cargo-tank data lives on the trailer (the Cargo-Tank Profiles page is gone). Compartments
  // edit as comma-separated gallons — "3000, 3200, 3000" — and are rebuilt as {index, capacityGal}.
  cargo_capacity_gal: props.trailer?.cargo_capacity_gal?.toString() ?? "",
  cargo_compartments_text: (props.trailer?.cargo_compartments ?? []).map((c) => String(c.capacityGal)).join(", "),
  is_reefer: props.trailer?.is_reefer ?? false,
  reefer_tank_capacity_gal: props.trailer?.reefer_tank_capacity_gal?.toString() ?? "50",
  status: props.trailer?.status ?? "active",
  assigned_vehicle_id: props.trailer?.assigned_vehicle_id ?? "",
  samsara_asset_id: props.trailer?.samsara_asset_id ?? "",
});

/** "3000, 3200" → [{index:1, capacityGal:3000}, …]; invalid/blank entries dropped, re-indexed 1..N. */
function parseCompartments(text: string): Array<{ index: number; capacityGal: number }> {
  const out: Array<{ index: number; capacityGal: number }> = [];
  for (const part of text.split(",")) {
    const n = Number(part.trim());
    if (part.trim() !== "" && Number.isFinite(n) && n >= 0) out.push({ index: out.length + 1, capacityGal: n });
  }
  return out;
}

const errors = ref<Record<string, string>>({});
function onSubmit() {
  const { cargo_compartments_text, ...rest } = form;
  const isTanker = form.trailer_type === "tanker";
  const result = trailerInputSchema.safeParse({
    ...rest,
    // Only a tanker carries cargo-tank data; switching the type away clears it rather than orphaning it.
    cargo_capacity_gal: isTanker ? form.cargo_capacity_gal : "",
    cargo_compartments: isTanker ? parseCompartments(cargo_compartments_text) : [],
  });
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
    <FormField v-slot="{ id }" label="Trailer unit number" :error="errors.unit_number">
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

    <FormField v-slot="{ id }" label="Type" hint="Marking a trailer as a tanker is what tells HazmatGuard this is bulk packaging.">
      <AppSelect
        :id="id"
        v-model="form.trailer_type"
        :options="[{ value: '', label: 'Not set' }, ...TRAILER_TYPES.map((t) => ({ value: t, label: TRAILER_TYPE_LABELS[t] }))]"
      />
    </FormField>

    <!-- H-C2: a tank is a trailer — its cargo data lives here, not on a separate hazmat page. -->
    <div v-if="form.trailer_type === 'tanker'" class="rounded-control bg-info-50 px-3 py-2.5 ring-1 ring-info-100">
      <p class="text-sm font-medium text-ink">Cargo tank</p>
      <p class="mt-0.5 text-xs text-ink-muted">Used by HazmatGuard load analysis. This is the CARGO tank, not a fuel tank.</p>
      <div class="mt-2 grid grid-cols-2 gap-3">
        <FormField v-slot="{ id }" label="Capacity (gal)" :error="errors.cargo_capacity_gal">
          <BaseInput :id="id" v-model="form.cargo_capacity_gal" inputmode="decimal" placeholder="9200" :invalid="!!errors.cargo_capacity_gal" />
        </FormField>
        <FormField v-slot="{ id }" label="Compartments (gal, comma-separated)" hint="Blank = single tank.">
          <BaseInput :id="id" v-model="form.cargo_compartments_text" placeholder="3000, 3200, 3000" />
        </FormField>
      </div>
    </div>

    <div class="rounded-control bg-info-50 px-3 py-2.5 ring-1 ring-info-100">
      <BaseCheckbox v-model="form.is_reefer">
        <span class="text-sm">
          <span class="font-medium text-ink">This is a reefer (refrigerated) trailer</span>
          <span class="block text-xs text-ink-muted">Only reefers are checked against reefer (ULSR) fuel purchases.</span>
        </span>
      </BaseCheckbox>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <FormField v-slot="{ id }" label="Reefer tank (gal)" :error="errors.reefer_tank_capacity_gal">
        <BaseInput
          :id="id"
          v-model="form.reefer_tank_capacity_gal"
          inputmode="decimal"
          :disabled="!form.is_reefer"
          :invalid="!!errors.reefer_tank_capacity_gal"
        />
      </FormField>
      <FormField label="Status">
        <AppSelect v-model="form.status" :options="VEHICLE_STATUSES.map((s) => ({ value: s, label: s }))" />
      </FormField>
    </div>

    <FormField label="Paired tractor (manual fallback)">
      <AppSelect
        v-model="form.assigned_vehicle_id"
        :options="[{ value: '', label: '— Unpaired / from Samsara —' }, ...vehicles.map((v) => ({ value: v.id, label: v.unit_number }))]"
      />
    </FormField>

    <FormField v-slot="{ id }" label="Samsara asset ID">
      <BaseInput :id="id" v-model="form.samsara_asset_id" placeholder="Auto-filled by Samsara sync" />
    </FormField>

    <div class="flex justify-end gap-3 pt-2">
      <BaseButton @click="emit('cancel')">Cancel</BaseButton>
      <BaseButton type="submit" variant="primary" :disabled="submitting">
        {{ submitting ? "Saving…" : "Save trailer" }}
      </BaseButton>
    </div>
  </form>
</template>
