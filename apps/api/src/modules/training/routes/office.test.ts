import { describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * Safety → Training's API (D-TR3, D-TR11): reading needs `safety: view`, sending needs `safety: manage`;
 * a hired driver is never texted; the office gets a link back ONLY when it must deliver it itself; every
 * send is audited; every query names the caller's org.
 */

const ORG = "33333333-3333-4333-8333-333333333333";
const USER = "user-1";
const COURSE = "55555555-5555-4555-8555-555555555555";
const HIRED = "11111111-1111-4111-8111-111111111111";
const APPLICANT = "22222222-2222-4222-8222-222222222222";
const MAILED = "66666666-6666-4666-8666-666666666666";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: { WEB_APP_URL: "https://360.example.test" } }) }));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn(async () => ({ ok: true, provider: "brevo" })) }));
vi.mock("../../../lib/mailer.js", () => mail);
const audit = vi.hoisted(() => ({ writeAudit: vi.fn(async () => true) }));
vi.mock("../../../lib/audit.js", () => audit);
vi.mock("../../../middleware/requireModule.js", () => ({ requireModule: () => (_q: Request, _s: Response, n: NextFunction) => n() }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: "safety_manager", email: "s@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection:
    (section: string, level: "view" | "manage" = "manage") =>
    (req: Request, res: Response, next: NextFunction) => {
      const [s, l] = String(req.headers["x-grants"] ?? "safety:manage").split(":");
      if (s === section && (l === "manage" || l === level)) next();
      else res.status(403).json({ ok: false, error: { code: "forbidden", message: "no" } });
    },
}));

const texted: string[] = [];
const texter = {
  canText: vi.fn(async (_a: unknown, _e: unknown, _o: string, _d: string, status: string) => ({ ok: status === "applicant", reason: status === "applicant" ? null : "Texting hired drivers is not set up yet." })),
  send: vi.fn(async (_a: unknown, _e: unknown, _o: string, driverId: string) => {
    texted.push(driverId);
    return { ok: true, detail: null };
  }),
};

const { trainingRouter } = await import("./office.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/training", trainingRouter({ texter }));
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/training`);
  } finally {
    await closeTestServer(server);
  }
}
const post = (url: string, body: unknown, grants?: string) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(grants ? { "x-grants": grants } : {}) }, body: JSON.stringify(body) });

function seed() {
  let n = 0;
  rec = createSupabaseRecorder({
    tables: {
      training_courses: [{ id: COURSE, title: "Act I", retired_at: null }],
      organizations: [{ name: "Silvicom Inc" }],
      drivers: [
        { id: HIRED, full_name: "Marko Petrovic", email: null, phone: "+13125550141", status: "active" },
        { id: APPLICANT, full_name: "Kevin Brooks", email: "k@example.test", phone: "+18155550133", status: "applicant" },
        { id: MAILED, full_name: "Ana Morales", email: "ana@example.test", phone: null, status: "active" },
      ],
      training_assignments: (q: RecordedQuery) => (q.write?.method === "insert" ? [{ id: `aaaaaaa${n++}-aaaa-4aaa-8aaa-aaaaaaaaaaaa` }] : []),
    },
  });
}

describe("sending training", () => {
  it("texts the applicant, emails the hired driver with an address, and hands the office the link only for the one it must deliver", async () => {
    seed();
    const res = await withServer((b) => post(`${b}/assignments`, { driverIds: [HIRED, APPLICANT, MAILED], courseId: COURSE }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { sent: Array<{ driverId: string; via: string; link: string | null }> };
    const by = Object.fromEntries(body.sent.map((s) => [s.driverId, s]));
    expect(by[APPLICANT]).toMatchObject({ via: "sms", link: null });
    expect(by[MAILED]).toMatchObject({ via: "email", link: null });
    expect(by[HIRED]!.via).toBe("copy");
    expect(by[HIRED]!.link).toMatch(/^https:\/\/360\.example\.test\/t\/[A-Za-z0-9_-]{24}$/);
    expect(texted).toEqual([APPLICANT]);
    // Only a hash is stored; the token is never written.
    for (const row of rec.writtenRows("training_assignments").filter((r) => "token_hash" in r)) expect(String(row.token_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(audit.writeAudit).toHaveBeenCalledTimes(3);
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  it("needs safety: manage to send, and safety: view to read", async () => {
    seed();
    const refused = await withServer((b) => post(`${b}/assignments`, { driverIds: [HIRED], courseId: COURSE }, "safety:view"));
    expect(refused.status).toBe(403);
    const read = await withServer((b) => fetch(`${b}/assignments`, { headers: { "x-grants": "safety:view" } }));
    expect(read.status).toBe(200);
  });

  it("refuses a driver from another company", async () => {
    seed();
    const res = await withServer((b) => post(`${b}/assignments`, { driverIds: ["99999999-9999-4999-8999-999999999999", HIRED], courseId: COURSE }));
    expect(res.status).toBe(404);
  });
});
