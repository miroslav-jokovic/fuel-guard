import { registerHandler } from "../registry.js";
import { efsIngestHandler } from "./efsIngest.js";

/**
 * Register every queue job handler. Called once at worker startup. As kinds migrate off the in-process
 * `runJob` path (WQ1/WQ2), their handlers are added here.
 */
export function registerAllHandlers(): void {
  registerHandler("efs_ingest", efsIngestHandler);
}
