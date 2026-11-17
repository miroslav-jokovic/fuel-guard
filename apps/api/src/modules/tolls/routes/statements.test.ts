import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/tolls/statements` (TOLLS-PER-TRUCK-PLAN.md TL4a). What 0627 refuses is proved by its PGlite
 * matrix (`supabase/tests/toll-statements.test.mjs`); what is left is the API's half:
 *
 *   · a statement is kept only when the stored bytes are the file picked (size, SHA-256) and a
 *     statement-shaped file inside, and the format recorded is the one read from the bytes;
 *   · a refused file's bytes are deleted, so a statement nobody kept does not sit in storage;
 *   · the same file twice is a 409 naming the copy already kept;
 *   · statements gate on accounting, not on equipment like the tags (D-TL11);
 *   · every query is org-scoped, because the service role bypasses RLS.
 */

const ORG = "org-1";
const USER = "user-1";
const NEW_ID = "11111111-1111-4111-8111-111111111111";
const OLD_ID = "22222222-2222-4222-8222-222222222222";
const CSV = new TextEncoder().encode("Tag,Date,Plaza,Amount\n00812345678,06/01/2026,Exit 7,3.25\n");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
const audit = vi.hoisted(() => ({
  writeAudit: vi.fn(async (_admin: unknown, _entry: Record<string, unknown>) => true),
}));
vi.mock("../../../lib/audit.js", () => audit);
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: "accountant", email: "books@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  // What a grant ADMITS is proved in middleware/requireSection.test.ts against the real gate. Here
  // the caller's grants come in a header, so a test can show WHICH section and level a route asks.
  requireSection:
    (section: string, level: "view" | "manage" = "manage") =>
    (req: Request, res: Response, next: NextFunction) => {
      const grants = String(req.headers["x-grants"] ?? "accounting:manage").split(",");
      const ok = grants.some((g) => {
        const [s, l] = g.split(":");
        return s === section && (l === "manage" || l === level);
      });
      if (ok) next();
      else res.status(403).json({ ok: false, error: { code: "forbidden", message: "no" } });
    },
}));

const { tollsRouter } = await import("./tolls.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/tolls", tollsRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tolls/statements`);
  } finally {
    await closeTestServer(server);
  }
}

const post = (url: string, body: unknown, grants?: string) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(grants ? { "x-grants": grants } : {}) }, body: JSON.stringify(body) });

const kept = (id: string, over: Record<string, unknown> = {}) => ({
  id, org_id: ORG, provider: "ezpass", file_name: "June week 1.pdf", format: "pdf", byte_size: 2048, sha256: "a".repeat(64),
  storage_path: `${ORG}/${id}`, uploaded_by: USER, created_at: "2026-11-17T15:00:00Z",
  period_start: null, period_end: null, printed_total: null, read_at: null, removed_at: null, removed_by: null, remove_reason: null, ...over,
});

function seed(o: { stored?: Uint8Array | null; rows?: Record<string, unknown>[]; insertError?: unknown; updated?: unknown[] } = {}) {
  const rows = o.rows ?? [kept(NEW_ID, { file_name: "june.xlsx", format: "csv", byte_size: CSV.length, sha256: sha(CSV) })];
  rec = createSupabaseRecorder({
    tables: {
      toll_statements: (q) => {
        if (q.write?.method === "insert") return { data: [], writeError: o.insertError ?? null };
        if (q.write?.method === "update") return { data: o.updated ?? [{ file_name: "June week 1.pdf", provider: "ezpass" }] };
        return postgrestFixture(rows)(q);
      },
      user_profiles: [{ user_id: USER, full_name: "Bea Books" }],
    },
    storage: {
      createSignedUploadUrl: (path: string) => ({ data: { signedUrl: `https://storage.test/upload/${path}`, token: "t", path }, error: null }),
      createSignedUrl: (path: string) => ({ data: { signedUrl: `https://storage.test/read/${path}` }, error: null }),
      download: () => (o.stored === null ? { data: null, error: { message: "not found" } } : { data: new Blob([Buffer.from(o.stored ?? CSV)]), error: null }),
      remove: () => ({ data: [], error: null }),
    },
  });
}

const confirm = (over: Record<string, unknown> = {}) => ({
  fileId: NEW_ID, provider: "ezpass", fileName: "june.xlsx", byteSize: CSV.length, sha256: sha(CSV), ...over,
});
const removedBytes = () => rec.storageCalls().filter((c) => c.fn === "remove").map((c) => c.args[0]);
const EXEMPT = { exempt: ["user_profiles"] };

beforeEach(() => audit.writeAudit.mockClear());

describe("keeping a statement", () => {
  it("signs a place for the bytes under the org and writes nothing yet", async () => {
    seed();
    await withServer(async (url) => {
      const res = await post(`${url}/upload`, { provider: "ktag", fileName: "june.pdf", byteSize: 10 });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { fileId: string; uploadUrl: string };
      expect(body.uploadUrl).toBe(`https://storage.test/upload/${ORG}/${body.fileId}`);
    });
    expect(rec.writtenRows("toll_statements")).toHaveLength(0);
    expect(rec.storageCalls()[0]).toMatchObject({ bucket: "toll-statements", fn: "createSignedUploadUrl" });
  });

  it("keeps the file with the format its bytes show, not its name, and audits who kept it", async () => {
    seed();
    await withServer(async (url) => {
      const res = await post(url, confirm());
      expect(res.status).toBe(201);
      const body = (await res.json()) as { statement: { id: string; format: string; uploadedByName: string | null; readAt: string | null } };
      expect(body.statement).toMatchObject({ id: NEW_ID, format: "csv", uploadedByName: "Bea Books", readAt: null });
    });
    expect(rec.writtenRows("toll_statements")).toEqual([
      { id: NEW_ID, org_id: ORG, provider: "ezpass", file_name: "june.xlsx", format: "csv", byte_size: CSV.length, sha256: sha(CSV), storage_path: `${ORG}/${NEW_ID}`, uploaded_by: USER },
    ]);
    expect(audit.writeAudit).toHaveBeenCalledTimes(1);
    expect(audit.writeAudit.mock.calls[0]![1]).toMatchObject({ orgId: ORG, actorId: USER, action: "tolls.statement_uploaded", entityId: NEW_ID });
    expect(removedBytes()).toEqual([]);
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("refuses bytes that differ from the file picked, and deletes them", async () => {
    seed();
    await withServer(async (url) => {
      expect((await post(url, confirm({ sha256: "0".repeat(64) }))).status).toBe(422);
      expect((await post(url, confirm({ byteSize: CSV.length + 1 }))).status).toBe(422);
    });
    expect(removedBytes()).toEqual([[`${ORG}/${NEW_ID}`], [`${ORG}/${NEW_ID}`]]);
    expect(rec.writtenRows("toll_statements")).toHaveLength(0);
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  it("refuses a picture named like a statement, and deletes it", async () => {
    seed({ stored: JPEG });
    await withServer(async (url) => {
      const res = await post(url, confirm({ fileName: "june.pdf", byteSize: JPEG.length, sha256: sha(JPEG) }));
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_a_statement");
    });
    expect(removedBytes()).toEqual([[`${ORG}/${NEW_ID}`]]);
    expect(rec.writtenRows("toll_statements")).toHaveLength(0);
  });

  it("says when the file never arrived", async () => {
    seed({ stored: null });
    await withServer(async (url) => {
      const res = await post(url, confirm());
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("file_missing");
    });
  });

  it("refuses the same file twice by naming the copy already kept, and deletes the second", async () => {
    seed({ insertError: { code: "23505", message: "duplicate key" }, rows: [kept(OLD_ID, { file_name: "EZ June.csv", provider: "ezpass", sha256: sha(CSV) })] });
    await withServer(async (url) => {
      const res = await post(url, confirm());
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("already_uploaded");
      expect(body.error.message).toBe("This file is already on the list, as EZ June.csv under E-ZPass.");
    });
    expect(removedBytes()).toEqual([[`${ORG}/${NEW_ID}`]]);
    expect(audit.writeAudit).not.toHaveBeenCalled();
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("refuses PrePass before anything is signed", async () => {
    seed();
    await withServer(async (url) => {
      expect((await post(`${url}/upload`, { provider: "prepass", fileName: "x.pdf", byteSize: 10 })).status).toBe(400);
    });
    expect(rec.storageCalls()).toHaveLength(0);
  });
});

describe("the list", () => {
  it("returns every statement with who uploaded and who removed it, removed ones included", async () => {
    seed({
      rows: [
        kept(NEW_ID),
        kept(OLD_ID, { file_name: "wrong.pdf", created_at: "2026-11-16T15:00:00Z", removed_at: "2026-11-17T09:00:00Z", removed_by: USER, remove_reason: "another company's statement" }),
      ],
    });
    await withServer(async (url) => {
      const res = await fetch(url, { headers: { "x-grants": "accounting:view" } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { statements: Array<Record<string, unknown>> };
      expect(body.statements.map((s) => s.id)).toEqual([NEW_ID, OLD_ID]);
      expect(body.statements[1]).toMatchObject({ removedByName: "Bea Books", removeReason: "another company's statement", byteSize: 2048, printedTotal: null });
    });
    expectOrgScoped(rec, ORG, EXEMPT);
  });
});

describe("removing a wrong file", () => {
  it("records who and why on the org's own, still-counting row, and audits it", async () => {
    seed();
    await withServer(async (url) => {
      expect((await post(`${url}/${NEW_ID}/remove`, { reason: "wrong provider picked" })).status).toBe(200);
    });
    const update = rec.queries.find((q) => q.table === "toll_statements" && q.write?.method === "update")!;
    expect(update.write!.payload).toMatchObject({ removed_by: USER, remove_reason: "wrong provider picked" });
    expect(update.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "id", val: NEW_ID }, { col: "removed_at", val: null }]));
    expect(audit.writeAudit.mock.calls[0]![1]).toMatchObject({ action: "tolls.statement_removed", entityId: NEW_ID, meta: { reason: "wrong provider picked" } });
  });

  it("is a 404 for a statement already removed or not the org's", async () => {
    seed({ updated: [] });
    await withServer(async (url) => {
      expect((await post(`${url}/${NEW_ID}/remove`, { reason: "wrong provider picked" })).status).toBe(404);
    });
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  it("needs a reason", async () => {
    seed();
    await withServer(async (url) => {
      expect((await post(`${url}/${NEW_ID}/remove`, { reason: " " })).status).toBe(400);
    });
  });
});

describe("who may (D-TL11)", () => {
  it("lets accounting view read and open statements but not upload or remove them", async () => {
    seed();
    await withServer(async (url) => {
      expect((await fetch(url, { headers: { "x-grants": "accounting:view" } })).status).toBe(200);
      expect((await fetch(`${url}/${NEW_ID}/link`, { headers: { "x-grants": "accounting:view" } })).status).toBe(200);
      expect((await post(`${url}/upload`, { provider: "ktag", fileName: "a.pdf", byteSize: 10 }, "accounting:view")).status).toBe(403);
      expect((await post(url, confirm(), "accounting:view")).status).toBe(403);
      expect((await post(`${url}/${NEW_ID}/remove`, { reason: "wrong one" }, "accounting:view")).status).toBe(403);
    });
  });

  it("gives the keeper of the trucks' tags nothing here", async () => {
    seed();
    await withServer(async (url) => {
      expect((await fetch(url, { headers: { "x-grants": "equipment:manage" } })).status).toBe(403);
      expect((await post(`${url}/upload`, { provider: "ktag", fileName: "a.pdf", byteSize: 10 }, "equipment:manage")).status).toBe(403);
    });
  });
});
