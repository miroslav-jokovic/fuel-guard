import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@fuelguard/shared";
import { PSP_IMPORT_CONSENT_ATTESTATION } from "@fuelguard/shared";
import { createApp } from "../../app.js";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../testing/httpServer.js";

/**
 * The PSP import routes (P14) — one thing is pinned here and it is the ROLE BOUNDARY.
 *
 * The service's own rules are pinned in `services/pspImport.test.ts`. What only an HTTP test can
 * prove is who middleware refuses, and the interesting refusal is the fleet_manager: they MANAGE the
 * recruitment section, so every other route in this router admits them, and they are not a
 * §391.53(a)(1) reader — filing a PSP report would mean attesting to the consent behind a document
 * they may not open. The guard is the intersection of the two, and this is the test that fails if
 * somebody simplifies it back to `rolesThatManage("recruitment")`.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const DOC = "22222222-3333-4444-8555-666666666666";

const ctx = (role: string): AuthContext =>
  ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);

const CTX: Record<string, AuthContext> = {
  admin: ctx("admin"),
  fleet: ctx("fleet_manager"),
  safety: ctx("safety_manager"),
  dispatcher: ctx("dispatcher"),
  auditor: ctx("auditor"),
  recruiter: ctx("recruiter"),
  driver: ctx("driver"),
};

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const call = (path: string, init: RequestInit & { token?: string } = {}) => {
  const { token, ...rest } = init;
  return fetch(`${baseUrl}/api/recruitment${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
};

const seed = (): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      drivers: [{ id: DRIVER }],
      documents: [{ id: DOC, subject_type: "driver", subject_id: DRIVER, kind: "psp_report" }],
      // Read = the "already filed?" probe (empty), write = the insert's `.select().single()`.
      qualification_records: (q) => (q.write ? { data: [{ id: "rec-new" }], error: null } : { data: [], error: null }),
      audit_logs: [],
    },
    storage: {
      createSignedUploadUrl: () => ({ data: { signedUrl: "https://storage.test/put", token: "tok" }, error: null }),
    },
  });

const IMPORT_BODY = JSON.stringify({
  driver_id: DRIVER,
  document_id: DOC,
  obtained_on: "2025-06-02",
  consent_obtained: true,
});

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const found = CTX[t];
    if (!found) throw new Error("bad token");
    return found;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => closeTestServer(server));

describe("who may file a PSP record the carrier already bought", () => {
  it("lets the §391.53(a)(1) readers who manage recruitment file one", async () => {
    for (const token of ["admin", "safety", "recruiter"]) {
      rec = seed();
      holder.client = rec.client;
      const res = await call("/psp-imports", { method: "POST", token, body: IMPORT_BODY });
      expect(res.status).toBe(201);
    }
  });

  /**
   * The whole reason the guard is an intersection. A fleet_manager manages the recruitment section
   * and is refused here alone — `canReadInvestigationHistory` does not name them, and filing
   * evidence into a class you cannot open leaves your name on an attestation about a document you
   * are not permitted to read.
   */
  it("refuses the fleet_manager, who manages recruitment but may not read investigation history", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/psp-imports", { method: "POST", token: "fleet", body: IMPORT_BODY });
    expect(res.status).toBe(403);
    // Refused in middleware — nothing was registered, read or written.
    expect(rec.queries).toHaveLength(0);
    expect(rec.storageCalls()).toHaveLength(0);
  });

  it("refuses the roles outside the section entirely", async () => {
    for (const token of ["dispatcher", "auditor", "driver"]) {
      rec = seed();
      holder.client = rec.client;
      expect((await call("/psp-imports", { method: "POST", token, body: IMPORT_BODY })).status).toBe(403);
      expect((await call("/psp-imports/document", { method: "POST", token, body: JSON.stringify({ driver_id: DRIVER, document_id: DOC, sha256: "a".repeat(64) }) })).status).toBe(403);
    }
  });

  it("refuses an unauthenticated request", async () => {
    rec = seed();
    holder.client = rec.client;
    expect((await call("/psp-imports", { method: "POST", body: IMPORT_BODY })).status).toBe(401);
  });
});

describe("the request surface", () => {
  it("serves the attestation from the server, so nobody attests to client-authored words", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/psp-imports/attestation", { token: "recruiter" });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { attestation: string };
    expect(payload.attestation).toBe(PSP_IMPORT_CONSENT_ATTESTATION);
  });

  it("refuses a filing that does not assert the driver's consent", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/psp-imports", {
      method: "POST",
      token: "recruiter",
      body: JSON.stringify({ driver_id: DRIVER, document_id: DOC, obtained_on: "2025-06-02", consent_obtained: false }),
    });
    expect(res.status).toBe(400);
    expect(rec.writes()).toHaveLength(0);
  });

  it("registers the upload with the kind composed here, never sent by the client", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/psp-imports/document", {
      method: "POST",
      token: "recruiter",
      body: JSON.stringify({ driver_id: DRIVER, document_id: DOC, sha256: "b".repeat(64), kind: "other" }),
    });
    expect(res.status).toBe(201);
    expect(rec.writtenRows("documents")[0]!.kind).toBe("psp_report");
  });

  it("audits the filing as an import rather than a purchase", async () => {
    rec = seed();
    holder.client = rec.client;
    await call("/psp-imports", { method: "POST", token: "recruiter", body: IMPORT_BODY });
    const audit = rec.writtenRows("audit_logs")[0]!;
    expect(audit.action).toBe("compliance.psp_record_imported");
    expect((audit.meta as Record<string, unknown>).source).toBe("portal_import");
  });
});
