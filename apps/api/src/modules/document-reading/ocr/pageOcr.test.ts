import sharp from "sharp";
import { Worker } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { ocrPages, workerBootstrap, type RecognisePage } from "./pageOcr.js";

/** The read's pages to the OCR engine (§7B A5): upright, in order, all or nothing. */
const png = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#fff" } }).png().toBuffer();
const item = { text: "UN2735", box: { x: 1, y: 2, width: 3, height: 4 } };

describe("ocrPages", () => {
  it("gives the engine each page turned upright by its P2 rotation, and numbers pages in read order", async () => {
    const seen: { width?: number; height?: number }[] = [];
    const recognise: RecognisePage = async (b) => (seen.push(await sharp(b).metadata()), { items: [item], view: null });
    const out = await ocrPages([{ originalPng: await png(30, 20), rotation: 0 }, { originalPng: await png(30, 20), rotation: 270 }], recognise);
    expect(seen.map((m) => [m.width, m.height])).toEqual([[30, 20], [20, 30]]);
    expect(out).toEqual([
      { page: 1, width: 30, height: 20, items: [item] },
      { page: 2, width: 20, height: 30, items: [item] },
    ]);
  });

  it("keeps the engine's boxes in its prepared view's pixels and says how they map onto the upright page", async () => {
    const toPage = [2, 0, 5, 0, 2, 7, 0, 0, 1];
    const recognise: RecognisePage = async () => ({ items: [item], view: { width: 12, height: 9, toPage } });
    expect(await ocrPages([{ originalPng: await png(30, 20), rotation: 270 }], recognise)).toEqual([
      { page: 1, width: 12, height: 9, items: [item], toPage: { matrix: toPage, width: 20, height: 30 } },
    ]);
  });

  it("is null when any page has no OCR, so a row's anchor count is never taken over part of the document", async () => {
    const recognise = vi.fn<RecognisePage>().mockResolvedValueOnce({ items: [item], view: null }).mockResolvedValueOnce(null);
    expect(await ocrPages([{ originalPng: await png(10, 10), rotation: 0 }, { originalPng: await png(10, 10), rotation: 0 }], recognise)).toBeNull();
  });
});

describe("workerBootstrap", () => {
  // The thread is started with NO loader from its parent (`execArgv: []`), which is what production's Node
  // 24.10.0 gave the engine thread: a worker importing a sibling .ts by its .js name must still load.
  it("loads a TypeScript worker that imports a sibling by its .js name, with nothing inherited from the parent", async () => {
    const w = new Worker(workerBootstrap(new URL("./fixtures/bootProbeWorker.ts", import.meta.url)), { eval: true, execArgv: [] });
    try {
      const answer = await new Promise((resolve, reject) => {
        w.once("message", resolve);
        w.once("error", reject);
      });
      expect(answer).toBe("loaded");
    } finally {
      await w.terminate();
    }
  });
});
