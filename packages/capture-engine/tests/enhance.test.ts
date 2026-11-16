import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodePng } from "../fixtures/png.mjs";
import { cleanDocument, CLEAN_VERSION } from "../src/enhance/clean.js";
import { findDocument } from "../src/enhance/findDocument.js";
import {
  applyHomography,
  ID1_ASPECT,
  solveHomography,
  straightenedSize,
  warpQuad,
  type Quad,
} from "../src/enhance/homography.js";
import { levelCard } from "../src/enhance/levelCard.js";
import { balanceCard, evenPage, PAPER_WHITE } from "../src/enhance/light.js";
import { downscaleRgb, rgbImage, sampleBilinear, type RgbImage } from "../src/enhance/raster.js";
import { computeMetrics } from "../src/metrics.js";

/**
 * The clean copy (APPLICATION-PHOTO-CLEANUP-PLAN.md, P1).
 *
 * ── WHAT IS WORTH ASSERTING ───────────────────────────────────────────────────────────────────
 * Not pixel values — those pin the arithmetic, wrong or right. What a wrong implementation cannot fake:
 *   · GEOMETRY against a known answer: a page placed on a table through a homography WE chose must be
 *     found at the corners we chose, and straightened back into the page it was;
 *   · LIGHT by the scanner's own metric: a shadowed fixture's `shadowRange` must fall, an even one must
 *     barely move (an "enhancement" that changes a good page is inventing);
 *   · COLOUR survives: red marks stay red (D-SCAN11's constraint);
 *   · REFUSALS (D-PCL5): no document, or one that fills the frame, gives no quad rather than a guess.
 */

const FIXTURES = join(fileURLToPath(new URL(".", import.meta.url)), "..", "fixtures");
const fixture = (name: string): RgbImage => {
  const { width, height, rgb } = decodePng(readFileSync(join(FIXTURES, `${name}.png`)));
  return { data: rgb, width, height };
};

/** Deterministic noise, so a table has texture and a run is repeatable. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** `doc` drawn into a `w × h` photo at `quad`, on a textured table of `table` colour. */
function placeOnTable(doc: RgbImage, quad: Quad, w: number, h: number, table: [number, number, number]): RgbImage {
  const docRect: Quad = [
    { x: 0, y: 0 },
    { x: doc.width - 1, y: 0 },
    { x: doc.width - 1, y: doc.height - 1 },
    { x: 0, y: doc.height - 1 },
  ];
  const toDoc = solveHomography(quad, docRect)!;
  const out = rgbImage(w, h);
  const rand = noise(7);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const at = (y * w + x) * 3;
      const p = applyHomography(toDoc, { x, y });
      if (p.x >= 0 && p.y >= 0 && p.x <= doc.width - 1 && p.y <= doc.height - 1) {
        sampleBilinear(doc, p.x, p.y, out.data, at);
      } else {
        const n = (rand() - 0.5) * 24;
        for (let c = 0; c < 3; c++) out.data[at + c] = Math.max(0, Math.min(255, Math.round(table[c]! + n)));
      }
    }
  }
  return out;
}

const cornerError = (found: Quad, truth: Quad): number =>
  Math.max(...found.map((p, i) => Math.hypot(p.x - truth[i]!.x, p.y - truth[i]!.y)));

function meanAbsDiff(a: RgbImage, b: RgbImage): number {
  let s = 0;
  for (let i = 0; i < a.data.length; i++) s += Math.abs(a.data[i]! - b.data[i]!);
  return s / a.data.length;
}

/** A licence-like card: pale blue with darker bands, a dark photo block, and black text bars. */
function syntheticCard(w: number, h: number): RgbImage {
  const card = rgbImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const at = (y * w + x) * 3;
      let px: [number, number, number] = Math.floor(y / 12) % 3 === 0 ? [170, 195, 225] : [205, 220, 240];
      if (x > w * 0.05 && x < w * 0.32 && y > h * 0.2 && y < h * 0.85) px = [70, 55, 50];
      if (x > w * 0.4 && x < w * 0.9 && Math.floor(y / 8) % 4 === 1) px = [20, 20, 30];
      card.data.set(px, at);
    }
  }
  return card;
}

describe("the homography", () => {
  it("carries each corner exactly where it was asked to", () => {
    const from: Quad = [{ x: 0, y: 0 }, { x: 999, y: 0 }, { x: 999, y: 699 }, { x: 0, y: 699 }];
    const to: Quad = [{ x: 120, y: 80 }, { x: 1010, y: 140 }, { x: 960, y: 820 }, { x: 90, y: 760 }];
    const h = solveHomography(from, to)!;
    from.forEach((p, i) => {
      const q = applyHomography(h, p);
      expect(q.x).toBeCloseTo(to[i]!.x, 6);
      expect(q.y).toBeCloseTo(to[i]!.y, 6);
    });
  });

  it("refuses corners that define no rectangle, rather than returning a matrix of noise", () => {
    const line: Quad = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }];
    const rect: Quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(solveHomography(rect, line)).toBeNull();
  });

  it("snaps a card to ID-1 in the orientation it was measured, and leaves a page as measured", () => {
    const skewedCard: Quad = [{ x: 0, y: 0 }, { x: 860, y: 0 }, { x: 860, y: 520 }, { x: 0, y: 520 }];
    const card = straightenedSize(skewedCard, "card", 2000);
    expect(card.width / card.height).toBeCloseTo(ID1_ASPECT, 2);
    const page = straightenedSize(skewedCard, "page", 2000);
    expect(page).toEqual({ width: 860, height: 520 });
    const square: Quad = [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }, { x: 0, y: 500 }];
    expect(straightenedSize(square, "card", 2000)).toEqual({ width: 500, height: 500 });
    expect(Math.max(...Object.values(straightenedSize(skewedCard, "page", 430)))).toBe(430);
  });
});

/** The corpus page's paper, inside its surround: a photo that is all document. */
const paperOnly = crop(fixture("clean-sharp-even-portrait-dense"), 90, 90, 1060, 1474);

function crop(img: RgbImage, x0: number, y0: number, w: number, h: number): RgbImage {
  const out = rgbImage(w, h);
  for (let y = 0; y < h; y++) {
    out.data.set(img.data.subarray(((y0 + y) * img.width + x0) * 3, ((y0 + y) * img.width + x0 + w) * 3), y * w * 3);
  }
  return out;
}

describe("finding the document", () => {
  const page = downscaleRgb(fixture("clean-sharp-even-portrait-dense"), 900);
  const truth: Quad = [{ x: 210, y: 140 }, { x: 830, y: 205 }, { x: 870, y: 1060 }, { x: 150, y: 1100 }];
  const photo = placeOnTable(page, truth, 1000, 1240, [62, 48, 40]);

  it("finds a page photographed at an angle on a dark table, at the corners it was placed", () => {
    const found = findDocument(photo)!;
    expect(found).not.toBeNull();
    // 1% of the long edge: the search runs at 512 px, where one pixel is ~2.4 of these.
    expect(cornerError(found.quad, truth)).toBeLessThan(12.4);
  });

  it("finds every corner of a page in shade under warm light, its own grey surround included", () => {
    // The whole fixture (page AND its surround) is the sheet here, darkened toward the top-left corner.
    const sheet = downscaleRgb(fixture("colour-marks-sharp-portrait-dense"), 1100);
    const sheetTruth: Quad = [{ x: 180, y: 120 }, { x: 980, y: 200 }, { x: 1040, y: 1330 }, { x: 110, y: 1380 }];
    const shot = placeOnTable(sheet, sheetTruth, 1200, 1500, [70, 55, 45]);
    for (let y = 0; y < 1500; y++) {
      for (let x = 0; x < 1200; x++) {
        const s = 0.5 + 0.5 * Math.min(1, (x + y) / 1800);
        const at = (y * 1200 + x) * 3;
        [1, 0.92, 0.78].forEach((tint, c) => (shot.data[at + c] = Math.round(shot.data[at + c]! * s * tint)));
      }
    }
    expect(cornerError(findDocument(shot)!.quad, sheetTruth)).toBeLessThan(15);
  });

  it("straightens it back into the page it was", () => {
    const found = findDocument(photo)!;
    const back = warpQuad(photo, found.quad, page.width, page.height)!;
    // Measured against a version with no warp at all, so "close" means something.
    const unwarped = downscaleRgb(photo, Math.max(page.width, page.height));
    const cropped = rgbImage(page.width, page.height);
    for (let y = 0; y < page.height; y++) {
      cropped.data.set(unwarped.data.subarray(y * unwarped.width * 3, y * unwarped.width * 3 + page.width * 3), y * page.width * 3);
    }
    const straightened = meanAbsDiff(back, page);
    expect(straightened).toBeLessThan(meanAbsDiff(cropped, page) / 3);
    expect(straightened).toBeLessThan(25);
  });

  it("finds a coloured card on a wooden table, and straightens it to ID-1", () => {
    const card = syntheticCard(856, 540);
    const cardTruth: Quad = [{ x: 140, y: 170 }, { x: 1080, y: 110 }, { x: 1130, y: 700 }, { x: 175, y: 760 }];
    const found = findDocument(placeOnTable(card, cardTruth, 1280, 880, [150, 105, 60]))!;
    expect(found).not.toBeNull();
    expect(cornerError(found.quad, cardTruth)).toBeLessThan(12.8);
    const size = straightenedSize(found.quad, "card", 1568);
    expect(size.width / size.height).toBeCloseTo(ID1_ASPECT, 2);
  });

  it("finds the corpus page on its own grey surround — the fixtures are pages on a background", () => {
    const corpus = fixture("clean-sharp-even-portrait-dense");
    const found = findDocument(corpus)!;
    expect(cornerError(found.quad, [{ x: 76, y: 76 }, { x: 1163, y: 76 }, { x: 1163, y: 1577 }, { x: 76, y: 1577 }])).toBeLessThan(6);
  });

  it("finds nothing in a photo that is all document — there is no fourth side to find (D-PCL5)", () => {
    expect(findDocument(paperOnly)).toBeNull();
  });

  it("does not mistake the text on a white page on a white table for the document", () => {
    const pad = 120;
    const wide = rgbImage(paperOnly.width + 2 * pad, paperOnly.height + 2 * pad);
    const paper = paperOnly.data.subarray(0, 3);
    for (let p = 0; p < wide.data.length; p += 3) wide.data.set(paper, p);
    for (let y = 0; y < paperOnly.height; y++) {
      wide.data.set(paperOnly.data.subarray(y * paperOnly.width * 3, (y + 1) * paperOnly.width * 3), ((y + pad) * wide.width + pad) * 3);
    }
    expect(findDocument(wide)).toBeNull();
  });

  it("finds nothing on an empty table", () => {
    const table = placeOnTable(page, [{ x: -10, y: -10 }, { x: -9, y: -10 }, { x: -9, y: -9 }, { x: -10, y: -9 }], 800, 600, [90, 90, 90]);
    expect(findDocument(table)).toBeNull();
  });

  it("finds nothing in a shape no phone makes of a rectangle — a corner far from square", () => {
    // Its top corners are ~141°: a trapezoid far flatter than a phone's perspective makes of a sheet.
    const wedge: Quad = [{ x: 480, y: 250 }, { x: 520, y: 250 }, { x: 950, y: 600 }, { x: 50, y: 600 }];
    expect(findDocument(placeOnTable(page, wedge, 1000, 700, [62, 48, 40]))).toBeNull();
  });

  it("finds nothing in a region no quadrilateral fills — two papers overlapping in an L", () => {
    const l = placeOnTable(page, [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 1100 }, { x: 100, y: 1100 }], 1000, 1240, [62, 48, 40]);
    const foot = placeOnTable(page, [{ x: 100, y: 800 }, { x: 900, y: 800 }, { x: 900, y: 1100 }, { x: 100, y: 1100 }], 1000, 1240, [62, 48, 40]);
    for (let y = 800; y <= 1100; y++) l.data.set(foot.data.subarray((y * 1000 + 400) * 3, (y * 1000 + 900) * 3), (y * 1000 + 400) * 3);
    expect(findDocument(l)).toBeNull();
  });

  it("finds nothing when the document runs off the edge of the frame", () => {
    const offEdge: Quad = [{ x: -60, y: 140 }, { x: 830, y: 205 }, { x: 870, y: 1060 }, { x: -90, y: 1100 }];
    expect(findDocument(placeOnTable(page, offEdge, 1000, 1240, [62, 48, 40]))).toBeNull();
  });
});

describe("evening a page's light", () => {
  const shadowOf = (img: RgbImage): number => computeMetrics(img.data, img.width, img.height, 1024).shadowRange;

  for (const name of ["sidelit-strong-portrait-dense", "hand-shadow-portrait-dense", "phone-shadow-landscape-dense"]) {
    it(`takes most of the shadow off ${name}, by the scanner's own shadow metric`, () => {
      const before = fixture(name);
      const after = evenPage(before);
      expect(shadowOf(after)).toBeLessThan(shadowOf(before) / 2);
    });
  }

  it("treats an evenly lit page as one gain — it brings the paper to white and draws nothing new", () => {
    // An enhancement that changes a good page unevenly is inventing. The corpus paper is 232, so it moves —
    // but by the same factor everywhere: the ratio after/before over the paper is flat.
    const before = paperOnly;
    const after = evenPage(before);
    const ratios: number[] = [];
    for (let p = 1; p < before.data.length; p += 3 * 17) if (before.data[p]! > 200) ratios.push(after.data[p]! / before.data[p]!);
    ratios.sort((a, b) => a - b);
    const spread = ratios[Math.floor(ratios.length * 0.95)]! - ratios[Math.floor(ratios.length * 0.05)]!;
    expect(spread).toBeLessThan(0.02);
    expect(ratios[Math.floor(ratios.length / 2)]! * 232).toBeCloseTo(PAPER_WHITE, -1);
  });

  it("brings a dim page's paper up to white", () => {
    const before = fixture("underexposed-portrait-dense");
    const m = (img: RgbImage): number => computeMetrics(img.data, img.width, img.height, 1024).brightnessMean;
    expect(m(evenPage(before))).toBeGreaterThan(m(before) + 0.1);
  });

  it("keeps red marks red, in low light (D-SCAN11)", () => {
    const before = fixture("colour-marks-lowlight-portrait-dense");
    const after = evenPage(before);
    let red = 0;
    let stillRed = 0;
    for (let p = 0; p < before.data.length; p += 3) {
      const [r, g, b] = [before.data[p]!, before.data[p + 1]!, before.data[p + 2]!];
      if (r - Math.max(g, b) < 50) continue;
      red++;
      if (after.data[p]! - Math.max(after.data[p + 1]!, after.data[p + 2]!) >= 50) stillRed++;
    }
    expect(red).toBeGreaterThan(1000);
    expect(stillRed / red).toBeGreaterThan(0.95);
  });

  /** The corpus paper with a shadow falling across it from the left, and `draw` on top. */
  function shadedWith(draw: (img: RgbImage, x: number, y: number) => [number, number, number] | null): RgbImage {
    const out = rgbImage(paperOnly.width, paperOnly.height);
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        const at = (y * out.width + x) * 3;
        const shade = 0.55 + 0.45 * (x / out.width);
        const px = draw(paperOnly, x, y) ?? [0, 1, 2].map((c) => paperOnly.data[at + c]!);
        for (let c = 0; c < 3; c++) out.data[at + c] = Math.round(px[c]! * shade);
      }
    }
    return out;
  }
  const centre = (img: RgbImage, x: number, y: number): number[] => [0, 1, 2].map((c) => img.data[(y * img.width + x) * 3 + c]!);

  it("keeps a solid red stamp red — the gain cap stops a strong colour being read as deep shade", () => {
    const stamp = shadedWith((_, x, y) => (Math.hypot(x - 300, y - 700) < 95 ? [200, 30, 40] : null));
    const [r, g, b] = centre(evenPage(stamp), 300, 700);
    expect(r! - Math.max(g!, b!)).toBeGreaterThan(100);
  });

  it("keeps a form's pale tinted field box tinted — a pale colour is not shade", () => {
    // A medical certificate's shaded boxes: pale enough that no gain cap stops them reading as paper.
    const form = shadedWith((_, x, y) => (x > 200 && x < 800 && y > 400 && y < 520 ? [250, 240, 150] : null));
    const [r, , b] = centre(evenPage(form), 500, 460);
    expect(r! - b!).toBeGreaterThan(50);
  });

  it("does not turn a large dark area white — a photograph on the page, or the table beside it", () => {
    const dark = shadedWith((_, x, y) => (x > 500 && x < 950 && y > 300 && y < 750 ? [40, 38, 36] : null));
    const [r] = centre(evenPage(dark), 725, 525);
    expect(r).toBeLessThan(110);
  });

  it("lands paper neutral under a warm light", () => {
    const warm = paperOnly;
    const tinted = rgbImage(warm.width, warm.height);
    for (let p = 0; p < warm.data.length; p += 3) {
      tinted.data[p] = warm.data[p]!;
      tinted.data[p + 1] = Math.round(warm.data[p + 1]! * 0.88);
      tinted.data[p + 2] = Math.round(warm.data[p + 2]! * 0.7);
    }
    const after = evenPage(tinted);
    const corner = (y: number, x: number): number[] => [0, 1, 2].map((c) => after.data[(y * after.width + x) * 3 + c]!);
    const [r, g, b] = corner(4, 4);
    expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!)).toBeLessThanOrEqual(4);
    expect(r).toBeGreaterThan(PAPER_WHITE - 8);
  });
});

describe("balancing a card", () => {
  it("takes a blue cast off a card's whites, without bleaching its design", () => {
    const card = syntheticCard(856, 540);
    // Neutral white margin, under a blue light.
    for (let y = 0; y < 60; y++) for (let x = 0; x < card.width; x++) card.data.set([235, 235, 235], (y * card.width + x) * 3);
    const cast = rgbImage(card.width, card.height);
    for (let p = 0; p < card.data.length; p += 3) {
      cast.data[p] = Math.round(card.data[p]! * 0.8);
      cast.data[p + 1] = Math.round(card.data[p + 1]! * 0.88);
      cast.data[p + 2] = card.data[p + 2]!;
    }
    const after = balanceCard(cast);
    const at = (y: number, x: number): number[] => [0, 1, 2].map((c) => after.data[(y * after.width + x) * 3 + c]!);
    const [r, g, b] = at(10, 400);
    expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!)).toBeLessThanOrEqual(4);
    // The design's bands are still two different blues, not both white.
    const band = at(65, 500);
    expect(band[2]! - band[0]!).toBeGreaterThan(15);
  });

  it("leaves a card that is blue by design blue — the colour correction is capped, it does not repaint", () => {
    const blue = rgbImage(400, 252);
    for (let p = 0; p < blue.data.length; p += 3) blue.data.set(p % 7 === 0 ? [30, 30, 40] : [150, 190, 250], p);
    const after = balanceCard(blue);
    expect(after.data[3 * 1 + 2]! - after.data[3 * 1]!).toBeGreaterThan(40);
  });

  it("brightens a dim card by no more than its cap", () => {
    const dim = syntheticCard(400, 252);
    for (let i = 0; i < dim.data.length; i++) dim.data[i] = Math.round(dim.data[i]! * 0.3);
    const after = balanceCard(dim);
    for (let i = 0; i < dim.data.length; i += 997) expect(after.data[i]!).toBeLessThanOrEqual(Math.ceil(dim.data[i]! * 1.8));
  });
});

describe("levelling a card's light", () => {
  /** The test card under a light from the right: the left end at 60%. */
  const sidelit = (card: RgbImage): RgbImage => {
    const out = rgbImage(card.width, card.height);
    for (let y = 0; y < card.height; y++) {
      for (let x = 0; x < card.width; x++) {
        const s = 0.6 + 0.4 * (x / (card.width - 1));
        for (let c = 0; c < 3; c++) out.data[(y * card.width + x) * 3 + c] = Math.round(card.data[(y * card.width + x) * 3 + c]! * s);
      }
    }
    return out;
  };
  const at = (img: RgbImage, x: number, y: number): number => img.data[(y * img.width + x) * 3 + 2]!;

  it("evens a light from one side: the same print reads the same at both ends", () => {
    const card = syntheticCard(856, 540);
    const after = levelCard(sidelit(card));
    // The pale band at y=30 (rows 24–35), near each end.
    expect(at(card, 40, 30)).toBe(at(card, 820, 30));
    expect(Math.abs(at(after, 40, 30) - at(after, 820, 30))).toBeLessThan(8);
  });

  it("leaves an evenly lit card alone, dark design and all — a plane cannot follow a design", () => {
    const card = syntheticCard(856, 540);
    // A dark band across the top, as on most licences: it must be an outlier, not a shadow.
    for (let y = 0; y < 100; y++) for (let x = 0; x < card.width; x++) card.data.set([40, 70, 140], (y * card.width + x) * 3);
    expect(meanAbsDiff(levelCard(card), card)).toBeLessThan(2);
  });
});

describe("levelling a card's light, at its limits", () => {
  it("leaves an evenly lit card alone when one corner is white by design (a hologram, a blank field)", () => {
    const card = syntheticCard(856, 540);
    for (let y = 330; y < 540; y++) for (let x = 600; x < 856; x++) card.data.set([252, 252, 252], (y * card.width + x) * 3);
    expect(meanAbsDiff(levelCard(card), card)).toBeLessThan(2);
  });

  it("brightens a card nearly black at one end by no more than its cap", () => {
    const card = syntheticCard(856, 540);
    const dim = rgbImage(card.width, card.height);
    for (let y = 0; y < card.height; y++) {
      for (let x = 0; x < card.width; x++) {
        const s = 0.25 + 0.75 * (x / (card.width - 1));
        for (let c = 0; c < 3; c++) dim.data[(y * card.width + x) * 3 + c] = Math.round(card.data[(y * card.width + x) * 3 + c]! * s);
      }
    }
    const after = levelCard(dim);
    for (let i = 0; i < dim.data.length; i += 331) expect(after.data[i]!).toBeLessThanOrEqual(Math.ceil(dim.data[i]! * 1.6));
  });
});

describe("the clean copy", () => {
  it("straightens and evens a page found on a table, and records where it found it", () => {
    const page = downscaleRgb(fixture("sidelit-mild-portrait-dense"), 900);
    const truth: Quad = [{ x: 210, y: 140 }, { x: 830, y: 205 }, { x: 870, y: 1060 }, { x: 150, y: 1100 }];
    const result = cleanDocument(placeOnTable(page, truth, 1000, 1240, [62, 48, 40]), "page", 1568);
    expect(result.version).toBe(CLEAN_VERSION);
    expect(cornerError(result.quad!, truth)).toBeLessThan(12.4);
    expect(result.image.height).toBeGreaterThan(result.image.width);
  });

  it("only evens the light when no document is found, and says so", () => {
    const page = fixture("sidelit-strong-portrait-dense");
    const result = cleanDocument(page, "page", 1568);
    expect(result.quad).toBeNull();
    expect([result.image.width, result.image.height]).toEqual([page.width, page.height]);
  });
});
