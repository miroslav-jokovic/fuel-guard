<script setup lang="ts">
import { computed } from "vue";
import {
  AppCheckbox,
  AppCombobox as ComboSelect,
  AppInput as BaseInput,
  AppSelect,
  AppTextarea as BaseTextarea,
  AppTypedDate,
} from "@silvicom/ui";
import { US_JURISDICTION_CODES, jurisdictionOptions, type FactInput } from "@silvicom/shared";
import type { TypedDateKind } from "@silvicom/ui";
import YesNoQuestion from "@/components/YesNoQuestion.vue";
import type { FactChoice } from "./applicantFactRows";

/**
 * The control for one answer on the "Applicant facts" card, chosen by the fact's catalogue `input`
 * (F3, E8; SCREEN-MAP §10: "the same `AppTypedDate`, state list and quick picks as the wizard").
 *
 * ⚠ Never a box holding the stored format. "Correct an answer" offered `2026-04-01` for a date and
 * `IL` for a state, so a recruiter corrected a date by typing ISO and a state by typing its code — the
 * E8 finding. Each kind here takes the answer the way the driver gave it and emits what is stored.
 *
 * `label` names the control for a screen reader; the card prints it above.
 */
const props = defineProps<{
  id: string;
  input: FactInput;
  label: string;
  choices?: readonly FactChoice[];
  error?: string;
  /** A date's own rule: a date of birth is "dob" (an adult's, in the past), anything else "any". */
  dateKind?: TypedDateKind;
  /**
   * An optional question's stored skip ("I'd rather not say"). Ticked, the control is put away and the
   * answer IS the skip's words — the applicant's form does exactly this (`QuestionnaireFields`), so an
   * answer and a skip are never both on file. Unticked, the answer starts empty.
   */
  skip?: FactChoice;
}>();
const model = defineModel<string | boolean | null | readonly string[]>({ required: true });

const JURISDICTIONS = jurisdictionOptions();
const US_STATES = JURISDICTIONS.filter((j) => US_JURISDICTION_CODES.has(j.value));

/** The text a box shows: the stored answer, or nothing for none. */
const text = computed<string>({
  get: () => (model.value === null || typeof model.value === "boolean" || Array.isArray(model.value) ? "" : String(model.value)),
  set: (v) => { model.value = v; },
});
const yesNo = computed<boolean | null>({
  get: () => (typeof model.value === "boolean" ? model.value : null),
  set: (v) => { model.value = v; },
});
const skipped = computed<boolean>({
  get: () => props.skip !== undefined && model.value === props.skip.value,
  set: (on) => { model.value = on && props.skip ? props.skip.value : null; },
});
const NUMERIC = new Set<FactInput>(["count", "miles", "zip", "usdot"]);

/** A multi-choice answer (endorsements): the ticked codes, kept in the choices' own order, as the wizard does. */
const ticked = computed<readonly string[]>(() => (Array.isArray(model.value) ? model.value : []));
function tick(value: string, on: boolean): void {
  const set = new Set(ticked.value);
  if (on) set.add(value);
  else set.delete(value);
  model.value = (props.choices ?? []).map((c) => c.value).filter((v) => set.has(v));
}
</script>

<template>
  <template v-if="!skipped">
  <YesNoQuestion
    v-if="input === 'yesno'"
    :id="id"
    v-model="yesNo"
    :legend="label"
    yes="Yes"
    no="No"
    :error="error"
  />
  <AppTypedDate
    v-else-if="input === 'date' || input === 'month'"
    :id="id"
    v-model="text"
    :kind="input === 'month' ? 'month' : (dateKind ?? 'any')"
    :aria-label="label"
  />
  <ComboSelect
    v-else-if="input === 'us_state' || input === 'jurisdiction'"
    :id="id"
    v-model="text"
    :options="input === 'us_state' ? US_STATES : JURISDICTIONS"
    :aria-label="label"
  />
  <fieldset v-else-if="input === 'multi_choice' && choices" :id="id">
    <legend class="sr-only">{{ label }}</legend>
    <AppCheckbox
      v-for="c in choices"
      :key="c.value"
      :model-value="ticked.includes(c.value)"
      :label="c.label"
      @update:model-value="tick(c.value, $event)"
    />
  </fieldset>
  <AppSelect
    v-else-if="input === 'choice' && choices"
    :id="id"
    v-model="text"
    :options="[...choices]"
    :aria-label="label"
  />
  <BaseTextarea v-else-if="input === 'longtext'" :id="id" v-model="text" rows="3" :aria-label="label" />
  <BaseInput
    v-else
    :id="id"
    v-model="text"
    :type="input === 'email' ? 'email' : 'text'"
    :inputmode="NUMERIC.has(input) ? 'numeric' : input === 'phone' || input === 'us_mobile' ? 'tel' : undefined"
    autocomplete="off"
    :aria-label="label"
  />
  </template>
  <!-- A yes/no names its question in its own legend (the card prints no label above it), so with the
       control put away the question would go too — found in the step 5 browser pass. -->
  <p v-else-if="input === 'yesno'" class="text-sm text-ink-muted" data-fact-skip-question>{{ label }}</p>
  <AppCheckbox v-if="skip" v-model="skipped" :label="skip.label" data-fact-skip />
  <p v-if="error && (input !== 'yesno' || skipped)" class="mt-1 text-xs text-danger-700" :data-fact-problem="props.id">{{ error }}</p>
</template>
