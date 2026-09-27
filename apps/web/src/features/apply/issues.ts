import { inject, provide, type InjectionKey, type Ref } from "vue";
import { fieldId, type FieldPath } from "./fieldLabels";
import type { SectionIssue } from "./useApplicationWizard";

/**
 * The screen's outstanding issues, reachable from any field on it (D-AX3).
 *
 * ── WHY PROVIDE/INJECT AND NOT A PROP ─────────────────────────────────────────────────────────
 * Every control on every screen needs the same list, and the seven field components already take a
 * `v-model` and nothing else. Threading one more prop through all of them — and through the rows
 * inside them — is the kind of plumbing that is done for six components and forgotten on the
 * seventh, and the seventh is then the one screen where errors silently stop appearing.
 *
 * ── THE DEFAULT IS EMPTY, ON PURPOSE ──────────────────────────────────────────────────────────
 * A field component mounted on its own — which is how most of them are tested — injects nothing and
 * gets a lookup that finds no errors. That is the honest answer for a component with no page around
 * it, and it means no test has to know this seam exists.
 */
const APPLY_ISSUES: InjectionKey<Readonly<Ref<SectionIssue[]>>> = Symbol("apply-issues");

export function provideApplyIssues(issues: Readonly<Ref<SectionIssue[]>>): void {
  provide(APPLY_ISSUES, issues);
}

export function useApplyIssues(): {
  errorFor: (path: FieldPath) => string | undefined;
  idFor: (path: FieldPath) => string;
  hasIssueWithin: (path: FieldPath) => boolean;
} {
  const issues = inject(APPLY_ISSUES, null);

  /**
   * ⚠ Matched on the DOM id rather than on the path array, and that is the point rather than a
   * shortcut. The id is also what `focusFirstIssue` calls `getElementById` with — so the control
   * that shows the message and the control the cursor lands in cannot be different ones, because
   * they are the same string. Comparing paths element by element would let them drift.
   */
  const errorFor = (path: FieldPath): string | undefined => {
    if (!issues) return undefined;
    const id = fieldId(path);
    return issues.value.find((issue) => issue.fieldId === id)?.say;
  };

  /**
   * Is anything wrong INSIDE this row — `["employers", 2]` — whichever of its fields it is (C3c2b)?
   * For a list whose rows are edited in a panel: the field the message belongs to is not on the page
   * until the panel opens, so the row itself has to say that something in it needs an answer. By id
   * prefix, for `errorFor`'s reason.
   */
  const hasIssueWithin = (path: FieldPath): boolean => {
    if (!issues) return false;
    const prefix = `${fieldId(path)}-`;
    return issues.value.some((issue) => issue.fieldId.startsWith(prefix));
  };

  return { errorFor, idFor: fieldId, hasIssueWithin };
}
