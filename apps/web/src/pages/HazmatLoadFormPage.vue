<script setup lang="ts">
import { computed, reactive } from "vue";
import { useRouter } from "vue-router";
import type { HazmatProduct } from "@fuelguard/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseCheckbox from "@/components/ui/BaseCheckbox.vue";
import FormField from "@/components/ui/FormField.vue";
import ComboSelect from "@/components/ui/ComboSelect.vue";
import ProductPicker from "@/features/hazmat/ProductPicker.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import { useHazmatTrailersQuery } from "@/features/hazmat/useHazmatEquipment";
import {
  emptyLine,
  equipmentFromTrailerType,
  QUANTITY_UNIT_OPTIONS,
  GROSS_WEIGHT_UNIT_OPTIONS,
  PACKAGE_TYPE_OPTIONS,
  CAPACITY_UNIT_OPTIONS,
  TANK_STATE_OPTIONS,
} from "@/features/hazmat/calcModel";
import {
  buildCreateLoadRequest,
  emptyLoadForm,
  loadFormHasProduct,
  CARRIER_RELATIONSHIP_OPTIONS,
  type LoadForm,
} from "@/features/hazmat/loadFormModel";
import { useCreateHazmatLoad } from "@/features/hazmat/useHazmatLoads";

/**
 * Create a hazmat load (plan H5). Declares the load as a draft (`declared_lines` = the same engine lines
 * the calculator builds), then the detail view submits + analyzes it. Fleet pickers reuse the existing
 * vehicles/drivers data; the cargo-tank profile (H5 later) refines capacity from the chosen equipment.
 */
const router = useRouter();
const form = reactive<LoadForm>(emptyLoadForm());
const create = useCreateHazmatLoad();

const { data: vehicles } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();
const { data: trailers } = useHazmatTrailersQuery();

const vehicleOptions = computed(() => [
  { value: "", label: "— none —" },
  ...(vehicles.value ?? []).map((v) => ({ value: v.id, label: `Unit ${v.unit_number}` })),
]);
const trailerOptions = computed(() => [
  { value: "", label: "— none —" },
  ...(trailers.value ?? []).map((t) => ({
    value: t.id,
    label: t.trailer_type ? `Trailer ${t.unit_number} — ${t.trailer_type.replace("_", " ")}` : `Trailer ${t.unit_number}`,
  })),
]);

/** H-P1: the chosen trailer states the equipment — untouched lines pick up its packaging defaults. */
function onTrailerChange(id: string) {
  form.trailerId = id;
  const trailer = (trailers.value ?? []).find((t) => t.id === id);
  form.equipmentType = equipmentFromTrailerType(trailer?.trailer_type);
  for (const line of form.lines) {
    if (line.product == null) Object.assign(line, emptyLine(form.equipmentType));
  }
}
const driverOptions = computed(() => [
  { value: "", label: "— none —" },
  ...(drivers.value ?? []).map((d) => ({ value: d.id, label: d.full_name })),
]);

const canSave = computed(() => loadFormHasProduct(form));

function addLine() {
  form.lines.push(emptyLine(form.equipmentType));
}
function removeLine(i: number) {
  form.lines.splice(i, 1);
}
function selectProduct(i: number, product: HazmatProduct) {
  form.lines[i]!.product = product;
}
function clearProduct(i: number) {
  form.lines[i]!.product = null;
}

async function save() {
  const id = crypto.randomUUID();
  await create.mutateAsync(buildCreateLoadRequest(id, form));
  await router.push(`/hazmat/loads/${id}`);
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Declare a hazmat load. It saves as a draft; submit & analyze from the load page.">
      <template #actions>
        <BaseButton variant="ghost" size="sm" to="/hazmat/loads">← Loads</BaseButton>
      </template>
    </PageHeader>

    <form class="space-y-4" @submit.prevent="save">
      <BaseCard>
        <h2 class="text-sm font-semibold text-ink">Equipment & context</h2>
        <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" label="Vehicle">
            <ComboSelect :id="id" v-model="form.vehicleId" :options="vehicleOptions" placeholder="Search vehicles…" />
          </FormField>
          <FormField v-slot="{ id }" label="Trailer" hint="Its type sets each line's packaging default.">
            <ComboSelect :id="id" :model-value="form.trailerId" :options="trailerOptions" placeholder="Search trailers…" @update:model-value="onTrailerChange" />
          </FormField>
          <FormField v-slot="{ id }" label="Driver">
            <ComboSelect :id="id" v-model="form.driverId" :options="driverOptions" placeholder="Search drivers…" />
          </FormField>
          <FormField v-slot="{ id }" label="Tank state">
            <ComboSelect :id="id" v-model="form.tankState" :options="TANK_STATE_OPTIONS" />
          </FormField>
          <FormField v-slot="{ id }" label="Carrier relationship">
            <ComboSelect :id="id" v-model="form.carrierRelationship" :options="CARRIER_RELATIONSHIP_OPTIONS" />
          </FormField>
          <FormField v-slot="{ id }" label="Planned pickup">
            <BaseInput :id="id" v-model="form.plannedPickupAt" type="datetime-local" />
          </FormField>
          <FormField v-slot="{ id }" label="Special permits (DOT-SP)" hint="Comma-separated, if claimed.">
            <BaseInput :id="id" v-model="form.specialPermitNumbers" placeholder="SP 12345, SP 20800" />
          </FormField>
        </div>
        <div class="mt-3">
          <BaseCheckbox v-model="form.claimedNoPlacards">Shipper claims this load needs no placards</BaseCheckbox>
        </div>
      </BaseCard>

      <BaseCard>
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-ink">Products</h2>
          <BaseButton variant="soft" size="sm" @click="addLine">Add product</BaseButton>
        </div>
        <div class="mt-3 space-y-4">
          <div v-for="(line, i) in form.lines" :key="i" class="rounded-lg ring-1 ring-inset ring-edge p-3">
            <div class="flex items-start justify-between gap-2">
              <p class="text-xs font-medium uppercase tracking-wide text-ink-subtle">Line {{ i + 1 }}</p>
              <button v-if="form.lines.length > 1" type="button" class="text-xs text-ink-muted hover:text-danger-600" @click="removeLine(i)">
                Remove
              </button>
            </div>
            <div class="mt-2">
              <div v-if="line.product" class="flex items-center justify-between gap-2 rounded-md bg-surface-muted px-3 py-2">
                <span class="truncate text-sm text-ink">{{ line.product.label }}</span>
                <button type="button" class="shrink-0 text-xs text-brand-600 hover:text-brand-500" @click="clearProduct(i)">Change</button>
              </div>
              <ProductPicker v-else @select="(p) => selectProduct(i, p)" />
            </div>
            <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <FormField v-slot="{ id }" label="Packaging" class="col-span-2" hint="As the BOL states it — bulk vs non-bulk is derived. Count packages, not pallets.">
                <ComboSelect :id="id" v-model="line.packageType" :options="PACKAGE_TYPE_OPTIONS" placeholder="Drums, totes, boxes…" />
              </FormField>
              <FormField v-if="line.packageType !== 'bulk_cargo'" v-slot="{ id }" label="Package count" hint="§172.202(a)(7)">
                <BaseInput :id="id" v-model="line.packageCount" type="number" inputmode="numeric" min="0" placeholder="4" />
              </FormField>
              <template v-if="line.packageType !== 'bulk_cargo'">
                <FormField v-slot="{ id }" label="Per-package size" hint="Optional. >119 gal liquid / >1,000 lb water cap. = bulk (§171.8).">
                  <BaseInput :id="id" v-model="line.perPackageCapacityValue" type="number" inputmode="decimal" min="0" placeholder="55" />
                </FormField>
                <FormField v-slot="{ id }" label="Size unit">
                  <ComboSelect :id="id" v-model="line.perPackageCapacityUnit" :options="CAPACITY_UNIT_OPTIONS" />
                </FormField>
              </template>
            </div>
            <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <FormField v-slot="{ id }" label="Total quantity">
                <BaseInput :id="id" v-model="line.quantityValue" type="number" inputmode="decimal" min="0" placeholder="8000" />
              </FormField>
              <FormField v-slot="{ id }" label="Unit">
                <ComboSelect :id="id" v-model="line.quantityUnit" :options="QUANTITY_UNIT_OPTIONS" />
              </FormField>
              <FormField v-slot="{ id }" label="Gross weight" hint="Non-bulk Table 2.">
                <BaseInput :id="id" v-model="line.grossWeightValue" type="number" inputmode="decimal" min="0" placeholder="1254" />
              </FormField>
              <FormField v-slot="{ id }" label="Weight unit" hint="kg converts to lb.">
                <ComboSelect :id="id" v-model="line.grossWeightUnit" :options="GROSS_WEIGHT_UNIT_OPTIONS" />
              </FormField>
            </div>
            <div class="mt-3 flex flex-wrap gap-4">
              <BaseCheckbox v-model="line.isResidueLine">Residue only</BaseCheckbox>
              <BaseCheckbox v-model="line.reclassedCombustible">Reclassified combustible (§173.150(f))</BaseCheckbox>
            </div>
          </div>
        </div>
      </BaseCard>

      <div class="flex items-center gap-3">
        <BaseButton type="submit" variant="primary" :disabled="!canSave || create.isPending.value">
          {{ create.isPending.value ? "Saving…" : "Create draft" }}
        </BaseButton>
        <span v-if="!canSave" class="text-xs text-ink-muted">Add at least one product.</span>
        <p v-if="create.isError.value" class="text-sm text-danger-600">
          {{ create.error.value instanceof Error ? create.error.value.message : "Could not create the load." }}
        </p>
      </div>
    </form>
  </div>
</template>
