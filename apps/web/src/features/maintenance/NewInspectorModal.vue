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
import BaseModal from "@/components/ui/BaseModal.vue";
import { useCreateInspector } from "@/features/maintenance/useAnnualInspections";

/**
 * Adding somebody to the inspector register.
 *
 * The two qualification questions are the two the federal standard actually asks — how this person
 * qualifies, and whether that extends to brakes, which is thirteen of the fifty-six parts on the
 * form. They are recorded because the printed report asserts them; nothing here is decoration.
 * (§396.19(b) and §396.25 — in a comment, per D-AVI15.)
 */

const emit = defineEmits<{ close: []; created: [] }>();
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

async function submit() {
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
  <BaseModal :open="true" title="Add inspector" @close="emit('close')">
    <div class="space-y-4">
      <FormField v-slot="{ id }" label="Full name">
        <BaseInput :id="id" v-model="form.fullName" placeholder="As it should print on the report" />
      </FormField>

      <FormField
        v-slot="{ id }"
        label="Qualified by"
        hint="How this person meets the federal standard for performing an annual inspection."
      >
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

      <FormField v-slot="{ id }" label="Address" hint="Only needed when the inspection is done by an outside shop.">
        <BaseInput :id="id" v-model="form.address" />
      </FormField>

      <FormField v-slot="{ id }" label="Notes">
        <AppTextarea :id="id" v-model="form.notes" :rows="2" />
      </FormField>

      <AppCallout v-if="failure" tone="danger">{{ failure }}</AppCallout>
    </div>

    <template #footer>
      <BaseButton variant="secondary" @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!ready || create.isPending.value" @click="submit">
        Add inspector
      </BaseButton>
    </template>
  </BaseModal>
</template>
