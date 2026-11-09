import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type RecorderTable, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The hire endpoint ("Close application", §14 D-OF5) — and the boundary that makes it interesting:
 * who may press it is the carrier's own switch, `recruitment.close_application` (owner, 2026-11-09:
 * "Safety and admin can close application, and this needs to be in Settings so we can select").
 * Shipped ON for the safety manager, always held by the admin, off for everybody else until the
 * carrier switches it on. Everybody who sees the board still reads the preview, which is where an
 * undated inquiry surfaces while there is still time to fix it.
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
  // A dispatcher this org granted roster AND recruitment manage: still not a closer — the switch decides.
  grantedDispatcher: { ...ctx("dispatcher"), sections: { roster: "manage", recruitment: "manage" } } as AuthContext,
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

/**
 * ⚠ An applicant the hire gate lets through (Q-HM5, D-HB5): the checklist's own evidence read — the
 * only one that selects the MVR's `jurisdiction` — sees the six federal gates and the handbook, and
 * the application is filed. `hireApplicant.test.ts` says why the fixture is keyed on the select.
 */
const READY = ["mvr", "clearinghouse_full", "drug_test", "medical_registry_verification", "road_test", "handbook"];
const seed = (
  evidence: string[] = READY,
  permissionRows: RecorderTable | unknown[] = [],
): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      org_role_permissions: permissionRows,
      drivers: [{ id: DRIVER, full_name: "An Applicant", status: "applicant", hire_date: null }],
      application_invitations: [{ id: "inv-1", created_at: "2026-08-01T00:00:00Z", submitted_at: "2026-08-10T00:00:00Z" }],
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
      qualification_records: (q: RecordedQuery) =>
        String(q.ops.find((o) => o.method === "select")?.args[0] ?? "").includes("jurisdiction")
          ? evidence.map((kind) => ({ driver_id: DRIVER, kind, occurred_on: "2026-08-20", ...(kind === "road_test" ? { source: "road_test" } : {}) })) // A-8: a ceremony road test
          : [],
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

const CLOSE = "recruitment.close_application";
/** Refused in middleware: nothing but the switch read, nothing filed, nothing audited. */
const expectNothingDone = (r: SupabaseRecorder) => {
  expect(r.queries.map((q) => q.table)).toEqual(["org_role_permissions"]);
  expect(r.rpcs()).toHaveLength(0);
};

describe("who may close an application", () => {
  it("lets the admin and the safety manager close, as shipped", async () => {
    for (const token of ["admin", "safety"]) {
      rec = seed();
      holder.client = rec.client;
      expect((await call("/hire", { method: "POST", token, body: HIRE })).status).toBe(200);
    }
  });

  it("refuses the fleet manager and the recruiter until the carrier switches it on", async () => {
    for (const token of ["fleet", "recruiter"]) {
      rec = seed();
      holder.client = rec.client;
      const res = await call("/hire", { method: "POST", token, body: HIRE });
      expect(res.status).toBe(403);
      expectNothingDone(rec);
    }
  });

  it("lets a recruiter close once the carrier switched it on for recruiters", async () => {
    rec = seed(READY, [{ role: "recruiter", permission: CLOSE, allowed: true }]);
    holder.client = rec.client;
    expect((await call("/hire", { method: "POST", token: "recruiter", body: HIRE })).status).toBe(200);
  });

  it("refuses the safety manager once the carrier switched it off for them", async () => {
    rec = seed(READY, [{ role: "safety_manager", permission: CLOSE, allowed: false }]);
    holder.client = rec.client;
    expect((await call("/hire", { method: "POST", token: "safety", body: HIRE })).status).toBe(403);
    expectNothingDone(rec);
  });

  it("does not hand the close to a role the org gave roster manage — the switch is the gate, not the roster", async () => {
    rec = seed();
    holder.client = rec.client;
    expect((await call("/hire", { method: "POST", token: "grantedDispatcher", body: HIRE })).status).toBe(403);
  });

  it("refuses everybody but the admin when the switches cannot be read", async () => {
    for (const [token, status] of [["safety", 403], ["admin", 200]] as const) {
      rec = seed(READY, { data: null, error: { message: "boom" } });
      holder.client = rec.client;
      expect((await call("/hire", { method: "POST", token, body: HIRE })).status).toBe(status);
    }
  });

  it("refuses the safety manager when the database client itself throws reading the switches", async () => {
    holder.client = { from: () => { throw new Error("client down"); } };
    expect((await call("/hire", { method: "POST", token: "safety", body: HIRE })).status).toBe(403);
  });

  it("still lets the recruiter see what closing would file", async () => {
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

  it("refuses a read-only auditor's close while letting them read the preview", async () => {
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
    const res = await call("/hire", { method: "POST", token: "safety", body: HIRE });
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
    const res = await call("/hire", { method: "POST", token: "safety", body: HIRE });
    expect(res.status).toBe(409);
    expect(rec.rpcs()).toHaveLength(0);
  });

  /**
   * Q-HM5 + D-HB5 through the mount: the refusal is a 409 with the steps named beside the envelope,
   * so the screen can list them — and no audit row, because nothing was hired.
   */
  it("answers 409 naming the drug test when it is not on file, and hires nobody", async () => {
    rec = seed(READY.filter((k) => k !== "drug_test"));
    holder.client = rec.client;
    const res = await call("/hire", { method: "POST", token: "safety", body: HIRE });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string }; missing: string[] };
    expect(body.error.code).toBe("not_ready_to_hire");
    expect(body.missing).toEqual(["drug_test"]);
    expect(rec.rpcs()).toHaveLength(0);
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });
});

describe("the service role, through the route", () => {
  it("scopes every read and write of a hire to the caller's org", async () => {
    rec = seed();
    holder.client = rec.client;
    expect((await call("/hire", { method: "POST", token: "safety", body: HIRE })).status).toBe(200);
    expectOrgScoped(rec, ORG);
  });

  it("scopes the preview too", async () => {
    rec = seed();
    holder.client = rec.client;
    expect((await call(`/drivers/${DRIVER}/hire-preview`, { token: "recruiter" })).status).toBe(200);
    expectOrgScoped(rec, ORG);
  });
});
