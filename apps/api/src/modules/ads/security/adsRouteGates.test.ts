import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_ROLES, type AuthContext, type UserRole } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { everyRoute } from "../../../testing/routeWalk.js";
import { STEP_UP_TOKEN_HEADER, mintStepUpToken } from "../../../lib/stepUpToken.js";
import { stopSimulatorForTests } from "../platforms/registry.js";

/**
 * Security L3, "a non-admin hitting Connect, Launch, kill-switch clear or settings save" (ADS-AGENT-BUILD-WORKFLOW
 * §4R, row "Security (all)"; G-sec, 2026-11-05).
 *
 * L2 pinned each door in its own route test. L3 closes the two ways that leaves a hole:
 *   · a NEW ads route nobody classified. The ledger below is every `/api/ads` route the real app serves, read
 *     from the same walk `routeGateLedger.test.ts` does (`testing/routeWalk.ts`), each with the gates it must
 *     carry. A route added without a line here, or a line whose gates drifted, fails — so "who may do this" is
 *     a question review sees, not one a new door answers by default;
 *   · a gate that is present but WRONG. Every door that moves money or hands an account over is then called by
 *     EVERY role that is not admin, each with a fresh sign-in, through the real app: each must be refused 403
 *     and write nothing. The role list is the shared `USER_ROLES`, so a role added later is tested too.
 *
 * The test connection (`/connections/:id/test`) is admin-only WITHOUT a fresh sign-in on purpose: it moves no
 * money and hands nothing over, it only spends a few Meta calls (routes/connections.ts header).
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ID = "7c0e0c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b";
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);

const VIEW = "role(recruitment/view)";
const MANAGE = "role(recruitment/manage)";
const SPEND = "adminOnly(ads.spend) freshAuth";
const CONNECTION = "adminOnly(ads.connection) freshAuth";
const BRAND_KIT = "adminOnly(ads.brand-kit)";

/** Every `/api/ads` route and the gates in front of it, in the walk's order. */
const LEDGER: Record<string, string> = {
  "GET /api/ads/settings": VIEW,
  "PUT /api/ads/settings": SPEND,
  "POST /api/ads/kill-switch": MANAGE, // pressing it only stops spending: the safe direction (guard/killSwitch.ts)
  "POST /api/ads/kill-switch/clear": SPEND,
  "POST /api/ads/campaigns/:campaignId/approvals": SPEND,
  "GET /api/ads/connections": VIEW,
  "POST /api/ads/connections/meta": CONNECTION,
  "POST /api/ads/connections/simulator": CONNECTION,
  "POST /api/ads/connections/:connectionId/test": "adminOnly(ads.connection)",
  "POST /api/ads/connections/:connectionId/disconnect": CONNECTION,
  "GET /api/ads/brand-kits": VIEW,
  "GET /api/ads/presets": VIEW,
  "POST /api/ads/brand-kits/assets/upload-url": BRAND_KIT,
  "POST /api/ads/brand-kits/assets": BRAND_KIT,
  "POST /api/ads/brand-kits": BRAND_KIT,
  "POST /api/ads/presets": BRAND_KIT,
  "GET /api/ads/campaigns": VIEW,
  "GET /api/ads/campaigns/:campaignId": VIEW,
  "POST /api/ads/campaigns": MANAGE, // creating spends nothing; only Launch moves money (routes/campaigns.ts)
  "POST /api/ads/campaigns/:campaignId/moves": MANAGE,
  "POST /api/ads/campaigns/:campaignId/creatives/:creativeId/decision": MANAGE,
  "POST /api/ads/campaigns/:campaignId/launch": SPEND,
};

/** The doors §4R names, and the two siblings that also move money or an account: each with a body that would pass. */
const ADMIN_DOORS: Array<[string, string, unknown]> = [
  ["connect", "POST connections/meta", { token: "x".repeat(30), account_id: "1001", page_id: "200100", sandbox: false }],
  ["connect the simulator", "POST connections/simulator", {}],
  ["disconnect", `POST connections/${ID}/disconnect`, {}],
  ["launch", `POST campaigns/${ID}/launch`, { daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 }],
  ["approve spend", `POST campaigns/${ID}/approvals`, { kind: "launch", daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 }],
  ["clear the kill switch", "POST kill-switch/clear", { reason: "back on" }],
  ["save settings", "PUT settings", { settings: {}, expected_version: 0 }],
];

const NON_ADMIN = USER_ROLES.filter((r) => r !== "admin");

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
afterAll(async () => {
  await closeTestServer(server);
  await stopSimulatorForTests();
});
beforeEach(() => {
  db = createSupabaseRecorder({ tables: {} });
  holder.client = db.client;
});

function call(door: string, body: unknown) {
  const [method, path] = door.split(" ") as [string, string];
  return fetch(`${baseUrl}/api/ads/${path}`, {
    method,
    headers: { Authorization: "Bearer token", "Content-Type": "application/json", [STEP_UP_TOKEN_HEADER]: mintStepUpToken(env, caller.userId, ORG)!.token },
    body: JSON.stringify(body),
  });
}

describe("Security L3 — every /api/ads route is in the ledger, with the gates it must carry", () => {
  it("the walked /api/ads routes are exactly the ledger's, each behind exactly its gates", () => {
    const walked = [...everyRoute()].filter(([k]) => k.split(" ")[1]!.startsWith("/api/ads/"));
    expect(Object.fromEntries(walked.map(([k, gates]) => [k, gates.join(" ")]))).toEqual(LEDGER);
  });
});

describe("Security L3 — a non-admin hitting Connect, Launch, kill-switch clear or settings save", () => {
  it.each(ADMIN_DOORS)("%s is refused for every role but admin, with a fresh sign-in, and writes nothing", async (_name, door, body) => {
    for (const role of NON_ADMIN) {
      caller = as(role);
      const res = await call(door, body);
      expect(res.status, `${door} as ${role}`).toBe(403);
    }
    expect(db.queries.filter((q) => q.write), door).toEqual([]);
    // Not vacuous: the same call from an admin gets past the gate (whatever the empty database then answers),
    // so the 403s above are the gate's and not a door that refuses everyone.
    caller = as("admin");
    expect((await call(door, body)).status, `${door} as admin`).not.toBe(403);
  });
});
