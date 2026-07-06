<script setup lang="ts">
import { reactive, ref } from "vue";
import { trailerInputSchema, VEHICLE_STATUSES, type Trailer, type TrailerInput, type Vehicle } from "@fuelguard/shared";
import AppSelect from "@/components/AppSelect.vue";

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

const inputCls =
  "mt-1 block w-full rounded-md border-0 px-3 py-1.5 text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-600 sm:text-sm";
</script>

<template>
  <form class="space-y-4" @submit.prevent="onSubmit">
    <div>
      <label class="block text-sm font-medium text-gray-900">Trailer unit number</label>
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

    <label class="flex items-start gap-2 rounded-md bg-cyan-50 px-3 py-2.5 ring-1 ring-cyan-100">
      <input v-model="form.is_reefer" type="checkbox" class="mt-0.5 size-4 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500" />
      <span class="text-sm">
        <span class="font-medium text-gray-900">This is a reefer (refrigerated) trailer</span>
        <span class="block text-xs text-gray-500">Only reefers are checked against reefer (ULSR) fuel purchases.</span>
      </span>
    </label>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="block text-sm font-medium text-gray-900">Reefer tank (gal)</label>
        <input v-model="form.reefer_tank_capacity_gal" inputmode="decimal" :class="inputCls" :disabled="!form.is_reefer" />
        <p v-if="errors.reefer_tank_capacity_gal" class="mt-1 text-xs text-red-600">{{ errors.reefer_tank_capacity_gal }}</p>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-900">Status</label>
        <AppSelect v-model="form.status" class="mt-1" :options="VEHICLE_STATUSES.map((s) => ({ value: s, label: s }))" />
      </div>
    </div>

    <div>
      <label class="block text-sm font-medium text-gray-900">Paired tractor (manual fallback)</label>
      <AppSelect
        v-model="form.assigned_vehicle_id"
        class="mt-1"
        :options="[{ value: '', label: '— Unpaired / from Samsara —' }, ...vehicles.map((v) => ({ value: v.id, label: v.unit_number }))]"
      />
    </div>

    <div>
      <label class="block text-sm font-medium text-gray-900">Samsara asset ID</label>
      <input v-model="form.samsara_asset_id" :class="inputCls" placeholder="Auto-filled by Samsara sync" />
    </div>

    <div class="flex justify-end gap-3 pt-2">
      <button type="button" class="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50" @click="emit('cancel')">Cancel</button>
      <button type="submit" :disabled="submitting" class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50">
        {{ submitting ? "Saving…" : "Save trailer" }}
      </button>
    </div>
  </form>
</template>
