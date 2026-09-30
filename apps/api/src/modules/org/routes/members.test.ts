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
/** A driver-app login: a real membership in this org, issued by the roster (DC10). */
const DRIVER = "00000000-0000-4000-8000-000000000003";
/** An office member suspended under Q-SET12 (0393). */
const SUSPENDED = "00000000-0000-4000-8000-000000000004";

/** The 0395 member functions' default answers: the role held before the change. */
const MEMBER_RPCS = {
  org_member_directory: undefined as unknown,
  member_change_role: "technician",
  member_remove: "technician",
  member_set_suspended: "technician",
  revoke_user_sessions: 1,
};

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
vi.mock("../../../middleware/membershipCurrent.js", () => ({ forgetMembership: vi.fn() }));

const { membersRouter } = await import("./members.js");
const { writeAudit } = await import("../../../lib/audit.js");
const { forgetMembership } = await import("../../../middleware/membershipCurrent.js");
const { revokePushTokens } = await import("../../messaging/index.js");

/** The 0395/0363 calls a request made, by name (SP7/SP8). */
const rpcCalls = (fn: string) => rec.rpcs().filter((r) => r.fn === fn).map((r) => r.args);
const sessionsEnded = () => rpcCalls("revoke_user_sessions");

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: { members?: unknown[]; error?: { code?: string } } | null }> {
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
    return { status: res.status, json: (await res.json().catch(() => null)) as { members?: unknown[]; error?: { code?: string } } | null };
  } finally {
    await closeTestServer(server);
  }
}

const directory = [
  { user_id: ADMIN, email: "admin@example.test", full_name: "Miki Admin", role: "admin", joined_at: "2026-01-01T00:00:00Z" },
  // A directory row with no `suspended_at` at all — 0301's shape, which a deploy window can serve.
  { user_id: MEMBER, email: "shop@example.test", full_name: null, role: "technician", joined_at: "2026-01-02T00:00:00Z" },
  { user_id: SUSPENDED, email: "leave@example.test", full_name: "On Leave", role: "dispatcher", joined_at: "2026-01-04T00:00:00Z", suspended_at: "2026-09-30T12:00:00Z" },
  // The directory returns driver logins ON PURPOSE — it is the whole product's naming directory, and
  // a driver who uploads a document has to be nameable in the ledger that prints it. This page is
  // the one that must not show them.
  { user_id: DRIVER, email: "aaron@drivers.fuelguard.app", full_name: "AARON ROTHENBERG", role: "driver", joined_at: "2026-01-03T00:00:00Z" },
];

beforeEach(() => {
  vi.clearAllMocks();
  rec = recorder();
});

function recorder(rpc: Record<string, unknown> = {}): SupabaseRecorder {
  return createSupabaseRecorder({
    rpc: { ...MEMBER_RPCS, org_member_directory: directory, ...rpc },
    tables: {
      memberships: (q) => {
        const wanted = q.filters().find((f) => f.col === "user_id")?.val;
        const role =
          wanted === ADMIN ? "admin" : wanted === MEMBER ? "technician" : wanted === DRIVER ? "driver" : wanted === SUSPENDED ? "dispatcher" : null;
        return { data: role ? [{ role }] : [], error: null };
      },
      user_profiles: { data: [], error: null },
      drivers: { data: [], error: null },
    },
  });
}

describe("GET /api/members", () => {
  it("lists the org's members from the directory in ONE call — name beside email, no per-member auth lookup", async () => {
    const { status, json } = await call("GET", "");
    expect(status).toBe(200);
    expect(json?.members).toEqual([
      { userId: ADMIN, email: "admin@example.test", fullName: "Miki Admin", role: "admin", joinedAt: "2026-01-01T00:00:00Z", suspendedAt: null },
      // Absence of the column reads as NOT suspended — null, never undefined (Q-SET12).
      { userId: MEMBER, email: "shop@example.test", fullName: null, role: "technician", joinedAt: "2026-01-02T00:00:00Z", suspendedAt: null },
      {
        userId: SUSPENDED,
        email: "leave@example.test",
        fullName: "On Leave",
        role: "dispatcher",
        joinedAt: "2026-01-04T00:00:00Z",
        suspendedAt: "2026-09-30T12:00:00Z",
      },
    ]);
    expect(rec.rpcs()).toEqual([{ fn: "org_member_directory", args: { p_org_id: ORG } }]);
    expect(rec.authCalls.filter((c) => c.fn === "getUserById")).toHaveLength(0);
  });

  it("answers 500, not a half-list, when the directory cannot be read", async () => {
    rec = createSupabaseRecorder({ rpc: { org_member_directory: { error: { message: "boom" } } } });
    expect((await call("GET", "")).status).toBe(500);
  });

  it("does not list driver-app logins — a row this page shows is a row it offers to remove (DC10)", async () => {
    const { json } = await call("GET", "");
    expect((json?.members as Array<{ userId: string }>).map((m) => m.userId)).toEqual([ADMIN, MEMBER, SUSPENDED]);
  });
});

/**
 * DC10 — a driver's membership is the CREDENTIAL, not a permission on one.
 *
 * `custom_access_token_hook` mints `org_id` from `memberships` and nothing else, so removing that row
 * leaves a driver who still authenticates, still holds a valid password, and is stuck forever on the
 * app's "Account almost ready" screen while the Drivers page goes on reporting app access. It is not
 * a hypothetical: `member.removed` on 2026-08-31 01:27 UTC did exactly that to a live driver, who was
 * locked out for eight days with no error message anywhere and no way back through any screen.
 *
 * Migration 0329 makes the database refuse it. These are the assertions for the half that refuses it
 * in WORDS, before a 500 from a trigger is all anybody gets — and for the paths the trigger cannot
 * see, like promoting a colleague INTO a driver role, which creates a membership with no roster row
 * and no password behind it.
 */
describe("DELETE /api/members/:id", () => {
  /**
   * SP8 (Q-SET7 (a)): the delete and its `member.removed` row (carrying the role held) are ONE call to
   * `member_remove`; SP7 (Q-SET6 (a)): the person is signed out now, not at the next token refresh.
   */
  it("removes an office member in one audited call with the token's org, then ends their sessions", async () => {
    const { status } = await call("DELETE", `/${MEMBER}`);
    expect(status).toBe(200);
    expect(rpcCalls("member_remove")).toEqual([{ p_org_id: ORG, p_user_id: MEMBER, p_actor: ADMIN, p_action: "member.removed" }]);
    expect(rec.queries.filter((q) => q.table === "memberships" && q.write)).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
    expect(sessionsEnded()).toEqual([{ p_user_id: MEMBER }]);
    expect(forgetMembership).toHaveBeenCalledWith(MEMBER);
    expectOrgScoped(rec, ORG);
  });

  it("answers 404 when the function finds no membership to remove — and ends nobody's sessions", async () => {
    rec = recorder({ member_remove: null });
    expect((await call("DELETE", `/${MEMBER}`)).status).toBe(404);
    expect(sessionsEnded()).toHaveLength(0);
  });

  it("still answers ok when ending the sessions fails after the removal committed", async () => {
    rec = recorder({ revoke_user_sessions: { error: { message: "auth schema unavailable" } } });
    const { status } = await call("DELETE", `/${MEMBER}`);
    expect(status).toBe(200);
    // The API's own cache is still cleared, so the membership check refuses their token here at once.
    expect(forgetMembership).toHaveBeenCalledWith(MEMBER);
  });

  it("refuses to remove a driver-app login, and deletes NOTHING", async () => {
    const { status, json } = await call("DELETE", `/${DRIVER}`);
    expect(status).toBe(400);
    expect(json?.error?.code).toBe("roster_managed");
    expect(rpcCalls("member_remove")).toHaveLength(0);
    expect(sessionsEnded()).toHaveLength(0);
  });

  it("refuses to remove yourself", async () => {
    expect((await call("DELETE", `/${ADMIN}`)).json?.error?.code).toBe("cannot_remove_self");
    expect(rpcCalls("member_remove")).toHaveLength(0);
  });

  it("refuses to remove a user who is not a member of the caller's org", async () => {
    expect((await call("DELETE", `/${STRANGER}`)).status).toBe(404);
    expect(rec.queries.filter((q) => q.write)).toHaveLength(0);
    expect(rpcCalls("member_remove")).toHaveLength(0);
  });
});

describe("POST /api/members/:id/revoke", () => {
  it("revokes in one audited call, then deactivates the roster row, drops push tokens and ends sessions", async () => {
    const { status } = await call("POST", `/${MEMBER}/revoke`);
    expect(status).toBe(200);
    expect(rpcCalls("member_remove")).toEqual([{ p_org_id: ORG, p_user_id: MEMBER, p_actor: ADMIN, p_action: "member.access_revoked" }]);
    expect(writeAudit).not.toHaveBeenCalled();
    const deactivate = rec.queries.find((q) => q.table === "drivers" && q.write?.method === "update");
    expect(deactivate?.write?.payload).toEqual({ status: "inactive" });
    expect(revokePushTokens).toHaveBeenCalledWith(expect.anything(), MEMBER);
    expect(sessionsEnded()).toEqual([{ p_user_id: MEMBER }]);
    expect(forgetMembership).toHaveBeenCalledWith(MEMBER);
    expectOrgScoped(rec, ORG);
  });

  it("refuses a driver-app login — it drops the membership without unlinking the roster row", async () => {
    const { status, json } = await call("POST", `/${DRIVER}/revoke`);
    expect(status).toBe(400);
    expect(json?.error?.code).toBe("roster_managed");
    expect(rec.queries.filter((q) => q.write)).toHaveLength(0);
    expect(rpcCalls("member_remove")).toHaveLength(0);
  });

  it("answers 404 when there is no membership to revoke, and touches no roster row", async () => {
    rec = recorder({ member_remove: null });
    expect((await call("POST", `/${MEMBER}/revoke`)).status).toBe(404);
    expect(rec.queries.filter((q) => q.write)).toHaveLength(0);
    expect(sessionsEnded()).toHaveLength(0);
  });
});

describe("PATCH /api/members/:id — the role half against driver logins", () => {
  it("refuses to re-role a driver OUT of `driver` — the app would send them to its wrong-app screen", async () => {
    const { status, json } = await call("PATCH", `/${DRIVER}`, { role: "dispatcher" });
    expect(status).toBe(400);
    expect(json?.error?.code).toBe("roster_managed");
    expect(rec.queries.filter((q) => q.write)).toHaveLength(0);
  });

  it("refuses to re-role a colleague INTO `driver` — a credential with no roster row and no password", async () => {
    const { status, json } = await call("PATCH", `/${MEMBER}`, { role: "driver" });
    expect(status).toBe(400);
    expect(json?.error?.code).toBe("roster_managed");
    expect(rec.queries.filter((q) => q.write)).toHaveLength(0);
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

  it("changes role and name in one request — the role's record inside member_change_role, the name's beside it", async () => {
    const { status } = await call("PATCH", `/${MEMBER}`, { role: "dispatcher", fullName: "Shop Lead" });
    expect(status).toBe(200);
    expect(rpcCalls("member_change_role")).toEqual([{ p_org_id: ORG, p_user_id: MEMBER, p_role: "dispatcher", p_actor: ADMIN }]);
    const actions = (writeAudit as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => (c[1] as { action: string }).action);
    expect(actions).toEqual(["member.renamed"]);
  });

  it("a rename alone ends nobody's sessions — the name is not in the token", async () => {
    await call("PATCH", `/${MEMBER}`, { fullName: "Shop Lead" });
    expect(sessionsEnded()).toHaveLength(0);
    expect(rpcCalls("member_change_role")).toHaveLength(0);
  });
});

/** SP7 + SP8 on the role half: one audited call, then the person is signed out (Q-SET6 (a)). */
describe("PATCH /api/members/:id — the role change", () => {
  it("re-roles through member_change_role with the token's org, writes no memberships row itself, and ends sessions", async () => {
    const { status } = await call("PATCH", `/${MEMBER}`, { role: "dispatcher" });
    expect(status).toBe(200);
    expect(rpcCalls("member_change_role")).toEqual([{ p_org_id: ORG, p_user_id: MEMBER, p_role: "dispatcher", p_actor: ADMIN }]);
    expect(rec.queries.filter((q) => q.table === "memberships" && q.write)).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
    expect(sessionsEnded()).toEqual([{ p_user_id: MEMBER }]);
    expect(forgetMembership).toHaveBeenCalledWith(MEMBER);
  });

  it("ends nobody's sessions when the function found the role already changed", async () => {
    rec = recorder({ member_change_role: "dispatcher" });
    expect((await call("PATCH", `/${MEMBER}`, { role: "dispatcher" })).status).toBe(200);
    expect(sessionsEnded()).toHaveLength(0);
  });

  it("answers 404 when the function finds no membership", async () => {
    rec = recorder({ member_change_role: null });
    expect((await call("PATCH", `/${MEMBER}`, { role: "dispatcher" })).status).toBe(404);
    expect(sessionsEnded()).toHaveLength(0);
  });

  it("words the last-admin refusal from the count of ACTIVE admins, before any write", async () => {
    rec = createSupabaseRecorder({
      rpc: MEMBER_RPCS,
      tables: {
        memberships: (q) =>
          q.ops.some((o) => o.method === "select" && (o.args[1] as { head?: boolean } | undefined)?.head)
            ? { data: [], count: 1, error: null }
            : { data: [{ role: "admin" }], error: null },
      },
    });
    const { status, json } = await call("PATCH", `/${MEMBER}`, { role: "dispatcher" });
    expect(status).toBe(400);
    expect(json?.error?.code).toBe("last_admin");
    const count = rec.queries.find((q) => q.ops.some((o) => o.method === "select" && (o.args[1] as { head?: boolean } | undefined)?.head))!;
    // 0393: a suspended admin does not keep the organisation administrable, so it is not counted.
    expect(count.ops).toContainEqual({ method: "is", args: ["suspended_at", null] });
    expect(rpcCalls("member_change_role")).toHaveLength(0);
  });
});

/**
 * SP6 (migration 0392): the database refuses, at commit, any write that leaves the org with no admin
 * (SQLSTATE AM010). The handler's count words the ordinary case; these pin the case it cannot see —
 * two admins acting at once, each counting two — so the refusal reads as `last_admin`, not a 500.
 */
describe("the database's last-admin refusal (AM010) reaches the admin as last_admin", () => {
  const AM010 = { error: { code: "AM010", message: "organization would be left with no active admin" } };
  // The count the handler asks before demoting sees TWO admins — the race it cannot see past.
  const refusing = (rpc: Record<string, unknown>) =>
    createSupabaseRecorder({
      rpc: { ...MEMBER_RPCS, ...rpc },
      tables: {
        memberships: (q) =>
          q.ops.some((o) => o.method === "select" && (o.args[1] as { head?: boolean } | undefined)?.head)
            ? { data: [], count: 2, error: null }
            : { data: [{ role: "admin" }], error: null },
        drivers: { data: [], error: null },
      },
    });

  it("PATCH demoting an admin the database refuses answers 409 last_admin, and nobody is signed out", async () => {
    rec = refusing({ member_change_role: AM010 });
    const { status, json } = await call("PATCH", `/${MEMBER}`, { role: "dispatcher" });
    expect(status).toBe(409);
    expect(json?.error?.code).toBe("last_admin");
    expect(writeAudit).not.toHaveBeenCalled();
    expect(sessionsEnded()).toHaveLength(0);
  });

  it("DELETE the database refuses answers 409 last_admin, and nobody is signed out", async () => {
    rec = refusing({ member_remove: AM010 });
    const { status, json } = await call("DELETE", `/${MEMBER}`);
    expect(status).toBe(409);
    expect(json?.error?.code).toBe("last_admin");
    expect(sessionsEnded()).toHaveLength(0);
  });

  it("revoke the database refuses answers 409 last_admin, and leaves the roster row alone", async () => {
    rec = refusing({ member_remove: AM010 });
    const { status, json } = await call("POST", `/${MEMBER}/revoke`);
    expect(status).toBe(409);
    expect(json?.error?.code).toBe("last_admin");
    expect(rec.queries.filter((q) => q.table === "drivers" && q.write)).toHaveLength(0);
  });

  it("suspend the database refuses answers 409 last_admin", async () => {
    rec = refusing({ member_set_suspended: AM010 });
    const { status, json } = await call("POST", `/${MEMBER}/suspend`);
    expect(status).toBe(409);
    expect(json?.error?.code).toBe("last_admin");
    expect(sessionsEnded()).toHaveLength(0);
  });

  it("any other failure is still a 500 db_error, not a last_admin", async () => {
    rec = recorder({ member_remove: { error: { code: "57014", message: "timeout" } } });
    const { status, json } = await call("DELETE", `/${MEMBER}`);
    expect(status).toBe(500);
    expect(json?.error?.code).toBe("db_error");
  });
});

/**
 * Q-SET12 (a), migration 0393: an office member can be suspended — access off, the membership and
 * its per-person answers kept — and reinstated. Suspending signs them out now (Q-SET6 (a));
 * reinstating only clears the API's cached verdict, because there is no session to keep.
 */
describe("POST /api/members/:id/suspend and /reinstate", () => {
  it("suspends through member_set_suspended with the token's org, then ends their sessions", async () => {
    const { status, json } = await call("POST", `/${MEMBER}/suspend`);
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, suspended: true });
    expect(rpcCalls("member_set_suspended")).toEqual([{ p_org_id: ORG, p_user_id: MEMBER, p_suspended: true, p_actor: ADMIN }]);
    expect(rec.queries.filter((q) => q.write)).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
    expect(sessionsEnded()).toEqual([{ p_user_id: MEMBER }]);
    expect(forgetMembership).toHaveBeenCalledWith(MEMBER);
    expectOrgScoped(rec, ORG);
  });

  it("reinstates without ending any session, and clears the cached verdict", async () => {
    const { status, json } = await call("POST", `/${SUSPENDED}/reinstate`);
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, suspended: false });
    expect(rpcCalls("member_set_suspended")).toEqual([{ p_org_id: ORG, p_user_id: SUSPENDED, p_suspended: false, p_actor: ADMIN }]);
    expect(sessionsEnded()).toHaveLength(0);
    expect(forgetMembership).toHaveBeenCalledWith(SUSPENDED);
  });

  for (const act of ["suspend", "reinstate"]) {
    it(`refuses to ${act} yourself`, async () => {
      const { status, json } = await call("POST", `/${ADMIN}/${act}`);
      expect(status).toBe(400);
      expect(json?.error?.code).toBe("cannot_suspend_self");
      expect(rpcCalls("member_set_suspended")).toHaveLength(0);
    });

    it(`refuses to ${act} a driver-app login — the Drivers page owns that credential (DC10)`, async () => {
      const { status, json } = await call("POST", `/${DRIVER}/${act}`);
      expect(status).toBe(400);
      expect(json?.error?.code).toBe("roster_managed");
      expect(rpcCalls("member_set_suspended")).toHaveLength(0);
    });

    it(`answers 404 to ${act} somebody outside the caller's org`, async () => {
      expect((await call("POST", `/${STRANGER}/${act}`)).status).toBe(404);
      expect(rpcCalls("member_set_suspended")).toHaveLength(0);
    });
  }

  it("answers 404 when the function finds no membership under its lock", async () => {
    rec = recorder({ member_set_suspended: null });
    expect((await call("POST", `/${MEMBER}/suspend`)).status).toBe(404);
    expect(sessionsEnded()).toHaveLength(0);
  });
});
