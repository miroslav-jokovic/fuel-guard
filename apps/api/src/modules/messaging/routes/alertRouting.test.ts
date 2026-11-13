import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ALERT_CATALOGUE, HOME_TIME_DEFAULTS, alertDefinition, type AlertRoute, type AlertRoutingView, type AuthContext, type MyAlerts } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";

/**
 * Settings › Notifications' routing section and "My alerts", through the real mounts (HOME-TIME-PLAN
 * HT5): who may open and save it, that the page is shown what the sender will do, what a save writes and
 * removes, what is refused before any write, and that every query is the session's carrier.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ADA = "90000000-0000-4000-8000-0000000000a1";
const DANA = "90000000-0000-4000-8000-0000000000a0";
const FRAN = "90000000-0000-4000-8000-0000000000a2";
const REX = "90000000-0000-4000-8000-0000000000a3";
const GONE = "90000000-0000-4000-8000-0000000000a9";

const ctx = (userId: string, role: string): AuthContext => ({ userId, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = {
  admin: ctx(ADA, "admin"),
  dispatcher: ctx(DANA, "dispatcher"),
  fleet_manager: ctx(FRAN, "fleet_manager"),
  recruiter: ctx(REX, "recruiter"),
};

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const call = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, { ...init, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } });
const put = (path: string, token: string, body: unknown) => call(path, token, { method: "PUT", body: JSON.stringify(body) });

const row = (o: Record<string, unknown>) => ({ org_id: ORG, alert: "home_time_overdue", recipient_kind: "role", recipient_key: "fleet_manager", channel: "bell", enabled: true, ...o });
const r = (recipientKind: AlertRoute["recipientKind"], recipientKey: string, channel: AlertRoute["channel"], enabled = true): AlertRoute => ({ recipientKind, recipientKey, channel, enabled });

function seed(over: { routes?: Record<string, unknown>[]; settings?: Record<string, unknown>[]; contacts?: Record<string, unknown>[]; quiet?: Record<string, unknown>[]; roleAccess?: Record<string, unknown>[]; userAccess?: Record<string, unknown>[] } = {}): SupabaseRecorder {
  rec = createSupabaseRecorder({
    tables: {
      org_role_surface_access: [],
      user_surface_access: [],
      notification_routes: postgrestFixture(over.routes ?? []),
      org_section_access: postgrestFixture(over.roleAccess ?? []),
      user_section_access: postgrestFixture(over.userAccess ?? []),
      notification_contacts: postgrestFixture(over.contacts ?? [{ org_id: ORG, user_id: DANA, phone: "+17085550100", verified_at: "2026-11-01T00:00:00Z", stopped_at: null, code_hash: null }]),
      notification_channel_settings: postgrestFixture(over.quiet ?? []),
      home_time_settings: postgrestFixture(over.settings ?? []),
      audit_logs: [],
    },
    rpc: (fn: string) => {
      if (fn === "org_member_directory") {
        return [
          { user_id: ADA, email: "ada@x.test", full_name: "Ada Admin", role: "admin", suspended_at: null },
          { user_id: DANA, email: "dana@x.test", full_name: "Dana Dispatch", role: "dispatcher", suspended_at: null },
          { user_id: FRAN, email: "fran@x.test", full_name: "", role: "fleet_manager", suspended_at: null },
          // Cannot view Dispatch, so cannot receive a home-time alert.
          { user_id: REX, email: "rex@x.test", full_name: "Rex Recruiter", role: "recruiter", suspended_at: null },
          { user_id: GONE, email: "gone@x.test", full_name: "Gail Gone", role: "dispatcher", suspended_at: "2026-11-01T00:00:00Z" },
        ];
      }
      return null;
    },
  });
  holder.client = rec.client;
  return rec;
}
const writes = (table: string, method: string) => rec.forTable(table).filter((q) => q.write?.method === method);
/** The conflict target an upsert named — its second argument, as the recorder kept the call. */
const conflictOf = (q: RecordedQuery) => (q.ops.find((o) => o.method === "upsert")?.args[1] as { onConflict?: string } | undefined)?.onConflict;
const audits = () => rec.writtenRows("audit_logs") as Record<string, unknown>[];

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const found = CTX[t];
    if (!found) throw new Error("bad token");
    return found;
  };
  await new Promise<void>((done) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      done();
    });
  });
});
afterAll(async () => closeTestServer(server));

describe("who may open and save the routing section", () => {
  it("is the Notifications screen's own gate on every route: an admin passes, a role without Settings is refused", async () => {
    seed();
    const routes = [...alertDefinition("home_time_overdue").defaults];
    for (const [method, path, body] of [
      ["GET", "/api/alert-routing", undefined],
      ["PUT", "/api/alert-routing/home_time_overdue", { routes }],
      ["DELETE", "/api/alert-routing/home_time_overdue", undefined],
      ["GET", "/api/roster/home-time/settings", undefined],
      ["PUT", "/api/roster/home-time/settings", HOME_TIME_DEFAULTS],
    ] as const) {
      const init = { method, ...(body ? { body: JSON.stringify(body) } : {}) };
      expect((await call(path, "admin", init)).status, `${method} ${path} admin`).toBe(200);
      expect((await call(path, "dispatcher", init)).status, `${method} ${path} dispatcher`).toBe(403);
      expect((await call(path, "nobody", init)).status, `${method} ${path} no session`).toBe(401);
    }
  });
});

describe("GET /api/alert-routing", () => {
  it("shows the catalogue's defaults for a carrier that has saved nothing, and says they are the defaults", async () => {
    seed();
    const view = (await (await call("/api/alert-routing", "admin")).json()) as AlertRoutingView;
    expect(view.alerts.map((a) => a.key)).toEqual(ALERT_CATALOGUE.map((a) => a.key));
    for (const a of view.alerts) {
      expect(a.usesDefaults, a.key).toBe(true);
      expect(a.routes, a.key).toEqual(alertDefinition(a.key as "home_time_overdue").defaults);
      expect(a.relations.map((x) => x.label)).toEqual(["Whoever marked the home time", "The truck's dispatcher"]);
      expect(a.roles.map((x) => x.key)).toContain("dispatcher");
      expect(a.roles.map((x) => x.key)).not.toContain("recruiter");
    }
    expectOrgScoped(rec, ORG);
  });

  it("shows the carrier's saved set for the alert it saved, and the defaults for the others", async () => {
    seed({ routes: [row({ channel: "email", enabled: false }), row({ recipient_kind: "user", recipient_key: DANA, channel: "email" })] });
    const view = (await (await call("/api/alert-routing", "admin")).json()) as AlertRoutingView;
    const overdue = view.alerts.find((a) => a.key === "home_time_overdue")!;
    expect(overdue.usesDefaults).toBe(false);
    expect(overdue.routes).toEqual([r("role", "fleet_manager", "email", false), r("user", DANA, "email")]);
    expect(view.alerts.find((a) => a.key === "home_time_return_due")!.usesDefaults).toBe(true);
  });

  it("lists by name only the active members who can receive these alerts — no suspended account, nobody without Dispatch", async () => {
    seed();
    const view = (await (await call("/api/alert-routing", "admin")).json()) as AlertRoutingView;
    // A member with no name is shown by their login email; sorted by what is shown.
    expect(view.members).toEqual([
      { userId: ADA, name: "Ada Admin", role: "admin", textReady: false },
      { userId: DANA, name: "Dana Dispatch", role: "dispatcher", textReady: true },
      { userId: FRAN, name: "fran@x.test", role: "fleet_manager", textReady: false },
    ]);
    // No Telnyx in the test env, and no saved window: the page is told both.
    expect(view.texts).toEqual({ available: false, quiet: { startMin: 1260, endMin: 420 } });
  });
});

describe("PUT /api/alert-routing/:alert", () => {
  it("writes every switch as a whole row on the route's own identity, signed, and audits what is on and off", async () => {
    seed();
    const routes = [r("relation", "marked_by", "bell"), r("role", "fleet_manager", "bell"), r("role", "fleet_manager", "email", false), r("user", DANA, "email")];
    expect((await put("/api/alert-routing/home_time_overdue", "admin", { routes })).status).toBe(200);
    const up = writes("notification_routes", "upsert")[0]!;
    expect(conflictOf(up)).toBe("org_id,alert,recipient_kind,recipient_key,channel");
    const payload = up.write!.payload as Record<string, unknown>[];
    expect(payload).toHaveLength(4);
    expect(payload[2]).toMatchObject({ org_id: ORG, alert: "home_time_overdue", recipient_kind: "role", recipient_key: "fleet_manager", channel: "email", enabled: false, updated_by: ADA });
    expect(payload.every((p) => typeof p.updated_at === "string")).toBe(true);
    expect(writes("notification_routes", "delete")).toEqual([]);
    expect(audits()[0]).toMatchObject({
      org_id: ORG,
      actor_id: ADA,
      action: "settings.notification_routes_saved",
      entity_id: ORG,
      meta: { alert: "home_time_overdue", on: ["relation:marked_by:bell", "role:fleet_manager:bell", `user:${DANA}:email`], off: ["role:fleet_manager:email"] },
    });
    expectOrgScoped(rec, ORG);
  });

  it("removes the rows the page no longer lists — and only this alert's", async () => {
    seed({
      routes: [
        row({ id: "70000000-0000-4000-8000-000000000001" }),
        row({ id: "70000000-0000-4000-8000-000000000002", recipient_kind: "user", recipient_key: DANA, channel: "email" }),
        row({ id: "70000000-0000-4000-8000-000000000003", alert: "home_time_truck_limit", recipient_kind: "user", recipient_key: DANA, channel: "email" }),
      ],
    });
    expect((await put("/api/alert-routing/home_time_overdue", "admin", { routes: [r("role", "fleet_manager", "bell")] })).status).toBe(200);
    const del = writes("notification_routes", "delete");
    expect(del).toHaveLength(1);
    expect(del[0]!.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "alert", val: "home_time_overdue" }, { col: "id", val: ["70000000-0000-4000-8000-000000000002"] }]));
    // The switches are written before anything is removed: a failed removal leaves the alert routed.
    const order = rec.forTable("notification_routes").filter((q) => q.write).map((q) => q.write!.method);
    expect(order).toEqual(["upsert", "delete"]);
  });

  it.each([
    ["a set that reaches nobody", [r("role", "fleet_manager", "bell", false)], /cannot be sent to nobody/],
    ["a role that cannot view Dispatch", [r("role", "recruiter", "bell")], /role cannot open/],
    ["a person who cannot view Dispatch", [r("user", REX, "bell")], /not an active member/],
    ["a suspended person", [r("user", GONE, "bell")], /not an active member/],
    ["the same switch twice", [r("role", "fleet_manager", "bell"), r("role", "fleet_manager", "bell")], /twice/],
  ])("refuses %s with the reason, and writes nothing", async (_name, routes, reason) => {
    seed();
    const res = await put("/api/alert-routing/home_time_overdue", "admin", { routes });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(reason);
    expect(rec.forTable("notification_routes").filter((q) => q.write)).toEqual([]);
    expect(audits()).toEqual([]);
  });

  it("answers 404 for an alert that is not in the catalogue, and 400 for a channel that does not exist", async () => {
    seed();
    expect((await put("/api/alert-routing/fuel_theft", "admin", { routes: [r("role", "fleet_manager", "bell")] })).status).toBe(404);
    expect((await put("/api/alert-routing/home_time_overdue", "admin", { routes: [{ ...r("role", "fleet_manager", "bell"), channel: "fax" }] })).status).toBe(400);
    expect(rec.forTable("notification_routes").filter((q) => q.write)).toEqual([]);
  });
});

describe("DELETE /api/alert-routing/:alert", () => {
  it("puts the alert back on the defaults by removing its rows, and audits it", async () => {
    seed({ routes: [row({ id: "70000000-0000-4000-8000-000000000001" })] });
    expect((await call("/api/alert-routing/home_time_overdue", "admin", { method: "DELETE" })).status).toBe(200);
    expect(writes("notification_routes", "delete")[0]!.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "alert", val: "home_time_overdue" }]));
    expect(audits()[0]).toMatchObject({ action: "settings.notification_routes_reset", actor_id: ADA, meta: { alert: "home_time_overdue" } });
  });

  it("records nothing when the alert was already on the defaults", async () => {
    seed();
    expect((await call("/api/alert-routing/home_time_overdue", "admin", { method: "DELETE" })).status).toBe(200);
    expect(audits()).toEqual([]);
  });
});

describe("/api/roster/home-time/settings", () => {
  it("reads the defaults for a carrier that has saved none, and the carrier's own once saved", async () => {
    seed();
    expect(await (await call("/api/roster/home-time/settings", "admin")).json()).toEqual({ settings: HOME_TIME_DEFAULTS });
    seed({ settings: [{ org_id: ORG, return_due_hours: 48, overdue_after_hours: 4, truck_limit_days: 10 }] });
    expect(await (await call("/api/roster/home-time/settings", "admin")).json()).toEqual({ settings: { returnDueHours: 48, overdueAfterHours: 4, truckLimitDays: 10 } });
  });

  it("saves all three numbers as one whole row, and the audit row keeps the old numbers beside the new", async () => {
    seed({ settings: [{ org_id: ORG, return_due_hours: 48, overdue_after_hours: 4, truck_limit_days: 10 }] });
    const next = { returnDueHours: 12, overdueAfterHours: 0, truckLimitDays: 14 };
    expect((await put("/api/roster/home-time/settings", "admin", next)).status).toBe(200);
    const up = writes("home_time_settings", "upsert")[0]!;
    expect(up.write!.payload).toMatchObject({ org_id: ORG, return_due_hours: 12, overdue_after_hours: 0, truck_limit_days: 14, updated_by: ADA });
    expect(conflictOf(up)).toBe("org_id");
    expect(audits()[0]).toMatchObject({ action: "settings.home_time_alerts_saved", actor_id: ADA, entity_id: ORG, meta: { before: { returnDueHours: 48, overdueAfterHours: 4, truckLimitDays: 10 }, after: next } });
    expectOrgScoped(rec, ORG);
  });

  it("refuses a number outside the table's range before any write", async () => {
    seed();
    for (const bad of [{ returnDueHours: 0 }, { returnDueHours: 169 }, { overdueAfterHours: -1 }, { truckLimitDays: 61 }, { truckLimitDays: 2.5 }]) {
      expect((await put("/api/roster/home-time/settings", "admin", { ...HOME_TIME_DEFAULTS, ...bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect(writes("home_time_settings", "upsert")).toEqual([]);
  });
});

describe("GET /api/me/alerts", () => {
  const mine = async (token: string) => ((await (await call("/api/me/alerts", token)).json()) as MyAlerts).alerts;

  it("tells a fleet manager what they always get, and a dispatcher what they get when the period or the truck is theirs", async () => {
    seed();
    const fm = await mine("fleet_manager");
    expect(fm.find((a) => a.key === "home_time_overdue")).toMatchObject({ label: "Home time overstayed", always: ["bell", "email"], whenMine: [] });
    const d = await mine("dispatcher");
    expect(d.find((a) => a.key === "home_time_overdue")).toMatchObject({
      always: [],
      whenMine: [
        { relation: "marked_by", label: "Whoever marked the home time", channels: ["bell"] },
        { relation: "truck_dispatcher", label: "The truck's dispatcher", channels: ["bell"] },
      ],
    });
    expectOrgScoped(rec, ORG);
  });

  it("follows the carrier's saved routes, the person's own switch included", async () => {
    seed({ routes: [row({}), row({ channel: "email" }), row({ recipient_kind: "user", recipient_key: FRAN, channel: "email", enabled: false })] });
    expect((await mine("fleet_manager")).find((a) => a.key === "home_time_overdue")!.always).toEqual(["bell"]);
  });

  it("lists nothing for somebody who cannot view Dispatch, and needs a session", async () => {
    seed();
    expect(await mine("recruiter")).toEqual([]);
    expect((await call("/api/me/alerts", "nobody")).status).toBe(401);
  });
});

describe("the hours a text is held (D-HT18)", () => {
  it("is saved as one whole row by whoever holds the Notifications screen, audited with the old window beside the new", async () => {
    seed();
    const next = { startMin: 1320, endMin: 360 };
    expect((await put("/api/alert-routing/text-hours", "dispatcher", next)).status).toBe(403);
    expect((await put("/api/alert-routing/text-hours", "admin", next)).status).toBe(200);
    expect(rec.writtenRows("notification_channel_settings")).toEqual([expect.objectContaining({ org_id: ORG, sms_quiet_start_min: 1320, sms_quiet_end_min: 360, updated_by: ADA })]);
    expect(audits()[0]).toMatchObject({ action: "settings.alert_text_hours_saved", meta: { before: { startMin: 1260, endMin: 420 }, after: next } });
    // "text-hours" is a path of its own, never an alert's key.
    expect(rec.forTable("notification_routes").filter((q) => q.write)).toEqual([]);
  });

  it("refuses a window whose ends are equal, or off the clock", async () => {
    seed();
    expect((await put("/api/alert-routing/text-hours", "admin", { startMin: 420, endMin: 420 })).status).toBe(400);
    expect((await put("/api/alert-routing/text-hours", "admin", { startMin: 1440, endMin: 0 })).status).toBe(400);
    expect(rec.writtenRows("notification_channel_settings")).toEqual([]);
  });
});

describe("/api/me/alerts/phone — the caller's own number", () => {
  const post = (path: string, token: string, body: unknown = {}) => call(path, token, { method: "POST", body: JSON.stringify(body) });

  it("answers for the caller's own row, last four digits only, to any member — and to nobody without a session", async () => {
    seed();
    expect(await (await call("/api/me/alerts/phone", "dispatcher")).json()).toEqual({ available: false, state: "verified", last4: "0100" });
    expect(await (await call("/api/me/alerts/phone", "recruiter")).json()).toEqual({ available: false, state: "none", last4: null });
    expect((await call("/api/me/alerts/phone", "nobody")).status).toBe(401);
    const read = rec.forTable("notification_contacts")[0]!;
    expect(read.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "user_id", val: DANA }]));
  });

  it("will not start without the agreement, and says so plainly when this server cannot text", async () => {
    seed();
    expect((await post("/api/me/alerts/phone", "dispatcher", { phone: "708 555 0100" })).status).toBe(400);
    const res = await post("/api/me/alerts/phone", "dispatcher", { phone: "708 555 0100", agreed: true });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unavailable");
    expect(rec.forTable("notification_contacts").filter((q) => q.write)).toEqual([]);
  });

  it("refuses a code when none was asked for, and a code that is not six digits", async () => {
    seed();
    expect((await post("/api/me/alerts/phone/confirm", "dispatcher", { code: "123456" })).status).toBe(422);
    expect((await post("/api/me/alerts/phone/confirm", "dispatcher", { code: "12345" })).status).toBe(400);
  });

  it("stops the caller's own texts and nobody else's, and audits it", async () => {
    seed();
    expect((await post("/api/me/alerts/phone/stop", "dispatcher")).status).toBe(200);
    const up = rec.forTable("notification_contacts").find((q) => q.write?.method === "update")!;
    expect(up.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "user_id", val: DANA }]));
    expect(audits()[0]).toMatchObject({ action: "alerts.text_stopped", actor_id: DANA, meta: { by: "page" } });
    expectOrgScoped(rec, ORG);
  });
});

describe("on the carrier's own Permissions page (Q-HT8)", () => {
  const fmNoDispatch = [{ org_id: ORG, role: "fleet_manager", section: "dispatch", access: "none" }];
  const rexGiven = [{ org_id: ORG, user_id: REX, section: "dispatch", access: "view" }];

  it("the Settings page offers neither a role the carrier took Dispatch from nor its default switches, and lists its people no more", async () => {
    seed({ roleAccess: fmNoDispatch });
    const view = (await (await call("/api/alert-routing", "admin")).json()) as AlertRoutingView;
    const overdue = view.alerts.find((a) => a.key === "home_time_overdue")!;
    expect(overdue.roles.map((x) => x.key)).not.toContain("fleet_manager");
    expect(overdue.roles.map((x) => x.key)).toContain("dispatcher");
    expect(overdue.routes.some((x) => x.recipientKey === "fleet_manager")).toBe(false);
    expect(overdue.routes).toEqual([r("relation", "marked_by", "bell"), r("relation", "truck_dispatcher", "bell")]);
    expect(view.members.map((m) => m.userId)).not.toContain(FRAN);
    expectOrgScoped(rec, ORG);
  });

  it("lists a person the carrier gave Dispatch to by name, and lets a route name them", async () => {
    seed({ userAccess: rexGiven });
    const view = (await (await call("/api/alert-routing", "admin")).json()) as AlertRoutingView;
    expect(view.members.map((m) => m.userId)).toContain(REX);
    expect((await put("/api/alert-routing/home_time_overdue", "admin", { routes: [r("user", REX, "bell")] })).status).toBe(200);
  });

  it("refuses to save a switch for a role that can no longer open Dispatch", async () => {
    seed({ roleAccess: fmNoDispatch });
    const res = await put("/api/alert-routing/home_time_overdue", "admin", { routes: [r("role", "fleet_manager", "bell")] });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/role cannot open/);
    expect(rec.forTable("notification_routes").filter((q) => q.write)).toEqual([]);
  });

  it("My alerts lists nothing for a fleet manager without Dispatch, and lists them for a recruiter given it by name", async () => {
    seed({ roleAccess: fmNoDispatch, userAccess: rexGiven });
    const mine = async (token: string) => ((await (await call("/api/me/alerts", token)).json()) as MyAlerts).alerts;
    expect(await mine("fleet_manager")).toEqual([]);
    expect((await mine("recruiter")).map((a) => a.key)).toContain("home_time_overdue");
  });
});
