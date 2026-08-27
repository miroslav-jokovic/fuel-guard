/**
 * hazmat — the hazmat vetting harness, fourteenth module (carved 2026-08-27,
 * docs/ARCHITECTURE.md §4).
 *
 * Load vetting against the pure rules engine (`@hazmat/engine` + versioned `@hazmat/data` — the
 * gate-enforced dependency-free packages this module CONSUMES but never pollutes), the vision
 * extraction pipeline with its concurrency limiter, manual analysis, equipment/cargo-tank
 * reasoning, the calculator, product lines, qualification, the DOT-inspection defense packet,
 * and the office/driver/public routes. Owns `hazmat_loads`, `hazmat_documents`,
 * `hazmat_policies`, `hazmat_reviews`, `hazmat_runs` (billed via the `record_hazmat_run` RPC
 * into org-owned `org_usage_month`).
 */
export { hazmatRouter } from "./routes/index.js";
export { publicHazmatRouter } from "./routes/publicHazmat.js";
export { meHazmatRouter } from "./routes/meHazmat.js";
export { executeExtraction } from "./hazmatExtraction/orchestrate.js";
export { executeManualAnalysis, buildManualLoadInput, type CargoTankProfileRow, type ManualLoadRow } from "./hazmatAnalysis.js";
export { readEquipmentKind } from "./hazmatEquipment.js";
