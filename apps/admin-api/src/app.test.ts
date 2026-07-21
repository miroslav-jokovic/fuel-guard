import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { setAppLocals } from "./lib/appLocals.js";
import type { PlatformToken } from "./lib/auth.js";
import type { PlatformAdmin } from "./lib/platformAdmins.js";

async function start(locals: Parameters<typeof setAppLocals>[1]) {
  const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
  const app = createApp(env);
  setAppLocals(app, locals);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  return { baseUrl: `http://127.0.0.1:${port}`, server };
}

const admin: PlatformAdmin = {
  id: "a1", email: "owner@uncdevelopment.com", userId: "u1", role: "platform_owner",
  status: "active", mfaEnrolledAt: "2026-01-01T00:00:00Z", lastReauthAt: null,
};
const aal2: PlatformToken = { userId: "u1", email: "owner@uncdevelopment.com", aal: "aal2", amr: ["password", "totp"], sessionId: "s1" };

describe("admin-api app", () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => {
    ctx = await start({ verifyToken: async () => aal2, lookupPlatformAdmin: async () => admin });
  });
  afterAll(async () => new Promise<void>((r) => ctx.server.close(() => r())));

  it("healthz is public and ok", async () => {
    const res = await fetch(`${ctx.baseUrl}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("GET /admin/me returns the authorized admin through the full gate", async () => {
    const res = await fetch(`${ctx.baseUrl}/admin/me`, { headers: { authorization: "Bearer x" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string; role: string };
    expect(body.email).toBe("owner@uncdevelopment.com");
    expect(body.role).toBe("platform_owner");
  });
});
