import { parentPort } from "node:worker_threads";
import { probeAnswer } from "./bootProbeAnswer.js";

// A worker shaped like ocrWorker.ts: TypeScript that imports a sibling .ts by its .js name (pageOcr.test.ts).
const answer: string = probeAnswer();
parentPort!.postMessage(answer);
