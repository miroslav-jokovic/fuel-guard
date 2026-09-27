<script setup lang="ts">
import { computed, ref } from "vue";
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppInput as BaseInput,
  AppDateField,
} from "@silvicom/ui";
import { emptyAccident, emptyViolation, type ApplicationDraft } from "@/features/apply/draft";
import ApplyField from "@/features/apply/ApplyField.vue";
import YesNoField from "@/features/apply/YesNoField.vue";
import { useApplyIssues } from "@/features/apply/issues";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * §391.21(b)(7), (b)(8) and (b)(9) — accidents, convictions, and any denial of a licence.
 *
 * Each list is answered explicitly rather than by emptiness. An empty array and an unanswered question
 * look identical in storage, and the difference is the whole point: a declaration of no accidents is a
 * statement the applicant certified, and a blank form is somebody who stopped reading. The PSP
 * cross-match reads the first as an answer worth comparing against FMCSA's crash file.
 *
 * ── YES/NO GATES FIRST, THE LISTS ONLY ON YES (C3c2c1, §6.4 item 6) ──────────────────────────
 * The "none" answers were checkboxes, and (b)(9)'s was a statement ticked for a YES — so leaving it
 * alone filed "no licence of mine has been denied", the "statement that no such denial … has occurred"
 * the paragraph requires, made for the driver by a default (Q-AW33's defect on another paragraph).
 * Each is now a question with nothing chosen. Storage is unchanged for (b)(7) and (b)(8) —
 * `declares_no_*` is still the "No" — so the gate is derived from the draft: No = declared none, Yes
 * = a list has rows (or Yes was just chosen), otherwise unanswered. (b)(9) holds `null` until answered.
 *
 * ⚠ "No" CLEARS the list it closes (and the denial's description). A checkbox hid the rows and kept
 * them, so a driver who typed an accident and then ticked "none" filed both — an accident beside a
 * certified statement that there was none. A hidden answer that still files is the worse defect than
 * a misclick that has to be retyped.
 */
const draft = defineModel<ApplicationDraft>({ required: true });
const copy = APPLY_COPY.safety;
// The screen's issues, so a cross-field refusal ("List every accident … or confirm there were none")
// lands under the question that answers it.
const { errorFor, idFor } = useApplyIssues();

/** Yes chosen this visit on a list still empty — the one state storage cannot hold. */
const chosenYes = ref({ accidents: false, violations: false });

function gate(list: "accidents" | "violations", none: "declares_no_accidents" | "declares_no_violations") {
  return computed<boolean | null>({
    get: () => (draft.value[none] ? false : draft.value[list].length > 0 || chosenYes.value[list] ? true : null),
    set: (yes) => {
      chosenYes.value[list] = yes === true;
      draft.value[none] = yes === false;
      if (yes === false) draft.value[list] = [];
      else if (draft.value[list].length === 0) {
        // The first one opens with the answer — the driver said there is one.
        if (list === "accidents") draft.value.accidents = [emptyAccident()];
        else draft.value.violations = [emptyViolation()];
      }
    },
  });
}
const hadAccidents = gate("accidents", "declares_no_accidents");
const hadViolations = gate("violations", "declares_no_violations");

const everDenied = computed<boolean | null>({
  get: () => draft.value.licence_ever_denied,
  set: (yes) => {
    draft.value.licence_ever_denied = yes;
    if (yes === false) draft.value.licence_denial_detail = "";
  },
});
</script>

<template>
  <section class="space-y-6">
    <p class="text-sm text-ink-muted">{{ copy.intro }}</p>

    <div class="space-y-3">
      <h3 class="text-sm font-semibold text-ink">{{ copy.accidentsHeading }}</h3>
      <YesNoField
        :id="idFor(['accidents'])"
        v-model="hadAccidents"
        :legend="copy.accidentsQuestion"
        :error="errorFor(['accidents'])"
      />

      <template v-if="hadAccidents">
        <div
          v-for="(accident, i) in draft.accidents"
          :key="i"
          class="space-y-4 rounded-surface bg-surface-muted p-4"
        >
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ApplyField v-slot="f" :path="['accidents', i, 'occurred_on']" :label="copy.accidentDate">
              <AppDateField v-bind="f" v-model="accident.occurred_on" />
            </ApplyField>
            <ApplyField v-slot="f" :path="['accidents', i, 'nature']" :label="copy.accidentNature">
              <BaseInput v-bind="f" v-model="accident.nature" />
            </ApplyField>
          </div>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ApplyField v-slot="f" :path="['accidents', i, 'fatalities']" :label="copy.fatalities">
              <BaseInput v-bind="f" v-model="accident.fatalities" inputmode="numeric" />
            </ApplyField>
            <ApplyField v-slot="f" :path="['accidents', i, 'injuries']" :label="copy.injuries">
              <BaseInput v-bind="f" v-model="accident.injuries" inputmode="numeric" />
            </ApplyField>
          </div>
          <BaseCheckbox v-model="accident.hazmat_spill" size="touch">{{ copy.hazmatSpill }}</BaseCheckbox>
          <div class="flex justify-end">
            <BaseButton variant="ghost" size="touch" @click="draft.accidents.splice(i, 1)">{{ copy.remove }}</BaseButton>
          </div>
        </div>
        <BaseButton size="touch" @click="draft.accidents.push(emptyAccident())">{{ copy.addAccident }}</BaseButton>
      </template>
    </div>

    <div class="space-y-3">
      <h3 class="text-sm font-semibold text-ink">{{ copy.violationsHeading }}</h3>
      <YesNoField
        :id="idFor(['violations'])"
        v-model="hadViolations"
        :legend="copy.violationsQuestion"
        :hint="copy.violationsQuestionHint"
        :error="errorFor(['violations'])"
      />

      <template v-if="hadViolations">
        <div
          v-for="(violation, i) in draft.violations"
          :key="i"
          class="space-y-4 rounded-surface bg-surface-muted p-4"
        >
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ApplyField v-slot="f" :path="['violations', i, 'occurred_on']" :label="copy.violationDate">
              <AppDateField v-bind="f" v-model="violation.occurred_on" />
            </ApplyField>
            <ApplyField v-slot="f" :path="['violations', i, 'offence']" :label="copy.offence">
              <BaseInput v-bind="f" v-model="violation.offence" />
            </ApplyField>
          </div>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ApplyField v-slot="f" :path="['violations', i, 'state']" :label="copy.violationState" :hint="copy.violationStateHint">
              <BaseInput v-bind="f" v-model="violation.state" placeholder="Optional" />
            </ApplyField>
            <ApplyField v-slot="f" :path="['violations', i, 'penalty']" :label="copy.penalty" :hint="copy.penaltyHint">
              <BaseInput v-bind="f" v-model="violation.penalty" placeholder="Optional" />
            </ApplyField>
          </div>
          <div class="flex justify-end">
            <BaseButton variant="ghost" size="touch" @click="draft.violations.splice(i, 1)">{{ copy.remove }}</BaseButton>
          </div>
        </div>
        <BaseButton size="touch" @click="draft.violations.push(emptyViolation())">{{ copy.addViolation }}</BaseButton>
      </template>
    </div>

    <div class="space-y-3">
      <h3 class="text-sm font-semibold text-ink">{{ copy.licenceHeading }}</h3>
      <YesNoField
        :id="idFor(['licence_ever_denied'])"
        v-model="everDenied"
        :legend="copy.deniedQuestion"
        :error="errorFor(['licence_ever_denied'])"
      />
      <ApplyField
        v-if="everDenied"
        v-slot="f"
        :path="['licence_denial_detail']"
        :label="copy.denialDetail"
        :hint="copy.denialDetailHint"
      >
        <BaseInput v-bind="f" v-model="draft.licence_denial_detail" />
      </ApplyField>
    </div>

    <!-- §40.25(j) (P8). The carrier's packet gives this a page of its own; here it is the last block
         of the driving-record screen, because a wizard step exists per REGULATION-shaped group of
         answers and an eighth screen for one checkbox is a step somebody abandons on. The intro says
         what a yes means before the box is offered — see the copy's own note.
         ⚠ On a v2 link Part 1 asked it (D-AW13) and filing lays that answer over this one
         (`composeFiledApplication`), so this box is dead there. Not removed in C3c2c1: without it the
         review would print the draft's untouched "No" beside a Part 1 answer it cannot read — the
         read path §11's Q-AW34 asks for fixes both, in C3c2c2. -->
    <div class="space-y-3">
      <h3 class="text-sm font-semibold text-ink">{{ copy.priorTestHeading }}</h3>
      <p class="text-sm text-ink-muted">{{ copy.priorTestIntro }}</p>
      <BaseCheckbox v-model="draft.prior_failed_pre_employment_test" size="touch">{{ copy.priorTest }}</BaseCheckbox>
      <p class="text-xs text-ink-muted">{{ copy.priorTestHint }}</p>
    </div>
  </section>
</template>
