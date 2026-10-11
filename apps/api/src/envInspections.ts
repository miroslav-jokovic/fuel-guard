import { z } from "zod";

/**
 * The inspection-challenge engine's environment (`docs/plans/safety-dqf/INSPECTION-CHALLENGE-PLAN.md`),
 * split out of `env.ts` on the `envDispatchBoard.ts` precedent: one plan, one group of variables, and
 * `env.ts` sits at its 500-line budget. Spread into the one schema, so a deployment still gets one parse.
 */
export const inspectionsEnvFields = {
  // The FMCSA open-data feed (IC1, 0457): our whole record from six data.transportation.gov datasets,
  // ~7,000 rows, compared against the stored versions. FMCSA republishes daily (each dataset's
  // `rowsUpdatedAt`, measured 2026-10-10), so a run is due 24 hours after the last successful one.
  // Public data and no vendor contract, so it is on by default. 0 disables it.
  FMCSA_FEED_HOURS: z.coerce.number().min(0).default(24),
  // Optional Socrata app token. Without one, requests share the anonymous per-IP pool, which is
  // enough for one carrier's ~30 requests a day; a token only raises that ceiling.
  FMCSA_SOCRATA_APP_TOKEN: z.string().optional(),
};
