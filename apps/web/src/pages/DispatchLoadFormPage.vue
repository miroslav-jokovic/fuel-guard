<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import {
  PlusIcon,
  TrashIcon,
} from "@fuelguard/ui/icons";
/**
 * Dispatch → New / edit load (Phase 3D, D49). The form that retires `seed_driver_load.sql`.
 *
 * The checklist panel is live while you type: it is the same `approvalChecklist()` the queue and the
 * `loads_status_guard` trigger use, so what this form tells you is missing is exactly what will
 * block approval. Nothing here can set a status — a new load is a draft, and it moves only through
 * the named transitions (D45).
 */
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { approvalChecklist, PHOTO_SLOTS, photoSlotLabel, type StopInput } from "@fuelguard/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseCheckbox from "@/components/ui/BaseCheckbox.vue";
import FormField from "@/components/ui/FormField.vue";
import AppSelect from "@/components/AppSelect.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import { useDriversQuery } from "@/composables/useDrivers";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useTrailersQuery } from "@/features/fleet/useTrailers";
import {
  useCreateLoad,
  useDispatchLoadsQuery,
  useUpdateLoad,
} from "@/composables/useDispatchLoads";

const route = useRoute();
const router = useRouter();
const toast = useToastStore();

const loadId = computed(() => (route.params.id === "new" ? undefined : (route.params.id as string | undefined)));
const isEdit = computed(() => Boolean(loadId.value));

const { data: loads } = useDispatchLoadsQuery();
const { data: drivers } = useDriversQuery();
const { data: vehicles } = useVehiclesQuery();
const { data: trailers } = useTrailersQuery();
const createLoad = useCreateLoad();
const updateLoad = useUpdateLoad();

const EQUIPMENT = ["Dry van", "Reefer", "Flatbed", "Bobtail"];

function blankStop(seq: number, kind: StopInput["kind"]): StopInput {
  return {
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
  };
}

const form = ref({
  ref: "",
  driver_id: "" as string,
  vehicle_id: "" as string,
  trailer_id: "" as string,
  equipment: "Dry van",
  commodity: "",
  hazmat: false,
  total_miles: "",
  notes: "",
});
const stops = ref<StopInput[]>([blankStop(1, "pickup"), blankStop(2, "dropoff")]);

// Hydrate once the queue arrives (the editor is reachable by deep link).
watch(
  () => [loads.value, loadId.value] as const,
  () => {
    const existing = loads.value?.find((l) => l.id === loadId.value);
    if (!existing) return;
    form.value = {
      ref: existing.ref,
      driver_id: existing.driver_id ?? "",
      vehicle_id: existing.vehicle_id ?? "",
      trailer_id: existing.trailer_id ?? "",
      equipment: existing.equipment ?? "Dry van",
      commodity: existing.commodity ?? "",
      hazmat: existing.hazmat,
      total_miles: existing.total_miles === null ? "" : String(existing.total_miles),
      notes: existing.notes ?? "",
    };
    stops.value = [...existing.stops]
      .sort((a, b) => a.seq - b.seq)
      .map((s) => ({
        id: s.id,
        seq: s.seq,
        kind: s.kind,
        name: s.name,
        address_line: s.address_line ?? "",
        city: s.city ?? "",
        state: s.state ?? "",
        postal_code: s.postal_code ?? "",
        appointment_start: s.appointment_start?.slice(0, 16) ?? "",
        appointment_end: s.appointment_end?.slice(0, 16) ?? "",
        required_photos: s.required_photos,
      }));
  },
  { immediate: true },
);

const driverOptions = computed(() => [
  { value: "", label: "Unassigned" },
  ...(drivers.value ?? []).map((d) => ({ value: d.id, label: d.full_name })),
]);
const vehicleOptions = computed(() => [
  { value: "", label: "No truck" },
  ...(vehicles.value ?? []).map((v) => ({ value: v.id, label: `Unit ${v.unit_number}` })),
]);
const trailerOptions = computed(() => [
  { value: "", label: "No trailer" },
  ...(trailers.value ?? []).map((t) => ({ value: t.id, label: `Trailer ${t.unit_number}` })),
]);

/** Live, and identical to what the trigger will enforce on approve. */
const checklist = computed(() =>
  approvalChecklist({
    driver_id: form.value.driver_id || null,
    vehicle_id: form.value.vehicle_id || null,
    trailer_id: form.value.trailer_id || null,
    equipment: form.value.equipment,
    commodity: form.value.commodity,
    hazmat: form.value.hazmat,
    stops: stops.value.map((s) => ({
      kind: s.kind,
      seq: s.seq,
      name: s.name,
      appointment_start: s.appointment_start || null,
      appointment_end: s.appointment_end || null,
      required_photos: s.required_photos,
    })),
  }),
);

function addStop() {
  stops.value.push(blankStop(stops.value.length + 1, "dropoff"));
}
function removeStop(index: number) {
  stops.value.splice(index, 1);
  stops.value.forEach((s, i) => (s.seq = i + 1));
}
function togglePhoto(stop: StopInput, slot: string) {
  const at = stop.required_photos.indexOf(slot);
  if (at >= 0) stop.required_photos.splice(at, 1);
  else stop.required_photos.push(slot);
}

const saving = computed(() => createLoad.isPending.value || updateLoad.isPending.value);
const canSave = computed(() => form.value.ref.trim().length > 0);

function payload() {
  const iso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : null);
  return {
    ref: form.value.ref.trim(),
    driver_id: form.value.driver_id || null,
    vehicle_id: form.value.vehicle_id || null,
    trailer_id: form.value.trailer_id || null,
    equipment: form.value.equipment || null,
    commodity: form.value.commodity || null,
    hazmat: form.value.hazmat,
    total_miles: form.value.total_miles ? Number(form.value.total_miles) : null,
    notes: form.value.notes || null,
    stops: stops.value.map((s) => ({
      ...(s.id ? { id: s.id } : {}),
      seq: s.seq,
      kind: s.kind,
      name: s.name.trim(),
      address_line: s.address_line || null,
      city: s.city || null,
      state: s.state || null,
      postal_code: s.postal_code || null,
      appointment_start: iso(s.appointment_start),
      appointment_end: iso(s.appointment_end),
      required_photos: s.required_photos,
    })),
  };
}

async function save() {
  try {
    if (isEdit.value && loadId.value) {
      await updateLoad.mutateAsync({ id: loadId.value, input: payload() });
      toast.success(`${form.value.ref} saved`);
    } else {
      const created = await createLoad.mutateAsync(payload());
      toast.success(`${form.value.ref} created as a draft`);
      await router.push(`/dispatch/loads/${created.id}`);
      return;
    }
    await router.push("/dispatch/loads");
  } catch (e) {
    toast.error("Could not save that load", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader
      :description="
        isEdit
          ? 'Edit this load. It stays a draft until you submit it for approval.'
          : 'New loads are created as drafts — they reach a driver only after approval and release.'
      "
    >
      <template #actions>
        <BaseButton to="/dispatch/loads">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="!canSave || saving" @click="save">
          {{ saving ? "Saving…" : isEdit ? "Save changes" : "Create draft" }}
        </BaseButton>
      </template>
    </PageHeader>

    <div class="grid gap-4 lg:grid-cols-3">
      <div class="flex flex-col gap-4 lg:col-span-2">
        <BaseCard>
          <h2 class="mb-4 text-sm font-semibold text-ink">Load</h2>
          <div class="grid gap-4 sm:grid-cols-2">
            <FormField label="Load number" required v-slot="{ id }">
              <BaseInput :id="id" v-model="form.ref" placeholder="LD-20481" />
            </FormField>
            <FormField label="Equipment" v-slot="{ id }">
              <AppSelect
                :id="id"
                v-model="form.equipment"
                :options="EQUIPMENT.map((e) => ({ value: e, label: e }))"
              />
            </FormField>
            <FormField label="Driver" v-slot="{ id }">
              <AppSelect :id="id" v-model="form.driver_id" :options="driverOptions" />
            </FormField>
            <FormField label="Truck" v-slot="{ id }">
              <AppSelect :id="id" v-model="form.vehicle_id" :options="vehicleOptions" />
            </FormField>
            <FormField
              label="Trailer"
              hint="The driver confirms the actual trailer in the app"
              v-slot="{ id }"
            >
              <AppSelect :id="id" v-model="form.trailer_id" :options="trailerOptions" />
            </FormField>
            <FormField label="Total miles" v-slot="{ id }">
              <BaseInput :id="id" v-model="form.total_miles" type="number" inputmode="decimal" min="0" />
            </FormField>
            <FormField label="Commodity" v-slot="{ id }">
              <BaseInput :id="id" v-model="form.commodity" placeholder="General freight" />
            </FormField>
            <div class="flex items-end">
              <BaseCheckbox v-model="form.hazmat">Hazmat placarded</BaseCheckbox>
            </div>
          </div>
          <FormField class="mt-4" label="Notes for the driver" v-slot="{ id }">
            <BaseInput :id="id" v-model="form.notes" placeholder="Gate code, dock hours…" />
          </FormField>
        </BaseCard>

        <BaseCard>
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-sm font-semibold text-ink">Stops</h2>
            <BaseButton size="sm" @click="addStop">
              <AppIcon :icon="PlusIcon" class="-ml-0.5 size-4" aria-hidden="true" />
              Add stop
            </BaseButton>
          </div>

          <div class="flex flex-col gap-4">
            <div
              v-for="(stop, i) in stops"
              :key="i"
              class="rounded-md p-4 ring-1 ring-inset ring-edge"
            >
              <div class="mb-3 flex items-center gap-2">
                <span class="text-sm font-semibold tabular-nums text-ink">{{ stop.seq }}</span>
                <AppSelect
                  v-model="stop.kind"
                  class="w-36"
                  :options="[
                    { value: 'pickup', label: 'Pick up' },
                    { value: 'dropoff', label: 'Deliver' },
                  ]"
                />
                <div class="flex-1" />
                <button
                  type="button"
                  class="rounded-md p-1.5 text-ink-muted hover:bg-surface-subtle hover:text-danger-600"
                  :aria-label="`Remove stop ${stop.seq}`"
                  @click="removeStop(i)"
                >
                  <AppIcon :icon="TrashIcon" class="size-4" aria-hidden="true" />
                </button>
              </div>

              <div class="grid gap-3 sm:grid-cols-2">
                <FormField label="Facility" required v-slot="{ id }">
                  <BaseInput :id="id" v-model="stop.name" placeholder="Acme Foods" />
                </FormField>
                <FormField label="Address" v-slot="{ id }">
                  <BaseInput :id="id" v-model="stop.address_line" />
                </FormField>
                <FormField label="City" v-slot="{ id }">
                  <BaseInput :id="id" v-model="stop.city" />
                </FormField>
                <FormField label="State" v-slot="{ id }">
                  <BaseInput :id="id" v-model="stop.state" />
                </FormField>
                <FormField label="Appointment from" required v-slot="{ id }">
                  <BaseInput :id="id" v-model="stop.appointment_start" type="datetime-local" />
                </FormField>
                <FormField label="Appointment to" required v-slot="{ id }">
                  <BaseInput :id="id" v-model="stop.appointment_end" type="datetime-local" />
                </FormField>
              </div>

              <div class="mt-3">
                <p class="mb-1.5 text-xs font-medium text-ink-secondary">Photos the driver must take</p>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="slot in PHOTO_SLOTS"
                    :key="slot"
                    type="button"
                    class="rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset"
                    :class="
                      stop.required_photos.includes(slot)
                        ? 'bg-brand-50 text-brand-700 ring-brand-200'
                        : 'bg-surface text-ink-muted ring-edge-strong hover:bg-surface-subtle'
                    "
                    :aria-pressed="stop.required_photos.includes(slot)"
                    @click="togglePhoto(stop, slot)"
                  >
                    {{ photoSlotLabel(slot) }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </BaseCard>
      </div>

      <!-- The gate, live. Same function the queue and the trigger use. -->
      <BaseCard class="h-fit">
        <h2 class="mb-1 text-sm font-semibold text-ink">Ready to approve?</h2>
        <p class="mb-4 text-xs text-ink-muted">
          Approval is blocked until every required item passes.
        </p>
        <ul class="flex flex-col gap-2.5">
          <li v-for="check in checklist.checks" :key="check.id" class="flex items-start gap-2">
            <span
              class="mt-0.5 size-2 shrink-0 rounded-full"
              :class="
                check.passed ? 'bg-success-500' : check.required ? 'bg-danger-500' : 'bg-caution-500'
              "
              aria-hidden="true"
            />
            <div class="min-w-0">
              <p class="text-sm" :class="check.passed ? 'text-ink-secondary' : 'text-ink'">
                {{ check.label }}
                <span v-if="!check.required" class="text-xs text-ink-muted">(optional)</span>
              </p>
              <p v-if="check.detail" class="text-xs text-ink-muted">{{ check.detail }}</p>
            </div>
          </li>
        </ul>
        <p class="mt-4">
          <span :class="[BADGE_BASE, toneClass(checklist.canApprove ? 'success' : 'danger')]">
            {{ checklist.canApprove ? "Ready to approve" : `${checklist.blockers.length} blocker(s)` }}
          </span>
        </p>
      </BaseCard>
    </div>
  </div>
</template>
