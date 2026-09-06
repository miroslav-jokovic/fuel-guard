import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { INSPECTION_GROUPS, INSPECTION_ITEMS } from "@silvicom/shared";
import {
  CHECKBOX_CELLS,
  CHECKBOX_SIZE,
  HEADER_CELLS,
  MAPPED_ITEM_COUNT,
  OTHER_CONDITIONS_LINES,
  PAGE_HEIGHT,
  baselineOf,
  cellsFor,
  mappedItemKeys,
  type Cell,
} from "./layouts/keller14834Rev0122.js";
import {
  COLUMN_GROUP_BOUNDS,
  GROUP_HEADINGS,
  HEADING_SIZE,
} from "./layouts/keller14834Rev0122Artwork.js";

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

describe("2b. the section bands the template export lost (D-AVI22, remeasured 2026-09-01)", () => {
  /**
   * The blank in `assets/` dropped all sixteen coloured heading bands and left fifteen white
   * heading strings on white paper, so the renderer draws band and title both. What has to stay
   * true is that there is one per section, that each band spans its own printed column group, that
   * the title is concentric with the band it is knocked out of, and that neither lands on an item
   * row. None of that is visible on a rendered page: a heading half a point low still reads.
   */
  const titleOf = (n: number) =>
    (INSPECTION_GROUPS.find((g) => g.number === n)?.title ?? "Other").toUpperCase();

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
      const column = columnOf(heading.numberX);
      expect(column, `heading ${heading.number}`).toBe(heading.column);
      for (const item of INSPECTION_ITEMS.filter((i) => i.group === heading.number)) {
        expect(columnOf(cellsFor(item.key)!.ok.x), `${item.key} vs heading ${heading.number}`).toBe(column);
      }
    }
  });

  it("spans its column group edge to edge, at the 12 pt the form's own rules measure", () => {
    // The band runs across the OK / NEEDS REPAIR / REPAIRED DATE boxes as well as ITEM — that is
    // what the pair of full-group-width rules per section measures, and what the office's filed
    // report shows. A band drawn over the ITEM column alone leaves three white notches.
    for (const heading of GROUP_HEADINGS) {
      const [x0, x1] = COLUMN_GROUP_BOUNDS[heading.column]!;
      expect(heading.x0, `heading ${heading.number}`).toBe(x0);
      expect(heading.x1, `heading ${heading.number}`).toBe(x1);
      expect(heading.height).toBe(12);
    }
  });

  it("centres the title in its band, so the ink cannot sit off the colour", () => {
    for (const heading of GROUP_HEADINGS) {
      const capTop = heading.baseline - 0.717 * HEADING_SIZE;
      expect(capTop, `heading ${heading.number} rides above its band`).toBeGreaterThan(heading.top);
      expect(heading.baseline, `heading ${heading.number} drops below its band`).toBeLessThan(
        heading.top + heading.height,
      );
      // Concentric to within a quarter point: the type's optical centre against the band's.
      const typeCentre = (capTop + heading.baseline) / 2;
      expect(typeCentre - (heading.top + heading.height / 2), `heading ${heading.number}`).toBeLessThan(0.25);
    }
  });

  it("clears the first item it introduces, and the row above it", () => {
    for (const heading of GROUP_HEADINGS) {
      const rows = INSPECTION_ITEMS.filter((i) => i.group === heading.number).map(
        (i) => cellsFor(i.key)!.ok.y,
      );
      const first = rows.sort((a, b) => a - b)[0];
      if (first !== undefined) {
        expect(heading.top + heading.height, `heading ${heading.number}`).toBeLessThanOrEqual(first);
      }
    }
  });

  it("leaves the fixed tab between a number and its title, one digit or two", () => {
    // Keller's own operators: `1.388/1.389 0 Td` for a one-digit number, `1.735 0 Td` for two, at
    // 8.64 pt. That is why `1.  BRAKE SYSTEM` carries a visibly wide gap and `16. OTHER` does not.
    for (const heading of GROUP_HEADINGS) {
      const tab = heading.titleX - heading.numberX;
      expect(tab, `heading ${heading.number}`).toBeCloseTo(heading.number >= 10 ? 14.99 : 12.0, 1);
      // ...and the number never runs into the title it labels.
      const numberWidth = bold.widthOfTextAtSize(`${heading.number}.`, HEADING_SIZE);
      expect(heading.numberX + numberWidth, `heading ${heading.number}`).toBeLessThanOrEqual(heading.titleX);
    }
  });

  it("fits number and title inside the band, at the size Keller sets them", () => {
    for (const heading of GROUP_HEADINGS) {
      const end = heading.titleX + bold.widthOfTextAtSize(titleOf(heading.number), HEADING_SIZE);
      expect(heading.numberX, `heading ${heading.number}`).toBeGreaterThanOrEqual(heading.x0);
      expect(end, `heading ${heading.number}`).toBeLessThanOrEqual(heading.x1);
    }
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

  /**
   * ── THE OLD ASSERTION HERE WAS TRUE OF EVERY WRONG ANSWER ────────────────────────────────────
   * It only checked that no two tick boxes shared a position, which three boxes 18, 21 and 5 pt off
   * their artwork satisfied perfectly. So a plate-identified report struck out the words "LIC.", an
   * other-identified one struck out "OTHER", and every trailer report struck out "TRAILER" — with
   * all three printed boxes left empty. What is asserted now is the thing that was wrong: the mark
   * lands INSIDE the rectangle Keller drew.
   */
  const ARTWORK_BOXES = {
    qualifiedYes: [316.75, 652.442],
    identificationPlate: [451.75, 638.302],
    identificationVin: [523.75, 638.302],
    identificationOther: [552.75, 638.302],
    vehicleTypeTractor: [71.25, 614.302],
    vehicleTypeTrailer: [123.25, 614.302],
  } as const;

  it("puts every tick box on the rectangle the template actually draws", () => {
    // Read out of the blank's own content stream — these are `re` operators, not a reading of a
    // scan, so a drift here is a coordinate that stopped matching the paper.
    for (const [name, [x, pdfBottom]] of Object.entries(ARTWORK_BOXES)) {
      const box = CHECKBOX_CELLS[name as keyof typeof CHECKBOX_CELLS];
      expect(box.x, `${name} x`).toBeCloseTo(x, 2);
      expect(box.y, `${name} y`).toBeCloseTo(PAGE_HEIGHT - pdfBottom - CHECKBOX_SIZE, 2);
    }
    expect(Object.keys(CHECKBOX_CELLS).sort()).toEqual(Object.keys(ARTWORK_BOXES).sort());
  });

  it("keeps the drawn X inside the 5.5 pt box, horizontally and vertically", () => {
    // An 8 pt Helvetica cap is 5.74 pt against a 5.5 pt box, so it overhangs by 0.12 pt top and
    // bottom by design — anything more than a quarter point is the mark sitting on the rule.
    const glyph = font.widthOfTextAtSize("X", 8);
    expect(glyph, "an X wider than its box would strike the neighbouring label").toBeLessThan(CHECKBOX_SIZE);
    const overhang = (0.717 * 8 - CHECKBOX_SIZE) / 2;
    expect(overhang).toBeLessThan(0.25);
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
