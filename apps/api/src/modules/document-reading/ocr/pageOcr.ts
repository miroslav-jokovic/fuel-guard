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
 * originals, and the engine reads nothing on a sideways page (0132900 returned no text until turned) — and
 * then, in the engine thread, from its prepared view (prepareOcrView.ts: flattened and levelled), whose
 * `toPage` carries the boxes back onto the upright page.
 * The turn is lossless (sharp's right-angle rotate), the copy the model reads gets the same one.
 *
 * One engine thread per process (ocrWorker.ts), started on first use and stopped after `idleMs` without a
 * page, so ~140 MB of models and the runtime are resident only while reads are happening. Any error or a
 * page slower than `timeoutMs` stops the thread (the next read starts a fresh one) and answers null.
 */

/** What the engine read on one page, and the prepared view it read it on (null: the upright page as is). */
export interface Recognised { items: OcrItem[]; view: { width: number; height: number; toPage: number[] } | null }
export type RecognisePage = (uprightPng: Buffer) => Promise<Recognised | null>;
export interface PageForOcr { originalPng: Buffer; rotation: PageRotation }

/** The read pages' OCR in page order (1-based), or null if any page has none — a partial set would let a
 * row's anchor count (rowWitness.ts) pass on the pages that happened to work. */
export async function ocrPages(pages: readonly PageForOcr[], recognise: RecognisePage): Promise<OcrPage[] | null> {
  const out: OcrPage[] = [];
  for (const [k, p] of pages.entries()) {
    const upright = p.rotation === 0 ? p.originalPng : await sharp(p.originalPng).rotate(p.rotation).png().toBuffer();
    const meta = await sharp(upright).metadata();
    const r = await recognise(upright);
    if (!r || !meta.width || !meta.height) return null;
    out.push(r.view
      ? { page: k + 1, width: r.view.width, height: r.view.height, items: r.items, toPage: { matrix: r.view.toPage, width: meta.width, height: meta.height } }
      : { page: k + 1, width: meta.width, height: meta.height, items: r.items });
  }
  return out;
}

/**
 * `prepare: false` reads every page as it is, as before the prepared view (`DOC_OCR_PREPARE=off`). `bootstrap` is
 * the thread's source — `workerBootstrap()` unless a test speaks the protocol without the models.
 */
export interface EngineOptions { cacheDir: string; idleMs?: number; timeoutMs?: number; prepare?: boolean; bootstrap?: string }

/** The process's OCR engine: recognise a page, or `warm` it — start the thread and load the models, no page. */
export type OcrEngine = RecognisePage & { warm: () => Promise<boolean> };

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

/**
 * The process's engine thread behind a `RecognisePage`.
 *
 * WARMED AT BOOT (TWO-CLICK-READER-PLAN TC0.3, D-TC5). The cold start a read used to pay is almost all DOWNLOAD:
 * measured 2026-10-29 on this code, starting the engine with no models on disk took 29 s (the 10/15 note's ≈30 s);
 * with them on disk, 0.56 s. A deploy starts a fresh container, and releases ship most nights, so the first read of
 * nearly every day paid the 29 s. `warm()` — called at boot by the process that runs reads (documentRead.ts) —
 * downloads, verifies and loads the models before any read; the thread then idles out like any other, and a later
 * read restarts it from disk (≈0.6 s, plus ≈1 s of first inference).
 *
 * The thread still stops after two idle minutes, which D-TC5 proposed to remove: the same measurement found a
 * loaded engine holding ~0.5 GB, ~1.2 GB once it has read a page, in every process that runs reads, to save those
 * ≈1.6 s a read. That trade is the owner's (Q-TC7 in the plan), not this code's.
 */
export function ocrEngine({ cacheDir, idleMs = 120_000, timeoutMs = 180_000, prepare = true, bootstrap }: EngineOptions): OcrEngine {
  let worker: Worker | null = null;
  let idle: NodeJS.Timeout | null = null;
  let next = 0;
  const pending = new Map<number, (r: Recognised | null) => void>();

  const stop = (why: string) => {
    if (!worker) return;
    if (why !== "idle") console.warn(`[document-ocr] engine stopped: ${why}`);
    void worker.terminate();
    worker = null;
    for (const settle of pending.values()) settle(null);
    pending.clear();
  };
  const start = (): Worker => {
    const w = new Worker(bootstrap ?? workerBootstrap(), { eval: true, workerData: { cacheDir, prepare } });
    w.on("message", (m: { id: number; items?: OcrItem[]; view?: Recognised["view"]; ready?: true; error?: string }) => {
      const settle = pending.get(m.id);
      pending.delete(m.id);
      if (m.error !== undefined) {
        settle?.(null);
        stop(m.error);
      } else settle?.(m.items ? { items: m.items, view: m.view ?? null } : m.ready ? READY : null);
    });
    w.on("error", (e: Error) => stop(e.message));
    w.unref();
    return w;
  };

  const ask = (message: { png: Buffer } | { warm: true }, limitMs: number) => {
    if (idle) clearTimeout(idle);
    worker ??= start();
    const w = worker;
    const id = next++;
    return new Promise<Recognised | null>((resolve) => {
      const timer = setTimeout(() => stop(`${"warm" in message ? "loading the models" : "a page"} took longer than ${limitMs} ms`), limitMs);
      pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
        if (pending.size === 0 && worker) idle = setTimeout(() => stop("idle"), idleMs).unref();
      });
      w.postMessage({ id, ...message });
    });
  };
  // Loading the models may download them first (~139 MB, ocrModels.ts), so it is given longer than a page.
  const engine = ((png: Buffer) => ask({ png }, timeoutMs)) as OcrEngine;
  engine.warm = async () => (await ask({ warm: true }, timeoutMs * 2)) === READY;
  return engine;
}

/** The thread's answer to `warm`: its models are loaded. Never a page's answer — a page carries items. */
const READY: Recognised = Object.freeze({ items: [], view: null }) as Recognised;
