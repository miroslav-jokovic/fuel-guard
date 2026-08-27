<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import {
  PlusIcon,
  TrashIcon,
} from "@silvicom/ui/icons";
/**
 * Dispatch → New / edit load (Phase 3D, D49). The form that retires `seed_driver_load.sql`.
 *
 * The checklist panel is live while you type: it is the same `approvalChecklist()` the queue and the
 * `loads_status_guard` trigger use, so what this form tells you is missing is exactly what will
 * block approval. Nothing here can set a status — a new load is a draft, and it moves only through
 * the named transitions (D45).
 */
import { computed, ref, watch } from "vue";
import {
  approvalChecklist,
  PHOTO_SLOTS,
  PHOTO_SLOT_LABELS,
  STOP_KINDS,
  type CreateLoadRequest,
  type StopInput,
} from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppCheckbox as BaseCheckbox } from "@silvicom/ui";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppDateTimeField } from "@silvicom/ui";
import { AppCombobox as ComboSelect } from "@silvicom/ui";
import { AppFormField as FormField } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import type { DispatchLoad } from "@/features/dispatch/useDispatchLoads";

interface StopDraft {
  id?: string;
  seq: number;
  kind: string;
  name: string;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
  appointment_start: string;
  appointment_end: string;
  required_photos: string[];
}

export type LoadFormPayload = CreateLoadRequest;

const props = defineProps<{
  load: DispatchLoad | null;
  drivers: { id: string; full_name: string }[];
  vehicles: { id: string; unit_number: string }[];
  trailers: { id: string; unit_number: string }[];
  saving: boolean;
}>();

const emit = defineEmits<{
  submit: [payload: LoadFormPayload];
  cancel: [];
}>();

const blankStop = (seq: number, kind: StopInput["kind"]): StopDraft => ({
  seq,
  kind,
  name: "",
  address_line: "",
  city: "",
  state: "",
  postal_code: "",
  appointment_start: "",
  appointment_end: "",
  required_photos: kind === "pickup" ? ["trailer", "bol"] : ["bol"],
});

const form = ref({
  ref: "",
  driver_id: "",
  vehicle_id: "",
  trailer_id: "",
  equipment: "Dry van",
  commodity: "",
  hazmat: false,
  total_miles: "",
  notes: "",
});
const stops = ref<StopDraft[]>([]);
const refError = ref("");
const stopErrors = ref<string[]>([]);

function reset(load: DispatchLoad | null) {
  form.value = {
    ref: load?.ref ?? "",
    driver_id: load?.driver_id ?? "",
    vehicle_id: load?.vehicle_id ?? "",
    trailer_id: load?.trailer_id ?? "",
    equipment: load?.equipment ?? "Dry van",
    commodity: load?.commodity ?? "",
    hazmat: load?.hazmat ?? false,
    total_miles: load?.total_miles == null ? "" : String(load.total_miles),
    notes: load?.notes ?? "",
  };
  stops.value = load?.stops?.length
    ? [...load.stops]
        .sort((a, b) => a.seq - b.seq)
        .map((stop, index) => ({
          id: stop.id,
          seq: index + 1,
          kind: stop.kind,
          name: stop.name,
          address_line: stop.address_line ?? "",
          city: stop.city ?? "",
          state: stop.state ?? "",
          postal_code: stop.postal_code ?? "",
          appointment_start: stop.appointment_start?.slice(0, 16) ?? "",
          appointment_end: stop.appointment_end?.slice(0, 16) ?? "",
          required_photos: [...(stop.required_photos ?? [])],
        }))
    : [blankStop(1, "pickup"), blankStop(2, "dropoff")];
  refError.value = "";
  stopErrors.value = [];
}

// Hydrate once the queue arrives (the editor is reachable by deep link).
watch(() => props.load, (load) => reset(load), { immediate: true });

const driverOptions = computed(() => [
  { value: "", label: "— Unassigned —" },
  ...props.drivers.map((driver) => ({ value: driver.id, label: driver.full_name })),
]);
const vehicleOptions = computed(() => [
  { value: "", label: "— None —" },
  ...props.vehicles.map((vehicle) => ({ value: vehicle.id, label: `Unit ${vehicle.unit_number}` })),
]);
const trailerOptions = computed(() => [
  { value: "", label: "— None —" },
  ...props.trailers.map((trailer) => ({ value: trailer.id, label: `Trailer ${trailer.unit_number}` })),
]);
const kindOptions = STOP_KINDS.map((kind) => ({ value: kind, label: kind === "pickup" ? "Pick up" : "Deliver" }));

/** Live, and identical to what the trigger will enforce on approve. */
const checklist = computed(() =>
  approvalChecklist({
    driver_id: form.value.driver_id || null,
    vehicle_id: form.value.vehicle_id || null,
    trailer_id: form.value.trailer_id || null,
    equipment: form.value.equipment || null,
    commodity: form.value.commodity || null,
    hazmat: form.value.hazmat,
    stops: stops.value.map((stop) => ({
      kind: stop.kind === "dropoff" ? "dropoff" : "pickup",
      seq: stop.seq,
      name: stop.name,
      appointment_start: stop.appointment_start || null,
      appointment_end: stop.appointment_end || null,
      required_photos: stop.required_photos,
    })),
  }),
);

function addStop() {
  stops.value.push(blankStop(stops.value.length + 1, "dropoff"));
}
function removeStop(index: number) {
  stops.value.splice(index, 1);
  stops.value.forEach((stop, i) => (stop.seq = i + 1));
  stopErrors.value.splice(index, 1);
}
function togglePhoto(stop: StopDraft, slot: string) {
  const at = stop.required_photos.indexOf(slot);
  if (at >= 0) stop.required_photos.splice(at, 1);
  else stop.required_photos.push(slot);
}

function validate(): boolean {
  refError.value = form.value.ref.trim() ? "" : "A load / reference number is required.";
  stopErrors.value = stops.value.map((stop) => {
    if (!stop.name.trim()) return "A facility name is required.";
    if (stop.appointment_start && stop.appointment_end && stop.appointment_end < stop.appointment_start) {
      return "Appointment end must be after the start.";
    }
    return "";
  });
  return !refError.value && stopErrors.value.every((error) => !error);
}

function payload(): LoadFormPayload {
  const iso = (value: string) => (value ? new Date(value).toISOString() : null);
  return {
    ref: form.value.ref.trim(),
    driver_id: form.value.driver_id || null,
    vehicle_id: form.value.vehicle_id || null,
    trailer_id: form.value.trailer_id || null,
    equipment: form.value.equipment.trim() || null,
    commodity: form.value.commodity.trim() || null,
    hazmat: form.value.hazmat,
    total_miles: form.value.total_miles.trim() ? Number(form.value.total_miles) : null,
    notes: form.value.notes.trim() || null,
    stops: stops.value.map((stop, index) => ({
      ...(stop.id ? { id: stop.id } : {}),
      seq: index + 1,
      kind: stop.kind === "dropoff" ? "dropoff" : "pickup",
      name: stop.name.trim(),
      address_line: stop.address_line.trim() || null,
      city: stop.city.trim() || null,
      state: stop.state.trim() || null,
      postal_code: stop.postal_code.trim() || null,
      appointment_start: iso(stop.appointment_start),
      appointment_end: iso(stop.appointment_end),
      required_photos: stop.required_photos,
    })),
  };
}

function onSubmit() {
  if (validate()) emit("submit", payload());
}
</script>

<template>
  <form class="flex h-full flex-col" @submit.prevent="onSubmit">
    <div class="flex-1 space-y-6 overflow-y-auto px-1">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="Load / reference #" required :error="refError">
          <BaseInput :id="id" v-model="form.ref" placeholder="LD-20481" />
        </FormField>
        <FormField v-slot="{ id }" label="Total miles">
          <BaseInput :id="id" v-model="form.total_miles" type="number" inputmode="decimal" min="0" placeholder="361" />
        </FormField>
        <FormField v-slot="{ id }" label="Driver">
          <ComboSelect :id="id" v-model="form.driver_id" :options="driverOptions" placeholder="Search drivers…" />
        </FormField>
        <FormField v-slot="{ id }" label="Truck">
          <ComboSelect :id="id" v-model="form.vehicle_id" :options="vehicleOptions" placeholder="Search trucks…" />
        </FormField>
        <FormField v-slot="{ id }" label="Trailer">
          <ComboSelect :id="id" v-model="form.trailer_id" :options="trailerOptions" placeholder="Search trailers…" />
        </FormField>
        <FormField v-slot="{ id }" label="Equipment" hint="e.g. Dry van, Reefer">
          <BaseInput :id="id" v-model="form.equipment" placeholder="Dry van" />
        </FormField>
        <FormField v-slot="{ id }" label="Commodity">
          <BaseInput :id="id" v-model="form.commodity" placeholder="General freight" />
        </FormField>
        <div class="flex items-end pb-2">
          <BaseCheckbox v-model="form.hazmat">This load is hazmat</BaseCheckbox>
        </div>
      </div>

      <FormField v-slot="{ id }" label="Notes for dispatch">
        <BaseInput :id="id" v-model="form.notes" placeholder="Anything the driver should know" />
      </FormField>

      <div>
        <div class="mb-2 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-ink">Stops</h3>
          <BaseButton type="button" variant="soft" size="sm" @click="addStop">
            <AppIcon :icon="PlusIcon" class="mr-1 size-4" aria-hidden="true" /> Add stop
          </BaseButton>
        </div>

        <div class="space-y-3">
          <div
            v-for="(stop, i) in stops"
            :key="stop.id ?? i"
            class="rounded-surface border border-edge bg-surface-muted/40 p-3"
          >
            <div class="mb-2 flex items-center justify-between">
              <span class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Stop {{ i + 1 }}</span>
              <BaseButton
                type="button"
                class="rounded-control p-1 text-ink-tertiary hover:bg-surface-subtle hover:text-danger-600"
                :aria-label="`Remove stop ${i + 1}`"
                @click="removeStop(i)"
              >
                <AppIcon :icon="TrashIcon" class="size-4" aria-hidden="true" />
              </BaseButton>
            </div>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField v-slot="{ id }" label="Stop type">
                <ComboSelect :id="id" v-model="stop.kind" :options="kindOptions" />
              </FormField>
              <FormField v-slot="{ id }" label="Facility" required :error="stopErrors[i]">
                <BaseInput :id="id" v-model="stop.name" placeholder="Shipper / consignee" />
              </FormField>
              <FormField v-slot="{ id }" label="Address">
                <BaseInput :id="id" v-model="stop.address_line" placeholder="Street address" />
              </FormField>
              <FormField v-slot="{ id }" label="City">
                <BaseInput :id="id" v-model="stop.city" placeholder="Joliet" />
              </FormField>
              <FormField v-slot="{ id }" label="State">
                <BaseInput :id="id" v-model="stop.state" placeholder="IL" />
              </FormField>
              <FormField v-slot="{ id }" label="Postal code">
                <BaseInput :id="id" v-model="stop.postal_code" placeholder="60431" />
              </FormField>
              <FormField v-slot="{ id }" label="Appointment start">
                <AppDateTimeField :id="id" v-model="stop.appointment_start" />
              </FormField>
              <FormField v-slot="{ id }" label="Appointment end">
                <AppDateTimeField :id="id" v-model="stop.appointment_end" />
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

      <!-- The gate, live. Same function the queue and the trigger use. -->
      <div class="rounded-surface border border-edge bg-surface-subtle p-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-ink">Approval readiness</h3>
            <p class="mt-0.5 text-xs text-ink-muted">Drafts can be saved before every requirement is complete.</p>
          </div>
          <span :class="[BADGE_BASE, toneClass(checklist.canApprove ? 'success' : 'danger')]">
            {{ checklist.canApprove ? "Ready" : `${checklist.blockers.length} blocker(s)` }}
          </span>
        </div>
        <ul class="mt-3 space-y-1.5 text-sm">
          <li v-for="check in checklist.checks" :key="check.id" class="flex items-start gap-2">
            <span
              class="mt-1 size-2 shrink-0 rounded-full"
              :class="check.passed ? 'bg-success-500' : check.required ? 'bg-danger-500' : 'bg-caution-500'"
              aria-hidden="true"
            />
            <span :class="check.passed ? 'text-ink-muted' : 'text-ink'">
              {{ check.label }}<span v-if="check.detail && !check.passed" class="text-ink-muted"> — {{ check.detail }}</span>
            </span>
          </li>
        </ul>
      </div>
    </div>

    <div class="mt-4 flex justify-end gap-2 border-t border-edge pt-4">
      <BaseButton type="button" variant="ghost" @click="emit('cancel')">Cancel</BaseButton>
      <BaseButton type="submit" variant="primary" :disabled="saving">
        {{ saving ? "Saving…" : load ? "Save load" : "Create load" }}
      </BaseButton>
    </div>
  </form>
</template>
