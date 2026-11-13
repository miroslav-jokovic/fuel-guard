import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HOME_TIME_DEFAULTS, type AuthContext, type HomeTimeListResponse, type HomeTimePeriod } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";

/**
 * `/api/roster/home-time` through the real mount (HOME-TIME-PLAN §3.1, §3.2, step HT2): who reads and who
 * marks, what each write asks of the database and records in the audit log, what is refused before a
 * write, and that every query is the session's carrier and our own rows. The SQL the two functions run
 * is `supabase/tests/home-time.test.mjs`'s.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NO_DISPATCH_ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4e";
const OTHER_ORG = "99999999-0000-4000-8000-000000000000";
const MARCUS = "66666666-8888-4999-8aaa-bbbbbbbbbbb1";
const RAY = "66666666-8888-4999-8aaa-bbbbbbbbbbb2";
const APPLICANT = "66666666-8888-4999-8aaa-bbbbbbbbbbb3";
const TRUCK = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const PERIOD = "50000000-0000-4000-8000-00000000000a";
const NEWER = "50000000-0000-4000-8000-00000000000b";
const DANA = "90000000-0000-4000-8000-0000000000a0";

const ctx = (userId: string, role: string, orgId = ORG): AuthContext => ({ userId, email: `${role}@x.test`, orgId, role } as AuthContext);
const CTX: Record<string, AuthContext> = {
  dispatcher: ctx(DANA, "dispatcher"),
  admin: ctx("90000000-0000-4000-8000-0000000000a1", "admin"),
  // Reads Dispatch (`dispatch: view`) and holds no permission to mark.
  auditor: ctx("90000000-0000-4000-8000-0000000000a2", "auditor"),
  // No Dispatch at all.
  recruiter: ctx("90000000-0000-4000-8000-0000000000a3", "recruiter"),
  driver: ctx("90000000-0000-4000-8000-0000000000a4", "driver"),
  noModule: ctx("90000000-0000-4000-8000-0000000000a5", "dispatcher", NO_DISPATCH_ORG),
};

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const hoursFromNow = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const call = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/roster/home-time${path}`, { ...init, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } });
const post = (path: string, token: string, body: unknown = {}) => call(path, token, { method: "POST", body: JSON.stringify(body) });
const patch = (path: string, token: string, body: unknown) => call(path, token, { method: "PATCH", body: JSON.stringify(body) });

/** A stored period of ours, home since two days ago and due back in three. */
const stored = (o: Record<string, unknown> = {}) => ({
  id: PERIOD,
  org_id: ORG,
  provider: "silvicom",
  driver_id: MARCUS,
  vehicle_id: TRUCK,
  start_at: hoursFromNow(-48),
  expected_return_at: hoursFromNow(72),
  end_at: null,
  end_reason: null,
  canceled_at: null,
  truck_disposition: "with_driver",
  created_by: DANA,
  created_at: hoursFromNow(-48),
  updated_at: hoursFromNow(-48),
  ...o,
});

function seed(over: { periods?: Record<string, unknown>[]; rpc?: Record<string, unknown>; grants?: Record<string, unknown>[]; settings?: Record<string, unknown>[] } = {}): SupabaseRecorder {
  rec = createSupabaseRecorder({
    tables: {
      org_role_surface_access: [],
      user_surface_access: [],
      org_role_permissions: postgrestFixture((over.grants ?? []).map((g) => ({ org_id: ORG, ...g }))),
      drivers: postgrestFixture([
        { id: MARCUS, org_id: ORG, full_name: "Marcus Hill", status: "active", archived_at: null },
        { id: RAY, org_id: ORG, full_name: "Ray Diaz", status: "active", archived_at: null },
        { id: APPLICANT, org_id: ORG, full_name: "Ann Applicant", status: "applicant", archived_at: null },
      ]),
      vehicles: postgrestFixture([{ id: TRUCK, org_id: ORG, unit_number: "702", status: "active", assigned_driver_id: MARCUS, co_driver_id: null }]),
      driver_time_off: postgrestFixture(over.periods ?? [stored()]),
      home_time_settings: postgrestFixture(over.settings ?? []),
      user_profiles: [],
      audit_logs: [],
    },
    rpc: (fn: string, args: unknown) => {
      if (over.rpc && fn in over.rpc) return over.rpc[fn];
      if (fn === "org_module_enabled") return (args as { p_org: string }).p_org === ORG;
      if (fn === "org_member_directory") return [{ user_id: DANA, email: "dana@x.test", full_name: "Dana Dispatch" }];
      if (fn === "home_time_mark") return PERIOD;
      if (fn === "home_time_reopen") return PERIOD;
      return null;
    },
  });
  holder.client = rec.client;
  return rec;
}

const rpcArgs = (fn: string) => rec.rpcs().filter((r) => r.fn === fn).map((r) => r.args as Record<string, unknown>);
const audits = () => rec.writtenRows("audit_logs") as Record<string, unknown>[];
const updates = () => rec.forTable("driver_time_off").filter((q) => q.write?.method === "update");
// `user_profiles` is keyed by user; `memberLabels` reads it only for somebody who left the carrier.
const EXEMPT = { exempt: ["user_profiles"] };
const mark = (o: Record<string, unknown> = {}) => ({
  driverId: MARCUS,
  startAt: hoursFromNow(0),
  expectedReturnAt: hoursFromNow(96),
  disposition: "with_driver",
  vehicleId: TRUCK,
  ...o,
});

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

describe("who reads and who marks (D-HT7)", () => {
  it("lets anybody who views Dispatch read, and refuses a role without Dispatch, a driver, and a carrier without the module", async () => {
    seed();
    expect((await call("/", "dispatcher")).status).toBe(200);
    expect((await call("/", "auditor")).status).toBe(200);
    expect((await call("/", "recruiter")).status).toBe(403);
    expect((await call("/", "driver")).status).toBe(403);
    const off = await call("/", "noModule");
    expect(off.status).toBe(403);
    expect(((await off.json()) as { error: { code: string } }).error.code).toBe("module_disabled");
  });

  it("lets a dispatcher and an admin mark, and refuses a reader who only views Dispatch — before anything is written", async () => {
    seed({ periods: [] });
    expect((await post("/", "auditor", mark())).status).toBe(403);
    expect(rpcArgs("home_time_mark")).toEqual([]);
    expect(audits()).toEqual([]);
    seed();
    expect((await post("/", "dispatcher", mark())).status).toBe(201);
    seed();
    expect((await post("/", "admin", mark())).status).toBe(201);
  });

  it("asks the same permission in front of every write", async () => {
    seed();
    expect((await patch(`/${PERIOD}`, "auditor", { expectedReturnAt: hoursFromNow(120) })).status).toBe(403);
    expect((await post(`/${PERIOD}/end`, "auditor")).status).toBe(403);
    expect((await post(`/${PERIOD}/cancel`, "auditor")).status).toBe(403);
    expect((await post(`/${PERIOD}/reopen`, "auditor")).status).toBe(403);
    expect(updates()).toEqual([]);
    expect(rpcArgs("home_time_reopen")).toEqual([]);
  });

  it("reads the carrier's switch: dispatchers switched off cannot mark, and the read is of this carrier's switches", async () => {
    seed({ grants: [{ role: "dispatcher", permission: "roster.home_time", allowed: false }] });
    expect((await post("/", "dispatcher", mark())).status).toBe(403);
    expect(rec.forTable("org_role_permissions")[0]!.filters()).toContainEqual({ col: "org_id", val: ORG });
  });
});

describe("GET / — the Home time tab", () => {
  it("lists live periods with their names and state, closed ones apart, and the default thresholds when the carrier saved none", async () => {
    seed({
      periods: [
        stored(),
        stored({ id: NEWER, driver_id: RAY, vehicle_id: null, truck_disposition: "no_truck", expected_return_at: hoursFromNow(-3) }),
        stored({ id: "50000000-0000-4000-8000-00000000000c", start_at: hoursFromNow(-200), end_at: hoursFromNow(-100), end_reason: "returned" }),
        stored({ id: "50000000-0000-4000-8000-00000000000d", org_id: OTHER_ORG }),
        stored({ id: "50000000-0000-4000-8000-00000000000e", provider: "mcleod" }),
      ],
    });
    const res = await call("/", "dispatcher");
    const body = (await res.json()) as HomeTimeListResponse;
    // Overdue first, then who is home.
    expect(body.live.map((p) => [p.driverName, p.state, p.unitNumber])).toEqual([["Ray Diaz", "overdue", null], ["Marcus Hill", "active", "702"]]);
    expect(body.live[1]).toMatchObject({ markedByName: "Dana Dispatch", disposition: "with_driver" });
    expect(body.recent.map((p) => p.state)).toEqual(["ended"]);
    expect(body.settings).toEqual(HOME_TIME_DEFAULTS);
    expectOrgScoped(rec, ORG, EXEMPT);
    for (const q of rec.forTable("driver_time_off")) expect(q.filters()).toContainEqual({ col: "provider", val: "silvicom" });
  });

  it("serves the carrier's own thresholds once saved", async () => {
    seed({ settings: [{ org_id: ORG, return_due_hours: 12, overdue_after_hours: 4, truck_limit_days: 10 }] });
    const body = (await (await call("/", "dispatcher")).json()) as HomeTimeListResponse;
    expect(body.settings).toEqual({ returnDueHours: 12, overdueAfterHours: 4, truckLimitDays: 10 });
  });
});

describe("GET /drivers — who the form can be opened on", () => {
  it("lists drivers who may hold a truck with the truck each is paired to, and pre-selects the last answer only when it still fits", async () => {
    seed({ periods: [stored({ end_at: hoursFromNow(-1), end_reason: "returned", truck_disposition: "at_yard" }), stored({ id: NEWER, driver_id: RAY, truck_disposition: "at_yard", vehicle_id: TRUCK, end_at: hoursFromNow(-1), end_reason: "returned" })] });
    const { drivers } = (await (await call("/drivers", "dispatcher")).json()) as { drivers: Record<string, unknown>[] };
    expect(drivers).toEqual([
      { driverId: MARCUS, driverName: "Marcus Hill", vehicleId: TRUCK, unitNumber: "702", lastDisposition: "at_yard" },
      // Ray had a truck then and has none now: "stays at the yard" no longer fits.
      { driverId: RAY, driverName: "Ray Diaz", vehicleId: null, unitNumber: null, lastDisposition: null },
    ]);
    expect(rec.forTable("drivers")[0]!.filters()).toContainEqual({ col: "status", val: ["active", "on_leave"] });
  });
});

describe("POST / — marking", () => {
  it("hands the database the session's carrier and person, and audits who, which truck and the times", async () => {
    seed();
    const body = mark();
    const res = await post("/", "dispatcher", body);
    expect(res.status).toBe(201);
    const { period } = (await res.json()) as { period: HomeTimePeriod };
    expect(period).toMatchObject({ id: PERIOD, driverName: "Marcus Hill", unitNumber: "702", state: "active" });
    expect(rpcArgs("home_time_mark")).toEqual([
      { p_org: ORG, p_driver: MARCUS, p_actor: DANA, p_start: body.startAt, p_expected_return: body.expectedReturnAt, p_disposition: "with_driver", p_vehicle: TRUCK },
    ]);
    expect(audits()[0]).toMatchObject({
      org_id: ORG,
      actor_id: DANA,
      action: "home_time.marked",
      entity: "driver_time_off",
      entity_id: PERIOD,
      meta: { driverId: MARCUS, vehicleId: TRUCK, disposition: "with_driver" },
    });
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("answers a second live period with 409 and the first one's id, and audits nothing", async () => {
    seed({ rpc: { home_time_mark: { error: { code: "HT010", details: PERIOD, message: "home_time_already_live" } } } });
    const res = await post("/", "dispatcher", mark());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "conflict" }, existingId: PERIOD });
    expect(audits()).toEqual([]);
  });

  it("refuses a return that has passed, a start too far back and a truck that disagrees, before the database is asked", async () => {
    seed();
    expect((await post("/", "dispatcher", mark({ startAt: hoursFromNow(-72), expectedReturnAt: hoursFromNow(-1) }))).status).toBe(422);
    expect((await post("/", "dispatcher", mark({ startAt: hoursFromNow(-31 * 24) }))).status).toBe(422);
    expect((await post("/", "dispatcher", mark({ vehicleId: null }))).status).toBe(400);
    expect((await post("/", "dispatcher", mark({ expectedReturnAt: "soon" }))).status).toBe(400);
    expect(rpcArgs("home_time_mark")).toEqual([]);
  });

  it("marks only a driver on the active roster of this carrier", async () => {
    seed();
    expect((await post("/", "dispatcher", mark({ driverId: APPLICANT }))).status).toBe(422);
    expect((await post("/", "dispatcher", mark({ driverId: "66666666-8888-4999-8aaa-bbbbbbbbbbb9" }))).status).toBe(404);
    expect(rpcArgs("home_time_mark")).toEqual([]);
    expect(rec.forTable("drivers").every((q) => q.filters().some((f) => f.col === "org_id" && f.val === ORG))).toBe(true);
  });
});

describe("PATCH /:id — changing", () => {
  it("moves the return on a live period with one conditional update, and audits the old and new time", async () => {
    const before = stored();
    seed({ periods: [before] });
    const to = hoursFromNow(120);
    const res = await patch(`/${PERIOD}`, "dispatcher", { expectedReturnAt: to });
    expect(res.status).toBe(200);
    const q = updates()[0]!;
    expect(q.write!.payload).toMatchObject({ expected_return_at: to, start_at: before.start_at, truck_disposition: "with_driver", updated_by: DANA });
    expect(q.filters()).toEqual(expect.arrayContaining([
      { col: "org_id", val: ORG }, { col: "provider", val: "silvicom" }, { col: "id", val: PERIOD }, { col: "end_at", val: null }, { col: "canceled_at", val: null },
    ]));
    expect(audits()[0]).toMatchObject({ action: "home_time.changed", entity_id: PERIOD, meta: { changed: { expectedReturnAt: { from: before.expected_return_at, to } } } });
  });

  it("sends the truck back to the yard on an overdue period without judging its passed return", async () => {
    seed({ periods: [stored({ expected_return_at: hoursFromNow(-6) })] });
    expect((await patch(`/${PERIOD}`, "dispatcher", { disposition: "at_yard" })).status).toBe(200);
    expect(updates()[0]!.write!.payload).toMatchObject({ truck_disposition: "at_yard" });
    expect(audits()[0]).toMatchObject({ meta: { changed: { disposition: { from: "with_driver", to: "at_yard" } } } });
  });

  it("refuses a new return that has passed, one not after the start, and a truck for a driver who had none", async () => {
    seed();
    expect((await patch(`/${PERIOD}`, "dispatcher", { expectedReturnAt: hoursFromNow(-1) })).status).toBe(422);
    expect((await patch(`/${PERIOD}`, "dispatcher", { expectedReturnAt: hoursFromNow(-60) })).status).toBe(422);
    seed({ periods: [stored({ truck_disposition: "no_truck", vehicle_id: null })] });
    expect((await patch(`/${PERIOD}`, "dispatcher", { disposition: "at_yard" })).status).toBe(422);
    expect(updates()).toEqual([]);
  });

  it("writes and audits nothing when the change moves nothing", async () => {
    const before = stored();
    seed({ periods: [before] });
    expect((await patch(`/${PERIOD}`, "dispatcher", { expectedReturnAt: before.expected_return_at, disposition: "with_driver" })).status).toBe(200);
    expect(updates()).toEqual([]);
    expect(audits()).toEqual([]);
  });

  it("answers a closed period with 409, another carrier's with 404, and a malformed id with 404", async () => {
    seed({ periods: [stored({ end_at: hoursFromNow(-1), end_reason: "returned" })] });
    expect((await patch(`/${PERIOD}`, "dispatcher", { expectedReturnAt: hoursFromNow(120) })).status).toBe(409);
    seed({ periods: [stored({ org_id: OTHER_ORG })] });
    expect((await patch(`/${PERIOD}`, "dispatcher", { expectedReturnAt: hoursFromNow(120) })).status).toBe(404);
    expect((await patch("/not-an-id", "dispatcher", { expectedReturnAt: hoursFromNow(120) })).status).toBe(404);
    expect(updates()).toEqual([]);
  });
});

describe("POST /:id/end, /cancel, /reopen", () => {
  it("ends a period now as 'returned', signed, with one conditional update, and audits it", async () => {
    seed();
    const res = await post(`/${PERIOD}/end`, "dispatcher");
    expect(res.status).toBe(200);
    const q = updates()[0]!;
    expect(q.write!.payload).toMatchObject({ end_reason: "returned", ended_by: DANA, updated_by: DANA });
    expect(Math.abs(Date.parse((q.write!.payload as { end_at: string }).end_at) - Date.now())).toBeLessThan(5000);
    expect(q.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "end_at", val: null }, { col: "canceled_at", val: null }]));
    expect(audits()[0]).toMatchObject({ action: "home_time.ended", entity_id: PERIOD });
  });

  it("refuses to end a period that has not started, and an end before the start or in the future", async () => {
    seed({ periods: [stored({ start_at: hoursFromNow(24), expected_return_at: hoursFromNow(96) })] });
    const early = await post(`/${PERIOD}/end`, "dispatcher");
    expect(early.status).toBe(422);
    expect(((await early.json()) as { error: { message: string } }).error.message).toMatch(/Cancel it instead/);
    seed();
    expect((await post(`/${PERIOD}/end`, "dispatcher", { endAt: hoursFromNow(-100) })).status).toBe(422);
    expect((await post(`/${PERIOD}/end`, "dispatcher", { endAt: hoursFromNow(5) })).status).toBe(422);
    expect(updates()).toEqual([]);
  });

  it("cancels a live period, signed, and answers 409 for one already closed and 404 for one that is not this carrier's", async () => {
    seed();
    expect((await post(`/${PERIOD}/cancel`, "dispatcher")).status).toBe(200);
    expect(updates()[0]!.write!.payload).toMatchObject({ canceled_by: DANA });
    expect(audits()[0]).toMatchObject({ action: "home_time.canceled", entity_id: PERIOD });
    seed({ periods: [stored({ canceled_at: hoursFromNow(-1) })] });
    expect((await post(`/${PERIOD}/cancel`, "dispatcher")).status).toBe(409);
    expect(audits()).toEqual([]);
    seed({ periods: [stored({ org_id: OTHER_ORG })] });
    expect((await post(`/${PERIOD}/cancel`, "dispatcher")).status).toBe(404);
  });

  it("reopens through the database's function with the session's carrier and person, and audits it", async () => {
    seed();
    expect((await post(`/${PERIOD}/reopen`, "dispatcher")).status).toBe(200);
    expect(rpcArgs("home_time_reopen")).toEqual([{ p_org: ORG, p_id: PERIOD, p_actor: DANA }]);
    expect(audits()[0]).toMatchObject({ action: "home_time.reopened", entity_id: PERIOD });
  });

  it("turns the function's refusals into answers: a newer live period (409 with its id), not ended (409), not this carrier's (404)", async () => {
    seed({ rpc: { home_time_reopen: { error: { code: "HT010", details: NEWER, message: "home_time_already_live" } } } });
    const newer = await post(`/${PERIOD}/reopen`, "dispatcher");
    expect(newer.status).toBe(409);
    expect(await newer.json()).toMatchObject({ existingId: NEWER });
    seed({ rpc: { home_time_reopen: { error: { code: "HT011", message: "home_time_not_ended" } } } });
    expect((await post(`/${PERIOD}/reopen`, "dispatcher")).status).toBe(409);
    seed({ rpc: { home_time_reopen: { error: { code: "HT020", message: "home_time_not_found" } } } });
    expect((await post(`/${PERIOD}/reopen`, "dispatcher")).status).toBe(404);
    expect(audits()).toEqual([]);
  });
});
