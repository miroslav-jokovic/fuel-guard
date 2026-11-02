import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, USER_ROLES, rolesThatCanView, rolesThatManage, type AuthContext, type UserRole } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { STEP_UP_TOKEN_HEADER, mintStepUpToken } from "../../../lib/stepUpToken.js";

/**
 * `/api/ads` (A5) through the real app and the shipped gates. Who may do what is read from the
 * permission matrix (`rolesThatManage`, `rolesThatCanView`), not restated: the test picks a role
 * that manages recruitment but is not admin, and one that cannot see recruitment at all.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CAMPAIGN = "5b1e0c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b";
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);

const MANAGER = rolesThatManage("recruitment").find((r) => r !== "admin")!;
const OUTSIDER = USER_ROLES.find((r) => !rolesThatCanView("recruitment").includes(r))!;
let caller: AuthContext;
const as = (role: UserRole): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role });

let server: Server;
let baseUrl = "";
let db: SupabaseRecorder;

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
  caller = as("admin");
  db = createSupabaseRecorder({
    tables: {
      ads_settings_versions: (q) => (q.write ? [{ id: "v2", version: 2 }] : [{ id: "v1", version: 1, settings: ADS_SETTINGS_UNSET, kill_switch: false, kill_reason: null, created_at: "2026-11-01T00:00:00Z", created_by_name: "Owner" }]),
      ads_actions: [{ id: "act-1" }],
      ads_campaigns: [{ id: CAMPAIGN }],
      ads_approvals: (q) => (q.write ? [{ id: "appr-1" }] : []),
    },
  });
  holder.client = db.client;
});

function call(method: string, path: string, body?: unknown, stepUp = true) {
  return fetch(`${baseUrl}/api/ads/${path}`, {
    method,
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
      ...(stepUp ? { [STEP_UP_TOKEN_HEADER]: mintStepUpToken(env, caller.userId, ORG)!.token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const settingsWrites = () => db.writtenRows("ads_settings_versions");

describe("/api/ads — who may do what", () => {
  it("the matrix gives this test a non-admin manager and an outsider to work with", () => {
    expect(MANAGER).toBeDefined();
    expect(OUTSIDER).toBeDefined();
  });

  it("anyone who can see recruitment reads the settings; an outsider cannot", async () => {
    caller = as(MANAGER);
    expect((await call("GET", "settings")).status).toBe(200);
    caller = as(OUTSIDER);
    expect((await call("GET", "settings")).status).toBe(403);
  });

  it("only an admin with a fresh sign-in saves settings", async () => {
    const body = { settings: ADS_SETTINGS_UNSET };
    caller = as(MANAGER);
    expect((await call("PUT", "settings", body)).status).toBe(403);
    caller = as("admin");
    expect((await call("PUT", "settings", body, false)).status).toBe(403);
    expect(settingsWrites()).toEqual([]);
    const res = await call("PUT", "settings", body);
    expect(res.status).toBe(200);
    expect(settingsWrites()).toEqual([expect.objectContaining({ org_id: ORG, version: 2, kill_switch: false })]);
    // `user_profiles` is keyed by the caller's own user id (`displayNameFor`): a person's name, not org data.
    expectOrgScoped(db, ORG, { exempt: ["user_profiles"] });
  });

  it("a manager presses the kill switch without a password prompt; only an admin clears it, freshly signed in", async () => {
    caller = as(MANAGER);
    const press = await call("POST", "kill-switch", { reason: "spend looks wrong" }, false);
    expect(press.status).toBe(200);
    expect(settingsWrites()).toEqual([expect.objectContaining({ kill_switch: true, kill_reason: "spend looks wrong" })]);
    expect((await call("POST", "kill-switch/clear", { reason: "checked" })).status).toBe(403);
    caller = as(OUTSIDER);
    expect((await call("POST", "kill-switch", { reason: "x" })).status).toBe(403);
  });

  it("the kill switch needs a reason", async () => {
    caller = as(MANAGER);
    expect((await call("POST", "kill-switch", {})).status).toBe(400);
    expect(settingsWrites()).toEqual([]);
  });

  it("approving spend is admin-only with a fresh sign-in", async () => {
    const body = { kind: "launch", daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 };
    caller = as(MANAGER);
    expect((await call("POST", `campaigns/${CAMPAIGN}/approvals`, body)).status).toBe(403);
    caller = as("admin");
    expect((await call("POST", `campaigns/${CAMPAIGN}/approvals`, body, false)).status).toBe(403);
    const res = await call("POST", `campaigns/${CAMPAIGN}/approvals`, body);
    expect(res.status).toBe(201);
    expect(db.writtenRows("ads_approvals")).toEqual([
      expect.objectContaining({ org_id: ORG, campaign_id: CAMPAIGN, kind: "launch", daily_budget_cents: 5_000, settings_version_id: "v1", approved_by: "u-admin" }),
    ]);
  });
});
