import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The office's side of an applicant's consent to be texted (SMS-OPT-IN-PLAN SMS4).
 *
 * Pinned: a reader may see the status and may not stop it; a stop revokes every live number in the
 * caller's org and is audited without the number; and there is no route that grants.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

const ctx = (role: string): AuthContext =>
  ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = { recruiter: ctx("recruiter"), auditor: ctx("auditor") };

let server: Server;
let baseUrl: string;
const call = (path: string, token: string | null, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/recruitment/applicants/${DRIVER}/sms-consent${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });

const seed = (consents: Record<string, unknown>[]) =>
  createSupabaseRecorder({ tables: { sms_consents: consents, audit_logs: [] }, rpc: { revoke_sms_consent: 1 } });

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

describe("reading", () => {
  it("shows a reader four digits and a date, scoped to their org", async () => {
    const rec = seed([{ phone: "+17082365732", granted_at: "2026-09-25T10:00:00Z", revoked_at: null }]);
    holder.client = rec.client;
    const res = await call("", "auditor");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: Record<string, unknown> };
    expect(body.status).toMatchObject({ state: "agreed", phoneLast4: "5732", grantedAt: "2026-09-25T10:00:00Z" });
    expect(JSON.stringify(body)).not.toContain("7082365732");
    expectOrgScoped(rec, ORG);
  });

  it("refuses the unauthenticated", async () => {
    holder.client = seed([]).client;
    expect((await call("", null)).status).toBe(401);
  });
});

describe("recording a stop asked for off-text", () => {
  it("revokes every live number in the caller's org, and audits a count, never the number", async () => {
    const rec = seed([{ phone: "+17082365732", granted_at: "2026-09-25T10:00:00Z", revoked_at: null }]);
    holder.client = rec.client;
    const res = await call("/withdraw", "recruiter", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);

    const [revoke] = rec.rpcs().filter((r) => r.fn === "revoke_sms_consent");
    expect(revoke!.args).toMatchObject({ p_org: ORG, p_phone: "+17082365732" });
    expect(String((revoke!.args as { p_reason: string }).p_reason)).toContain("u-recruiter");
    const [audit] = rec.writtenRows("audit_logs");
    expect(audit).toMatchObject({ action: "compliance.sms_consent_withdrawn", entity_id: DRIVER });
    expect(JSON.stringify(audit)).not.toContain("7082365732");
    expectOrgScoped(rec, ORG);
  });

  it("answers 409 when there is nothing to stop, and audits nothing", async () => {
    const rec = seed([]);
    holder.client = rec.client;
    const res = await call("/withdraw", "recruiter", { method: "POST", body: "{}" });
    expect(res.status).toBe(409);
    expect(rec.writtenRows("audit_logs")).toEqual([]);
  });

  it("refuses a reader", async () => {
    const rec = seed([{ phone: "+17082365732", granted_at: "2026-09-25T10:00:00Z", revoked_at: null }]);
    holder.client = rec.client;
    expect((await call("/withdraw", "auditor", { method: "POST", body: "{}" })).status).toBe(403);
    expect(rec.rpcs()).toHaveLength(0);
  });

  /** D-SMS3: a consent is the applicant's own act. The office has no road to one. */
  it("has no route that grants", async () => {
    holder.client = seed([]).client;
    const res = await call("", "recruiter", { method: "POST", body: JSON.stringify({ phone: "7082365732", agreed: true }) });
    expect(res.status).toBe(404);
  });
});
