<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  AppButton as BaseButton,
  AppCheckbox,
  AppCombobox as ComboSelect,
  AppDateField,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppTextarea,
} from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { useCreateInspector } from "@/features/maintenance/useAnnualInspections";

/**
 * Adding somebody to the inspector register.
 *
 * ── IT OWNS ITS DRAWER, AND THE ACTIONS ARE IN THE FOOTER ──────────────────────────────────────
 * It used to be a bare form the page wrapped in a `SlideOver`, with its Cancel/Add row as the last
 * element of the body. `apps/web/CLAUDE.md` says `SlideOver` (actions in `#footer`) and the contract
 * §6.2 says the same, for a reason this form makes visible: the body scrolls, so a submit button
 * living at the bottom of it scrolls away under the qualification section, and the reader has to
 * find their way back to a control that was never meant to move. Owning the drawer is what lets the
 * footer be pinned — the shape `RequirementDrawer`, `HireDrawer` and `InquiryResponseDrawer` use.
 *
 * The two qualification questions are the two the federal standard actually asks: how this person
 * qualifies, and whether that extends to brakes — which is thirteen of the fifty-six parts on the
 * form. They are recorded because the printed report asserts them, and the product derives that
 * assertion from this row rather than from a tick box. Nothing here is decoration.
 * (§396.19(b) and §396.25 — in a comment, per D-AVI15.)
 */

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ created: []; close: [] }>();

const toast = useToastStore();
const create = useCreateInspector();

const BLANK = () => ({
  fullName: "",
  address: "",
  qualificationBasis: "training_and_experience" as "state_federal_program" | "training_and_experience",
  brakeQualified: true,
  effectiveFrom: new Date().toISOString().slice(0, 10),
  notes: "",
});

const form = reactive(BLANK());
/** A drawer that reopens carrying the last attempt's answers is a drawer that files them twice. */
watch(
  () => props.open,
  (open) => {
    if (open) Object.assign(form, BLANK());
  },
);

const ready = computed(() => form.fullName.trim().length > 0 && Boolean(form.effectiveFrom));
const saving = ref(false);

async function save() {
  if (!ready.value || saving.value) return;
  saving.value = true;
  try {
    await create.mutateAsync({
      fullName: form.fullName.trim(),
      address: form.address.trim() || null,
      qualificationBasis: form.qualificationBasis,
      brakeQualified: form.brakeQualified,
      effectiveFrom: form.effectiveFrom,
      notes: form.notes.trim() || null,
    });
    toast.success("Inspector added");
    emit("created");
  } catch (e) {
    toast.error("Could not add the inspector", e instanceof Error ? e.message : undefined);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <SlideOver :open="open" size="lg" title="Add inspector" @close="emit('close')">
    <form id="inspector-form" class="space-y-6" @submit.prevent="save">
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
          <!-- `ComboSelect` and not `AppSelect`, even for two closed options: `apps/web/CLAUDE.md`
               draws the line at the SURFACE, not the list length — `FilterSelect` in toolbars,
               `ComboSelect` in forms. `AppSelect` is a bare native `<select>`, so its panel is drawn
               by the operating system: different type, different metrics, different focus ring, and
               on this drawer it sat directly beside a tokened one. -->
          <FormField v-slot="{ id }" label="Qualified by">
            <ComboSelect
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
    </form>

    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="saving" @click="emit('close')">Cancel</BaseButton>
        <BaseButton form="inspector-form" type="submit" variant="primary" :disabled="saving || !ready">
          {{ saving ? "Adding…" : "Add inspector" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
