/**
 * @silvicom/ads-golden — the ads agent's golden scenarios as data (ADS-AGENT-BUILD-WORKFLOW.md §4R,
 * step 7d). The runner that drives the real orchestrator through them lives in `apps/api`
 * (`src/testing/adsGolden.ts`); `schema.ts` says why.
 */
export * from "./schema.js";
export * from "./monitorSchema.js";
export * from "./leadSchema.js";
export * from "./load.js";
