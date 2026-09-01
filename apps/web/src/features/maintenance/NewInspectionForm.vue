<script setup lang="ts">
import { computed, ref } from "vue";
import {
  AppButton as BaseButton,
  AppCallout,
  AppCombobox as ComboSelect,
  AppSelect,
  AppDateField,
  AppFormField as FormField,
} from "@silvicom/ui";
import type { InspectionSubjectType } from "@silvicom/shared";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useTrailersQuery } from "@/composables/useTrailers";
import { useCreateInspection, useInspectorsQuery } from "@/features/maintenance/useAnnualInspections";

/**
 * Starting an inspection — the body of a drawer, not an overlay of its own.
 *
 * Shaped like `VehicleForm`: the page owns the `SlideOver` and this emits `submit`/`cancel`. That is
 * the repo's split, and `DESIGN-SYSTEM-CONTRACT.md` §6 draws the line it rests on — a drawer keeps
 * the list visible beside the form, a centred modal is for content that needs WIDTH. A three-field
 * form needs no width, so it belongs in a drawer.
 *
 * Three questions and nothing else: which machine, who is inspecting it, on what date. Everything
 * else a report needs is seeded from the catalogue or derived, so asking here would be asking twice.
 */

const emit = defineEmits<{ created: [id: string]; cancel: [] }>();

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

const equipmentOptions = computed(() =>
  (subjectType.value === "tractor"
    ? (vehicles.data.value ?? []).map((v) => ({ id: v.id, unit: v.unit_number }))
    : (trailers.data.value ?? []).map((t) => ({ id: t.id, unit: t.unit_number }))
  ).map((r) => ({ value: r.id, label: r.unit })),
);

/**
 * Only people whose qualification covers the date being inspected. The report asserts they hold
 * one, so offering somebody who does not is offering a refusal the reader meets at the end.
 */
const inspectorOptions = computed(() =>
  (inspectors.data.value ?? []).filter((i) => i.qualified).map((i) => ({ value: i.id, label: i.full_name })),
);
const noInspectors = computed(() => inspectors.isFetched.value && inspectorOptions.value.length === 0);
const ready = computed(() => Boolean(subjectId.value && inspectorId.value && inspectedOn.value));

async function onSubmit() {
  failure.value = null;
  try {
    emit("created", await create.mutateAsync({
      subjectType: subjectType.value,
      subjectId: subjectId.value,
      inspectorId: inspectorId.value,
      inspectedOn: inspectedOn.value,
    }));
  } catch (e) {
    failure.value = e instanceof Error ? e.message : "Could not start the inspection";
  }
}
</script>

<template>
  <form class="space-y-6" @submit.prevent="onSubmit">
    <AppCallout v-if="noInspectors" tone="caution">
      Nobody is on the inspector register yet. An inspection records who performed it, so add an
      inspector before starting one.
    </AppCallout>

    <section aria-labelledby="new-inspection-what">
      <h3 id="new-inspection-what" class="text-sm font-semibold text-ink">What is being inspected</h3>
      <div class="mt-4 space-y-4">
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
        <!-- A combobox and not a select: production carries 195 tractors and 211 trailers, and a
             native dropdown of two hundred units is not something anybody scrolls. This is what
             `DispatchLoadFormPage` uses to pick a truck, a trailer or a driver. `AppSelect` stays
             above it, where the vocabulary is two closed options. -->
        <FormField v-slot="{ id }" label="Unit">
          <ComboSelect :id="id" v-model="subjectId" :options="equipmentOptions" placeholder="Search units…" />
        </FormField>
      </div>
    </section>

    <section aria-labelledby="new-inspection-who">
      <h3 id="new-inspection-who" class="text-sm font-semibold text-ink">Who is inspecting it</h3>
      <p class="mt-1 text-sm text-ink-muted">Only people whose qualification covers this date.</p>
      <div class="mt-4 space-y-4">
        <FormField v-slot="{ id }" label="Inspector">
          <ComboSelect :id="id" v-model="inspectorId" :options="inspectorOptions" placeholder="Search inspectors…" />
        </FormField>
        <FormField v-slot="{ id }" label="Date inspected">
          <AppDateField :id="id" v-model="inspectedOn" />
        </FormField>
      </div>
    </section>

    <AppCallout v-if="failure" tone="danger">{{ failure }}</AppCallout>

    <div class="flex justify-end gap-2">
      <BaseButton variant="secondary" @click="emit('cancel')">Cancel</BaseButton>
      <BaseButton type="submit" variant="primary" :disabled="!ready || create.isPending.value">
        Start inspection
      </BaseButton>
    </div>
  </form>
</template>
