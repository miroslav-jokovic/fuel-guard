<script setup lang="ts">
import { computed } from "vue";
import { AppCallout } from "@silvicom/ui";
import { currentEditPaths, type ApplicationCaptureView } from "@silvicom/shared";
import SsnField from "./SsnField.vue";
import SevenDayFields from "./SevenDayFields.vue";
import { applicantCarrierQuestionnaire, applicantQuestionnaire } from "./questionnaireCopy";
import { buildReviewSummary } from "./reviewSummary";
import { describeField, rowText } from "./fieldLabels";
import { APPLY_COPY } from "./strings";
import { toDraftPayload, type ApplicationDraft } from "./draft";
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
  /** The link, for the SSN's own save (Q-AM3). */
  token: string;
  /** The carrier's day, for page 21's seven (Q-AM4). Null: the page is asked as soon as the API sends it. */
  today?: string | null;
  carrier: string;
  edits: readonly ApplyEdit[];
  captures: readonly ApplicationCaptureView[];
}>();
const draft = defineModel<ApplicationDraft>({ required: true });
const copy = APPLY_COPY.signOff;

const summary = computed(() =>
  buildReviewSummary({
    draft: draft.value,
    questionnaire: applicantQuestionnaire(draft.value.questionnaire_version),
    carrier: applicantCarrierQuestionnaire(),
    captures: props.captures,
  }),
);

/**
 * E2: each change named where it is NOW. The office may have removed a row since a correction to a
 * later one, and the recorded "Address 3 · City" would then name an address the driver no longer has
 * (`currentEditPaths`). A correction to a row removed since says so.
 */
// Q-AM15: a keyed correction is looked up in the driver's own draft, so deleting or reordering a row on
// this phone after the office corrected it moves the correction with its row.
const currentPaths = computed(() => currentEditPaths(props.edits, toDraftPayload(draft.value)));
function editLabel(i: number): string {
  const now = currentPaths.value[i];
  if (!now) return describeField(props.edits[i]!.path);
  const label = describeField(now.path);
  return now.gone && !now.removal ? `${label} (${copy.removedLater})` : label;
}

/** An answer as a driver reads it — a blank is a word, not an empty space in a sentence. */
const shown = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return copy.blank;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return rowText(value as Record<string, unknown>);
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
            <p class="font-medium text-ink">{{ editLabel(i) }}</p>
            <p v-if="edit.withheld" class="mt-1 break-words text-ink-muted" data-edit-withheld>{{ copy.replaced }}</p>
            <template v-else>
              <p class="mt-1 break-words text-ink-muted">
                {{ copy.was }}: <span class="line-through">{{ shown(edit.before) }}</span>
              </p>
              <p class="break-words text-ink">{{ copy.now }}: {{ shown(edit.after) }}</p>
            </template>
            <p v-if="edit.note" class="mt-1 whitespace-pre-line break-words text-ink-muted" data-edit-note>
              {{ copy.because }}: {{ edit.note }}
            </p>
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

    <!-- Page 21, the seven-day work statement, given at signing (Q-AM4). -->
    <SevenDayFields v-if="today" v-model="draft" :today="today" />

    <!-- §391.21(b)(2)'s Social Security number: asked in the form since Q-AM3 and saved sealed (0589);
         shown here as on file, or asked once more for a driver who skipped it. -->
    <section class="space-y-2">
      <SsnField v-model="draft" :token="token" id="signoff-ssn" />
      <p class="text-xs text-ink-muted">{{ copy.ssnNote }}</p>
    </section>

    <!-- ⚠ `CertifyFields` used to sit here and does not any more (D-PKT15, owner 2026-09-14).
         It asked the driver to tick §391.21(b)(12) and type their name — directly above a walk that
         then asked for the name again and took their signature onto packet pages 11, 13 and 17,
         each of which certifies THE SAME FACT in the carrier's own words. Two acts, one obligation,
         and the driver typing their name twice in a row on one screen.
         The walk is the certification now. `certified` and `signed_name` are still written into the
         filed payload — they are contract fields on an append-only table — but they are DERIVED from
         the adopted mark in `SignOffScreen`, and the server refuses a submission whose name does not
         match what the marks recorded. ⚠ Subject to counsel on whether the packet's own certification
         language satisfies §391.21(b)(12); the owner ruled the duplication out on 2026-09-14. -->
  </section>
</template>
