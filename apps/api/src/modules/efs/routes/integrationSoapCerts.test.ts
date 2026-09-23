import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { STEP_UP_TOKEN_HEADER, mintStepUpToken } from "../../../lib/stepUpToken.js";

/**
 * The client-certificate routes' step-up gate (2026-09-22 security audit).
 *
 * Upload, activate, rollback and withdraw each change the TLS identity every EFS poll presents — or,
 * for upload, stage the one that will. `/efs-soap/enable` and `/disable` already asked for a fresh
 * password; these four did not, although the file's own header said they did. The listing and the
 * staged-certificate test change nothing and stay password-free.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ADMIN: AuthContext = { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" };
const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} as NodeJS.ProcessEnv);

let server: Server;
let baseUrl = "";
let db: ReturnType<typeof createSupabaseRecorder>;

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async () => ADMIN;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await closeTestServer(server);
});

async function call(method: string, path: string, opts: { stepUp?: boolean; body?: unknown } = {}) {
  db = createSupabaseRecorder({ tables: { efs_soap_client_certs: [], audit_logs: { data: [], error: null } } });
  holder.client = db.client;
  const headers: Record<string, string> = { Authorization: "Bearer token", "Content-Type": "application/json" };
  if (opts.stepUp) headers[STEP_UP_TOKEN_HEADER] = mintStepUpToken(env, ADMIN.userId, ORG)!.token;
  const res = await fetch(`${baseUrl}/api/integrations${path}`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  return { status: res.status, body: (await res.json()) as { error?: { code: string } } };
}

const IDENTITY_CHANGES: Array<[string, string]> = [
  ["POST", "/efs-soap/client-cert"],
  ["POST", "/efs-soap/client-cert/activate"],
  ["POST", "/efs-soap/client-cert/rollback"],
  ["DELETE", "/efs-soap/client-cert"],
];

describe("client-certificate routes ask for a fresh password before changing the TLS identity", () => {
  it.each(IDENTITY_CHANGES)("%s %s refuses an admin with no step-up token, touching nothing", async (method, path) => {
    const { status, body } = await call(method, path, { body: method === "POST" ? {} : undefined });
    expect(status).toBe(403);
    expect(body.error?.code).toBe("step_up_required");
    expect(db.queries).toEqual([]);
  });

  it.each(IDENTITY_CHANGES)("%s %s is let through the gate with a step-up token", async (method, path) => {
    // Past the gate the handler answers from the (empty) fixture — a 400 on the empty upload body, a
    // 409 for nothing to activate or roll back. Any of them proves the refusal above was the gate.
    const { body } = await call(method, path, { stepUp: true, body: method === "POST" ? {} : undefined });
    expect(body.error?.code).not.toBe("step_up_required");
  });

  it("does not ask for a password to LIST the certificates", async () => {
    const { status } = await call("GET", "/efs-soap/client-cert");
    expect(status).toBe(200);
  });
});
