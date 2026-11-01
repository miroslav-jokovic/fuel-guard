import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * The product's "are you sure?" (D-US7, docs/plans/design-system/UI-STANDARDIZATION.md).
 *
 * ── WHY NOT `window.confirm` ───────────────────────────────────────────────────────────────────
 * On 2026-10-13 twenty-one actions — retire a truck, remove users, discard an inspection, delete a
 * plan — asked through the browser's own dialog: grey, unthemed, titled with the site's address, its
 * buttons always "OK"/"Cancel" whatever the act, and no way to mark the one that destroys something.
 * It also blocks the page's thread, so a toast or a live map behind it freezes while it is open.
 *
 * ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
 * `ask()` returns a promise of the answer, so a call site reads exactly as the native one did —
 * `if (!(await ask({ … }))) return;` — and the one `ConfirmHost` mounted in `App.vue` draws it. One
 * question at a time: a second `ask` while one is open answers the first "no" rather than stacking two
 * dialogs (contract §10: confirmations replace, they do not stack).
 */
export interface ConfirmRequest {
  /** The question, as the dialog's title: "Retire truck 811?" */
  title: string;
  /** What happens, in a sentence or two — and what is kept. */
  message?: string;
  /** The verb on the button: "Retire", "Remove 3 users", "Discard". Never "OK". */
  confirmLabel: string;
  /** `danger` for an act that removes or cannot be undone; it draws the button red. */
  tone?: "danger" | "primary";
  /**
   * The word on the button that answers no. "Cancel" when absent. Given by a page that is not in
   * English — the applicant's link in Spanish (C4) asks its "remove this job?" with "Cancelar", and a
   * dialog half in one language and half in another reads as a mistake (HW5b, EM-5).
   */
  cancelLabel?: string;
}

interface Pending extends ConfirmRequest {
  resolve: (answer: boolean) => void;
}

export const useConfirmStore = defineStore("confirm", () => {
  const pending = ref<Pending | null>(null);

  function ask(request: ConfirmRequest): Promise<boolean> {
    pending.value?.resolve(false);
    return new Promise<boolean>((resolve) => {
      pending.value = { tone: "primary", ...request, resolve };
    });
  }

  function answer(yes: boolean): void {
    const current = pending.value;
    pending.value = null;
    current?.resolve(yes);
  }

  return { pending, ask, answer };
});

/** `const ask = useConfirm(); if (!(await ask({ title, confirmLabel, tone: "danger" }))) return;` */
export function useConfirm(): (request: ConfirmRequest) => Promise<boolean> {
  const store = useConfirmStore();
  return (request) => store.ask(request);
}
