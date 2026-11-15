import type { DashboardWidget } from "@silvicom/shared";

/**
 * Whether a tab's cards are PACKED down columns instead of laid on the twelve-column grid, and at
 * what span (SMALL-SCREENS-PLAN.md D-SM12; the long form is beside its caller in `TabWidgets.vue`).
 *
 * Its own module so the rule is testable without mounting ten cards and their ten reads: the answer
 * depends on the spans alone. Null means "grid" — a lone card, a full-width card, or any mix.
 */
export function packedSpanOf(widgets: readonly Pick<DashboardWidget, "span">[]): number | null {
  const spans = widgets.map((w) => (typeof w.span === "number" ? w.span : 12));
  const first = spans[0];
  return first !== undefined && first < 12 && spans.length > 1 && spans.every((s) => s === first) ? first : null;
}
