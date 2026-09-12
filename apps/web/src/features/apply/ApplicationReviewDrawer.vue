<script setup lang="ts">
import { computed, toRef } from "vue";
import { AppButton as BaseButton, AppCallout } from "@silvicom/ui";
import {
  APPLICATION_REVIEW_STATE_LABELS,
  questionnaireForApplicant,
  type ApplicationPath,
} from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import { openPdf } from "@/lib/documentDownload";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import { useToastStore } from "@/stores/toast";
import { fromDraftPayload } from "./draft";
import { buildReviewSummary } from "./reviewSummary";
import { describeField } from "./fieldLabels";
import { editableFields, pathKey } from "./editableFields";
import ApplicationAnswerList from "./ApplicationAnswerList.vue";
import {
  useApplicationReviewQuery,
  useApproveApplication,
  useEditApplicationAnswer,
} from "./useApplicationReview";

/**
 * The office reading an applicant's answers, correcting them, and approving (F4, D-AX11–13).
 *
 * ── WHY IT SHOWS THE DRIVER'S OWN SUMMARY FIRST ───────────────────────────────────────────────
 * `buildReviewSummary` is what the applicant reads on the screen before they certify. Reusing it
 * means the office and the driver read the same document, in the same words, grouped the same way —
 * so a recruiter saying "your third address" and a driver looking at their phone are looking at the
 * same thing. A second renderer for the office would drift, and the labels would drift first.
 *
 * The correction list underneath is deliberately NOT that view. Reading a document and correcting a
 * field are different acts: one wants dates as 04/01/2026 and states as "Illinois (IL)", the other
 * wants exactly the characters that are stored, because those are the characters being replaced.
 *
 * ── WHY IT LIVES IN `features/apply` ──────────────────────────────────────────────────────────
 * `lint:boundaries` forbids one feature importing another's internals, and everything above belongs
 * to the application — the contract paths, the field labels, the draft shape. The recruiter's PAGE
 * mounts this drawer, and a page may import any feature, so the rule is satisfied by putting the
 * component where its dependencies already live rather than by an exemption.
 *
 * ── THE WINDOW, SHOWN RATHER THAN ASSUMED ─────────────────────────────────────────────────────
 * ⚠ Editing closes at APPROVAL, not at signing, because approval is what tells the driver *this
 * document, now, please sign it*. The server refuses either way; a screen that offered an edit the
 * server would reject wastes somebody's afternoon. So the controls follow `editable`, and when they
 * are gone the reason is on the page.
 */
const props = defineProps<{ open: boolean; invitationId: string | null }>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const invitationId = toRef(props, "invitationId");
const review = useApplicationReviewQuery(invitationId);
const edit = useEditApplicationAnswer(invitationId);
const approve = useApproveApplication(invitationId);

const payload = computed(() => review.data.value?.payload ?? null);
const state = computed(() => review.data.value?.state ?? "filling");
const editable = computed(() => review.data.value?.editable === true);
const edits = computed(() => review.data.value?.edits ?? []);

const summary = computed(() => {
  if (!payload.value) return [];
  // Through the same converter the driver's own page uses on resume, so a draft saved before the
  // state picker existed is normalised the same way for both of them.
  return buildReviewSummary({
    draft: fromDraftPayload(payload.value),
    questionnaire: questionnaireForApplicant(),
    captures: [],
  });
});

const fields = computed(() => editableFields(payload.value, questionnaireForApplicant()));

/**
 * The paths already corrected, for the answer list's mark.
 *
 * ⚠ The mark is on the CORRECTION LIST and not on the summary above it, deliberately. The summary
 * groups several fields into one readable line — "Where" is an employer's street, city and state
 * together — so a summary row has no single path, and marking it by matching label text would mark
 * the scalar rows and silently miss every composite one. A half-working mark on a document somebody
 * is about to swear to is worse than none.
 */
const corrected = computed(() => new Set(edits.value.map((e) => pathKey(e.path))));

const tone = computed(() =>
  state.value === "awaiting_review" ? "warning" : state.value === "certified" ? "success" : "info",
);

async function save(path: ApplicationPath, value: string | boolean): Promise<void> {
  try {
    await edit.mutateAsync({ path, value });
    toast.push("success", `${describeField(path)} corrected`);
  } catch (e) {
    toast.push("error", e instanceof Error ? e.message : "That change could not be saved.");
  }
}

/**
 * The application as a printable page, at any stage before it is filed (F6).
 *
 * ── WHY A BUTTON AND NOT THE BROWSER'S PRINT ──────────────────────────────────────────────────
 * Printing this drawer would print a drawer. What the office needs is the §391.21 document — the one
 * that will be filed, in the regulation's own order, with the releases already signed — which is what
 * the API renders, watermarked DRAFT on every page. Printing what somebody will actually sign is also
 * the only honest thing to put in front of a reader who has no login.
 *
 * ⚠ Hidden once the application is filed, and that is not tidiness. The filed PDF is the copy in the
 * qualification file: hashed, cited by its §391.51(b)(1) record, and offered on this same page under
 * "Application received". The server refuses a preview of it for the same reason, so a button here
 * would only produce the API's refusal.
 */
const canPreview = computed(() => Boolean(payload.value) && state.value !== "certified");

async function openPreview(): Promise<void> {
  try {
    await openPdf(`/api/recruitment/applications/${encodeURIComponent(invitationId.value ?? "")}/preview.pdf`);
  } catch (e) {
    toast.push("error", e instanceof Error ? e.message : "That could not be opened.");
  }
}

async function approveIt(): Promise<void> {
  try {
    await approve.mutateAsync();
    toast.push("success", "Approved — the applicant has been asked to sign it");
  } catch (e) {
    toast.push("error", e instanceof Error ? e.message : "That could not be approved.");
  }
}
</script>

<template>
  <SlideOver
    :open="open"
    title="The application"
    description="What the applicant answered, and anything you have corrected."
    size="xl"
    @close="emit('close')"
  >
    <div class="space-y-6">
      <div class="flex flex-wrap items-center gap-3">
        <span :class="[BADGE_BASE, toneClass(tone)]">
          {{ APPLICATION_REVIEW_STATE_LABELS[state] }}
        </span>
      </div>

      <p v-if="review.isLoading.value" class="text-sm text-ink-muted">Loading…</p>

      <AppCallout v-else-if="state === 'filling'" tone="info">
        The applicant is still filling this in. You will be able to read it and correct it once they
        send it to you.
      </AppCallout>

      <!-- ⚠ Says WHY the controls are gone rather than simply not rendering them. -->
      <AppCallout v-else-if="state === 'approved'" tone="caution">
        You approved this and asked the applicant to sign it, so the answers are fixed now. If
        something still needs changing, ask them for a new application.
      </AppCallout>
      <AppCallout v-else-if="state === 'certified'" tone="success">
        Signed and filed. These answers are part of the qualification file.
      </AppCallout>

      <template v-if="summary.length">
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
              <!-- `min-w-0` + `break-words` on both halves: a driver's answer is arbitrary text, and
                   an unbroken 40-character employer name is how a summary row escapes its card. -->
              <span class="min-w-0 break-words text-ink-muted">
                {{ entry.label }}
              </span>
              <span
                class="min-w-0 break-words sm:text-right"
                :class="entry.muted ? 'text-ink-tertiary' : 'text-ink'"
              >
                {{ entry.value }}
              </span>
            </div>
          </div>
        </section>
      </template>

      <!-- Correcting answers. Every field the payload carries, addressed by its contract path, which
           is the same vocabulary the driver's errors and the edit log use. -->
      <section v-if="editable && fields.length" class="space-y-3">
        <div>
          <h3 class="text-sm font-semibold text-ink">Correct an answer</h3>
          <p class="mt-1 text-xs text-ink-muted">
            Each change is saved on its own, and the applicant is shown what you changed before they
            sign.
          </p>
        </div>
        <ApplicationAnswerList
          :fields="fields"
          :corrected="corrected"
          :pending="edit.isPending.value"
          @save="save"
        />
      </section>

      <!-- What has been changed, and when. §391.21(b)(12) is the applicant's own statement that the
           entries are true, so a correction is something somebody has to be able to account for. -->
      <section v-if="edits.length" class="space-y-2">
        <h3 class="text-sm font-semibold text-ink">What you changed</h3>
        <ul class="space-y-2">
          <li
            v-for="(row, i) in edits"
            :key="i"
            class="rounded-surface bg-surface-muted p-3 text-sm"
          >
            <p class="font-medium text-ink">{{ describeField(row.path) }}</p>
            <p class="break-words text-ink-muted">
              <span class="line-through">{{ row.before ?? "—" }}</span>
              →
              <span class="text-ink">{{ row.after ?? "—" }}</span>
            </p>
            <p class="text-2xs text-ink-tertiary">{{ formatDateTime(row.editedAt) }}</p>
          </li>
        </ul>
      </section>
    </div>

    <template #footer>
      <!-- Stacked on a phone, with the primary action at the BOTTOM where a thumb is, and side by
           side from `sm` up. Wrapping them instead put "Close" above "Approve" at 320px, which reads
           as the wrong order and is the harder one to reach. -->
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
        <BaseButton variant="secondary" class="w-full sm:w-auto" @click="emit('close')">
          Close
        </BaseButton>
        <BaseButton v-if="canPreview" variant="secondary" class="w-full sm:w-auto" @click="openPreview">
          Open as a PDF
        </BaseButton>
        <BaseButton
          v-if="editable"
          variant="primary"
          class="w-full sm:w-auto"
          :disabled="approve.isPending.value"
          @click="approveIt"
        >
          {{ approve.isPending.value ? "Approving…" : "Approve and send for signing" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
