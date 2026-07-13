<script setup lang="ts">
import { reactive, ref } from "vue";
import { driverInputSchema, DRIVER_STATUSES, type Driver, type DriverInput } from "@fuelguard/shared";
import AppSelect from "@/components/AppSelect.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import FormField from "@/components/ui/FormField.vue";

const props = defineProps<{
  driver?: Driver | null;
  submitting?: boolean;
}>();
const emit = defineEmits<{ submit: [input: DriverInput]; cancel: [] }>();

const form = reactive({
  full_name: props.driver?.full_name ?? "",
  employee_id: props.driver?.employee_id ?? "",
  phone: props.driver?.phone ?? "",
  status: props.driver?.status ?? "active",
  samsara_driver_id: props.driver?.samsara_driver_id ?? "",
});

const errors = ref<Record<string, string>>({});

function onSubmit() {
  const result = driverInputSchema.safeParse({ ...form });
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
    <FormField v-slot="{ id }" label="Full name" :error="errors.full_name">
      <BaseInput :id="id" v-model="form.full_name" :invalid="!!errors.full_name" />
    </FormField>
    <div class="grid grid-cols-2 gap-3">
      <FormField v-slot="{ id }" label="Employee ID">
        <BaseInput :id="id" v-model="form.employee_id" />
      </FormField>
      <FormField v-slot="{ id }" label="Phone">
        <BaseInput :id="id" v-model="form.phone" />
      </FormField>
    </div>
    <FormField label="Status">
      <AppSelect
        v-model="form.status"
        :options="DRIVER_STATUSES.map((s) => ({ value: s, label: s }))"
      />
    </FormField>

    <div class="flex justify-end gap-3 pt-2">
      <BaseButton @click="emit('cancel')">Cancel</BaseButton>
      <BaseButton type="submit" variant="primary" :disabled="submitting">
        {{ submitting ? "Saving…" : "Save driver" }}
      </BaseButton>
    </div>
  </form>
</template>
