import { describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import type { FiledDocumentRef } from "../../evidence/index.js";
import { readReportBacklog } from "./pass.js";

/**
 * The report pass (IC10): every filed officer's report reaches the document reader once. These pin the
 * order that makes a crash harmless (hand over, THEN link), the waits that are not failures (a file not
 * yet arrived), and the switch.
 */

const ORG = "11111111-1111-1111-1111-111111111111";
const INSP = "55555555-5555-5555-5555-555555555555";
const SHA = "a".repeat(64);
const on = { ROADSIDE_REPORT_READING: "on" } as never;
const doc = (id: string, subjectId = INSP): FiledDocumentRef => ({ id, subjectId, sha256: SHA, uploadedBy: "user-1", createdAt: "2026-10-15T00:00:00Z" });

const recorder = (opts: { linked?: string[]; live?: string[]; linkError?: string } = {}) =>
  createSupabaseRecorder({
    tables: {
      inspection_report_reads: (q) =>
        q.write
          ? { data: null, writeError: opts.linkError ? { message: opts.linkError } : undefined }
          : { data: (opts.linked ?? []).map((document_id) => ({ document_id })) },
      roadside_inspections: () => ({ data: (opts.live ?? [INSP]).map((id) => ({ id })) }),
    },
  });

const deps = (filed: FiledDocumentRef[], over: Partial<Parameters<typeof readReportBacklog>[3]> = {}) => ({
  list: vi.fn(async () => filed),
  download: vi.fn(async () => ({ ok: true as const, bytes: Buffer.from("report"), sha256: SHA })),
  intake: vi.fn(async () => ({ ok: true as const, sourceId: "src-1", sha256: SHA })),
  ...over,
});

describe("readReportBacklog", () => {
  it("hands a new report to the reader under the report profile, then links it", async () => {
    const rec = recorder();
    const d = deps([doc("doc-1")]);
    expect(await readReportBacklog(rec.client, on, ORG, d)).toEqual({ handed_over: 1 });
    expect(d.intake).toHaveBeenCalledWith(rec.client, on, ORG, expect.objectContaining({ profile: "roadside_inspection_report", requestedBy: "user-1" }));
    expect(rec.writtenRows("inspection_report_reads")).toEqual([{ org_id: ORG, inspection_id: INSP, document_id: "doc-1", sha256: SHA }]);
    expectOrgScoped(rec, ORG);
  });

  it("skips a report already handed over", async () => {
    const rec = recorder({ linked: ["doc-1"] });
    const d = deps([doc("doc-1")]);
    expect(await readReportBacklog(rec.client, on, ORG, d)).toEqual({});
    expect(d.download).not.toHaveBeenCalled();
  });

  it("⚠ writes NO link when the hand-over failed — next hour tries again", async () => {
    const rec = recorder();
    const d = deps([doc("doc-1")], { intake: vi.fn(async () => ({ ok: false as const, code: "upload_failed" as const, error: "x" })) });
    expect(await readReportBacklog(rec.client, on, ORG, d)).toEqual({ failed: 1 });
    expect(rec.writtenRows("inspection_report_reads")).toEqual([]);
  });

  it("waits for a file that has not arrived, and never reads one that is not what was filed", async () => {
    const rec = recorder();
    const download = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "not_uploaded", error: "" })
      .mockResolvedValueOnce({ ok: false, code: "hash_mismatch", error: "" });
    const d = deps([doc("doc-1"), doc("doc-2")], { download });
    expect(await readReportBacklog(rec.client, on, ORG, d)).toEqual({ not_uploaded: 1, hash_mismatch: 1 });
    expect(d.intake).not.toHaveBeenCalled();
  });

  it("does not read a report on an inspection no longer on the record", async () => {
    const rec = recorder({ live: [] });
    const d = deps([doc("doc-1")]);
    expect(await readReportBacklog(rec.client, on, ORG, d)).toEqual({ no_inspection: 1 });
    expect(d.download).not.toHaveBeenCalled();
  });

  it("⚠ does nothing at all with the switch off — no intake for a read the gate would refuse", async () => {
    const rec = recorder();
    const d = deps([doc("doc-1")]);
    expect(await readReportBacklog(rec.client, { ROADSIDE_REPORT_READING: "off" } as never, ORG, d)).toEqual({});
    expect(d.list).not.toHaveBeenCalled();
  });

  it("works at most `limit` reports a tick", async () => {
    const rec = recorder();
    const d = deps([doc("a"), doc("b"), doc("c")]);
    expect(await readReportBacklog(rec.client, on, ORG, d, 2)).toEqual({ handed_over: 2 });
  });
});
