import { computed, nextTick, ref, watch, type Ref } from "vue";
import { currentEditPaths, sectionOwningPath, type ApplicationPath, type AskAgainView } from "@silvicom/shared";
import { toDraftPayload, type ApplicationDraft } from "./draft";
import { describeField, fieldId, type FieldPath } from "./fieldLabels";
import { publicFetch } from "./useApplication";
import type { SectionIssue } from "./useApplicationWizard";
import { APPLY_COPY } from "./strings";

/**
 * The office asked the driver one question again (APPLICATION-FIX-PLAN.md F5; migration 0607) — the
 * driver's page: which screen, the way to the answer and back, and "Send my answer".
 *
 * ── WHERE IT SITS ─────────────────────────────────────────────────────────────────────────────
 * After the driver's Send the page is a wait screen. While a question is open it is the questions
 * instead (`asking`). "Answer it" takes the driver INTO their application, at the screen that asks that
 * answer — so the page stops being "waiting" for as long as they are there (`answering`), which lets
 * the ordinary chain run: the date-of-birth gate if the draft is behind it, then the form.
 *
 * ── THE ANSWER IS THE DRAFT'S ─────────────────────────────────────────────────────────────────
 * Nothing is typed into the question. The driver changes their answer where every answer lives, it
 * saves as every answer does, and "Send my answer" only tells the office it is now the one they asked
 * for. An answer the driver leaves as it was is still an answer: "it was right".
 *
 * ⚠ Sent only after the driver has opened it (`opened`). The button is not offered before: a tap on
 * "Send my answer" from a question nobody looked at would tell the office something untrue.
 */

/** The draft holds the carrier's and the paper's extra answers under this key; the contract under the other. */
const DRAFT_ANSWERS = "questionnaire";

/** The office names a row by its key; the form by its place. A row the driver has since removed has none. */
export function askAgainFieldPath(path: ApplicationPath, draft: ApplicationDraft): FieldPath {
  // A job is named by its key since §9 P5 and is not one of the keyed row lists `currentEditPaths` places
  // (those came with Q-AM15), so it is found here, in the driver's own list.
  const job = path[0] === "employers" && typeof path[1] === "string" ? draft.employers.findIndex((e) => e.key === path[1]) : -1;
  if (job >= 0) return ["employers", job, ...path.slice(2)];
  const now = currentEditPaths([{ path, before: null, after: null, editedAt: "" }], toDraftPayload(draft))[0];
  const placed = now && !now.gone ? now.path : path;
  return placed[0] === DRAFT_ANSWERS ? ["questionnaire_answers", ...placed.slice(1)] : placed;
}

/** Where the answer is asked, as the form's own "take me to this box" understands it. */
export function askAgainIssue(q: Pick<AskAgainView, "path">, draft: ApplicationDraft): SectionIssue {
  const path = askAgainFieldPath(q.path, draft);
  return {
    path, key: String(path[0] ?? ""), message: "", say: "", label: describeField(path), fieldId: fieldId(path),
    section: sectionOwningPath(path),
  };
}

export const sendAskAgainAnswer = (token: string, questionId: string): Promise<{ question: AskAgainView }> =>
  publicFetch<{ question: AskAgainView }>(`/${token}/ask-again/${questionId}/answer`, { method: "POST" });

export function useAskAgain(opts: {
  token: Ref<string>;
  /** The open questions the link served. */
  questions: () => readonly AskAgainView[] | undefined;
  draft: ApplicationDraft;
  /** Handed over and not yet approved: the only time a question can be open. */
  awaitingReview: Ref<boolean>;
  /** The draft is restored and the form can be shown (after the gate, when there was one). */
  formReady: Ref<boolean>;
  /** The task list is on screen — where a finished or abandoned task returns to. */
  atList: Ref<boolean>;
  showIssue: (issue: SectionIssue) => Promise<void>;
  /** Every answer typed so far is on the server. */
  flush: () => Promise<void>;
  refetch: () => Promise<unknown>;
  /** The call that tells the office. Injectable so the walk can be tested without the network. */
  sendAnswer?: typeof sendAskAgainAnswer;
}) {
  const open = computed(() => (opts.awaitingReview.value ? [...(opts.questions() ?? [])] : []));
  /** The question the driver is in their application for, or null on the questions screen. */
  const answering = ref<AskAgainView | null>(null);
  /** Which questions the driver has opened this visit — only those may be sent. */
  const opened = ref<string[]>([]);
  const sending = ref<string | null>(null);
  const failed = ref<string | null>(null);
  let shown = false;

  /** The questions screen is on show. */
  const asking = computed(() => open.value.length > 0 && answering.value === null);

  function answer(q: AskAgainView): void {
    [failed.value, shown] = [null, false];
    answering.value = q;
    if (!opened.value.includes(q.id)) opened.value = [...opened.value, q.id];
  }
  function back(): void {
    answering.value = null;
    globalThis.scrollTo?.({ top: 0 });
  }

  // Into the application, once it can be shown: after the gate and the restore, never before.
  watch(
    [answering, opts.formReady],
    async ([q, ready]) => {
      if (!q || !ready || shown) return;
      shown = true;
      await nextTick();
      await opts.showIssue(askAgainIssue(q, opts.draft));
    },
    { flush: "post" },
  );
  // A task closed or left lands on the list: that is the driver done with this answer.
  watch(opts.atList, (list, was) => {
    if (list && was === false && answering.value && shown) back();
  });

  async function send(q: AskAgainView): Promise<void> {
    [sending.value, failed.value] = [q.id, null];
    try {
      await opts.flush();
      await (opts.sendAnswer ?? sendAskAgainAnswer)(opts.token.value, q.id);
      await opts.refetch();
    } catch (e) {
      // Taken back by the office, or answered on another screen: the list is simply out of date.
      if ((e as { code?: string }).code === "question_not_open") await opts.refetch();
      else failed.value = APPLY_COPY.askAgain.failed;
    } finally {
      sending.value = null;
    }
  }

  return { open, asking, answering, opened, sending, failed, answer, back, send };
}
