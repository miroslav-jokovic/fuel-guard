import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { ocrPages, type RecognisePage } from "./pageOcr.js";

/** The read's pages to the OCR engine (§7B A5): upright, in order, all or nothing. */
const png = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#fff" } }).png().toBuffer();
const item = { text: "UN2735", box: { x: 1, y: 2, width: 3, height: 4 } };

describe("ocrPages", () => {
  it("gives the engine each page turned upright by its P2 rotation, and numbers pages in read order", async () => {
    const seen: { width?: number; height?: number }[] = [];
    const recognise: RecognisePage = async (b) => (seen.push(await sharp(b).metadata()), [item]);
    const out = await ocrPages([{ originalPng: await png(30, 20), rotation: 0 }, { originalPng: await png(30, 20), rotation: 270 }], recognise);
    expect(seen.map((m) => [m.width, m.height])).toEqual([[30, 20], [20, 30]]);
    expect(out).toEqual([
      { page: 1, width: 30, height: 20, items: [item] },
      { page: 2, width: 20, height: 30, items: [item] },
    ]);
  });

  it("is null when any page has no OCR, so a row's anchor count is never taken over part of the document", async () => {
    const recognise = vi.fn<RecognisePage>().mockResolvedValueOnce([item]).mockResolvedValueOnce(null);
    expect(await ocrPages([{ originalPng: await png(10, 10), rotation: 0 }, { originalPng: await png(10, 10), rotation: 0 }], recognise)).toBeNull();
  });
});
