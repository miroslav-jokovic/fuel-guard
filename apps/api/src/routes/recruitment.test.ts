import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@fuelguard/shared";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { closeTestServer } from "../testing/httpServer.js";

/**
 * Recruitment routes — §391.21(b)(10) employment history (0208).
 *
 * Two things are pinned here and they are the two that regress silently. First the SECURITY
 * boundary: who is refused before a query runs, decided entirely in middleware, which is what breaks
 * when somebody copies a router. Second ORG SCOPING: this router reads with the service role, which
 * bypasses RLS, so `expectOrgScoped` is the only layer that can catch a missing tenant filter here —
 * the behavioural matrix proves policies, not application code.
 *
 * The roster case additionally proves the fleet table's arithmetic comes from `employmentCoverage`
 * rather than from a second approximation of it in SQL, which is the way a fleet queue and a driver
 * page come to disagree about one driver.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "11111111-2222-4333-8444-555555555555";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const ROW = "22222222-3333-4444-8555-666666666666";

const ctx = (role: string, orgId: string | null = ORG): AuthContext =>
  ({ userId: `u-${role}`, email: `${role}@x.test`, orgId, role } as AuthContext);

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

/** A driver hired 2026-01-01 whose only declared employer left a year-long hole before the hire. */
const seed = (over: { drivers?: unknown[]; history?: unknown[] } = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      drivers: over.drivers ?? [
        { id: DRIVER, full_name: "A Driver", status: "active", hire_date: "2026-01-01", date_of_birth: null },
      ],
      driver_employment_history: over.history ?? [
        {
          id: ROW,
          driver_id: DRIVER,
          employer_name: "Old Carrier",
          started_on: "2022-01-01",
          ended_on: "2024-06-01",
          dot_regulated: true,
          inquiry_status: "pending",
        },
      ],
      audit_logs: [],
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
afterEach(() => vi.restoreAllMocks());

describe("gating — the fleet section matrix decides, not a hand-written role list", () => {
  it("refuses an unauthenticated request", async () => {
    rec = seed();
    holder.client = rec.client;
    expect((await call("/roster")).status).toBe(401);
  });

  it("lets the hiring roles and the auditor read", async () => {
    for (const token of ["admin", "fleet", "safety", "recruiter", "auditor"]) {
      rec = seed();
      holder.client = rec.client;
      expect((await call("/roster", { token })).status).toBe(200);
    }
  });

  /**
   * The reason `recruitment` is its own section rather than a corner of `fleet`. A dispatcher reads
   * Fleet to see who is on which truck; that is not a reason to read where somebody worked in 2022,
   * and §391.53(a)(1) puts the investigation history with those making the hiring decision. Gated on
   * `fleet` — how this first shipped — both of these were 200.
   */
  it("refuses the dispatcher and the driver, who can both read Fleet", async () => {
    for (const token of ["dispatcher", "driver"]) {
      rec = seed();
      holder.client = rec.client;
      expect((await call("/roster", { token })).status).toBe(403);
      expect((await call(`/drivers/${DRIVER}/employment`, { token })).status).toBe(403);
      // Refused in middleware — no query ran at all.
      expect(rec.queries).toHaveLength(0);
    }
  });

  it("lets the recruiter write — this is their section", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/employment", {
      method: "POST",
      token: "recruiter",
      body: JSON.stringify({ driver_id: DRIVER, employer_name: "X", started_on: "2024-01-01" }),
    });
    expect(res.status).toBe(201);
  });

  it("refuses a WRITE from a role that may only view", async () => {
    for (const token of ["dispatcher", "auditor", "driver"]) {
      rec = seed();
      holder.client = rec.client;
      const res = await call("/employment", {
        method: "POST",
        token,
        body: JSON.stringify({ driver_id: DRIVER, employer_name: "X", started_on: "2024-01-01" }),
      });
      expect(res.status).toBe(403);
    }
  });
});

describe("org scoping — the service role bypasses RLS, so the query must scope itself", () => {
  it("scopes every read behind the fleet roster", async () => {
    rec = seed();
    holder.client = rec.client;
    await call("/roster", { token: "admin" });
    expectOrgScoped(rec, ORG);
  });

  it("scopes one driver's employment read", async () => {
    rec = seed();
    holder.client = rec.client;
    await call(`/drivers/${DRIVER}/employment`, { token: "admin" });
    expectOrgScoped(rec, ORG);
    const q = rec.forTable("driver_employment_history")[0]!;
    expect(q.filters()).toContainEqual({ col: "driver_id", val: DRIVER });
  });

  it("refuses to hang an employer off another org's driver", async () => {
    // The driver lookup comes back empty because it is org-filtered — which is the point: without
    // that filter the insert would succeed and produce an org-scoped row about somebody else's driver.
    rec = createSupabaseRecorder({ tables: { drivers: [], driver_employment_history: [], audit_logs: [] } });
    holder.client = rec.client;
    const res = await call("/employment", {
      method: "POST",
      token: "admin",
      body: JSON.stringify({ driver_id: DRIVER, employer_name: "X", started_on: "2024-01-01" }),
    });
    expect(res.status).toBe(404);
    expect(rec.writtenRows("driver_employment_history")).toHaveLength(0);
    expectOrgScoped(rec, ORG);
  });

  it("stamps the caller's org on the insert rather than trusting the body", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/employment", {
      method: "POST",
      token: "fleet",
      body: JSON.stringify({
        driver_id: DRIVER,
        employer_name: "New Carrier",
        started_on: "2024-06-01",
        usdot_number: "1234567",
      }),
    });
    expect(res.status).toBe(201);
    const written = rec.writtenRows("driver_employment_history")[0]!;
    expect(written.org_id).toBe(ORG);
    expect(written.org_id).not.toBe(OTHER_ORG);
    // Every write is audited, with the compliance-relevant facts and nothing else.
    const audit = rec.writtenRows("audit_logs")[0]!;
    expect(audit.action).toBe("compliance.employment_recorded");
    expect((audit.meta as Record<string, unknown>).employer).toBe("New Carrier");
  });
});

describe("the fleet roster reports the SAME arithmetic the driver page does", () => {
  it("measures the window from the hire date, and reports the gap it leaves", async () => {
    rec = seed();
    holder.client = rec.client;
    const body = (await (await call("/roster", { token: "admin" })).json()) as {
      drivers: Array<Record<string, number | boolean>>;
    };
    const row = body.drivers[0]!;
    // Window is 2023-01-01 → 2026-01-01 (the hire date). The employer covers it until 2024-06-01,
    // so the remainder is an unexplained gap — and measuring against TODAY instead would have
    // invented eight more months of it.
    expect(row.employers_in_window).toBe(1);
    expect(row.gap_days).toBeGreaterThan(500);
    expect(row.inquiries_outstanding).toBe(1);
    // The value never leaves the roster API; only whether the driver can be screened at all.
    expect(row.date_of_birth_recorded).toBe(false);
  });

  it("reports a driver with no history recorded as empty rather than as one enormous gap count", async () => {
    rec = seed({ history: [] });
    holder.client = rec.client;
    const body = (await (await call("/roster", { token: "admin" })).json()) as {
      drivers: Array<Record<string, number>>;
    };
    expect(body.drivers[0]!.employers).toBe(0);
    expect(body.drivers[0]!.inquiries_outstanding).toBe(0);
  });
});

describe("contract", () => {
  it("refuses an end date before the start date, with a sentence rather than a 500", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/employment", {
      method: "POST",
      token: "admin",
      body: JSON.stringify({
        driver_id: DRIVER,
        employer_name: "X",
        started_on: "2024-06-01",
        ended_on: "2024-01-01",
      }),
    });
    expect(res.status).toBe(400);
    expect(rec.writtenRows("driver_employment_history")).toHaveLength(0);
  });

  it("refuses a USDOT number that is not digits", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/employment", {
      method: "POST",
      token: "admin",
      body: JSON.stringify({
        driver_id: DRIVER,
        employer_name: "X",
        started_on: "2024-01-01",
        usdot_number: "MC-1234",
      }),
    });
    expect(res.status).toBe(400);
  });
});
