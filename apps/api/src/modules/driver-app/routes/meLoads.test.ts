import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadActionResponseSchema, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The driver's load routes through the real `/api/me` mount (T1 N-9, D-MK21): the outbox decides retry,
 * park or done from the status and the code, so every refusal must carry one, and late evidence must
 * be a 200.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "11111111-2222-4333-8444-555555555555";
const LOAD = "22222222-2222-4333-8444-000000000001";
const STOP = "33333333-2222-4333-8444-000000000001";
const ACTION = "66666666-2222-4333-8444-000000000001";

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

function seed(rpc: Record<string, unknown>, drivers: unknown[] = [{ id: DRIVER }]): void {
  rec = createSupabaseRecorder({
    tables: { drivers, loads: [], organizations: [], audit_logs: [] },
    rpc: (fn: string) => (fn in rpc ? rpc[fn] : fn === "driver_visible_tms_load_ids" ? [] : null),
  });
  holder.client = rec.client;
}

const post = async (path: string, body: unknown) => {
  const res = await fetch(`${baseUrl}/api/me${path}`, {
    method: "POST",
    headers: { Authorization: "Bearer driver", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    if (t !== "driver") throw new Error("bad token");
    return { userId: "u-driver", email: "d@x.test", orgId: ORG, role: "driver" } as AuthContext;
  };
  await new Promise<void>((done) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      done();
    });
  });
});
afterAll(async () => closeTestServer(server));

const codeOf = (body: Record<string, unknown>) => (body.error as { code?: unknown } | undefined)?.code;

describe("/api/me/loads actions (T1 N-9)", () => {
  it("every refusal carries a code", async () => {
    const refusals: Array<[string, unknown, Record<string, unknown>, unknown[]?]> = [
      [`/loads/${LOAD}/start`, {}, { driver_start_load: { error: { code: "DL013", message: "x" } } }],
      [`/loads/${LOAD}/accept`, {}, { driver_accept_load: { error: { code: "DL014", message: "x" } } }],
      [`/loads/${LOAD}/stops/${STOP}`, { status: "arrived", action_id: ACTION }, { driver_complete_stop: { error: { code: "DL012", message: "x" } } }],
      [`/loads/${LOAD}/stops/${STOP}`, { status: "flying" }, {}],
      [`/loads/${LOAD}/acknowledge`, { action_id: ACTION }, {}, []],
    ];
    for (const [path, body, rpc, drivers] of refusals) {
      seed(rpc, drivers);
      const res = await post(path, body);
      expect(res.status, path).toBeGreaterThanOrEqual(400);
      expect(typeof codeOf(res.body), `${path} ${JSON.stringify(res.body)}`).toBe("string");
    }
  });

  it("Got it without an action id is 422 action_id_required", async () => {
    seed({ driver_acknowledge_load: { error: { code: "DL015", message: "action id required" } } });
    const res = await post(`/loads/${LOAD}/acknowledge`, {});
    expect(res.status).toBe(422);
    expect(codeOf(res.body)).toBe("action_id_required");
    expect(rec.rpcs().find((c) => c.fn === "driver_acknowledge_load")?.args).toMatchObject({ p_action_id: null });
  });

  it("Got it answers the load and what the function did", async () => {
    seed({ driver_acknowledge_load: { status: "recorded" } });
    const res = await post(`/loads/${LOAD}/acknowledge`, { action_id: ACTION });
    expect(res.status).toBe(200);
    expect(loadActionResponseSchema.parse(res.body)).toEqual({ load: null, status: "recorded" });
  });

  it("late evidence is a 200, never a 4xx (D-MK20)", async () => {
    seed({ driver_complete_stop: { status: "late_evidence", late_reason: "not_current_driver" } });
    const res = await post(`/loads/${LOAD}/stops/${STOP}`, { status: "completed", action_id: ACTION });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("late_evidence");
  });
});
