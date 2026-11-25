import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { BROKER_MAIL_ALL_PERMISSION, brokerMailAdminSchema, brokerMailListSchema, type UserRole } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../testing/httpServer.js";

/**
 * `/api/broker-mail` (BROKER-MAIL-READER-PLAN P2) through the shipped gates: only `requireAuth` is
 * replaced. The promise under test is Q-BM9's — a dispatcher is sent the broker mail of THEIR OWN
 * mailbox and nobody else's, and only the admin (or a role an admin switched `dispatch.broker_mail_all`
 * on for) is sent everyone's — plus the page starting off for every role until the admin turns it on.
 */
const ORG = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-000000000031";
const OTHER = "00000000-0000-4000-8000-000000000032";
const LOAD = "00000000-0000-4000-8000-0000000000c1";

let rec: SupabaseRecorder;
let surfaceGrants: Record<string, Record<string, boolean>> = {};
let permissionRows: Array<{ role: string; permission: string; allowed: boolean }> = [];
let rpcError: { code: string; message: string } | null = null;
const audit = vi.hoisted(() => vi.fn(async () => true));

vi.mock("../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../lib/audit.js", () => ({ writeAudit: audit }));
vi.mock("./gatewayHealth.js", () => ({ getGatewayHealth: async () => ({ state: "ok", commit: "abc1234", lastCycleAt: "2026-11-25T15:00:00Z" }) }));
vi.mock("../../middleware/auth.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../middleware/auth.js")>();
  return {
    ...real,
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: USER, orgId: ORG, role: req.header("x-role") as UserRole, email: "t@example.test", sections: null } as never;
      next();
    },
  };
});
// The module check reads the org's purchased modules; dispatch is bought.
vi.mock("../../middleware/requireModule.js", () => ({
  requireModule: () => Object.assign((_q: Request, _s: Response, next: NextFunction) => next(), { gateKind: "module" }),
}));

const { brokerMailRouter } = await import("./routes.js");

const ROSTER = [
  { user_id: USER, mcleod_logins: ["IVOK"], email: "ivo@silvicominc.com", reason: null },
  { user_id: OTHER, mcleod_logins: ["ASEN"], email: "asen@silvicominc.com", reason: null },
  { user_id: null, mcleod_logins: ["ANETA"], email: null, reason: "not_linked" },
];

beforeEach(() => {
  surfaceGrants = {};
  permissionRows = [];
  rpcError = null;
  audit.mockClear();
  rec = createSupabaseRecorder({
    tables: {
      org_role_surface_access: (q) => {
        const role = q.filters().find((f) => f.col === "role")?.val as string;
        return Object.entries(surfaceGrants[role] ?? {}).map(([surface_key, allowed]) => ({ role, surface_key, allowed }));
      },
      user_surface_access: [],
      org_role_permissions: () => permissionRows,
      broker_mail_messages: [{
        id: "00000000-0000-4000-8000-0000000000d1", owner_user_id: USER, received_at: "2026-11-25T14:40:00Z",
        from_address: "anna@chrobinson.com", from_domain: "chrobinson.com", subject: "RE: 48213 ETA?", match_state: "one",
        matched_refs: ["48213"], load_id: LOAD, thread_state: "waiting", answered_at: null, addressed_directly: true, org_id: ORG,
      }],
      loads: [{ id: LOAD, ref: "48213", org_id: ORG }],
      broker_mail_settings: [],
      mail_gateway_config: [{ org_id: ORG, enabled: true, body_reading: false, mail_domains: ["silvicominc.com"], canary_result: "refused", canary_checked_at: null, disabled_reason: null }],
      mail_gateway_mailboxes: [{ org_id: ORG, mailbox: "ivo@silvicominc.com", owner_user_id: USER, state: "connected", last_read_at: "2026-11-25T15:00:00Z", unlinked_at: null, last_probe_at: null }],
    },
    rpc: (fn: string) => {
      if (fn === "mailgw_mailbox_roster") return ROSTER;
      if (fn === "org_member_directory") return [{ user_id: USER, full_name: "Ivo", email: "ivo@silvicominc.com", role: "dispatcher" }, { user_id: OTHER, full_name: "Asen", email: "asen@silvicominc.com", role: "dispatcher" }];
      if (fn === "broker_mail_set_left_out") return rpcError ? { error: rpcError } : [OTHER];
      return null;
    },
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test reads the JSON answer by field; the schemas are asserted separately
async function call(role: UserRole, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const app = express();
  app.use(express.json());
  app.use("/api/broker-mail", brokerMailRouter());
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
      method, headers: { "content-type": "application/json", "x-role": role }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally {
    await closeTestServer(server);
  }
}

const messageQueries = () => rec.forTable("broker_mail_messages");
const ownerFilter = (q: { filters(): Array<{ col: string; val: unknown }> }) => q.filters().find((f) => f.col === "owner_user_id")?.val;

describe("GET /api/broker-mail/messages — whose broker mail", () => {
  it("starts off for a dispatcher: the screen is the admin's until it is turned on for the role", async () => {
    expect((await call("dispatcher", "GET", "/api/broker-mail/messages")).status).toBe(403);
    expect(messageQueries()).toHaveLength(0);
  });

  it("once turned on, a dispatcher is sent only their own mailbox's rows — every query filters org AND owner", async () => {
    surfaceGrants = { dispatcher: { "dispatch.broker-mail": true } };
    const r = await call("dispatcher", "GET", "/api/broker-mail/messages?tab=waiting");
    expect(r.status).toBe(200);
    expect(brokerMailListSchema.safeParse(r.json).success).toBe(true);
    expect(r.json.seesAll).toBe(false);
    expect(r.json.dispatchers).toEqual([]);
    expect(r.json.rows[0].load).toEqual({ id: LOAD, ref: "48213" });
    expect(r.json.rows[0].ownerName).toBeNull();
    expect(r.json.myMailbox).toEqual({ read: true, reason: null });
    expect(messageQueries().length).toBe(4); // the queue's rows and the three counts
    for (const q of messageQueries()) expect(ownerFilter(q)).toBe(USER);
    expectOrgScoped(rec, ORG, { exempt: ["org_role_surface_access", "user_surface_access"] });
  });

  it("refuses a dispatcher asking for a colleague's rows instead of answering with their own", async () => {
    surfaceGrants = { dispatcher: { "dispatch.broker-mail": true } };
    const r = await call("dispatcher", "GET", `/api/broker-mail/messages?owner=${OTHER}`);
    expect(r.status).toBe(403);
    expect(messageQueries()).toHaveLength(0);
  });

  it("dispatch: manage is NOT 'see everyone' — a dispatcher holds it and still gets only their own", async () => {
    surfaceGrants = { dispatcher: { "dispatch.broker-mail": true } };
    await call("dispatcher", "GET", "/api/broker-mail/messages");
    for (const q of messageQueries()) expect(ownerFilter(q)).toBe(USER);
  });

  it("the admin is sent everyone's rows, named, and may narrow to one dispatcher", async () => {
    const all = await call("admin", "GET", "/api/broker-mail/messages");
    expect(all.json.seesAll).toBe(true);
    expect(all.json.rows[0].ownerName).toBe("Ivo");
    expect(all.json.dispatchers.map((d: { name: string }) => d.name)).toEqual(["Asen", "Ivo"]);
    for (const q of messageQueries()) expect(ownerFilter(q)).toBeUndefined();
    rec.queries.length = 0;
    expect((await call("admin", "GET", `/api/broker-mail/messages?owner=${OTHER}`)).status).toBe(200);
    for (const q of messageQueries()) expect(ownerFilter(q)).toBe(OTHER);
  });

  it("a role the admin switched dispatch.broker_mail_all on for sees everyone's", async () => {
    surfaceGrants = { fleet_manager: { "dispatch.broker-mail": true } };
    permissionRows = [{ role: "fleet_manager", permission: BROKER_MAIL_ALL_PERMISSION, allowed: true }];
    const r = await call("fleet_manager", "GET", `/api/broker-mail/messages?owner=${OTHER}`);
    expect(r.status).toBe(200);
    expect(r.json.seesAll).toBe(true);
  });

  it("refuses an unknown queue", async () => {
    expect((await call("admin", "GET", "/api/broker-mail/messages?tab=everything")).status).toBe(400);
  });
});

describe("Settings › Broker mail — the admin's alone (Q-BM9)", () => {
  it("refuses a fleet manager every endpoint, even granted the screen", async () => {
    surfaceGrants = { fleet_manager: { "admin.settings.broker-mail": true } };
    expect((await call("fleet_manager", "GET", "/api/broker-mail/admin")).status).toBe(403);
    expect((await call("fleet_manager", "PUT", "/api/broker-mail/settings", { answerWithinMinutes: 30 })).status).toBe(403);
    expect((await call("fleet_manager", "PUT", `/api/broker-mail/mailboxes/${OTHER}/left-out`, { leftOut: true })).status).toBe(403);
    expect(rec.forTable("broker_mail_settings").some((q) => q.write)).toBe(false);
  });

  it("gives the admin the gateway's state and the roster with Graph's word on each mailbox, org-scoped", async () => {
    const r = await call("admin", "GET", "/api/broker-mail/admin");
    expect(r.status).toBe(200);
    expect(brokerMailAdminSchema.safeParse(r.json).success).toBe(true);
    expect(r.json.gateway).toMatchObject({ state: "ok", configured: true, enabled: true, mailDomains: ["silvicominc.com"] });
    expect(r.json.mailboxes.map((m: { name: string | null; reason: string | null; state: string | null }) => [m.name, m.reason, m.state]))
      .toEqual([["Asen", null, null], ["Ivo", null, "connected"], [null, "not_linked", null]]);
    expectOrgScoped(rec, ORG, { exempt: ["org_role_surface_access", "user_surface_access"] });
  });

  it("saves the answer-by time with an audit row; refuses one under five minutes", async () => {
    expect((await call("admin", "PUT", "/api/broker-mail/settings", { answerWithinMinutes: 4 })).status).toBe(400);
    expect((await call("admin", "PUT", "/api/broker-mail/settings", { answerWithinMinutes: 30 })).status).toBe(200);
    expect(rec.forTable("broker_mail_settings").some((q) => q.write)).toBe(true);
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "settings.broker_mail_saved", orgId: ORG }));
    expectOrgScoped(rec, ORG, { exempt: ["org_role_surface_access", "user_surface_access"] });
  });

  it("leaves a dispatcher out through the database function, for the caller's org, audited", async () => {
    const r = await call("admin", "PUT", `/api/broker-mail/mailboxes/${OTHER}/left-out`, { leftOut: true });
    expect(r.status).toBe(200);
    const rpc = rec.queries.find((q) => q.table === "rpc:broker_mail_set_left_out");
    expect(rpc).toBeDefined();
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "settings.broker_mail_left_out", entityId: OTHER }));
  });

  it("answers 404 for a non-member and 409 before the gateway is set up — and writes no audit row", async () => {
    rpcError = { code: "22023", message: "not a member" };
    expect((await call("admin", "PUT", `/api/broker-mail/mailboxes/${OTHER}/left-out`, { leftOut: true })).status).toBe(404);
    rpcError = { code: "P0002", message: "no config" };
    expect((await call("admin", "PUT", `/api/broker-mail/mailboxes/${OTHER}/left-out`, { leftOut: true })).status).toBe(409);
    expect(audit).not.toHaveBeenCalled();
  });
});
