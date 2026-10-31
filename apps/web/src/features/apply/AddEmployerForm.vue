<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { applicationEmployerSchema } from "@silvicom/shared";
import { newEmployerKey } from "@/features/apply/draftShape";
import { APPLY_COPY } from "@/features/apply/strings";
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
 * ── ⚠ APPENDS, BY KEY ───────────────────────────────────────────────────────────────────────
 * The new employer goes at the end of the list with its own `key`. Since §9 P5 (Q-AX7) every edit to
 * an employer names the row by that key, not its position, so the drawer can also REMOVE a job without
 * re-pointing the corrections recorded against its neighbours.
 *
 * ── AND THE STREET (EM-3, §9 P5) ──────────────────────────────────────────────────────────────
 * This form had no street and wrote `address_line1: ""`, which a v2 filing refuses ("Give this
 * employer's street, city and state", `applicationFilingRules.ts`) — so the office's own add made the
 * application unfileable. The street is asked, as the driver's form asks it.
 *
 * ── AND WHY IT COLLECTS THE WHOLE EMPLOYER BEFORE IT SAVES ────────────────────────────────────
 * `applicationDraftPayloadSchema` is `.partial()` at the TOP level only — `employers` may be absent,
 * but any element present must satisfy `applicationEmployerSchema` in full. A blank row saved now and
 * filled in later would be refused by the server, so the form validates with the shared schema before
 * it emits and the recruiter sees the problem beside the field rather than in a toast.
 *
 * ── AND WHY THE TWO (b)(10)(iv) QUESTIONS ARE ASKED, WITH NOTHING CHOSEN (C3c2b, Q-AW33) ─────
 * They were DERIVED — "subject to the FMCSRs" copied from "DOT-regulated employer", "safety-sensitive"
 * from "drove a commercial vehicle" — so the office filed two answers nobody gave, and a v2 filing's
 * rule that refuses a blank could never see it. They are asked here as the driver's panel asks them,
 * and REQUIRED before the row is added, so the job is whole the moment it lands. (Since §9 P5 a blank
 * one could be filled in afterwards — the correction list offers empty cells — but a recruiter with
 * the driver across the desk should not have to come back for it.) Asked of every row, including one
 * from years four to ten that the regulation does not ask about — this form does not know the
 * application's day, and one more answer from a driver sitting across the desk costs nothing.
 */
const props = defineProps<{ pending: boolean }>();
const emit = defineEmits<{ add: [employer: Record<string, unknown>] }>();

const EMPLOYMENT = APPLY_COPY.employment;

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const form = reactive({
  employer_name: "",
  address_line1: "",
  city: "",
  state: "",
  phone: "",
  position_held: "",
  started_on: "",
  ended_on: "",
  operated_cmv: "yes",
  dot_regulated: "yes",
  reason_for_leaving: "",
  subject_to_fmcsr: "",
  safety_sensitive: "",
});

/** A choice not yet made is `null` — unanswered — never a "No". */
const yesNo = (v: string): boolean | null => (v === "" ? null : v === "yes");

/** The contract's own object, with the keys this form does not ask for left empty rather than absent. */
const key = ref(newEmployerKey());

const candidate = computed(() => ({
  // AW1: the new entry's stable reference, so the office can record a phone call against it (D-AW8).
  key: key.value,
  employer_name: form.employer_name.trim(),
  usdot_number: "",
  address_line1: form.address_line1.trim(),
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
  subject_to_fmcsr: yesNo(form.subject_to_fmcsr),
  safety_sensitive: yesNo(form.safety_sensitive),
}));

/** The shared schema, so the browser refuses exactly what the API would refuse. */
const problem = computed(() => {
  const parsed = applicationEmployerSchema.safeParse(candidate.value);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Something here is not right.");
});

/** Both (iv) questions answered — see the header for why this form refuses a blank the schema allows. */
const unanswered = computed(
  () =>
    form.subject_to_fmcsr === "" ||
    form.safety_sensitive === "" ||
    // EM-3: (b)(10)(i) asks for the employer's address, and a v2 filing refuses one without it.
    form.address_line1.trim() === "" ||
    form.city.trim() === "" ||
    form.state.trim() === "",
);

function submit(): void {
  if (problem.value || unanswered.value || props.pending) return;
  emit("add", candidate.value);
  key.value = newEmployerKey();
  Object.assign(form, {
    employer_name: "", address_line1: "", city: "", state: "", phone: "", position_held: "",
    started_on: "", ended_on: "", operated_cmv: "yes", dot_regulated: "yes", reason_for_leaving: "",
    subject_to_fmcsr: "", safety_sensitive: "",
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
      <FormField id="apply-add-employer-street" v-slot="{ id }" label="Street" class="sm:col-span-2">
        <BaseInput :id="id" v-model="form.address_line1" autocomplete="off" />
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
      <!-- The driver's own questions, word for word (`APPLY_COPY`), so what the office asks across the
           desk is what the application asks on the phone. -->
      <FormField id="apply-add-employer-fmcsr" v-slot="{ id }" :label="EMPLOYMENT.subjectToFmcsr">
        <ComboSelect :id="id" v-model="form.subject_to_fmcsr" :options="YES_NO" />
      </FormField>
      <FormField id="apply-add-employer-tested" v-slot="{ id }" :label="EMPLOYMENT.safetySensitive">
        <ComboSelect :id="id" v-model="form.safety_sensitive" :options="YES_NO" />
      </FormField>
    </div>
    <BaseButton size="sm" :disabled="Boolean(problem) || unanswered || pending" @click="submit">
      Add this employer
    </BaseButton>
  </div>
</template>
