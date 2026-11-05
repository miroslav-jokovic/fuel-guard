import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_ROLES, rolesThatCanView, rolesThatManage, type AuthContext, type UserRole } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { STEP_UP_TOKEN_HEADER, mintStepUpToken } from "../../../lib/stepUpToken.js";
import { campaign, CONN, createAdsWorld, LIVE_SETTINGS, ORG, type AdsWorld } from "../../../testing/adsWorld.js";

/**
 * A person's moves and the approver's launch (`/api/ads/campaigns/:id/moves`, `/launch`; Track S, S1c), through
 * the real app and the shipped gates, over `adsWorld` — the same campaigns and ledger the runner's tests use, so
 * a person's press is recorded exactly as an agent's move is. Security L2 ("a non-admin hitting Launch") is here.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const RECRUITER = rolesThatManage("recruitment").find((r) => r !== "admin")!;
const READ_ONLY = rolesThatCanView("recruitment").find((r) => !rolesThatManage("recruitment").includes(r))!;
const OUTSIDER = USER_ROLES.find((r) => !rolesThatCanView("recruitment").includes(r))!;
const C = "70000000-0000-4000-8000-000000000001";
const as = (role: UserRole): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role });
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

const world = (state: Parameters<typeof campaign>[1], over: Parameters<typeof createAdsWorld>[0] extends infer O ? Partial<O> : never = {}) => {
  w = createAdsWorld({ campaigns: [campaign(C, state, { daily_budget_cents: null, lifetime_cap_cents: null })], ...over });
  holder.client = w.admin;
};
beforeEach(() => {
  caller = as(RECRUITER);
  world("review");
});

const call = (path: string, body: unknown, stepUp = false) =>
  fetch(`${baseUrl}/api/ads/campaigns/${path}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer token", "Content-Type": "application/json",
      ...(stepUp ? { [STEP_UP_TOKEN_HEADER]: mintStepUpToken(env, caller.userId, ORG)!.token } : {}),
    },
    body: JSON.stringify(body),
  });
const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const approval = (over: Record<string, unknown> = {}) => ({
  id: "ap-1", org_id: ORG, campaign_id: C, kind: "launch", withdraws_id: null, approved_by: "u-admin", approved_by_name: "Owner",
  daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, created_at: "2026-11-02T11:00:00Z", ...over,
});

describe("POST /campaigns/:id/moves — what the machine lets a person press", () => {
  it("a recruiter regenerates a campaign in review: it moves to composing, recorded with their id", async () => {
    const res = await call(`${C}/moves`, { event: "regenerate" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "composing" });
    expect(w.byId(C).state).toBe("composing");
    expect(w.transitions(C)).toEqual([expect.objectContaining({ status: "succeeded", actor_kind: "person", actor_id: `u-${RECRUITER}` })]);
    // `user_profiles` is keyed by the caller's own user id (`displayNameFor`): a person's name, not org data.
    expectOrgScoped(w.rec, ORG, { exempt: ["user_profiles"] });
  });

  it("a move the machine forbids from this state is refused and changes nothing", async () => {
    world("live");
    const res = await call(`${C}/moves`, { event: "regenerate" });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("illegal_transition");
    expect(w.byId(C).state).toBe("live");
  });

  it("an agent's event is refused to a person (actor_not_allowed)", async () => {
    world("composing");
    const res = await call(`${C}/moves`, { event: "creatives_ready" });
    expect(await code(res)).toBe("actor_not_allowed");
    expect(w.byId(C).state).toBe("composing");
  });

  it.each(["launch", "kill"])("%s has its own door and is refused here before any campaign is read", async (event) => {
    world(event === "launch" ? "paused" : "live");
    const res = await call(`${C}/moves`, { event });
    expect(await code(res)).toBe("not_this_door");
    expect(w.rec.queries.filter((q) => q.table.startsWith("ads_"))).toEqual([]);
  });

  it("who: a read-only role and an outsider cannot move a campaign", async () => {
    for (const role of [READ_ONLY, OUTSIDER]) {
      caller = as(role);
      expect((await call(`${C}/moves`, { event: "archive" })).status).toBe(403);
    }
    expect(w.byId(C).state).toBe("review");
  });

  it("another carrier's campaign is not found", async () => {
    w.campaigns[0]!.org_id = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
    expect((await call(`${C}/moves`, { event: "archive" })).status).toBe(404);
  });
});

describe("POST /campaigns/:id/launch — the approver's door (Security L2)", () => {
  beforeEach(() => {
    caller = as("admin");
    // A simulator connection (G-launch-gate, 2026-11-05): these tests are about the approval rule, and a real
    // Meta connection now meets the L4 certification first (campaigns/launchGate.test.ts), which no worker has yet.
    world("paused", { approvals: [approval()], connections: [{ id: CONN, org_id: ORG, provider: "simulator" }] });
  });

  it("an admin, freshly signed in, with a covering approval: paused → launching, the budget written with the move", async () => {
    const res = await call(`${C}/launch`, { daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 }, true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "launching" });
    expect(w.byId(C)).toMatchObject({ state: "launching", daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 });
    // `user_profiles` is keyed by the caller's own user id (`displayNameFor`): a person's name, not org data.
    expectOrgScoped(w.rec, ORG, { exempt: ["user_profiles"] });
  });

  it("a non-admin hitting Launch is refused, with or without a fresh sign-in, and nothing moves", async () => {
    for (const role of USER_ROLES.filter((r) => r !== "admin")) {
      caller = as(role);
      expect((await call(`${C}/launch`, { daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 }, true)).status, role).toBe(403);
    }
    expect(w.byId(C)).toMatchObject({ state: "paused", daily_budget_cents: null });
  });

  it("an admin without a fresh sign-in is asked to sign in again", async () => {
    const res = await call(`${C}/launch`, { daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("step_up_required");
    expect(w.byId(C).state).toBe("paused");
  });

  it("amounts above what was approved are refused, and the campaign stays paused with no budget", async () => {
    const res = await call(`${C}/launch`, { daily_budget_cents: 8_000, lifetime_cap_cents: 50_000 }, true);
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("no_standing_approval");
    expect(w.byId(C)).toMatchObject({ state: "paused", daily_budget_cents: null });
  });

  it("a withdrawn approval does not launch", async () => {
    w.approvals.push(approval({ id: "ap-2", kind: "withdraw", withdraws_id: "ap-1", daily_budget_cents: null, lifetime_cap_cents: null }));
    expect(await code(await call(`${C}/launch`, { daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 }, true))).toBe("no_standing_approval");
    expect(w.byId(C).state).toBe("paused");
  });

  it("above the second-approver line, one approver is not enough: it stays paused", async () => {
    w.saveSettings({ ...LIVE_SETTINGS, approvals: { ...LIVE_SETTINGS.approvals, second_approver_above_cents: 1_000 } });
    expect(await code(await call(`${C}/launch`, { daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 }, true))).toBe("second_approver_missing");
    expect(w.byId(C).state).toBe("paused");
  });

  it("a campaign that is not paused is refused as such, not sent to ask for an approval it could not use", async () => {
    world("review");
    expect(await code(await call(`${C}/launch`, { daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 }, true))).toBe("illegal_transition");
    expect(w.byId(C)).toMatchObject({ state: "review", daily_budget_cents: null });
  });
});
