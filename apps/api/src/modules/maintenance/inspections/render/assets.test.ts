import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFArray, PDFDocument, PDFStream } from "pdf-lib";
import { INSPECTION_GROUPS } from "@silvicom/shared";
import { PAGE_HEIGHT, PAGE_WIDTH, TEMPLATE_SUPPLIES } from "./layouts/keller14834Rev0122.js";
import { BAND_HEIGHT, COLUMN_GROUP_BOUNDS, GROUP_HEADINGS } from "./layouts/keller14834Rev0122Artwork.js";

/**
 * What the blank Keller page in `assets/` ACTUALLY CONTAINS, asserted against the file (D-AVI22).
 *
 * ── WHY A TEST READS A PDF ─────────────────────────────────────────────────────────────────────
 * The renderer draws four pieces of artwork the template lost. Whether it SHOULD draw them is a
 * fact about the file, and until this existed it was a belief in a comment — a belief that was
 * wrong for a fortnight, and printed a black heading where the office's own reports carry white on
 * red. `TEMPLATE_SUPPLIES` is that belief written down; this file is what makes it a claim about
 * the bytes.
 *
 * Swap in a clean export and these tests fail by name, saying which flag to flip. Flip it, and the
 * renderer stops drawing what the page already has instead of double-printing it. That is the whole
 * mechanism: neither half can move without the other failing the build.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(HERE, "assets", "keller-14834-rev0122.pdf");

/**
 * The page's content stream, decompressed.
 *
 * Illustrator writes this page as one uncompressed-after-inflate stream with no XObjects, so the
 * operators are readable directly — which is what makes "is there a red rectangle at y 563?" a
 * question with an answer rather than an opinion about a screenshot.
 */
const contentStream = await (async () => {
  const doc = await PDFDocument.load(await readFile(TEMPLATE_PATH), { ignoreEncryption: true });
  const contents = doc.getPage(0).node.Contents()!;
  const raw =
    contents instanceof PDFArray
      ? Buffer.concat(
          contents
            .asArray()
            .map((r) => Buffer.from(doc.context.lookup(r, PDFStream).getContents())),
        )
      : Buffer.from(contents.getContents());
  try {
    return inflateSync(raw).toString("latin1");
  } catch {
    return raw.toString("latin1");
  }
})();

/** Every `x y w h re` rectangle on the page, in PDF (bottom-up) coordinates. */
const rectangles = [...contentStream.matchAll(/([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+re\b/g)].map(
  (m) => ({ x: +m[1]!, y: +m[2]!, w: +m[3]!, h: +m[4]! }),
);

describe("the blank Keller template we ship", () => {
  it("is the page box the whole coordinate map assumes", async () => {
    const doc = await PDFDocument.load(await readFile(TEMPLATE_PATH), { ignoreEncryption: true });
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(PAGE_WIDTH);
    expect(Math.round(height)).toBe(PAGE_HEIGHT);
  });

  it("paints in RGB only — there is no zero-ink CMYK knockout anywhere on it", () => {
    // The earlier reading of this page said the headings were painted `0 0 0 0 scn`, which is what
    // made "the pad is pre-printed" sound like a design rather than a loss. The file has no `scn`.
    expect(contentStream).not.toContain("scn");
    expect(contentStream).toContain(" rg");
  });
});

describe("TEMPLATE_SUPPLIES matches the file, so the renderer draws exactly what is missing", () => {
  it("headingBands: no filled rectangle sits at any of the sixteen band positions", () => {
    const carried = GROUP_HEADINGS.filter((h) => {
      const [x0, x1] = COLUMN_GROUP_BOUNDS[h.column]!;
      const bottom = PAGE_HEIGHT - (h.top + BAND_HEIGHT);
      return rectangles.some(
        (r) =>
          Math.abs(r.x - x0) < 2 &&
          Math.abs(r.w - (x1 - x0)) < 4 &&
          Math.abs(r.y - bottom) < 2 &&
          Math.abs(r.h - BAND_HEIGHT) < 2,
      );
    }).map((h) => h.number);
    expect(carried, "bands the template already carries").toEqual([]);
    expect(TEMPLATE_SUPPLIES.headingBands).toBe(carried.length > 0);
  });

  it("headingTitles: fifteen strings survive as white text and `1. BRAKE SYSTEM` does not", () => {
    // The knockout text is still on the page — painted `1 1 1 rg`, so it prints white on white.
    // Group 1's is not merely invisible, it is absent, which is why the renderer supplies all
    // sixteen from the catalogue rather than only the one that went missing.
    const present = INSPECTION_GROUPS.filter((g) => contentStream.includes(`(${g.title.toUpperCase()})`));
    expect(present.map((g) => g.number)).not.toContain(1);
    expect(present.length, "the other fourteen catalogue headings are still in the file").toBe(14);
    expect(contentStream).toContain("1 1 1 rg");
    expect(TEMPLATE_SUPPLIES.headingTitles).toBe(false);
  });

  it("okColumnHeader: the ruled box survives in all three groups and the label does not", () => {
    // Its two neighbours are still there at 4 pt, which is how we know the export dropped a label
    // rather than the whole header row.
    expect(contentStream).toContain("(NEEDS)");
    expect(contentStream).toContain("(REPAIRED)");
    expect(contentStream).not.toContain("(OK)");
    expect(TEMPLATE_SUPPLIES.okColumnHeader).toBe(false);
  });

  it("identificationTick: the label still routes through a font the subset cannot encode", () => {
    // `\037` in MyriadPro — the codepoint whose glyph did not survive, so the page prints a hollow
    // .notdef box in the middle of a printed sentence.
    expect(contentStream).toContain("(VEHICLE IDENTIFICATION \\()");
    expect(contentStream).toContain("(\\037)");
    expect(TEMPLATE_SUPPLIES.identificationTick).toBe(false);
  });

  it("legendMarks: the four red blanks survive and nothing is written on them", () => {
    expect(contentStream).toContain("(INSTRUCTIONS: MARK COLUMN ENTRIES TO VERIFY INSPECTION: )");
    expect(contentStream).toContain("(OK, )");
    expect(contentStream).toContain("(NEEDS REPAIR, )");
    // Whatever the marks were, they are not `X` or `NA` glyphs on this page any more.
    expect(contentStream).not.toContain("(NA)");
    expect(TEMPLATE_SUPPLIES.legendMarks).toBe(false);
  });

  it("carries the tick-box rectangles the coordinate map is measured against", () => {
    // Nine 5.5 pt boxes: §396.19 YES, three vehicle-identification, five vehicle-type. If a future
    // export loses these too, the map is measuring against something that is no longer there.
    const boxes = rectangles.filter((r) => Math.abs(r.w - 5.5) < 0.01 && Math.abs(r.h - 5.5) < 0.01);
    expect(boxes.length).toBe(9);
  });
});
