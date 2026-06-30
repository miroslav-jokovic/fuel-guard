<script setup lang="ts">
import { reactive, ref } from "vue";
import { driverInputSchema, DRIVER_STATUSES, type Driver, type DriverInput } from "@fleetguard/shared";
import AppSelect from "@/components/AppSelect.vue";

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

const inputCls =
  "mt-1 block w-full rounded-md border-0 px-3 py-1.5 text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-600 sm:text-sm";
</script>

<template>
  <form class="space-y-4" @submit.prevent="onSubmit">
    <div>
      <label class="block text-sm font-medium text-gray-900">Full name</label>
      <input v-model="form.full_name" :class="inputCls" />
      <p v-if="errors.full_name" class="mt-1 text-xs text-red-600">{{ errors.full_name }}</p>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="block text-sm font-medium text-gray-900">Employee ID</label>
        <input v-model="form.employee_id" :class="inputCls" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-900">Phone</label>
        <input v-model="form.phone" :class="inputCls" />
      </div>
    </div>
    <div>
      <label class="block text-sm font-medium text-gray-900">Status</label>
      <AppSelect
        v-model="form.status"
        class="mt-1"
        :options="DRIVER_STATUSES.map((s) => ({ value: s, label: s }))"
      />
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
        {{ submitting ? "Saving…" : "Save driver" }}
      </button>
    </div>
  </form>
</template>
