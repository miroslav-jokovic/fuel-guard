import { ref } from "vue";
import { APPLICATION_CAPTURE_REQUESTED, type ApplicationCaptureSlot } from "@silvicom/shared";

/**
 * What the carrier asks of THIS applicant, as the bundle served it (HIRING-WORKFLOW-AUDIT §11).
 *
 * ── WHY MODULE STATE, LIKE `applyLanguage` ─────────────────────────────────────────────────────
 * Seven readers take the questionnaire through `applicantQuestionnaire` (the screens, the review's
 * missing list, the task hub, the labels) and none of them is handed the bundle. Threading the stamp
 * through each would be seven copies of one argument; laying it over in the one function they already
 * share is one. The page serves one link at a time, so there is one value to hold.
 *
 * ⚠ The stamp is the invitation's (D-RS3), never the live setting, and the server lays its own copy over
 * whatever this page sends (D-RS4) — this is what the page SHOWS and checks, not what is trusted.
 */
/** The required questions stamped on the invitation; null = sent before the stamp (the definition decides). */
export const servedRequiredQuestions = ref<readonly string[] | null>(null);
/** The documents Part 2 asks for (D-RS6); every slot until a bundle says otherwise. */
export const servedDocumentSlots = ref<readonly ApplicationCaptureSlot[]>(APPLICATION_CAPTURE_REQUESTED);

/**
 * Taken from each bundle as it arrives. ⚠ Both optional: a bundle served before §11's reader has neither
 * key, and reads as "nothing stamped, every document" — what that server enforces.
 */
export function takeServedForm(bundle: {
  requiredQuestions?: readonly string[] | null;
  offeredDocumentSlots?: readonly ApplicationCaptureSlot[];
}): void {
  servedRequiredQuestions.value = bundle.requiredQuestions ?? null;
  servedDocumentSlots.value = bundle.offeredDocumentSlots ?? APPLICATION_CAPTURE_REQUESTED;
}
