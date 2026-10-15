import { vi } from "vitest";
import { getActivePinia, type Pinia } from "pinia";
import { useConfirmStore, type ConfirmRequest } from "../lists/confirm";

/**
 * Answer every `useConfirm()` question in a test (D-US7), and keep what was asked. Test-only, behind
 * `@silvicom/ui/testing` rather than the barrel (it imports vitest); shared by the web app's and the
 * admin console's suites since US7.
 *
 * Pass the same Pinia the component was mounted with (or leave it to the active one). The returned
 * spy's calls are the questions: assert on their `title`, `confirmLabel` and `tone` — the words and the
 * red button are the reason the browser's dialog was replaced, so a test should hold them.
 */
export function answerConfirm(answer: boolean, pinia?: Pinia) {
  const store = useConfirmStore(pinia ?? getActivePinia());
  return vi.spyOn(store, "ask").mockImplementation(async (_request: ConfirmRequest) => answer);
}
