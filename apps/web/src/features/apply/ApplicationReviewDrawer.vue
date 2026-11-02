<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { AppButton as BaseButton, AppCallout, QueryState } from "@silvicom/ui";
import {
  APPLICATION_REVIEW_STATE_LABELS,
  formatDisplayDate,
  questionnaireForApplicant,
  type ApplicationPath,
} from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import DocumentPreview from "@/components/DocumentPreview.vue";
import type { RenderedDocument } from "@/lib/documentDownload";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import { useToastStore } from "@/stores/toast";
import { fromDraftPayload } from "./draft";
import { applyPartOne } from "./partOneFacts";
import { buildReviewSummary } from "./reviewSummary";
import { describeField } from "./fieldLabels";
import { editableFields, pathKey } from "./editableFields";
import { employerName } from "./officeJobs";
import OfficeJobsSection from "./OfficeJobsSection.vue";
import PartOneCorrection from "./PartOneCorrection.vue";
import ApplicationAnswerList from "./ApplicationAnswerList.vue";
import {
  useApplicationReviewQuery,
  useApproveApplication,
  type ApprovalNotice,
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
 * ── THE WINDOW, SHOWN RATHER THAN ASSUMED (§9 P5, Q-WF5) ─────────────────────────────────────
 * The office edits from the moment it SENDS the form until the driver makes the first mark on the
 * packet — before the applicant has sent it (a recruiter on the phone typing the jobs in, EM-1) and
 * after approval (EM-4). Every change is shown to the driver before they sign. The controls follow
 * `editable`, and when they are gone the reason is on the page. Every write names the revision it
 * was made against, so the applicant's autosave and the office never overwrite each other (§8.1).
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
const revision = computed(() => review.data.value?.revision ?? 0);

const summary = computed(() => {
  if (!payload.value) return [];
  // Through the same converter the driver's own page uses on resume, so a draft saved before the
  // state picker existed is normalised the same way for both of them — and, on a v2 application, with
  // Part 1's facts laid over it the same way too (C3c2c2), so the office reads what filing will file.
  const draft = fromDraftPayload(payload.value);
  const facts = review.data.value?.partOne;
  if (facts) applyPartOne(draft, facts);
  return buildReviewSummary({
    draft,
    questionnaire: questionnaireForApplicant(),
    captures: [],
  });
});

// C3c2c2: on a v2 application, the answers filing takes from Part 1 are not offered — a correction
// there would be filed over. They are corrected at their source instead: `PartOneCorrection` (Q-AW36),
// and the date of birth beside the permissions.
//
// HW5b: the jobs are corrected in the one employer form below (`OfficeJobsSection`), not here — the
// same answer offered in two places is two ways to disagree about it.
const fields = computed(() =>
  editableFields(payload.value, questionnaireForApplicant(), Boolean(review.data.value?.partOne))
    .filter((f) => f.path[0] !== "employers"));
/** "Something wrong? Tell us" (C3c2c2): the applicant's note about a Part 1 fact they could only read. */
const correctionNote = computed(() => {
  const note = (payload.value as { correction_note?: unknown } | null)?.correction_note;
  return typeof note === "string" && note.trim() !== "" ? note.trim() : null;
});

/** The jobs on the draft, as rows — with their key, which every edit to one names (Q-AX7). */
const employers = computed(() => {
  const list = (payload.value as { employers?: unknown[] } | null)?.employers;
  return (Array.isArray(list) ? list : []).filter(
    (e): e is Record<string, unknown> => Boolean(e) && typeof e === "object",
  );
});
const givenGaps = computed(
  () => (payload.value as { employment_gaps?: Array<{ from: string; explanation?: string }> } | null)?.employment_gaps ?? [],
);

/** "What you changed": an employer named by key is named by the job, which is what a recruiter reads. */
function changeLabel(row: { path: ApplicationPath; before: unknown; after: unknown }): string {
  const [head, ref] = row.path;
  if (head === "employers" && typeof ref === "string") {
    const index = employers.value.findIndex((e) => e.key === ref);
    const named = (index >= 0 ? employers.value[index] : (row.before ?? row.after)) as Record<string, unknown> | null;
    const job = named ? employerName(named) : "A job";
    if (row.path.length === 2) return row.after === null ? `${job} removed` : `${job} added`;
    return `${job} · ${describeField(["employers", 0, row.path[2]!]).split(" · ")[1] ?? String(row.path[2])}`;
  }
  if (head === "employment_gaps") return `Gap from ${formatDisplayDate(String(ref))}`;
  return describeField(row.path);
}
const shownValue = (v: unknown): string =>
  v === null || v === undefined ? "—" : typeof v === "object" ? employerName(v as Record<string, unknown>) : String(v);

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
    await edit.mutateAsync({ path, value, revision: revision.value });
    toast.push("success", "Answer corrected");
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

/**
 * ⚠ Read BESIDE the record, not in a new browser tab (B8).
 *
 * This used to be `openPdf`, which fetches the bytes with the session token and hands them to
 * `window.open`. It worked, and it cost the reviewer the thing they were reading the document
 * AGAINST: the drawer's scroll position, the correction list, and which field they were half way
 * through checking. A reviewer comparing a PDF to a form is doing one job, and a tab switch makes it
 * two. The drawer stays mounted underneath, so closing the viewer returns them exactly where they
 * were — which is the whole of B8's done-when.
 */
const previewing = ref(false);
// Reopening the drawer, or moving to another applicant, starts on the record — never on a PDF left
// open from the last one, which would otherwise be the first thing a recruiter saw of a new person.
watch([() => props.open, invitationId], () => {
  previewing.value = false;
});
const previewDocument = computed<RenderedDocument | null>(() =>
  invitationId.value === null
    ? null
    : {
        path: `/api/recruitment/applications/${encodeURIComponent(invitationId.value)}/preview.pdf`,
        filename: "application-preview.pdf",
      },
);

/**
 * What the recruiter is told about the message to the applicant (Q-AX4).
 *
 * ⚠ The old copy read "Approved — the applicant has been asked to sign it" and nothing had asked them
 * anything: until the approval notice shipped, the only thing carrying that news was the driver
 * reopening their own link on the off-chance. So each outcome now gets its own sentence, and the two
 * that need a human say so — `no_address` and `send_failed` leave a driver who is ALLOWED to sign
 * with no way of knowing, which is the one state this two-visit flow exists to prevent.
 *
 * `already_notified` is a double-click, not a problem: the first approval sent it.
 *
 * ⚠ AF5 (D-AF3): nobody is "asked to sign" by approval any more — the email tells the applicant they
 * are approved and will sign in the office, and signing opens only when the office presses Send for
 * signing on the checklist's packet row (D-AW14). So the toasts say what was told, and what the office owes.
 */
function noticeToast(notice: ApprovalNotice): void {
  if (notice.sent) {
    const also = notice.texted ? " and texted" : "";
    toast.push("success", `Approved — ${notice.email} has been emailed${also}. Send it for signing when they are in the office.`);
    return;
  }
  if (notice.reason === "already_notified") {
    toast.push("success", "Approved — the applicant has already been told");
    return;
  }
  const chase = "Call them to arrange their visit to the office — that is where they sign.";
  if (notice.reason === "no_address") {
    toast.push("warning", "Approved, but we have no email address for this applicant", chase);
    return;
  }
  toast.push("warning", `Approved, but we could not email ${notice.email ?? "the applicant"}`, chase);
}

async function approveIt(): Promise<void> {
  try {
    noticeToast(await approve.mutateAsync());
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

      <!-- D-US5: everything below waits on the read. A failed read used to fall through to
           `state`'s default and tell the reviewer the applicant was "still filling this in" — a
           sentence about the applicant that was really about the network. -->
      <QueryState
        :loading="review.isLoading.value"
        :error="review.isError.value ? review.error.value : null"
        :retrying="review.isFetching.value"
        loading-text="Loading the application…"
        error-text="Could not load the application."
        @retry="review.refetch()"
      >
        <AppCallout v-if="state === 'filling'" tone="info">
          The applicant is still filling this in. You can type in what they tell you on the phone — they
          see every change before they sign.
        </AppCallout>

        <!-- ⚠ Says what still moves and until when, rather than simply rendering controls. -->
        <AppCallout v-else-if="state === 'approved' && editable" tone="info">
          Approved. You can still correct it until the applicant starts signing; they are shown every
          change first.
        </AppCallout>
        <AppCallout v-else-if="state === 'approved'" tone="caution">
          The applicant has started signing, so the answers are fixed now. If something still needs
          changing, ask them for a new application.
        </AppCallout>
        <AppCallout v-else-if="state === 'certified'" tone="success">
          Signed and filed. These answers are part of the qualification file.
        </AppCallout>

        <!-- C3c2c2: before the answers — it may say one of them is wrong. The correction it asks for sits
             right under it (Q-AW36), open while the office can still correct anything: until approval. -->
        <AppCallout v-if="correctionNote" tone="caution" data-correction-note>
          <p class="font-medium">The applicant says something from the start of their application is wrong:</p>
          <p class="mt-1 whitespace-pre-line">{{ correctionNote }}</p>
        </AppCallout>
        <PartOneCorrection
          v-if="invitationId && review.data.value?.partOne && state !== 'certified'"
          :invitation-id="invitationId"
          :facts="review.data.value.partOne"
        />

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

        <!-- HW5b: the jobs on one timeline, and the one employer form — the applicant's own panel — for
             adding a job (with its street, EM-3), changing or filling any answer, removing one after a
             confirm, and explaining a gap. Read-only once the window has closed. -->
        <OfficeJobsSection
          v-if="invitationId && (employers.length || editable)"
          :invitation-id="invitationId"
          :employers="employers"
          :given-gaps="givenGaps"
          :revision="revision"
          :v2="Boolean(review.data.value?.partOne)"
          :editable="editable"
        />

        <!-- ⚠ INSIDE the drawer's body, and that placement is the whole fix (B8, measured 2026-09-18).
             As a sibling of `SlideOver` it rendered correctly and still broke: HeadlessUI decides which
             dialog owns Escape from the DOM TREE, and two dialogs that are siblings are both "topmost",
             so one Escape closed the viewer AND the drawer behind it — throwing the reviewer out of the
             record, which is the one thing this step exists to prevent. Nested in the tree, HeadlessUI
             registers the viewer as the child and Escape closes only it. Both dialogs still portal to
             the body, so nesting here costs nothing in layout. -->
        <DocumentPreview
          :open="previewing"
          label="Application preview"
          :rendered="previewDocument"
          @close="previewing = false"
        />

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
              <p class="font-medium text-ink">{{ changeLabel(row) }}</p>
              <p v-if="row.path.length !== 2 || row.path[0] !== 'employers'" class="break-words text-ink-muted">
                <span class="line-through">{{ shownValue(row.before) }}</span>
                →
                <span class="text-ink">{{ shownValue(row.after) }}</span>
              </p>
              <p class="text-2xs text-ink-tertiary">{{ formatDateTime(row.editedAt) }}</p>
            </li>
          </ul>
        </section>
      </QueryState>
    </div>

    <template #footer>
      <!-- Stacked on a phone, with the primary action at the BOTTOM where a thumb is, and side by
           side from `sm` up. Wrapping them instead put "Close" above "Approve" at 320px, which reads
           as the wrong order and is the harder one to reach. -->
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
        <BaseButton variant="secondary" class="w-full sm:w-auto" @click="emit('close')">
          Close
        </BaseButton>
        <BaseButton
          v-if="canPreview"
          variant="secondary"
          class="w-full sm:w-auto"
          @click="previewing = true"
        >
          Open as a PDF
        </BaseButton>
        <BaseButton
          v-if="editable && state === 'awaiting_review'"
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
