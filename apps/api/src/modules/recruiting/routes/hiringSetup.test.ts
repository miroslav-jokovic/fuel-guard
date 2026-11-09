import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HIRING_PROFILE_V1, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";

/**
 * Hiring profiles and openings (ads D1c2, 0553/0554) through the mount. Version numbering and the
 * cross-carrier refusals are 0554's own (the PGlite matrix `recruiting-lead-functions.test.mjs`); this file
 * holds the doors, the session's name on a version, the newest version in each list, and the refusals in
 * words.
 */

const holder = vi.hoisted(() => ({ client: null as unknown, managers: vi.fn() }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));
// LQ2b: who may own an opening is the access matrix's answer (`sectionManagerIds`); its own test is
// `accessReview.test.ts`. Mocked at its own file, not `org/index.js`: a partial mock of the index loads the
// real one first, and this route's module is reached from it before the mock is in place.
vi.mock("../../org/surfaceHolders.js", () => ({ sectionManagerIds: holder.managers, surfaceHolders: vi.fn(async () => []) }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const PROFILE = "80000000-0000-4000-8000-000000000001";
const PV = "70000000-0000-4000-8000-000000000001";
const OPENING = "60000000-0000-4000-8000-000000000001";
const DANA = "10000000-0000-4000-8000-0000000000da";
const SAM = "10000000-0000-4000-8000-00000000005a";
const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = Object.fromEntries(["admin", "recruiter", "auditor", "dispatcher"].map((r) => [r, ctx(r)]));

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;
const call = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/recruitment${path}`, { ...init, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } });
const post = (path: string, token: string, body: unknown) => call(path, token, { method: "POST", body: JSON.stringify(body) });

const OPENING_SAVE = {
  opening_id: null, profile_version_id: PV, title: "Class A regional", headcount: 3,
  facts: { pay: { per: "mile", min_cents: 62, max_cents: 70 }, home_time: "Home weekly", equipment: ["dry_van"], lanes: null, start_date: null },
  area: { label: "Joliet yard", latitude: 41.52, longitude: -88.08, radius_miles: 50, reason: "Home weekly from the yard" },
};

function seed(over: { rpcError?: string; version?: number } = {}): SupabaseRecorder {
  rec = createSupabaseRecorder({
    tables: {
      hiring_profiles: postgrestFixture([{ id: PROFILE, org_id: ORG, name: "Class A regional", archived_at: null, created_at: "2026-11-01T00:00:00Z" }]),
      hiring_profile_versions: postgrestFixture([
        { id: "pv1", org_id: ORG, profile_id: PROFILE, version: 1, requirements: HIRING_PROFILE_V1, created_by_name: "Dana", created_at: "2026-11-01T00:00:00Z" },
        { id: PV, org_id: ORG, profile_id: PROFILE, version: 2, requirements: HIRING_PROFILE_V1, created_by_name: "Dana", created_at: "2026-11-02T00:00:00Z" },
      ]),
      recruiting_openings: (q: RecordedQuery) => {
        if (q.write?.method === "update") {
          const id = q.filters().find((f) => f.col === "id")?.val;
          return { data: id === OPENING ? [{ id, ...(q.write.payload as object) }] : [] };
        }
        return postgrestFixture([{ id: OPENING, org_id: ORG, status: "open", created_at: "2026-11-01T00:00:00Z", recruiter_id: DANA }])(q);
      },
      recruiting_opening_versions: postgrestFixture([
        { id: "ov1", org_id: ORG, opening_id: OPENING, version: 1, title: "Old title", created_by_name: "Dana", created_at: "2026-11-01T00:00:00Z" },
        { id: "ov2", org_id: ORG, opening_id: OPENING, version: 2, title: "Class A regional", created_by_name: "Dana", created_at: "2026-11-02T00:00:00Z" },
      ]),
      memberships: [],
      user_profiles: [{ full_name: "Dana Recruiter" }],
      audit_logs: [],
    },
    rpc: (fn) => {
      if (over.rpcError) return { error: { code: over.rpcError, message: "refused" } };
      if (fn === "save_hiring_profile_version") return { profile_id: PROFILE, version_id: "pv3", version: over.version ?? 3 };
      if (fn === "save_opening_version") return { opening_id: OPENING, version_id: "ov3", version: over.version ?? 3 };
      if (fn === "org_member_directory") return [{ user_id: DANA, email: "dana@x.test", full_name: "Dana Recruiter" }, { user_id: SAM, email: "sam@x.test", full_name: null }];
      return null;
    },
  });
  holder.client = rec.client;
  holder.managers.mockReset().mockResolvedValue([SAM, DANA]);
  return rec;
}
/** `user_profiles` is read by the actor's own user id (`displayNameFor`): not a carrier's row (`notes.test.ts`). */
const PROFILE_EXEMPT = { exempt: ["user_profiles"] };

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

describe("hiring profiles", () => {
  it("lists each profile with its newest version, and the owner's v1 as the defaults", async () => {
    seed();
    const body = (await (await call("/hiring-profiles", "auditor")).json()) as { profiles: Array<{ current: { version: number } }>; defaults: unknown };
    expect([body.profiles[0]!.current.version, body.defaults]).toEqual([2, HIRING_PROFILE_V1]);
    expectOrgScoped(rec, ORG);
  });
  it("saves the next version in the session's name, and audits the version", async () => {
    seed();
    const res = await post("/hiring-profiles", "recruiter", { profile_id: PROFILE, name: "Class A regional", requirements: HIRING_PROFILE_V1 });
    expect(res.status).toBe(200);
    const args = rec.rpcs()[0]!.args as Record<string, unknown>;
    expect([args.p_org, args.p_profile, args.p_actor, args.p_actor_name]).toEqual([ORG, PROFILE, "u-recruiter", "Dana Recruiter"]);
    expect(rec.writtenRows("audit_logs").at(-1)).toMatchObject({ action: "recruitment.hiring_profile_saved", meta: { version: 3 } });
    expectOrgScoped(rec, ORG, PROFILE_EXEMPT);
  });
  it("a first save answers 201", async () => {
    seed({ version: 1 });
    expect((await post("/hiring-profiles", "recruiter", { profile_id: null, name: "New", requirements: HIRING_PROFILE_V1 })).status).toBe(201);
  });
  it("refuses requirements outside the contract before calling the database", async () => {
    seed();
    const res = await post("/hiring-profiles", "recruiter", { profile_id: null, name: "x", requirements: { ...HIRING_PROFILE_V1, min_age: { years: 18, reason: "too young" } } });
    expect([res.status, rec.rpcs().length]).toEqual([400, 0]);
  });
  it("another carrier's profile reads as none; an archived one says so", async () => {
    seed({ rpcError: "RL030" });
    expect((await post("/hiring-profiles", "recruiter", { profile_id: PROFILE, name: "x", requirements: HIRING_PROFILE_V1 })).status).toBe(404);
    seed({ rpcError: "RL031" });
    expect((await post("/hiring-profiles", "recruiter", { profile_id: PROFILE, name: "x", requirements: HIRING_PROFILE_V1 })).status).toBe(409);
  });
  it("is closed to a view-only role for writes and to roles outside recruiting for reads", async () => {
    seed();
    expect((await post("/hiring-profiles", "auditor", { profile_id: null, name: "x", requirements: HIRING_PROFILE_V1 })).status).toBe(403);
    seed();
    expect((await call("/hiring-profiles", "dispatcher")).status).toBe(403);
  });
});

describe("openings", () => {
  it("lists each opening with its status and newest version", async () => {
    seed();
    const body = (await (await call("/openings", "recruiter")).json()) as { openings: Array<{ status: string; current: { title: string } }> };
    expect([body.openings[0]!.status, body.openings[0]!.current.title]).toEqual(["open", "Class A regional"]);
    expectOrgScoped(rec, ORG);
  });
  it("saves a version with the area flattened into its columns", async () => {
    seed({ version: 1 });
    const res = await post("/openings", "recruiter", OPENING_SAVE);
    expect(res.status).toBe(201);
    const v = (rec.rpcs()[0]!.args as { p_version: Record<string, unknown> }).p_version;
    expect([v.area_radius_miles, v.area_reason, v.profile_version_id, "area" in v]).toEqual([50, "Home weekly from the yard", PV, false]);
    expectOrgScoped(rec, ORG, PROFILE_EXEMPT);
  });
  it("refuses an area under 15 miles before calling the database", async () => {
    seed();
    const res = await post("/openings", "recruiter", { ...OPENING_SAVE, area: { ...OPENING_SAVE.area, radius_miles: 10 } });
    expect([res.status, rec.rpcs().length]).toEqual([400, 0]);
  });
  it("names another carrier's profile version as one to pick again", async () => {
    seed({ rpcError: "RL034" });
    expect((await post("/openings", "recruiter", OPENING_SAVE)).status).toBe(422);
  });
  it("moves the status on the parent row only, inside the carrier", async () => {
    seed();
    const res = await post(`/openings/${OPENING}/status`, "recruiter", { status: "filled" });
    expect(res.status).toBe(200);
    expect(rec.writes().find((w) => w.table === "recruiting_openings")!.write!.payload).toEqual({ status: "filled" });
    expectOrgScoped(rec, ORG);
    seed();
    expect((await post("/openings/60000000-0000-4000-8000-0000000000ff/status", "recruiter", { status: "closed" })).status).toBe(404);
    seed();
    expect((await post(`/openings/${OPENING}/status`, "recruiter", { status: "hired" })).status).toBe(400);
  });
});

describe("who owns an opening's leads (LQ2b, Q-AD50 (a))", () => {
  it("lists each opening with the recruiter who owns it", async () => {
    seed();
    const body = (await (await call("/openings", "recruiter")).json()) as { openings: Array<{ recruiter_id: string | null }> };
    expect(body.openings[0]!.recruiter_id).toBe(DANA);
  });

  it("offers the recruitment managers, by name or else email, sorted — the same list to a viewer", async () => {
    for (const who of ["recruiter", "auditor"]) {
      seed();
      const body = (await (await call("/recruiters", who)).json()) as { recruiters: Array<{ user_id: string; label: string }> };
      expect(body.recruiters).toEqual([{ user_id: DANA, label: "Dana Recruiter" }, { user_id: SAM, label: "sam@x.test" }]);
    }
    seed();
    expect((await call("/recruiters", "dispatcher")).status).toBe(403);
  });

  it("names a recruitment manager on the parent row only, inside the carrier, and audits it", async () => {
    seed();
    const res = await post(`/openings/${OPENING}/recruiter`, "recruiter", { recruiter_id: SAM });
    expect(res.status).toBe(200);
    expect(rec.writes().find((w) => w.table === "recruiting_openings")!.write!.payload).toEqual({ recruiter_id: SAM });
    expect(rec.writes().find((w) => w.table === "audit_logs")!.write!.payload).toMatchObject({ action: "recruitment.opening_recruiter_changed" });
    expectOrgScoped(rec, ORG, PROFILE_EXEMPT);
  });

  it("refuses somebody who cannot work recruitment leads, before writing anything", async () => {
    seed();
    const res = await post(`/openings/${OPENING}/recruiter`, "recruiter", { recruiter_id: "10000000-0000-4000-8000-0000000000dd" });
    expect([res.status, ((await res.json()) as { error: { code: string } }).error.code]).toEqual([422, "not_a_recruiter"]);
    expect(rec.writes().filter((w) => w.table === "recruiting_openings")).toEqual([]);
  });

  it("null hands the opening back to everybody; an unknown opening is a 404; a view-only role may not change it", async () => {
    seed();
    expect((await post(`/openings/${OPENING}/recruiter`, "recruiter", { recruiter_id: null })).status).toBe(200);
    expect(rec.writes().find((w) => w.table === "recruiting_openings")!.write!.payload).toEqual({ recruiter_id: null });
    seed();
    expect((await post("/openings/60000000-0000-4000-8000-0000000000ff/recruiter", "recruiter", { recruiter_id: SAM })).status).toBe(404);
    seed();
    expect((await post(`/openings/${OPENING}/recruiter`, "auditor", { recruiter_id: SAM })).status).toBe(403);
  });
});
