import type { DashboardWidget } from "@silvicom/shared";

/**
 * How a tab's cards are laid out: which runs are PACKED down columns and which stay on the
 * twelve-column grid (SMALL-SCREENS-PLAN.md D-SM12; the long form is beside its caller in
 * `TabWidgets.vue`).
 *
 * Its own module so the rule is testable without mounting ten cards and their ten reads: the answer
 * depends on the spans alone.
 *
 * ── A RUN, NOT A TAB (C2, 2026-11-15) ────────────────────────────────────────────────────────────
 * C1 asked one question of the whole tab — "are all the cards one span?" — which was true of
 * Operations only while nothing on it was full-width. C2 puts the fleet strip across the top, and a
 * tab-wide rule would have sent the nine cards under it back to stretched grid rows. So the tab is
 * cut at its full-width cards, and each run between them answers for itself:
 *
 *   · a run of ONE span that holds more cards than one row takes (`12 / span`) is packed — it wraps,
 *     and a wrapped grid is where rows stretch to their tallest card;
 *   · anything else stays on the grid: a full-width card, a mixed run (Fleet overview's 5 / 4 / 3),
 *     and a run that fits one row (its 6 / 6) — one row has nothing to pack, and two cards side by
 *     side read better ending on one line.
 *
 * Neighbouring grid pieces are one segment, so a tab with nothing to pack is one grid, as before.
 */
export interface LayoutSegment<W> {
  /** The span every card in a packed run shares; null for a grid segment. */
  packed: number | null;
  widgets: W[];
}

const spanOf = (w: Pick<DashboardWidget, "span">) => (typeof w.span === "number" ? w.span : 12);

export function layoutSegments<W extends Pick<DashboardWidget, "span">>(widgets: readonly W[]): LayoutSegment<W>[] {
  const out: LayoutSegment<W>[] = [];
  const push = (packed: number | null, ws: W[]) => {
    const last = out[out.length - 1];
    if (packed === null && last && last.packed === null) last.widgets.push(...ws);
    else out.push({ packed, widgets: [...ws] });
  };
  let run: W[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const first = spanOf(run[0]!);
    const packs = run.every((w) => spanOf(w) === first) && run.length > 12 / first;
    push(packs ? first : null, run);
    run = [];
  };
  for (const w of widgets) {
    if (spanOf(w) >= 12) {
      flush();
      push(null, [w]);
    } else run.push(w);
  }
  flush();
  return out;
}
