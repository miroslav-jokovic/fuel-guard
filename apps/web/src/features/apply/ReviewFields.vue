<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import {
  questionnaireForApplicant,
  type ApplicationCaptureView,
  type ApplicationSection,
} from "@silvicom/shared";
import type { ApplicationDraft } from "@/features/apply/draft";
import { buildReviewSummary } from "@/features/apply/reviewSummary";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * What the driver is about to certify (A3, rebuilt for D-AX6).
 *
 * §391.21(b)(12) makes them sign that "all entries on it and information in it are true and
 * complete", and a wizard hides most of the document behind screens they have already left. So the
 * step before the signature puts it all back on one page — not as a pretty summary but as the
 * answers themselves, each with a way back to the screen that owns it.
 *
 * ⚠ **That sentence has been in this file since A3 and was not true until 2026-09-11.** The screen
 * rendered `"3 employers"`, `"2 accidents"`, `"1 conviction"` — counts, not entries — and showed
 * nothing at all of the equipment grid, the other names, the §40.25(j) answer, the carrier's own
 * questions or the photographs. A count is not something a person can check, and checking is the
 * whole act this screen exists for.
 *
 * The composition is now `reviewSummary.ts`'s, because a screen whose correctness is "everything the
 * driver typed is on it" needs that claim to be testable, and markup cannot be walked.
 *
 * The Social Security number is deliberately NOT shown: it is optional, it is not part of the
 * certified payload, and reprinting nine digits on a summary screen on a phone in a truck stop is
 * the opposite of what D-HIRE6 spends its effort on.
 */
const props = defineProps<{ draft: ApplicationDraft; captures?: readonly ApplicationCaptureView[] }>();
const emit = defineEmits<{ goTo: [ApplicationSection] }>();

const copy = APPLY_COPY.review;
const sections = computed(() =>
  buildReviewSummary({
    draft: props.draft,
    questionnaire: questionnaireForApplicant(),
    captures: props.captures ?? [],
  }),
);
</script>

<template>
  <section class="space-y-6">
    <p class="text-sm text-ink-muted">{{ copy.intro }}</p>

    <div v-for="group in sections" :key="group.section" class="space-y-3">
      <div class="flex items-center justify-between gap-4">
        <h3 class="text-sm font-semibold text-ink">{{ group.heading }}</h3>
        <BaseButton variant="ghost" size="sm" @click="emit('goTo', group.section)">
          {{ APPLY_COPY.nav.fix }}
        </BaseButton>
      </div>

      <div
        v-for="(card, i) in group.groups"
        :key="i"
        class="space-y-2 rounded-surface bg-surface-muted p-4"
      >
        <p v-if="card.title" class="text-xs font-medium uppercase tracking-wide text-ink-tertiary">
          {{ card.title }}
        </p>
        <dl class="space-y-2">
          <!-- Stacked at phone width and side by side from `sm`. ⚠ Not a two-column grid at every
               width: these values are whole sentences — a reason for leaving, an accident's
               description — and a narrow right-hand column turns each one into a six-line ribbon. -->
          <div
            v-for="entry in card.entries"
            :key="entry.label"
            class="flex flex-col gap-0.5 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
          >
            <dt class="text-ink-muted sm:shrink-0">{{ entry.label }}</dt>
            <dd :class="['sm:text-right', entry.muted ? 'text-ink-tertiary' : 'text-ink']">
              {{ entry.value }}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  </section>
</template>
