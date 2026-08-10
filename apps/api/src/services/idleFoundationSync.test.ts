import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";

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

    const result = await syncIdleFoundation({} as SupabaseClient, {} as Env, "org-1", {
      sinceDays: 14,
    });

    expect(idleEvents.syncIdleEvents).toHaveBeenCalledWith({}, {}, "org-1", { sinceDays: 14 });
    expect(idleCapabilities.syncIdleCapabilities).toHaveBeenCalledWith({}, {}, "org-1", {
      sinceDays: 14,
    });
    expect(idleTelemetry.syncIdleTelemetry).toHaveBeenCalledWith({}, {}, "org-1", {
      sinceDays: 14,
    });
    expect(idleDutyEvidence.syncIdleDutyEvidence).toHaveBeenCalledWith({}, "org-1", {
      sinceDays: 14,
    });
    expect(idleEquipmentEvidence.syncIdleEquipmentEvidence).toHaveBeenCalledWith({}, "org-1", {
      sinceDays: 14,
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
  });
});
