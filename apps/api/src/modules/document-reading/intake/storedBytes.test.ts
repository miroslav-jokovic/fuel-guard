import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { INTAKE_LIMITS } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { DOCUMENT_BUCKET } from "../storage.js";
import { intakeStoredBytes } from "./storedBytes.js";

/**
 * Intake for bytes another module holds (IC10). The office upload's path with the browser taken out, so
 * these pin the three ways it could quietly differ from it: a second copy of bytes the org already holds,
 * an object under a key `runIntake` would not find, and a job without the profile that makes it a read.
 */

const ORG = "11111111-1111-1111-1111-111111111111";
const NEW_SOURCE = "22222222-2222-2222-2222-222222222222";
const HELD_SOURCE = "33333333-3333-3333-3333-333333333333";
const env = { JOB_EXECUTION_MODE: "queue" } as never;
const bytes = Buffer.from("%PDF-1.4 an officer's report");
const SHA = createHash("sha256").update(bytes).digest("hex");

const recorder = (held: boolean) =>
  createSupabaseRecorder({
    tables: { document_sources: () => ({ data: held ? [{ id: HELD_SOURCE, page_count: 1 }] : [] }) },
    rpc: () => ({ data: "job-1", error: null }),
  });

describe("intakeStoredBytes", () => {
  it("stores new bytes under the key runIntake reads, and queues an intake that will read them under the profile", async () => {
    const rec = recorder(false);
    const out = await intakeStoredBytes(rec.client, env, ORG, { bytes, profile: "roadside_inspection_report", requestedBy: "user-1" }, () => NEW_SOURCE);
    expect(out).toEqual({ ok: true, sourceId: NEW_SOURCE, sha256: SHA });
    const put = rec.storageCalls().find((c) => c.fn === "upload")!;
    expect(put.bucket).toBe(DOCUMENT_BUCKET);
    expect(put.args[0]).toBe(`${ORG}/${NEW_SOURCE}/source-${SHA}`);
    const job = rec.rpcs().find((r) => JSON.stringify(r.args).includes("document_intake"))!;
    expect(JSON.stringify(job.args)).toContain('"profile":"roadside_inspection_report"');
    expect(JSON.stringify(job.args)).toContain(SHA);
    expectOrgScoped(rec, ORG);
  });

  it("⚠ uploads nothing when the org already holds these bytes — the intake is queued for THAT source", async () => {
    const rec = recorder(true);
    const out = await intakeStoredBytes(rec.client, env, ORG, { bytes, profile: "roadside_inspection_report", requestedBy: null }, () => NEW_SOURCE);
    expect(out).toEqual({ ok: true, sourceId: HELD_SOURCE, sha256: SHA });
    expect(rec.storageCalls()).toEqual([]);
    expect(JSON.stringify(rec.rpcs()[0]!.args)).toContain(HELD_SOURCE);
  });

  it("refuses a file larger than the reader takes, before storing anything", async () => {
    const rec = recorder(false);
    const big = Buffer.alloc(INTAKE_LIMITS.maxBytes + 1);
    const out = await intakeStoredBytes(rec.client, env, ORG, { bytes: big, profile: "roadside_inspection_report", requestedBy: null });
    expect(out).toMatchObject({ ok: false, code: "too_large" });
    expect(rec.storageCalls()).toEqual([]);
    expect(rec.rpcs()).toEqual([]);
  });

  it("queues no intake when the bytes could not be stored", async () => {
    const rec = createSupabaseRecorder({
      tables: { document_sources: () => ({ data: [] }) },
      storage: { upload: () => ({ data: null, error: { message: "bucket missing" } }) },
      rpc: () => ({ data: "job-1", error: null }),
    });
    const out = await intakeStoredBytes(rec.client, env, ORG, { bytes, profile: "roadside_inspection_report", requestedBy: null }, () => NEW_SOURCE);
    expect(out).toMatchObject({ ok: false, code: "upload_failed" });
    expect(rec.rpcs()).toEqual([]);
  });
});
