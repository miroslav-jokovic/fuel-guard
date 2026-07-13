<script setup lang="ts">
import { reactive, ref } from "vue";
import { trailerInputSchema, VEHICLE_STATUSES, type Trailer, type TrailerInput, type Vehicle } from "@fuelguard/shared";
import AppSelect from "@/components/AppSelect.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCheckbox from "@/components/ui/BaseCheckbox.vue";
import FormField from "@/components/ui/FormField.vue";

const props = defineProps<{ trailer?: Trailer | null; vehicles: Vehicle[]; submitting?: boolean }>();
const emit = defineEmits<{ submit: [input: TrailerInput]; cancel: [] }>();

const form = reactive({
  unit_number: props.trailer?.unit_number ?? "",
  make: props.trailer?.make ?? "",
  model: props.trailer?.model ?? "",
  year: props.trailer?.year?.toString() ?? "",
  plate: props.trailer?.plate ?? "",
  is_reefer: props.trailer?.is_reefer ?? false,
  reefer_tank_capacity_gal: props.trailer?.reefer_tank_capacity_gal?.toString() ?? "50",
  status: props.trailer?.status ?? "active",
  assigned_vehicle_id: props.trailer?.assigned_vehicle_id ?? "",
  samsara_asset_id: props.trailer?.samsara_asset_id ?? "",
});

const errors = ref<Record<string, string>>({});
function onSubmit() {
  const result = trailerInputSchema.safeParse({ ...form });
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

    <div class="rounded-md bg-info-50 px-3 py-2.5 ring-1 ring-info-100">
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
