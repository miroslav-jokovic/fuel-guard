<script setup lang="ts">
import { reactive, computed, ref, watch } from "vue";
import { PlusIcon, XMarkIcon, MapIcon, MapPinIcon } from "@heroicons/vue/24/outline";
import { EQUIPMENT_TYPES } from "@fuelguard/shared";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useRouteFuelSettings } from "./useRouteFuelSettings";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseCheckbox from "@/components/ui/BaseCheckbox.vue";
import ComboSelect from "@/components/ui/ComboSelect.vue";
import AddressInput from "./AddressInput.vue";
import FormField from "@/components/ui/FormField.vue";
import { HAZMAT_OPTIONS, TUNNEL_OPTIONS, fetchVehicleLocation, type PlanRequest } from "./useFuelPlan";

const props = defineProps<{ loading?: boolean }>();
const emit = defineEmits<{ submit: [req: PlanRequest, labels: { origin: string; destination: string; waypoints: string[] }] }>();

const { data: vehicles } = useVehiclesQuery();
const { data: settings } = useRouteFuelSettings();
const trucks = computed(() => (vehicles.value ?? []).filter((v) => v.status !== "retired"));
const truckOptions = computed(() =>
  trucks.value.map((t) => ({ value: t.id, label: t.samsara_vehicle_id ? t.unit_number : `${t.unit_number} · no live data` })),
);
const equipmentOptions = EQUIPMENT_TYPES.map((e) => ({ value: e.value, label: e.label }));

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
    equipmentType: "",
    hazmatOn: false,
    hazmat: [] as string[],
    tunnelCategory: "",
    avoidTunnels: false,
  };
}
const form = reactive(blankForm());
// Restore the in-progress form across a page refresh (dispatchers lose nothing on reload).
try {
  const saved = localStorage.getItem(FORM_KEY);
  if (saved) Object.assign(form, JSON.parse(saved));
} catch { /* ignore corrupt storage */ }
// Defensive: older persisted forms stored hazmat as a single string — normalize to the array shape.
if (!Array.isArray(form.hazmat)) form.hazmat = [];
watch(form, () => { try { localStorage.setItem(FORM_KEY, JSON.stringify(form)); } catch { /* quota/private mode */ } }, { deep: true });

// Pre-fill equipment from the company default (per-plan override still wins) — only when the dispatcher
// hasn't already got one from a restored draft or a manual pick.
watch(settings, (s) => {
  if (s && !form.equipmentType) form.equipmentType = (s.default_equipment_type as string) || "dry_van";
}, { immediate: true });

/** Clear the form back to blank and drop the persisted copy (used by the page's "New plan" button). */
function reset() {
  Object.assign(form, blankForm());
  if (settings.value?.default_equipment_type) form.equipmentType = settings.value.default_equipment_type as string;
  locateError.value = "";
  try { localStorage.removeItem(FORM_KEY); } catch { /* ignore */ }
}
defineExpose({ reset });

const canSubmit = computed(() => form.vehicleId && form.origin.trim() && form.destination.trim() && !props.loading);

function toggleHazmat(value: string, on: boolean) {
  const set = new Set(form.hazmat);
  if (on) set.add(value); else set.delete(value);
  form.hazmat = [...set];
}

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

function addWaypoint() { form.waypoints.push(""); }
function removeWaypoint(i: number) { form.waypoints.splice(i, 1); }
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
      equipmentType: form.equipmentType || null,
      hazmat: form.hazmatOn ? [...form.hazmat] : [],
      tunnelCategory: form.hazmatOn ? (form.tunnelCategory || null) : null,
      avoidTunnels: form.avoidTunnels,
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
      <FormField v-slot="{ id }" label="Equipment / trailer" hint="Defaults to your company's usual load; change it per trip.">
        <ComboSelect :id="id" v-model="form.equipmentType" :options="equipmentOptions" placeholder="Select equipment…" />
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

    <!-- Placarded hazmat is opt-in: most loads (dry van, reefer, container) are not hazmat, so it never
         alters the route unless the dispatcher marks the load as placarded. -->
    <div class="mt-4 rounded-md border border-edge bg-surface-subtle p-3">
      <BaseCheckbox v-model="form.hazmatOn">This is a placarded hazmat load</BaseCheckbox>
      <div v-if="form.hazmatOn" class="mt-3 space-y-3">
        <div>
          <p class="text-xs font-medium text-ink-secondary">Placard class(es) — select every class shown on the load</p>
          <div class="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <BaseCheckbox
              v-for="opt in HAZMAT_OPTIONS"
              :key="opt.value"
              :model-value="form.hazmat.includes(opt.value)"
              @update:model-value="(v: boolean) => toggleHazmat(opt.value, v)"
            >
              {{ opt.label }}
            </BaseCheckbox>
          </div>
        </div>
        <FormField v-slot="{ id }" label="Tunnel restriction" hint="European (ADR) tunnels only — US routes don't use these codes, so leave it blank.">
          <ComboSelect :id="id" v-model="form.tunnelCategory" :options="TUNNEL_OPTIONS" placeholder="None / US route" />
        </FormField>
      </div>
    </div>

    <!-- Avoid all tunnels: independent of hazmat class/ADR category. Hazmat is barred from ~all tunnels, so a
         dispatcher can force a tunnel-free route for any load that shouldn't run them. -->
    <div class="mt-4 rounded-md border border-edge bg-surface-subtle p-3">
      <BaseCheckbox v-model="form.avoidTunnels">Avoid all tunnels</BaseCheckbox>
      <p class="mt-1 pl-6 text-xs text-ink-muted">Routes around every tunnel — recommended for hazmat and oversized loads. May add miles.</p>
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
