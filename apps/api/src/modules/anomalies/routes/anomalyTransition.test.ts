import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_ROLES, rolesThatManage, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `POST /api/anomalies/:id/transition` — the button a reviewer presses to move a case (F02–F04
 * chunk 15, AUDIT A2: until now the route appeared only in routeGates.test.ts, which proves a gate is
 * declared, not what the handler does behind it).
 *
 * The `anomalies` fixture APPLIES the route's `id` and `org_id` filters instead of answering every
 * read with the row: the recorder records filters but never applies them, so a flat fixture would
 * hand another org's case to a route that forgot its tenant filter and the org-scope test would stay
 * green (memory supabase-recorder-does-not-filter).
 */
const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null, rpcError: null as { message: string } | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";
const ID = "55555555-5555-4555-8555-555555555555";
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const CASE_ROW = { id: ID, org_id: ORG, status: "open", version: 3, disposition: null };
const TRANSITION = { id: "t-1", from_status: "open", to_status: "investigating", from_version: 3, to_version: 4 };
const as = (role: AuthContext["role"], orgId = ORG): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId, role });

/** Answers a read only when its `id` and `org_id` filters both match the stored case. */
const anomaliesFixture = (q: RecordedQuery) => {
  const f = q.filters();
  const matches = (col: string, val: unknown) => f.every((x) => x.col !== col || x.val === val);
  return [CASE_ROW].filter((row) => matches("id", row.id) && matches("org_id", row.org_id));
};

let server: Server;
let baseUrl = "";
let auth: AuthContext = as("admin");

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    if (token !== "token") throw new Error("bad token");
    return auth;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));
beforeEach(() => {
  auth = as("admin");
  holder.rpcError = null;
  holder.rec = createSupabaseRecorder({
    tables: { anomalies: anomaliesFixture, audit_logs: [] },
    rpc: (fn: string) => (fn !== "transition_anomaly" ? null : holder.rpcError ? { error: holder.rpcError } : TRANSITION),
  });
});

const post = (body: unknown) =>
  fetch(`${baseUrl}/api/anomalies/${ID}/transition`, {
    method: "POST",
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const investigate = { status: "investigating", version: 3 };
const audits = () => holder.rec!.writtenRows("audit_logs");
const transitionCalls = () => holder.rec!.rpcs().filter((c) => c.fn === "transition_anomaly");

describe("moving an alert through its workflow over HTTP", () => {
  it("moves the caller's own case through the RPC with the org, actor and expected version, and audits the move", async () => {
    const res = await post(investigate);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, transition: TRANSITION });

    expect(transitionCalls()).toHaveLength(1);
    expect(transitionCalls()[0]!.args).toMatchObject({
      p_org_id: ORG, p_anomaly_id: ID, p_actor_id: "u-admin", p_target_status: "investigating", p_expected_version: 3,
    });

    expect(audits()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({
      org_id: ORG, actor_id: "u-admin", action: "anomaly.status_changed", entity: "anomalies", entity_id: ID,
    });
    expect((audits()[0] as { meta: unknown }).meta).toMatchObject({ from: "open", to: "investigating", transition: TRANSITION });
    expectOrgScoped(holder.rec!, ORG);
  });

  it("answers 404 for another org's case and changes nothing", async () => {
    auth = as("admin", OTHER_ORG);
    const res = await post(investigate);
    expect(res.status).toBe(404);
    expect(transitionCalls()).toHaveLength(0);
    expect(audits()).toHaveLength(0);
    expectOrgScoped(holder.rec!, OTHER_ORG);
  });

  it("refuses a stale version with 409 conflict before the RPC runs", async () => {
    const res = await post({ ...investigate, version: 2 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("conflict");
    expect(transitionCalls()).toHaveLength(0);
    expect(audits()).toHaveLength(0);
  });

  it("answers 409 conflict and writes no audit row when the RPC loses the version race", async () => {
    holder.rpcError = { message: "conflict: anomaly version is 4, expected 3" };
    const res = await post(investigate);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("conflict");
    expect(audits()).toHaveLength(0);
  });

  // Derived from the section matrix, never hand-listed: a role that gains or loses `safety: manage`
  // moves between these two loops by itself (FUEL-T2, D-FUI12).
  const managers = rolesThatManage("safety");
  const others = USER_ROLES.filter((r) => !managers.includes(r));

  it("refuses every role without safety: manage, before reading the case", async () => {
    expect(others.length).toBeGreaterThan(0);
    for (const role of others) {
      auth = as(role);
      holder.rec!.reset();
      const res = await post(investigate);
      expect(res.status, role).toBe(403);
      expect(holder.rec!.queries, role).toHaveLength(0);
    }
  });

  it("lets every role with safety: manage move a case", async () => {
    expect(managers.length).toBeGreaterThan(0);
    for (const role of managers) {
      auth = as(role);
      expect((await post(investigate)).status, role).toBe(200);
    }
  });
});
