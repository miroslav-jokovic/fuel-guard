import { Worker } from "node:worker_threads";
import sharp from "sharp";
import type { PageRotation } from "@silvicom/shared";
import type { OcrItem, OcrPage } from "../evidence/rowWitness.js";

/**
 * The OCR witness's engine, as the read sees it (DOCUMENT-READER-PLAN §7B A5): the read's pages in, their
 * text boxes out, or null. Null is the witness ABSENT, never a failed read — the read is the models', and a
 * missing witness only means its fields keep the evidence they had before A5 (shippingEvidence.ts).
 *
 * Each page is OCR'd from the verified ORIGINAL turned upright by P2's verdict — the spike measured 300 DPI
 * originals, and the engine reads nothing on a sideways page (0132900 returned no text until turned).
 * The turn is lossless (sharp's right-angle rotate), the copy the model reads gets the same one.
 *
 * One engine thread per process (ocrWorker.ts), started on first use and stopped after `idleMs` without a
 * page, so ~140 MB of models and the runtime are resident only while reads are happening. Any error or a
 * page slower than `timeoutMs` stops the thread (the next read starts a fresh one) and answers null.
 */

export type RecognisePage = (uprightPng: Buffer) => Promise<OcrItem[] | null>;
export interface PageForOcr { originalPng: Buffer; rotation: PageRotation }

/** The read pages' OCR in page order (1-based), or null if any page has none — a partial set would let a
 * row's anchor count (rowWitness.ts) pass on the pages that happened to work. */
export async function ocrPages(pages: readonly PageForOcr[], recognise: RecognisePage): Promise<OcrPage[] | null> {
  const out: OcrPage[] = [];
  for (const [k, p] of pages.entries()) {
    const upright = p.rotation === 0 ? p.originalPng : await sharp(p.originalPng).rotate(p.rotation).png().toBuffer();
    const meta = await sharp(upright).metadata();
    const items = await recognise(upright);
    if (!items || !meta.width || !meta.height) return null;
    out.push({ page: k + 1, width: meta.width, height: meta.height, items });
  }
  return out;
}

export interface EngineOptions { cacheDir: string; idleMs?: number; timeoutMs?: number }

/**
 * The engine thread's entry: a two-line bootstrap that registers tsx in the thread, THEN imports the worker.
 *
 * Why not `new Worker(ocrWorker.ts)`. The API runs TypeScript through `node --import tsx` with no build step,
 * and whether that loader reaches a worker thread depends on the Node release. Production's Node 24.10.0
 * (nixpacks `nodejs_24`) starts the thread WITHOUT it: Node's own type stripping loads ocrWorker.ts and then
 * cannot resolve its `./ocrModels.js` import to the .ts beside it. Every page failed with "Cannot find module
 * …/ocrModels.js imported from …/ocrWorker.ts" (production log, 2026-10-13), so the OCR witness has never
 * run there — on 24.22 and 26 the loader carries over, which is why no local run saw it. Registering tsx in
 * the thread itself works on every release. Its URL is resolved here, from this module, as the main thread
 * resolved it, so the thread does not depend on its working directory.
 */
export function workerBootstrap(workerUrl: URL = new URL("./ocrWorker.ts", import.meta.url)): string {
  const tsxApi = import.meta.resolve("tsx/esm/api");
  return `import(${JSON.stringify(tsxApi)}).then((m) => { m.register(); return import(${JSON.stringify(workerUrl.href)}); });`;
}

/** The process's engine thread behind a `RecognisePage`. */
export function ocrEngine({ cacheDir, idleMs = 120_000, timeoutMs = 180_000 }: EngineOptions): RecognisePage {
  let worker: Worker | null = null;
  let idle: NodeJS.Timeout | null = null;
  let next = 0;
  const pending = new Map<number, (items: OcrItem[] | null) => void>();

  const stop = (why: string) => {
    if (!worker) return;
    if (why !== "idle") console.warn(`[document-ocr] engine stopped: ${why}`);
    void worker.terminate();
    worker = null;
    for (const settle of pending.values()) settle(null);
    pending.clear();
  };
  const start = (): Worker => {
    const w = new Worker(workerBootstrap(), { eval: true, workerData: { cacheDir } });
    w.on("message", (m: { id: number; items?: OcrItem[]; error?: string }) => {
      const settle = pending.get(m.id);
      pending.delete(m.id);
      if (m.error !== undefined) {
        settle?.(null);
        stop(m.error);
      } else settle?.(m.items ?? null);
    });
    w.on("error", (e: Error) => stop(e.message));
    w.unref();
    return w;
  };

  return (png) => {
    if (idle) clearTimeout(idle);
    worker ??= start();
    const w = worker;
    const id = next++;
    return new Promise<OcrItem[] | null>((resolve) => {
      const timer = setTimeout(() => stop(`a page took longer than ${timeoutMs} ms`), timeoutMs);
      pending.set(id, (items) => {
        clearTimeout(timer);
        resolve(items);
        if (pending.size === 0 && worker) idle = setTimeout(() => stop("idle"), idleMs).unref();
      });
      w.postMessage({ id, png });
    });
  };
}
