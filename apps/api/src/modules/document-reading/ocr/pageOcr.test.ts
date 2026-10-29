import sharp from "sharp";
import { Worker } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { ocrEngine, ocrPages, workerBootstrap, type RecognisePage } from "./pageOcr.js";

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

describe("ocrEngine — warmed at boot (TWO-CLICK-READER-PLAN TC0.3)", () => {
  // The protocol worker answers each page with the id of the thread that read it.
  const engineOf = (opts: { idleMs?: number; failReady?: boolean } = {}) => ocrEngine({
    cacheDir: opts.failReady ? "no-models" : "unused", idleMs: opts.idleMs,
    bootstrap: `${workerBootstrap(new URL("./fixtures/engineProtocolWorker.ts", import.meta.url))}`,
  });
  const threadOf = async (engine: RecognisePage) => (await engine(Buffer.from("page")))?.items[0]?.text;

  it("answers warm once the thread has its models, and the next page is read by that same thread", async () => {
    const engine = engineOf();
    expect(await engine.warm()).toBe(true);
    const first = await threadOf(engine);
    expect(first).toMatch(/^thread \d+$/);
    expect(await threadOf(engine)).toBe(first);
  });

  it("answers not warm when the models do not load, and a page then has no OCR rather than a wrong one", async () => {
    const engine = engineOf({ failReady: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await engine.warm()).toBe(false);
      expect(await engine(Buffer.from("page"))).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it("never mistakes a warm for a page: the page after it carries its own items", async () => {
    const engine = engineOf();
    await engine.warm();
    expect((await engine(Buffer.from("page")))?.items).toHaveLength(1);
  });

  it("still stops an idle thread, so a later page starts a new one (the resident engine is Q-TC7's to rule)", async () => {
    const engine = engineOf({ idleMs: 30 });
    await engine.warm();
    const first = await threadOf(engine);
    await new Promise((r) => setTimeout(r, 120));
    const second = await threadOf(engine);
    expect(second).toMatch(/^thread \d+$/);
    expect(second).not.toBe(first);
  });
});
