import type { SupabaseClient } from "@supabase/supabase-js";
import { ATTRIBUTION_ENGINE_VERSION, type AttributionOutcome } from "@silvicom/shared";
import type { SamsaraRawFetcher } from "../../samsara/index.js";
import { dataOf, freezeAnswer } from "./freeze.js";
import {
  ATTRIBUTION_WINDOW_MS,
  assignmentsOf,
  candidateIntervals,
  fixesOf,
  hullOf,
  readAttribution,
  resolveInstant,
  type DriverReading,
  type Reading,
} from "./reading.js";

/**
 * One roadside inspection, attributed: ask Samsara, freeze every answer, read the freeze, write the
 * reading (INSPECTION-CHALLENGE-PLAN IC5; D-IC4, D-IC7, D-IC8; tables 0473).
 *
 * ── THE ORDER IS THE GUARANTEE ─────────────────────────────────────────────────────────────────
 * Every answer is frozen BEFORE the attribution row is written, and the reading is made from the
 * frozen answer, not from a second request. So the row never names a driver the snapshots cannot
 * show, and a failure part-way leaves snapshots without a row — the next tick asks again and
 * writes a second, identical set (same hashes, same objects), which is harmless and visible.
 *
 * ── WHAT IS ASKED ──────────────────────────────────────────────────────────────────────────────
 *   gps_window    the truck's GPS and engine state, two hours either side of every candidate interval.
 *   assignments   every driver Samsara put on the truck in that same window.
 *   hos_logs      the one driver's duty-status log, a day either side — only when there is one driver.
 *   dvirs         the fleet's DVIRs from sixteen hours before to eight hours after (a pre-trip is the
 *                 start of the driver's day). `/dvirs/stream` ignores `vehicleIds` (measured: 143
 *                 reports either way on 2026-09-22), so the whole answer is frozen and the summary
 *                 lists this truck's reports, each marked before or after the inspection.
 */

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

export interface InspectionToAttribute {
  id: string;
  date: string | null;
  startHhmm: string | null;
  endHhmm: string | null;
  reportState: string | null;
  /** The report's power unit matched to our truck (0458), or null. */
  vehicleId: string | null;
  samsaraVehicleId: string | null;
}

export async function attributeInspection(
  admin: SupabaseClient,
  orgId: string,
  insp: InspectionToAttribute,
  fetchRaw: SamsaraRawFetcher,
  nowMs: number,
): Promise<AttributionOutcome> {
  // A report without a start time (none on 2026-10-14, of 1,391) is read across its whole local day:
  // the truck will not have stood still all day, so the reading comes out unresolved or low — a person's.
  const candidates =
    candidateIntervals(insp.date, insp.startHhmm, insp.endHhmm, insp.reportState).length > 0
      ? candidateIntervals(insp.date, insp.startHhmm, insp.endHhmm, insp.reportState)
      : candidateIntervals(insp.date, "0000", "2359", insp.reportState);
  if (candidates.length === 0) throw new Error(`inspection ${insp.id} has no date to read`);
  const nobody: DriverReading = { outcome: "no_assignment", driver: null, basis: null, candidates: [] };
  const notAsked = (outcome: AttributionOutcome) =>
    writeReading(admin, orgId, insp, { instant: resolveInstant(candidates, [], insp.reportState), driver: nobody, confidence: null }, outcome);
  if (!insp.vehicleId) return notAsked("no_matched_tractor");
  if (!insp.samsaraVehicleId) return notAsked("no_samsara_vehicle");

  const hull = hullOf(candidates);
  const window = { startMs: hull.startMs - ATTRIBUTION_WINDOW_MS, endMs: hull.endMs + ATTRIBUTION_WINDOW_MS };
  const base = { orgId, inspectionId: insp.id };

  const gpsParams = { vehicleIds: insp.samsaraVehicleId, types: "gps,engineStates", startTime: iso(window.startMs), endTime: iso(window.endMs) };
  const gps = await fetchRaw("/fleet/vehicles/stats/history", gpsParams);
  const fixes = fixesOf(dataOf(gps)[0]);
  await freezeAnswer(admin, {
    ...base, kind: "gps_window", temporalClass: "contemporaneous", path: "/fleet/vehicles/stats/history", params: gpsParams,
    window, answer: gps, retrievedAt: iso(Date.now()), itemCount: fixes.length,
    summary: { fixes: fixes.length },
  });

  const asgParams = { filterBy: "vehicles", vehicleIds: insp.samsaraVehicleId, startTime: iso(window.startMs), endTime: iso(window.endMs) };
  const asg = await fetchRaw("/fleet/driver-vehicle-assignments", asgParams);
  const assignments = assignmentsOf(dataOf(asg), Math.min(nowMs, window.endMs));
  await freezeAnswer(admin, {
    ...base, kind: "assignments", temporalClass: "contemporaneous", path: "/fleet/driver-vehicle-assignments", params: asgParams,
    window, answer: asg, retrievedAt: iso(Date.now()), itemCount: assignments.length,
    summary: { drivers: [...new Set(assignments.map((a) => a.driverId))] },
  });

  const reading = readAttribution(candidates, fixes, assignments, insp.reportState);
  const { instant, driver } = reading;

  if (driver.driver) {
    const day = { startMs: hull.startMs - 24 * HOUR, endMs: hull.endMs + 24 * HOUR };
    const hosParams = { driverIds: driver.driver.samsaraDriverId, startTime: iso(day.startMs), endTime: iso(day.endMs) };
    const hos = await fetchRaw("/fleet/hos/logs", hosParams);
    await freezeAnswer(admin, {
      ...base, kind: "hos_logs", temporalClass: "context", path: "/fleet/hos/logs", params: hosParams,
      window: day, answer: hos, retrievedAt: iso(Date.now()),
      itemCount: dataOf(hos).reduce((n, d) => n + (Array.isArray(d.hosLogs) ? d.hosLogs.length : 0), 0),
      summary: { driver: driver.driver.samsaraDriverId },
    });
  }

  const dvirWindow = { startMs: hull.startMs - 16 * HOUR, endMs: hull.endMs + 8 * HOUR };
  const dvirParams = { startTime: iso(dvirWindow.startMs), endTime: iso(dvirWindow.endMs) };
  const dvirs = await fetchRaw("/dvirs/stream", dvirParams);
  const ours = dataOf(dvirs).filter((d) => (d.vehicle as { id?: unknown } | undefined)?.id === insp.samsaraVehicleId);
  const at = instant.instant ?? hull;
  await freezeAnswer(admin, {
    ...base, kind: "dvirs", temporalClass: "context", path: "/dvirs/stream", params: dvirParams,
    window: dvirWindow, answer: dvirs, retrievedAt: iso(Date.now()), itemCount: dataOf(dvirs).length,
    summary: {
      vehicle: ours.map((d) => {
        const submitted = Date.parse(String(d.dvirSubmissionTime));
        return {
          id: d.id,
          type: d.type,
          submittedAt: d.dvirSubmissionTime,
          safetyStatus: d.safetyStatus,
          author: (d.authorSignature as { signatoryUser?: { id?: unknown } } | undefined)?.signatoryUser?.id ?? null,
          // Post-event is anything submitted after the inspection began (D-IC4).
          when: Number.isFinite(submitted) && submitted < at.startMs ? "before" : "after",
        };
      }),
    },
  });

  return writeReading(admin, orgId, insp, reading);
}

async function writeReading(
  admin: SupabaseClient,
  orgId: string,
  insp: InspectionToAttribute,
  { instant, driver, confidence }: Reading,
  outcome: AttributionOutcome = driver.outcome,
): Promise<AttributionOutcome> {
  const { error } = await admin.from("inspection_attributions").insert({
    org_id: orgId,
    inspection_id: insp.id,
    source: "engine",
    engine_version: ATTRIBUTION_ENGINE_VERSION,
    zone: instant.instant?.zone ?? null,
    zone_method: instant.zoneMethod,
    started_at: instant.instant ? iso(instant.instant.startMs) : null,
    ended_at: instant.instant ? iso(instant.instant.endMs) : null,
    location_check: instant.locationCheck,
    vehicle_id: insp.vehicleId,
    samsara_vehicle_id: insp.samsaraVehicleId,
    outcome,
    samsara_driver_id: driver.driver?.samsaraDriverId ?? null,
    samsara_driver_name: driver.driver?.name ?? null,
    basis: driver.basis,
    confidence,
    candidates: driver.candidates,
  });
  // Another process got there first at this engine version (the unique index): its reading stands.
  if (error && (error as { code?: string }).code !== "23505") throw new Error(`attribution row failed: ${error.message}`);
  return outcome;
}
