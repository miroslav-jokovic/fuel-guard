<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { HazmatCargoTankProfileRow } from "@fuelguard/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import FormField from "@/components/ui/FormField.vue";
import ComboSelect from "@/components/ui/ComboSelect.vue";
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

/**
 * Cargo-tank profiles (plan H5) — capacity + compartment plan per truck/trailer. The analysis orchestrator
 * looks up a load's equipment profile and passes it into the engine's `vehicle` block; the engine's
 * capacity/compartment RULES are pending (H2), so today this is recorded + carried on the run for the audit
 * trail and takes effect the moment that logic lands. Write access is admin/fleet_manager/safety_manager.
 */
const { data: profiles, isLoading } = useHazmatProfilesQuery();
const { data: vehicles } = useVehiclesQuery();
const { data: trailers } = useHazmatTrailersQuery();

const create = useCreateProfile();
const update = useUpdateProfile();
const remove = useDeleteProfile();

const form = reactive<ProfileForm>(emptyProfileForm());
const editingId = ref<string | null>(null);
const saveError = ref<string | null>(null);

const equipmentOptions = computed(() => [
  { value: "", label: "— select equipment —" },
  ...(vehicles.value ?? []).map((v) => ({ value: `vehicle:${v.id}`, label: `Unit ${v.unit_number}` })),
  ...(trailers.value ?? []).map((t) => ({ value: `trailer:${t.id}`, label: `Trailer ${t.unit_number}` })),
]);

const vehicleUnit = (id: string) => (vehicles.value ?? []).find((v) => v.id === id)?.unit_number ?? "?";
const trailerUnit = (id: string) => (trailers.value ?? []).find((t) => t.id === id)?.unit_number ?? "?";
function labelForRow(row: HazmatCargoTankProfileRow): string {
  return row.vehicle_id ? `Unit ${vehicleUnit(row.vehicle_id)}` : `Trailer ${trailerUnit(row.trailer_id ?? "")}`;
}

const canSave = computed(() => profileFormValid(form));
const busy = computed(() => create.isPending.value || update.isPending.value);

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
function removeCompartment(i: number) {
  form.compartments.splice(i, 1);
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
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : "Could not save the profile.";
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
    <PageHeader description="Capacity & compartment plans per truck/trailer, recorded per equipment and attached to each load's analysis.">
      <template #actions>
        <BaseButton variant="ghost" size="sm" to="/hazmat">← HazmatGuard</BaseButton>
      </template>
    </PageHeader>

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- editor -->
      <BaseCard>
        <h2 class="text-sm font-semibold text-ink">{{ editingId ? "Edit profile" : "Add profile" }}</h2>
        <div class="mt-3 space-y-4">
          <FormField v-slot="{ id }" label="Equipment" hint="One profile per truck or trailer.">
            <ComboSelect :id="id" v-model="form.equipment" :options="equipmentOptions" :disabled="Boolean(editingId)" placeholder="Search equipment…" />
          </FormField>
          <FormField v-slot="{ id }" label="Total tank capacity (gal)" hint="Optional. Recorded and attached to analysis; the engine's capacity/compartment rules are pending (H2).">
            <BaseInput :id="id" v-model="form.cargoCapacityGal" type="number" inputmode="decimal" min="0" placeholder="9200" />
          </FormField>

          <div>
            <div class="flex items-center justify-between">
              <label class="block text-sm font-medium text-ink-secondary">Compartments</label>
              <BaseButton variant="soft" size="sm" @click="addCompartment">Add compartment</BaseButton>
            </div>
            <p v-if="form.compartments.length === 0" class="mt-1 text-xs text-ink-muted">
              No compartments — single-tank. Add rows for a compartmented tank.
            </p>
            <div v-else class="mt-2 space-y-2">
              <div v-for="(c, i) in form.compartments" :key="i" class="flex items-center gap-2">
                <span class="w-16 shrink-0 text-xs text-ink-subtle">Comp. {{ i + 1 }}</span>
                <BaseInput v-model="c.capacityGal" type="number" inputmode="decimal" min="0" placeholder="Capacity (gal)" />
                <button type="button" class="shrink-0 text-xs text-ink-muted hover:text-danger-600" @click="removeCompartment(i)">Remove</button>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <BaseButton variant="primary" size="sm" :disabled="!canSave || busy" @click="save">
              {{ busy ? "Saving…" : editingId ? "Save changes" : "Add profile" }}
            </BaseButton>
            <BaseButton v-if="editingId" variant="ghost" size="sm" @click="resetForm">Cancel</BaseButton>
            <span v-if="!canSave" class="text-xs text-ink-muted">Select equipment first.</span>
          </div>
          <p v-if="saveError" class="text-sm text-danger-600">{{ saveError }}</p>
        </div>
      </BaseCard>

      <!-- list -->
      <BaseCard padding="none">
        <div class="border-b border-edge px-5 py-3">
          <h2 class="text-sm font-semibold text-ink">Profiles</h2>
        </div>
        <p v-if="isLoading" class="px-5 py-4 text-sm text-ink-muted">Loading…</p>
        <p v-else-if="!profiles || profiles.length === 0" class="px-5 py-8 text-center text-sm text-ink-muted">
          No cargo-tank profiles yet.
        </p>
        <table v-else class="w-full text-sm">
          <thead class="border-b border-edge text-left text-xs uppercase tracking-wide text-ink-subtle">
            <tr>
              <th class="px-5 py-2 font-medium">Equipment</th>
              <th class="px-5 py-2 font-medium">Capacity</th>
              <th class="px-5 py-2 font-medium">Compartments</th>
              <th class="px-5 py-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in profiles" :key="row.id" class="border-b border-edge last:border-0">
              <td class="px-5 py-2.5 text-ink">{{ labelForRow(row) }}</td>
              <td class="px-5 py-2.5 text-ink-secondary">{{ row.cargo_capacity_gal !== null ? `${row.cargo_capacity_gal} gal` : "—" }}</td>
              <td class="px-5 py-2.5 text-ink-secondary">{{ (row.compartments ?? []).length }}</td>
              <td class="px-5 py-2.5 text-right">
                <BaseButton variant="ghost" size="sm" @click="startEdit(row)">Edit</BaseButton>
                <button type="button" class="ml-2 text-xs text-ink-muted hover:text-danger-600" @click="del(row)">Delete</button>
              </td>
            </tr>
          </tbody>
        </table>
      </BaseCard>
    </div>
  </div>
</template>
