<script setup lang="ts">
import { computed } from "vue";
import { AppCallout, AppInput as BaseInput } from "@silvicom/ui";
import { questionnaireForApplicant, type ApplicationCaptureView } from "@silvicom/shared";
import ApplyField from "./ApplyField.vue";
import CertifyFields from "./CertifyFields.vue";
import { buildReviewSummary } from "./reviewSummary";
import { describeField } from "./fieldLabels";
import { APPLY_COPY } from "./strings";
import type { ApplicationDraft } from "./draft";
import type { ApplyEdit } from "./useApplication";

/**
 * The second visit: the document as it now stands, and the signature (F4, D-AX12).
 *
 * ── WHY THE CHANGES COME BEFORE THE CERTIFICATION ─────────────────────────────────────────────
 * §391.21(b)(12) has the applicant certify that "all entries on it and information in it are true and
 * complete". Once the office can correct an entry, that sentence can only be honestly signed by
 * somebody who has been shown the entries somebody else changed. This screen is where that obligation
 * is discharged, or it is not discharged anywhere — so the corrections are above the tick box rather
 * than below it, and they are in the driver's own words for the field (`describeField`) rather than
 * in contract paths.
 *
 * ── AND WHY THE SOCIAL SECURITY NUMBER IS ASKED FOR HERE ──────────────────────────────────────
 * ⚠ It moved from the identity screen, and it was forced rather than chosen. D-APP3 keeps it out of
 * every saved draft — it is the one answer autosave never carries — so a number typed on the first
 * visit is gone by the second, and the second visit is when the file is actually created. Asking for
 * it beside the signature is also the better privacy answer: typed once, sealed immediately, held
 * nowhere in between.
 */
const props = defineProps<{
  carrier: string;
  edits: readonly ApplyEdit[];
  captures: readonly ApplicationCaptureView[];
}>();
const draft = defineModel<ApplicationDraft>({ required: true });
const copy = APPLY_COPY.signOff;

const summary = computed(() =>
  buildReviewSummary({
    draft: draft.value,
    questionnaire: questionnaireForApplicant(),
    captures: props.captures,
  }),
);

/** An answer as a driver reads it — a blank is a word, not an empty space in a sentence. */
const shown = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return copy.blank;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};
</script>

<template>
  <section class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold text-ink">{{ copy.heading }}</h2>
      <p class="mt-1 text-sm text-ink-muted">{{ copy.intro(carrier) }}</p>
    </div>

    <!-- ⚠ Above the certification, always. This is the one screen where a driver can find out that
         somebody else changed their answers, and they are about to swear those answers are theirs. -->
    <section class="space-y-3">
      <h3 class="text-sm font-semibold text-ink">{{ copy.changedHeading }}</h3>
      <p v-if="edits.length === 0" class="text-sm text-ink-muted">{{ copy.changedNothing }}</p>
      <template v-else>
        <AppCallout tone="caution">{{ copy.changedIntro }}</AppCallout>
        <ul class="space-y-2">
          <li
            v-for="(edit, i) in edits"
            :key="i"
            class="rounded-surface bg-surface-muted p-3 text-sm"
          >
            <p class="font-medium text-ink">{{ describeField(edit.path) }}</p>
            <p class="mt-1 break-words text-ink-muted">
              {{ copy.was }}: <span class="line-through">{{ shown(edit.before) }}</span>
            </p>
            <p class="break-words text-ink">{{ copy.now }}: {{ shown(edit.after) }}</p>
          </li>
        </ul>
      </template>
    </section>

    <!-- The whole document, in the same words and the same order the driver filled it in. -->
    <section v-for="group in summary" :key="group.section" class="space-y-2">
      <h3 class="text-sm font-semibold text-ink">{{ group.heading }}</h3>
      <div
        v-for="(card, i) in group.groups"
        :key="i"
        class="space-y-2 rounded-surface bg-surface-muted p-3"
      >
        <p v-if="card.title" class="text-xs font-medium text-ink-tertiary">{{ card.title }}</p>
        <div
          v-for="entry in card.entries"
          :key="entry.label"
          class="flex flex-col gap-x-3 gap-y-0.5 text-sm sm:flex-row sm:items-baseline sm:justify-between"
        >
          <!-- `min-w-0` + `break-words` on both halves: an answer is arbitrary text, and one long
               unbroken employer name is how a row escapes its card on a 320px phone. -->
          <span class="min-w-0 break-words text-ink-muted">{{ entry.label }}</span>
          <span
            class="min-w-0 break-words sm:text-right"
            :class="entry.muted ? 'text-ink-tertiary' : 'text-ink'"
          >
            {{ entry.value }}
          </span>
        </div>
      </div>
    </section>

    <!-- §391.21(b)(2)'s Social Security number. Never saved, so it can only be asked for now. -->
    <section class="space-y-2">
      <ApplyField
        v-slot="f"
        :path="['ssn']"
        :label="APPLY_COPY.identity.ssn"
        :hint="APPLY_COPY.identity.ssnHint"
      >
        <BaseInput v-bind="f" v-model="draft.ssn" inputmode="numeric" autocomplete="off" />
      </ApplyField>
      <p class="text-xs text-ink-muted">{{ copy.ssnNote }}</p>
    </section>

    <CertifyFields v-model="draft" />
  </section>
</template>
