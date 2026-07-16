<script setup lang="ts">
import { reactive, computed, ref, watch } from "vue";
import { PlusIcon, XMarkIcon, MapIcon, MapPinIcon } from "@heroicons/vue/24/outline";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import ComboSelect from "@/components/ui/ComboSelect.vue";
import AddressInput from "./AddressInput.vue";
import FormField from "@/components/ui/FormField.vue";
import { HAZMAT_OPTIONS, TUNNEL_OPTIONS, fetchVehicleLocation, type PlanRequest } from "./useFuelPlan";

const props = defineProps<{ loading?: boolean }>();
const emit = defineEmits<{ submit: [req: PlanRequest, labels: { origin: string; destination: string; waypoints: string[] }] }>();

const { data: vehicles } = useVehiclesQuery();
const trucks = computed(() => (vehicles.value ?? []).filter((v) => v.status !== "retired"));
const truckOptions = computed(() =>
  trucks.value.map((t) => ({ value: t.id, label: t.samsara_vehicle_id ? t.unit_number : `${t.unit_number} · no live data` })),
);

const FORM_KEY = "fuelguard:fuelplan:form";
function blankForm() {
  return {
    vehicleId: "",
    origin: "",
    destination: "",
    originCoords: null as { lat: number; lng: number } | null,
    destinationCoords: null as { lat: number; lng: number } | null,
    waypoints: [] as string[],
    loadGrossLb: "",
    hazmat: "",
    tunnelCategory: "",
  };
}
const form = reactive(blankForm());
// Restore the in-progress form across a page refresh (dispatchers lose nothing on reload).
try {
  const saved = localStorage.getItem(FORM_KEY);
  if (saved) Object.assign(form, JSON.parse(saved));
} catch { /* ignore corrupt storage */ }
watch(form, () => { try { localStorage.setItem(FORM_KEY, JSON.stringify(form)); } catch { /* quota/private mode */ } }, { deep: true });

/** Clear the form back to blank and drop the persisted copy (used by the page's "New plan" button). */
function reset() {
  Object.assign(form, blankForm());
  locateError.value = "";
  try { localStorage.removeItem(FORM_KEY); } catch { /* ignore */ }
}
defineExpose({ reset });

const canSubmit = computed(() => form.vehicleId && form.origin.trim() && form.destination.trim() && !props.loading);

const locating = ref(false);
const locateError = ref("");
async function useTruckLocation() {
  if (!form.vehicleId || locating.value) return;
  locating.value = true;
  locateError.value = "";
  try {
    const loc = await fetchVehicleLocation(form.vehicleId);
    if (!loc) { locateError.value = "No current location for this truck."; return; }
    form.origin = loc.label ?? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
    form.originCoords = { lat: loc.lat, lng: loc.lng };
  } catch {
    locateError.value = "Could not read the truck location.";
  } finally {
    locating.value = false;
  }
}

function addWaypoint() {
  form.waypoints.push("");
}
function removeWaypoint(i: number) {
  form.waypoints.splice(i, 1);
}
function submit() {
  if (!canSubmit.value) return;
  emit(
    "submit",
    {
    vehicleId: form.vehicleId,
    origin: form.originCoords ? { lat: form.originCoords.lat, lng: form.originCoords.lng } : { text: form.origin.trim() },
    destination: form.destinationCoords ? { lat: form.destinationCoords.lat, lng: form.destinationCoords.lng } : { text: form.destination.trim() },
    waypoints: form.waypoints.map((w) => w.trim()).filter(Boolean).map((text) => ({ text })),
    loadGrossLb: form.loadGrossLb ? Number(form.loadGrossLb) : null,
    hazmat: form.hazmat ? [form.hazmat] : [],
    tunnelCategory: form.tunnelCategory || null,
    },
    {
      origin: form.origin.trim(),
      destination: form.destination.trim(),
      waypoints: form.waypoints.map((w) => w.trim()).filter(Boolean),
    },
  );
}
</script>

<template>
  <BaseCard as="form" @submit.prevent="submit">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField v-slot="{ id }" label="Truck">
        <ComboSelect :id="id" v-model="form.vehicleId" :options="truckOptions" placeholder="Search trucks…" />
      </FormField>
      <FormField v-slot="{ id }" label="Hazmat class" hint="Per load — changes the legal truck route.">
        <ComboSelect :id="id" v-model="form.hazmat" :options="HAZMAT_OPTIONS" placeholder="None" />
      </FormField>
      <FormField v-if="form.hazmat" v-slot="{ id }" label="Tunnel category" hint="ADR restriction for the placarded load.">
        <ComboSelect :id="id" v-model="form.tunnelCategory" :options="TUNNEL_OPTIONS" placeholder="Not restricted" />
      </FormField>
      <FormField v-slot="{ id }" label="Start">
        <AddressInput
:id="id" :model-value="form.origin" placeholder="City, ST or address"
          @update:model-value="(v: string) => { form.origin = v; form.originCoords = null; }"
          @select="(sug) => { form.origin = sug.label; form.originCoords = { lat: sug.lat, lng: sug.lng }; }" />
        <button
          type="button"
          class="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!form.vehicleId || locating"
          @click="useTruckLocation"
        >
          <MapPinIcon class="size-3.5" aria-hidden="true" />
          {{ locating ? "Locating…" : "Use truck's current location" }}
        </button>
        <p v-if="locateError" class="mt-1 text-xs text-danger-600">{{ locateError }}</p>
      </FormField>
      <FormField v-slot="{ id }" label="Destination">
        <AddressInput
:id="id" :model-value="form.destination" placeholder="City, ST or address"
          @update:model-value="(v: string) => { form.destination = v; form.destinationCoords = null; }"
          @select="(sug) => { form.destination = sug.label; form.destinationCoords = { lat: sug.lat, lng: sug.lng }; }" />
      </FormField>
    </div>

    <div v-if="form.waypoints.length" class="mt-4 space-y-2">
      <FormField v-for="(_, i) in form.waypoints" :key="i" v-slot="{ id }" :label="`Stop ${i + 1}`">
        <div class="flex items-center gap-2">
          <BaseInput :id="id" v-model="form.waypoints[i]" placeholder="City, ST or address" />
          <BaseButton variant="ghost" size="sm" type="button" @click="removeWaypoint(i)"><XMarkIcon class="size-4" /></BaseButton>
        </div>
      </FormField>
    </div>

    <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
      <BaseButton variant="ghost" size="sm" type="button" @click="addWaypoint">
        <PlusIcon class="-ml-0.5 size-4" aria-hidden="true" /> Add stop
      </BaseButton>
      <div class="flex items-center gap-3">
        <FormField v-slot="{ id }" label="" class="w-40">
          <BaseInput :id="id" v-model="form.loadGrossLb" inputmode="numeric" placeholder="Load lb (opt.)" />
        </FormField>
        <BaseButton variant="primary" type="submit" :disabled="!canSubmit">
          <MapIcon class="-ml-0.5 size-5" aria-hidden="true" />
          {{ loading ? "Planning…" : "Generate plan" }}
        </BaseButton>
      </div>
    </div>
  </BaseCard>
</template>
