<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  AppButton as BaseButton,
  AppCallout,
  AppCheckbox,
  AppDateField,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSelect,
  AppTextarea,
} from "@silvicom/ui";
import { useCreateInspector } from "@/features/maintenance/useAnnualInspections";

/**
 * Adding somebody to the inspector register — a drawer body, shaped like `VehicleForm`.
 *
 * The two qualification questions are the two the federal standard actually asks: how this person
 * qualifies, and whether that extends to brakes — which is thirteen of the fifty-six parts on the
 * form. They are recorded because the printed report asserts them, and the product derives that
 * assertion from this row rather than from a tick box. Nothing here is decoration.
 * (§396.19(b) and §396.25 — in a comment, per D-AVI15.)
 */

const emit = defineEmits<{ created: []; cancel: [] }>();
const create = useCreateInspector();

const form = reactive({
  fullName: "",
  address: "",
  qualificationBasis: "training_and_experience" as "state_federal_program" | "training_and_experience",
  brakeQualified: true,
  effectiveFrom: new Date().toISOString().slice(0, 10),
  notes: "",
});
const failure = ref<string | null>(null);
const ready = computed(() => form.fullName.trim().length > 0 && Boolean(form.effectiveFrom));

async function onSubmit() {
  failure.value = null;
  try {
    await create.mutateAsync({
      fullName: form.fullName.trim(),
      address: form.address.trim() || null,
      qualificationBasis: form.qualificationBasis,
      brakeQualified: form.brakeQualified,
      effectiveFrom: form.effectiveFrom,
      notes: form.notes.trim() || null,
    });
    emit("created");
  } catch (e) {
    failure.value = e instanceof Error ? e.message : "Could not add the inspector";
  }
}
</script>

<template>
  <form class="space-y-6" @submit.prevent="onSubmit">
    <section aria-labelledby="inspector-who">
      <h3 id="inspector-who" class="text-sm font-semibold text-ink">Who they are</h3>
      <div class="mt-4 space-y-4">
        <FormField v-slot="{ id }" label="Full name" hint="As it should print on the report.">
          <BaseInput :id="id" v-model="form.fullName" />
        </FormField>
        <FormField v-slot="{ id }" label="Address" hint="Only needed when an outside shop does the inspection.">
          <BaseInput :id="id" v-model="form.address" />
        </FormField>
      </div>
    </section>

    <section aria-labelledby="inspector-qualification">
      <h3 id="inspector-qualification" class="text-sm font-semibold text-ink">Qualification</h3>
      <p class="mt-1 text-sm text-ink-muted">
        The report states that the person who signed it is qualified. This is what it states it from.
      </p>
      <div class="mt-4 space-y-4">
        <FormField v-slot="{ id }" label="Qualified by">
          <AppSelect
            :id="id"
            v-model="form.qualificationBasis"
            :options="[
              { value: 'training_and_experience', label: 'Training and experience' },
              { value: 'state_federal_program', label: 'State or federal inspector program' },
            ]"
          />
        </FormField>
        <AppCheckbox v-model="form.brakeQualified" label="Also qualified to inspect brakes" />
        <FormField v-slot="{ id }" label="Qualified from">
          <AppDateField :id="id" v-model="form.effectiveFrom" />
        </FormField>
        <FormField v-slot="{ id }" label="Notes">
          <AppTextarea :id="id" v-model="form.notes" :rows="2" />
        </FormField>
      </div>
    </section>

    <AppCallout v-if="failure" tone="danger">{{ failure }}</AppCallout>

    <div class="flex justify-end gap-2">
      <BaseButton variant="secondary" @click="emit('cancel')">Cancel</BaseButton>
      <BaseButton type="submit" variant="primary" :disabled="!ready || create.isPending.value">
        Add inspector
      </BaseButton>
    </div>
  </form>
</template>
