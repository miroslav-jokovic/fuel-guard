import { computed, ref, type ComputedRef, type Ref } from "vue";
import { applicationBeforeCertificationSchema, driverApplicationSchema } from "@silvicom/shared";
import { toApplication, type ApplicationDraft } from "./draft";
import { issuesFromParse, type SectionIssue } from "./useApplicationWizard";
import { useRequestReview, useSubmitApplication } from "./useApplication";
import { APPLY_COPY } from "./strings";

/**
 * The two acts that end an application, and the validation in front of each.
 *
 * ── WHY THIS IS NOT IN `ApplyPage.vue` ────────────────────────────────────────────────────────
 * It was, until the page reached the 500-line budget and B7 needed room. It comes out as one piece
 * because it is one piece: a hand-off and a submission, the whole-document check they share, and the
 * three flags that say which of them has happened. Nothing here is about layout, and the page that
 * is left reads as what it is — the order the screens come in.
 *
 * ⚠ The move is behaviour-preserving by construction: the functions are the page's, unedited, and
 * `ApplyPage.test.ts` walks both paths end to end. A composable is the established shape for this
 * beside `useApplicationDraft`, `useApplicationWizard` and `useApplicationReview`.
 *
 * ── THE TWO ACTS ARE NOT THE SAME ACT (F4, D-AX11) ────────────────────────────────────────────
 * `sendForReview` hands the document to the office at the end of the FIRST visit and asks for no
 * signature. `send` certifies and files it on the SECOND, after the office has read it and corrected
 * anything it corrected. They check the document against two different schemas for that reason, and
 * the difference between those schemas is §391.21(b)(12).
 */
export interface ApplicationSending {
  /** What the server said when it refused, in the driver's own screen rather than a toast. */
  sendError: Ref<string | null>;
  /** Filed on this visit, in this tab — the other half of the answer `phases.submittedAt` gives. */
  justSent: Ref<boolean>;
  /** Handed to the office in this tab, likewise. */
  handedOver: Ref<boolean>;
  sending: ComputedRef<boolean>;
  handingOver: ComputedRef<boolean>;
  sendForReview: () => Promise<void>;
  send: () => Promise<void>;
}

export function useApplicationSending(
  token: Ref<string>,
  draft: ApplicationDraft,
  /** The wizard, for the one thing sending needs from it: somewhere to put what is missing. */
  wizard: { setIssues: (issues: SectionIssue[]) => void },
): ApplicationSending {
  const submit = useSubmitApplication(token);
  const handOff = useRequestReview(token);

  const sendError = ref<string | null>(null);
  const justSent = ref(false);
  const handedOver = ref(false);

  /**
   * The whole document, through the server's own schema — not the union of the per-screen checks.
   *
   * The last screen being valid is not the same thing as the application being complete. Each issue is
   * attributed to the screen that owns the field, so "employers" reads as somewhere to go back to, and
   * the candidate travels with them: `messageFor` needs the VALUE that failed to tell an empty box
   * ("This is needed") from a two-character one ("This is too short").
   */
  function documentIsComplete(): boolean {
    const candidate = toApplication(draft);
    // ⚠ WITHOUT the certification. On this visit the driver has not signed anything and must not have
    // to — `driverApplicationSchema` requires `certified` to be literally `true`, so checking with it
    // here would refuse every hand-off and tell the driver to tick a box that is not on their screen.
    const parsed = applicationBeforeCertificationSchema.safeParse(candidate);
    if (parsed.success) return true;
    wizard.setIssues(issuesFromParse(parsed.error.issues, candidate));
    globalThis.scrollTo({ top: 0, behavior: "smooth" });
    return false;
  }

  /**
   * Hand it to the office (F4, D-AX11) — the last act of the FIRST visit.
   *
   * ⚠ The certification is deliberately not asked for here. §391.21(b)(12) has the applicant swear
   * that every entry is true and complete, and the office can now correct an entry — so a signature
   * taken now would be a signature on a document that may not be the one filed. It is asked for on the
   * second visit instead, beside the changes.
   *
   * The completeness check still runs, against everything §391.21(b) requires except those two.
   */
  async function sendForReview(): Promise<void> {
    sendError.value = null;
    if (!documentIsComplete()) return;
    try {
      await handOff.mutateAsync();
      handedOver.value = true;
      globalThis.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      sendError.value = e instanceof Error ? e.message : APPLY_COPY.handoff.failed;
    }
  }

  /** Certify it and file it — the last act of the SECOND visit. */
  async function send(): Promise<void> {
    sendError.value = null;
    const candidate = toApplication(draft);
    const parsed = driverApplicationSchema.safeParse(candidate);
    if (!parsed.success) {
      wizard.setIssues(issuesFromParse(parsed.error.issues, candidate));
      globalThis.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    try {
      await submit.mutateAsync({
        application: parsed.data,
        // D-APP3: the one field that never entered a draft goes straight from the form to `sealSsn`.
        ssn: draft.ssn.trim() === "" ? null : draft.ssn.trim(),
      });
      justSent.value = true;
    } catch (e) {
      sendError.value = e instanceof Error ? e.message : APPLY_COPY.issues.sendFailed;
    }
  }

  return {
    sendError,
    justSent,
    handedOver,
    sending: computed(() => submit.isPending.value),
    handingOver: computed(() => handOff.isPending.value),
    sendForReview,
    send,
  };
}
