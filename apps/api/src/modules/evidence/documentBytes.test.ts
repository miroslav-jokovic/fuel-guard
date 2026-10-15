import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { downloadDocumentBytes, listFiledDocuments } from "./documentBytes.js";

/**
 * A filed document's bytes for a module that reads the paper (IC10). The row is written at REGISTRATION,
 * before the browser's PUT, so the two outcomes a reader must never mistake for a document are pinned:
 * no object yet, and an object that is not the file that was announced.
 */

const ORG = "11111111-1111-1111-1111-111111111111";
const DOC = "44444444-4444-4444-4444-444444444444";
const bytes = Buffer.from("an officer's report");
const SHA = createHash("sha256").update(bytes).digest("hex");
const row = { storage_path: `${ORG}/roadside_inspection/x/report.pdf`, sha256: SHA };

const withDownload = (download: () => unknown) =>
  createSupabaseRecorder({ tables: { documents: () => ({ data: [row] }) }, storage: { download } });

describe("downloadDocumentBytes", () => {
  it("answers the bytes when they hash to what was filed", async () => {
    const rec = withDownload(() => ({ data: new Blob([bytes]), error: null }));
    const out = await downloadDocumentBytes(rec.client, ORG, DOC);
    expect(out).toMatchObject({ ok: true, sha256: SHA });
    expectOrgScoped(rec, ORG);
  });

  it("⚠ refuses bytes that are not the filed file — reading them would name a driver from a file nobody filed", async () => {
    const rec = withDownload(() => ({ data: new Blob([Buffer.from("something else")]), error: null }));
    expect(await downloadDocumentBytes(rec.client, ORG, DOC)).toMatchObject({ ok: false, code: "hash_mismatch" });
  });

  it("says `not_uploaded` when the registered file has not arrived, so the caller tries again later", async () => {
    const rec = withDownload(() => ({ data: null, error: { message: "Object not found" } }));
    expect(await downloadDocumentBytes(rec.client, ORG, DOC)).toMatchObject({ ok: false, code: "not_uploaded" });
  });

  it("does not call a Storage outage a missing upload", async () => {
    const rec = withDownload(() => ({ data: null, error: { message: "connection reset" } }));
    expect(await downloadDocumentBytes(rec.client, ORG, DOC)).toMatchObject({ ok: false, code: "query_failed" });
  });
});

describe("listFiledDocuments", () => {
  it("lists originals only, of the asked kind and subject type, org-scoped", async () => {
    const rec = createSupabaseRecorder({
      tables: { documents: () => ({ data: [{ id: DOC, subject_id: "insp-1", sha256: SHA, uploaded_by: "u1", created_at: "2026-10-15T00:00:00Z" }] }) },
    });
    const out = await listFiledDocuments(rec.client, ORG, { subjectType: "roadside_inspection", kind: "roadside_inspection_report" });
    expect(out).toEqual([{ id: DOC, subjectId: "insp-1", sha256: SHA, uploadedBy: "u1", createdAt: "2026-10-15T00:00:00Z" }]);
    const filters = rec.forTable("documents")[0]!.filters();
    expect(filters).toEqual(expect.arrayContaining([
      { col: "subject_type", val: "roadside_inspection" },
      { col: "kind", val: "roadside_inspection_report" },
      { col: "variant", val: "original" },
    ]));
    expectOrgScoped(rec, ORG);
  });
});
