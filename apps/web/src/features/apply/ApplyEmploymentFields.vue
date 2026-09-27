<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppCombobox as ComboSelect,
  AppInput as BaseInput,
  AppMonthField,
  AppTextarea as BaseTextarea,
} from "@silvicom/ui";
import {
  EQUIPMENT_CLASSES,
  EQUIPMENT_CLASS_LABELS,
  applicationEmploymentGaps,
  type ApplicationEmployer,
} from "@silvicom/shared";
import ApplyField from "@/features/apply/ApplyField.vue";
import EmployerDrawer from "@/features/apply/EmployerDrawer.vue";
import QuestionnaireFields from "@/features/apply/QuestionnaireFields.vue";
import {
  emptyEmployer,
  emptyEquipment,
  toApplication,
  type DraftEmployer,
  type ApplicationDraft,
} from "@/features/apply/draft";
import {
  EMPLOYMENT_WINDOW_YEARS,
  employmentProgress,
  monthName,
  reconcileGapExplanations,
} from "@/features/apply/employmentProgress";
import { showDate } from "@/features/apply/reviewSummary";
import { APPLY_COPY } from "@/features/apply/strings";

/** The classes §391.21(b)(6) and FMCSA's own form name, in the order that form lists them. */
const EQUIPMENT_OPTIONS = EQUIPMENT_CLASSES.map((value) => ({ value, label: EQUIPMENT_CLASS_LABELS[value] }));

/**
 * §391.21(b)(10) and (b)(11) — the hub (X5, D-AX2).
 *
 * ── WHAT THIS SCREEN USED TO BE ───────────────────────────────────────────────────────────────
 * Fifteen controls per employer, five per equipment row, and two of its own, all at once. A
 * six-employer ten-year history is **107 controls on one screen** — and six employers over ten years
 * is ordinary in this industry, not a tail case. `ApplyPage`'s own docstring promises "one
 * §391.21(b) paragraph at a time" and this is where the promise was not kept, on the screen that
 * carries most of the work in the whole form.
 *
 * It is now a list of the jobs with a panel per job (`EmployerDrawer`), which is the shape a phone
 * can hold: what is on screen at any moment is either a short list or one job.
 *
 * ── AND WHY IT SHOWS THE DRIVER THEIR OWN COVERAGE ────────────────────────────────────────────
 * The regulation asks two different questions over two different windows and the form already
 * computes that boundary rather than asking the driver to remember it. The meter is the other half
 * of the same idea: a recruiter is going to chase a hole in the last three years, and the cheapest
 * moment to fill it is while the driver is still holding the form.
 *
 * ⚠ The arithmetic is `employmentCoverage`'s, in `packages/shared` — including the part that is easy
 * to get wrong, which is that a hole in years four to ten is NOT a defect. See
 * `employmentProgress.ts`.
 */
const props = defineProps<{
  /**
   * The date the windows end: the application's day on the CARRIER's clock, served by the bundle
   * (`carrierToday`, C3c1) — the same day filing judges against, so the gaps here are the gaps it asks
   * about. It was `new Date().toISOString()`, the UTC day, which after 19:00 Central is tomorrow.
   */
  asOf: string;
}>();
const draft = defineModel<ApplicationDraft>({ required: true });
const copy = APPLY_COPY.employment;

const editing = ref<number | null>(null);
const openDrawer = computed(() => editing.value !== null);

const progress = computed(() => employmentProgress(draft.value.employers, props.asOf));

/**
 * The gaps to explain (C3c1, AW1): exactly the list a v2 filing refuses on, from the employers as they
 * would be FILED (`toApplication`), through the one shared function — so no box can name a gap the
 * filing does not, and none the filing asks about is missing. Shown once the driver has a job on the
 * list or has said they had none; before either, the meter's empty state asks for the jobs first.
 */
const gaps = computed(() => {
  const filed = (toApplication(draft.value) as { employers: ApplicationEmployer[] }).employers;
  if (filed.length === 0 && !draft.value.declares_no_employment) return [];
  return applicationEmploymentGaps(filed, props.asOf);
});

/**
 * One explanation per gap, kept in step with the gaps. Re-keyed whenever they move — a job's dates
 * changed — so the words follow their gap and a gap that closed takes its words with it. Written only
 * when something changed, so opening the screen does not dirty an untouched draft.
 */
watch(
  () => gaps.value.map((g) => `${g.from}/${g.to}`).join(","),
  () => {
    const next = reconcileGapExplanations(draft.value.employment_gaps, gaps.value);
    if (JSON.stringify(next) !== JSON.stringify(draft.value.employment_gaps)) draft.value.employment_gaps = next;
  },
  { immediate: true },
);
const explanationFor = (from: string) => draft.value.employment_gaps.find((g) => g.from === from);

/** Rows worth listing. A blank row from an accidental "Add" is not a job the driver declared. */
const jobs = computed(() =>
  draft.value.employers
    .map((employer, index) => ({ employer, index }))
    .filter((row) => row.employer.employer_name.trim() !== "" || row.index === editing.value),
);

const period = (e: DraftEmployer): string => {
  if (!e.started_on) return copy.jobNoDates;
  return `${showDate(e.started_on)} — ${e.ended_on.trim() === "" ? copy.jobToNow : showDate(e.ended_on)}`;
};

function addJob(): void {
  draft.value.employers = [...draft.value.employers, emptyEmployer()];
  editing.value = draft.value.employers.length - 1;
}

function saveJob(employer: DraftEmployer): void {
  const at = editing.value;
  if (at === null) return;
  draft.value.employers = draft.value.employers.map((row, i) => (i === at ? employer : row));
  editing.value = null;
}

/**
 * Closing without saving.
 *
 * ⚠ A row that was added by `addJob` and never saved is REMOVED here. Leaving it would put a blank
 * card on the list that the driver did not create and cannot name, and — worse — `toApplication`
 * drops unnamed rows silently, so the count on the review screen would disagree with the list they
 * were looking at.
 */
function closeDrawer(): void {
  const at = editing.value;
  if (at !== null && draft.value.employers[at]?.employer_name.trim() === "") {
    draft.value.employers = draft.value.employers.filter((_, i) => i !== at);
  }
  editing.value = null;
}

const removeJob = (index: number): void => {
  draft.value.employers = draft.value.employers.filter((_, i) => i !== index);
};
</script>

<template>
  <section class="space-y-5">
    <p class="text-sm text-ink-muted">{{ copy.intro }}</p>

    <!-- D-AX7. The carrier's paper asks this on page 1; it is asked here, above the list, because a
         driver cannot picture who is being asked about until they have named them. -->
    <QuestionnaireFields v-model="draft" section="employment" />

    <BaseCheckbox v-model="draft.declares_no_employment">{{ copy.none }}</BaseCheckbox>

    <template v-if="!draft.declares_no_employment">
      <div class="space-y-3">
        <h3 class="text-sm font-semibold text-ink">{{ copy.jobsHeading }}</h3>

        <ul v-if="jobs.length" class="space-y-2">
          <!-- ⚠ Wraps rather than truncates, and carries ONE action. Measured at 390px: the meta
               line read "Driver · 02/01/2025…" with the dates cut off, because two buttons and a
               label were competing for 350px — so the list hid exactly the fact a driver checks it
               for. Removing a job also moved into the panel: `Remove` sat a thumb's width from
               `Change`, and the two are not equally undoable. -->
          <li
            v-for="row in jobs"
            :key="row.index"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-surface bg-surface-muted p-3"
          >
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-ink">{{ row.employer.employer_name }}</p>
              <p class="text-xs text-ink-muted">
                {{ [row.employer.position_held, period(row.employer)].filter(Boolean).join(" · ") }}
              </p>
            </div>
            <BaseButton variant="ghost" size="sm" @click="editing = row.index">{{ copy.editJob }}</BaseButton>
          </li>
        </ul>

        <BaseButton :variant="jobs.length ? 'secondary' : 'primary'" @click="addJob">
          {{ jobs.length ? copy.addJob : copy.addFirstJob }}
        </BaseButton>
      </div>

      <!-- What the recruiter will look at, shown to the driver while they can still act on it. -->
      <div class="space-y-2 rounded-surface bg-surface p-4 ring-1 ring-inset ring-edge">
        <div class="flex items-baseline justify-between gap-3">
          <h3 class="text-sm font-semibold text-ink">{{ copy.coverageHeading }}</h3>
          <span class="text-xs text-ink-muted">{{ progress.percent }}%</span>
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-detail bg-surface-muted" aria-hidden="true">
          <div class="h-full bg-brand-500 transition-all" :style="{ width: `${progress.percent}%` }" />
        </div>
        <p class="text-sm text-ink-secondary" aria-live="polite">
          {{
            progress.empty
              ? copy.coverageEmpty(EMPLOYMENT_WINDOW_YEARS)
              : progress.percent >= 100
                ? copy.coverageComplete(EMPLOYMENT_WINDOW_YEARS)
                : copy.coverage(progress.percent, EMPLOYMENT_WINDOW_YEARS)
          }}
        </p>
      </div>
    </template>

    <!-- A box per gap (C3c1): the dates are the calculator's, the words the driver's. Outside the jobs
         block on purpose — a driver who had no job still owes the three years, as one gap. The path is
         the filing's own (`employment_gaps.<start>`), so its refusal lands on the box. -->
    <div v-for="gap in gaps" :key="gap.from" class="space-y-2 rounded-surface bg-surface-muted p-4">
      <p class="text-sm text-ink-secondary">{{ copy.gap(monthName(gap.from), monthName(gap.to)) }}</p>
      <ApplyField
        v-if="explanationFor(gap.from)"
        v-slot="f"
        :path="['employment_gaps', gap.from]"
        :label="copy.gapExplanation"
        :hint="copy.gapExplanationHint"
      >
        <BaseTextarea v-bind="f" v-model="explanationFor(gap.from)!.explanation" rows="2" maxlength="500" />
      </ApplyField>
    </div>

    <!-- §391.21(b)(6) asks for two things in one sentence: "the nature and extent of the applicant's
         experience in the operation of motor vehicles, INCLUDING THE TYPE OF EQUIPMENT ... which
         he/she has operated". The narrative answers the first half; the rows below answer the second,
         laid out as FMCSA's own sample application lays it out. Either satisfies the paragraph, and
         a cross-field rule refuses a document with neither. -->
    <ApplyField v-slot="f" :path="['experience']" :label="copy.experience" :hint="copy.experienceHint">
      <BaseInput v-bind="f" v-model="draft.experience" placeholder="Optional" />
    </ApplyField>

    <div class="space-y-3">
      <div>
        <p class="text-sm font-medium text-ink">{{ copy.equipmentHeading }}</p>
        <p class="mt-1 text-xs text-ink-muted">{{ copy.equipmentIntro }}</p>
      </div>

      <div
        v-for="(row, i) in draft.equipment_experience"
        :key="i"
        class="space-y-3 rounded-surface bg-surface-muted p-4"
      >
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ApplyField v-slot="f" :path="['equipment_experience', i, 'equipment_class']" :label="copy.equipmentClass">
            <!-- The forms idiom the rest of the product uses; see `QuestionnaireFields.vue`. -->
            <ComboSelect v-bind="f" v-model="row.equipment_class" :options="EQUIPMENT_OPTIONS" />
          </ApplyField>
          <ApplyField
            v-slot="f"
            :path="['equipment_experience', i, 'equipment_type']"
            :label="copy.equipmentType"
            :hint="copy.equipmentTypeHint"
          >
            <BaseInput v-bind="f" v-model="row.equipment_type" />
          </ApplyField>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ApplyField
            v-slot="f"
            :path="['equipment_experience', i, 'from']"
            :label="copy.equipmentFrom"
            :hint="copy.equipmentMonthHint"
          >
            <AppMonthField v-bind="f" v-model="row.from" />
          </ApplyField>
          <ApplyField
            v-slot="f"
            :path="['equipment_experience', i, 'to']"
            :label="copy.equipmentTo"
            :hint="copy.equipmentToHint"
          >
            <AppMonthField v-bind="f" v-model="row.to" />
          </ApplyField>
          <ApplyField
            v-slot="f"
            :path="['equipment_experience', i, 'approx_miles']"
            :label="copy.equipmentMiles"
            :hint="copy.equipmentMilesHint"
          >
            <BaseInput v-bind="f" v-model="row.approx_miles" inputmode="numeric" />
          </ApplyField>
        </div>
        <div class="flex justify-end">
          <BaseButton variant="ghost" size="sm" @click="draft.equipment_experience.splice(i, 1)">
            {{ copy.remove }}
          </BaseButton>
        </div>
      </div>

      <BaseButton variant="secondary" @click="draft.equipment_experience.push(emptyEquipment())">
        {{ copy.addEquipment }}
      </BaseButton>
    </div>

    <EmployerDrawer
      :open="openDrawer"
      :index="editing ?? 0"
      :employer="editing === null ? null : (draft.employers[editing] ?? null)"
      @save="saveJob"
      @remove="removeJob(editing ?? 0); editing = null"
      @close="closeDrawer"
    />
  </section>
</template>
