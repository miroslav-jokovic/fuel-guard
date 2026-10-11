import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { encryptedPdf, pagesPdf } from "../pages/__fixtures__/fixtures.js";
import { NORMALISER_VERSION } from "../pages/index.js";
import { DOCUMENT_BUCKET } from "../storage.js";
import { registerUpload, runIntake, sourceStatus, type IntakeJob } from "./intake.js";

/**
 * Step 1.6b — the upload half of the reader: registration, the worker's intake, and the status poll.
 *
 * What these can get wrong that nothing else catches: a signed path that is not the org's own folder
 * (the bucket has no policy — the prefix IS the tenancy), a file refusal thrown instead of returned
 * (the queue would retry a file that can never be read), and a retry that inserts a page twice or a
 * second source for the same bytes (both tables are append-only; a duplicate is permanent).
 */
const ORG = "org-1";
const SOURCE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const READ = "33333333-3333-4333-8333-333333333333";
const USER = "user-1";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const SHA = "a".repeat(64);
const has = (q: RecordedQuery, col: string, val?: unknown) => q.filters().some((f) => f.col === col && (val === undefined || f.val === val));

describe("registerUpload", () => {
  const req = { fileName: "bol.pdf", mime: "application/pdf" as const, byteSize: 1000, sha256: SHA };

  it("answers the org's existing source for bytes it already holds, with nothing to upload", async () => {
    const rec = createSupabaseRecorder({ tables: { document_sources: [{ id: OTHER, page_count: 2 }] } });
    expect(await registerUpload(rec.client, ORG, req, () => SOURCE)).toEqual({ sourceId: OTHER, uploadUrl: null, duplicate: true });
    expect(rec.storageCalls()).toEqual([]);
    expect(rec.forTable("document_sources")[0]!.filters()).toContainEqual({ col: "sha256", val: SHA });
    expectOrgScoped(rec, ORG);
  });

  it("signs an upload into the org's own folder under a key that carries the announced sha, and writes no row", async () => {
    const rec = createSupabaseRecorder({
      tables: { document_sources: [] },
      storage: { createSignedUploadUrl: () => ({ data: { signedUrl: "https://storage.example.test/put" }, error: null }) },
    });
    expect(await registerUpload(rec.client, ORG, req, () => SOURCE)).toEqual({ sourceId: SOURCE, uploadUrl: "https://storage.example.test/put", duplicate: false });
    expect(rec.storageCalls()).toEqual([{ bucket: DOCUMENT_BUCKET, fn: "createSignedUploadUrl", args: [`${ORG}/${SOURCE}/source-${SHA}`] }]);
    expect(rec.writes()).toEqual([]);
    expectOrgScoped(rec, ORG);
  });

  it("reports a signing failure as sign_failed", async () => {
    const rec = createSupabaseRecorder({ storage: { createSignedUploadUrl: () => ({ data: null, error: { message: "bucket missing" } }) } });
    expect(await registerUpload(rec.client, ORG, req, () => SOURCE)).toMatchObject({ code: "sign_failed" });
  });
});

interface World {
  bytes?: Buffer;
  own?: { id: string; page_count: number } | null;
  bySha?: { id: string; page_count: number } | null;
  storedPages?: number[];
  download?: () => unknown;
  priorRead?: string | null;
}

function intakeWorld(w: World) {
  const rec = createSupabaseRecorder({
    tables: {
      document_sources: (q) => {
        if (q.write) return [];
        if (has(q, "sha256")) return w.bySha ? [w.bySha] : [];
        // requestRead's existence check reads by id too; once intake has inserted, the source exists.
        const inserted = rec.writtenRows("document_sources")[0];
        if (inserted && has(q, "id", inserted.id)) return [{ id: inserted.id, page_count: inserted.page_count }];
        if (w.own && has(q, "id", w.own.id)) return [w.own];
        if (w.bySha && has(q, "id", w.bySha.id)) return [w.bySha];
        return [];
      },
      document_pages: (w.storedPages ?? []).map((page_number) => ({ page_number })),
      document_reads: (q) => (q.write ? [{ id: READ }] : w.priorRead ? [{ id: w.priorRead }] : []),
    },
    storage: {
      download: w.download ?? (() => ({ data: new Blob([new Uint8Array(w.bytes!)]), error: null })),
    },
  });
  const dispatched: string[] = [];
  const deps = { dispatchRead: async (id: string) => void dispatched.push(id) };
  const job = (over: Partial<IntakeJob> = {}): IntakeJob => ({ sourceId: SOURCE, sha256: sha(w.bytes ?? Buffer.alloc(0)), profile: null, requestedBy: USER, ...over });
  return { rec, deps, job, dispatched };
}

describe("runIntake", () => {
  it("renders an upload into one source row, every page row, and an original and working copy per page", async () => {
    const bytes = await pagesPdf(2);
    const { rec, deps, job } = intakeWorld({ bytes });
    expect(await runIntake(rec.client, ORG, job(), deps)).toEqual({ outcome: "ready", sourceId: SOURCE, pageCount: 2, readId: null });

    expect(rec.storageCalls()[0]).toEqual({ bucket: DOCUMENT_BUCKET, fn: "download", args: [`${ORG}/${SOURCE}/source-${sha(bytes)}`] });
    const uploads = rec.storageCalls().filter((c) => c.fn === "upload").map((c) => c.args[0]);
    expect(uploads).toEqual([1, 2].flatMap((n) => [`${ORG}/${SOURCE}/pages/${n}.png`, `${ORG}/${SOURCE}/pages/${n}.webp`]));

    expect(rec.writtenRows("document_sources")).toEqual([expect.objectContaining({
      id: SOURCE, org_id: ORG, origin: "upload", sha256: sha(bytes), mime: "application/pdf",
      byte_size: bytes.length, page_count: 2, uploaded_by: USER, storage_path: `${ORG}/${SOURCE}/source-${sha(bytes)}`,
    })]);
    const pages = rec.writtenRows("document_pages");
    expect(pages.map((p) => p.page_number)).toEqual([1, 2]);
    for (const p of pages) {
      expect(p).toMatchObject({ org_id: ORG, source_id: SOURCE, normaliser_version: NORMALISER_VERSION, capture_metrics: { renderDpi: expect.any(Number) } });
      expect(p.original_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expectOrgScoped(rec, ORG);
  });

  it("refuses bytes whose sha is not the one announced, writing nothing", async () => {
    const bytes = await pagesPdf(1);
    const { rec, deps, job } = intakeWorld({ bytes });
    expect(await runIntake(rec.client, ORG, job({ sha256: SHA }), deps)).toEqual({ outcome: "refused", refusal: "hash_mismatch" });
    expect(rec.writes()).toEqual([]);
  });

  it("refuses a missing upload as upload_missing, but throws any other Storage error so the queue retries it", async () => {
    const missing = intakeWorld({ bytes: Buffer.from("x"), download: () => ({ data: null, error: { message: "Object not found" } }) });
    expect(await runIntake(missing.rec.client, ORG, missing.job(), missing.deps)).toEqual({ outcome: "refused", refusal: "upload_missing" });

    const down = intakeWorld({ bytes: Buffer.from("x"), download: () => ({ data: null, error: { message: "connection reset" } }) });
    await expect(runIntake(down.rec.client, ORG, down.job(), down.deps)).rejects.toThrow(/connection reset/);
  });

  it("returns a file the normaliser refuses as a result, never a throw, and writes nothing", async () => {
    const { rec, deps, job } = intakeWorld({ bytes: await encryptedPdf() });
    expect(await runIntake(rec.client, ORG, job({ profile: "shipping_document" }), deps)).toEqual({ outcome: "refused", refusal: "encrypted_pdf" });
    expect(rec.writes()).toEqual([]);
  });

  it("finishes a half-done retry: no second source row, and only the pages not yet stored", async () => {
    const bytes = await pagesPdf(2);
    const { rec, deps, job } = intakeWorld({ bytes, own: { id: SOURCE, page_count: 2 }, storedPages: [1] });
    expect(await runIntake(rec.client, ORG, job(), deps)).toMatchObject({ outcome: "ready", sourceId: SOURCE, pageCount: 2 });
    expect(rec.writtenRows("document_sources")).toEqual([]);
    expect(rec.writtenRows("document_pages").map((p) => p.page_number)).toEqual([2]);
    expect(rec.storageCalls().filter((c) => c.fn === "upload").map((c) => c.args[0])).toEqual([`${ORG}/${SOURCE}/pages/2.png`, `${ORG}/${SOURCE}/pages/2.webp`]);
    expectOrgScoped(rec, ORG);
  });

  it("resolves the same bytes registered twice to the source that finished first, rendering nothing", async () => {
    const bytes = await pagesPdf(1);
    const { rec, deps, job } = intakeWorld({ bytes, bySha: { id: OTHER, page_count: 1 }, storedPages: [1] });
    expect(await runIntake(rec.client, ORG, job(), deps)).toEqual({ outcome: "ready", sourceId: OTHER, pageCount: 1, readId: null });
    expect(rec.writes()).toEqual([]);
    expect(rec.storageCalls()).toEqual([]);
    expectOrgScoped(rec, ORG);
  });

  it("queues the read when a profile was named, and reuses it when the job is retried", async () => {
    const bytes = await pagesPdf(1);
    const first = intakeWorld({ bytes });
    expect(await runIntake(first.rec.client, ORG, first.job({ profile: "shipping_document" }), first.deps)).toMatchObject({ readId: READ });
    expect(first.dispatched).toEqual([READ]);
    expect(first.rec.writtenRows("document_reads")).toEqual([expect.objectContaining({ org_id: ORG, source_id: SOURCE, profile: "shipping_document", requested_by: USER })]);
    expectOrgScoped(first.rec, ORG);

    const retry = intakeWorld({ bytes, own: { id: SOURCE, page_count: 1 }, storedPages: [1], priorRead: READ });
    expect(await runIntake(retry.rec.client, ORG, retry.job({ profile: "shipping_document" }), retry.deps)).toMatchObject({ readId: READ });
    expect(retry.dispatched).toEqual([]);
    expect(retry.rec.writes()).toEqual([]);
    const reuse = retry.rec.forTable("document_reads")[0]!.ops.find((o) => o.method === "in");
    expect(reuse?.args[1]).toContain("done");
  });
});

describe("sourceStatus", () => {
  function statusWorld(job: { status: string; stats?: unknown } | null, sourceIds: Record<string, number> = {}) {
    return createSupabaseRecorder({
      tables: {
        jobs: job ? [{ status: job.status, stats: job.stats ?? null }] : [],
        document_sources: (q) => {
          const id = q.filters().find((f) => f.col === "id")?.val as string;
          return id in sourceIds ? [{ id, page_count: sourceIds[id] }] : [];
        },
      },
    });
  }
  const base = { sourceId: SOURCE, refusal: null, pageCount: null, readId: null };

  it("answers uploading, normalising, failed, refused and ready from the job and the source row", async () => {
    const cases: Array<[Parameters<typeof statusWorld>[0], Record<string, number>, object]> = [
      [null, {}, { ...base, status: "uploading" }],
      [{ status: "queued" }, {}, { ...base, status: "normalising" }],
      [{ status: "running" }, {}, { ...base, status: "normalising" }],
      [{ status: "failed" }, {}, { ...base, status: "failed" }],
      [{ status: "done", stats: { outcome: "refused", refusal: "hash_mismatch" } }, {}, { ...base, status: "refused", refusal: "hash_mismatch" }],
      [{ status: "done", stats: { outcome: "ready", sourceId: SOURCE, pageCount: 3, readId: READ } }, { [SOURCE]: 3 }, { ...base, status: "ready", pageCount: 3, readId: READ }],
    ];
    for (const [job, sources, want] of cases) {
      const rec = statusWorld(job, sources);
      expect(await sourceStatus(rec.client, ORG, SOURCE), JSON.stringify(job)).toEqual(want);
      expect(rec.forTable("jobs")[0]!.filters()).toEqual(expect.arrayContaining([
        { col: "kind", val: "document_intake" }, { col: "dedup_key", val: `document_intake:${SOURCE}` },
      ]));
      expectOrgScoped(rec, ORG);
    }
  });

  it("answers a duplicate's intake with the source it resolved to", async () => {
    const rec = statusWorld({ status: "done", stats: { outcome: "ready", sourceId: OTHER, pageCount: 1, readId: null } }, { [OTHER]: 1 });
    expect(await sourceStatus(rec.client, ORG, SOURCE)).toEqual({ ...base, sourceId: OTHER, status: "ready", pageCount: 1 });
  });
});
