import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { INSPECTION_GROUPS, INSPECTION_ITEMS } from "@silvicom/shared";
import {
  CHECKBOX_CELLS,
  GROUP_HEADINGS,
  HEADER_CELLS,
  HEADING_SIZE,
  MAPPED_ITEM_COUNT,
  OTHER_CONDITIONS_LINES,
  PAGE_HEIGHT,
  baselineOf,
  cellsFor,
  mappedItemKeys,
  type Cell,
} from "./layouts/keller14834Rev0122.js";

/**
 * The coordinate map, checked as four properties rather than looked at (plan step A5).
 *
 * Every one of these exists because eyeballing a rendered page cannot see it. A printed report is
 * legible when a value has drifted half a millimetre into the next column, when a component quietly
 * has no cell and prints nothing, and when a repair date runs over the item text — the last of which
 * §2.5 caught only by measuring. So the acceptance criteria are measurements.
 */

const { font, bold } = await (async () => {
  const doc = await PDFDocument.create();
  return {
    font: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
})();

/** Which printed column a cell is in — the three groups start at 18 / 210 / 402. */
const COLUMN_STARTS = [18, 210, 402];
const columnOf = (x: number) =>
  COLUMN_STARTS.findIndex((start, i) => x >= start && x < (COLUMN_STARTS[i + 1] ?? 594));

describe("1. bijection — the map and the catalogue cover each other exactly", () => {
  it("has a cell for every catalogue component", () => {
    const missing = INSPECTION_ITEMS.filter((i) => !cellsFor(i.key)).map((i) => i.key);
    expect(missing).toEqual([]);
  });

  it("has no cell for anything the catalogue does not have", () => {
    const known = new Set(INSPECTION_ITEMS.map((i) => i.key));
    expect(mappedItemKeys().filter((k) => !known.has(k))).toEqual([]);
  });

  it("counts the same on both sides, so a Keller revision fails the build", () => {
    expect(MAPPED_ITEM_COUNT).toBe(INSPECTION_ITEMS.length);
    expect(MAPPED_ITEM_COUNT).toBe(56);
  });
});

describe("2. fit — every realistic value fits the box it is printed into", () => {
  const MARK_SIZE = 8;
  const HEADER_SIZE = 10;

  it("fits every result mark in the OK and NEEDS REPAIR columns", () => {
    for (const item of INSPECTION_ITEMS) {
      const cells = cellsFor(item.key)!;
      for (const mark of ["Ok", "N/A"]) {
        expect(font.widthOfTextAtSize(mark, MARK_SIZE), `${item.key} ${mark}`).toBeLessThanOrEqual(cells.ok.maxWidth);
      }
      expect(font.widthOfTextAtSize("X", MARK_SIZE), item.key).toBeLessThanOrEqual(cells.needsRepair.maxWidth);
    }
  });

  it("proves no full date fits the 24pt repair column, which is why `fit` exists", () => {
    const cell = cellsFor("brake.hose")!.repairedDate;
    // Every candidate overflows at the body size — this column is genuinely narrow, so the
    // renderer's shrink is the mechanism rather than a safety net. Measured off the blank's own
    // ruled lines; an earlier pass inferred 39.2pt from where the item text starts and was wrong.
    for (const value of ["06/16/2026", "06/16/26", "6/16/26"]) {
      expect(font.widthOfTextAtSize(value, MARK_SIZE), value).toBeGreaterThan(cell.maxWidth);
    }
    // ...and that the shrink lands somewhere LEGIBLE rather than at the 5.5pt floor, which is the
    // difference between a small date and an unreadable one. Same 0.25pt walk the renderer does.
    const sizeThatFits = (value: string): number => {
      let size = 8;
      while (size > 5.5 && font.widthOfTextAtSize(value, size) > cell.maxWidth) size -= 0.25;
      return size;
    };
    // A typical date lands at 6.75pt. The widest possible one — two-digit month AND day — lands at
    // 5.75pt, which is SMALL but not out of place: the form's own "NEEDS REPAIR / REPAIRED DATE"
    // column headers are 4.5pt type, measured off the blank. The column was drawn for a cramped
    // hand-written date and we are printing into it at more than the size Keller set above it.
    expect(sizeThatFits("6/16/26")).toBeGreaterThanOrEqual(6.5);
    // What actually matters: no date in the calendar is ever CLIPPED — the walk always settles
    // above the floor rather than bottoming out and overflowing anyway.
    for (const value of ["1/1/26", "6/16/26", "12/31/26", "10/10/26"]) {
      expect(sizeThatFits(value), value).toBeGreaterThan(5.5);
      expect(font.widthOfTextAtSize(value, sizeThatFits(value)), value).toBeLessThanOrEqual(cell.maxWidth);
    }
  });

  it("fits the longest realistic header values", () => {
    const longest: Array<[Cell, string]> = [
      [HEADER_CELLS.decalSerial, "610641628"],
      [HEADER_CELLS.fleetUnitNumber, "654"],
      [HEADER_CELLS.inspectedOn, "06/16/2026"],
      [HEADER_CELLS.inspectorName, "GEORGE GACEV"],
      [HEADER_CELLS.carrierName, "SILVICOM INC"],
      [HEADER_CELLS.carrierAddress, "1301 ARMITAGE AVE"],
      [HEADER_CELLS.carrierCityStateZip, "MELROSE PARK IL , 60160"],
      [HEADER_CELLS.vehicleIdentificationValue, "3AKJHHDR7RSUX1186"],
    ];
    for (const [cell, value] of longest) {
      expect(font.widthOfTextAtSize(value, HEADER_SIZE), value).toBeLessThanOrEqual(cell.maxWidth);
    }
  });

  /**
   * The agency line was left out of the list above for as long as nothing could write it. It has a
   * UI now (`InspectionHeaderFields`), which makes its width a real constraint rather than a
   * hypothetical one — and it is the one header cell that can genuinely be overrun, because a
   * company name plus an address is unbounded where a VIN and a date are not.
   *
   * It stamps at 8 pt rather than the 10 pt the rest of the header uses, and the renderer shrinks to
   * a 5.5 pt floor before it gives up and overflows. So what is asserted is the boundary itself: the
   * shape the UI asks for fits, and the shape it warns about does not.
   */
  it("fits a company and a city on the agency line, and confirms a street address does not", () => {
    const cell = HEADER_CELLS.inspectionAgencyLocation;
    const AGENCY_SIZE = 8;
    const MIN_SIZE = 5.5;
    const fits = (value: string) => {
      let size = AGENCY_SIZE;
      while (size > MIN_SIZE && font.widthOfTextAtSize(value, size) > cell.maxWidth) size -= 0.25;
      return font.widthOfTextAtSize(value, size) <= cell.maxWidth;
    };

    // What the fields are labelled for — company, then city and state.
    expect(fits("PETERBILT OF CHICAGO, MELROSE PARK IL")).toBe(true);
    expect(fits("SILVICOM INC, MELROSE PARK IL")).toBe(true);
    // What the hint steers away from, and why the component warns above ~47 characters: a full
    // street address bottoms out at the floor and still runs past the cell.
    expect(fits("PETERBILT OF CHICAGO, 1301 ARMITAGE AVE MELROSE PARK IL 60160")).toBe(false);
  });
});

describe("2b. the section headings the form knocks out (D-AVI22)", () => {
  /**
   * Keller draws these at zero ink over a hairline because its pad is pre-printed with a coloured
   * band; on plain paper they are white on white, which is what the office was looking at. The
   * renderer supplies them, so what has to stay true is that there is one per section, that each
   * lands in its own printed column, and that none of them sits on top of an item row.
   */
  it("covers all sixteen of the form's sections exactly once", () => {
    const numbers = GROUP_HEADINGS.map((h) => h.number);
    expect(numbers).toEqual([...Array(16)].map((_, i) => i + 1));
    expect(new Set(numbers).size).toBe(16);
  });

  it("names every catalogue group, and only leaves 16 to the form's own OTHER box", () => {
    // If a group is ever added to the catalogue without a heading position, this fails rather than
    // printing a column of items under nothing — which is the defect that started this.
    for (const group of INSPECTION_GROUPS) {
      expect(GROUP_HEADINGS.find((h) => h.number === group.number), group.title).toBeTruthy();
    }
    expect(INSPECTION_GROUPS.find((g) => g.number === 16)).toBeUndefined();
  });

  it("puts each heading inside the printed column its items are in", () => {
    // A heading in the wrong column would read as a section that has migrated across the page.
    for (const heading of GROUP_HEADINGS) {
      const column = columnOf(heading.x);
      expect(column, `heading ${heading.number}`).toBeGreaterThanOrEqual(0);
      for (const item of INSPECTION_ITEMS.filter((i) => i.group === heading.number)) {
        expect(columnOf(cellsFor(item.key)!.ok.x), `${item.key} vs heading ${heading.number}`).toBe(column);
      }
    }
  });

  it("sits on its own rule, above the first item it introduces", () => {
    for (const heading of GROUP_HEADINGS) {
      // The baseline is below the rule it is knocked out of — 3.16 pt, the offset every measured
      // heading shares. A heading above its rule would print into the row before it.
      expect(heading.y, `heading ${heading.number}`).toBeGreaterThan(heading.rule);
      expect(heading.y - heading.rule).toBeLessThan(5);

      const first = INSPECTION_ITEMS.filter((i) => i.group === heading.number)
        .map((i) => cellsFor(i.key)!.ok.y)
        .sort((a, b) => a - b)[0];
      if (first !== undefined) expect(heading.y, `heading ${heading.number}`).toBeLessThan(first);
    }
  });

  it("fits its longest title inside the column, at the size Keller sets them", () => {
    // "11. WHEELS AND RIMS" is the longest; the column is 192 pt wide.
    const longest = GROUP_HEADINGS.map((h) => {
      const title = (INSPECTION_GROUPS.find((g) => g.number === h.number)?.title ?? "Other").toUpperCase();
      return `${h.number}. ${title}`;
    }).sort((a, b) => b.length - a.length)[0]!;
    expect(bold.widthOfTextAtSize(longest, HEADING_SIZE)).toBeLessThanOrEqual(192);
  });
});

describe("3. no collision — nothing prints on top of anything else", () => {
  const rect = (c: Cell) => ({ x0: c.x, x1: c.x + c.maxWidth, y: c.y });

  it("keeps the three columns of a row apart", () => {
    for (const item of INSPECTION_ITEMS) {
      const c = cellsFor(item.key)!;
      const [ok, needs, date] = [rect(c.ok), rect(c.needsRepair), rect(c.repairedDate)];
      expect(ok.x1, item.key).toBeLessThanOrEqual(needs.x0);
      expect(needs.x1, item.key).toBeLessThanOrEqual(date.x0);
    }
  });

  it("never puts two components on the same row of the same column", () => {
    const seen = new Set<string>();
    for (const item of INSPECTION_ITEMS) {
      const c = cellsFor(item.key)!;
      const slot = `${c.ok.x}@${c.ok.y}`;
      expect(seen.has(slot), `${item.key} collides at ${slot}`).toBe(false);
      seen.add(slot);
    }
  });

  it("keeps the free-text lines clear of each other, of the label, and on the page", () => {
    const L = OTHER_CONDITIONS_LINES;
    expect(L.lineHeight).toBeGreaterThan(8);
    // Below the printed "List any other condition(s)…" label, which ends around 490 top-down. An
    // earlier pass started at 460 and printed the note straight through it.
    expect(L.firstY).toBeGreaterThan(492);
    expect(L.firstY + (L.lines - 1) * L.lineHeight).toBeLessThan(PAGE_HEIGHT);
    // ...and clear of the instructions strip at the foot of the grid.
    expect(L.firstY + (L.lines - 1) * L.lineHeight).toBeLessThan(775);
  });

  it("gives every tick box its own position", () => {
    const boxes = Object.values(CHECKBOX_CELLS).map((c) => `${c.x}@${c.y}`);
    expect(new Set(boxes).size).toBe(boxes.length);
  });
});

describe("4. the coordinate flip happens once, and in the right direction", () => {
  it("turns a top-down y into a bottom-up baseline", () => {
    // A row near the top of the page must land near the TOP in pdf-lib's coordinates, i.e. high y.
    const top = cellsFor("brake.service_brakes")!.ok;
    const bottom = cellsFor("lighting.all_operable")!.ok;
    expect(top.y).toBeLessThan(bottom.y); // measured top-down: earlier row = smaller y
    expect(baselineOf(top, 8)).toBeGreaterThan(baselineOf(bottom, 8)); // drawn bottom-up: reversed
  });

  it("adds the descender rather than dropping it", () => {
    const cell = cellsFor("brake.hose")!.ok;
    // Without the correction every mark prints 1.66pt low at 8pt — visible on paper (plan §2.5).
    expect(baselineOf(cell, 8) - (PAGE_HEIGHT - cell.y)).toBeCloseTo(1.656, 3);
  });

  it("keeps every row on the page", () => {
    for (const item of INSPECTION_ITEMS) {
      const y = baselineOf(cellsFor(item.key)!.ok, 8);
      expect(y, item.key).toBeGreaterThan(0);
      expect(y, item.key).toBeLessThan(PAGE_HEIGHT);
    }
  });
});
