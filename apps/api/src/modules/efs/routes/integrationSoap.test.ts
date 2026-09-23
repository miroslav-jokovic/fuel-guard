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
 * `POST /efs-soap/enable` refuses an endpoint that is not on EFS's own domain (2026-09-22 security
 * audit; `isEfsEndpointHost`).
 *
 * A public IP literal is the probe on purpose: the SSRF gate passes it WITHOUT a DNS lookup, so the
 * case runs offline, and it is exactly the input only the domain allowlist can refuse — with the
 * allowlist removed this request is stored and answered 200.
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

beforeAll(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
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

describe("saving EFS SOAP credentials", () => {
  it("refuses an endpoint that is not on EFS's domain, and stores nothing", async () => {
    const db = createSupabaseRecorder({
      tables: { efs_soap_credentials: { data: null, error: null }, audit_logs: { data: [], error: null } },
    });
    holder.client = db.client;
    const res = await fetch(`${baseUrl}/api/integrations/efs-soap/enable`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "application/json",
        [STEP_UP_TOKEN_HEADER]: mintStepUpToken(env, ADMIN.userId, ORG)!.token,
      },
      body: JSON.stringify({
        environment: "sandbox",
        endpointUrl: "https://93.184.216.34/axis2/services/CardManagementWS/",
        soapUsername: "user",
        soapPassword: "pass",
      }),
    });
    const body = (await res.json()) as { error: { code: string; message: string } };

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("invalid_endpoint_url");
    expect(body.error.message).toContain("efsllc.com");
    expect(db.writes()).toEqual([]);
  });
});
