import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { INSPECTION_ITEMS } from "@silvicom/shared";
import {
  CHECKBOX_CELLS,
  HEADER_CELLS,
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

const font = await (async () => {
  const doc = await PDFDocument.create();
  return doc.embedFont(StandardFonts.Helvetica);
})();

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
