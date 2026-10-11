import { describe, expect, it } from "vitest";
import { anchorOf, classTokens, rowBacks, rowOf, rowShows, type OcrItem, type OcrPage } from "./rowWitness.js";

/**
 * The row-bound OCR witness (§7B A5). The pages are drawn after the office BOLs the spike measured: on
 * 0132900 the true count is 6 drums and a "9" is printed on the same page as UN3082's class — the reason a
 * whole-page check would have confirmed Sonnet 4.6's wrong 9. Boxes are pixels of a 2550 × 3300 page.
 */
const item = (text: string, x: number, y: number, height = 40): OcrItem => ({ text, box: { x, y, width: 20 * text.length, height } });
const page = (items: OcrItem[], n = 1): OcrPage => ({ page: n, width: 2550, height: 3300, items });

// Two lines, each on its own printed row; the second row carries the class 9 the wrong count matched.
const P0132900 = page([
  item("UN2735, Amines, liquid, corrosive, n.o.s., 8, PG II", 400, 1000),
  item("6", 120, 1010),
  item("DRUMS", 200, 1010),
  item("11,400", 2100, 1005),
  item("UN3082, Environmentally hazardous substance, liquid, n.o.s., 9, PG III", 400, 1300),
  item("24", 120, 1310),
  item("30,000", 2100, 1305),
]);

describe("rowOf + rowBacks — the same-row rule", () => {
  it("backs the true count and weight on the line's row and rejects the 9 printed on the next line's row", () => {
    const row = rowOf([P0132900], "UN2735", 0, 1)!;
    expect(rowBacks(row, [9, 6])).toBe(6);
    expect(rowBacks(row, [9])).toBeNull();
    expect(rowBacks(row, [11400])).toBe(11400);
    expect(rowShows(row, 30000)).toBe(false);
  });

  it("matches a whole token, never a substring, so a 9 is not found inside 1789 on the row", () => {
    const row = rowOf([page([item("UN1789 Hydrochloric acid 8 PG II", 400, 1000), item("12", 120, 1005)])], "UN1789", 0, 1)!;
    expect(rowShows(row, 9)).toBe(false);
    expect(rowShows(row, 12)).toBe(true);
  });

  it("reads a thousands comma or a thousands dot as no difference, and a decimal weight exactly", () => {
    const row = rowOf([page([item("UN1263 Paint 3 PG II", 400, 1000), item("30,452.6", 2100, 1005), item("3.806", 1900, 1005)])], "UN 1263", 0, 1)!;
    expect(rowShows(row, 30452.6)).toBe(true);
    expect(rowShows(row, 3806)).toBe(true);
    expect(rowShows(row, 3808)).toBe(false);
  });

  it("reads a number printed with trailing zeros as that number — 0134527's 20,030.00 lb and 0134831's 67.0 drums", () => {
    const row = rowOf([page([item("UN1760,Corrosive liquids, n.o.s. RQ", 400, 1267), item("20,030.00", 2100, 1266), item("67.0 DRUM", 120, 1270)])], "UN1760", 0, 1)!;
    expect(rowBacks(row, [20030])).toBe(20030);
    expect(rowBacks(row, [67])).toBe(67);
    expect(rowShows(row, 20031)).toBe(false);
    expect(rowShows(row, 670)).toBe(false);
  });

  it("cannot prove a value that is also the line's class, which its own description prints on the row", () => {
    const row = rowOf([P0132900], "UN2735", 0, 1)!;
    expect(rowShows(row, 8)).toBe(true);
    expect(rowBacks(row, [8], classTokens("8"))).toBeNull();
    expect(rowBacks(row, [8, 6], classTokens("8"))).toBe(6);
    expect(classTokens("3 (6.1)", null)).toEqual(["3", "6.1"]);
  });

  it("backs neither when the row shows both readers' values", () => {
    const row = rowOf([page([item("UN2735 Amines 8 PG II", 400, 1000), item("6", 120, 1005), item("9", 160, 1005)])], "UN2735", 0, 1)!;
    expect(rowBacks(row, [6, 9])).toBeNull();
    expect(rowBacks(row, [6, 6])).toBe(6);
  });

  it("takes the nth printed anchor for the nth line with the id, across pages in order", () => {
    const p1 = page([item("UN1263 Paint 3 PG II", 400, 1000), item("77", 120, 1005)], 1);
    const p2 = page([item("UN1263 Paint 3 PG II", 400, 400), item("182", 120, 405)], 2);
    expect(rowBacks(rowOf([p2, p1], "UN1263", 0, 2)!, [77, 182])).toBe(77);
    const second = rowOf([p1, p2], "UN1263", 1, 2)!;
    expect(second.page).toBe(2);
    expect(rowBacks(second, [77, 182])).toBe(182);
  });

  it("abstains when the printed anchors do not number the read lines, when there is none, and when the id is not an id", () => {
    const twice = page([item("UN2735 Amines 8 PG II", 400, 1000), item("6", 120, 1005), item("EMERGENCY: UN2735 CHEMTREC", 400, 3000)]);
    expect(rowOf([twice], "UN2735", 0, 1)).toBeNull();
    expect(rowOf([P0132900], "UN1993", 0, 1)).toBeNull();
    expect(rowOf([P0132900], "5607540", 0, 1)).toBeNull();
    expect(anchorOf("5607540")).toBeNull();
    expect(anchorOf("NA 1993")).toBe("NA1993");
  });

  it("reaches 1.5 anchor heights above and 2.5 below, and no further", () => {
    const at = (y: number) => rowOf([page([item("UN2735 Amines", 400, 1000), item("6", 120, y, 40)])], "UN2735", 0, 1)!;
    // An item counts when its middle (y + 20) lies in [1000 − 60, 1000 + 40 + 100] = [940, 1140].
    expect(rowShows(at(920), 6)).toBe(true);
    expect(rowShows(at(919), 6)).toBe(false);
    expect(rowShows(at(1120), 6)).toBe(true);
    expect(rowShows(at(1121), 6)).toBe(false);
  });

  it("states the row as a box in fractions of the page", () => {
    const row = rowOf([P0132900], "UN2735", 0, 1)!;
    expect(row.page).toBe(1);
    expect(row.bbox.y).toBeCloseTo(940 / 3300);
    expect(row.bbox.h).toBeCloseTo(200 / 3300);
  });
});
