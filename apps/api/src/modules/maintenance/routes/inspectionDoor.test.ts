import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The §396.17 inspection endpoints — the DOOR gate (plan step A4).
 *
 * No test in this suite mocks Supabase (the house rule `archive.test.ts` states): a 200 here would
 * be an assertion against a fake database and would prove nothing about the real one. What is pinned
 * is the boundary decided in middleware, before any query runs.
 *
 * The role sets are DERIVED — `rolesThatManage("maintenance")` and `rolesThatCanView("maintenance")`
 * — so this file's job is not to restate them but to prove the derivation was actually wired to
 * these routes. The `technician` cases are the ones that matter: 0279 added the role and 0280's
 * policies trust it, and if the router had been left on a hand-listed set the person the whole
 * feature is for would be locked out of it while every test about the matrix still passed.
 */

let server: Server;
let baseUrl: string;
let errorLog: ReturnType<typeof vi.spyOn>;

const CTX: Record<string, AuthContext> = {
  admin: { userId: "u-admin", email: "a@silvicominc.com", orgId: "org-1", role: "admin" },
  fleet: { userId: "u-fm", email: "f@silvicominc.com", orgId: "org-1", role: "fleet_manager" },
  technician: { userId: "u-tech", email: "t@silvicominc.com", orgId: "org-1", role: "technician" },
  auditor: { userId: "u-aud", email: "x@silvicominc.com", orgId: "org-1", role: "auditor" },
  accountant: { userId: "u-acc", email: "c@silvicominc.com", orgId: "org-1", role: "accountant" },
  safety: { userId: "u-sm", email: "s@silvicominc.com", orgId: "org-1", role: "safety_manager" },
  dispatcher: { userId: "u-disp", email: "p@silvicominc.com", orgId: "org-1", role: "dispatcher" },
  recruiter: { userId: "u-rec", email: "r@silvicominc.com", orgId: "org-1", role: "recruiter" },
  driver: { userId: "u-drv", email: "d@silvicominc.com", orgId: "org-1", role: "driver" },
  pending: { userId: "u-new", email: "n@silvicominc.com", orgId: null, role: null },
};

beforeAll(async () => {
  // The "passes the door" cases reach the handler, which calls getSupabaseAdmin() and throws —
  // there is no DB in the test env and we do not mock one. That IS the expected outcome (it proves
  // the request got past the guards); silencing stderr keeps the real signal visible in `pnpm test`.
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const ctx = CTX[t];
    if (!ctx) throw new Error("bad token");
    return ctx;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  errorLog.mockRestore();
  await closeTestServer(server);
});

const call = (path: string, init: RequestInit & { token?: string } = {}) => {
  const { token, ...rest } = init;
  return fetch(`${baseUrl}/api/maintenance${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
};

const ID = "11111111-1111-4111-8111-111111111111";
const NEW_DRAFT = JSON.stringify({
  id: ID,
  subjectType: "tractor",
  subjectId: "22222222-2222-4222-8222-222222222222",
  inspectorId: "33333333-3333-4333-8333-333333333333",
  inspectedOn: "2026-06-16",
});

const MANAGERS = ["admin", "fleet", "technician"];
const VIEWERS = ["auditor", "accountant"];
const OUTSIDERS = ["safety", "dispatcher", "recruiter", "driver"];

describe("POST /api/maintenance/inspections — the write door", () => {
  it("401 unauthenticated", async () => {
    expect((await call("/inspections", { method: "POST", body: NEW_DRAFT })).status).toBe(401);
  });

  it("403 for a user with no org membership yet", async () => {
    expect((await call("/inspections", { method: "POST", body: NEW_DRAFT, token: "pending" })).status).toBe(403);
  });

  it.each(MANAGERS)("passes the door for %s", async (token) => {
    const res = await call("/inspections", { method: "POST", body: NEW_DRAFT, token });
    expect([401, 403]).not.toContain(res.status);
  });

  // The readers may look and may not sign. That split is the whole reason `maintenance` has a view
  // level at all: a DOT auditor reads the file, a bookkeeper reads the spend behind it.
  it.each([...VIEWERS, ...OUTSIDERS])("403 for %s — reading is not certifying", async (token) => {
    expect((await call("/inspections", { method: "POST", body: NEW_DRAFT, token })).status).toBe(403);
  });
});

describe("PATCH /api/maintenance/inspections/:id — the same door", () => {
  it.each(MANAGERS)("passes for %s", async (token) => {
    const res = await call(`/inspections/${ID}`, { method: "PATCH", body: "{}", token });
    expect([401, 403]).not.toContain(res.status);
  });
  it.each([...VIEWERS, ...OUTSIDERS])("403 for %s", async (token) => {
    expect((await call(`/inspections/${ID}`, { method: "PATCH", body: "{}", token })).status).toBe(403);
  });
});

describe("GET /api/maintenance/inspections — the read door", () => {
  it("401 unauthenticated", async () => {
    expect((await call("/inspections")).status).toBe(401);
  });

  it.each([...MANAGERS, ...VIEWERS])("passes for %s", async (token) => {
    expect([401, 403]).not.toContain((await call("/inspections", { token })).status);
  });

  it.each(OUTSIDERS)("403 for %s — the shop is not their section", async (token) => {
    expect((await call("/inspections", { token })).status).toBe(403);
  });
});

describe("POST /api/maintenance/inspections/:id/finalize — certifying is a write", () => {
  it("401 unauthenticated", async () => {
    expect((await call(`/inspections/${ID}/finalize`, { method: "POST" })).status).toBe(401);
  });

  it.each(MANAGERS)("passes the door for %s", async (token) => {
    const res = await call(`/inspections/${ID}/finalize`, { method: "POST", token });
    expect([401, 403]).not.toContain(res.status);
  });

  // The line this file exists to hold: an auditor reads the file and does not sign it.
  it.each([...VIEWERS, ...OUTSIDERS])("403 for %s", async (token) => {
    expect((await call(`/inspections/${ID}/finalize`, { method: "POST", token })).status).toBe(403);
  });
});

describe("the report and its preview are gated differently, on purpose", () => {
  it.each([...MANAGERS, ...VIEWERS])("%s may read a filed report", async (token) => {
    expect([401, 403]).not.toContain((await call(`/inspections/${ID}/report.pdf`, { token })).status);
  });

  it.each(OUTSIDERS)("403 for %s reading a filed report", async (token) => {
    expect((await call(`/inspections/${ID}/report.pdf`, { token })).status).toBe(403);
  });

  // The preview is a DRAFT of something not yet certified, so it follows the write gate rather than
  // the read one — an auditor has no business seeing a report the shop has not signed.
  it.each(MANAGERS)("%s may preview a draft", async (token) => {
    expect([401, 403]).not.toContain((await call(`/inspections/${ID}/preview.pdf`, { token })).status);
  });

  it.each(VIEWERS)("403 for %s previewing a draft", async (token) => {
    expect((await call(`/inspections/${ID}/preview.pdf`, { token })).status).toBe(403);
  });
});

describe("/api/maintenance/inspectors — the §396.19 register", () => {
  it("401 unauthenticated", async () => {
    expect((await call("/inspectors")).status).toBe(401);
  });

  it.each(MANAGERS)("passes the write door for %s", async (token) => {
    const res = await call("/inspectors", {
      method: "POST",
      token,
      body: JSON.stringify({
        fullName: "George Gacev",
        qualificationBasis: "training_and_experience",
        brakeQualified: true,
        effectiveFrom: "2024-01-01",
      }),
    });
    expect([401, 403]).not.toContain(res.status);
  });

  it.each(MANAGERS)("passes the retire door for %s", async (token) => {
    const res = await call(`/inspectors/${ID}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ effectiveTo: "2026-12-31" }),
    });
    expect([401, 403]).not.toContain(res.status);
  });

  // Retiring somebody closes the window in which they can be chosen for a new inspection. A reader
  // of the file has no business doing that.
  it.each([...VIEWERS, ...OUTSIDERS])("403 for %s retiring an inspector", async (token) => {
    const res = await call(`/inspectors/${ID}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ effectiveTo: null }),
    });
    expect(res.status).toBe(403);
  });

  it.each([...VIEWERS, ...OUTSIDERS])("403 for %s writing the register", async (token) => {
    const res = await call("/inspectors", {
      method: "POST",
      token,
      body: JSON.stringify({
        fullName: "X",
        qualificationBasis: "state_federal_program",
        brakeQualified: false,
        effectiveFrom: "2024-01-01",
      }),
    });
    expect(res.status).toBe(403);
  });
});
