<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { AppButton as BaseButton, AppInput as BaseInput, AppFormField as FormField } from "@silvicom/ui";
import { DRIVER_INLINE_EDITABLE, type DriverDetail, type DriverUpdateRequest } from "@silvicom/shared";
import SettingsSection from "@/components/ui/SettingsSection.vue";
import { useUpdateDriverProfile } from "@/composables/useDrivers";
import { useToastStore } from "@/stores/toast";
import { describeDriverEdit } from "@/lib/format";

/**
 * The fields a reader may edit in place, on the record page (D-ROS2, §6 Q4/Q8).
 *
 * ── WHY THESE SIX AND NOT THE WHOLE ROW ─────────────────────────────────────────────────────────
 * `DRIVER_INLINE_EDITABLE` is the boundary, and it is a claim about the SYNCS as much as about the
 * law: no sweep writes any of these, so nothing typed here reverts overnight and no edit claims the
 * row away from telematics. `apps/api`'s `driverFieldOwnership.test.ts` checks that against
 * McLeod's and Samsara's real writers, so a field one of them starts writing fails a build rather
 * than quietly becoming a text box that lies.
 *
 * ── AND WHY THE DANGEROUS ONES ARE NOT HERE ─────────────────────────────────────────────────────
 * Name, phone and status stay in the roster's drawer, which warns before it claims a row and reports
 * what the edit meant afterwards (R6a). **No field is editable in two places.** A second editor for
 * the same field is the duplication D-ROS11 exists to prevent, and it is the reason this section is
 * six fields rather than the six SECTIONS R6's prose imagined.
 *
 * The save still goes through the audited PATCH: "nothing legal turns on it" is a reason not to
 * warn, never a reason not to record.
 */
const props = defineProps<{ driver: DriverDetail | null }>();

const toast = useToastStore();
const save = useUpdateDriverProfile();

/** Labels live here, next to the fields; the LIST lives in shared, where the rule is checkable. */
const LABELS: Record<(typeof DRIVER_INLINE_EDITABLE)[number], string> = {
  phone_alt: "Alternate phone",
  emergency_contact_name: "Emergency contact",
  emergency_contact_phone: "Emergency contact phone",
  emergency_contact_relation: "Relationship",
  eld_id: "ELD id",
};

const form = reactive<Record<string, string>>({});
const resetForm = () => {
  for (const field of DRIVER_INLINE_EDITABLE) {
    form[field] = String((props.driver as Record<string, unknown> | null)?.[field] ?? "");
  }
};
watch(() => props.driver, resetForm, { immediate: true });

const dirty = computed(() =>
  DRIVER_INLINE_EDITABLE.some(
    (f) => form[f] !== String((props.driver as Record<string, unknown> | null)?.[f] ?? ""),
  ),
);

const saving = ref(false);
async function onSave(): Promise<void> {
  if (!props.driver || !dirty.value) return;
  saving.value = true;
  try {
    // Only what CHANGED. Sending the whole set would make every save look like an edit to six fields
    // in the audit log, which is the kind of noise that makes an audit log stop being read.
    const patch: Record<string, string | null> = {};
    for (const field of DRIVER_INLINE_EDITABLE) {
      const before = String((props.driver as Record<string, unknown>)[field] ?? "");
      const typed = form[field] ?? "";
      if (typed !== before) patch[field] = typed.trim() || null;
    }
    const result = await save.mutateAsync({
      id: props.driver.id,
      input: patch as DriverUpdateRequest,
    });
    toast.success("Contact details saved", describeDriverEdit(result) ?? undefined);
  } catch (e) {
    toast.error("Could not save", e instanceof Error ? e.message : undefined);
  }
  saving.value = false;
}
</script>

<template>
  <SettingsSection
    title="Contact & identifiers"
    description="The fields no sync owns — edit them here. Name, phone and status are changed from the roster, which says what such an edit means before you make it."
  >
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField v-for="field in DRIVER_INLINE_EDITABLE" :key="field" v-slot="{ id }" :label="LABELS[field]">
        <BaseInput :id="id" v-model="form[field]" :disabled="!props.driver" />
      </FormField>
    </div>
    <div class="mt-4 flex justify-end">
      <BaseButton variant="primary" :disabled="!dirty || saving" @click="onSave">
        {{ saving ? "Saving…" : "Save" }}
      </BaseButton>
    </div>
  </SettingsSection>
</template>
