<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  AppCombobox as ComboSelect,
  AppDateField,
  AppFormField as FormField,
  AppInput as BaseInput,
} from "@silvicom/ui";
import { jurisdictionOptions } from "@silvicom/shared";
import YesNoQuestion from "@/components/YesNoQuestion.vue";
import { inLastThreeYears, type EmployerFields } from "./employerRow";
import type { EmploymentFormCopy } from "./employmentCopy";

/**
 * The ONE employer form (HW5b, HIRING-WORKFLOW-AUDIT-2026-10-31 §4.5, EM-3/EM-5/EM-10).
 *
 * ── WHY ONE ───────────────────────────────────────────────────────────────────────────────────
 * There were three — `EmployerDrawer` (applicant), `AddEmployerForm` (office, before filing) and
 * `EmploymentForm` (office, after filing) — with different fields and different defaults: the office's
 * add had no street (EM-3) and made the application unfileable; the post-filing form started
 * "drove a truck" at No where the applicant's started at Yes, had no street, no email and neither
 * (iv) answer (EM-5), and let the office TYPE an inquiry status the inquiry module derives (EM-6).
 * Every surface now renders this body; each keeps its own save path, its own words (`copy`) and its
 * own judgement of what is missing (`errors`).
 *
 * ── THE SHAPE NEVER CHANGES BEHIND THE CURSOR (EM-10) ────────────────────────────────────────
 *   · "Was this employer regulated by the DOT?" is ASKED, in the main run. It decides whether the
 *     carrier owes a §391.23 inquiry, and it was behind "More about this job (optional)".
 *   · The two §391.21(b)(10)(iv) questions appear when the dates put the job in the three years before
 *     `asOf` — the filing's own test, `employmentSegments` — and STAY once they have appeared or been
 *     answered, so a date typed below them never makes the questions the person was answering vanish.
 *     ⚠ They are asked of every three-year job, not only a DOT-regulated one, though §4.5 says "only
 *     when DOT-regulated": `applicationV2FilingIssues` refuses a blank (iv) on ANY three-year job, and
 *     hiding a question the filing then refuses would be a form that cannot be finished. Narrowing it
 *     is a filing-rule change, recorded in the HW5b PR, not a form change.
 *   · Only phone, email and USDOT number sit behind the disclosure — the three answers no filing rule
 *     asks for. It opens by itself when one of them holds something, so a blank is never hidden from
 *     the office that wants to fill it.
 *
 * Every control's id is `${idPrefix}-${field}`. The applicant passes `apply-employers-<i>`, which is
 * the id `fieldId` gives the same path, so the page's refusal list and focus land on these boxes.
 */
const props = withDefaults(
  defineProps<{
    copy: EmploymentFormCopy;
    idPrefix: string;
    /** The day the three years end — the application's, or the hire date after filing. */
    asOf: string;
    /** Field → the sentence to show under it. The surface decides what is wrong; the form shows it. */
    errors?: Partial<Record<string, string>>;
    /** The applicant's link: 44 px targets (§6.8). */
    touch?: boolean;
  }>(),
  { errors: () => ({}), touch: false },
);
const local = defineModel<EmployerFields>({ required: true });

const JURISDICTIONS = jurisdictionOptions();
const id = (field: string): string => `${props.idPrefix}-${field}`;
const err = (field: string): string | undefined => props.errors[field];

/** Seen once, kept: see the header. Reset only when the form is given a different job. */
const ivShown = ref(false);
watch(
  () => [
    local.value.key,
    inLastThreeYears(local.value, props.asOf),
    local.value.subject_to_fmcsr,
    local.value.safety_sensitive,
  ] as const,
  ([key, recent, a, b], before) => {
    if (before && before[0] !== key) ivShown.value = false;
    if (recent || a !== null || b !== null) ivShown.value = true;
  },
  { immediate: true },
);

const extrasHaveSomething = computed(
  () => [local.value.phone, local.value.email, local.value.usdot_number].some((v) => v.trim() !== ""),
);
const extrasOpen = computed(
  () => extrasHaveSomething.value || ["phone", "email", "usdot_number"].some((f) => err(f)),
);

/** `boolean` fields through the yes/no control, which speaks `boolean | null`. */
const droveTruck = computed<boolean | null>({
  get: () => local.value.operated_cmv,
  set: (v) => { local.value = { ...local.value, operated_cmv: v === true }; },
});
const dotRegulated = computed<boolean | null>({
  get: () => local.value.dot_regulated,
  set: (v) => { local.value = { ...local.value, dot_regulated: v === true }; },
});
const size = computed(() => (props.touch ? "touch" : "default"));
</script>

<template>
  <div class="space-y-4" data-testid="employer-form">
    <FormField v-slot="f" :id="id('employer_name')" :label="copy.employer" :hint="copy.employerHint" :error="err('employer_name')">
      <BaseInput v-bind="f" v-model="local.employer_name" autocomplete="off" />
    </FormField>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField v-slot="f" :id="id('started_on')" :label="copy.from" :error="err('started_on')">
        <AppDateField v-bind="f" v-model="local.started_on" />
      </FormField>
      <FormField v-slot="f" :id="id('ended_on')" :label="copy.to" :hint="copy.toHint" :error="err('ended_on')">
        <AppDateField v-bind="f" v-model="local.ended_on" />
      </FormField>
    </div>

    <FormField v-slot="f" :id="id('position_held')" :label="copy.position" :error="err('position_held')">
      <BaseInput v-bind="f" v-model="local.position_held" autocomplete="off" />
    </FormField>

    <!-- EM-3: the street, on every surface. A filing refuses a job without it. -->
    <FormField v-slot="f" :id="id('address_line1')" :label="copy.address" :hint="copy.addressHint" :error="err('address_line1')">
      <BaseInput v-bind="f" v-model="local.address_line1" autocomplete="off" />
    </FormField>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField v-slot="f" :id="id('city')" :label="copy.city" :error="err('city')">
        <BaseInput v-bind="f" v-model="local.city" autocomplete="off" />
      </FormField>
      <FormField v-slot="f" :id="id('state')" :label="copy.state" :error="err('state')">
        <ComboSelect v-bind="f" v-model="local.state" :options="JURISDICTIONS" />
      </FormField>
    </div>

    <FormField v-slot="f" :id="id('reason_for_leaving')" :label="copy.reason" :hint="copy.reasonHint" :error="err('reason_for_leaving')">
      <BaseInput v-bind="f" v-model="local.reason_for_leaving" autocomplete="off" />
    </FormField>

    <YesNoQuestion
      :id="id('operated_cmv')"
      v-model="droveTruck"
      :legend="copy.droveTruck"
      :hint="copy.droveTruckHint"
      :error="err('operated_cmv')"
      :yes="copy.yes"
      :no="copy.no"
      :size="size"
    />
    <YesNoQuestion
      :id="id('dot_regulated')"
      v-model="dotRegulated"
      :legend="copy.dotQuestion"
      :hint="copy.dotQuestionHint"
      :error="err('dot_regulated')"
      :yes="copy.yes"
      :no="copy.no"
      :size="size"
    />

    <template v-if="ivShown">
      <YesNoQuestion
        :id="id('subject_to_fmcsr')"
        v-model="local.subject_to_fmcsr"
        :legend="copy.subjectToFmcsr"
        :hint="copy.subjectToFmcsrHint"
        :error="err('subject_to_fmcsr')"
        :yes="copy.yes"
        :no="copy.no"
        :size="size"
      />
      <YesNoQuestion
        :id="id('safety_sensitive')"
        v-model="local.safety_sensitive"
        :legend="copy.safetySensitive"
        :hint="copy.safetySensitiveHint"
        :error="err('safety_sensitive')"
        :yes="copy.yes"
        :no="copy.no"
        :size="size"
      />
    </template>

    <!-- `<details>` is this product's disclosure (`VerdictDetails.vue` is the precedent). -->
    <details class="rounded-surface bg-surface-muted p-4" :open="extrasOpen">
      <summary class="cursor-pointer py-3 text-sm font-medium text-ink">{{ copy.moreAboutJob }}</summary>
      <p class="mt-1 text-xs text-ink-muted">{{ copy.moreAboutJobHint }}</p>
      <div class="mt-4 space-y-4">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="f" :id="id('phone')" :label="copy.phone" :hint="copy.phoneHint" :error="err('phone')">
            <BaseInput v-bind="f" v-model="local.phone" type="tel" />
          </FormField>
          <FormField v-slot="f" :id="id('email')" :label="copy.email" :hint="copy.emailHint" :error="err('email')">
            <BaseInput v-bind="f" v-model="local.email" type="email" />
          </FormField>
        </div>
        <FormField v-slot="f" :id="id('usdot_number')" :label="copy.usdot" :hint="copy.usdotHint" :error="err('usdot_number')">
          <BaseInput v-bind="f" v-model="local.usdot_number" inputmode="numeric" />
        </FormField>
      </div>
    </details>
  </div>
</template>
