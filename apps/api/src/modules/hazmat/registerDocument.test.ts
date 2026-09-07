import { describe, expect, it } from "vitest";
import { registerDocument } from "./hazmatLoads.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import type { HazmatRegisterDocumentRequest, HazmatRegisterDocumentResponse } from "@silvicom/shared";

/**
 * `registerDocument` had no test at all before Phase 4b of SCANNER-UPGRADE-PLAN.md, which is worth
 * saying plainly: it is the only writer of `hazmat_documents`, it decides where every BOL image is
 * stored, and it is the function D-SCAN11's three outputs pass through. What follows covers the
 * ORIGINAL-of-record path it gains here, plus the two pre-existing properties that path could break.
 */

const ORG = "org-1";
const USER = "user-1";
const LOAD = "load-1";
const DOC = "11111111-1111-4111-8111-111111111111";

function req(overrides: Partial<HazmatRegisterDocumentRequest> = {}): HazmatRegisterDocumentRequest {
  return {
    id: DOC, kind: "bol", page: 1, sha256: "archive-hash", contentType: "image/jpeg",
    ...overrides,
  } as HazmatRegisterDocumentRequest;
}

function capture(overrides: Record<string, unknown> = {}) {
  return {
    configVersion: "capture-2026.08.0",
    mode: "system_scanner" as const,
    osEnhanced: true,
    integrityHash: "original-hash",
    quality: {},
    ocrEvidence: null,
    ...overrides,
  };
}

function recorder(): SupabaseRecorder {
  return createSupabaseRecorder({
    tables: {
      hazmat_loads: [{ id: LOAD }],
      hazmat_documents: { data: [], error: null, count: 0 },
    },
    storage: {
      createSignedUploadUrl: (path: string) => ({
        data: { signedUrl: `https://signed.test/${path}`, token: `token-for-${path}`, path },
        error: null,
      }),
    },
  });
}

const insertedRow = (rec: SupabaseRecorder): Record<string, unknown> =>
  rec.writtenRows("hazmat_documents")[0] ?? {};

const ok = (r: unknown): HazmatRegisterDocumentResponse => r as HazmatRegisterDocumentResponse;

describe("registerDocument — the ARCHIVE, unchanged", () => {
  it("keeps signing and recording the path extraction downloads", async () => {
    const rec = recorder();
    const res = ok(await registerDocument(rec.client as never, ORG, USER, LOAD, req({ capture: capture() })));
    expect(res.storagePath).toBe(`${ORG}/${LOAD}/${DOC}.orig.jpg`);
    expect(insertedRow(rec).storage_path).toBe(`${ORG}/${LOAD}/${DOC}.orig.jpg`);
    expect(insertedRow(rec).sha256).toBe("archive-hash");
  });

  it("registers no original when the request does not declare one (a manager, or a pre-4b app)", async () => {
    const rec = recorder();
    const res = ok(await registerDocument(rec.client as never, ORG, USER, LOAD, req()));
    expect(res.original).toBeUndefined();
    expect(insertedRow(rec).original_storage_path).toBeUndefined();
    // A build that cannot produce an original must never claim one — a NULL column and an absent
    // response field are the same statement, and the sweep reads the column to decide what is pending.
    expect(rec.storageCalls().filter((c) => c.fn === "createSignedUploadUrl")).toHaveLength(1);
  });
});

describe("registerDocument — the ORIGINAL of record (D-SCAN6/D-SCAN11)", () => {
  it("signs a second upload URL and records the path, size and hash", async () => {
    const rec = recorder();
    const res = ok(await registerDocument(
      rec.client as never, ORG, USER, LOAD,
      req({ capture: capture({ original: { bytes: 3_145_728 }, archiveBytes: 240_000 }) }),
    ));
    expect(res.original?.storagePath).toBe(`${ORG}/${LOAD}/${DOC}.original.jpg`);
    expect(res.original?.uploadUrl).toContain(`${DOC}.original.jpg`);
    expect(res.original?.token).toBe(`token-for-${ORG}/${LOAD}/${DOC}.original.jpg`);

    const row = insertedRow(rec);
    expect(row.original_storage_path).toBe(`${ORG}/${LOAD}/${DOC}.original.jpg`);
    expect(row.original_bytes).toBe(3_145_728);
    expect(row.archive_bytes).toBe(240_000);
    // 0328: `integrity_hash` is the ORIGINAL's hash and `sha256` is the archive's. They were equal on
    // every row written before Phase 4, when a capture produced one artifact (audit finding F1).
    expect(row.integrity_hash).toBe("original-hash");
    expect(row.sha256).toBe("archive-hash");
  });

  /**
   * ⚠ The assertion this file exists for. `storagePath` has used `{id}.orig.jpg` for every
   * `image/jpeg` registration since the function was written, and the plan's §4 Step 4b names
   * `{id}.orig.jpg` for the ORIGINAL. Following it literally puts both artifacts at one key, and the
   * `hazmat` bucket denies overwrite — so the second upload returns "already exists", which the
   * outbox handler treats as success on purpose. The original would never upload and every layer
   * would report that it had.
   */
  it("does not put the original at the key the archive already uses", async () => {
    const rec = recorder();
    const res = ok(await registerDocument(
      rec.client as never, ORG, USER, LOAD,
      req({ capture: capture({ original: { bytes: 1 } }) }),
    ));
    expect(res.original?.storagePath).not.toBe(res.storagePath);
    const row = insertedRow(rec);
    expect(row.original_storage_path).not.toBe(row.storage_path);
  });

  it("stores the shadow-mode telemetry, which is the only place those numbers exist", async () => {
    // Step 5.1 / D-SCAN10. Blur, glare, shadow, brightness and contrast are measured on every capture
    // and rendered `na` by the gate, so `quality` does not carry them. If this column does not get
    // them, nothing does, and Step 5.2 derives thresholds from an empty distribution.
    const rec = recorder();
    const metrics = { version: 1, metrics: { longEdgePx: 4032, blurVariance: 812.5 }, analysisLongEdgePx: 1024 };
    await registerDocument(rec.client as never, ORG, USER, LOAD, req({ capture: capture({ metrics }) }));
    expect(insertedRow(rec).capture_metrics).toEqual(metrics);
  });

  it("leaves the column NULL when a capture sent none, rather than writing an empty object", async () => {
    // A manager-registered document, or a driver app older than Step 5.1. `{}` would be a row that
    // claims to have been measured and was not.
    const rec = recorder();
    await registerDocument(rec.client as never, ORG, USER, LOAD, req({ capture: capture() }));
    expect(insertedRow(rec).capture_metrics).toBeUndefined();
  });

  it("is org-scoped on every read, because the service role bypasses RLS", async () => {
    const rec = recorder();
    await registerDocument(rec.client as never, ORG, USER, LOAD, req({ capture: capture({ original: { bytes: 1 } }) }));
    expectOrgScoped(rec, ORG);
  });

  it("fails the registration when the original's URL cannot be signed, rather than recording a path with no way to fill it", async () => {
    const rec = createSupabaseRecorder({
      tables: { hazmat_loads: [{ id: LOAD }], hazmat_documents: { data: [], error: null, count: 0 } },
      storage: {
        createSignedUploadUrl: (path: string) =>
          path.endsWith(".original.jpg")
            ? { data: null, error: { message: "storage is down" } }
            : { data: { signedUrl: "u", token: "t", path }, error: null },
      },
    });
    const res = await registerDocument(rec.client as never, ORG, USER, LOAD, req({ capture: capture({ original: { bytes: 1 } }) }));
    expect(res).toMatchObject({ code: "sign_failed" });
    expect(rec.forTable("hazmat_documents").some((q) => q.write?.method === "upsert")).toBe(false);
  });
});
