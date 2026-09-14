<script setup lang="ts">
import { computed, reactive } from "vue";
import { applicationEmployerSchema } from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppInput as BaseInput,
  AppCombobox as ComboSelect,
  AppDateField,
  AppFormField as FormField,
} from "@silvicom/ui";

/**
 * The employer the driver forgot, added by the office while the driver is sitting there (2026-09-14).
 *
 * ── WHY THIS EXISTS AT ALL, WHEN `editableFields` DELIBERATELY REFUSES TO CREATE ──────────────
 * `editableFields.ts` offers only paths the payload already carries, and argues that creating one
 * would be "an invention" — right, for a field nobody is looking at. The owner's account of what an
 * office visit is actually for: *"the only critical part is previous companies he has worked and they
 * usually don't remember companies or dates, so we can go together and update this."* A driver across
 * the desk naming a job is not an invention; it is the driver telling you, and §391.21(b)(10) and
 * (b)(11) require the list in full. So creating a ROW is offered here, explicitly and separately,
 * while creating a FIELD stays refused.
 *
 * ── ⚠ APPENDS. NEVER INSERTS, NEVER REMOVES ──────────────────────────────────────────────────
 * The new employer goes at the end of the list, and there is no delete. Both follow from
 * `application_edits` storing a contract PATH: `["employers", 2, "city"]` names a row by its index,
 * so inserting or removing one silently re-points every correction already recorded against the rows
 * after it. Appending is the only mutation that cannot do that. A duplicate or wrong employer is
 * corrected field by field in the list above; removing one is Q-AX7 and needs a way to mark a row
 * dead rather than move its neighbours.
 *
 * ── AND WHY IT COLLECTS THE WHOLE EMPLOYER BEFORE IT SAVES ────────────────────────────────────
 * `applicationDraftPayloadSchema` is `.partial()` at the TOP level only — `employers` may be absent,
 * but any element present must satisfy `applicationEmployerSchema` in full. A blank row saved now and
 * filled in later would be refused by the server, so the form validates with the shared schema before
 * it emits and the recruiter sees the problem beside the field rather than in a toast.
 */
const props = defineProps<{ nextIndex: number; pending: boolean }>();
const emit = defineEmits<{ add: [path: (string | number)[], value: Record<string, unknown>] }>();

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const form = reactive({
  employer_name: "",
  city: "",
  state: "",
  phone: "",
  position_held: "",
  started_on: "",
  ended_on: "",
  operated_cmv: "yes",
  dot_regulated: "yes",
  reason_for_leaving: "",
});

/** The contract's own object, with the keys this form does not ask for left empty rather than absent. */
const candidate = computed(() => ({
  employer_name: form.employer_name.trim(),
  usdot_number: "",
  address_line1: "",
  city: form.city.trim(),
  state: form.state.trim(),
  phone: form.phone.trim(),
  email: "",
  position_held: form.position_held.trim(),
  started_on: form.started_on,
  ended_on: form.ended_on,
  operated_cmv: form.operated_cmv === "yes",
  dot_regulated: form.dot_regulated === "yes",
  reason_for_leaving: form.reason_for_leaving.trim(),
  subject_to_fmcsr: form.dot_regulated === "yes",
  safety_sensitive: form.operated_cmv === "yes",
}));

/** The shared schema, so the browser refuses exactly what the API would refuse. */
const problem = computed(() => {
  const parsed = applicationEmployerSchema.safeParse(candidate.value);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Something here is not right.");
});

function submit(): void {
  if (problem.value || props.pending) return;
  emit("add", ["employers", props.nextIndex], candidate.value);
  Object.assign(form, {
    employer_name: "", city: "", state: "", phone: "", position_held: "",
    started_on: "", ended_on: "", operated_cmv: "yes", dot_regulated: "yes", reason_for_leaving: "",
  });
}
</script>

<template>
  <div class="space-y-3 rounded-surface border border-edge bg-surface-muted p-3">
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FormField
        id="apply-add-employer-name"
        v-slot="{ id }"
        label="Employer"
        :error="form.employer_name.trim() !== '' ? (problem ?? undefined) : undefined"
      >
        <BaseInput :id="id" v-model="form.employer_name" autocomplete="off" />
      </FormField>
      <FormField id="apply-add-employer-position" v-slot="{ id }" label="Position held">
        <BaseInput :id="id" v-model="form.position_held" autocomplete="off" />
      </FormField>
      <FormField id="apply-add-employer-city" v-slot="{ id }" label="City">
        <BaseInput :id="id" v-model="form.city" autocomplete="off" />
      </FormField>
      <FormField id="apply-add-employer-state" v-slot="{ id }" label="State">
        <BaseInput :id="id" v-model="form.state" autocomplete="off" />
      </FormField>
      <FormField id="apply-add-employer-from" v-slot="{ id }" label="From">
        <AppDateField :id="id" v-model="form.started_on" />
      </FormField>
      <FormField id="apply-add-employer-to" v-slot="{ id }" label="To" hint="Leave blank if they still work there.">
        <AppDateField :id="id" v-model="form.ended_on" />
      </FormField>
      <FormField id="apply-add-employer-phone" v-slot="{ id }" label="Phone">
        <BaseInput :id="id" v-model="form.phone" autocomplete="off" />
      </FormField>
      <FormField id="apply-add-employer-cmv" v-slot="{ id }" label="Drove a commercial vehicle">
        <ComboSelect :id="id" v-model="form.operated_cmv" :options="YES_NO" />
      </FormField>
      <FormField id="apply-add-employer-dot" v-slot="{ id }" label="DOT-regulated employer">
        <ComboSelect :id="id" v-model="form.dot_regulated" :options="YES_NO" />
      </FormField>
      <FormField id="apply-add-employer-reason" v-slot="{ id }" label="Reason for leaving">
        <BaseInput :id="id" v-model="form.reason_for_leaving" autocomplete="off" />
      </FormField>
    </div>
    <BaseButton size="sm" :disabled="Boolean(problem) || pending" @click="submit">
      Add this employer
    </BaseButton>
  </div>
</template>
