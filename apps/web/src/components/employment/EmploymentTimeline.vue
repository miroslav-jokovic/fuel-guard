<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { formatDisplayDate, type EmploymentGap } from "@silvicom/shared";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { buildTimeline, type TimelineJob } from "./timeline";
import type { EmploymentFormCopy } from "./employmentCopy";

/**
 * Previous jobs as ONE timeline — the applicant's link, the office's review drawer, the applicant
 * record (HW5b, HIRING-WORKFLOW-AUDIT-2026-10-31 §4.5, EM-9).
 *
 * The applicant had a percentage bar, the office counts and a table; the 10-year coverage was
 * computed and shown to nobody. Here every job is a card, newest first, with its dates, whether it
 * was driving and DOT-regulated, and what it still lacks; every gap the filing will ask about sits
 * between the cards it falls between, with its explanation (or the surface's box for one, `#gap`) and
 * "Add a job here", which opens the form with the gap's dates in it. The 3-year and 10-year lines are
 * drawn where they fall — the two windows §391.21(b)(10) and (b)(11) ask about, as `employmentCoverage`
 * computes them (`timeline.ts`).
 *
 * Jobs are addressed by `key`, never by position (Q-AX7): `edit` carries it.
 */
const props = withDefaults(
  defineProps<{
    jobs: TimelineJob[];
    asOf: string;
    copy: EmploymentFormCopy;
    /** Draw the gaps (the applicant's screen hides them until a job is listed or "none" is said). */
    showGaps?: boolean;
    /** The explanation already given for a gap, by its start date. */
    explanations?: Record<string, string>;
    editable?: boolean;
    touch?: boolean;
  }>(),
  { showGaps: true, explanations: () => ({}), editable: true, touch: false },
);
const emit = defineEmits<{
  edit: [key: string];
  add: [prefill: { started_on: string; ended_on: string }];
}>();

const timeline = computed(() => buildTimeline(props.jobs, props.asOf, props.showGaps));
const size = computed(() => (props.touch ? "touch" : "sm"));

const period = (job: TimelineJob): string =>
  job.startedOn
    ? `${formatDisplayDate(job.startedOn)} – ${job.endedOn ? formatDisplayDate(job.endedOn) : props.copy.jobToNow}`
    : props.copy.jobNoDates;

const gapLine = (gap: EmploymentGap): string =>
  props.copy.gapLine(formatDisplayDate(gap.from), formatDisplayDate(gap.to), gap.days);
</script>

<template>
  <section class="space-y-3" data-testid="employment-timeline">
    <h3 class="text-sm font-semibold text-ink">{{ copy.timelineHeading }}</h3>
    <p v-if="jobs.length === 0 && timeline.gaps.length === 0" class="text-sm text-ink-muted">{{ copy.timelineEmpty }}</p>

    <ol class="space-y-2 border-l-2 border-edge pl-4">
      <li
        v-for="entry in timeline.entries"
        :key="entry.kind === 'job' ? `job-${entry.job.key}` : entry.kind === 'gap' ? `gap-${entry.gap.from}` : `mark-${entry.years}`"
        :data-entry="entry.kind"
      >
        <!-- A job. -->
        <div
          v-if="entry.kind === 'job'"
          class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-surface bg-surface-muted p-3"
          :data-job="entry.job.key"
        >
          <div class="min-w-0 flex-1 space-y-1">
            <p class="break-words text-sm font-medium text-ink">{{ entry.job.name || copy.noName }}</p>
            <p class="text-xs text-ink-muted">{{ period(entry.job) }}</p>
            <div class="flex flex-wrap items-center gap-2">
              <span v-if="entry.job.operatedCmv" :class="[BADGE_BASE, toneClass('info')]">{{ copy.tagTruck }}</span>
              <span v-if="entry.job.dotRegulated" :class="[BADGE_BASE, toneClass('neutral')]">{{ copy.tagDot }}</span>
              <span v-if="entry.job.unfinished" class="text-sm text-danger-700">{{ copy.unfinished }}</span>
              <span v-else-if="entry.job.missing > 0" class="text-sm text-danger-700">{{ copy.jobMissing(entry.job.missing) }}</span>
              <span v-else :class="[BADGE_BASE, toneClass('success')]">✓ {{ copy.jobComplete }}</span>
              <!-- The surface's own facts about the job — the record's inquiry status and source. -->
              <slot name="job-meta" :job="entry.job" />
            </div>
          </div>
          <BaseButton v-if="editable" variant="ghost" :size="size" @click="emit('edit', entry.job.key)">
            {{ entry.job.unfinished ? copy.finish : copy.editJob }}
          </BaseButton>
        </div>

        <!-- A gap: drawn as a gap, between the jobs it falls between. -->
        <div
          v-else-if="entry.kind === 'gap'"
          class="space-y-2 rounded-surface border border-dashed border-edge p-3"
          :data-gap="entry.gap.from"
        >
          <p class="text-sm font-medium text-ink-secondary">{{ gapLine(entry.gap) }}</p>
          <slot name="gap" :gap="entry.gap">
            <p v-if="explanations[entry.gap.from]" class="text-sm text-ink-secondary">
              {{ copy.gapExplained }} {{ explanations[entry.gap.from] }}
            </p>
          </slot>
          <BaseButton
            v-if="editable"
            variant="secondary"
            :size="size"
            @click="emit('add', { started_on: entry.gap.from, ended_on: entry.gap.to })"
          >
            {{ copy.addJobHere }}
          </BaseButton>
        </div>

        <!-- A mark: where the regulation draws its line. -->
        <div v-else class="border-t border-edge pt-2" :data-mark="entry.years">
          <p class="text-xs font-medium text-ink-secondary">
            {{ entry.years === 3 ? copy.markThree(formatDisplayDate(entry.date)) : copy.markTen(formatDisplayDate(entry.date)) }}
          </p>
          <p class="text-xs text-ink-muted">{{ entry.years === 3 ? copy.markThreeHint : copy.markTenHint }}</p>
          <p v-if="entry.years === 10 && jobs.length" class="text-xs text-ink-muted">{{ copy.cmvBetween(timeline.cmvBetween) }}</p>
        </div>
      </li>
    </ol>
  </section>
</template>
