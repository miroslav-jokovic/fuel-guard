import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const idleEvents = vi.hoisted(() => ({ syncIdleEvents: vi.fn() }));
const idleCapabilities = vi.hoisted(() => ({ syncIdleCapabilities: vi.fn() }));
const idleTelemetry = vi.hoisted(() => ({ syncIdleTelemetry: vi.fn() }));
const idleDutyEvidence = vi.hoisted(() => ({ syncIdleDutyEvidence: vi.fn() }));
const idleEquipmentEvidence = vi.hoisted(() => ({ syncIdleEquipmentEvidence: vi.fn() }));
const idleLearnedEnvelopes = vi.hoisted(() => ({ syncIdleLearnedEnvelopes: vi.fn() }));
vi.mock("./idleSync.js", () => idleEvents);
vi.mock("./idleCapabilitySync.js", () => idleCapabilities);
vi.mock("./idleTelemetrySync.js", () => idleTelemetry);
vi.mock("./idleDutyEvidenceSync.js", () => idleDutyEvidence);
vi.mock("./idleEquipmentEvidenceSync.js", () => idleEquipmentEvidence);
vi.mock("./idleLearnedEnvelopeSync.js", () => idleLearnedEnvelopes);

import { syncIdleFoundation } from "./idleFoundationSync.js";
import { testEnv } from "../../testing/testEnv.js";

describe("syncIdleFoundation", () => {
  it("runs events before capability learning and forwards the same window", async () => {
    idleEvents.syncIdleEvents.mockResolvedValue({ fetched: 12, upserted: 12 });
    idleCapabilities.syncIdleCapabilities.mockResolvedValue({
      vehicles: 3,
      learned: 2,
      engineDays: 9,
      parkSessions: 4,
      vehiclesWithData: 3,
      vehiclesWithoutData: 0,
      staleEngineDaysDeleted: 1,
      staleParkSessionsDeleted: 2,
      batches: 1,
    });
    idleTelemetry.syncIdleTelemetry.mockResolvedValue({
      vehicles: 3,
      vehiclesWithTelemetry: 2,
      windowsWritten: 3,
      samples: { battery: 2, rpm: 2, engineLoad: 2, ecuSpeed: 2 },
    });
    idleDutyEvidence.syncIdleDutyEvidence.mockResolvedValue({
      sessions: 4,
      sufficient: 3,
      insufficient: 1,
      ambiguous: 0,
      rowsWritten: 4,
    });
    idleEquipmentEvidence.syncIdleEquipmentEvidence.mockResolvedValue({
      sessions: 4,
      inside: 2,
      outside: 1,
      mixed: 0,
      insufficient: 1,
      ambiguous: 0,
      notApplicable: 0,
      unknown: 0,
      rowsWritten: 4,
    });
    idleLearnedEnvelopes.syncIdleLearnedEnvelopes.mockResolvedValue({
      vehicles: 3,
      sufficient: 1,
      insufficient: 1,
      notApplicable: 1,
      rowsWritten: 3,
    });

    const env = testEnv();
    const result = await syncIdleFoundation({} as SupabaseClient, env, "org-1", {
      sinceDays: 14,
    });

    expect(idleEvents.syncIdleEvents).toHaveBeenCalledWith({}, env, "org-1", { sinceDays: 14 });
    expect(idleCapabilities.syncIdleCapabilities).toHaveBeenCalledWith({}, env, "org-1", {
      sinceDays: 14,
    });
    expect(idleTelemetry.syncIdleTelemetry).toHaveBeenCalledWith({}, env, "org-1", {
      sinceDays: 14,
    });
    expect(idleDutyEvidence.syncIdleDutyEvidence).toHaveBeenCalledWith({}, "org-1", {
      sinceDays: 14,
    });
    // The equipment stage also gets a weather fetcher: park sessions now resolve their OWN ambient
    // temperature from their GPS fix rather than borrowing one from an overlapping Samsara idle event.
    expect(idleEquipmentEvidence.syncIdleEquipmentEvidence).toHaveBeenCalledWith({}, "org-1", {
      sinceDays: 14,
      weatherFetcher: expect.any(Function),
    });
    expect(idleLearnedEnvelopes.syncIdleLearnedEnvelopes).toHaveBeenCalledWith({}, "org-1", {
      sinceDays: 400,
    });
    const eventCall = idleEvents.syncIdleEvents.mock.invocationCallOrder[0];
    const capabilityCall = idleCapabilities.syncIdleCapabilities.mock.invocationCallOrder[0];
    const telemetryCall = idleTelemetry.syncIdleTelemetry.mock.invocationCallOrder[0];
    const dutyEvidenceCall = idleDutyEvidence.syncIdleDutyEvidence.mock.invocationCallOrder[0];
    const equipmentEvidenceCall =
      idleEquipmentEvidence.syncIdleEquipmentEvidence.mock.invocationCallOrder[0];
    const learnedEnvelopeCall =
      idleLearnedEnvelopes.syncIdleLearnedEnvelopes.mock.invocationCallOrder[0];
    expect(eventCall).toBeDefined();
    expect(capabilityCall).toBeDefined();
    expect(telemetryCall).toBeDefined();
    expect(dutyEvidenceCall).toBeDefined();
    expect(equipmentEvidenceCall).toBeDefined();
    expect(learnedEnvelopeCall).toBeDefined();
    if (
      eventCall !== undefined &&
      capabilityCall !== undefined &&
      telemetryCall !== undefined &&
      dutyEvidenceCall !== undefined &&
      equipmentEvidenceCall !== undefined &&
      learnedEnvelopeCall !== undefined
    ) {
      expect(eventCall).toBeLessThan(capabilityCall);
      expect(capabilityCall).toBeLessThan(telemetryCall);
      expect(telemetryCall).toBeLessThan(dutyEvidenceCall);
      expect(dutyEvidenceCall).toBeLessThan(equipmentEvidenceCall);
      expect(equipmentEvidenceCall).toBeLessThan(learnedEnvelopeCall);
    }
    expect(result.idleEvents.fetched).toBe(12);
    expect(result.idleCapabilities.vehiclesWithoutData).toBe(0);
    expect(result.idleTelemetry.vehiclesWithTelemetry).toBe(2);
    expect(result.idleDutyEvidence.sufficient).toBe(3);
    expect(result.idleEquipmentEvidence.inside).toBe(2);
    expect(result.idleLearnedEnvelopes.sufficient).toBe(1);
    // Every stage is timed, in run order — this is what makes a 26-minute failure diagnosable.
    expect(Object.keys(result.stageMs)).toEqual([
      "idleEvents",
      "idleCapabilities",
      "idleTelemetry",
      "idleDutyEvidence",
      "idleEquipmentEvidence",
      "idleLearnedEnvelopes",
    ]);
    for (const ms of Object.values(result.stageMs)) expect(ms).toBeGreaterThanOrEqual(0);
  });

  it("names the failing stage and how far into the run it died", async () => {
    idleEvents.syncIdleEvents.mockResolvedValue({ fetched: 1, upserted: 1 });
    idleCapabilities.syncIdleCapabilities.mockResolvedValue({ vehicles: 1, learned: 1 });
    idleTelemetry.syncIdleTelemetry.mockResolvedValue({ vehicles: 1 });
    idleDutyEvidence.syncIdleDutyEvidence.mockResolvedValue({ sessions: 1 });
    idleEquipmentEvidence.syncIdleEquipmentEvidence.mockResolvedValue({ sessions: 1 });
    // The exact production failure: the last stage of six, 26 minutes in, reported as one line of SQL
    // text with no indication of which stage produced it.
    const cause = new Error(
      'Idle learned envelope learned-envelope upsert failed: null value in column "unit_number" of relation "vehicles" violates not-null constraint',
    );
    idleLearnedEnvelopes.syncIdleLearnedEnvelopes.mockRejectedValue(cause);

    await expect(syncIdleFoundation({} as SupabaseClient, testEnv(), "org-1", {})).rejects.toThrow(
      /idle foundation stage "idleLearnedEnvelopes" failed after \d+s/,
    );
    await expect(syncIdleFoundation({} as SupabaseClient, testEnv(), "org-1", {})).rejects.toThrow(
      /unit_number/,
    );
  });
});

describe("syncIdleFoundation — chunked backfill (sinceDays beyond one window)", () => {
  const capResult = (learned: number) => ({
    vehicles: 3,
    learned,
    engineDays: 10,
    parkSessions: 5,
    vehiclesWithData: 3,
    vehiclesWithoutData: 0,
    staleEngineDaysDeleted: 1,
    staleParkSessionsDeleted: 0,
    batches: 1,
  });

  it("slices 120 days into 30-day windows oldest-first, guards vehicle learning, sums row counts", async () => {
    vi.clearAllMocks();
    idleEvents.syncIdleEvents.mockResolvedValue({ fetched: 5, upserted: 5 });
    idleCapabilities.syncIdleCapabilities.mockResolvedValue(capResult(2));
    idleTelemetry.syncIdleTelemetry.mockResolvedValue({
      vehicles: 3,
      vehiclesWithTelemetry: 2,
      windowsWritten: 3,
      samples: { battery: 2, rpm: 2, engineLoad: 2, ecuSpeed: 2 },
    });
    idleDutyEvidence.syncIdleDutyEvidence.mockResolvedValue({
      sessions: 4,
      sufficient: 3,
      insufficient: 1,
      ambiguous: 0,
      rowsWritten: 4,
    });
    idleEquipmentEvidence.syncIdleEquipmentEvidence.mockResolvedValue({
      sessions: 4,
      inside: 2,
      outside: 1,
      mixed: 0,
      insufficient: 1,
      ambiguous: 0,
      notApplicable: 0,
      unknown: 0,
      rowsWritten: 4,
    });
    idleLearnedEnvelopes.syncIdleLearnedEnvelopes.mockResolvedValue({
      vehicles: 3,
      sufficient: 1,
      insufficient: 1,
      notApplicable: 1,
      rowsWritten: 3,
    });

    const result = await syncIdleFoundation({} as SupabaseClient, testEnv(), "org-1", {
      sinceDays: 120,
    });

    // 120d → four 30-day slices for the windowed stages.
    expect(idleEvents.syncIdleEvents).toHaveBeenCalledTimes(4);
    expect(idleCapabilities.syncIdleCapabilities).toHaveBeenCalledTimes(4);
    expect(idleDutyEvidence.syncIdleDutyEvidence).toHaveBeenCalledTimes(4);
    expect(idleEquipmentEvidence.syncIdleEquipmentEvidence).toHaveBeenCalledTimes(4);
    // Telemetry describes CURRENT windows and envelope reads its own 400d — each runs exactly once.
    expect(idleTelemetry.syncIdleTelemetry).toHaveBeenCalledTimes(1);
    expect(idleLearnedEnvelopes.syncIdleLearnedEnvelopes).toHaveBeenCalledTimes(1);

    // Slices run OLDEST → NEWEST with explicit window ends 30 days apart.
    const ends = idleEvents.syncIdleEvents.mock.calls.map((c: unknown[]) =>
      Date.parse((c[3] as { endIso: string }).endIso),
    );
    for (let i = 1; i < ends.length; i++) expect(ends[i]! - ends[i - 1]!).toBe(30 * 86_400_000);

    // Vehicle-level capability learning is skipped on every HISTORICAL slice — only the final
    // (newest) slice may write the truck's current capability columns.
    const learningFlags = idleCapabilities.syncIdleCapabilities.mock.calls.map(
      (c: unknown[]) => (c[3] as { skipVehicleLearning?: boolean }).skipVehicleLearning,
    );
    expect(learningFlags).toEqual([true, true, true, false]);

    // Row counts sum across slices; fetched/upserted likewise.
    expect(result.idleEvents).toEqual({ fetched: 20, upserted: 20 });
    expect(result.idleCapabilities.engineDays).toBe(40);
    expect(result.idleCapabilities.parkSessions).toBe(20);
    expect(result.idleDutyEvidence.sessions).toBe(16);
    expect(result.idleEquipmentEvidence.rowsWritten).toBe(16);
  });

  it("gives the oldest slice the partial remainder so the newest slice is a full standard window", async () => {
    vi.clearAllMocks();
    idleEvents.syncIdleEvents.mockResolvedValue({ fetched: 1, upserted: 1 });
    idleCapabilities.syncIdleCapabilities.mockResolvedValue(capResult(1));
    idleTelemetry.syncIdleTelemetry.mockResolvedValue({
      vehicles: 1,
      vehiclesWithTelemetry: 1,
      windowsWritten: 1,
      samples: { battery: 1, rpm: 1, engineLoad: 1, ecuSpeed: 1 },
    });
    idleDutyEvidence.syncIdleDutyEvidence.mockResolvedValue({
      sessions: 1,
      sufficient: 1,
      insufficient: 0,
      ambiguous: 0,
      rowsWritten: 1,
    });
    idleEquipmentEvidence.syncIdleEquipmentEvidence.mockResolvedValue({
      sessions: 1,
      inside: 1,
      outside: 0,
      mixed: 0,
      insufficient: 0,
      ambiguous: 0,
      notApplicable: 0,
      unknown: 0,
      rowsWritten: 1,
    });
    idleLearnedEnvelopes.syncIdleLearnedEnvelopes.mockResolvedValue({
      vehicles: 1,
      sufficient: 0,
      insufficient: 1,
      notApplicable: 0,
      rowsWritten: 1,
    });

    await syncIdleFoundation({} as SupabaseClient, testEnv(), "org-1", { sinceDays: 75 });

    const sliceDays = idleEvents.syncIdleEvents.mock.calls.map(
      (c: unknown[]) => (c[3] as { sinceDays: number }).sinceDays,
    );
    expect(sliceDays).toEqual([15, 30, 30]); // remainder lands on the OLDEST slice
  });
});
