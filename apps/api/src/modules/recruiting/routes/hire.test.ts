import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The hire endpoint — and the boundary that makes it interesting: a RECRUITER, who owns everything
 * up to this moment, may not press it.
 *
 * `drivers.status` starts the §391.51(c) retention clock and decides driver-app access, so 0213
 * refuses a recruiter's status change in a trigger and `canWriteDriverLifecycle` refuses it in the
 * matrix. If this route admitted them, the API would authorise a call its own database then blocks.
 * They get the preview instead, which is where an undated inquiry surfaces while there is still
 * time to fix it.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

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
      drivers: [{ id: DRIVER, full_name: "An Applicant", status: "applicant" }],
      driver_employment_history: [
        {
          id: "emp-1",
          employer_name: "Old Carrier",
          usdot_number: "123456",
          dot_regulated: true,
          inquiry_status: "responded",
          inquiry_sent_on: "2026-07-01",
          inquiry_response_on: "2026-07-14",
        },
      ],
      qualification_records: [],
      audit_logs: [],
    },
    rpc: { hire_applicant: { status: "active", hire_date: "2026-09-01", filed: 2 } },
  });

const HIRE = JSON.stringify({ driver_id: DRIVER, hire_date: "2026-09-01" });

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

describe("who may hire", () => {
  it("lets the roles that own the employment lifecycle hire", async () => {
    for (const token of ["admin", "fleet", "safety"]) {
      rec = seed();
      holder.client = rec.client;
      const res = await call("/hire", { method: "POST", token, body: HIRE });
      expect(res.status).toBe(200);
    }
  });

  it("refuses the recruiter, who owns every step up to this one", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/hire", { method: "POST", token: "recruiter", body: HIRE });
    expect(res.status).toBe(403);
    // Refused in middleware — nothing read, nothing filed.
    expect(rec.queries).toHaveLength(0);
  });

  it("still lets the recruiter see what hiring would file", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call(`/drivers/${DRIVER}/hire-preview`, { token: "recruiter" });
    expect(res.status).toBe(200);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses the roles outside the section, and the unauthenticated", async () => {
    for (const token of ["dispatcher", "driver"]) {
      rec = seed();
      holder.client = rec.client;
      expect((await call("/hire", { method: "POST", token, body: HIRE })).status).toBe(403);
      expect((await call(`/drivers/${DRIVER}/hire-preview`, { token })).status).toBe(403);
    }
    rec = seed();
    holder.client = rec.client;
    expect((await call("/hire", { method: "POST", body: HIRE })).status).toBe(401);
  });

  it("refuses a read-only auditor's hire while letting them read the preview", async () => {
    rec = seed();
    holder.client = rec.client;
    expect((await call("/hire", { method: "POST", token: "auditor", body: HIRE })).status).toBe(403);
    expect((await call(`/drivers/${DRIVER}/hire-preview`, { token: "auditor" })).status).toBe(200);
  });
});

describe("what the hire records", () => {
  it("audits the hire with what it filed and what it could not", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/hire", { method: "POST", token: "fleet", body: HIRE });
    expect(res.status).toBe(200);

    const audit = rec.writtenRows("audit_logs")[0]!;
    expect(audit.action).toBe("compliance.applicant_hired");
    const meta = audit.meta as Record<string, unknown>;
    expect(meta.hireDate).toBe("2026-09-01");
    expect(meta.filed).toBe(2);
    // The gap goes in the log too: an entry that recorded only the success would make what the file
    // still lacks look like something nobody was told about.
    expect(meta.outstanding).toContain("employment_application");
  });

  it("answers 409 when somebody has already been hired", async () => {
    rec = createSupabaseRecorder({
      tables: {
        drivers: [{ id: DRIVER, status: "active" }],
        driver_employment_history: [],
        qualification_records: [],
        audit_logs: [],
      },
    });
    holder.client = rec.client;
    const res = await call("/hire", { method: "POST", token: "fleet", body: HIRE });
    expect(res.status).toBe(409);
    expect(rec.rpcs()).toHaveLength(0);
  });
});
