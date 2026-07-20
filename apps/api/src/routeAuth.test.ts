import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";

/**
 * Fitness function — tenant safety by construction.
 * Every mounted /api router must reject an unauthenticated request with 401 (its first middleware is
 * `router.use(requireAuth)`). Provider-signed webhooks are the one intentional exception. Router mounts
 * are DISCOVERED from app.ts source, so a new router added without auth fails this test automatically.
 */
const PUBLIC_PREFIXES = new Set(["/api/webhooks"]);

function mountedApiRouters(): string[] {
  const src = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
  const re = /app\.use\("(\/api\/[^"]+)",\s*\w+Router\(\)\)/g;
  return [...src.matchAll(re)].map((m) => m[1]!);
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
  const app = createApp(env);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

describe("route auth coverage", () => {
  const protectedPrefixes = mountedApiRouters().filter((p) => !PUBLIC_PREFIXES.has(p));

  it("discovers the mounted /api routers", () => {
    expect(protectedPrefixes.length).toBeGreaterThan(5);
  });

  it.each(protectedPrefixes)("rejects unauthenticated %s with 401", async (prefix) => {
    const res = await fetch(`${baseUrl}${prefix}`);
    expect(res.status).toBe(401);
  });
});
