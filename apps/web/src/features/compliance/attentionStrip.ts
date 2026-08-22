import type { DriverOverviewRow } from "@fuelguard/shared";

/**
 * The attention strip's five tiles (DQF plan C5) — pure so the counts are testable without
 * mounting the page. Each tile carries the fleet table's filter values it applies on click
 * (`state` → the table's stateFilter model, `due` → its dueFilter model): the strip is a
 * click-to-filter over the EXISTING filter model, never a second mechanism.
 *
 * ⚠ `tone` was removed in U3 (D-UI5). It existed only to colour a badge reading "filter"/"filtering"
 * on each tile — a status badge used as a toggle's label. The pressed state is `aria-pressed` and
 * the ring, so the tone had nothing left to colour.
 */
export interface AttentionTile {
  key: string;
  label: string;
  n: number;
  state: string;
  due: string;
}

const soonest = (d: DriverOverviewRow): number | null => {
  const dated = d.attention.filter((a) => a.daysRemaining !== null);
  return dated.length ? Math.min(...dated.map((a) => a.daysRemaining as number)) : null;
};

export function buildAttentionStrip(rows: readonly DriverOverviewRow[]): AttentionTile[] {
  const dueWithin = (days: number) =>
    rows.filter((d) => {
      const s = soonest(d);
      return s !== null && s >= 0 && s <= days;
    }).length;
  return [
    { key: "expired", label: "Expired", n: rows.filter((d) => d.counts.expired > 0).length, state: "expired", due: "" },
    { key: "due14", label: "Due in 14 days", n: dueWithin(14), state: "", due: "14" },
    { key: "due30", label: "Due in 30 days", n: dueWithin(30), state: "", due: "30" },
    { key: "not_started", label: "Not started", n: rows.filter((d) => d.state === "not_started").length, state: "not_started", due: "" },
    { key: "complete", label: "Files complete", n: rows.filter((d) => d.state === "complete").length, state: "complete", due: "" },
  ];
}
