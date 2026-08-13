import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Router } from "express";
import { createApp } from "../../app.js";
import { loadEnv } from "../../env.js";
import type { AuthContext } from "@fuelguard/shared";
import { fuelCardControlRouter } from "./control.js";
import { fuelCardExperimentsRouter } from "./experiments.js";
import { fuelCardProbeRouter } from "./probe.js";
import { fuelCardSettingsRouter } from "./settings.js";
import { fuelCardsRouter } from "./read.js";
import { fuelCardWriteProbeRouter } from "./writeProbe.js";
import { FUEL_CARD_ROUTE_TABLE, isFuelCardVendorRequest } from "./vendorRateLimit.js";

const CARD = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const TOKEN = "admin";
const CTX: AuthContext = {
  userId: "u-admin",
  email: "admin@example.test",
  orgId: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  role: "admin",
};

async function openServer(): Promise<{ baseUrl: string; server: Server }> {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    if (token !== TOKEN) throw new Error("bad token");
    return CTX;
  };
  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

async function statuses(baseUrl: string, path: string, method: string, body?: unknown): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < 31; i++) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    out.push(response.status);
    await response.arrayBuffer();
  }
  return out;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fuel-card vendor rate budget", () => {
  it("a card detail read is not charged the EFS vendor rate budget", async () => {
    const { baseUrl, server } = await openServer();
    try {
      const result = await statuses(baseUrl, `/api/fuel-cards/${CARD}`, "GET");
      expect(result).not.toContain(429);
    } finally {
      await closeServer(server);
    }
  });

  it("a card lock is charged the EFS vendor rate budget", async () => {
    const { baseUrl, server } = await openServer();
    try {
      const result = await statuses(baseUrl, `/api/fuel-cards/${CARD}/lock`, "POST", {});
      expect(result.at(-1)).toBe(429);
    } finally {
      await closeServer(server);
    }
  });

  it("a probe is charged the EFS vendor rate budget", async () => {
    const { baseUrl, server } = await openServer();
    try {
      const result = await statuses(baseUrl, "/api/fuel-cards/diagnose", "POST", {});
      expect(result.at(-1)).toBe(429);
    } finally {
      await closeServer(server);
    }
  });

  it("every route that can open a SOAP session is in the charged list", () => {
    const routers = [
      fuelCardSettingsRouter(),
      fuelCardsRouter(),
      fuelCardControlRouter(),
      fuelCardProbeRouter(),
      fuelCardWriteProbeRouter(),
      fuelCardExperimentsRouter(),
    ];
    const actual = routers.flatMap(routeTable).map((route) => `${route.method} ${route.path}`).sort();
    const configured = FUEL_CARD_ROUTE_TABLE.map((route) => `${route.method} ${route.path}`).sort();

    expect(configured).toEqual(actual);
    for (const route of FUEL_CARD_ROUTE_TABLE.filter((entry) => entry.opensSoap)) {
      expect(isFuelCardVendorRequest({
        method: route.method,
        path: `/api/fuel-cards${route.path.replace(/:[^/]+/g, "value")}`,
      })).toBe(true);
    }
  });
});

function routeTable(router: Router): Array<{ method: string; path: string }> {
  const stack = (router as unknown as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
  }).stack;
  return stack.flatMap((layer) => {
    if (!layer.route) return [];
    return Object.keys(layer.route.methods).map((method) => ({
      method: method.toUpperCase(),
      path: layer.route!.path,
    }));
  });
}
