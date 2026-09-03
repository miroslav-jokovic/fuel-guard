import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `GET /api/members` and `PATCH /api/members/:id` after 0301 (S9).
 *
 * Three things are pinned, and each is a way the names feature could have shipped looking right:
 *
 *  1. **The list is ONE call.** `org_member_directory(p_org_id)` and no `auth.admin.getUserById`.
 *     The N+1 was the reason the endpoint could not scale and the reason it had no name to show; a
 *     regression to it would pass every assertion that only reads the response shape.
 *  2. **A rename is org-scoped before it is a write.** `user_profiles` is keyed by user with no
 *     org_id (D-MEM1), so the membership lookup is the ONLY thing standing between an admin and a
 *     stranger's name. The test asks for a user who is not a member and expects 404 with no write.
 *  3. **The profile write is a full row and carries an audit row.** A partial upsert is the
 *     2026-08-10 incident; an unaudited rename is a change nobody can reconstruct.
 */
const ORG = "00000000-0000-4000-8000-00000000000a";
const ADMIN = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const STRANGER = "00000000-0000-4000-8000-000000000009";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: ADMIN, orgId: ORG, role: "admin", email: "admin@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../../../lib/audit.js", () => ({ writeAudit: vi.fn(async () => true) }));
vi.mock("../../messaging/index.js", () => ({ revokePushTokens: vi.fn(async () => undefined) }));

const { membersRouter } = await import("./members.js");
const { writeAudit } = await import("../../../lib/audit.js");

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const app = express();
  app.use(express.json());
  app.use("/api/members", membersRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/members${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally {
    await closeTestServer(server);
  }
}

const directory = [
  { user_id: ADMIN, email: "admin@example.test", full_name: "Miki Admin", role: "admin", joined_at: "2026-01-01T00:00:00Z" },
  { user_id: MEMBER, email: "shop@example.test", full_name: null, role: "technician", joined_at: "2026-01-02T00:00:00Z" },
];

beforeEach(() => {
  vi.clearAllMocks();
  rec = createSupabaseRecorder({
    rpc: { org_member_directory: directory },
    tables: {
      memberships: (q) => {
        const wanted = q.filters().find((f) => f.col === "user_id")?.val;
        return { data: wanted === MEMBER || wanted === ADMIN ? [{ role: wanted === ADMIN ? "admin" : "technician" }] : [], error: null };
      },
      user_profiles: { data: [], error: null },
    },
  });
});

describe("GET /api/members", () => {
  it("lists the org's members from the directory in ONE call — name beside email, no per-member auth lookup", async () => {
    const { status, json } = await call("GET", "");
    expect(status).toBe(200);
    expect(json.members).toEqual([
      { userId: ADMIN, email: "admin@example.test", fullName: "Miki Admin", role: "admin", joinedAt: "2026-01-01T00:00:00Z" },
      { userId: MEMBER, email: "shop@example.test", fullName: null, role: "technician", joinedAt: "2026-01-02T00:00:00Z" },
    ]);
    expect(rec.rpcs()).toEqual([{ fn: "org_member_directory", args: { p_org_id: ORG } }]);
    expect(rec.authCalls.filter((c) => c.fn === "getUserById")).toHaveLength(0);
  });

  it("answers 500, not a half-list, when the directory cannot be read", async () => {
    rec = createSupabaseRecorder({ rpc: { org_member_directory: { error: { message: "boom" } } } });
    expect((await call("GET", "")).status).toBe(500);
  });
});

describe("PATCH /api/members/:id — the name half", () => {
  it("writes the whole profile row, org-scoped through the membership, and audits the rename", async () => {
    const { status } = await call("PATCH", `/${MEMBER}`, { fullName: "  Shop Lead  " });
    expect(status).toBe(200);
    // Every table read is org-scoped; the profile itself has no org_id (D-MEM1) and is exempt because
    // the membership lookup before it IS its org scope.
    expectOrgScoped(rec, ORG, { exempt: ["user_profiles"] });
    const write = rec.queries.find((q) => q.table === "user_profiles" && q.write)!;
    expect(write.write?.method).toBe("upsert");
    // Trimmed by the contract, and every required column present — a partial upsert is the incident.
    expect(write.write?.payload).toMatchObject({ user_id: MEMBER, full_name: "Shop Lead", updated_by: ADMIN });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: ORG, action: "member.renamed", entity: "user_profiles", entityId: MEMBER, meta: { fullName: "Shop Lead" } }),
    );
  });

  it("refuses to name a user who is not a member of the caller's org — 404 and no write", async () => {
    const { status } = await call("PATCH", `/${STRANGER}`, { fullName: "Nobody" });
    expect(status).toBe(404);
    expect(rec.queries.filter((q) => q.table === "user_profiles")).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("rejects a blank name at the contract, before any lookup", async () => {
    const { status } = await call("PATCH", `/${MEMBER}`, { fullName: "   " });
    expect(status).toBe(400);
    expect(rec.queries).toHaveLength(0);
  });

  it("rejects an empty change — neither role nor name", async () => {
    expect((await call("PATCH", `/${MEMBER}`, {})).status).toBe(400);
  });

  it("changes role and name in one request, with one audit row each", async () => {
    const { status } = await call("PATCH", `/${MEMBER}`, { role: "dispatcher", fullName: "Shop Lead" });
    expect(status).toBe(200);
    const actions = (writeAudit as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => (c[1] as { action: string }).action);
    expect(actions).toEqual(["member.role_changed", "member.renamed"]);
  });
});
