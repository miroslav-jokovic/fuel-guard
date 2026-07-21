import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { setAppLocals } from "./lib/appLocals.js";
import type { PlatformToken } from "./lib/auth.js";
import type { PlatformAdmin } from "./lib/platformAdmins.js";

/**
 * Fitness function — platform safety by construction. Every mounted /admin router must reject:
 *   • an unauthenticated request → 401 (requirePlatformAuth is its first middleware), and
 *   • an authenticated but non-admin / aal1 request → 403 (requireAAL2 + requirePlatformAdmin).
 * Router mounts are DISCOVERED from app.ts source, so a new /admin router added without the gate fails
 * this test automatically.
 */
function mountedAdminRouters(): string[] {
  const src = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
  const re = /app\.use\("(\/admin\/[^"]+)",\s*\w+Router\(\)\)/g;
  return [...src.matchAll(re)].map((m) => m[1]!);
}

const token = (aal: string): PlatformToken => ({
  userId: "u1",
  email: "someone@example.com",
  aal,
  amr: null,
  sessionId: "s1",
});

async function start(locals: Parameters<typeof setAppLocals>[1]): Promise<{ baseUrl: string; server: Server }> {
  const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
  const app = createApp(env);
  setAppLocals(app, locals);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  return { baseUrl: `http://127.0.0.1:${port}`, server };
}

const routers = mountedAdminRouters();

describe("platform route-auth coverage", () => {
  it("discovers the mounted /admin routers", () => {
    expect(routers.length).toBeGreaterThan(0);
  });

  describe("unauthenticated → 401", () => {
    let ctx: { baseUrl: string; server: Server };
    beforeAll(async () => (ctx = await start({})));
    afterAll(async () => new Promise<void>((r) => ctx.server.close(() => r())));
    it.each(routers)("rejects unauthenticated %s with 401", async (prefix) => {
      const res = await fetch(`${ctx.baseUrl}${prefix}`);
      expect(res.status).toBe(401);
    });
  });

  describe("authenticated aal2 but NOT an admin → 403", () => {
    let ctx: { baseUrl: string; server: Server };
    beforeAll(async () => {
      ctx = await start({
        verifyToken: async () => token("aal2"),
        lookupPlatformAdmin: async () => null, // verified identity, but not on the allowlist
      });
    });
    afterAll(async () => new Promise<void>((r) => ctx.server.close(() => r())));
    it.each(routers)("rejects non-admin %s with 403", async (prefix) => {
      const res = await fetch(`${ctx.baseUrl}${prefix}`, { headers: { authorization: "Bearer x" } });
      expect(res.status).toBe(403);
    });
  });

  describe("authenticated but aal1 (no MFA) → 403", () => {
    let ctx: { baseUrl: string; server: Server };
    const admin: PlatformAdmin = {
      id: "a1", email: "someone@example.com", userId: "u1", role: "platform_owner",
      status: "active", mfaEnrolledAt: null, lastReauthAt: null,
    };
    beforeAll(async () => {
      ctx = await start({ verifyToken: async () => token("aal1"), lookupPlatformAdmin: async () => admin });
    });
    afterAll(async () => new Promise<void>((r) => ctx.server.close(() => r())));
    it.each(routers)("rejects aal1 %s with 403 (mfa_required)", async (prefix) => {
      const res = await fetch(`${ctx.baseUrl}${prefix}`, { headers: { authorization: "Bearer x" } });
      expect(res.status).toBe(403);
    });
  });
});
