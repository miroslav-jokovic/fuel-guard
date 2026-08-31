<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  driverInputSchema,
  wouldClaimFromTelematics,
  DRIVER_STATUSES,
  type Driver,
  type DriverInput,
} from "@silvicom/shared";
import { AppSelect } from "@silvicom/ui";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppFormField as FormField } from "@silvicom/ui";

const props = defineProps<{
  driver?: Driver | null;
  submitting?: boolean;
}>();
const emit = defineEmits<{ submit: [input: DriverInput]; cancel: [] }>();

const form = reactive({
  full_name: props.driver?.full_name ?? "",
  employee_id: props.driver?.employee_id ?? "",
  phone: props.driver?.phone ?? "",
  status: props.driver?.status ?? "active",
  samsara_driver_id: props.driver?.samsara_driver_id ?? "",
});

const errors = ref<Record<string, string>>({});

/**
 * What the reader is about to change — and therefore what this edit will MEAN (D-ROS4, R6a).
 *
 * ── WHY THIS WARNS BEFORE SAVE RATHER THAN REPORTING AFTER ──────────────────────────────────────
 * On a row telematics owns — 282 of 287 live drivers on 2026-08-31 — editing a name or a phone
 * claims the driver away from the sync PERMANENTLY. That is the decision D-ROS1 is built on, and it
 * is not recoverable by editing the field back: the row stays `manual` and stops being enriched.
 * Somebody fixing a spelling deserves to know that before they do it, not in a toast afterwards.
 *
 * `wouldClaimFromTelematics` is `@silvicom/shared`'s, and so is the identity-field list the server
 * uses — a second copy here would drift and the warning would stop matching what the save does.
 */
const changedFields = computed(() =>
  (["full_name", "employee_id", "phone", "status"] as const).filter(
    (f) => String(form[f] ?? "") !== String(props.driver?.[f] ?? ""),
  ),
);
const claimsFromTelematics = computed(
  () => Boolean(props.driver) && wouldClaimFromTelematics(changedFields.value, props.driver?.identity_source),
);

function onSubmit() {
  const result = driverInputSchema.safeParse({ ...form });
  if (!result.success) {
    const map: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !map[key]) map[key] = issue.message;
    }
    errors.value = map;
    return;
  }
  errors.value = {};
  emit("submit", result.data);
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="onSubmit">
    <!-- Stated where the eye already is, above Save, and only when it is actually true of THIS edit.
         A permanent warning on every synced driver would be wallpaper. -->
    <p
      v-if="claimsFromTelematics"
      class="rounded-control bg-warning-50 px-3 py-2 text-sm text-warning-700 ring-1 ring-inset ring-warning-600/20"
    >
      Saving this claims {{ props.driver?.full_name }} from the
      {{ props.driver?.identity_source }} sync. Their name and phone stop updating from it, and that
      does not undo if you change the field back.
    </p>
    <FormField v-slot="{ id }" label="Full name" :error="errors.full_name">
      <BaseInput :id="id" v-model="form.full_name" :invalid="!!errors.full_name" />
    </FormField>
    <div class="grid grid-cols-2 gap-3">
      <FormField v-slot="{ id }" label="Employee ID">
        <BaseInput :id="id" v-model="form.employee_id" />
      </FormField>
      <FormField v-slot="{ id }" label="Phone">
        <BaseInput :id="id" v-model="form.phone" />
      </FormField>
    </div>
    <FormField label="Status">
      <AppSelect
        v-model="form.status"
        :options="DRIVER_STATUSES.map((s) => ({ value: s, label: s }))"
      />
    </FormField>

    <div class="flex justify-end gap-3 pt-2">
      <BaseButton @click="emit('cancel')">Cancel</BaseButton>
      <BaseButton type="submit" variant="primary" :disabled="submitting">
        {{ submitting ? "Saving…" : "Save driver" }}
      </BaseButton>
    </div>
  </form>
</template>
