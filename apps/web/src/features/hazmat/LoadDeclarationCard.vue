<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  canEditLoad,
  type HazmatLoadRow,
  type HazmatLoadStatus,
  type HazmatUpdateLoadRequest,
} from "@silvicom/shared";
import {
  AppCard as BaseCard,
  AppButton as BaseButton,
  AppInput as BaseInput,
  AppCheckbox as BaseCheckbox,
  AppFormField as FormField,
  AppCombobox as ComboSelect,
  AppDateTimeField,
} from "@silvicom/ui";
import { useToastStore } from "@/stores/toast";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import { useHazmatTrailersQuery } from "@/features/hazmat/useHazmatEquipment";
import { TANK_STATE_OPTIONS } from "@/features/hazmat/calcModel";
import { useUpdateLoad } from "@/features/hazmat/useHazmatLoads";

/**
 * Everything the record declares that is not a product — read-only on every status, editable on a
 * `draft` (D-H23), through the same `PATCH /api/hazmat/loads/:id` and the same `canEditLoad` gate as
 * `DeclaredProductsCard`.
 *
 * These eight fields used to live on `/hazmat/loads/new`, the standalone create form D-H17 deletes.
 * They are NOT cosmetic and could not simply go with it: `special_permit_numbers` is what raises the
 * §173.315 acknowledgement the reviewer must tick before clearing (`gate.requiresSpAttestation`),
 * `claimed_no_placards` is the shipper's assertion the engine is asked to contradict, and
 * `carrier_relationship` is the §172.506 fact that decides who is responsible for placarding the
 * vehicle. Dropping the form without moving them would have quietly removed the only way to state
 * three regulatory inputs.
 *
 * `HazmatPanel.startRecord` prefills vehicle, trailer, driver and pickup from what dispatch already
 * knows, and hard-codes `tankState: "loaded"` / `carrierRelationship: "unknown"` because dispatch
 * does not know them. This card is where those two get their real answer — which is why it opens
 * for editing rather than only reporting.
 */
const props = defineProps<{ load: HazmatLoadRow; canManage: boolean }>();

const toast = useToastStore();
const update = useUpdateLoad();
const { data: vehicles } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();
const { data: trailers } = useHazmatTrailersQuery();

const CARRIER_RELATIONSHIP_OPTIONS = [
  { value: "carrier_supplied_cargo_tank", label: "We supplied the cargo tank" },
  { value: "shipper_supplied_common_carrier", label: "Shipper supplied it — we are the common carrier" },
  { value: "private_carrier", label: "Private carrier — our own freight" },
  { value: "unknown", label: "Not stated" },
];

const editable = computed(() => props.canManage && canEditLoad(props.load.status as HazmatLoadStatus));
const editing = ref(false);

const form = reactive({
  vehicleId: "",
  trailerId: "",
  driverId: "",
  tankState: "loaded",
  carrierRelationship: "unknown",
  plannedPickupAt: "",
  specialPermitNumbers: "",
  claimedNoPlacards: false,
});

const noneFirst = <T,>(rows: T[], label: (row: T) => string, value: (row: T) => string) => [
  { value: "", label: "— none —" },
  ...rows.map((row) => ({ value: value(row), label: label(row) })),
];
const vehicleOptions = computed(() => noneFirst(vehicles.value ?? [], (v) => `Unit ${v.unit_number}`, (v) => v.id));
const driverOptions = computed(() => noneFirst(drivers.value ?? [], (d) => d.full_name, (d) => d.id));
const trailerOptions = computed(() =>
  noneFirst(
    trailers.value ?? [],
    (t) => (t.trailer_type ? `Trailer ${t.unit_number} — ${t.trailer_type.replace("_", " ")}` : `Trailer ${t.unit_number}`),
    (t) => t.id,
  ),
);

function startEditing() {
  Object.assign(form, {
    vehicleId: props.load.vehicle_id ?? "",
    trailerId: props.load.trailer_id ?? "",
    driverId: props.load.driver_id ?? "",
    tankState: props.load.tank_state,
    carrierRelationship: props.load.carrier_relationship,
    // The datetime field wants a local `YYYY-MM-DDTHH:mm`, not the stored ISO instant.
    plannedPickupAt: props.load.planned_pickup_at ? props.load.planned_pickup_at.slice(0, 16) : "",
    specialPermitNumbers: (props.load.special_permit_numbers ?? []).join(", "),
    claimedNoPlacards: props.load.claimed_no_placards,
  });
  editing.value = true;
}

watch(editable, (canEdit) => {
  if (!canEdit) editing.value = false;
});

async function save() {
  const patch: HazmatUpdateLoadRequest = {
    vehicleId: form.vehicleId || null,
    trailerId: form.trailerId || null,
    driverId: form.driverId || null,
    tankState: form.tankState as HazmatUpdateLoadRequest["tankState"],
    carrierRelationship: form.carrierRelationship as HazmatUpdateLoadRequest["carrierRelationship"],
    plannedPickupAt: form.plannedPickupAt ? new Date(form.plannedPickupAt).toISOString() : null,
    specialPermitNumbers: form.specialPermitNumbers
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    claimedNoPlacards: form.claimedNoPlacards,
  };
  try {
    await update.mutateAsync({ id: props.load.id, patch });
    editing.value = false;
    toast.success("Load details saved");
  } catch (e) {
    toast.error("Could not save the load details", e instanceof Error ? e.message : undefined);
  }
}

// ── read-only labels ──────────────────────────────────────────────────────────
const humanize = (value: string): string => value.replace(/_/g, " ");
const vehicleLabel = computed(
  () => (vehicles.value ?? []).find((v) => v.id === props.load.vehicle_id)?.unit_number ?? "—",
);
const trailerLabel = computed(
  () => (trailers.value ?? []).find((t) => t.id === props.load.trailer_id)?.unit_number ?? "—",
);
const driverLabel = computed(() => (drivers.value ?? []).find((d) => d.id === props.load.driver_id)?.full_name ?? "—");
const carrierLabel = computed(
  () => CARRIER_RELATIONSHIP_OPTIONS.find((o) => o.value === props.load.carrier_relationship)?.label ?? "—",
);
const pickupLabel = computed(() =>
  props.load.planned_pickup_at ? new Date(props.load.planned_pickup_at).toLocaleString() : "—",
);
const permitsLabel = computed(() => (props.load.special_permit_numbers ?? []).join(", ") || "—");
</script>

<template>
  <BaseCard>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold text-ink">Load details</h2>
        <p class="mt-0.5 text-xs text-ink-muted">
          The equipment, the driver and what the shipping paper claims. The rules that decide who
          placards the vehicle read these.
        </p>
      </div>
      <BaseButton v-if="editable && !editing" variant="secondary" size="sm" @click="startEditing">Edit details</BaseButton>
    </div>

    <!-- ── read-only ─────────────────────────────────────────────────────────────────────────── -->
    <dl v-if="!editing" class="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
      <div><dt class="text-ink-tertiary">Truck</dt><dd class="text-ink">{{ vehicleLabel }}</dd></div>
      <div><dt class="text-ink-tertiary">Trailer</dt><dd class="text-ink">{{ trailerLabel }}</dd></div>
      <div><dt class="text-ink-tertiary">Driver</dt><dd class="text-ink">{{ driverLabel }}</dd></div>
      <div><dt class="text-ink-tertiary">Planned pickup</dt><dd class="text-ink">{{ pickupLabel }}</dd></div>
      <div><dt class="text-ink-tertiary">Tank state</dt><dd class="text-ink first-letter:uppercase">{{ humanize(load.tank_state) }}</dd></div>
      <div class="col-span-2"><dt class="text-ink-tertiary">Who placards this vehicle</dt><dd class="text-ink">{{ carrierLabel }}</dd></div>
      <div><dt class="text-ink-tertiary">Special permits</dt><dd class="text-ink">{{ permitsLabel }}</dd></div>
      <div v-if="load.claimed_no_placards" class="col-span-2 sm:col-span-4">
        <dt class="text-ink-tertiary">Shipper's claim</dt>
        <dd class="text-ink">Shipper claims this load needs no placards — the analysis checks it.</dd>
      </div>
    </dl>

    <!-- ── editing (draft only) ──────────────────────────────────────────────────────────────── -->
    <template v-else>
      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="Truck">
          <ComboSelect :id="id" v-model="form.vehicleId" :options="vehicleOptions" placeholder="Search trucks…" />
        </FormField>
        <FormField v-slot="{ id }" label="Trailer" hint="Its type sets each product's packaging default.">
          <ComboSelect :id="id" v-model="form.trailerId" :options="trailerOptions" placeholder="Search trailers…" />
        </FormField>
        <FormField v-slot="{ id }" label="Driver">
          <ComboSelect :id="id" v-model="form.driverId" :options="driverOptions" placeholder="Search drivers…" />
        </FormField>
        <FormField v-slot="{ id }" label="Planned pickup">
          <AppDateTimeField :id="id" v-model="form.plannedPickupAt" />
        </FormField>
        <FormField v-slot="{ id }" label="Tank state">
          <ComboSelect :id="id" v-model="form.tankState" :options="TANK_STATE_OPTIONS" />
        </FormField>
        <FormField v-slot="{ id }" label="Who placards this vehicle" hint="Who supplied the equipment decides where the duty sits.">
          <ComboSelect :id="id" v-model="form.carrierRelationship" :options="CARRIER_RELATIONSHIP_OPTIONS" />
        </FormField>
        <FormField v-slot="{ id }" label="Special permits (DOT-SP)" class="sm:col-span-2" hint="Comma-separated, only if one is claimed. A reviewer has to acknowledge each before this load can clear.">
          <BaseInput :id="id" v-model="form.specialPermitNumbers" placeholder="SP 12345, SP 20800" />
        </FormField>
      </div>
      <div class="mt-4">
        <BaseCheckbox v-model="form.claimedNoPlacards">Shipper claims this load needs no placards</BaseCheckbox>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <BaseButton variant="primary" size="sm" :disabled="update.isPending.value" @click="save">
          {{ update.isPending.value ? "Saving…" : "Save details" }}
        </BaseButton>
        <BaseButton variant="secondary" size="sm" :disabled="update.isPending.value" @click="editing = false">Cancel</BaseButton>
      </div>
    </template>
  </BaseCard>
</template>
