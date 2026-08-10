import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import type { AuthContext } from "@fuelguard/shared";

/**
 * Gate-and-contract tests, house style: the real app on port 0, an injected token verifier, and no
 * Supabase mock anywhere. A request that reaches the handler dies on "Supabase admin not configured",
 * which is the point — we are asserting WHO gets through, not what the database returns.
 *
 * The role matrix matters here more than usual. `rolesThatCanView("fuel")` is five roles; a driver is
 * not one of them, and a driver who could list the company's cards would be reading a fraud-detection
 * surface about themselves.
 */

const ORG = "11111111-1111-1111-1111-111111111111";

const CTX: Record<string, AuthContext> = {
  admin: { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" },
  fleet: { userId: "u-fleet", email: "f@x.test", orgId: ORG, role: "fleet_manager" },
  dispatcher: { userId: "u-disp", email: "d@x.test", orgId: ORG, role: "dispatcher" },
  safety: { userId: "u-safe", email: "s@x.test", orgId: ORG, role: "safety_manager" },
  auditor: { userId: "u-aud", email: "au@x.test", orgId: ORG, role: "auditor" },
  driver: { userId: "u-drv", email: "dr@x.test", orgId: ORG, role: "driver" },
  pending: { userId: "u-pend", email: "p@x.test", orgId: null, role: null },
};

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  // Reaching a handler without Supabase configured logs an expected error; keep the output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    const ctx = CTX[token];
    if (!ctx) throw new Error("bad token");
    return ctx;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

type ApiErrorBody = { error: { code: string; message: string } };
const errorBody = async (res: Response): Promise<ApiErrorBody> => (await res.json()) as ApiErrorBody;

const call = (path: string, token?: string, method = "GET"): Promise<Response> =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

/** "It reached the handler" — the house assertion. The handler then fails on Supabase, which is fine. */
const reachedHandler = (res: Response): void => expect([401, 403]).not.toContain(res.status);

describe("/api/fuel-cards authentication", () => {
  it.each(["/", "/locations?state=IL", "/policies/14", `/${ORG}`])(
    "refuses %s without a token",
    async (path) => {
      expect((await call(`/api/fuel-cards${path}`)).status).toBe(401);
    },
  );

  it("refuses a caller with no org membership", async () => {
    const res = await call("/api/fuel-cards", "pending");
    expect(res.status).toBe(403);
    expect((await errorBody(res)).error.code).toBe("no_membership");
  });
});

describe("read access — the fuel-section view matrix", () => {
  it.each(["admin", "fleet", "dispatcher", "safety", "auditor"])(
    "lets %s list cards",
    async (persona) => {
      reachedHandler(await call("/api/fuel-cards", persona));
    },
  );

  it("refuses a driver", async () => {
    // A driver reading the company's card inventory is a fraud-detection surface about themselves.
    const res = await call("/api/fuel-cards", "driver");
    expect(res.status).toBe(403);
  });

  it.each(["admin", "auditor"])("lets %s open a card detail", async (persona) => {
    reachedHandler(await call(`/api/fuel-cards/${ORG}`, persona));
  });

  it("refuses a driver the location search", async () => {
    expect((await call("/api/fuel-cards/locations?state=IL", "driver")).status).toBe(403);
  });
});

describe("mirror refresh access", () => {
  it.each(["admin", "fleet"])("lets %s queue a full sync", async (persona) => {
    reachedHandler(await call("/api/fuel-cards/sync", persona, "POST"));
  });

  it.each(["dispatcher", "safety", "auditor", "driver"])(
    "refuses %s a full sync — it dials the vendor",
    async (persona) => {
      expect((await call("/api/fuel-cards/sync", persona, "POST")).status).toBe(403);
    },
  );

  it("lets a viewer refresh ONE card", async () => {
    // Reading one card is a read; the role gate matches the page the button is on.
    reachedHandler(await call(`/api/fuel-cards/${ORG}/refresh`, "auditor", "POST"));
  });
});

describe("input validation", () => {
  it("rejects a policy number outside 1-99", async () => {
    // The guide is explicit: "The policy # the card belongs to, 1-99 are valid" (p35).
    for (const bad of ["0", "100", "abc"]) {
      const res = await call(`/api/fuel-cards/policies/${bad}`, "admin");
      expect(res.status).toBe(400);
      expect((await errorBody(res)).error.code).toBe("invalid_request");
    }
  });

  it("accepts a policy number inside the documented range", async () => {
    reachedHandler(await call("/api/fuel-cards/policies/14", "admin"));
  });

  it("rejects a malformed location id", async () => {
    const res = await call("/api/fuel-cards/locations?locId=notanid", "admin");
    expect(res.status).toBe(400);
  });

  it("caps the list size a caller can ask for", async () => {
    const res = await call("/api/fuel-cards?limit=5000", "admin");
    expect(res.status).toBe(400);
  });
});

describe("route ordering", () => {
  it("does not let /:id swallow the fixed paths", async () => {
    // `/locations`, `/policies/:n` and `/sync` are declared before `/:id`. If that ever regresses,
    // "locations" is read as a card id and this returns 404 instead of reaching the search handler.
    for (const path of ["/locations?state=IL", "/policies/14"]) {
      const res = await call(`/api/fuel-cards${path}`, "admin");
      expect(res.status).not.toBe(404);
    }
  });
});
