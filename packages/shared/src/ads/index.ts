// The ads module's pure half (ADS-AGENT-BUILD-WORKFLOW.md A3; D-AD16, D-AD17). No clock, no I/O,
// no randomness (`lint:boundaries`): the orchestrator, the guard and the screens all read these.
export * from "./contracts.js";
export * from "./settingsContract.js";
export * from "./campaignMachine.js";
export * from "./adsPolicy.js";
export * from "./adClaims.js";
export * from "./presetDraw.js";
export * from "./naming.js";
export * from "./renderGeometry.js";
export * from "./adsReport.js";
export * from "./aiRail.js";
