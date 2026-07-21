/** Scoring — public barrel. Re-exports exactly what the API imported from services/scoring.ts. */
export type { ScoreOpts, BackfillOpts } from "./loaders.js";
export { RECENT_REBUILD_DAYS } from "./loaders.js";
export { scoreTransaction, learnVehicleValues } from "./scoreTransaction.js";
export type { ProgressFn } from "./backfill.js";
export { scoreWithCascade, backfillOrg, scoreImport, scoreVehicle, affectedVehicleIds, scoreImportWithCascade } from "./backfill.js";
export { reconcileCardMultiForOrg } from "./cardMultiReconcile.js";
