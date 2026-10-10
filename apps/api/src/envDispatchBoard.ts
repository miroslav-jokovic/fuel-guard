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
  // The board's ETA recorder (DB7, 0453): one sample of every truck's ETA to its next stop, kept so it
  // can be scored against the arrival. Hourly, because the error by hours-out is the question and an
  // hour is that axis's resolution; ~2,900 rows a day. No vendor call. 0 disables it.
  DISPATCH_BOARD_ETA_RECORD_MINUTES: z.coerce.number().min(0).default(60),
};
