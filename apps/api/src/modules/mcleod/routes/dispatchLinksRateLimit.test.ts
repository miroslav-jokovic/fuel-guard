import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * Settings → McLeod fleets must not spend `/api/integrations`' strict budget (30 per 15 minutes per
 * address): on 2026-10-15 a dozen fleet picks spent it, and the page answered "Could not load the McLeod
 * fleets" for the rest of the window. The links ride the general `/api` budget; the routes that reach a
 * vendor or issue a credential keep the strict one. Statuses only — no database stands behind these
 * requests, so a handler's own error is fine; what must not appear on a link is 429.
 */
const CTX: AuthContext = { userId: "u-admin", email: "admin@example.test", orgId: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", role: "admin" };

async function openServer(): Promise<{ baseUrl: string; server: Server }> {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (): Promise<AuthContext> => CTX;
  const server = await new Promise<Server>((ok) => { const s = app.listen(0, () => ok(s)); });
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

async function call(baseUrl: string, path: string, method: string, body?: unknown): Promise<number> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: "Bearer admin", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  await res.arrayBuffer();
  return res.status;
}

async function times(n: number, fn: () => Promise<number>): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(await fn());
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the McLeod fleet links and the integrations budget", () => {
  it("a page of fleet and dispatcher links is never refused by the strict budget, and spends none of it", async () => {
    const { baseUrl, server } = await openServer();
    try {
      const links = [
        ...(await times(20, () => call(baseUrl, "/api/integrations/mcleod/dispatch-links", "GET"))),
        ...(await times(15, () => call(baseUrl, "/api/integrations/mcleod/fleets/VINNIEV", "PUT", { dispatcherId: "vinniev" }))),
        ...(await times(15, () => call(baseUrl, "/api/integrations/mcleod/dispatchers/vinniev/user", "PUT", { userId: null }))),
      ];
      expect(links).not.toContain(429);
      // The strict bucket is untouched: a credential route still has all 30.
      const config = await times(30, () => call(baseUrl, "/api/integrations/mcleod/config", "GET"));
      expect(config).not.toContain(429);
    } finally {
      await closeTestServer(server);
    }
  });

  it("the routes that reach a vendor or a credential keep the strict budget", async () => {
    const { baseUrl, server } = await openServer();
    try {
      const enable = await times(31, () => call(baseUrl, "/api/integrations/mcleod/enable", "POST", {}));
      expect(enable.at(-1)).toBe(429);
    } finally {
      await closeTestServer(server);
    }
  });

  it("the links still require a signed-in caller", async () => {
    const { baseUrl, server } = await openServer();
    try {
      const res = await fetch(`${baseUrl}/api/integrations/mcleod/dispatch-links`);
      expect(res.status).toBe(401);
    } finally {
      await closeTestServer(server);
    }
  });
});
