<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import {
  PlusIcon,
  TrashIcon,
} from "@fuelguard/ui/icons";
import { reactive, ref, computed } from "vue";
import { PHOTO_SLOTS, PHOTO_SLOT_LABELS, STOP_KINDS } from "@fuelguard/shared";
import FormField from "@/components/ui/FormField.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCheckbox from "@/components/ui/BaseCheckbox.vue";
import ComboSelect from "@/components/ui/ComboSelect.vue";
import type { DispatchLoad } from "./useDispatchLoads";

/**
 * Create / edit a load — deliberately a thin *workspace*, not a TMS planner: who hauls it, in what,
 * and the stops with their photo checklist. Rating, routing and billing are out of scope by design.
 */

interface StopDraft {
  id?: string;
  kind: string; // bound to ComboSelect (string v-model); narrowed back to the enum on submit
  name: string;
  address_line: string;
  city: string;
  state: string;
  appointment_start: string;
  appointment_end: string;
  required_photos: string[];
}

export interface LoadFormPayload {
  ref: string;
  driver_id: string | null;
  vehicle_id: string | null;
  trailer_id: string | null;
  equipment: string | null;
  commodity: string | null;
  hazmat: boolean;
  total_miles: number | null;
  notes: string | null;
  stops: {
    id?: string;
    seq: number;
    kind: "pickup" | "dropoff";
    name: string;
    address_line: string | null;
    city: string | null;
    state: string | null;
    appointment_start: string | null;
    appointment_end: string | null;
    required_photos: string[];
  }[];
}

const props = defineProps<{
  load: DispatchLoad | null;
  drivers: { id: string; full_name: string }[];
  vehicles: { id: string; unit_number: string }[];
  trailers: { id: string; unit_number: string }[];
  saving: boolean;
}>();

const emit = defineEmits<{ submit: [payload: LoadFormPayload]; cancel: [] }>();

const blankStop = (kind: "pickup" | "dropoff"): StopDraft => ({
  kind,
  name: "",
  address_line: "",
  city: "",
  state: "",
  appointment_start: "",
  appointment_end: "",
  required_photos: kind === "pickup" ? ["bol", "seal"] : ["bol"],
});

const form = reactive({
  ref: props.load?.ref ?? "",
  driver_id: props.load?.driver_id ?? "",
  vehicle_id: props.load?.vehicle_id ?? "",
  trailer_id: props.load?.trailer_id ?? "",
  equipment: props.load?.equipment ?? "",
  commodity: props.load?.commodity ?? "",
  hazmat: props.load?.hazmat ?? false,
  total_miles: props.load?.total_miles != null ? String(props.load.total_miles) : "",
  notes: props.load?.notes ?? "",
});

const stops = ref<StopDraft[]>(
  (props.load?.stops ?? []).map((s) => ({
    id: s.id,
    kind: s.kind,
    name: s.name,
    address_line: s.address_line ?? "",
    city: s.city ?? "",
    state: s.state ?? "",
    appointment_start: s.appointment_start ?? "",
    appointment_end: s.appointment_end ?? "",
    required_photos: [...(s.required_photos ?? [])],
  })),
);
if (stops.value.length === 0) stops.value = [blankStop("pickup"), blankStop("dropoff")];

const driverOptions = computed(() => [
  { value: "", label: "— Unassigned —" },
  ...props.drivers.map((d) => ({ value: d.id, label: d.full_name })),
]);
const vehicleOptions = computed(() => [
  { value: "", label: "— None —" },
  ...props.vehicles.map((v) => ({ value: v.id, label: v.unit_number })),
]);
const trailerOptions = computed(() => [
  { value: "", label: "— None —" },
  ...props.trailers.map((t) => ({ value: t.id, label: t.unit_number })),
]);

const kindOptions = STOP_KINDS.map((k) => ({ value: k, label: k === "pickup" ? "Pickup" : "Drop-off" }));

const refError = ref("");

function addStop() {
  stops.value.push(blankStop("dropoff"));
}
function removeStop(i: number) {
  stops.value.splice(i, 1);
}
function togglePhoto(stop: StopDraft, slot: string) {
  const at = stop.required_photos.indexOf(slot);
  if (at >= 0) stop.required_photos.splice(at, 1);
  else stop.required_photos.push(slot);
}

function onSubmit() {
  refError.value = form.ref.trim() ? "" : "A load / reference number is required.";
  if (refError.value) return;
  emit("submit", {
    ref: form.ref.trim(),
    driver_id: form.driver_id || null,
    vehicle_id: form.vehicle_id || null,
    trailer_id: form.trailer_id || null,
    equipment: form.equipment.trim() || null,
    commodity: form.commodity.trim() || null,
    hazmat: form.hazmat,
    total_miles: form.total_miles.trim() ? Number(form.total_miles) : null,
    notes: form.notes.trim() || null,
    stops: stops.value.map((s, i) => ({
      id: s.id,
      seq: i + 1,
      kind: s.kind === "dropoff" ? "dropoff" : "pickup",
      name: s.name.trim(),
      address_line: s.address_line.trim() || null,
      city: s.city.trim() || null,
      state: s.state.trim() || null,
      appointment_start: s.appointment_start || null,
      appointment_end: s.appointment_end || null,
      required_photos: s.required_photos,
    })),
  });
}
</script>

<template>
  <form class="flex h-full flex-col" @submit.prevent="onSubmit">
    <div class="flex-1 space-y-6 overflow-y-auto px-1">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Load / reference #" required :error="refError" v-slot="{ id }">
          <BaseInput :id="id" v-model="form.ref" placeholder="LD-20481" />
        </FormField>
        <FormField label="Total miles" v-slot="{ id }">
          <BaseInput :id="id" v-model="form.total_miles" type="number" placeholder="361" />
        </FormField>
        <FormField label="Driver" v-slot="{ id }">
          <ComboSelect :id="id" v-model="form.driver_id" :options="driverOptions" placeholder="Search drivers…" />
        </FormField>
        <FormField label="Truck" v-slot="{ id }">
          <ComboSelect :id="id" v-model="form.vehicle_id" :options="vehicleOptions" placeholder="Search trucks…" />
        </FormField>
        <FormField label="Trailer" v-slot="{ id }">
          <ComboSelect :id="id" v-model="form.trailer_id" :options="trailerOptions" placeholder="Search trailers…" />
        </FormField>
        <FormField label="Equipment" hint="e.g. Dry van, Reefer" v-slot="{ id }">
          <BaseInput :id="id" v-model="form.equipment" placeholder="Dry van" />
        </FormField>
        <FormField label="Commodity" v-slot="{ id }">
          <BaseInput :id="id" v-model="form.commodity" placeholder="General freight" />
        </FormField>
        <div class="flex items-end pb-2">
          <BaseCheckbox v-model="form.hazmat">This load is hazmat</BaseCheckbox>
        </div>
      </div>

      <FormField label="Notes for dispatch" v-slot="{ id }">
        <BaseInput :id="id" v-model="form.notes" placeholder="Anything the driver should know" />
      </FormField>

      <div>
        <div class="mb-2 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-ink">Stops</h3>
          <BaseButton type="button" variant="soft" size="sm" @click="addStop">
            <AppIcon :icon="PlusIcon" class="mr-1 h-4 w-4" /> Add stop
          </BaseButton>
        </div>

        <div
          v-for="(stop, i) in stops"
          :key="i"
          class="mb-3 rounded-lg border border-edge bg-surface-muted/40 p-3"
        >
          <div class="mb-2 flex items-center justify-between">
            <span class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Stop {{ i + 1 }}</span>
            <button
              type="button"
              class="text-ink-subtle hover:text-danger-600"
              :aria-label="`Remove stop ${i + 1}`"
              @click="removeStop(i)"
            >
              <AppIcon :icon="TrashIcon" class="h-4 w-4" />
            </button>
          </div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Kind" v-slot="{ id }">
              <ComboSelect :id="id" v-model="stop.kind" :options="kindOptions" />
            </FormField>
            <FormField label="Name" v-slot="{ id }">
              <BaseInput :id="id" v-model="stop.name" placeholder="Shipper / consignee" />
            </FormField>
            <FormField label="City" v-slot="{ id }">
              <BaseInput :id="id" v-model="stop.city" placeholder="Joliet" />
            </FormField>
            <FormField label="State" v-slot="{ id }">
              <BaseInput :id="id" v-model="stop.state" placeholder="IL" />
            </FormField>
            <FormField label="Appointment start" v-slot="{ id }">
              <BaseInput :id="id" v-model="stop.appointment_start" type="datetime-local" />
            </FormField>
            <FormField label="Appointment end" v-slot="{ id }">
              <BaseInput :id="id" v-model="stop.appointment_end" type="datetime-local" />
            </FormField>
          </div>
          <div class="mt-3">
            <p class="mb-1.5 text-xs font-medium text-ink-secondary">Required photos</p>
            <div class="flex flex-wrap gap-x-4 gap-y-1.5">
              <BaseCheckbox
                v-for="slot in PHOTO_SLOTS"
                :key="slot"
                :model-value="stop.required_photos.includes(slot)"
                @update:model-value="togglePhoto(stop, slot)"
              >
                {{ PHOTO_SLOT_LABELS[slot] ?? slot }}
              </BaseCheckbox>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-4 flex justify-end gap-2 border-t border-edge pt-4">
      <BaseButton type="button" variant="ghost" @click="emit('cancel')">Cancel</BaseButton>
      <BaseButton type="submit" variant="primary" :disabled="saving">
        {{ saving ? "Saving…" : props.load ? "Save load" : "Create load" }}
      </BaseButton>
    </div>
  </form>
</template>
