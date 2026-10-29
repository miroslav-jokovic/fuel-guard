import { parentPort, workerData } from "node:worker_threads";
import { PaddleOcrService } from "ppu-paddle-ocr";
import { modelFile, OCR_MODEL_FILES } from "./ocrModels.js";
import { prepareOcrView } from "./prepareOcrView.js";

/**
 * The OCR engine's thread (pageOcr.ts starts it). Reads run in the API process today
 * (`JOB_EXECUTION_MODE` is unset on Railway, so `inprocess`), and a page is seconds of CPU — image decoding
 * and box geometry in JavaScript between the native inferences — so it runs here, off the thread that
 * answers requests (the sync_hos freeze, #1327, is what a long synchronous job on that thread costs).
 *
 * Settings are the library's defaults, as the spike measured them, except the inference thread count,
 * which is capped so a read cannot take every core from the requests beside it. Pages are recognised one
 * at a time, in arrival order.
 */

const { cacheDir, prepare } = workerData as { cacheDir: string; prepare: boolean };
const ab = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const ready = (async () => {
  const [detection, recognition, charactersDictionary] = await Promise.all([
    modelFile(OCR_MODEL_FILES.detection, cacheDir),
    modelFile(OCR_MODEL_FILES.recognition, cacheDir),
    modelFile(OCR_MODEL_FILES.charactersDictionary, cacheDir),
  ]);
  const service = new PaddleOcrService({
    model: { detection: ab(detection), recognition: ab(recognition), charactersDictionary: ab(charactersDictionary) },
    session: { intraOpNumThreads: 2 },
  });
  await service.initialize();
  return service;
})();
// A failed start is answered on the next page's message; it must not also end the thread as unhandled.
ready.catch(() => {});

let queue: Promise<unknown> = Promise.resolve();
parentPort!.on("message", (msg: { id: number; png?: Uint8Array; warm?: true }) => {
  queue = queue.then(async () => {
    try {
      const service = await ready;
      // `warm` (TC0.3): the process asks at boot so the models are loaded before the first read, not during it.
      if (msg.warm || !msg.png) return void parentPort!.postMessage({ id: msg.id, ready: true });
      const png = Buffer.from(msg.png.buffer, msg.png.byteOffset, msg.png.byteLength);
      // The prepared view (prepareOcrView.ts) is the witness's own; failing to make one reads the page as is.
      const view = prepare ? await prepareOcrView(png).catch(() => null) : null;
      const r = await service.recognize(ab(view?.png ?? png));
      const items = r.lines.flat().map((i) => ({ text: i.text, box: i.box }));
      parentPort!.postMessage({ id: msg.id, items, view: view && { width: view.width, height: view.height, toPage: view.toPage } });
    } catch (e) {
      parentPort!.postMessage({ id: msg.id, error: e instanceof Error ? e.message : String(e) });
    }
  });
});
