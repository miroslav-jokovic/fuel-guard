import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ATTRIBUTION_ENGINE_VERSION } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import type { SamsaraRawAnswer, SamsaraRawFetcher } from "../../samsara/index.js";
import { attributeInspection, type InspectionToAttribute } from "./attribute.js";
import { answerBytes } from "./freeze.js";

/**
 * One inspection attributed end to end against a scripted Samsara (the Erwinville stop, 698 on
 * 2026-09-22 — `reading.test.ts` has the measurement). What this file holds that the reading's cannot:
 * every answer is frozen BEFORE the row that reads it, the frozen bytes are exactly Samsara's, and the
 * row's columns are the reading of those bytes.
 */

const ORG = "org-1";
const INSP: InspectionToAttribute = {
  id: "insp-1", date: "2026-09-22", startHhmm: "1304", endHhmm: "1327", reportState: "LA",
  vehicleId: "veh-698", samsaraVehicleId: "212014918176522",
};
const NOW = Date.parse("2026-10-14T15:00:00Z");

const page = (data: unknown[]) => JSON.stringify({ data, pagination: { endCursor: "", hasNextPage: false } });
const gpsPoint = (time: string, mph: number) => ({ time, speedMilesPerHour: mph, reverseGeo: { formattedLocation: "US 190;LA 1, LA, 70767" } });
const GPS = page([{ id: "212014918176522", gps: [gpsPoint("2026-09-22T18:03:11Z", 34.8), gpsPoint("2026-09-22T18:04:04Z", 0), gpsPoint("2026-09-22T18:24:08Z", 0), gpsPoint("2026-09-22T18:43:16Z", 18)] }]);
const asg = (start: string, end: string) => ({ startTime: start, endTime: end, isPassenger: false, assignmentType: "HOS", driver: { id: "53867066", name: "GREGORY GRIGGS" } });
const ASSIGNMENTS = page([asg("2026-09-22T14:30:21Z", "2026-09-22T18:04:10Z"), asg("2026-09-22T18:42:49Z", "2026-09-22T18:58:51Z")]);
const HOS = page([{ driver: { id: "53867066" }, hosLogs: [{ hosStatusType: "driving" }, { hosStatusType: "onDuty" }] }]);
const DVIRS = page([
  { id: "d1", type: "preTrip", dvirSubmissionTime: "2026-09-22T13:00:00Z", safetyStatus: "safe", vehicle: { id: "212014918176522" }, authorSignature: { signatoryUser: { id: "u9" } } },
  { id: "d2", type: "postTrip", dvirSubmissionTime: "2026-09-22T23:00:00Z", safetyStatus: "safe", vehicle: { id: "212014918176522" } },
  { id: "d3", type: "preTrip", dvirSubmissionTime: "2026-09-22T12:00:00Z", vehicle: { id: "other-truck" } },
]);

function samsara(over: Partial<Record<string, SamsaraRawAnswer>> = {}) {
  const asked: { path: string; params: Record<string, string> }[] = [];
  const answers: Record<string, SamsaraRawAnswer> = {
    "/fleet/vehicles/stats/history": { status: 200, pages: [GPS], complete: true },
    "/fleet/driver-vehicle-assignments": { status: 200, pages: [ASSIGNMENTS], complete: true },
    "/fleet/hos/logs": { status: 200, pages: [HOS], complete: true },
    "/dvirs/stream": { status: 200, pages: [DVIRS], complete: true },
    ...over,
  };
  const fetch: SamsaraRawFetcher = async (path, params) => {
    asked.push({ path, params });
    return answers[path]!;
  };
  return { fetch, asked };
}

const recorder = () =>
  createSupabaseRecorder({ tables: { inspection_evidence_snapshots: { data: [{ id: "snap" }], error: null }, inspection_attributions: { data: [], error: null } } });
const inserts = (rec: SupabaseRecorder, table: string) => rec.forTable(table).filter((q) => q.write?.method === "insert").map((q) => q.write!.payload as Record<string, unknown>);

describe("attributing one inspection (IC5)", () => {
  it("names the Erwinville driver with high confidence, from a GPS-confirmed instant he bracketed", async () => {
    const rec = recorder();
    expect(await attributeInspection(rec.client as never, ORG, INSP, samsara().fetch, NOW)).toBe("one_driver");
    expect(inserts(rec, "inspection_attributions")).toEqual([
      expect.objectContaining({
        org_id: ORG, inspection_id: "insp-1", source: "engine", engine_version: ATTRIBUTION_ENGINE_VERSION,
        zone: "America/Chicago", zone_method: "gps", location_check: "confirmed",
        started_at: "2026-09-22T18:04:00.000Z", ended_at: "2026-09-22T18:27:00.000Z",
        vehicle_id: "veh-698", samsara_vehicle_id: "212014918176522",
        outcome: "one_driver", samsara_driver_id: "53867066", samsara_driver_name: "GREGORY GRIGGS",
        basis: "bracketing", confidence: "high",
      }),
    ]);
  });

  it("freezes all four answers BEFORE writing the reading, and asks each for two hours either side", async () => {
    const rec = recorder();
    const s = samsara();
    await attributeInspection(rec.client as never, ORG, INSP, s.fetch, NOW);
    expect(inserts(rec, "inspection_evidence_snapshots").map((r) => [r.kind, r.temporal_class])).toEqual([
      ["gps_window", "contemporaneous"], ["assignments", "contemporaneous"], ["hos_logs", "context"], ["dvirs", "context"],
    ]);
    const order = rec.queries.filter((q) => q.write?.method === "insert").map((q) => q.table);
    expect(order.at(-1)).toBe("inspection_attributions");
    expect(s.asked[0]).toEqual({ path: "/fleet/vehicles/stats/history", params: { vehicleIds: "212014918176522", types: "gps,engineStates", startTime: "2026-09-22T16:04:00.000Z", endTime: "2026-09-22T20:27:00.000Z" } });
    expect(s.asked[2]!.params.driverIds).toBe("53867066");
    expectOrgScoped(rec, ORG);
  });

  it("stores Samsara's bytes gzipped under the org's prefix, named and hashed by what was received", async () => {
    const rec = recorder();
    await attributeInspection(rec.client as never, ORG, INSP, samsara().fetch, NOW);
    const ups = rec.storageCalls().filter((c) => c.fn === "upload");
    expect(ups.every((u) => u.bucket === "inspection-evidence")).toBe(true);
    const [path, body] = ups[0]!.args as [string, Buffer];
    const sha = createHash("sha256").update(GPS).digest("hex");
    expect(path).toBe(`${ORG}/insp-1/gps_window-${sha}.json.gz`);
    expect(gunzipSync(body).toString("utf8")).toBe(GPS);
    expect(inserts(rec, "inspection_evidence_snapshots")[0]).toMatchObject({ sha256: sha, byte_size: Buffer.byteLength(GPS), storage_path: path, http_status: 200, item_count: 4 });
  });

  it("lists this truck's DVIRs in the summary, each before or after the inspection", async () => {
    const rec = recorder();
    await attributeInspection(rec.client as never, ORG, INSP, samsara().fetch, NOW);
    const dvirs = inserts(rec, "inspection_evidence_snapshots").find((r) => r.kind === "dvirs")!;
    expect(dvirs.item_count).toBe(3);
    expect((dvirs.summary as { vehicle: unknown[] }).vehicle).toEqual([
      { id: "d1", type: "preTrip", submittedAt: "2026-09-22T13:00:00Z", safetyStatus: "safe", author: "u9", when: "before" },
      { id: "d2", type: "postTrip", submittedAt: "2026-09-22T23:00:00Z", safetyStatus: "safe", author: null, when: "after" },
    ]);
  });

  it("freezes a refusal as an answer and reads it as nobody, with no HOS log to ask for", async () => {
    const rec = recorder();
    const s = samsara({ "/fleet/driver-vehicle-assignments": { status: 403, pages: ['{"message":"forbidden"}'], complete: false } });
    expect(await attributeInspection(rec.client as never, ORG, INSP, s.fetch, NOW)).toBe("no_assignment");
    expect(inserts(rec, "inspection_evidence_snapshots").map((r) => [r.kind, r.http_status])).toEqual([["gps_window", 200], ["assignments", 403], ["dvirs", 200]]);
    expect(inserts(rec, "inspection_attributions")[0]).toMatchObject({ outcome: "no_assignment", samsara_driver_id: null, basis: null, confidence: null });
  });

  it("asks Samsara nothing for a unit that is not our truck, or our truck Samsara does not know", async () => {
    for (const [insp, outcome] of [
      [{ ...INSP, vehicleId: null, samsaraVehicleId: null }, "no_matched_tractor"],
      [{ ...INSP, samsaraVehicleId: null }, "no_samsara_vehicle"],
    ] as const) {
      const rec = recorder();
      const s = samsara();
      expect(await attributeInspection(rec.client as never, ORG, insp, s.fetch, NOW)).toBe(outcome);
      expect(s.asked).toEqual([]);
      expect(inserts(rec, "inspection_evidence_snapshots")).toEqual([]);
      expect(inserts(rec, "inspection_attributions")[0]).toMatchObject({ outcome, zone_method: "state_only", location_check: "no_gps", zone: "America/Chicago" });
    }
  });

  it("reads a report with no start time across its local day, so it never comes out high", async () => {
    const rec = recorder();
    await attributeInspection(rec.client as never, ORG, { ...INSP, startHhmm: null, endHhmm: null }, samsara().fetch, NOW);
    expect(inserts(rec, "inspection_attributions")[0]).toMatchObject({ location_check: "moving", confidence: "low" });
  });

  it("keeps the first reading when another process wrote this version first, and fails on any other error", async () => {
    const dup = createSupabaseRecorder({ tables: { inspection_evidence_snapshots: { data: [{ id: "s" }], error: null }, inspection_attributions: { data: [], error: null, writeError: { message: "dup", code: "23505" } as never } } });
    await expect(attributeInspection(dup.client as never, ORG, INSP, samsara().fetch, NOW)).resolves.toBe("one_driver");
    const broken = createSupabaseRecorder({ tables: { inspection_evidence_snapshots: { data: [{ id: "s" }], error: null }, inspection_attributions: { data: [], error: null, writeError: { message: "boom" } } } });
    await expect(attributeInspection(broken.client as never, ORG, INSP, samsara().fetch, NOW)).rejects.toThrow(/attribution row failed/);
  });

  it("re-freezes an answer whose object already exists (same bytes, same name), and stops on any other storage error", async () => {
    const exists = createSupabaseRecorder({
      tables: { inspection_evidence_snapshots: { data: [{ id: "s" }], error: null } },
      storage: { upload: () => ({ data: null, error: { message: "The resource already exists" } }) },
    });
    await expect(attributeInspection(exists.client as never, ORG, INSP, samsara().fetch, NOW)).resolves.toBe("one_driver");
    expect(inserts(exists, "inspection_evidence_snapshots")).toHaveLength(4);
    const down = createSupabaseRecorder({
      tables: { inspection_evidence_snapshots: { data: [{ id: "s" }], error: null } },
      storage: { upload: () => ({ data: null, error: { message: "Internal Server Error" } }) },
    });
    await expect(attributeInspection(down.client as never, ORG, INSP, samsara().fetch, NOW)).rejects.toThrow(/evidence upload failed/);
    expect(inserts(down, "inspection_attributions")).toEqual([]);
  });

  it("stores several pages as one JSON array of the pages as sent", () => {
    expect(answerBytes({ status: 200, pages: ['{"a":1}', '{"b":2}'], complete: true })).toBe('[{"a":1},{"b":2}]');
  });
});
