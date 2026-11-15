import type { CountRow } from "@/components/ui/CountList.vue";

/**
 * What "Needs action" lists, from the rows of the cards the reader may see
 * (SMALL-SCREENS-PLAN.md D-SM12; C2, 2026-11-15). Pure, so the rule is tested without ten reads.
 *
 * ── WHICH ROWS ───────────────────────────────────────────────────────────────────────────────────
 * A row its own card marks `alarm` — the mark that already means "this is wrong, not just a count"
 * and draws the figure in the danger ink there. Read from the row, never listed here: a card that
 * marks a new row an alarm tomorrow is in this list without a line changing.
 *
 * ⚠ …and whose figure is a COUNT. A row that prints a rate (`display`: "17%" vehicle out-of-service)
 * is left to its card: this list is ordered by how many things wait behind each door, and a
 * percentage has no place in that order — 17% is not more than 12 late loads. The inspections behind
 * the rate are not lost: Roadside's own "Needs action" row counts them and is listed.
 *
 * ── THREE ANSWERS, NOT TWO ───────────────────────────────────────────────────────────────────────
 * Above zero is listed, largest first (ties keep the tab's order). Zero is counted as clear. `null`
 * is neither — the read has not answered, and calling it clear would be the claim `CountList`
 * refuses to make with a dash — so it is counted apart and the card says so.
 */
export interface NeedsActionSource {
  /** The source card's widget key and its catalogue label ("Seats"). */
  key: string;
  label: string;
  /** Null until the source has reported. */
  rows: readonly CountRow[] | null;
}

export interface NeedsAction {
  rows: CountRow[];
  /** Alarm checks that answered zero. */
  clear: number;
  /** Alarm checks with no answer yet, plus one for each source that has not reported at all. */
  unknown: number;
}

export function needsAction(sources: readonly NeedsActionSource[]): NeedsAction {
  const rows: CountRow[] = [];
  let clear = 0;
  let unknown = 0;
  for (const s of sources) {
    if (s.rows === null) {
      unknown += 1;
      continue;
    }
    for (const r of s.rows) {
      if (!r.alarm || r.display !== undefined) continue;
      if (r.value == null) unknown += 1;
      else if (r.value <= 0) clear += 1;
      // The source card's name leads the caption: the label alone ("Needs action", "Overdue") does
      // not say whose it is once it has left its card.
      else rows.push({ ...r, key: `${s.key}.${r.key}`, caption: [s.label, r.caption].filter(Boolean).join(" · ") });
    }
  }
  // `sort` is stable, so equal counts stay in the tab's order.
  rows.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return { rows, clear, unknown };
}
