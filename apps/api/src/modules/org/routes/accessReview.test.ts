import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { stepUpHeaders } from "../../../testing/stepUp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { APP_SECTIONS, GRANTABLE_SURFACES, REVIEW_SCREENS, accessReviewStateSchema } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * SP10 (Q-SET10) — `GET /api/access-review` and its audited CSV.
 *
 * What is pinned is what an access review is only worth anything if it holds:
 *  · **admin only** — the list of everyone and what they reach is the most useful map an attacker
 *    inside the org could ask for, so the gate is exercised here with a real role check rather than
 *    a stub that opens every door;
 *  · **one org** — the API reads with the service role, which bypasses RLS, so every table read must
 *    carry its own `org_id` (`expectOrgScoped`) and the directory RPC must be asked for this org;
 *  · **complete** — PostgREST answers at most 1,000 rows, and a review that stopped at the cap would
 *    report a person's role answer as theirs; the per-person reads must page to the end;
 *  · **recorded** — the export writes `permissions.exported`, and refuses to produce a file it could
 *    not record.
 */
const ORG = "org-1";
const USER = "user-1";
const auth = vi.hoisted(() => ({ role: "admin" as string }));

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
// SP9: the export requires a step-up token, verified against the key `stepUpHeaders` mints under.
vi.mock("../../../lib/appLocals.js", async () => {
  const { STEP_UP_TEST_KEY } = await import("../../../testing/stepUp.js");
  return { getAppLocals: () => ({ env: { SECRETS_ENCRYPTION_KEY: STEP_UP_TEST_KEY } }) };
});
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: auth.role, email: "tester@example.test" } as Request["auth"];
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  // A real check of the roles the ROUTE names, so a route that forgot its gate — or named a wider
  // one — fails here. The middleware itself is proved in middleware/auth tests.
  requireRole:
    (...roles: string[]) =>
    (req: Request, res: Response, next: NextFunction) =>
      roles.includes(req.auth!.role as string) ? next() : res.status(403).json({ error: { code: "forbidden" } }),
}));
const audit = vi.hoisted(() => ({ ok: true }));
vi.mock("../../../lib/audit.js", () => ({ writeAudit: vi.fn(async () => audit.ok) }));

const { accessReviewRouter } = await import("./accessReview.js");
const { writeAudit } = await import("../../../lib/audit.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use("/api/access-review", accessReviewRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await closeTestServer(server);
  }
}

const MEMBER = "00000000-0000-4000-8000-000000000010";
const SUSPENDED = "00000000-0000-4000-8000-000000000011";
const DRIVER = "00000000-0000-4000-8000-000000000012";
const directory = [
  { user_id: MEMBER, email: "disp@carrier.test", full_name: "Dee Dispatch", role: "dispatcher", joined_at: "x", suspended_at: null },
  { user_id: SUSPENDED, email: "sam@carrier.test", full_name: "Sam", role: "dispatcher", joined_at: "x", suspended_at: "2026-09-29T00:00:00Z" },
  { user_id: DRIVER, email: null, full_name: "Dan Driver", role: "driver", joined_at: "x" },
];

function recorder(over: Record<string, unknown> = {}) {
  return createSupabaseRecorder({
    tables: {
      organizations: [{ name: "Acme Carrier", operating_hours: { tz: "America/Chicago" } }],
      org_section_access: [
        { role: "dispatcher", section: "safety", access: "view" },
        // Uneditable — refused by the same filter `GET /api/section-access` applies.
        { role: "admin", section: "fuel", access: "none" },
      ],
      user_section_access: [{ user_id: MEMBER, section: "safety", access: "none" }],
      org_role_surface_access: [{ role: "dispatcher", surface_key: "no.such.screen", allowed: false }],
      user_surface_access: [{ user_id: MEMBER, surface_key: GRANTABLE_SURFACES[0]!.key, allowed: false }],
      org_modules: [{ module_key: "dispatch", enabled: true, config: {} }],
      ...over,
    },
    rpc: { org_member_directory: directory },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "admin";
  audit.ok = true;
  rec = recorder();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/access-review", () => {
  it("answers the whole org's layers in one response, in the shared contract's shape", async () => {
    const body = await withServer(async (base) => {
      const res = await fetch(`${base}/api/access-review`);
      expect(res.status).toBe(200);
      return res.json();
    });
    const state = accessReviewStateSchema.parse(body);
    expect(state.orgName).toBe("Acme Carrier");
    expect(state.members.map((m) => [m.userId, m.suspendedAt])).toEqual([
      [MEMBER, null],
      [SUSPENDED, "2026-09-29T00:00:00Z"],
    ]);
    expect(state.roleSections).toEqual({ dispatcher: { safety: "view" } });
    expect(state.userSections).toEqual({ [MEMBER]: { safety: "none" } });
    expect(state.roleSurfaces).toEqual({});
    expect(state.userSurfaces).toEqual({ [MEMBER]: { [GRANTABLE_SURFACES[0]!.key]: false } });
    expect(state.modules).toEqual(["dispatch"]);
  });

  it("scopes every read to the caller's org", async () => {
    await withServer((base) => fetch(`${base}/api/access-review`));
    expectOrgScoped(rec, ORG);
    expect(rec.rpcs()).toEqual([{ fn: "org_member_directory", args: { p_org_id: ORG } }]);
    for (const t of ["org_section_access", "user_section_access", "org_role_surface_access", "user_surface_access", "org_modules"]) {
      expect(rec.forTable(t).length, t).toBeGreaterThan(0);
    }
  });

  it("leaves driver-app logins out, as the Users page does", async () => {
    const body = await withServer(async (base) => (await fetch(`${base}/api/access-review`)).json());
    expect(JSON.stringify(body)).not.toContain("Dan Driver");
  });

  it("reads a per-person table past PostgREST's 1,000-row cap", async () => {
    const key = GRANTABLE_SURFACES[0]!.key;
    const page = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ user_id: `u-${from + i}`, surface_key: key, allowed: false }));
    rec = recorder({ user_surface_access: { pages: [page(0, 1000), page(1000, 5)] } });
    const body = (await withServer(async (base) => (await fetch(`${base}/api/access-review`)).json())) as {
      userSurfaces: Record<string, unknown>;
    };
    expect(Object.keys(body.userSurfaces)).toHaveLength(1005);
    const reads = rec.forTable("user_surface_access");
    expect(reads).toHaveLength(2);
    expect(reads.map((q) => q.ops.find((o) => o.method === "range")?.args)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("refuses anyone but an admin", async () => {
    auth.role = "fleet_manager";
    const status = await withServer(async (base) => (await fetch(`${base}/api/access-review`)).status);
    expect(status).toBe(403);
    expect(rec.queries).toHaveLength(0);
  });

  it("answers 500 rather than a partial state when a read fails", async () => {
    rec = recorder({ user_section_access: { error: { message: "boom" } } });
    const status = await withServer(async (base) => (await fetch(`${base}/api/access-review`)).status);
    expect(status).toBe(500);
  });
});

describe("GET /api/access-review/export.csv", () => {
  it("sends the file, dated on the carrier's calendar, and records the export", async () => {
    // 02:00 UTC on 10/01 is still the evening of 09/30 in Chicago.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T02:00:00Z"));
    const { status, type, text } = await withServer(async (base) => {
      const res = await fetch(`${base}/api/access-review/export.csv`, { headers: stepUpHeaders(USER, ORG) });
      return { status: res.status, type: res.headers.get("content-type"), text: await res.text() };
    });
    expect(status).toBe(200);
    expect(type).toContain("text/csv");
    const lines = text.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toContain("Acme Carrier");
    expect(lines[0]).toContain("Exported 09/30/2026");
    // One active office member; the suspended one and the driver are not rows.
    expect(lines).toHaveLength(2 + APP_SECTIONS.length + REVIEW_SCREENS.length);
    expect(text).not.toContain("Sam");

    expect(writeAudit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeAudit).mock.calls[0]![1]).toMatchObject({
      orgId: ORG,
      actorId: USER,
      action: "permissions.exported",
      meta: { exportedOn: "09/30/2026", members: 1, suspended: 1, rows: APP_SECTIONS.length + REVIEW_SCREENS.length },
    });
    expectOrgScoped(rec, ORG);
  });

  it("produces no file when the export cannot be recorded", async () => {
    audit.ok = false;
    const res = await withServer(async (base) => {
      const r = await fetch(`${base}/api/access-review/export.csv`, { headers: stepUpHeaders(USER, ORG) });
      return { status: r.status, body: await r.text() };
    });
    expect(res.status).toBe(500);
    expect(res.body).not.toContain("Access review");
    expect(JSON.parse(res.body).error.code).toBe("audit_failed");
  });

  it("refuses anyone but an admin, and records nothing", async () => {
    auth.role = "auditor";
    const status = await withServer(async (base) => (await fetch(`${base}/api/access-review/export.csv`, { headers: stepUpHeaders(USER, ORG) })).status);
    expect(status).toBe(403);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses an export without a fresh password (SP9) — no file and nothing recorded", async () => {
    const res = await withServer(async (base) => {
      const r = await fetch(`${base}/api/access-review/export.csv`);
      return { status: r.status, body: await r.text() };
    });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe("step_up_required");
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
