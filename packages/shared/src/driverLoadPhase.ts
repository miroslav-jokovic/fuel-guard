import { isStopBehindTruck, nextStopOnRoute } from "./loadBoard.js";
import type { Load, LoadStatus, LoadStop } from "./loadsContract.js";

/**
 * Where a load sits for the DRIVER — the app's tabs, its next stop and its stop counter (T1 N-9, spec
 * A §3.3 with audit A-18 / A-20). Moved out of `loadsContract.ts` because they now read the office's
 * `isStopBehindTruck` (loadBoard.ts), which imports that file.
 *
 * ── ONE READING OF "BEHIND THE TRUCK" (Q-MK3, ruled 2026-11-19) ──────────────────────────────────
 * Until N-9 the driver's `nextStop` counted only the app's own stop statuses, and the office's
 * `nextStopOnRoute` also counted McLeod's departures; the two were kept apart while Q-LMR2 (whose
 * account of a stop is the truth) was open. Q-MK3 ruled the display half: McLeod's facts first, the
 * driver's labelled, never merged. So a stop McLeod departed, or removed (D-MK15), is behind the driver
 * too — the phone no longer sends a driver to a pickup the office's board shows as done. No stored
 * value changes: the stop's own `status` stays the driver's, and a manual load (no McLeod fields) reads
 * exactly as before.
 */

/** The three buckets the driver app groups a MANUAL load's statuses into. */
export function loadBucket(status: LoadStatus): "upcoming" | "current" | "previous" {
  // Only `in_transit` is Current — a load the driver has accepted but not started working is still
  // Upcoming. (This is the pairing that made `in_transit` unreachable before 0087 gave it a writer.)
  if (status === "in_transit") return "current";
  if (status === "delivered" || status === "canceled") return "previous";
  // Everything else — including the dispatch-only states a driver never receives — is ahead of them.
  return "upcoming";
}

/** The next stop a driver should work: the first, by sequence, that is not behind the truck. */
export function nextStop(load: Pick<Load, "stops">): LoadStop | null {
  return nextStopOnRoute(load.stops);
}

/** Progress along the run, for the Home hero's stop counter and bar. */
export function stopProgress(load: Pick<Load, "stops">): { current: number; total: number } {
  const total = load.stops.length;
  const done = load.stops.filter(isStopBehindTruck).length;
  // "Stop 2 of 3" means the one being worked on, so clamp to the total once everything is finished.
  return { current: Math.min(done + 1, Math.max(total, 1)), total };
}

export const DRIVER_LOAD_PHASES = ["awaiting_ack", "upcoming", "current", "previous"] as const;
export type DriverLoadPhase = (typeof DRIVER_LOAD_PHASES)[number];

/**
 * The driver's phase of a load. A manual load is `loadBucket(status)` exactly as before (an `offered`
 * load stays the offer deck). A McLeod load's status is McLeod's and the driver never moves it
 * (D-LMR2), so the app derives its phase from the STOPS:
 *   · previous — McLeod delivered or canceled it, or every stop is behind the truck (even while McLeod
 *     still says in_transit: the driver has nothing left to do on it);
 *   · current — McLeod has it in_transit, or the driver has touched any stop (their first Arrive makes
 *     it Current with `loads.status` still approved);
 *   · awaiting_ack — sent, untouched, and this driver has not said "Got it" to the current dispatch;
 *   · upcoming — sent, untouched, acknowledged.
 * `acknowledged_at` is read off the load (A-20): the API derives it per driver, so no caller restates it.
 */
export function driverLoadPhase(
  load: Pick<Load, "source" | "status" | "stops" | "acknowledged_at">,
): DriverLoadPhase {
  if (load.source !== "tms") return loadBucket(load.status);
  if (load.status === "delivered" || load.status === "canceled") return "previous";
  if (load.stops.length > 0 && load.stops.every(isStopBehindTruck)) return "previous";
  if (load.status === "in_transit" || load.stops.some((s) => s.status !== "pending")) return "current";
  return load.acknowledged_at === null ? "awaiting_ack" : "upcoming";
}
