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
import EmploymentTimeline from "@/components/employment/EmploymentTimeline.vue";
import EmployerFormDrawer from "@/components/employment/EmployerFormDrawer.vue";
import type { TimelineJob } from "@/components/employment/timeline";
import { checkEmployer, errorsByField } from "@/features/apply/employerCheck";
import { fieldId } from "@/features/apply/fieldLabels";
import type { SectionIssue } from "@/features/apply/useApplicationWizard";
import QuestionnaireFields from "@/features/apply/QuestionnaireFields.vue";
import {
  emptyEmployer,
  emptyEquipment,
  employerIsBlank,
  employerIsUnfinished,
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
import { useApplyIssues } from "@/features/apply/issues";
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
 * It is now a timeline of the jobs (`EmploymentTimeline`, HW5b) with a panel per job (the one
 * employer form, `EmployerFormDrawer`, which the office uses too), which is the shape a phone can
 * hold: what is on screen at any moment is either the list or one job. The gaps the filing asks about
 * sit on the timeline between the jobs they fall between, each with its box and "Add a job here".
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
const props = withDefaults(
  defineProps<{
    /**
     * The date the windows end: the application's day on the CARRIER's clock, served by the bundle
     * (`carrierToday`, C3c1) — the same day filing judges against, so the gaps here are the gaps it asks
     * about. It was `new Date().toISOString()`, the UTC day, which after 19:00 Central is tomorrow.
     */
    asOf: string;
    /**
     * The same day on a v2 link, null on a legacy one (C3c2b) — what tells the job panel to ask, and
     * check, what a v2 filing requires of each job. `asOf` alone cannot say: every link has a day.
     */
    v2AsOf?: string | null;
  }>(),
  { v2AsOf: null },
);
const draft = defineModel<ApplicationDraft>({ required: true });
const copy = APPLY_COPY.employment;
/** The page's issues: a job whose answers are refused says so on its card — its boxes are in the panel. */
const { hasIssueWithin } = useApplyIssues();

const editing = ref<number | null>(null);
const openDrawer = computed(() => editing.value !== null);
const editingRow = computed(() => (editing.value === null ? null : (draft.value.employers[editing.value] ?? null)));

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

/**
 * The jobs, as the timeline draws them: every job with anything in it (§9 P8, AF-4). A blank row from
 * an accidental "Add" is not a job the driver declared; a job with dates and no name IS one. What a
 * job still lacks is `checkEmployer` — the same check its Save runs — or, failing that, whatever the
 * page itself has refused inside it.
 */
const jobs = computed<TimelineJob[]>(() =>
  draft.value.declares_no_employment
    ? []
    : draft.value.employers
        .map((employer, index) => ({ employer, index }))
        // The job being edited stays listed, behind its panel, as it always has: dropping it changed what
        // the page renders under an opening drawer, and the tap-target sweep measured the panel mid-slide.
        .filter(({ employer, index }) => !employerIsBlank(employer) || index === editing.value)
        .map(({ employer, index }) => {
          const missing = new Set(checkEmployer(employer, index, props.v2AsOf).map((i) => i.fieldId)).size;
          return {
            key: employer.key,
            name: employer.employer_name.trim(),
            startedOn: employer.started_on,
            endedOn: employer.ended_on.trim() === "" ? null : employer.ended_on,
            operatedCmv: employer.operated_cmv,
            dotRegulated: employer.dot_regulated,
            missing: missing || (hasIssueWithin(["employers", index]) ? 1 : 0),
            unfinished: employerIsUnfinished(employer),
          };
        }),
);

/** The panel's own refusals — what its Save found, or, on reopening a saved v2 job, what it still owes. */
const panelIssues = ref<SectionIssue[]>([]);
const panelErrors = computed(() => (editing.value === null ? {} : errorsByField(panelIssues.value, editing.value)));

function openJob(index: number): void {
  editing.value = index;
  const row = draft.value.employers[index];
  panelIssues.value = props.v2AsOf && row && !employerIsBlank(row) ? checkEmployer(row, index, props.v2AsOf) : [];
}

function editJob(key: string): void {
  const index = draft.value.employers.findIndex((e) => e.key === key);
  if (index >= 0) openJob(index);
}

/** A new job — at the end, by its own key — with a gap's dates when it came from "Add a job here". */
function addJob(prefill?: { started_on: string; ended_on: string }): void {
  draft.value.employers = [...draft.value.employers, { ...emptyEmployer(), ...(prefill ?? {}) }];
  openJob(draft.value.employers.length - 1);
}

function saveJob(employer: DraftEmployer): void {
  const at = editing.value;
  if (at === null) return;
  panelIssues.value = checkEmployer(employer, at, props.v2AsOf);
  if (panelIssues.value.length > 0) return;
  draft.value.employers = draft.value.employers.map((row, i) => (i === at ? employer : row));
  editing.value = null;
}

/**
 * Closing without saving (§9 P8, AF-4).
 *
 *   · A job that was finished keeps what was saved — Cancel discards the edit.
 *   · A new or unfinished job with nothing in it is REMOVED: a blank card the driver did not create
 *     and cannot name.
 *   · A new or unfinished job with something in it is KEPT as typed, and the timeline names it
 *     "Unfinished — finish or remove". Discarding it would lose the driver's typing; keeping it
 *     silently would be the blank row the audit found in a draft. The filing's own schema then refuses
 *     its missing name or start date, on its row, until it is finished or removed.
 */
function closeDrawer(working: DraftEmployer): void {
  const at = editing.value;
  editing.value = null;
  const row = at === null ? undefined : draft.value.employers[at];
  if (at === null || !row) return;
  if (!employerIsBlank(row) && !employerIsUnfinished(row)) return;
  draft.value.employers = employerIsBlank(working)
    ? draft.value.employers.filter((_, i) => i !== at)
    : draft.value.employers.map((r, i) => (i === at ? working : r));
}

/** Removing a job, after the panel's confirm — by the row being edited, which is the job's own index. */
function removeJob(): void {
  const at = editing.value;
  editing.value = null;
  if (at !== null) draft.value.employers = draft.value.employers.filter((_, i) => i !== at);
}
</script>

<template>
  <section class="space-y-5">
    <p class="text-sm text-ink-muted">{{ copy.intro }}</p>

    <!-- D-AX7. The carrier's paper asks this on page 1; it is asked here, above the list, because a
         driver cannot picture who is being asked about until they have named them. -->
    <QuestionnaireFields v-model="draft" section="employment" />

    <BaseCheckbox v-model="draft.declares_no_employment">{{ copy.none }}</BaseCheckbox>

    <!-- HW5b (EM-9): the jobs and the gaps on one timeline, the 3- and 10-year lines drawn on it. A box
         per gap (C3c1): the dates are the calculator's, the words the driver's, at the filing's own
         path (`employment_gaps.<start>`) so its refusal lands on the box. Drawn even when the driver
         says they had no job — they still owe the three years, as one gap. -->
    <EmploymentTimeline
      :jobs="jobs"
      :as-of="asOf"
      :copy="copy"
      :show-gaps="gaps.length > 0"
      :editable="!draft.declares_no_employment"
      touch
      @edit="editJob"
      @add="addJob"
    >
      <template #gap="{ gap }">
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
      </template>
    </EmploymentTimeline>

    <template v-if="!draft.declares_no_employment">
      <BaseButton :variant="jobs.length ? 'secondary' : 'primary'" size="touch" @click="addJob()">
        {{ jobs.length ? copy.addJob : copy.addFirstJob }}
      </BaseButton>

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

    <!-- The one employer form (HW5b): the office's screens open the same panel. A new job is passed as a
         prefill, not as a job, so its title says "Add a job" and it offers no Remove. -->
    <EmployerFormDrawer
      :open="openDrawer"
      :employer="editingRow && !employerIsBlank(editingRow) ? editingRow : null"
      :prefill="editingRow"
      :copy="copy"
      :id-prefix="fieldId(['employers', editing ?? 0])"
      :as-of="asOf"
      :errors="panelErrors"
      :removable="Boolean(editingRow) && !employerIsBlank(editingRow!)"
      touch
      @save="saveJob"
      @remove="removeJob"
      @close="closeDrawer"
    />
  </section>
</template>
