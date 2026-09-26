import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The handbook's office doors (HANDBOOK-SIGNING-PLAN.md HB3), through the mount. The services are
 * pinned in `representatives.test.ts` and `handbookSigning.test.ts`; what only this can see is the
 * section gate, the status each refusal becomes, and that each act is audited.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const REP = "11111111-2222-4333-8444-555555555555";
const INV = "33333333-4444-4555-8666-777777777777";

const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = { admin: ctx("admin"), recruiter: ctx("recruiter"), dispatcher: ctx("dispatcher") };

let server: Server;
let baseUrl: string;

const send = (method: string, path: string, token: string, body?: unknown) =>
  fetch(`${baseUrl}/api/recruitment${path}`, {
    method,
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const seed = (over: Record<string, unknown> = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      carrier_representatives: [{ id: REP, full_name: "Miroslav Jokovic", title: "Safety manager", created_at: "t" }],
      application_invitations: [{ id: "inv-1", submitted_at: null, handbook_signing_opened_at: null, handbook_filed_at: null }],
      handbook_marks: [],
      audit_logs: [],
      ...over,
    },
    storage: {
      upload: async () => ({ data: {}, error: null }),
      download: async () => ({ data: null, error: { message: "none" } }),
    },
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

describe("the Representatives (D-HB3)", () => {
  it("adds one and audits the name and title, never the image", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await send("POST", "/representatives", "recruiter", { full_name: "Miroslav Jokovic", title: "Safety manager", signature_png: PNG });
    expect(res.status).toBe(201);
    const [audit] = rec.writtenRows("audit_logs");
    expect(audit).toMatchObject({ action: "compliance.representative_added" });
    expect(JSON.stringify(audit)).not.toContain("base64");
  });

  it("answers 409 for one who has countersigned, and audits nothing", async () => {
    const rec = seed({ carrier_representatives: { writeError: { code: "23001", message: "restrict" } } });
    holder.client = rec.client;
    const res = await send("DELETE", `/representatives/${REP}`, "admin");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("has_signed");
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });

  it("refuses a role that does not manage recruitment", async () => {
    holder.client = seed().client;
    const res = await send("POST", "/representatives", "dispatcher", { full_name: "A B", title: "T T", signature_png: PNG });
    expect(res.status).toBe(403);
  });
});

describe("the handbook's two office acts", () => {
  it("answers 409 to Open before the application is filed", async () => {
    holder.client = seed().client;
    const res = await send("POST", `/applicants/${DRIVER}/handbook/open`, "recruiter");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("application_not_filed");
  });

  it("opens a filed application's handbook and audits who opened it", async () => {
    const rec = seed({ application_invitations: [{ id: "inv-1", submitted_at: "2026-09-25T10:00:00Z", handbook_signing_opened_at: null, handbook_filed_at: null }] });
    holder.client = rec.client;
    const res = await send("POST", `/applicants/${DRIVER}/handbook/open`, "recruiter");
    expect(res.status).toBe(200);
    expect(rec.writtenRows("audit_logs")[0]).toMatchObject({ action: "compliance.handbook_signing_opened", actor_id: "u-recruiter" });
  });

  it("extends an opened handbook's link on a second press, and audits the invitation and the new expiry only (A-2)", async () => {
    const rec = seed({
      application_invitations: [{
        id: INV, submitted_at: "2026-09-14T10:00:00Z", handbook_signing_opened_at: "2026-09-25T20:08:00Z",
        handbook_filed_at: null, expires_at: "2026-09-28T18:00:00.000Z",
      }],
    });
    holder.client = rec.client;
    const res = await send("POST", `/applicants/${DRIVER}/handbook/open`, "recruiter");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { expiresAt: string; extended: boolean };
    expect(body.extended).toBe(true);
    const extended = rec.writtenRows("audit_logs").find((a) => a.action === "recruiting.handbook_link_extended");
    expect(extended).toMatchObject({ entity: "application_invitations", entity_id: INV, meta: { expiresAt: body.expiresAt } });
    expect(Object.keys(extended!.meta as object)).toEqual(["expiresAt"]);
  });

  it("answers 409 link_expired, with words, when the carrier's mark meets a lapsed link (HB021)", async () => {
    holder.client = seed({
      application_invitations: [{
        id: INV, submitted_at: "2026-09-14T10:00:00Z", handbook_signing_opened_at: "2026-09-25T20:08:00Z",
        handbook_filed_at: null, expires_at: "2026-09-20T00:00:00.000Z",
      }],
      handbook_marks: (q: { write: boolean }) =>
        q.write
          ? { writeError: { code: "HB021", message: "handbook_invitation_unusable" } }
          : ["h1", "h2", "h3", "h4", "h5"].map((placement_id) => ({ placement_id })),
    }).client;
    const res = await send("POST", `/applicants/${DRIVER}/handbook/countersign`, "admin", { representative_id: REP });
    expect(res.status).toBe(409);
    const { error } = (await res.json()) as { error: { code: string; message: string } };
    expect(error.code).toBe("link_expired");
    expect(error.message).toContain("Extend the driver's link");
  });

  it("answers 409 to Countersign before signing was opened", async () => {
    holder.client = seed({ application_invitations: [{ id: "inv-1", submitted_at: "2026-09-25T10:00:00Z", handbook_signing_opened_at: null, handbook_filed_at: null }] }).client;
    const res = await send("POST", `/applicants/${DRIVER}/handbook/countersign`, "admin", { representative_id: REP });
    expect(res.status).toBe(409);
  });
});
