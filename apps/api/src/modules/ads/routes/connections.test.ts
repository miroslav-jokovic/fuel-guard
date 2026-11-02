import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_ROLES, rolesThatCanView, rolesThatManage, type AuthContext, type UserRole } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { postgrestFixture, type FixtureRow } from "../../../testing/postgrestFixture.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { STEP_UP_TOKEN_HEADER, mintStepUpToken } from "../../../lib/stepUpToken.js";
import { stopSimulatorForTests } from "../platforms/registry.js";

/**
 * `/api/ads/connections` (B1b) through the real app and the shipped gates. Who may do what is read
 * from the permission matrix, as `guard.test.ts` does: a role that manages recruitment but is not
 * admin, and one that cannot see recruitment at all. The simulator door runs end to end — this test
 * process is a laptop/CI host, which the gate allows.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CONN = "7c0e0c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b";
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);

const MANAGER = rolesThatManage("recruitment").find((r) => r !== "admin")!;
const OUTSIDER = USER_ROLES.find((r) => !rolesThatCanView("recruitment").includes(r))!;
let caller: AuthContext;
const as = (role: UserRole): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role });

let server: Server;
let baseUrl = "";
let db: SupabaseRecorder;
let rows: FixtureRow[];

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
  caller = as("admin");
  rows = [{ id: CONN, org_id: ORG, provider: "meta", is_sandbox: false, status: "connected", token_sealed: "v1.deadbeef.a.b.c", account_ref: "1001", page_ref: "200100", scopes: [] }];
  db = createSupabaseRecorder({
    tables: {
      ads_platform_connections: (q) => {
        if (q.write?.method === "insert") {
          const row = { id: "9d0e0c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b", ...(q.write.payload as FixtureRow) };
          rows.push(row);
          return [row];
        }
        if (q.write?.method === "update") {
          const hit = postgrestFixture(rows)({ ...q, ops: q.ops.filter((o) => o.method !== "select" && o.method !== "single") });
          for (const h of hit) Object.assign(rows.find((r) => r.id === h.id)!, q.write.payload as object);
          return hit;
        }
        return postgrestFixture(rows)(q);
      },
      ads_campaigns: [],
      ads_actions: [{ id: "act-1" }],
      audit_logs: [{ id: "aud-1" }],
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
const connectionWrites = () => db.forTable("ads_platform_connections").filter((q) => q.write);

describe("/api/ads/connections — who may do what", () => {
  it("anyone who can see recruitment lists the connections, and no answer carries a token column; an outsider cannot", async () => {
    caller = as(MANAGER);
    const res = await call("GET", "connections");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("token_sealed");
    expect(text).not.toContain("v1.deadbeef");
    caller = as(OUTSIDER);
    expect((await call("GET", "connections")).status).toBe(403);
  });

  it("only an admin with a fresh sign-in may connect, connect the simulator or disconnect — a manager may not", async () => {
    const doors: Array<[string, unknown]> = [
      ["connections/meta", { token: "x".repeat(30), account_id: "1001", page_id: "200100", sandbox: false }],
      ["connections/simulator", {}],
      [`connections/${CONN}/disconnect`, {}],
    ];
    for (const [path, body] of doors) {
      caller = as(MANAGER);
      expect((await call("POST", path, body)).status, `${path} as manager`).toBe(403);
      caller = as("admin");
      expect((await call("POST", path, body, false)).status, `${path} without a fresh sign-in`).toBe(403);
    }
    expect(connectionWrites()).toEqual([]);
  });

  it("testing a connection is the admin's, without a password prompt; a manager may not", async () => {
    caller = as(MANAGER);
    expect((await call("POST", `connections/${CONN}/test`, {}, false)).status).toBe(403);
  });

  it("a malformed connect is refused before Meta is asked", async () => {
    for (const body of [{ token: "short", account_id: "1001", page_id: "200100", sandbox: false }, { token: "x".repeat(30), account_id: "abc", page_id: "200100", sandbox: false }, { token: "x".repeat(30), account_id: "1001", page_id: "200100" }]) {
      expect((await call("POST", "connections/meta", body)).status).toBe(400);
    }
    expect(connectionWrites()).toEqual([]);
  });
});

describe("/api/ads/connections — the simulator door, end to end", () => {
  it("connects the simulator through the real connection test and answers its report, with no token", async () => {
    const res = await call("POST", "connections/simulator", {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { connection: { provider: string; status: string }; report: { ok: boolean; checks: Array<{ key: string; ok: boolean }> } };
    expect(body.connection).toMatchObject({ provider: "simulator", status: "connected" });
    expect(body.report.ok).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/sim-[0-9a-f]{20}|simpage-/);
    expect(db.writtenRows("ads_actions")).toEqual([expect.objectContaining({ kind: "connection_test", status: "succeeded", actor_id: "u-admin" })]);
    expectOrgScoped(db, ORG, { exempt: ["user_profiles"] });
  });
});
