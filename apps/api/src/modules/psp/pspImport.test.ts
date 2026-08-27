import { describe, it, expect } from "vitest";
import { PSP_IMPORT_SOURCE } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { filePspImport, registerPspImportDocument, isPspImportError } from "./pspImport.js";

/**
 * The import path — the half of PSP that spends nothing.
 *
 * What is pinned here is what an import may NOT do: cite another driver's document, cite an
 * unrestricted kind, file the same PDF twice, or claim anything about the report's contents. The
 * money assertions belong to `pspOrder.test.ts`; nothing in this file can be billed for.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const OTHER_DRIVER = "88888888-9999-4aaa-8bbb-cccccccccccc";
const DOC = "22222222-3333-4444-8555-666666666666";
const TODAY = "2026-08-19";

const body = (over: Record<string, unknown> = {}) => ({
  driver_id: DRIVER,
  document_id: DOC,
  obtained_on: "2025-06-02",
  consent_obtained: true as const,
  ...over,
});

const DOC_ROW = { id: DOC, subject_type: "driver", subject_id: DRIVER, kind: "psp_report" };

const seed = (over: { drivers?: unknown[]; documents?: unknown[]; records?: unknown[] } = {}) =>
  createSupabaseRecorder({
    tables: {
      drivers: over.drivers ?? [{ id: DRIVER }],
      documents: over.documents ?? [DOC_ROW],
      /**
       * READ and WRITE need different answers from one table here, and the recorder returns its
       * fixture whatever filters ran — so a flat array would make the duplicate check find the row
       * the insert is about to create, and every filing would look like a replay. The function form
       * splits them: the read is the "already filed?" probe, the write is the insert's
       * `.select("id").single()`.
       */
      qualification_records: (q) =>
        q.write
          ? { data: [{ id: "rec-new" }], error: null }
          : { data: over.records ?? [], error: null },
    },
    storage: {
      createSignedUploadUrl: () => ({ data: { signedUrl: "https://storage.test/put", token: "tok" }, error: null }),
    },
  });

describe("filing an imported record", () => {
  it("files the PDF as a psp_report record dated when it was obtained", async () => {
    const rec = seed();
    const result = await filePspImport(rec.client, ORG, "u-recruiter", body(), TODAY);

    expect(isPspImportError(result)).toBe(false);
    expect(!isPspImportError(result) && result.recordId).toBe("rec-new");
    const row = rec.writtenRows("qualification_records")[0]!;
    expect(row.kind).toBe("psp_report");
    expect(row.occurred_on).toBe("2025-06-02");
    expect(row.document_id).toBe(DOC);
    expect(row.result).toBe("imported");
    expect((row.detail as Record<string, unknown>).source).toBe(PSP_IMPORT_SOURCE);
  });

  /** D-PSP5: a zero we invented would be indistinguishable from a zero PSP reported. */
  it("claims nothing about inspections or crashes", async () => {
    const rec = seed();
    await filePspImport(rec.client, ORG, "u-recruiter", body(), TODAY);
    const detail = rec.writtenRows("qualification_records")[0]!.detail as Record<string, unknown>;
    expect(detail.structured).toBe(false);
    expect(detail).not.toHaveProperty("inspections");
    expect(detail).not.toHaveProperty("crashes");
  });

  /** The ledger is a record of transactions WE made; an import is not one. */
  it("writes no psp_requests row", async () => {
    const rec = seed();
    await filePspImport(rec.client, ORG, "u-recruiter", body(), TODAY);
    expect(rec.forTable("psp_requests")).toHaveLength(0);
  });

  it("scopes every read and write to the caller's org", async () => {
    const rec = seed();
    await filePspImport(rec.client, ORG, "u-recruiter", body(), TODAY);
    expectOrgScoped(rec, ORG);
  });
});

describe("what an import is refused for", () => {
  it("refuses a document that belongs to another driver", async () => {
    const rec = seed({ documents: [{ ...DOC_ROW, subject_id: OTHER_DRIVER }] });
    const result = await filePspImport(rec.client, ORG, "u", body(), TODAY);
    expect(isPspImportError(result) && result.code).toBe("invalid_request");
    expect(rec.writes().filter((q) => q.table === "qualification_records")).toHaveLength(0);
  });

  /** The kind IS the §391.53(a)(1) read restriction (0217): an `other` PDF is one anyone can open. */
  it("refuses a document that is not filed as a psp_report", async () => {
    const rec = seed({ documents: [{ ...DOC_ROW, kind: "other" }] });
    const result = await filePspImport(rec.client, ORG, "u", body(), TODAY);
    expect(isPspImportError(result) && result.message).toContain("not filed as a PSP report");
  });

  it("refuses a driver who is not in this org", async () => {
    const rec = seed({ drivers: [] });
    const result = await filePspImport(rec.client, ORG, "u", body(), TODAY);
    expect(isPspImportError(result) && result.code).toBe("not_found");
  });

  it("refuses a date the PSP programme did not exist for, before touching the database", async () => {
    const rec = seed();
    const result = await filePspImport(rec.client, ORG, "u", body({ obtained_on: "1011-03-04" }), TODAY);
    expect(isPspImportError(result) && result.code).toBe("invalid_request");
    expect(rec.queries).toHaveLength(0);
  });

  /** A retried POST after a dropped response must not put two records of one screening in the file. */
  it("returns the existing record rather than filing the same PDF twice", async () => {
    const rec = seed({ records: [{ id: "rec-existing" }] });
    const result = await filePspImport(rec.client, ORG, "u", body(), TODAY);
    expect(!isPspImportError(result) && result.recordId).toBe("rec-existing");
    expect(rec.writes().filter((q) => q.table === "qualification_records")).toHaveLength(0);
  });
});

describe("registering the PDF", () => {
  it("forces the psp_report kind and hands back a signed upload URL", async () => {
    const rec = seed();
    const result = await registerPspImportDocument(rec.client, ORG, "u", {
      driver_id: DRIVER, document_id: DOC, sha256: "a".repeat(64), bytes: 12,
    });
    expect(!isPspImportError(result) && result.uploadUrl).toBe("https://storage.test/put");
    const row = rec.writtenRows("documents")[0]!;
    expect(row.kind).toBe("psp_report");
    expect(row.content_type).toBe("application/pdf");
    expect(row.subject_id).toBe(DRIVER);
    expectOrgScoped(rec, ORG);
  });

  it("refuses to register against a driver in another org", async () => {
    const rec = seed({ drivers: [] });
    const result = await registerPspImportDocument(rec.client, ORG, "u", {
      driver_id: DRIVER, document_id: DOC, sha256: "a".repeat(64), bytes: null,
    });
    expect(isPspImportError(result) && result.code).toBe("not_found");
    expect(rec.storageCalls()).toHaveLength(0);
  });
});
