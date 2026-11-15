import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rolesThatCanView, rolesThatManage, type AuthContext, type CampaignPlan, type UserRole } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { ORG, campaign, createAdsWorld, type AdsWorld } from "../../../testing/adsWorld.js";
import { presetRows } from "../../../testing/adsPresetRows.js";
import { STRATEGIST_EVAL, loadFixtures, strategistPack } from "../workers/agentFixtures.js";

/**
 * The plan doors over HTTP (ADS-PLATFORM-V2-PLAN V2c): what a person on the review screen is answered. The
 * doors' own rules are `plan/planDoors.test.ts`; who may call which is `security/adsRouteGates.test.ts`.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const RECRUITER = rolesThatManage("recruitment").find((r) => r !== "admin")!;
const READ_ONLY = rolesThatCanView("recruitment").find((r) => !rolesThatManage("recruitment").includes(r))!;
const C = "70000000-0000-4000-8000-000000000001";
const P1 = "71000000-0000-4000-8000-000000000001";
const as = (role: UserRole): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role });

const fx = loadFixtures(STRATEGIST_EVAL).find((f) => f.fixture.name === "planted-sound")!.fixture;
const sound = fx.recorded.output as CampaignPlan;
const plans = [{ id: P1, org_id: ORG, campaign_id: C, version: 1, plan: sound, evidence: strategistPack(fx), author_kind: "agent", generation_id: "g-1", author_id: null, author_name: null, created_at: "2026-11-15T18:30:00+00:00" }];

let caller: AuthContext;
let w: AdsWorld;
let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async () => caller;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));
beforeEach(() => {
  caller = as(RECRUITER);
  w = createAdsWorld({ campaigns: [campaign(C, "plan_review", { brief_snapshot: fx.input.brief })], extraTables: { ads_campaign_plans: plans, ...presetRows(ORG, fx.input.concepts) } });
  holder.client = w.admin;
});

const call = (method: "GET" | "POST", path: string, body?: unknown) =>
  fetch(`${baseUrl}/api/ads/campaigns/${path}`, { method, headers: { Authorization: "Bearer token", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("the plan doors over HTTP", () => {
  it("anyone who can view reads the newest plan with its evidence, and never the author's id", async () => {
    caller = as(READ_ONLY);
    const res = await call("GET", `${C}/plan`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: Record<string, unknown> };
    expect(body.plan).toMatchObject({ id: P1, version: 1, plan: sound, author_kind: "agent" });
    expect(body.plan).not.toHaveProperty("author_id");
    expect(body.plan).not.toHaveProperty("generation_id");
    expect((body as unknown as { concepts: unknown }).concepts).toEqual(fx.input.concepts);
  });

  it("approving the plan answers the campaign's new state", async () => {
    const res = await call("POST", `${C}/plan/approval`, { plan_id: P1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "composing" });
    expect(w.byId(C)).toMatchObject({ state: "composing", plan_id: P1 });
  });

  it("approving a version that is not the newest answers 409 plan_moved; a body with no plan id is 400", async () => {
    const stale = await call("POST", `${C}/plan/approval`, { plan_id: "71000000-0000-4000-8000-0000000000ff" });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe("plan_moved");
    expect((await call("POST", `${C}/plan/approval`, {})).status).toBe(400);
    expect(w.byId(C).state).toBe("plan_review");
  });

  it("an edit with a figure the opening does not hold answers 422 with each finding as a sentence", async () => {
    const res = await call("POST", `${C}/plan/versions`, { based_on_version: 1, plan: { ...sound, audience: "Regional flatbed drivers who want $0.80 a mile and a steady week." } });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string }; findings: Array<{ kind: string; where: string; message: string }> };
    expect(body.error.code).toBe("plan_refused");
    expect(body.findings).toEqual([expect.objectContaining({ kind: "claim", where: "audience", message: expect.stringMatching(/^audience says ".*", which the job's facts do not hold/) })]);
  });

  it("an edit that is not a plan at all is 400, and a read-only role cannot edit or approve", async () => {
    expect((await call("POST", `${C}/plan/versions`, { based_on_version: 1, plan: { ...sound, angles: [] } })).status).toBe(400);
    caller = as(READ_ONLY);
    expect((await call("POST", `${C}/plan/versions`, { based_on_version: 1, plan: sound })).status).toBe(403);
    expect((await call("POST", `${C}/plan/approval`, { plan_id: P1 })).status).toBe(403);
    expect(w.byId(C).state).toBe("plan_review");
  });
});
