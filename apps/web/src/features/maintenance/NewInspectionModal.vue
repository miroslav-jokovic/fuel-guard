<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, AppCallout, AppSelect, AppDateField, AppFormField as FormField } from "@silvicom/ui";
import type { InspectionSubjectType } from "@silvicom/shared";
import BaseModal from "@/components/ui/BaseModal.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useTrailersQuery } from "@/composables/useTrailers";
import { useCreateInspection, useInspectorsQuery } from "@/features/maintenance/useAnnualInspections";

/**
 * Starting an inspection.
 *
 * Three things and nothing else: which machine, who is inspecting it, and on what date. Everything
 * a report needs beyond that is either seeded from the catalogue or derived, so asking for it here
 * would be asking twice.
 *
 * The inspector list is the register, and it is filtered to people whose qualification covers the
 * date being inspected — the report asserts they hold one, and offering somebody who does not is
 * offering a refusal the reader only meets at the end.
 */

const emit = defineEmits<{ close: []; created: [id: string] }>();

const today = new Date().toISOString().slice(0, 10);
const subjectType = ref<InspectionSubjectType>("tractor");
const subjectId = ref("");
const inspectorId = ref("");
const inspectedOn = ref(today);
const failure = ref<string | null>(null);

const vehicles = useVehiclesQuery();
const trailers = useTrailersQuery();
const inspectors = useInspectorsQuery();
const create = useCreateInspection();

const equipmentOptions = computed(() => {
  const rows =
    subjectType.value === "tractor"
      ? (vehicles.data.value ?? []).map((v) => ({ id: v.id, unit: v.unit_number }))
      : (trailers.data.value ?? []).map((t) => ({ id: t.id, unit: t.unit_number }));
  return rows.map((r) => ({ value: r.id, label: r.unit }));
});

const inspectorOptions = computed(() =>
  (inspectors.data.value ?? [])
    .filter((i) => i.qualified)
    .map((i) => ({ value: i.id, label: i.full_name })),
);

const noInspectors = computed(() => inspectors.isFetched.value && inspectorOptions.value.length === 0);
const ready = computed(() => Boolean(subjectId.value && inspectorId.value && inspectedOn.value));

async function submit() {
  failure.value = null;
  try {
    const id = await create.mutateAsync({
      subjectType: subjectType.value,
      subjectId: subjectId.value,
      inspectorId: inspectorId.value,
      inspectedOn: inspectedOn.value,
    });
    emit("created", id);
  } catch (e) {
    failure.value = e instanceof Error ? e.message : "Could not start the inspection";
  }
}
</script>

<template>
  <BaseModal :open="true" title="New inspection" @close="emit('close')">
    <div class="space-y-4">
      <AppCallout v-if="noInspectors" tone="caution">
        Nobody is on the inspector register yet. An inspection records who performed it, so add an
        inspector before starting one.
      </AppCallout>

      <FormField v-slot="{ id }" label="Equipment type">
        <AppSelect
          :id="id"
          v-model="subjectType"
          :options="[
            { value: 'tractor', label: 'Tractor' },
            { value: 'trailer', label: 'Trailer' },
          ]"
          @update:model-value="subjectId = ''"
        />
      </FormField>

      <FormField v-slot="{ id }" label="Unit">
        <AppSelect :id="id" v-model="subjectId" :options="equipmentOptions" placeholder="Choose a unit" />
      </FormField>

      <FormField v-slot="{ id }" label="Inspector" hint="Only people whose qualification covers this date.">
        <AppSelect :id="id" v-model="inspectorId" :options="inspectorOptions" placeholder="Choose an inspector" />
      </FormField>

      <FormField v-slot="{ id }" label="Date inspected">
        <AppDateField :id="id" v-model="inspectedOn" />
      </FormField>

      <AppCallout v-if="failure" tone="danger">{{ failure }}</AppCallout>
    </div>

    <template #footer>
      <BaseButton variant="secondary" @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!ready || create.isPending.value" @click="submit">
        Start inspection
      </BaseButton>
    </template>
  </BaseModal>
</template>
