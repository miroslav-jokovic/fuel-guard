import { describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";

/**
 * The check pass (IC10): the moment a report confirms a driver with nobody in between (Q-IC11 (a)).
 * Pinned: it writes the `report` attribution only when everything agrees, never over a person's decision,
 * and records a failed read as `unreadable` rather than leaving it to be retried for ever.
 */

const readOfBytes = vi.fn();
vi.mock("../../document-reading/index.js", () => ({ readOfBytes: (...a: unknown[]) => readOfBytes(...a) }));
const { checkReportBacklog } = await import("./check.js");

const ORG = "11111111-1111-1111-1111-111111111111";
const INSP = "55555555-5555-5555-5555-555555555555";
const ENGINE = {
  id: "eng-1", source: "engine", engine_version: "ic5.1", created_at: "2026-10-14T00:00:00Z", outcome: "one_driver", confidence: "low",
  basis: "before_only", zone: "America/Chicago", zone_method: "gps", started_at: "2026-10-13T15:00:00Z", ended_at: "2026-10-13T15:40:00Z",
  location_check: "confirmed", vehicle_id: "v-1", samsara_vehicle_id: "sv-1", samsara_driver_id: "s-ann", samsara_driver_name: "Ann", candidates: [],
  decided_by: null, driver_id: null, note: null,
};

const doneRead = (licence = "P123-4567-8901") => ({
  status: "done",
  sourceId: "src-1",
  readId: "read-1",
  failureCode: null,
  result: { reportNumber: "PNCK000234", driver: { name: "ANN ROSTER", licenseNumber: licence, licenseState: "IL" }, units: [] },
  evidence: [{ path: "driver.licenseNumber", value: licence, status: "check", ruleVersion: "r", sources: [
    { reader: "passA", page: null, bbox: null, value: licence }, { reader: "passB", page: null, bbox: null, value: licence }] }],
});

const recorder = (opts: { person?: boolean } = {}) =>
  createSupabaseRecorder({
    tables: {
      inspection_report_reads: () => ({ data: [{ inspection_id: INSP, document_id: "doc-1", sha256: "a".repeat(64) }] }),
      inspection_report_checks: () => ({ data: [] }),
      roadside_inspections: () => ({ data: [{ report_number: "PNCK000234", report_state: "WY" }] }),
      roadside_inspection_units: () => ({ data: [] }),
      drivers: () => ({ data: [{ id: "d-ann", full_name: "Ann Roster", cdl_number: "P12345678901", cdl_state: "IL", samsara_driver_id: "s-ann" }] }),
      inspection_attributions: (q: RecordedQuery) => {
        if (q.write) return { data: [{ id: "rep-1" }] };
        const source = q.filters().find((f) => f.col === "source")?.val;
        if (source === "engine") return { data: [ENGINE] };
        if (source === "person" && opts.person) return { data: [{ ...ENGINE, id: "p-1", source: "person", decided_by: "u-1", created_at: "2026-10-14T05:00:00Z" }] };
        return { data: [] };
      },
      audit_logs: () => ({ data: [] }),
    },
  });

describe("checkReportBacklog", () => {
  it("⚠ confirms the driver when everything agrees — a `report` row naming our driver, no decider, then the check", async () => {
    readOfBytes.mockResolvedValue(doneRead());
    const rec = recorder();
    expect(await checkReportBacklog(rec.client, ORG)).toEqual({ confirmed: 1 });
    const [attribution] = rec.writtenRows("inspection_attributions");
    expect(attribution).toMatchObject({ source: "report", driver_id: "d-ann", samsara_driver_id: "s-ann", engine_version: "ic5.1" });
    expect(attribution).not.toHaveProperty("decided_by");
    expect(rec.writtenRows("inspection_report_checks")[0]).toMatchObject({ outcome: "confirmed", attribution_id: "rep-1", licence_last4: "8901" });
    expectOrgScoped(rec, ORG);
  });

  it("⚠ never writes over a person's decision — it records that the report agrees", async () => {
    readOfBytes.mockResolvedValue(doneRead());
    const rec = recorder({ person: true });
    expect(await checkReportBacklog(rec.client, ORG)).toEqual({ agrees: 1 });
    expect(rec.writtenRows("inspection_attributions")).toEqual([]);
  });

  it("writes no attribution when a check disagrees, and says why", async () => {
    readOfBytes.mockResolvedValue(doneRead("Z000"));
    const rec = recorder();
    expect(await checkReportBacklog(rec.client, ORG)).toEqual({ needs_review: 1 });
    expect(rec.writtenRows("inspection_attributions")).toEqual([]);
    expect(rec.writtenRows("inspection_report_checks")[0]!.reasons).toContain("licence_not_on_roster");
  });

  it("records a failed read as `unreadable`, and waits for one still reading", async () => {
    readOfBytes.mockResolvedValueOnce({ status: "failed", sourceId: "s", readId: "read-9", failureCode: "unusable_image", result: null, evidence: [] });
    const rec = recorder();
    expect(await checkReportBacklog(rec.client, ORG)).toEqual({ unreadable: 1 });
    readOfBytes.mockResolvedValueOnce({ status: "reading", sourceId: "s", readId: "read-9", failureCode: null, result: null, evidence: [] });
    expect(await checkReportBacklog(recorder().client, ORG)).toEqual({ waiting: 1 });
  });
});
