import { describe, expect, it } from "vitest";
import { applyHomography, solveHomography, type Quad } from "../src/enhance/homography.js";
import { parseLabels, type LabelEntry } from "../src/edges/labels.js";
import { percentile, PRECISION_BAR, scoreCase, summarise, summariseBy, type CaseResult } from "../src/edges/report.js";
import { clipConvex, polygonArea, SCORE_LONG_EDGE, selfIntersects, smartDocJaccard, worstCornerError } from "../src/edges/score.js";

/**
 * The scoring every candidate detector is judged by (LIVE-EDGE-DETECTION-PLAN.md step L1). If this
 * arithmetic is wrong, every detector comparison built on it is wrong in the same direction and nothing
 * downstream can tell, so each property is asserted from a case whose answer is known by construction.
 */

const quad = (...p: [number, number][]): Quad => p.map(([x, y]) => ({ x, y })) as unknown as Quad;
const rect = (x: number, y: number, w: number, h: number): Quad => quad([x, y], [x + w, y], [x + w, y + h], [x, y + h]);

// A page photographed at an angle: the far (top) edge is shorter, as perspective makes it.
const PAGE = quad([300, 200], [700, 210], [820, 900], [180, 880]);

describe("SmartDoc Jaccard index", () => {
  it("is 1 for a perfect outline and 0 for none", () => {
    expect(smartDocJaccard(PAGE, PAGE)).toBeCloseTo(1, 12);
    expect(smartDocJaccard(PAGE, null)).toBe(0);
  });

  it("does not depend on the paper size it straightens to", () => {
    const found = quad([310, 205], [690, 215], [830, 890], [175, 870]);
    const unit = smartDocJaccard(PAGE, found);
    const a4 = smartDocJaccard(PAGE, found, rect(0, 0, 2100, 2970));
    const card = smartDocJaccard(PAGE, found, rect(0, 0, 856, 540));
    expect(unit).toBeGreaterThan(0.8);
    expect(unit).toBeLessThan(0.99);
    expect(a4).toBeCloseTo(unit, 10);
    expect(card).toBeCloseTo(unit, 10);
  });

  it("matches the challenge's definition: an outline that is half the page in the straightened frame scores 0.5", () => {
    // Build the found outline IN the straightened frame (the left half of the unit square) and carry it
    // back into the photo, so the right answer is known exactly without trusting the code under test.
    const toPhoto = solveHomography(rect(0, 0, 1, 1), PAGE)!;
    const leftHalf = rect(0, 0, 0.5, 1).map((p) => applyHomography(toPhoto, p)) as unknown as Quad;
    expect(smartDocJaccard(PAGE, leftHalf)).toBeCloseTo(0.5, 10);
  });

  it("weighs the foreshortened far edge like the near one, which a plain IoU in the photo does not", () => {
    // The same 10% shortfall, once at the near (bottom) edge and once at the far (top) edge, made in the
    // straightened frame: the challenge's measure scores them the same.
    const toPhoto = solveHomography(rect(0, 0, 1, 1), PAGE)!;
    const back = (q: Quad) => q.map((p) => applyHomography(toPhoto, p)) as unknown as Quad;
    const shortTop = back(rect(0, 0.1, 1, 0.9));
    const shortBottom = back(rect(0, 0, 1, 0.9));
    expect(smartDocJaccard(PAGE, shortTop)).toBeCloseTo(smartDocJaccard(PAGE, shortBottom), 10);
    expect(smartDocJaccard(PAGE, shortTop)).toBeCloseTo(0.9, 10);
  });

  it("penalises an outline that runs PAST the page as well as one that falls short", () => {
    const toPhoto = solveHomography(rect(0, 0, 1, 1), PAGE)!;
    const tooBig = rect(0, 0, 1.1, 1).map((p) => applyHomography(toPhoto, p)) as unknown as Quad;
    expect(smartDocJaccard(PAGE, tooBig)).toBeCloseTo(1 / 1.1, 10);
  });

  it("does not mistake a dented outline for a crossed one", () => {
    // Concave, not crossed: the line through one side separates the opposite side's ends, but the two
    // SEGMENTS never meet. Only checking the line would call this crossed.
    expect(selfIntersects(quad([0, 0], [10, 0], [2, 2], [0, 10]))).toBe(false);
  });

  it("scores a crossed outline 0, as the challenge does", () => {
    const bowtie = quad([300, 200], [820, 900], [700, 210], [180, 880]);
    expect(selfIntersects(bowtie)).toBe(true);
    expect(smartDocJaccard(PAGE, bowtie)).toBe(0);
  });

  it("scores 0 for an outline that lands beyond the horizon instead of returning garbage", () => {
    // Strong perspective: a far edge 1/10 of the near one puts the horizon just above the page.
    const steep = quad([480, 100], [520, 100], [900, 900], [100, 900]);
    // Found by searching for an outline the guard decides: one corner past the horizon, the outline not
    // crossed in the photo or after straightening, and without the guard it scores a meaningless 0.13.
    const beyond = quad([473, 193], [1318, -2318], [1086, 605], [620, 383]);
    expect(selfIntersects(beyond)).toBe(false);
    expect(smartDocJaccard(steep, beyond)).toBe(0);
  });

  it("does not care which corner the found outline starts from", () => {
    const rotated = quad([700, 210], [820, 900], [180, 880], [300, 200]);
    expect(smartDocJaccard(PAGE, rotated)).toBeCloseTo(1, 10);
  });
});

describe("worst corner error", () => {
  it("is the largest corner distance, expressed at the 1,568 px long edge", () => {
    const off = quad([300, 200], [700, 210], [823, 904], [180, 880]); // one corner 5 px out
    expect(worstCornerError(PAGE, off, 1568)).toBeCloseTo(5, 10);
    expect(worstCornerError(PAGE, off, 3136)).toBeCloseTo(2.5, 10); // the same 5 px on a twice-larger photo
    expect(SCORE_LONG_EDGE).toBe(1568);
  });

  it("forgives a rotated corner order but not a reflected one", () => {
    const rotated = quad([180, 880], [300, 200], [700, 210], [820, 900]);
    expect(worstCornerError(PAGE, rotated, 1568)).toBeCloseTo(0, 10);
    const reflected = quad([700, 210], [300, 200], [180, 880], [820, 900]);
    expect(worstCornerError(PAGE, reflected, 1568)).toBeGreaterThan(100);
  });
});

describe("clipping", () => {
  it("clips a polygon to a convex one in either winding", () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(5, 5, 10, 10);
    expect(polygonArea(clipConvex(a, b))).toBeCloseTo(25, 10);
    expect(polygonArea(clipConvex(a, [...b].reverse()))).toBeCloseTo(25, 10);
    expect(polygonArea(clipConvex(a, rect(20, 20, 5, 5)))).toBe(0);
  });
});

const ID = (n: number) => n.toString(16).padStart(64, "0");
const entry = (n: number, document: LabelEntry["document"], tags: Record<string, string> = {}): LabelEntry => ({
  id: ID(n),
  file: `${n}.jpg`,
  width: 1568,
  height: 1176,
  document,
  tags,
});

describe("labels", () => {
  const good = { version: 1, entries: [entry(1, { corners: PAGE, kind: "bol" }), entry(2, null)] };

  it("accepts a well-formed file, including a photo with no document", () => {
    const parsed = parseLabels(JSON.parse(JSON.stringify(good)));
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[1]!.document).toBeNull();
  });

  it.each([
    ["a wrong version", { ...good, version: 2 }, /version/],
    ["an id that is not a sha256", { version: 1, entries: [{ ...good.entries[0], id: "abc" }] }, /sha256/],
    ["the same photo twice", { version: 1, entries: [good.entries[0], good.entries[0]] }, /twice/],
    ["crossed corners", { version: 1, entries: [entry(1, { corners: quad([300, 200], [820, 900], [700, 210], [180, 880]), kind: "bol" })] }, /cross/],
    ["three corners", { version: 1, entries: [entry(1, { corners: PAGE.slice(0, 3) as unknown as Quad, kind: "bol" })] }, /four/],
    ["an unknown kind", { version: 1, entries: [entry(1, { corners: PAGE, kind: "napkin" as "bol" })] }, /kind/],
    ["a speck", { version: 1, entries: [entry(1, { corners: rect(0, 0, 10, 10), kind: "bol" })] }, /1%/],
    ["a missing document key", { version: 1, entries: [{ ...good.entries[0], document: undefined }] }, /null/],
  ])("refuses %s", (_name, file, message) => {
    expect(() => parseLabels(JSON.parse(JSON.stringify(file)))).toThrow(message);
  });
});

describe("report", () => {
  it("nearest-rank percentiles", () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(v, 50)).toBe(5);
    expect(percentile(v, 95)).toBe(10);
    expect(percentile(v, 5)).toBe(1);
    expect(percentile(v, 21)).toBe(3); // nearest rank is ceil(0.21 × 10) = 3, not round(2.1) = 2
    expect(percentile([], 50)).toBeNaN();
  });

  it("counts a miss and a false outline separately from corner error", () => {
    const results: CaseResult[] = [
      scoreCase(entry(1, { corners: PAGE, kind: "bol" }), PAGE),
      scoreCase(entry(2, { corners: PAGE, kind: "bol" }), null),
      scoreCase(entry(3, null), null),
      scoreCase(entry(4, null), rect(0, 0, 500, 500)),
    ];
    const s = summarise(results);
    expect(s.withDocument).toBe(2);
    expect(s.missed).toBe(1);
    expect(s.missRate).toBe(0.5);
    expect(s.falseOutlines).toBe(1);
    expect(s.worstCornerMedianPx).toBe(0); // the miss is not folded in as an error
    expect(s.jaccardMean).toBeCloseTo(0.5, 10); // but it does score 0, as the challenge says
    expect(s.bar).toMatchObject({ median: true, miss: false, falseOutlines: false, all: false });
  });

  it("fails the bar on a single false outline even when every page was found perfectly", () => {
    const s = summarise([scoreCase(entry(1, { corners: PAGE, kind: "bol" }), PAGE), scoreCase(entry(2, null), PAGE)]);
    expect(s.bar).toMatchObject({ median: true, p95: true, miss: true, falseOutlines: false, all: false });
  });

  it("passes the bar only when every criterion passes, at its edges", () => {
    const at = (px: number): CaseResult => ({ id: "x", tags: {}, hasDocument: true, found: true, jaccard: 1, worstCornerPx: px });
    const exactly = summarise([at(PRECISION_BAR.medianWorstCornerPx), at(PRECISION_BAR.medianWorstCornerPx), at(PRECISION_BAR.p95WorstCornerPx)]);
    expect(exactly.bar.all).toBe(true);
    const over = summarise([at(PRECISION_BAR.medianWorstCornerPx + 0.01), at(PRECISION_BAR.medianWorstCornerPx + 0.01), at(1)]);
    expect(over.bar.median).toBe(false);
    expect(over.bar.all).toBe(false);
  });

  it("breaks results down by a tag", () => {
    const results = [
      scoreCase(entry(1, { corners: PAGE, kind: "bol" }, { light: "night" }), null),
      scoreCase(entry(2, { corners: PAGE, kind: "bol" }, { light: "day" }), PAGE),
      scoreCase(entry(3, { corners: PAGE, kind: "bol" }), PAGE),
    ];
    const by = summariseBy(results, "light");
    expect([...by.keys()]).toEqual(["(untagged)", "day", "night"]);
    expect(by.get("night")!.missRate).toBe(1);
    expect(by.get("day")!.missRate).toBe(0);
  });
});
