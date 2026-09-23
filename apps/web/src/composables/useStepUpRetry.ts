import { ref } from "vue";

/**
 * "Confirm your password, then the same action runs" — for a page whose buttons hit step-up routes.
 *
 * `apiFetch` already attaches a held step-up token to every request (`lib/stepUp.ts`), so the only
 * thing a page needs is to turn a `step_up_required` refusal into `<StepUpPrompt>` and re-run what
 * was refused once the password is confirmed. `PspOrderDrawer.vue` and `CardOperationDrawer.vue` each
 * do that for ONE action; a settings page has several (enable, disable, upload, activate, rollback,
 * withdraw), and repeating the hold/retry/cancel triple per button is how one of them gets missed.
 *
 * Found by the 2026-09-22 EFS security audit: `EfsSoapPage.vue` called two step-up routes with no
 * prompt at all, so an admin without a live token got "Could not save credentials" and no way on.
 *
 * The refusal must arrive as an Error carrying `code` — the `Object.assign(new Error(message),
 * { code, message })` shape `usePspOrder.ts` throws. A bare `new Error(message)` loses the code and
 * this cannot tell a step-up refusal from any other failure.
 */
export function useStepUpRetry() {
  /** The API's own sentence for why a password is needed; non-null while the prompt is showing. */
  const stepUpFor = ref<string | null>(null);
  let pending: (() => Promise<void>) | null = null;

  /**
   * Call first in a `catch`. True when the error was a step-up refusal — the prompt is now showing
   * and `retry` will run on confirmation, so the caller returns without reporting an error.
   */
  function holdForStepUp(error: unknown, retry: () => Promise<void>): boolean {
    const refusal = error as { code?: string; message?: string } | null;
    if (refusal?.code !== "step_up_required") return false;
    stepUpFor.value = refusal.message ?? "Confirm your password to continue.";
    pending = retry;
    return true;
  }

  async function confirmed(): Promise<void> {
    const retry = pending;
    pending = null;
    stepUpFor.value = null;
    await retry?.();
  }

  function cancel(): void {
    pending = null;
    stepUpFor.value = null;
  }

  return { stepUpFor, holdForStepUp, confirmed, cancel };
}

/** The refusal shape `holdForStepUp` reads: an Error that also carries the API's `code`. */
export function apiRefusal(error: { code?: string; message?: string } | undefined, fallback: string): Error {
  const message = error?.message ?? fallback;
  return Object.assign(new Error(message), { code: error?.code ?? "request_failed", message });
}
