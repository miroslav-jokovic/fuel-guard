import { describe, expect, it } from "vitest";
import { alertIncidentRow, defectRow, hosViolationRow, isRetiredUnitName, LAMP_DETAIL_BYTES, safetyEventRow, truckLamps } from "./warningRows.js";
import { foldLampObservations, MERGE_GAP_MS, type Episode } from "./lampEpisodes.js";

const b = { orgId: "org-1", seenAt: "2026-11-26T12:00:00.000Z" };

// Shapes copied from the live API, 2026-11-26 (WARNING-DESK-PLAN §1).
const fuelIncident = {
  configurationId: "250c4103",
  updatedAtTime: "2026-11-26T06:12:50Z",
  resolvedAtTime: "",
  happenedAtTime: "2026-11-26T05:41:35Z",
  isResolved: false,
  incidentUrl: "https://cloud.samsara.com/o/6308/fleet/workflows/incidents/250c4103/1/281475008250400/1795671695433",
  conditions: [
    {
      triggerId: 1005,
      description: "Fuel Level (Percentage)",
      details: { fuelLevelPercentage: { vehicle: { id: "281475008250400", name: "675" }, driver: { id: "53965959", name: "ANGEL PEREZ SANTANA" } } },
    },
  ],
};

describe("alertIncidentRow", () => {
  it("keys on the incident URL and puts low fuel on the driver", () => {
    const row = alertIncidentRow(fuelIncident, { id: "250c4103", name: "Critically Low Fuel Level", isEnabled: true, triggerTypeIds: [1005] }, b);
    expect(row).toMatchObject({
      source: "alert",
      source_key: fuelIncident.incidentUrl,
      kind: "alert:250c4103",
      subject_kind: "driver",
      vehicle_samsara_id: "281475008250400",
      driver_samsara_id: "53965959",
      unit_name: "675",
      still_active: true,
      ended_at: null,
    });
  });

  it("a battery alert with engine-off is the truck's, and a resolved one carries its end", () => {
    const resolved = {
      ...fuelIncident,
      isResolved: true,
      resolvedAtTime: "2026-11-26T07:00:00Z",
      conditions: [
        { triggerId: 1007, details: { vehicleBatteryVoltage: { vehicle: { id: "V1", name: "746" }, driver: { id: "D1", name: "X" } } } },
        { triggerId: 1022, details: { engineOff: { vehicle: { id: "V1", name: "746" } } } },
      ],
    };
    const row = alertIncidentRow(resolved, { id: "bb02", name: "Critical Low Battery", isEnabled: true, triggerTypeIds: [1007, 1022] }, b);
    expect(row).toMatchObject({ subject_kind: "truck", vehicle_samsara_id: "V1", still_active: false, ended_at: "2026-11-26T07:00:00.000Z" });
    expect(row?.detail).toEqual({ triggerIds: [1007, 1022] });
  });

  it("refuses an incident with no URL", () => {
    expect(alertIncidentRow({ ...fuelIncident, incidentUrl: "" }, { id: "c", name: "x", isEnabled: true, triggerTypeIds: [] }, b)).toBeNull();
  });
});

describe("safetyEventRow", () => {
  const ev = {
    id: "5445d56e",
    createdAtTime: "2026-11-13T15:03:33.247Z",
    updatedAtTime: "2026-11-19T08:17:45.892Z",
    startMs: "2026-11-13T15:02:53.037Z",
    asset: { id: "281474987564543", name: "812" },
    driver: { id: "31557021", name: "Dante Cortes" },
    behaviorLabels: [{ label: "HarshTurn", source: "SYSTEM" }],
    eventState: "coached",
    inboxEventUrl: "https://cloud.samsara.com/o/6308/fleet/safety/event_review?aggregationUuid=5445d56e",
    media: [{ input: "MEDIA_INPUT_PRIMARY", url: "https://us4-safetymediadelivery.samsara.com/x" }],
  };

  it("is the driver's, keyed on the event id, never storing the video link", () => {
    const row = safetyEventRow(ev, b);
    expect(row).toMatchObject({ kind: "safety_other", subject_kind: "driver", driver_samsara_id: "31557021", label: "HarshTurn", happened_at: "2026-11-13T15:02:53.037Z" });
    expect(row?.detail).toEqual({ eventState: "coached", hasVideo: true });
    expect(JSON.stringify(row)).not.toContain("safetymediadelivery");
  });

  it("a serious behaviour makes it safety_serious; a dismissed event counts toward nothing", () => {
    expect(safetyEventRow({ ...ev, behaviorLabels: [{ label: "Braking" }, { label: "RanRedLight" }] }, b)?.kind).toBe("safety_serious");
    expect(safetyEventRow({ ...ev, eventState: "dismissed" }, b)?.kind).toBe("safety_dismissed");
  });
});

describe("defectRow and hosViolationRow", () => {
  it("an open defect is active and the truck's; a trailer defect is the trailer's", () => {
    const d = { id: "40520107", createdAtTime: "2026-11-25T06:49:55Z", comment: "Breaks needs to be adjusted ", isResolved: false, vehicle: { id: "281474989550945" }, dvirId: "1314097636" };
    expect(defectRow(d, b)).toMatchObject({ source_key: "40520107", kind: "dvir_open", subject_kind: "truck", still_active: true, label: "Breaks needs to be adjusted" });
    expect(defectRow({ ...d, trailer: { id: "T9" } }, b)).toMatchObject({ subject_kind: "trailer", trailer_samsara_id: "T9" });
    expect(defectRow({ ...d, vehicle: undefined }, b)).toBeNull();
  });

  it("splits HOS into driving-limit and unsubmitted logs", () => {
    const v = {
      driver: { id: "66031", name: "Dante Cortes" },
      day: { startTime: "2026-10-29T05:00:00.000Z" },
      type: "shiftDrivingHours",
      description: "Shift Driving Limit (USA-11 hours)",
      violationStartTime: "2026-10-29T08:42:37.392Z",
    };
    expect(hosViolationRow(v, b)).toMatchObject({ kind: "hos_driving", source_key: "66031:shiftDrivingHours:2026-10-29T08:42:37.392Z" });
    const u = hosViolationRow({ ...v, type: "unsubmittedLogs", violationStartTime: undefined }, b);
    expect(u).toMatchObject({ kind: "hos_unsubmitted", happened_at: "2026-10-29T05:00:00.000Z" });
  });
});

describe("truckLamps", () => {
  it("reads the stop and amber lamps and skips sold or swapped trucks", () => {
    // The live shape, 2026-11-27 (truck 669's first code).
    const live = { fmiDescription: "Voltage Above Normal", fmiId: 3, occurrenceCount: 3, spnId: 1636, spnDescription: "Engine Intake Manifold 1 Temperature (High Resolution)", milStatus: 1, txId: 1, sourceAddressName: "Engine #2" };
    const v = { id: "V1", name: "556", faultCodes: { j1939: { checkEngineLights: { emissionsIsOn: true, protectIsOn: false, stopIsOn: true, warningIsOn: true }, diagnosticTroubleCodes: [live] } } };
    expect(truckLamps(v)).toMatchObject({
      stop: true,
      amber: true,
      codes: [{ module: 1, moduleName: "Engine #2", spn: 1636, fmi: 3, description: "Engine Intake Manifold 1 Temperature (High Resolution)", fmiDescription: "Voltage Above Normal", makerSpecific: false, occurrences: 3 }],
    });
    expect(truckLamps({ ...v, name: "556 - SOLD" })).toBeNull();
    expect(isRetiredUnitName("783 - OLD")).toBe(true);
    expect(isRetiredUnitName("783")).toBe(false);
  });

  it("keeps the SPN of a maker-specific code and drops Samsara's placeholder words for it", () => {
    const v = { id: "V1", name: "669", faultCodes: { j1939: { diagnosticTroubleCodes: [{ fmiId: 31, occurrenceCount: 1, spnId: 521049, spnDescription: "Manufacturer Assignable SPN", txId: 1, sourceAddressName: "Engine #2" }, { spnDescription: "no SPN, nothing to look up" }] } } };
    expect(truckLamps(v)?.codes).toEqual([{ module: 1, moduleName: "Engine #2", spn: 521049, fmi: 31, description: null, fmiDescription: null, makerSpecific: true, occurrences: 1 }]);
  });

  it("stays inside 0653's 2 KB detail CHECK on a truck with many long codes, the truck's own codes kept first", () => {
    const long = "Reserved for future assignment by SAE but available for use by self configurable ECUs";
    const camera = { spnId: 1, fmiId: 1, txId: 232, sourceAddressName: "Forward Road Image Processor", spnDescription: long, fmiDescription: long, occurrenceCount: 1 };
    const engine = (spn: number) => ({ spnId: spn, fmiId: 2, txId: 0, sourceAddressName: long, spnDescription: long, fmiDescription: long, occurrenceCount: 9 });
    const v = { id: "V1", name: "744", faultCodes: { j1939: { diagnosticTroubleCodes: [camera, ...Array.from({ length: 14 }, (_, i) => engine(100 + i))] } } };
    const codes = truckLamps(v)!.codes;
    expect(Buffer.byteLength(JSON.stringify({ codes }))).toBeLessThanOrEqual(LAMP_DETAIL_BYTES);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.every((c) => c.module === 0)).toBe(true);
    expect(codes[0]!.description).toHaveLength(80);
  });
});

describe("foldLampObservations — readings become episodes", () => {
  const at = (min: number) => new Date(Date.parse("2026-11-26T08:00:00Z") + min * 60_000).toISOString();
  const obs = (min: number, on: boolean) => ({ entityId: "T1", lamp: "atis", at: at(min), on });

  it("turns on/off readings into one episode", () => {
    const out = foldLampObservations([], [obs(0, false), obs(5, true), obs(6, true), obs(50, false)]);
    expect(out).toEqual([{ key: `T1:atis:${at(5)}`, entityId: "T1", lamp: "atis", startedAt: at(5), endedAt: at(50), active: false }]);
  });

  it("merges a lamp that comes back on within 30 minutes into the same episode", () => {
    const out = foldLampObservations([], [obs(0, true), obs(20, false), obs(20 + MERGE_GAP_MS / 60_000 - 1, true)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ startedAt: at(0), active: true, endedAt: null });
  });

  it("starts a new episode after a longer gap", () => {
    const out = foldLampObservations([], [obs(0, true), obs(20, false), obs(90, true)]);
    expect(out.map((e) => e.startedAt)).toEqual([at(0), at(90)]);
  });

  it("continues the episode stored from the previous tick", () => {
    const stored: Episode = { key: `T1:atis:${at(0)}`, entityId: "T1", lamp: "atis", startedAt: at(0), endedAt: null, active: true };
    const out = foldLampObservations([stored], [obs(30, true), obs(40, false)]);
    expect(out).toEqual([{ ...stored, endedAt: at(40), active: false }]);
  });

  it("writes nothing when nothing changed", () => {
    const stored: Episode = { key: "k", entityId: "T1", lamp: "atis", startedAt: at(0), endedAt: null, active: true };
    expect(foldLampObservations([stored], [obs(30, true)])).toEqual([]);
    expect(foldLampObservations([], [obs(30, false)])).toEqual([]);
  });
});
