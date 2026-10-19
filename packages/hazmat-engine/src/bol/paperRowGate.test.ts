import { describe, expect, it } from "vitest";
import { DS, ok, pline, rline, run } from "./paperAudit.fixtures.js";
import type { PrintedPaperLine } from "./paperTypes.js";

/**
 * No audit rule judges a paper against a table row the readers have not agreed on (READER-CORRECTNESS-PLAN,
 * 2026-10-19; `heldToItsRow` in auditPrintedPaper.ts). Metamorphic, so it trusts no list of which rules use
 * the row: for every fixture row, a rule whose answer CHANGES when the line is resolved to a different row
 * depends on the row — and such a rule must answer `cannot_tell` the moment any of the fields that chose the
 * row (id, name, class, PG) is unconfirmed. Production read 76979453 is the case: the readers split UN3254 /
 * UN3264, and the name rule told the shipper UN3254's name is "Tributylphosphane".
 */
const ROW_FIELDS: Array<keyof PrintedPaperLine> = ["idText", "psn", "hazardClass", "pg"];
const rows = DS.entries.flatMap((e) => e.pgRows.map((r) => ({ entryId: e.entryId, pg: (r.pg ?? null) as "I" | "II" | "III" | null, e })));

describe("every audit rule that rests on the table row waits for the row's fields", () => {
  it("answers cannot_tell, naming the field, on every rule whose verdict depends on the row", () => {
    const leaks: string[] = [];
    let dependent = 0;
    for (const row of rows) {
      const line = pline({ idText: `${row.e.idPrefix}${row.e.idNumber}`, psn: row.e.psnPrinted, hazardClass: row.e.hazardClass, pg: row.pg, quantity: { value: 100, unit: "lb" }, packageCount: 2, grossWeightLb: 120 });
      const at = (entryId: string, pg: "I" | "II" | "III" | null, fieldStates = {}) =>
        run({ lines: [[line, rline(ok(entryId, pg), { quantityUnit: "lb" })]], fieldStates }).filter((r) => r.lineIndex === 0);
      const own = at(row.entryId, row.pg);
      const other = rows.find((o) => o.entryId !== row.entryId)!;
      const wrong = at(other.entryId, other.pg);
      for (const field of ROW_FIELDS) {
        const gated = at(row.entryId, row.pg, { [`hazmat.lines[0].${field}`]: "check" });
        for (const r of own) {
          const w = wrong.find((x) => x.ruleId === r.ruleId)!;
          if (w.outcome === r.outcome && w.reason === r.reason && JSON.stringify(w.facts) === JSON.stringify(r.facts)) continue;
          dependent++;
          const g = gated.find((x) => x.ruleId === r.ruleId)!;
          const names = Array.isArray(g.facts.unconfirmed) && (g.facts.unconfirmed as string[]).includes(`hazmat.lines[0].${field}`);
          if (g.outcome !== "cannot_tell" || !names) leaks.push(`${r.ruleId} on ${row.entryId} judged with ${field} unconfirmed: ${g.outcome}/${g.reason}`);
        }
      }
    }
    expect(dependent).toBeGreaterThan(50);
    expect(leaks.slice(0, 10)).toEqual([]);
  });

  it("leaves a rule that does not use the row alone: the HM column still judges with the id unconfirmed", () => {
    const r = run({ lines: [[pline({ hmColumnMark: "X" }), rline(ok("UN1203-gasoline", "II"))]], fieldStates: { "hazmat.lines[0].idText": "check" } })
      .find((x) => x.ruleId === "paper_hm_column")!;
    expect(r.outcome).not.toBe("cannot_tell");
  });
});
