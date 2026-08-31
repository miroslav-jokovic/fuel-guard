import { describe, it, expect } from "vitest";
import { buildAttentionStrip } from "./attentionStrip";
import type { DriverOverviewRow } from "@silvicom/shared";

/** C5 — every tile's count derives from the same overview rows the table renders, so a tile and
 *  the rows its click reveals cannot disagree. The filter VALUES each tile applies are data here,
 *  pinned so a renamed table filter option breaks this test instead of silently dead tiles. */
const row = (over: Partial<DriverOverviewRow>): DriverOverviewRow => ({
  driver_id: "d1", driver_name: "A", driver_status: "active",
  state: "incomplete", counts: { current: 10, expiring: 0, expired: 0, missing: 0 },
  groups: [], attention: [], requirements: [], documents: { onFile: 0, of: 0 }, ...over,
});
const att = (daysRemaining: number | null) => ({
  key: "medical_card", label: "Medical card", citation: "", group: "medical" as const,
  state: "expiring" as const, goodUntil: null, evidenceDate: null, daysRemaining,
});

describe("buildAttentionStrip", () => {
  it("counts each tile from the overview rows, and due-14 nests inside due-30", () => {
    const tiles = buildAttentionStrip([
      row({ driver_id: "d1", counts: { current: 9, expiring: 0, expired: 1, missing: 0 }, attention: [att(-2)] }),
      row({ driver_id: "d2", attention: [att(10)] }),
      row({ driver_id: "d3", attention: [att(25)] }),
      row({ driver_id: "d4", state: "not_started" }),
      row({ driver_id: "d5", state: "complete" }),
    ]);
    const byKey = Object.fromEntries(tiles.map((t) => [t.key, t.n]));
    expect(byKey).toEqual({ expired: 1, due14: 1, due30: 2, not_started: 1, complete: 1 });
  });

  it("an overdue item is expired, never 'due in 14' — negative days stay out of the due tiles", () => {
    const tiles = buildAttentionStrip([row({ counts: { current: 9, expiring: 0, expired: 1, missing: 0 }, attention: [att(-2)] })]);
    expect(tiles.find((t) => t.key === "due14")!.n).toBe(0);
  });

  it("each tile carries the fleet table's filter values verbatim", () => {
    const tiles = buildAttentionStrip([]);
    expect(tiles.map((t) => [t.key, t.state, t.due])).toEqual([
      ["expired", "expired", ""],
      ["due14", "", "14"],
      ["due30", "", "30"],
      ["not_started", "not_started", ""],
      ["complete", "complete", ""],
    ]);
  });
});
