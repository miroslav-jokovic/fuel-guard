import { parentPort, threadId, workerData } from "node:worker_threads";

// A worker speaking ocrWorker.ts's protocol without its 139 MB of models (pageOcr.test.ts, TC0.3): `warm` is
// answered `ready` once its "models" load, a page with one item naming this thread — so a test can tell a
// restarted engine from the same one — and a `cacheDir` of "no-models" answers every message with the load's error.
const failReady = (workerData as { cacheDir?: string } | undefined)?.cacheDir === "no-models";
parentPort!.on("message", (msg: { id: number; warm?: true }) => {
  if (failReady) parentPort!.postMessage({ id: msg.id, error: "the models did not load" });
  else if (msg.warm) parentPort!.postMessage({ id: msg.id, ready: true });
  else parentPort!.postMessage({ id: msg.id, items: [{ text: `thread ${threadId}`, box: { x: 0, y: 0, width: 1, height: 1 } }], view: null });
});
