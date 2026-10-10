import { z } from "zod";

/**
 * The dispatch board's wire contract (`docs/plans/dispatch-loads/DISPATCH-BOARD-PLAN.md`, DB4).
 *
 * One row per active TRUCK (D-DB2) — the "power board" every long-haul planning screen converges on —
 * and never per load: the Loads page owns the order record (D-DB5). The API composes the row from its
 * owners (roster, samsara, loads, mcleod) and the shared rules in `dispatchBoard.ts` decide every verdict
 * on it, so the board and anything else that shows an on-time badge cannot disagree.
 */

const iso = z.string();

/** A stop as the board shows it: where, the appointment window, and whether the truck is there. */
export const dispatchBoardStopSchema = z.object({
  kind: z.string().nullable(),
  /** McLeod's place name first, then ours — the Loads board's `placeOf` order. */
  name: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  appointmentStart: iso.nullable(),
  appointmentEnd: iso.nullable(),
  /** The truck reached the stop (McLeod's actual arrival); null while it is still on its way. */
  arrivedAt: iso.nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
});
export type DispatchBoardStop = z.infer<typeof dispatchBoardStopSchema>;

export const dispatchBoardLoadSchema = z.object({
  loadId: z.string(),
  ref: z.string().nullable(),
  /** Status, source and McLeod's code, so the client words it with `loadBoardState` like the Loads page. */
  status: z.string(),
  source: z.string().nullable(),
  externalStatus: z.string().nullable(),
  customerName: z.string().nullable(),
  /** McLeod's login of the dispatcher on the LOAD — who is moving it (D-LM3), not who owns the truck. */
  dispatcherId: z.string().nullable(),
  driverName: z.string().nullable(),
  trailerUnit: z.string().nullable(),
  /** The first stop not behind the truck (`nextStopOnRoute`), and the last delivery (`boardStops`). */
  nextStop: dispatchBoardStopSchema.nullable(),
  lastStop: dispatchBoardStopSchema.nullable(),
  /** Stops still ahead, the next one included. */
  stopsLeft: z.number().int(),
});
export type DispatchBoardLoad = z.infer<typeof dispatchBoardLoadSchema>;

export const dispatchBoardHosSchema = z.object({
  status: z.string(),
  driveRemainingMs: z.number().nullable(),
  shiftRemainingMs: z.number().nullable(),
  cycleRemainingMs: z.number().nullable(),
  breakRemainingMs: z.number().nullable(),
  fetchedAt: iso,
});
export type DispatchBoardHos = z.infer<typeof dispatchBoardHosSchema>;

export const ON_TIME_VERDICTS = ["on_time", "at_risk", "late", "unknown"] as const;
export type OnTimeVerdict = (typeof ON_TIME_VERDICTS)[number];

export const dispatchBoardEtaSchema = z.object({
  at: iso,
  miles: z.number(),
  /** A ten-hour reset was added because the legal drive time runs out before the stop. */
  restAdded: z.boolean(),
});
export type DispatchBoardEta = z.infer<typeof dispatchBoardEtaSchema>;

export const dispatchBoardFlagsSchema = z.object({
  lateRisk: z.boolean(),
  noNextLoad: z.boolean(),
  emptyNow: z.boolean(),
  hosLow: z.boolean(),
  noGps: z.boolean(),
});
export type DispatchBoardFlags = z.infer<typeof dispatchBoardFlagsSchema>;

export const dispatchBoardRowSchema = z.object({
  vehicleId: z.string(),
  unitNumber: z.string(),
  inShop: z.boolean(),
  /** The truck's McLeod home fleet ('VINNIEV'), verbatim; null until the connector sends it. */
  fleetCode: z.string().nullable(),
  driver: z.object({ id: z.string(), name: z.string() }).nullable(),
  hos: dispatchBoardHosSchema.nullable(),
  position: z
    .object({
      place: z.string().nullable(),
      lat: z.number(),
      lng: z.number(),
      speedMph: z.number().nullable(),
      sampledAt: iso,
      ageSeconds: z.number().nullable(),
    })
    .nullable(),
  fuelPercent: z.number().nullable(),
  current: dispatchBoardLoadSchema.nullable(),
  next: dispatchBoardLoadSchema.nullable(),
  eta: dispatchBoardEtaSchema.nullable(),
  onTime: z.enum(ON_TIME_VERDICTS),
  /** Where and when the truck is next empty — the delivery city and the later of its appointment and the ETA. */
  empties: z.object({ place: z.string().nullable(), at: iso.nullable() }).nullable(),
  flags: dispatchBoardFlagsSchema,
});
export type DispatchBoardRow = z.infer<typeof dispatchBoardRowSchema>;

/**
 * Whose board this is (D-DB3). `fleetCodes` are the fleets the caller's McLeod login runs (an office
 * confirms each link in Settings); `dispatcherIds` are the caller's McLeod logins. `linked` is false
 * when the caller is no McLeod dispatcher at all — the board then opens on All and says why.
 */
export const dispatchScopeSchema = z.object({
  linked: z.boolean(),
  fleetCodes: z.array(z.string()),
  dispatcherIds: z.array(z.string()),
});
export type DispatchScope = z.infer<typeof dispatchScopeSchema>;

export const dispatchBoardResponseSchema = z.object({
  generatedAt: iso,
  rows: z.array(dispatchBoardRowSchema),
  scope: dispatchScopeSchema,
  /** Every fleet code seen, with the dispatcher an office linked it to (null = not linked yet). */
  fleets: z.array(z.object({ code: z.string(), dispatcherId: z.string().nullable() })),
  /** McLeod dispatcher logins, for naming a load's dispatcher and for the Dispatched-by filter. */
  dispatchers: z.array(z.object({ id: z.string(), name: z.string().nullable(), isSystem: z.boolean() })),
  /**
   * Open loads no truck carries — they have no row here, so the board links to Loads' Uncovered queue
   * with this count. A count and not "mine": McLeod names no dispatcher on an uncovered (`A`) load
   * (0 of 32 on 2026-10-09), so "uncovered in my fleet" is a fact nobody has, and is not invented.
   */
  uncoveredCount: z.number().int(),
  /** Newest HOS clocks poll; null when it has never run. The header says "HOS as of …". */
  hosAsOf: iso.nullable(),
});
export type DispatchBoardResponse = z.infer<typeof dispatchBoardResponseSchema>;
