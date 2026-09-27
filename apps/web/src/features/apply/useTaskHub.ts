import { computed, ref, type Ref } from "vue";
import type { ApplicationSection } from "@silvicom/shared";

/**
 * Part 2's navigation (APPLICATION-FLOW-V2-PLAN.md §6.4, D-AW11, C3c2a): a list of tasks, one open at a
 * time, and the list again on every return.
 *
 * ── A LAYER OVER THE WIZARD, NOT A SECOND ONE ─────────────────────────────────────────────────
 * The screens, their order, their validation and the high-water mark autosave stores are all
 * `useApplicationWizard`'s; this only decides whether the driver is looking at the LIST or at one task.
 * A legacy link never sees it (`enabled` false) and keeps the linear wizard it was sent.
 *
 * ⚠ The list opens first on every page load — "the hub opens on every return" (§6.4) — rather than on
 * the furthest screen, because a returning driver's question is "what is left?", and the list is the
 * answer to it. Leaving a task never validates (back is never gated, the wizard's rule); closing one with
 * "Save and continue" does, so a task is left Completed only on purpose.
 */
export interface TaskHubWizard {
  goTo: (section: ApplicationSection, keepIssues?: boolean) => void;
  check: () => boolean;
  setIssues: (issues: []) => void;
}

export function useTaskHub(wizard: TaskHubWizard, enabled: Ref<boolean>) {
  const atList = ref(true);
  const scrollToTop = (): void => globalThis.scrollTo?.({ top: 0, behavior: "smooth" });

  return {
    /** The task list is on screen. */
    showList: computed(() => enabled.value && atList.value),
    /** A task is on screen, inside the hub (so its buttons are the hub's, not the wizard's). */
    inTask: computed(() => enabled.value && !atList.value),
    open(section: ApplicationSection, keepIssues = false): void {
      wizard.goTo(section, keepIssues);
      atList.value = false;
    },
    /** "Save and continue": back to the list only when the task passes its own check. */
    finish(): void {
      if (!wizard.check()) return;
      atList.value = true;
      scrollToTop();
    },
    /** "Back to your application": never gated. */
    leave(): void {
      wizard.setIssues([]);
      atList.value = true;
      scrollToTop();
    },
  };
}
