import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { followUpDetailSchema, followUpListSchema, followUpRulesSchema, followUpTruckCodesSchema, type UserRole } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/follow-ups` (WARNING-DESK-PLAN WD4) through the shipped gates — only `requireAuth` and Samsara's
 * two network calls are replaced. The promises under test: the desk sees every category and dispatch sees
 * Route alone (D-WD13); reading is not acting (an auditor changes nothing); an action names its actor and
 * the version it saw; a video is fetched only for an event that belongs to the follow-up, and a crash's is
 * never fetched (D-WD7); and only an admin touches the rules (owner ruling 2026-11-26).
 */
const ORG = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-000000000031";
const FU_ATIS = "00000000-0000-4000-8000-0000000000f1";
const FU_ROUTE = "00000000-0000-4000-8000-0000000000f2";
const FU_SAFETY = "00000000-0000-4000-8000-0000000000f3";
const FU_STOP = "00000000-0000-4000-8000-0000000000f4";
const TRUCK = "00000000-0000-4000-8000-0000000000b1";
const TRAILER = "00000000-0000-4000-8000-0000000000b2";
const DRIVER = "00000000-0000-4000-8000-0000000000d1";
const SAFE_DRIVER = "00000000-0000-4000-8000-0000000000d2";

let rec: SupabaseRecorder;
let surfaceGrants: Record<string, Record<string, boolean>> = {};
let rpcResult: unknown = null;
const audit = vi.hoisted(() => vi.fn(async () => true));
const samsara = vi.hoisted(() => ({
  configs: vi.fn(async () => [{ id: "77", name: "Out of route", isEnabled: true, triggerTypeIds: [1027] }]),
  video: vi.fn(async () => [{ url: "https://us4-safetymediadelivery.samsara.com/clip.mp4?exp=1", input: "dashcamForwardFacing" }]),
  codes: vi.fn(),
}));

vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../lib/audit.js", () => ({ writeAudit: audit }));
vi.mock("../../samsara/index.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../samsara/index.js")>();
  return { ...real, readAlertConfigurations: samsara.configs, fetchSafetyEventVideo: samsara.video, readTruckFaultCodes: samsara.codes };
});
vi.mock("../../../middleware/auth.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../middleware/auth.js")>();
  return {
    ...real,
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: USER, orgId: ORG, role: req.header("x-role") as UserRole, email: "t@example.test", sections: null } as never;
      next();
    },
  };
});

const { followUpsRouter } = await import("./index.js");
const { clearConfigCache } = await import("../ruleViews.js");

const base = {
  org_id: ORG, status: "new", outcome: null, active_count: 0, contacted_at: null, closed_at: null, assignee_id: null, version: 3,
  driver_samsara_id: null, driver_name: null,
};
const FOLLOW_UPS = [
  // A trailer: the driver is reached through the trailer's truck (D-WD15, "trailer pairing").
  { ...base, id: FU_ATIS, rule_key: "atis", category: "maintenance", severity: "normal", subject_kind: "trailer", subject_samsara_id: "s-tr", subject_name: "R535973",
    warning_count: 5, active_count: 1, first_at: "2026-11-24T10:00:00Z", last_at: "2026-11-26T10:00:00Z" },
  { ...base, id: FU_ROUTE, rule_key: "alert:77", category: "route", severity: "normal", subject_kind: "truck", subject_samsara_id: "s-v", subject_name: "847",
    warning_count: 3, first_at: "2026-11-20T10:00:00Z", last_at: "2026-11-26T09:00:00Z" },
  { ...base, id: FU_SAFETY, rule_key: "safety_serious", category: "safety", severity: "high", subject_kind: "driver", subject_samsara_id: "s-d2", subject_name: "Ana Safe",
    warning_count: 1, first_at: "2026-11-26T08:00:00Z", last_at: "2026-11-26T08:00:00Z" },
  { ...base, id: FU_STOP, rule_key: "lamp_stop", category: "maintenance", severity: "urgent", subject_kind: "truck", subject_samsara_id: "s-v", subject_name: "847",
    warning_count: 1, active_count: 1, first_at: "2026-11-26T11:00:00Z", last_at: "2026-11-26T11:00:00Z" },
];

/** Rows that survive the query's own eq / neq / in filters — so a test sees what the filters would return. */
function filtered(rows: Record<string, unknown>[], q: RecordedQuery): Record<string, unknown>[] {
  return rows.filter((r) =>
    q.ops.every((op) => {
      const [col, val] = op.args as [string, unknown];
      if (typeof col !== "string" || !(col in r)) return true;
      if (op.method === "eq") return r[col] === val;
      if (op.method === "neq") return r[col] !== val;
      if (op.method === "in") return (val as unknown[]).includes(r[col]);
      return true;
    }),
  );
}

const WARNINGS = [
  { id: "00000000-0000-4000-8000-0000000000e1", source: "safety", source_key: "evt-1", kind: "safety_serious", subject_kind: "driver", vehicle_samsara_id: "s-v",
    trailer_samsara_id: null, driver_samsara_id: "s-d2", unit_name: "847", driver_name: "Ana Safe", label: "SevereSpeeding", happened_at: "2026-11-26T08:00:00Z",
    ended_at: "2026-11-26T08:00:00Z", still_active: false, samsara_url: "https://cloud.samsara.com/o/1/safety/evt-1", detail: { eventState: "needsCoaching", hasVideo: true },
    updated_at: "2026-11-26T08:05:00Z", org_id: ORG },
  { id: "00000000-0000-4000-8000-0000000000e2", source: "safety", source_key: "evt-crash", kind: "safety_serious", subject_kind: "driver", vehicle_samsara_id: "s-v",
    trailer_samsara_id: null, driver_samsara_id: "s-d2", unit_name: "847", driver_name: "Ana Safe", label: "Crash", happened_at: "2026-11-26T08:30:00Z",
    ended_at: "2026-11-26T08:30:00Z", still_active: false, samsara_url: "https://cloud.samsara.com/o/1/safety/evt-crash", detail: { hasVideo: true },
    updated_at: "2026-11-26T08:35:00Z", org_id: ORG },
];

let lampRows: Record<string, unknown>[] = [];
const code = (spn: number, module = 0) => ({ module, moduleName: "Engine #1", spn, fmi: 3, description: "Engine Coolant Level 1", fmiDescription: null, makerSpecific: false, occurrences: 2 });

beforeEach(() => {
  surfaceGrants = {};
  lampRows = [];
  samsara.codes.mockReset();
  rpcResult = { follow_up_id: FU_ROUTE, from_status: "new", to_status: "called", version: 4 };
  audit.mockClear();
  samsara.video.mockClear();
  clearConfigCache();
  rec = createSupabaseRecorder({
    tables: {
      org_role_surface_access: (q) => {
        const role = q.filters().find((f) => f.col === "role")?.val as string;
        return Object.entries(surfaceGrants[role] ?? {}).map(([surface_key, allowed]) => ({ role, surface_key, allowed }));
      },
      user_surface_access: [],
      follow_ups: (q) => filtered(FOLLOW_UPS, q),
      follow_up_rules: [],
      follow_up_actions: [{ id: "00000000-0000-4000-8000-0000000000a1", action: "called", note: "Driver checked the tire", actor_id: USER, created_at: "2026-11-26T12:00:00Z" }],
      samsara_warnings: (q) => filtered([...WARNINGS, ...lampRows], q),
      trailers: [{ id: TRAILER, samsara_asset_id: "s-tr", unit_number: "R535973", assigned_vehicle_id: TRUCK }],
      vehicles: [{ id: TRUCK, samsara_vehicle_id: "s-v", unit_number: "847", assigned_driver_id: DRIVER }],
      drivers: (q) =>
        filtered(
          [
            { id: DRIVER, samsara_driver_id: "s-d1", first_name: "Angel", last_name: "Perez", phone: "512-555-0134" },
            { id: SAFE_DRIVER, samsara_driver_id: "s-d2", first_name: "Ana", last_name: "Safe", phone: null },
          ],
          q,
        ),
    },
    rpc: (fn: string) => {
      if (fn === "transition_follow_up") return rpcResult;
      if (fn === "org_member_directory") return [{ user_id: USER, full_name: "Mira Desk", email: "mira@example.test", role: "technician" }];
      return null;
    },
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test reads the JSON answer by field; the schemas are asserted separately
async function call(role: UserRole, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const app = express();
  app.use(express.json());
  app.use("/api/follow-ups", followUpsRouter());
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

const SURFACE_TABLES = ["org_role_surface_access", "user_surface_access"];
const categoryFilter = () => rec.forTable("follow_ups").map((q) => q.ops.find((o) => o.method === "in" && o.args[0] === "category")?.args[1]);

describe("GET /api/follow-ups — the desk's list", () => {
  it("gives the desk every category, urgent first, with who to call and which record named them", async () => {
    const r = await call("technician", "GET", "/api/follow-ups");
    expect(r.status).toBe(200);
    expect(followUpListSchema.safeParse(r.json).success).toBe(true);
    expect(r.json.categories).toEqual(["maintenance", "safety", "compliance", "route"]);
    expect(r.json.lines.map((l: { id: string }) => l.id)).toEqual([FU_STOP, FU_SAFETY, FU_ROUTE, FU_ATIS]);
    const atis = r.json.lines.find((l: { id: string }) => l.id === FU_ATIS);
    expect(atis.trailer).toEqual({ id: TRAILER, number: "R535973" });
    expect(atis.truck).toEqual({ id: TRUCK, number: "847" });
    expect(atis.driver).toEqual({ id: DRIVER, name: "Angel Perez", phone: "512-555-0134", source: "trailer_pairing" });
    expect(atis.ruleLabel).toBe("Trailer tire losing air (ATIS lamp)");
    // An alert rule is labelled with its Samsara configuration's own name.
    expect(r.json.lines.find((l: { id: string }) => l.id === FU_ROUTE).ruleLabel).toBe("Out of route");
    expect(r.json.counts).toEqual({ maintenance: 2, safety: 1, compliance: 0, route: 1 });
    expectOrgScoped(rec, ORG, { exempt: SURFACE_TABLES });
  });

  it("gives a dispatcher Route alone — the query asks for nothing else", async () => {
    const r = await call("dispatcher", "GET", "/api/follow-ups?category=all");
    expect(r.status).toBe(200);
    expect(r.json.categories).toEqual(["route"]);
    expect(r.json.lines.map((l: { id: string }) => l.id)).toEqual([FU_ROUTE]);
    for (const f of categoryFilter()) expect(f).toEqual(["route"]);
    expectOrgScoped(rec, ORG, { exempt: SURFACE_TABLES });
  });

  it("refuses a dispatcher the safety category instead of answering with an empty list", async () => {
    expect((await call("dispatcher", "GET", "/api/follow-ups?category=safety")).status).toBe(403);
    expect(rec.forTable("follow_ups")).toHaveLength(0);
  });

  it("refuses a role with neither screen at the door", async () => {
    expect((await call("recruiter", "GET", "/api/follow-ups")).status).toBe(403);
  });

  it("filters Mine on the caller's own id", async () => {
    await call("technician", "GET", "/api/follow-ups?mine=1&status=closed");
    const list = rec.forTable("follow_ups")[0]!;
    expect(list.filters()).toEqual(expect.arrayContaining([{ col: "assignee_id", val: USER }, { col: "status", val: "closed" }]));
  });
});

describe("GET /api/follow-ups/:id — one line", () => {
  it("answers a dispatcher's request for a safety line as missing, so categories cannot be probed", async () => {
    expect((await call("dispatcher", "GET", `/api/follow-ups/${FU_SAFETY}`)).status).toBe(404);
  });

  it("gives the warnings in time order with their video ids, and the history by name", async () => {
    const r = await call("technician", "GET", `/api/follow-ups/${FU_SAFETY}`);
    expect(r.status).toBe(200);
    expect(followUpDetailSchema.safeParse(r.json).success).toBe(true);
    expect(r.json.canAct).toBe(true);
    expect(r.json.warnings.map((w: { videoEventId: string }) => w.videoEventId)).toEqual(["evt-1", "evt-crash"]);
    expect(r.json.warnings[0].coachingState).toBe("needsCoaching");
    expect(r.json.actions[0]).toMatchObject({ action: "called", actorName: "Mira Desk", note: "Driver checked the tire" });
    expectOrgScoped(rec, ORG, { exempt: SURFACE_TABLES });
  });

  it("lets the auditor read and says it cannot act", async () => {
    const r = await call("auditor", "GET", `/api/follow-ups/${FU_ATIS}`);
    expect(r.status).toBe(200);
    expect(r.json.canAct).toBe(false);
  });
});

describe("POST /api/follow-ups/:id/actions", () => {
  it("passes the actor, the action and the version the person saw to transition_follow_up", async () => {
    const r = await call("dispatcher", "POST", `/api/follow-ups/${FU_ROUTE}/actions`, { action: "called", version: 3 });
    expect(r.status).toBe(200);
    expect(rec.rpcs().find((c) => c.fn === "transition_follow_up")?.args).toEqual({
      p_org_id: ORG, p_follow_up_id: FU_ROUTE, p_actor_id: USER, p_action: "called", p_note: null, p_expected_version: 3,
    });
  });

  it("refuses a dispatcher a maintenance line — as missing, before the database is asked", async () => {
    expect((await call("dispatcher", "POST", `/api/follow-ups/${FU_ATIS}/actions`, { action: "called", version: 3 })).status).toBe(404);
    expect(rec.rpcs().some((c) => c.fn === "transition_follow_up")).toBe(false);
  });

  it("refuses the auditor, who reads the desk and changes nothing", async () => {
    expect((await call("auditor", "POST", `/api/follow-ups/${FU_ATIS}/actions`, { action: "called", version: 3 })).status).toBe(403);
    expect(rec.rpcs().some((c) => c.fn === "transition_follow_up")).toBe(false);
  });

  it("refuses 'not a problem' without a note before the database is asked", async () => {
    expect((await call("technician", "POST", `/api/follow-ups/${FU_ATIS}/actions`, { action: "closed_not_a_problem", version: 3 })).status).toBe(400);
    expect(rec.rpcs().some((c) => c.fn === "transition_follow_up")).toBe(false);
  });

  it.each([
    ["WD012", 404],
    ["WD013", 409],
    ["WD014", 422],
    ["WD015", 422],
  ])("answers the function's %s as %i", async (code, status) => {
    rpcResult = { error: { code, message: code } };
    expect((await call("technician", "POST", `/api/follow-ups/${FU_ATIS}/actions`, { action: "sent_to_shop", version: 3 })).status).toBe(status);
  });
});

describe("GET /api/follow-ups/:id/video/:eventId — fresh from Samsara, never stored", () => {
  it("refuses an event that is not this follow-up's without asking Samsara", async () => {
    expect((await call("technician", "GET", `/api/follow-ups/${FU_SAFETY}/video/evt-elsewhere`)).status).toBe(404);
    expect(samsara.video).not.toHaveBeenCalled();
  });

  it("never fetches a crash's video — Samsara blurs it for API tokens; open it in Samsara", async () => {
    const r = await call("technician", "GET", `/api/follow-ups/${FU_SAFETY}/video/evt-crash`);
    expect(r.json).toEqual({ restricted: true, samsaraUrl: "https://cloud.samsara.com/o/1/safety/evt-crash" });
    expect(samsara.video).not.toHaveBeenCalled();
  });

  it("returns the signed links for this org's event", async () => {
    const r = await call("technician", "GET", `/api/follow-ups/${FU_SAFETY}/video/evt-1`);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ restricted: false, urls: [{ url: "https://us4-safetymediadelivery.samsara.com/clip.mp4?exp=1", input: "dashcamForwardFacing" }] });
    expect(samsara.video).toHaveBeenCalledWith(rec.client, {}, ORG, "evt-1");
  });
});

describe("GET /api/follow-ups/:id/codes — a maintenance truck's codes, never stored", () => {
  const lampRow = (id: string, updated_at: string, codes: unknown[]) => ({
    ...WARNINGS[0], id, source: "lamp", source_key: `s-v:lamp_stop:${updated_at}`, kind: "lamp_stop", subject_kind: "truck", driver_samsara_id: null,
    label: "Red STOP lamp on", happened_at: updated_at, ended_at: null, still_active: true, samsara_url: null, detail: { codes }, updated_at,
  });

  it("reads the truck's codes now and those that came and went since a day before the first warning", async () => {
    samsara.codes.mockResolvedValue({
      asOf: "2026-11-27T10:32:12.000Z",
      lamps: { stop: true, warning: false, emissions: false, protect: false },
      now: [code(111)],
      history: [{ at: "2026-11-26T01:00:00.000Z", codes: [code(111), code(222)] }, { at: "2026-11-26T09:00:00.000Z", codes: [code(111)] }],
    });
    const r = await call("technician", "GET", `/api/follow-ups/${FU_STOP}/codes`);
    expect(r.status).toBe(200);
    expect(followUpTruckCodesSchema.parse(r.json)).toMatchObject({
      source: "samsara",
      now: [{ spn: 111 }],
      cameAndWent: [{ spn: 222, firstSeen: "2026-11-26T01:00:00.000Z", lastSeen: "2026-11-26T01:00:00.000Z" }],
      since: "2026-11-25T11:00:00.000Z",
      sinceCapped: false,
    });
    const [, , org, truck, window] = samsara.codes.mock.calls[0]!;
    expect([org, truck, window.sinceIso]).toEqual([ORG, "s-v", "2026-11-25T11:00:00.000Z"]);
  });

  it("reads nothing for a trailer's follow-up or a route line — they have no engine controllers to ask", async () => {
    expect((await call("technician", "GET", `/api/follow-ups/${FU_ATIS}/codes`)).status).toBe(404);
    expect((await call("technician", "GET", `/api/follow-ups/${FU_ROUTE}/codes`)).status).toBe(404);
    expect(samsara.codes).not.toHaveBeenCalled();
  });

  it("answers a dispatcher's request for a maintenance truck as missing", async () => {
    surfaceGrants = { dispatcher: { "dispatch.route-follow-ups": true } };
    expect((await call("dispatcher", "GET", `/api/follow-ups/${FU_STOP}/codes`)).status).toBe(404);
    expect(samsara.codes).not.toHaveBeenCalled();
  });

  it("shows the codes kept on the newest lamp row when Samsara does not answer, passing over a row of descriptions only", async () => {
    samsara.codes.mockRejectedValue(new Error("Samsara /fleet/vehicles/stats answered 503"));
    lampRows = [
      lampRow("00000000-0000-4000-8000-0000000000e7", "2026-11-25T08:00:00Z", [code(333)]),
      lampRow("00000000-0000-4000-8000-0000000000e8", "2026-11-26T08:00:00Z", [code(444), code(555, 232)]),
      lampRow("00000000-0000-4000-8000-0000000000e9", "2026-11-26T20:00:00Z", ["Engine Coolant Level 1"]),
    ];
    const r = await call("technician", "GET", `/api/follow-ups/${FU_STOP}/codes`);
    expect(r.status).toBe(200);
    expect(followUpTruckCodesSchema.parse(r.json)).toMatchObject({ source: "stored", asOf: "2026-11-26T08:00:00.000Z", now: [{ spn: 444 }, { spn: 555 }] });
    expectOrgScoped(rec, ORG, { exempt: SURFACE_TABLES });
  });

  it("says Samsara did not answer when there is nothing kept to show instead", async () => {
    samsara.codes.mockRejectedValue(new Error("Samsara /fleet/vehicles/stats answered 503"));
    const r = await call("technician", "GET", `/api/follow-ups/${FU_STOP}/codes`);
    expect([r.status, r.json.error.code]).toEqual([502, "samsara_unavailable"]);
  });
});

describe("/api/follow-ups/rules — the admin's alone", () => {
  it("refuses a fleet manager every verb, even granted the screen", async () => {
    surfaceGrants = { fleet_manager: { "maintenance.follow-ups.rules": true } };
    expect((await call("fleet_manager", "GET", "/api/follow-ups/rules")).status).toBe(403);
    expect((await call("fleet_manager", "PUT", "/api/follow-ups/rules/atis", { enabled: false, thresholdCount: 3, windowDays: 7, minActiveHours: 0, category: "maintenance", severity: "normal" })).status).toBe(403);
    expect((await call("fleet_manager", "DELETE", "/api/follow-ups/rules/atis")).status).toBe(403);
    expect(rec.forTable("follow_up_rules").some((q) => q.write)).toBe(false);
  });

  it("lists the fixed kinds and Samsara's configurations with their derived defaults", async () => {
    const r = await call("admin", "GET", "/api/follow-ups/rules");
    expect(r.status).toBe(200);
    expect(followUpRulesSchema.safeParse(r.json).success).toBe(true);
    const route = r.json.rules.find((x: { key: string }) => x.key === "alert:77");
    expect(route).toMatchObject({ category: "route", thresholdCount: 3, overridden: false, samsara: { id: "77", name: "Out of route", isEnabled: true } });
  });

  it("saves one rule whole, org-scoped, and puts it on the Audit page", async () => {
    const rule = { enabled: true, thresholdCount: 5, windowDays: 7, minActiveHours: 0, category: "maintenance", severity: "high" };
    expect((await call("admin", "PUT", "/api/follow-ups/rules/atis", rule)).status).toBe(200);
    const write = rec.forTable("follow_up_rules").find((q) => q.write)!.write!;
    expect(write.payload).toMatchObject({ org_id: ORG, rule_key: "atis", threshold_count: 5, severity: "high", updated_by: USER });
    expect(audit).toHaveBeenCalledWith(rec.client, expect.objectContaining({ action: "settings.follow_up_rule_saved", meta: expect.objectContaining({ ruleKey: "atis" }) }));
    expectOrgScoped(rec, ORG, { exempt: SURFACE_TABLES });
  });

  it("refuses a key that is no rule", async () => {
    const rule = { enabled: true, thresholdCount: 5, windowDays: 7, minActiveHours: 0, category: "maintenance", severity: "high" };
    expect((await call("admin", "PUT", "/api/follow-ups/rules/idling", rule)).status).toBe(404);
  });
});
