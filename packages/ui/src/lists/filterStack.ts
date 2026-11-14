import { computed, inject, provide, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";

/**
 * Whether the filters a toolbar holds are stacked in its phone sheet (SMALL-SCREENS-PLAN.md D-SM8).
 *
 * Below `md` `FilterBar` shows the search and ONE "Filters" button; the page's `#filters` and `#more`
 * controls open in a sheet, one under the other, each the sheet's full width. A filter control is an
 * inline trigger as wide as its label — right for a toolbar line, wrong for a column, where four
 * triggers of four widths read as a ragged list. So the bar says "stacked" once and each control
 * (`FilterSelect`, `DateRangeFilter`) reads it and fills the line.
 *
 * Provided rather than passed, for the reason `touchTargets.ts` gives: 54 pages put 140 controls in
 * those two slots (counted 2026-11-14), and a `block` each of them had to remember to ask for is the
 * restated fact that goes missing on the fifty-fifth.
 */
const FILTER_STACK = Symbol("silvicom-ui-filter-stack");

/** `FilterBar` — true while its filters are the phone sheet's column. */
export function provideFilterStack(when: MaybeRefOrGetter<boolean>): void {
  provide(FILTER_STACK, when);
}

/** A filter control — whether to fill the line it is on. False outside a toolbar. */
export function useFilterStack(): ComputedRef<boolean> {
  const when = inject<MaybeRefOrGetter<boolean>>(FILTER_STACK, false);
  return computed(() => toValue(when));
}
