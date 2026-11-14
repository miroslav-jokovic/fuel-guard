<script setup lang="ts">
import { computed } from "vue";
import { AppButton } from "@silvicom/ui";
import {
  EMPLOYMENT_WINDOW_YEARS,
  EQUIPMENT_CLASS_LABELS,
  addressCoverage,
  formatDisplayMonth,
  residenceMonthsCovered,
  type ApplicationAddress,
  type PartOneFactsView,
  type WizardScreenId,
} from "@silvicom/shared";
import { toApplication, type ApplicationDraft } from "@/features/apply/draft";
import CorrectionNote from "@/features/apply/CorrectionNote.vue";
import { employmentProgress, monthName } from "@/features/apply/employmentProgress";
import PartOneFactsCard from "@/features/apply/PartOneFactsCard.vue";
import { aboutYouRows } from "@/features/apply/partOneFacts";
import QuestionField from "@/features/apply/QuestionField.vue";
import SsnField from "@/features/apply/SsnField.vue";
import YesNoField from "@/features/apply/YesNoField.vue";
import { APPLY_COPY } from "@/features/apply/strings";
import WizardScreen from "./WizardScreen.vue";
import type { TaskWalk } from "./useTaskWalk";

/**
 * The open task, one screen at a time (F4 PR 1b-1). `useTaskWalk` decides which screen and checks it;
 * this draws it — the generated screen, the row it is about, "Any other …?" at a list's end, and the
 * removal of the row on show. The page's own buttons move the walk (`ApplyPage`), as they did the task.
 *
 * Three screens are not the binding's (F4 PR 1b-2): a carrier's question (`QuestionField`, the definition's
 * control for its kind), the SSN (`SsnField` — its own save, never the draft, D-APP3; drawn by the fact's
 * `ssn` door), and Part 1's answers, shown with "Something wrong? Tell us" (`PartOneFactsCard`).
 *
 * "Where you have lived" (F4 PR 1b-3) adds two things around its screens, neither an answer: the home
 * Part 1 holds, shown above the one question asked about it (D-AM5: never ask what we know), and the
 * meter of the three years, from `addressCoverage` over the addresses as they would be FILED — the
 * arithmetic the task's check refuses on, so the meter and the refusal cannot disagree.
 */
const props = defineProps<{
  walk: TaskWalk;
  /** The link, for the SSN's own save (Q-AM3). */
  token: string;
  /** A v2 link's Part 1 answers, which "About you" ends on. */
  partOne?: PartOneFactsView | null;
  /** The carrier's day, which the address meter counts its three years back from. */
  asOf: string;
}>();
const draft = defineModel<ApplicationDraft>({ required: true });

/** Each list's own words: whose row this is, how the list asks for one more, how a row is removed. */
const LIST_WORDS = (): Record<string, { row: (n: number) => string; another?: string; remove: string }> => {
  const w = APPLY_COPY.safety.walk;
  const home = APPLY_COPY.addresses.walk;
  const job = APPLY_COPY.employment.walk;
  return {
    // No "any other?": the list ends when the three years are covered (`useTaskWalk`).
    addresses: { row: home.earlierRow, remove: home.remove },
    employers: { row: job.jobRow, another: job.another, remove: job.removeJob },
    accidents: { row: w.accidentRow, another: w.anotherAccident, remove: w.removeAccident },
    violations: { row: w.violationRow, another: w.anotherViolation, remove: w.removeViolation },
  };
};

/** What a screen says above its boxes, where the boxes' own labels do not ask the question. */
const SCREEN_INTRO = (): Partial<Record<WizardScreenId, string>> => ({
  "addresses.home": APPLY_COPY.addresses.walk.homeIntro,
  "employment.job_place": APPLY_COPY.employment.walk.placeIntro,
});

const step = computed(() => props.walk.current.value);
/** The home lived in now: shown, never asked, and not the driver's to remove. */
const isCurrentHome = computed(() => step.value?.screen?.rows === "current");
const currentHome = computed(() => {
  const a = isCurrentHome.value ? draft.value.addresses[step.value!.row ?? 0] : undefined;
  return a ? [a.line1, a.line2, [a.city, [a.state, a.postal_code].filter((p) => p.trim()).join(" ")].filter((p) => p.trim()).join(", ")].filter((p) => p.trim()) : [];
});
/**
 * Whose row a loop screen is about, in the driver's own words where they have given them: the company
 * once it is named, the months of a gap (computed, so they are the row), the class of equipment picked.
 */
const rowTitle = computed<string | null>(() => {
  const s = step.value;
  const list = s?.screen?.list;
  if (!s || list === undefined || s.row === undefined || isCurrentHome.value) return null;
  if (list === "employers") return draft.value.employers[s.row]?.employer_name.trim() || APPLY_COPY.employment.walk.jobRow(s.ordinal ?? s.row + 1);
  if (list === "employment_gaps") {
    const gap = draft.value.employment_gaps[s.row];
    return gap ? APPLY_COPY.employment.walk.gapRow(monthName(gap.from), monthName(gap.to)) : null;
  }
  if (list === "equipment_experience") {
    const picked = draft.value.equipment_experience[s.row]?.equipment_class;
    return picked ? EQUIPMENT_CLASS_LABELS[picked] : null;
  }
  return words.value ? words.value.row(s.ordinal ?? s.row + 1) : null;
});
/** The three years of jobs, shown where the driver decides whether there was another (SCREEN-MAP 2.14). */
const jobsCovered = computed(() => {
  if (step.value?.another !== "employers") return null;
  const progress = employmentProgress(draft.value.employers, props.asOf);
  const copy = APPLY_COPY.employment;
  return progress.percent >= 100 ? copy.coverageComplete(EMPLOYMENT_WINDOW_YEARS) : copy.coverage(progress.percent, EMPLOYMENT_WINDOW_YEARS);
});
const coverage = computed(() =>
  step.value?.screen?.list === "addresses"
    ? addressCoverage((toApplication(draft.value) as { addresses: ApplicationAddress[] }).addresses, props.asOf)
    : null);
const covered = computed(() => {
  const months = coverage.value ? residenceMonthsCovered(coverage.value) : 0;
  return APPLY_COPY.addresses.walk.covered(Math.floor(months / 12), months % 12);
});
const asksSsn = computed(() => step.value?.screen?.fields.some((f) => f.fact.office === "ssn") ?? false);
const words = computed(() => {
  const list = step.value?.another ?? step.value?.screen?.list;
  return list ? LIST_WORDS()[list] : undefined;
});
</script>

<template>
  <div v-if="step" class="space-y-4">
    <p class="text-xs font-medium text-ink-tertiary">{{ APPLY_COPY.hub.question(walk.step.value, walk.count.value) }}</p>
    <p v-if="rowTitle" class="text-sm font-semibold text-ink">{{ rowTitle }}</p>
    <div v-if="isCurrentHome && currentHome.length" class="space-y-1 rounded-surface bg-surface-muted p-4" data-current-home>
      <p class="text-xs text-ink-muted">{{ APPLY_COPY.partOneFacts.currentAddress }}</p>
      <p v-for="line in currentHome" :key="line" class="text-sm text-ink">{{ line }}</p>
    </div>
    <p v-if="step.screen && SCREEN_INTRO()[step.screen.id]" class="text-sm text-ink-secondary">{{ SCREEN_INTRO()[step.screen.id] }}</p>

    <YesNoField
      v-if="step.another && words?.another"
      :id="`apply-${step.another}-another`"
      :model-value="walk.another.value"
      :legend="words.another"
      :error="walk.anotherRefused.value ? APPLY_COPY.hub.chooseYesOrNo : undefined"
      @update:model-value="walk.answerAnother($event)"
    />
    <SsnField v-else-if="asksSsn" id="identity-ssn" v-model="draft" :token="token" />
    <WizardScreen v-else-if="step.screen" :key="step.key" :screen="step.screen" :row="step.row" :binding="walk.binding" />
    <QuestionField v-else-if="step.question" :key="step.key" :question="step.question.q" :answers="step.question.answers" />
    <PartOneFactsCard v-else-if="step.partOne && partOne" v-model="draft" :rows="aboutYouRows(draft, partOne)" />

    <p v-if="jobsCovered" class="text-sm text-ink-secondary" aria-live="polite" data-jobs-coverage>{{ jobsCovered }}</p>

    <p v-for="problem in walk.stray.value" :key="problem" class="text-sm text-danger-700" role="alert">{{ problem }}</p>

    <!-- Part 1's home is reported wrong, not retyped (C3c2c2): the one note every Part 1 fact shares. -->
    <CorrectionNote v-if="isCurrentHome && partOne" v-model="draft" />

    <!-- The three years, by the arithmetic the task's check refuses on. `aria-live`: it changes as months are typed. -->
    <div v-if="coverage" class="space-y-1 rounded-surface bg-surface p-4 ring-1 ring-inset ring-edge" aria-live="polite" data-address-coverage>
      <p class="text-sm font-semibold text-ink">{{ coverage.covered ? APPLY_COPY.addresses.walk.coveredAll : covered }}</p>
      <template v-if="!coverage.covered">
        <p v-for="gap in coverage.gaps" :key="gap.from" class="text-sm text-ink-secondary">
          {{ APPLY_COPY.addresses.gap(formatDisplayMonth(gap.from), formatDisplayMonth(gap.to)) }}
        </p>
      </template>
    </div>

    <div v-if="words && step.row !== undefined && !isCurrentHome" class="flex justify-end">
      <AppButton variant="ghost" size="touch" @click="walk.removeRow()">{{ words.remove }}</AppButton>
    </div>
  </div>
</template>
