import { z } from "zod";
import { recordId } from "./recordId.js";

/**
 * Home time — a period the office marks on a driver, with the time he is due back
 * (`docs/plans/dispatch-loads/HOME-TIME-PLAN.md` §3, step HT2). The wire shapes of
 * `/api/roster/home-time` and of the dispatch board's `homeTimes`; the rules are in `homeTime.ts`.
 *
 * The record is a row of `driver_time_off` with `provider = 'silvicom'` (0597, D-HT1). Its state is
 * DERIVED from its times and never stored (D-HT2), so nothing has to run for a scheduled period to
 * become active, and every reader gets the state from `homeTimeState`.
 */

/** Where the truck is while the driver is home, as the dispatcher said — the column's CHECK (0597). */
export const HOME_TIME_DISPOSITIONS = ["with_driver", "at_yard", "no_truck"] as const;
export type HomeTimeDisposition = (typeof HOME_TIME_DISPOSITIONS)[number];

export const HOME_TIME_DISPOSITION_LABELS: Record<HomeTimeDisposition, string> = {
  with_driver: "Goes home with the driver",
  at_yard: "Stays at the yard",
  no_truck: "No truck",
};

/** Why a period ended — the column's CHECK (0597). `load_evidence` is the system's (D-HT6). */
export const HOME_TIME_END_REASONS = ["returned", "load_evidence", "driver_left"] as const;
export type HomeTimeEndReason = (typeof HOME_TIME_END_REASONS)[number];

export const HOME_TIME_STATES = ["scheduled", "active", "overdue", "ended", "canceled"] as const;
export type HomeTimeState = (typeof HOME_TIME_STATES)[number];

const iso = z.string();
const instant = z.string().refine((v) => Number.isFinite(Date.parse(v)), "Enter a date and time");

export const homeTimePeriodSchema = z.object({
  id: recordId(),
  driverId: recordId(),
  driverName: z.string(),
  /** The truck the driver had when the period was marked; null for a driver without one. */
  vehicleId: recordId().nullable(),
  unitNumber: z.string().nullable(),
  disposition: z.enum(HOME_TIME_DISPOSITIONS),
  startAt: iso,
  expectedReturnAt: iso,
  /** When it actually ended; null while the driver is still off (the fuel rule's reading too). */
  endAt: iso.nullable(),
  endReason: z.enum(HOME_TIME_END_REASONS).nullable(),
  canceledAt: iso.nullable(),
  /** `homeTimeState` at the response's clock. */
  state: z.enum(HOME_TIME_STATES),
  markedByName: z.string().nullable(),
  createdAt: iso,
  updatedAt: iso,
});
export type HomeTimePeriod = z.infer<typeof homeTimePeriodSchema>;

/** The carrier's three alert thresholds (D-HT12) — `home_time_settings`' CHECK ranges, restated so a form can say so. */
export const homeTimeSettingsSchema = z.object({
  returnDueHours: z.number().int().min(1).max(168),
  overdueAfterHours: z.number().int().min(0).max(72),
  truckLimitDays: z.number().int().min(1).max(60),
});
export type HomeTimeSettings = z.infer<typeof homeTimeSettingsSchema>;

/**
 * The thresholds of a carrier that has saved none — the ONE place the numbers are written (0597 gives
 * the columns no default on purpose). Owner's ruling Q-HT2, 2026-11-13: a day before, two hours after,
 * eight days for a truck at home.
 */
export const HOME_TIME_DEFAULTS: HomeTimeSettings = { returnDueHours: 24, overdueAfterHours: 2, truckLimitDays: 8 };

// ── writes ────────────────────────────────────────────────────────────────────────────────────────

/** `POST /api/roster/home-time` — mark a driver's home time. */
export const homeTimeMarkSchema = z
  .object({
    driverId: recordId(),
    startAt: instant,
    expectedReturnAt: instant,
    disposition: z.enum(HOME_TIME_DISPOSITIONS),
    vehicleId: recordId().nullable(),
  })
  .refine((v) => Date.parse(v.expectedReturnAt) > Date.parse(v.startAt), {
    path: ["expectedReturnAt"],
    message: "The return must be after the start",
  })
  // 0597's HT003, said before the round trip: a truck is named exactly when the driver has one.
  .refine((v) => (v.disposition === "no_truck") === (v.vehicleId === null), {
    path: ["disposition"],
    message: "Say where the truck is",
  });
export type HomeTimeMark = z.infer<typeof homeTimeMarkSchema>;

/**
 * `PATCH /api/roster/home-time/:id` — a new return time, a corrected start, or the truck going back to
 * the yard (or out again). Only what is sent changes. `no_truck` is not offered: a driver who had a truck
 * when the period was marked still has a truck somewhere.
 */
export const homeTimeChangeSchema = z
  .object({
    startAt: instant.optional(),
    expectedReturnAt: instant.optional(),
    disposition: z.enum(["with_driver", "at_yard"]).optional(),
  })
  .refine((v) => v.startAt !== undefined || v.expectedReturnAt !== undefined || v.disposition !== undefined, {
    message: "Nothing to change",
  });
export type HomeTimeChange = z.infer<typeof homeTimeChangeSchema>;

/** `POST /api/roster/home-time/:id/end` — the driver is back. No `endAt` means now. */
export const homeTimeEndSchema = z.object({ endAt: instant.optional() });
export type HomeTimeEnd = z.infer<typeof homeTimeEndSchema>;

// ── reads ─────────────────────────────────────────────────────────────────────────────────────────

/** `GET /api/roster/home-time` — everyone scheduled, home or overdue, then the last periods that closed. */
export const homeTimeListResponseSchema = z.object({
  generatedAt: iso,
  live: z.array(homeTimePeriodSchema),
  recent: z.array(homeTimePeriodSchema),
  settings: homeTimeSettingsSchema,
});
export type HomeTimeListResponse = z.infer<typeof homeTimeListResponseSchema>;

/** A driver the form can be opened on: the roster's active drivers with the truck each is paired to. */
export const homeTimeDriverOptionSchema = z.object({
  driverId: recordId(),
  driverName: z.string(),
  vehicleId: recordId().nullable(),
  unitNumber: z.string().nullable(),
  /** The disposition of this driver's previous period, to pre-select (plan §3.3); null the first time. */
  lastDisposition: z.enum(HOME_TIME_DISPOSITIONS).nullable(),
});
export type HomeTimeDriverOption = z.infer<typeof homeTimeDriverOptionSchema>;

// ── the dispatch board ────────────────────────────────────────────────────────────────────────────

/**
 * What the Warnings cell says about a seat's home time (D-HT11). `overdue` and `truck_limit` are the two
 * a dispatcher must act on (`homeTimeChipUrgent`).
 */
export const HOME_TIME_CHIPS = ["scheduled", "home", "return_due", "overdue", "truck_limit"] as const;
export type HomeTimeChip = (typeof HOME_TIME_CHIPS)[number];

/** One seat's live period on a board row (D-HT9), added after the row cache like the note chips. */
export const boardHomeTimeSchema = z.object({
  periodId: recordId(),
  driverId: recordId(),
  driverName: z.string(),
  state: z.enum(HOME_TIME_STATES),
  startAt: iso,
  expectedReturnAt: iso,
  disposition: z.enum(HOME_TIME_DISPOSITIONS),
  chips: z.array(z.enum(HOME_TIME_CHIPS)),
});
export type BoardHomeTime = z.infer<typeof boardHomeTimeSchema>;
