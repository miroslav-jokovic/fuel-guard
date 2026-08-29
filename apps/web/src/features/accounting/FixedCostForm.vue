<script setup lang="ts">
import { reactive, ref } from "vue";
import { FIXED_COST_CATEGORIES, truckCostScheduleSchema, type TruckCostScheduleInput } from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppInput as BaseInput,
  AppSelect as BaseSelect,
  AppFormField as FormField,
} from "@silvicom/ui";
import { FIXED_COST_CATEGORY_LABELS } from "./fixedCostLabels";

/**
 * Adding one line to the office's fixed-cost schedule.
 *
 * It lives in a drawer rather than as a card that appears above the table, which is what the page
 * did before: the toggle button needed a second FilterBar of its own, and the form pushed the table
 * it was about off the screen while it was open.
 */
const props = defineProps<{ submitting: boolean }>();
const emit = defineEmits<{ submit: [value: TruckCostScheduleInput]; cancel: [] }>();

/** Charges are whole months, so a new row starts at the next month boundary rather than today. */
const firstOfNextMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);
};

const form = reactive({
  unit_number: "",
  category: "lease" as (typeof FIXED_COST_CATEGORIES)[number],
  label: "",
  monthly_amount: "",
  effective_from: firstOfNextMonth(),
  notes: "",
});
const formError = ref<string | null>(null);
const categoryOptions = FIXED_COST_CATEGORIES.map((c) => ({ value: c, label: FIXED_COST_CATEGORY_LABELS[c] }));

function submit() {
  formError.value = null;
  const parsed = truckCostScheduleSchema.safeParse({
    ...form,
    monthly_amount: Number(form.monthly_amount),
    notes: form.notes || null,
  });
  if (!parsed.success) {
    formError.value = parsed.error.issues[0]?.message ?? "Check the form";
    return;
  }
  emit("submit", parsed.data);
}

// No reset method: the page renders this with `v-if` on the drawer, so every open mounts a blank
// form. A long-lived form that quietly keeps the last truck's numbers is how a cost gets entered
// twice.
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <FormField v-slot="{ id }" label="Truck number">
      <BaseInput :id="id" v-model="form.unit_number" placeholder="754" />
    </FormField>
    <FormField v-slot="{ id }" label="Type of cost">
      <BaseSelect :id="id" v-model="form.category" :options="categoryOptions" />
    </FormField>
    <FormField v-slot="{ id }" label="Amount each month (USD)">
      <BaseInput :id="id" v-model="form.monthly_amount" type="number" step="0.01" min="0.01" placeholder="2500.00" />
    </FormField>
    <FormField v-slot="{ id }" label="What the contract says">
      <BaseInput :id="id" v-model="form.label" placeholder="VIP Lease — unit 754" />
    </FormField>
    <FormField
      v-slot="{ id }"
      label="Charging starts"
      hint="Whole months only — a cost charges from the first of the month you pick."
    >
      <BaseInput :id="id" v-model="form.effective_from" type="date" />
    </FormField>
    <p v-if="formError" class="text-sm text-danger-600">{{ formError }}</p>
    <div class="flex gap-2">
      <BaseButton type="submit" :disabled="props.submitting">Add cost</BaseButton>
      <BaseButton type="button" variant="ghost" @click="emit('cancel')">Cancel</BaseButton>
    </div>
  </form>
</template>
