import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";

/**
 * The AI check of a dropped MVR (HIRING-WORKFLOW-AUDIT §14, OF6b). Pinned: only THIS driver's MVR scan is
 * read, the bytes the reader gets are the filed document's (hash-checked by evidence), a refused switch
 * spends nothing, and a finished read comes back parsed through the profile with the findings beside it.
 */
const readOfBytes = vi.fn();
const intakeStoredBytes = vi.fn();
const downloadDocumentBytes = vi.fn();
vi.mock("../document-reading/index.js", () => ({
  readOfBytes: (...a: unknown[]) => readOfBytes(...a),
  intakeStoredBytes: (...a: unknown[]) => intakeStoredBytes(...a),
}));
vi.mock("../evidence/index.js", () => ({ downloadDocumentBytes: (...a: unknown[]) => downloadDocumentBytes(...a) }));
const { readMvrCheck, startMvrCheck } = await import("./mvrCheck.js");

const ORG = "11111111-1111-1111-1111-111111111111";
const DRIVER = "22222222-2222-2222-2222-222222222222";
const DOC = "33333333-3333-3333-3333-333333333333";
const SHA = "a".repeat(64);
const ON = testEnv({ MVR_REPORT_READING: "on" });

const recorder = (doc: Record<string, unknown> | null = { id: DOC, subject_type: "driver", subject_id: DRIVER, kind: "mvr", sha256: SHA }) =>
  createSupabaseRecorder({
    tables: {
      documents: () => ({ data: doc }),
      drivers: () => ({ data: { full_name: "Ana Driver", cdl_number: "D1234567", cdl_state: "IL" } }),
    },
  });

beforeEach(() => {
  readOfBytes.mockReset();
  intakeStoredBytes.mockReset();
  downloadDocumentBytes.mockReset();
});

describe("startMvrCheck", () => {
  it("hands this driver's filed MVR bytes to the reader under mvr_report, as its requester", async () => {
    downloadDocumentBytes.mockResolvedValue({ ok: true, bytes: Buffer.from("pdf"), sha256: SHA });
    intakeStoredBytes.mockResolvedValue({ ok: true, sha256: SHA });
    const rec = recorder();
    expect(await startMvrCheck(rec.client, ON, ORG, "u-1", DRIVER, DOC)).toEqual({ sha256: SHA });
    expect(downloadDocumentBytes).toHaveBeenCalledWith(rec.client, ORG, DOC);
    expect(intakeStoredBytes.mock.calls[0]![3]).toEqual({ bytes: Buffer.from("pdf"), profile: "mvr_report", requestedBy: "u-1" });
    expectOrgScoped(rec, ORG);
  });

  it("refuses another driver's document, or one not filed as an MVR, before reading anything", async () => {
    for (const doc of [
      { id: DOC, subject_type: "driver", subject_id: "someone-else", kind: "mvr", sha256: SHA },
      { id: DOC, subject_type: "driver", subject_id: DRIVER, kind: "medical_card", sha256: SHA },
    ]) {
      expect(await startMvrCheck(recorder(doc).client, ON, ORG, "u-1", DRIVER, DOC)).toMatchObject({ code: "invalid_request" });
    }
    expect(await startMvrCheck(recorder(null).client, ON, ORG, "u-1", DRIVER, DOC)).toMatchObject({ code: "not_found" });
    expect(downloadDocumentBytes).not.toHaveBeenCalled();
    expect(intakeStoredBytes).not.toHaveBeenCalled();
  });

  it("spends nothing when reading is switched off", async () => {
    expect(await startMvrCheck(recorder().client, testEnv({ MVR_REPORT_READING: "off" }), ORG, "u-1", DRIVER, DOC)).toMatchObject({ code: "reading_off" });
    expect(intakeStoredBytes).not.toHaveBeenCalled();
  });

  it("says to drop it again when the bytes never arrived or are not the ones registered", async () => {
    downloadDocumentBytes.mockResolvedValue({ ok: false, code: "hash_mismatch", error: "x" });
    expect(await startMvrCheck(recorder().client, ON, ORG, "u-1", DRIVER, DOC)).toMatchObject({ code: "not_uploaded" });
    expect(intakeStoredBytes).not.toHaveBeenCalled();
  });
});

describe("readMvrCheck", () => {
  it("is still reading until the read is done — including before the reader has a source", async () => {
    for (const status of ["no_source", "no_read", "queued", "reading"]) {
      readOfBytes.mockResolvedValueOnce({ status });
      expect(await readMvrCheck(recorder().client, ORG, DRIVER, DOC, "2026-11-03")).toEqual({ status: "reading" });
    }
    expect(readOfBytes).toHaveBeenCalledWith(expect.anything(), ORG, SHA, "mvr_report");
  });

  it("answers a finished read with the report and its findings against this applicant", async () => {
    readOfBytes.mockResolvedValue({
      status: "done", sourceId: "s", readId: "r", failureCode: null, evidence: [],
      result: { licenseNumber: "D7654321", licenseStatus: "SUSPENDED", medicalCertificationStatus: "CERTIFIED" },
    });
    const rec = recorder();
    const out = await readMvrCheck(rec.client, ORG, DRIVER, DOC, "2026-11-03");
    expect(out).toMatchObject({ status: "done", report: { licenseStatus: "SUSPENDED", violations: [] } });
    const codes = (out as { findings: Array<{ code: string }> }).findings.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["licence_number_differs", "status_not_valid"]));
    expectOrgScoped(rec, ORG);
  });

  it("says it failed when the read failed, or returned something that is not the profile", async () => {
    readOfBytes.mockResolvedValueOnce({ status: "failed", failureCode: "refused" });
    expect(await readMvrCheck(recorder().client, ORG, DRIVER, DOC, "2026-11-03")).toEqual({ status: "failed", reason: "refused" });
    readOfBytes.mockResolvedValueOnce({ status: "done", result: { violations: "not a list" } });
    expect(await readMvrCheck(recorder().client, ORG, DRIVER, DOC, "2026-11-03")).toEqual({ status: "failed", reason: "unreadable_result" });
  });
});
