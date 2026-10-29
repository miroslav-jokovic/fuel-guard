<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  canEditLoad,
  resolveVehicleKind,
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
  AppCallout,
} from "@silvicom/ui";
import { useToastStore } from "@/stores/toast";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import { useHazmatTrailersQuery } from "@/features/hazmat/useHazmatEquipment";
import { TANK_STATE_OPTIONS } from "@/features/hazmat/calcModel";
import { useUpdateLoad } from "@/features/hazmat/useHazmatLoads";
import { formatDateTime } from "@/lib/format";
import { useOpens } from "@/composables/useOpens";
import { FactList, type Fact } from "@silvicom/ui";

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

// ── the equipment question (TWO-CLICK-READER-PLAN TC1.4, Q-TC4 (b)) ────────────────────────
// The analysis withholds a load whose equipment type is not on file (hazmatReview.ts) rather than placard it as a
// guessed tank, so the form asks first: the same `resolveVehicleKind` the server reads, over the trailer chosen.
// With no trailer the server may still know the truck's tank from its row, which this form does not load — so the
// question is asked of a chosen trailer only, and the analysis answers the rest.
const opens = useOpens();
const chosenTrailerId = computed(() => (editing.value ? form.trailerId : props.load.trailer_id) || null);
const untypedTrailer = computed(() => {
  const t = (trailers.value ?? []).find((x) => x.id === chosenTrailerId.value);
  if (!t) return null;
  const hasTank = t.cargo_capacity_gal != null || (t.cargo_compartments?.length ?? 0) > 0;
  return resolveVehicleKind({ trailerType: t.trailer_type, hasCargoTankProfile: hasTank }).confident ? null : t.unit_number;
});

// ── read-only labels ──────────────────────────────────────────────────────────
/** One tank-state vocabulary with the panel and the calculator, mapped rather than case-transformed. */
// A field nobody has declared is null, and FactList draws its em dash (D-US6).
const tankStateLabel = (value: string): string =>
  TANK_STATE_OPTIONS.find((o) => o.value === value)?.label ?? value.replace(/_/g, " ");
const facts = computed<Fact[]>(() => {
  const l = props.load;
  return [
    { label: "Truck", value: (vehicles.value ?? []).find((v) => v.id === l.vehicle_id)?.unit_number ?? null },
    { label: "Trailer", value: (trailers.value ?? []).find((t) => t.id === l.trailer_id)?.unit_number ?? null },
    { label: "Driver", value: (drivers.value ?? []).find((d) => d.id === l.driver_id)?.full_name ?? null },
    { label: "Planned pickup", value: l.planned_pickup_at ? formatDateTime(l.planned_pickup_at) : null },
    { label: "Tank state", value: tankStateLabel(l.tank_state) },
    {
      label: "Who placards this vehicle",
      value: CARRIER_RELATIONSHIP_OPTIONS.find((o) => o.value === l.carrier_relationship)?.label ?? null,
    },
    { label: "Special permits", value: (l.special_permit_numbers ?? []).join(", ") || null },
    ...(l.claimed_no_placards
      ? [{ label: "Shipper's claim", value: "Shipper claims this load needs no placards — the analysis checks it." }]
      : []),
  ];
});
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

    <AppCallout v-if="untypedTrailer" tone="warning" class="mt-4">
      Trailer {{ untypedTrailer }} has no equipment type, so the analysis will stop rather than guess — a van and a tank
      are placarded differently.
      <template v-if="opens('/trailers')"> Set its type on the <RouterLink to="/trailers" class="font-medium underline">Trailers page</RouterLink>.</template>
      <template v-else> Ask someone who manages trailers to set its type.</template>
    </AppCallout>

    <!-- ── read-only ─────────────────────────────────────────────────────────────────────────── -->
    <FactList v-if="!editing" class="mt-4" :facts="facts" />

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
