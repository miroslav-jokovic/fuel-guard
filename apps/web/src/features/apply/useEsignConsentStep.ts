import { computed, ref, type Ref } from "vue";
import { giveEsignConsent, type ApplyInvitation } from "@/features/apply/useApplication";

/**
 * The 15 U.S.C. 7001(c) consent step's state and its one act (A4, D-APP5).
 *
 * Moved out of `ApplyPage.vue` on 2026-09-24 (AF4) when the page reached its 500-line budget. It is
 * the cleanest seam the page had: three refs, one computed and one action that nothing else in the
 * page touches, where the alternative was cutting the comments that explain the screen order.
 */
export function useEsignConsentStep(token: Ref<string>, invitation: Ref<ApplyInvitation | undefined>) {
  const consenting = ref(false);
  const consentFailed = ref(false);
  const consentGiven = ref(false);
  const esignConsent = computed(() => invitation.value?.esignConsent ?? null);
  /**
   * Asked for only when the server says it can be recorded — `required` is false while counsel's
   * wording is outstanding, and the page must not ask for a consent the API would refuse.
   */
  const consentNeeded = computed(
    () =>
      Boolean(esignConsent.value?.required)
      && !invitation.value?.phases?.consentedAt
      && !consentGiven.value,
  );

  async function agree(): Promise<void> {
    consenting.value = true;
    consentFailed.value = false;
    try {
      await giveEsignConsent(token.value);
      consentGiven.value = true;
    } catch {
      consentFailed.value = true;
    } finally {
      consenting.value = false;
    }
  }

  return { consenting, consentFailed, esignConsent, consentNeeded, agree };
}
