import { describe, it, expect } from "vitest";
import {
  FIELD_BASELINE_LIFT,
  PACKET_FIELD_LINES,
  PACKET_FIELD_TABLES,
  PAGE_1_ADDRESS_COLUMNS,
  PAGE_1_ADDRESS_ROWS,
  PAGE_1_NAME_COLUMNS,
  fieldCell,
  fieldTableRowCount,
} from "./packetFieldGeometry.js";
import { readPacketTemplate, type TemplatePage } from "./packetTemplate.js";

/**
 * The field table, against the paper it was measured from.
 *
 * ⚠ **Same contract as `packetMarkGeometry.test.ts`, and the same limit.** Every position below is
 * asserted to EXIST in `assets/application-11.pdf`, so a re-export that moves the carrier's paper
 * fails the build by name rather than silently putting a date of birth across the printed question
 * beneath it. What it cannot check is that the right line was CHOSEN — that judgement was made by
 * drawing sample values in colour and looking at the rasterised page, and is recorded in each
 * entry's `source` and `note`.
 *
 * ⚠ **And three groups are unverifiable even in principle, which is stated rather than hidden:**
 * page 1's name and address column boundaries (one padded caption run over one long rule, so there
 * is nothing ruled to assert), and page 2's four `Yes______` / `No_______` marks (the blank is the
 * printed word's own underscores, not a rule). Those have their own tests below saying exactly
 * that.
 */

const pages: TemplatePage[] = await readPacketTemplate();

/** Horizontal rules on a page, de-duplicated — the producer strokes several of them twice. */
const rulesOn = (page: number): Array<{ x1: number; x2: number; y: number }> =>
  pages[page - 1]!.rules
    .filter((r) => Math.abs(r.y1 - r.y2) < 0.5)
    .map((r) => ({ x1: Math.min(r.x1, r.x2), x2: Math.max(r.x1, r.x2), y: r.y1 }));

/** Is there a rule at this y that covers this span? Tolerances are a point, the producer's own jitter. */
const ruleCovering = (page: number, y: number, x1: number, x2: number): boolean =>
  rulesOn(page).some((r) => Math.abs(r.y - y) <= 1.2 && r.x1 <= x1 + 1.2 && r.x2 >= x2 - 1.2);

/** The ids of every field the packet's four non-tabular pages carry, for the vocabulary assertions. */
const lineIds = PACKET_FIELD_LINES.map((l) => l.id);

describe("the field table, against the carrier's own pages", () => {
  it("puts every standalone field on a rule that is really there", () => {
    // ⚠ The page-2 Yes/No marks are excluded BY NAME rather than by a pattern: they are the entries
    // whose blank is a printed underscore, and they are asserted separately below.
    const onRules = PACKET_FIELD_LINES.filter(
      (l) => !/^p02\.(denied|revoked)\.(yes|no)$/.test(l.id),
    );
    expect(onRules.length).toBeGreaterThan(10);
    for (const l of onRules) {
      expect(ruleCovering(l.page, l.y, l.x1, l.x2), `${l.id} at (${l.x1}..${l.x2}, ${l.y})`).toBe(true);
    }
  });

  it("puts every table row on a rule that spans the whole grid", () => {
    for (const t of PACKET_FIELD_TABLES) {
      const left = t.columns[0]!;
      const right = t.columns[t.columns.length - 1]!;
      for (const y of t.rows) {
        expect(ruleCovering(t.page, y, left, right), `${t.id} row y=${y}`).toBe(true);
      }
    }
  });

  /**
   * ⚠ The column boundaries are VERTICAL rules, which is a different assertion from the row one and
   * the one that would catch a grid read a column out of step — the failure that puts every licence
   * number under `STATE`.
   */
  it("puts every bordered column boundary on a vertical rule", () => {
    const verticalsOn = (page: number): number[] =>
      pages[page - 1]!.rules
        .filter((r) => Math.abs(r.x1 - r.x2) < 0.5 && Math.abs(r.y1 - r.y2) > 1)
        .map((r) => r.x1);
    for (const t of PACKET_FIELD_TABLES) {
      for (const x of t.columns) {
        // ⚠ `p02.experience`'s 360.0 is the `TO` caption inside one bordered DATES column, not a
        // boundary, and the table's own note says so. Everything else is ruled.
        if (t.id === "p02.experience" && x === 360.0) continue;
        expect(verticalsOn(t.page).some((v) => Math.abs(v - x) <= 1.2), `${t.id} column x=${x}`).toBe(true);
      }
    }
  });

  it("puts page 1's address and residency values on the four rules the page really has", () => {
    for (const y of PAGE_1_ADDRESS_ROWS) {
      expect(ruleCovering(1, y, PAGE_1_ADDRESS_COLUMNS[0]!, 553.2), `address row y=${y}`).toBe(true);
    }
  });

  it("puts page 1's name on the one long rule under `Name`", () => {
    expect(ruleCovering(1, 509.4, PAGE_1_NAME_COLUMNS[0]!, 553.2)).toBe(true);
  });
});

describe("what this test cannot check, said out loud", () => {
  /**
   * ⚠ Page 1's `Last / First / Middle` and `Street / City / State / Zip` are ONE text run each,
   * padded with spaces over ONE rule. There is no ruled line under a column and no run whose x could
   * be read, so the boundaries were measured off a drawn coordinate ruler and confirmed by putting
   * values under the captions. All this can hold still is that they stay inside the rule, ordered,
   * and that the caption run they were measured against has not changed.
   */
  it("holds page 1's caption-aligned columns inside their rule and in order", () => {
    for (const cols of [PAGE_1_NAME_COLUMNS, PAGE_1_ADDRESS_COLUMNS]) {
      expect([...cols]).toEqual([...cols].sort((a, b) => a - b));
      expect(cols[0]).toBeGreaterThanOrEqual(102.5);
      expect(cols[cols.length - 1]).toBeLessThanOrEqual(553.2);
    }
  });

  it("pins the caption runs those columns were measured against", () => {
    const text = pages[0]!.runs.map((r) => r.text);
    expect(text.some((t) => /Last\s+First\s+Middle/.test(t))).toBe(true);
    expect(text.filter((t) => /Street\s+City\s+State\s+Zip/.test(t))).toHaveLength(4);
  });

  /**
   * ⚠ Page 2's A and B answers have no rule at all: `Yes______` and `No_______` are printed words
   * whose trailing underscores are the blank. What CAN be asserted is that those words are on the
   * page at the y the table records, which is the thing that would change if the page were re-laid.
   */
  it("pins page 2's Yes/No answers to the printed words they are written over", () => {
    const runs = pages[1]!.runs;
    for (const [id, word] of [
      ["p02.denied.yes", "Yes______"],
      ["p02.denied.no", "No_______"],
      ["p02.revoked.yes", "Yes______"],
      ["p02.revoked.no", "No_______"],
    ] as const) {
      const entry = PACKET_FIELD_LINES.find((l) => l.id === id)!;
      const baseline = entry.y + FIELD_BASELINE_LIFT;
      expect(
        runs.some((r) => r.text.startsWith(word.slice(0, 2)) && Math.abs(r.y - baseline) <= 1.2),
        `${id} over ${word} at y=${baseline}`,
      ).toBe(true);
    }
  });
});

describe("the vocabulary", () => {
  it("names every id once", () => {
    expect(new Set(lineIds).size).toBe(lineIds.length);
    const tableIds = PACKET_FIELD_TABLES.map((t) => t.id);
    expect(new Set(tableIds).size).toBe(tableIds.length);
  });

  /**
   * ⚠ **The Social Security number is absent from all three places the packet asks for it**, and
   * that is D-HIRE6 rather than an oversight. This asserts the absence, because an absence nothing
   * checks is one somebody adds back while filling in a gap.
   */
  it("carries no field for the Social Security number anywhere", () => {
    expect(lineIds.filter((id) => /ssn|social|ss_?#/i.test(id))).toEqual([]);
  });

  /**
   * ⚠ The counts are the CARRIER's, and this is the assertion that would fail if somebody "fixed"
   * the licence table to three rows to match the old renderer. Page 12's fifteen is what
   * §391.21(b)(10)'s ten years needs; `renderPacket.ts` gave it three.
   */
  it("records each grid's row count as the carrier's paper has it", () => {
    expect(fieldTableRowCount("p02.licences")).toBe(1);
    expect(fieldTableRowCount("p02.experience")).toBe(4);
    expect(fieldTableRowCount("p02.accidents")).toBe(3);
    expect(fieldTableRowCount("p02.convictions")).toBe(3);
    expect(fieldTableRowCount("p12.identity")).toBe(1);
    expect(fieldTableRowCount("p12.employment")).toBe(15);
    expect(fieldTableRowCount("p16.education")).toBe(4);
    expect(fieldTableRowCount("p16.references")).toBe(3);
  });
});

describe("reading a cell out of a grid", () => {
  it("gives the cell's own span and its row's rule", () => {
    const cell = fieldCell("p12.employment", 0, 1)!;
    expect(cell.page).toBe(12);
    expect(cell.x1).toBe(154.6);
    expect(cell.x2).toBe(257.8);
    expect(cell.y).toBe(524.6);
  });

  /**
   * ⚠ **Overflow returns null rather than clamping**, which is the whole of Q-PKT10's first half: a
   * fourth accident on a three-row table is something the caller has to decide about, and stacking
   * it on row three would put two answers on one line of a document somebody signs.
   */
  it("refuses a row the carrier's form does not have", () => {
    expect(fieldCell("p02.accidents", 3, 0)).toBeNull();
    expect(fieldCell("p02.licences", 1, 0)).toBeNull();
    expect(fieldCell("p12.employment", 15, 0)).toBeNull();
  });

  it("refuses a column past the last boundary, and an unknown grid", () => {
    // 5 boundaries is 4 columns, so column 4 is off the right edge.
    expect(fieldCell("p02.convictions", 0, 4)).toBeNull();
    expect(fieldCell("p99.nothing", 0, 0)).toBeNull();
  });
});
