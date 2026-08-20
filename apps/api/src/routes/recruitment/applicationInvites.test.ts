import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@fuelguard/shared";
import { createApp } from "../../app.js";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../testing/httpServer.js";

/**
 * Inviting an applicant. The interesting assertions are all about the token: it is returned exactly
 * once, it never reaches the database in the clear, and it never reaches the audit log at all.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

const ctx = (role: string): AuthContext =>
  ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = {
  admin: ctx("admin"),
  recruiter: ctx("recruiter"),
  safety: ctx("safety_manager"),
  dispatcher: ctx("dispatcher"),
  auditor: ctx("auditor"),
};

let server: Server;
let baseUrl: string;

const call = (path: string, init: RequestInit & { token?: string } = {}) =>
  fetch(`${baseUrl}/api/recruitment${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

const seed = (status = "applicant"): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      drivers: [{ id: DRIVER, status }],
      application_invitations: [{ id: "inv-1", driver_id: DRIVER, expires_at: "2099-01-01T00:00:00Z" }],
      audit_logs: [],
    },
  });

const BODY = JSON.stringify({ driver_id: DRIVER, email: "s@example.test" });

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

describe("creating an invitation", () => {
  it("returns the only copy of the link and stores only a hash", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("/application-invites", { method: "POST", token: "recruiter", body: BODY });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { link: string };
    const token = body.link.split("/apply/")[1]!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const row = rec.writtenRows("application_invitations")[0]!;
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    // The plaintext must appear nowhere in what was written.
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("keeps the token and its hash out of the audit log", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("/application-invites", { method: "POST", token: "recruiter", body: BODY });
    const token = ((await res.json()) as { link: string }).link.split("/apply/")[1]!;

    const audit = rec.writtenRows("audit_logs")[0]!;
    expect(audit.action).toBe("compliance.application_invited");
    const serialised = JSON.stringify(audit);
    expect(serialised).not.toContain(token);
    // An audit log is the last place a credential should be recoverable from — including by
    // fingerprint, which is what a hash is.
    expect(serialised).not.toMatch(/[0-9a-f]{64}/);
  });

  it("gives two invitations two different tokens", async () => {
    const links: string[] = [];
    for (let i = 0; i < 2; i++) {
      holder.client = seed().client;
      const res = await call("/application-invites", { method: "POST", token: "recruiter", body: BODY });
      links.push(((await res.json()) as { link: string }).link);
    }
    expect(links[0]).not.toBe(links[1]);
  });

  /** An application is what somebody submits BEFORE they are hired. */
  it("refuses to send the form to someone already driving here", async () => {
    const rec = seed("active");
    holder.client = rec.client;
    const res = await call("/application-invites", { method: "POST", token: "recruiter", body: BODY });
    expect(res.status).toBe(409);
    expect(rec.writtenRows("application_invitations")).toHaveLength(0);
  });

  it("scopes every read to the caller's org", async () => {
    const rec = seed();
    holder.client = rec.client;
    await call("/application-invites", { method: "POST", token: "recruiter", body: BODY });
    expectOrgScoped(rec, ORG);
  });
});

describe("who may invite", () => {
  it("admits the section's managers", async () => {
    for (const token of ["admin", "recruiter", "safety"]) {
      holder.client = seed().client;
      expect((await call("/application-invites", { method: "POST", token, body: BODY })).status).toBe(201);
    }
  });

  it("refuses a dispatcher, a read-only auditor and the unauthenticated", async () => {
    for (const token of ["dispatcher", "auditor"]) {
      holder.client = seed().client;
      expect((await call("/application-invites", { method: "POST", token, body: BODY })).status).toBe(403);
    }
    holder.client = seed().client;
    expect((await call("/application-invites", { method: "POST", body: BODY })).status).toBe(401);
  });
});

describe("revoking", () => {
  it("closes an open invitation and audits it", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("/application-invites/inv-1/revoke", { method: "POST", token: "recruiter" });
    expect(res.status).toBe(200);
    expect(rec.writtenRows("audit_logs")[0]!.action).toBe("compliance.application_invite_revoked");
  });
});
