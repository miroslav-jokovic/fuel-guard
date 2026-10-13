/**
 * Med-Stop — the drug & alcohol testing collector (docs/plans/safety-dqf/MEDSTOP-PLAN.md).
 *
 * Med-Stop is the carrier's C/TPA: it holds the random pools, draws the selections, and carries every
 * DOT test from order to the MRO's verified result. This module is the only place that speaks to it
 * and the only reader of the `medstop_*` mirror (D-ARC1, `lint:table-access`).
 *
 * MS1 is READ-ONLY toward Med-Stop: roster, pools and selections, so Safety can see who is outside
 * the random pool and how far the year's rate has to go (§6 F-1/F-2). Orders, results and the
 * hire/terminate mirror arrive in later batches, each behind a payload preview.
 */
export { startMedstopScheduler } from "./scheduler.js";
export { registerMedstopIntegrationRoutes } from "./routes/integration.js";
export { drugAlcoholRouter } from "./routes/program.js";
export { MedstopClient } from "./client.js";
export { getApiKey, recordSweep } from "./credentials.js";
export { sweepMedstop, type MedstopSweepResult } from "./sync.js";
