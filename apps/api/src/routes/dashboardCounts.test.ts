import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext, DashboardComplianceCounts } from "@fuelguard/shared";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { closeTestServer } from "../testing/httpServer.js";

/**
 * `GET /api/dashboard/compliance-counts` (UI plan U2).
 *
 * Two things are pinned, and they are the two that would regress silently.
 *
 * **The projection.** These three counts span TWO capability sections while the dashboard itself is
 * ungated so drivers keep it. A role that may not view a section must get `null` — not 0, which is a
 * real count and a different claim, and not a 403, because the row simply renders less. Getting this
 * wrong leaks the fleet's regulatory exposure onto a driver's home page, and it leaks it QUIETLY.
 *
 * **Org scoping.** This route reads with the service role, which bypasses RLS, so `expectOrgScoped`
 * is the only layer that can catch a missing tenant filter.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

const ctx = (role: string, orgId: string | null = ORG): AuthContext =>
  ({ userId: `u-${role}`, email: `${role}@x.test`, orgId, role } as AuthContext);

const CTX: Record<string, AuthContext> = {
  admin: ctx("admin"),
  fleet: ctx("fleet_manager"),
  safety: ctx("safety_manager"),
  dispatcher: ctx("dispatcher"),
  recruiter: ctx("recruiter"),
  driver: ctx("driver"),
};

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const body = async (token: string): Promise<DashboardComplianceCounts> =>
  (await call(token)).json() as Promise<DashboardComplianceCounts>;

const call = (token?: string) =>
  fetch(`${baseUrl}/api/dashboard/compliance-counts`, {
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });

const APPLICANT = {
  id: DRIVER,
  full_name: "An Applicant",
  status: "applicant",
  hire_date: null,
  date_of_birth: null,
  created_at: "2026-01-01T00:00:00Z",
};

const seed = (): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      /**
       * Three different callers read `drivers` on this one request — the qualification overview, the
       * inquiry queue, and the applicant head-count — so the fixture answers by the FILTERS applied
       * rather than handing all three the same shape. The head-count asks PostgREST for `count` and
       * no rows, which is a different answer, and a fixture that ignored the distinction would let
       * the count silently read `null` while every other assertion passed.
       */
      drivers: (q) => {
        const applicantsOnly = q
          .filters()
          .some((f) => f.col === "status" && f.val === "applicant");
        return applicantsOnly ? { data: [APPLICANT], count: 1 } : { data: [APPLICANT] };
      },
      driver_employment_history: [],
      certifications: [],
      qualification_records: [],
      documents: [],
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
beforeEach(() => {
  rec = seed();
  holder.client = rec.client;
});
afterEach(() => vi.restoreAllMocks());

describe("the projection — null is not zero", () => {
  it("refuses an unauthenticated request", async () => {
    expect((await call()).status).toBe(401);
  });

  /** ⚠ The one that matters: a driver keeps the dashboard, and must learn nothing from it. */
  it("tells a driver nothing at all, in every field", async () => {
    const res = await call("driver");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      driversWithoutQualificationFile: null,
      overdueInvestigations: null,
      applicants: null,
    });
  });

  it("gives a dispatcher the qualification count and neither recruitment one", async () => {
    // `fleet: view` opens the §391.51 picture for load planning; `recruitment` is a different
    // section precisely so a dispatcher cannot read the hiring file (§391.53(a)(1)).
    const counts = await body("dispatcher");
    expect(counts.driversWithoutQualificationFile).not.toBeNull();
    expect(counts.overdueInvestigations).toBeNull();
    expect(counts.applicants).toBeNull();
  });

  it("gives a recruiter every field", async () => {
    const counts = await body("recruiter");
    expect(counts.driversWithoutQualificationFile).not.toBeNull();
    expect(counts.overdueInvestigations).not.toBeNull();
    expect(counts.applicants).not.toBeNull();
  });

  it("counts the applicant on the board rather than reporting zero", async () => {
    const counts = await body("admin");
    expect(counts.applicants).toBe(1);
  });
});

describe("org scoping — the service role bypasses RLS, so the filter has to be here", () => {
  it("scopes every query it makes to the caller's org", async () => {
    expect((await call("admin")).status).toBe(200);
    expectOrgScoped(rec, ORG);
  });

  /** A role that sees neither section must not cause a query at all — an unauthorised count should
   *  not exist in this process, let alone be dropped on the way out. */
  it("makes no query whatsoever for a driver", async () => {
    await call("driver");
    expect(rec.queries).toHaveLength(0);
  });
});
