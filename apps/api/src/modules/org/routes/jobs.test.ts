import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} as NodeJS.ProcessEnv);
const ADMIN: AuthContext = { userId: "u-admin", email: "admin@example.test", orgId: ORG, role: "admin" };

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async (): Promise<AuthContext> => ADMIN;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => closeTestServer(server));
beforeEach(() => {
  holder.rec = createSupabaseRecorder({ tables: { jobs: [] } });
});

describe("GET /api/jobs/latest", () => {
  it("accepts sync_odometer so the odometer card can poll its running job", async () => {
    const response = await fetch(`${baseUrl}/api/jobs/latest?kind=sync_odometer`, {
      headers: { Authorization: "Bearer token" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ latest: null, lastDone: null });
  });
});
