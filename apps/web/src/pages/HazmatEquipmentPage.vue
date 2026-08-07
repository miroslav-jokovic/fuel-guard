<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { AppIcon } from "@fuelguard/ui";
import { ChevronLeftIcon, PlusIcon, TrailerIcon, TrashIcon } from "@fuelguard/ui/icons";
import type { HazmatCargoTankProfileRow } from "@fuelguard/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import FormField from "@/components/ui/FormField.vue";
import ComboSelect from "@/components/ui/ComboSelect.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import {
  useHazmatProfilesQuery,
  useHazmatTrailersQuery,
  useCreateProfile,
  useUpdateProfile,
  useDeleteProfile,
} from "@/features/hazmat/useHazmatProfiles";
import {
  buildCreateProfileRequest,
  buildUpdateProfileRequest,
  emptyProfileForm,
  profileFormValid,
  profileRowToForm,
  type ProfileForm,
} from "@/features/hazmat/profileFormModel";

const {
  data: profiles,
  isLoading,
  isError,
  error,
  isFetching,
  refetch,
} = useHazmatProfilesQuery();
const { data: vehicles } = useVehiclesQuery();
const { data: trailers } = useHazmatTrailersQuery();
const create = useCreateProfile();
const update = useUpdateProfile();
const remove = useDeleteProfile();

const form = reactive<ProfileForm>(emptyProfileForm());
const editingId = ref<string | null>(null);
const saveError = ref<string | null>(null);
const equipmentOptions = computed(() => [
  { value: "", label: "Select equipment" },
  ...(vehicles.value ?? []).map((vehicle) => ({ value: `vehicle:${vehicle.id}`, label: `Unit ${vehicle.unit_number}` })),
  ...(trailers.value ?? []).map((trailer) => ({ value: `trailer:${trailer.id}`, label: `Trailer ${trailer.unit_number}` })),
]);

const vehicleUnit = (id: string) => (vehicles.value ?? []).find((vehicle) => vehicle.id === id)?.unit_number ?? "Unknown";
const trailerUnit = (id: string) => (trailers.value ?? []).find((trailer) => trailer.id === id)?.unit_number ?? "Unknown";
const labelForRow = (row: HazmatCargoTankProfileRow): string =>
  row.vehicle_id ? `Unit ${vehicleUnit(row.vehicle_id)}` : `Trailer ${trailerUnit(row.trailer_id ?? "")}`;
const capacityLabel = (row: HazmatCargoTankProfileRow): string =>
  row.cargo_capacity_gal !== null ? `${row.cargo_capacity_gal.toLocaleString()} gal` : "—";
const compartmentLabel = (row: HazmatCargoTankProfileRow): string => {
  const count = (row.compartments ?? []).length;
  return count === 0 ? "Single tank" : `${count} compartment${count === 1 ? "" : "s"}`;
};

const canSave = computed(() => profileFormValid(form));
const busy = computed(() => create.isPending.value || update.isPending.value);
const columns: DataTableColumn[] = [
  { key: "equipment", label: "Equipment", align: "left", headerClass: "min-w-[9rem]" },
  { key: "capacity", label: "Capacity", align: "left", headerClass: "min-w-[8rem]", cellClass: "text-ink-secondary" },
  { key: "compartments", label: "Tank layout", align: "left", headerClass: "min-w-[9rem]", cellClass: "text-ink-secondary" },
];

function resetForm() {
  Object.assign(form, emptyProfileForm());
  editingId.value = null;
  saveError.value = null;
}
function startEdit(row: HazmatCargoTankProfileRow) {
  Object.assign(form, profileRowToForm(row));
  editingId.value = row.id;
  saveError.value = null;
}
function addCompartment() {
  form.compartments.push({ capacityGal: "" });
}
function removeCompartment(index: number) {
  form.compartments.splice(index, 1);
}
async function save() {
  saveError.value = null;
  try {
    if (editingId.value) {
      await update.mutateAsync({ id: editingId.value, req: buildUpdateProfileRequest(form) });
    } else {
      await create.mutateAsync(buildCreateProfileRequest(crypto.randomUUID(), form));
    }
    resetForm();
  } catch (caught) {
    saveError.value = caught instanceof Error ? caught.message : "Could not save the profile.";
  }
}
async function del(row: HazmatCargoTankProfileRow) {
  if (!confirm(`Delete the cargo-tank profile for ${labelForRow(row)}?`)) return;
  await remove.mutateAsync(row.id);
  if (editingId.value === row.id) resetForm();
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Maintain tank capacity and compartment details for equipment used in hazmat load analysis.">
      <template #actions>
        <BaseButton variant="ghost" size="sm" to="/hazmat">
          <AppIcon :icon="ChevronLeftIcon" class="size-4" aria-hidden="true" />
          HazmatGuard
        </BaseButton>
      </template>
    </PageHeader>

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(20rem,0.85fr)_minmax(0,1.15fr)] lg:items-start">
      <BaseCard as="section">
        <div class="flex items-start gap-3">
          <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <AppIcon :icon="TrailerIcon" class="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 class="text-sm font-semibold text-ink">{{ editingId ? "Edit cargo-tank profile" : "Add cargo-tank profile" }}</h2>
            <p class="mt-1 text-sm text-ink-muted">One profile per truck or trailer.</p>
          </div>
        </div>

        <form class="mt-5 space-y-4" @submit.prevent="save">
          <FormField v-slot="{ id }" label="Equipment" required>
            <ComboSelect
              :id="id"
              v-model="form.equipment"
              :options="equipmentOptions"
              :disabled="Boolean(editingId)"
              placeholder="Search trucks and trailers…"
            />
          </FormField>
          <FormField
            v-slot="{ id }"
            label="Total tank capacity"
            hint="Optional. Enter the combined capacity in gallons."
          >
            <BaseInput :id="id" v-model="form.cargoCapacityGal" type="number" inputmode="decimal" min="0" placeholder="9,200" />
          </FormField>

          <div class="rounded-lg bg-surface-subtle p-4 ring-1 ring-edge-subtle">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-medium text-ink-secondary">Compartments</h3>
                <p class="mt-0.5 text-xs text-ink-muted">Leave empty for a single-tank configuration.</p>
              </div>
              <BaseButton variant="secondary" size="sm" @click="addCompartment">
                <AppIcon :icon="PlusIcon" class="size-4" aria-hidden="true" />
                Add
              </BaseButton>
            </div>
            <div v-if="form.compartments.length" class="mt-3 space-y-2">
              <div v-for="(compartment, index) in form.compartments" :key="index" class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                <span class="text-xs font-medium text-ink-muted">{{ index + 1 }}</span>
                <BaseInput
                  v-model="compartment.capacityGal"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  placeholder="Capacity (gal)"
                  :aria-label="`Compartment ${index + 1} capacity in gallons`"
                />
                <BaseButton variant="ghost" size="sm" :aria-label="`Remove compartment ${index + 1}`" @click="removeCompartment(index)">
                  <AppIcon :icon="TrashIcon" class="size-4" aria-hidden="true" />
                </BaseButton>
              </div>
            </div>
          </div>

          <p v-if="saveError" class="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">{{ saveError }}</p>
          <div class="flex flex-wrap items-center gap-3">
            <BaseButton variant="primary" type="submit" :disabled="!canSave || busy">
              {{ busy ? "Saving…" : editingId ? "Save changes" : "Add profile" }}
            </BaseButton>
            <BaseButton v-if="editingId" variant="ghost" @click="resetForm">Cancel</BaseButton>
            <span v-if="!canSave" class="text-xs text-ink-muted">Select equipment to continue.</span>
          </div>
        </form>
      </BaseCard>

      <section class="space-y-3">
        <div class="flex items-end justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-ink">Saved profiles</h2>
            <p class="mt-1 text-sm text-ink-muted">Capacity and compartment plans currently available to HazmatGuard.</p>
          </div>
          <span class="text-sm text-ink-muted">{{ (profiles ?? []).length }} profiles</span>
        </div>
        <DataTable
          :columns="columns"
          :rows="profiles ?? []"
          row-key="id"
          :loading="isLoading"
          :error="isError ? (error instanceof Error ? error.message : 'Could not load cargo-tank profiles.') : null"
          :retrying="isFetching"
          :sticky-header="false"
          empty-text="No cargo-tank profiles yet."
          @retry="refetch"
        >
          <template #cell-equipment="{ row }">{{ labelForRow(row) }}</template>
          <template #cell-capacity="{ row }">{{ capacityLabel(row) }}</template>
          <template #cell-compartments="{ row }">{{ compartmentLabel(row) }}</template>
          <template #actions="{ row }">
            <KebabMenu>
              <button class="kebab-item" @click="startEdit(row)">Edit profile</button>
              <button class="kebab-item kebab-item-danger" @click="del(row)">Delete profile</button>
            </KebabMenu>
          </template>
        </DataTable>
      </section>
    </div>
  </div>
</template>
