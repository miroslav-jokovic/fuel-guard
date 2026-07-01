import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SignJWT, generateKeyPair } from "jose";
import type { AuthContext } from "@fuelguard/shared";
import { verifyAccessToken } from "../lib/auth.js";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";

describe("verifyAccessToken (real jose verification)", () => {
  it("verifies a well-formed token and maps claims → context", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const token = await new SignJWT({
      email: "dana@silvicominc.com",
      org_id: "11111111-1111-1111-1111-111111111111",
      user_role: "fleet_manager",
    })
      .setProtectedHeader({ alg: "ES256" })
      .setSubject("user-123")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    const ctx = await verifyAccessToken(token, publicKey);
    expect(ctx).toEqual({
      userId: "user-123",
      email: "dana@silvicominc.com",
      orgId: "11111111-1111-1111-1111-111111111111",
      role: "fleet_manager",
    });
  });

  it("rejects a token signed by the wrong key", async () => {
    const a = await generateKeyPair("ES256");
    const b = await generateKeyPair("ES256");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256" })
      .setSubject("u")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(a.privateKey);
    await expect(verifyAccessToken(token, b.publicKey)).rejects.toThrow();
  });
});

describe("auth middleware gating", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
    // Inject a fake verifier keyed by the token string.
    app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
      if (t === "admin")
        return { userId: "u-admin", email: "a@silvicominc.com", orgId: "org-1", role: "admin" };
      if (t === "driver")
        return { userId: "u-drv", email: "d@silvicominc.com", orgId: "org-1", role: "driver" };
      if (t === "pending")
        return { userId: "u-new", email: "n@silvicominc.com", orgId: null, role: null };
      throw new Error("bad token");
    };
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  });

  const get = (path: string, token?: string) =>
    fetch(`${baseUrl}${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);

  it("401 when no bearer token", async () => {
    expect((await get("/api/me")).status).toBe(401);
  });

  it("401 when token is invalid", async () => {
    expect((await get("/api/me", "garbage")).status).toBe(401);
  });

  it("/api/me returns the principal for a valid token", async () => {
    const res = await get("/api/me", "admin");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ userId: "u-admin", orgId: "org-1", role: "admin" });
  });

  it("/api/me exposes the pending (no-membership) state", async () => {
    const res = await get("/api/me", "pending");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ orgId: null, role: null });
  });

  it("403 forbidden when a driver hits an admin-only route", async () => {
    expect((await get("/api/invites", "driver")).status).toBe(403);
  });

  it("401 unauthenticated on an admin-only route", async () => {
    expect((await get("/api/invites")).status).toBe(401);
  });
});
