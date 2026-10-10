import { z } from "zod";

/**
 * The dispatch board's environment (`docs/plans/dispatch-loads/DISPATCH-BOARD-PLAN.md`), split out of
 * `env.ts` on the `envDocumentReading.ts` precedent: one plan, one group of variables, and `env.ts` sits
 * at its 500-line budget. Spread into the one schema, so a deployment still gets one parse.
 */
export const dispatchBoardEnvFields = {
  // The HOS clocks poll (DB3): one GET /fleet/hos/clocks for the whole fleet into `driver_hos_clocks`.
  // Five minutes, because a drive clock moves a minute a minute and the board flags a truck under two
  // hours; at one request per tick it is 288 calls a day against a 50 req/s budget. 0 disables it.
  SAMSARA_HOS_CLOCKS_SYNC_MINUTES: z.coerce.number().min(0).default(5),
};
