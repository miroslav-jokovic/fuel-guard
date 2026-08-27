import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Router } from "express";
import { createApp } from "../../app.js";
import { loadEnv } from "../../env.js";
import type { AuthContext } from "@silvicom/shared";
import { fuelCardCapabilityRouter } from "../../efs/router.js";
import { fuelCardEchoScanRouter } from "./echoScan.js";
import { fuelCardConfigScanRouter } from "./scan.js";
import { fuelCardProveRouter } from "./prove.js";
import { fuelCardPromoteRouter } from "./promote.js";
import { fuelCardInventoryRouter } from "./inventory.js";
import { fuelCardUnitMileageRouter } from "./unitMileage.js";
import { fuelCardExperimentsRouter } from "./experiments.js";
import { fuelCardProbeRouter } from "./probe.js";
import { fuelCardSettingsRouter } from "./settings.js";
import { fuelCardsRouter } from "./read.js";
import { fuelCardWriteProbeRouter } from "./writeProbe.js";
import { FUEL_CARD_ROUTE_TABLE, isFuelCardVendorRequest } from "./vendorRateLimit.js";
import { closeTestServer } from "../../testing/httpServer.js";

const CARD = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const TOKEN = "admin";
const CTX: AuthContext = {
  userId: "u-admin",
  email: "admin@example.test",
  orgId: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  role: "admin",
};

/** A second org, to prove the budget is per-EFS-account and not per-IP (Step 5.6). */
const TOKEN_B = "admin-b";
const CTX_B: AuthContext = {
  userId: "u-admin-b",
  email: "admin@other.test",
  orgId: "9f8e7d6c-5b4a-4938-8271-605f4e3d2c1b",
  role: "admin",
};

const PRINCIPALS: Record<string, AuthContext> = { [TOKEN]: CTX, [TOKEN_B]: CTX_B };

/** A charged route: POST /:id/lock opens a SOAP session, so it spends the vendor budget. */
const CHARGED = { path: `/api/fuel-cards/${CARD}/lock`, method: "POST", body: {} };

async function openServer(): Promise<{ baseUrl: string; server: Server }> {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    const ctx = PRINCIPALS[token];
    if (!ctx) throw new Error("bad token");
    return ctx;
  };
  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

interface CallOptions {
  token?: string | null;
  /** `app.set("trust proxy", 1)` means X-Forwarded-For IS `req.ip` — so this varies the source IP. */
  ip?: string;
  body?: unknown;
}

async function call(baseUrl: string, path: string, method: string, options: CallOptions = {}): Promise<number> {
  const { token = TOKEN, ip, body } = options;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      ...(ip === undefined ? {} : { "X-Forwarded-For": ip }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  await response.arrayBuffer();
  return response.status;
}

async function repeat(count: number, fn: (index: number) => Promise<number>): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(await fn(i));
  return out;
}

async function statuses(baseUrl: string, path: string, method: string, body?: unknown): Promise<number[]> {
  return repeat(31, () => call(baseUrl, path, method, { body }));
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
      await closeTestServer(server);
    }
  });

  it("a card lock is charged the EFS vendor rate budget", async () => {
    const { baseUrl, server } = await openServer();
    try {
      const result = await statuses(baseUrl, `/api/fuel-cards/${CARD}/lock`, "POST", {});
      expect(result.at(-1)).toBe(429);
    } finally {
      await closeTestServer(server);
    }
  });

  it("a probe is charged the EFS vendor rate budget", async () => {
    const { baseUrl, server } = await openServer();
    try {
      const result = await statuses(baseUrl, "/api/fuel-cards/diagnose", "POST", {});
      expect(result.at(-1)).toBe(429);
    } finally {
      await closeTestServer(server);
    }
  });

  it("a trailing slash does not escape the vendor rate budget", async () => {
    const { baseUrl, server } = await openServer();
    try {
      const result = await statuses(baseUrl, "/api/fuel-cards/diagnose/", "POST", {});
      expect(result.at(-1)).toBe(429);
    } finally {
      await closeTestServer(server);
    }
  });

  it("an unrecognised fuel-card path is charged rather than skipped", async () => {
    const { baseUrl, server } = await openServer();
    try {
      const result = await statuses(baseUrl, "/api/fuel-cards/not-a-real-route", "POST", {});
      expect(result.at(-1)).toBe(429);
    } finally {
      await closeTestServer(server);
    }
  });

  // ── Step 5.6: the bucket is the org, not the IP ────────────────────────────────────────────────
  //
  // The fix has two halves, and each half was reverted ON ITS OWN to see which cases go red —
  // a prediction about that was wrong the first time, so these numbers are measured, not reasoned:
  //
  //   revert `keyGenerator` alone  → 2 red: "two orgs / one IP" and "one org / two IPs". Exactly the
  //                                  two that describe the bucket, and no others.
  //   revert the `requireAuth` hoist alone (keeping `keyGenerator`) → 7 red, because the key
  //                                  generator THROWS on a missing `req.auth` instead of inventing a
  //                                  key. That is the intended blast radius: the mount order cannot
  //                                  be quietly undone into a silent return to IP keying.
  //
  // So the third case below belongs to the hoist, not to the key. Test 2 needs
  // `app.set("trust proxy", 1)` (app.ts) to stand up — X-Forwarded-For IS `req.ip` under it, so
  // varying that header is genuinely varying the source address.

  it("two orgs from one IP get independent vendor budgets", async () => {
    const { baseUrl, server } = await openServer();
    try {
      const orgA = await repeat(31, () => call(baseUrl, CHARGED.path, CHARGED.method, { body: CHARGED.body }));
      expect(orgA.at(-1)).toBe(429); // org A has spent its own budget

      // Same socket, same IP, different EFS account. Keyed on IP this was 429 — one org's QA session
      // spending another org's vendor allowance, which is the whole defect.
      const orgB = await call(baseUrl, CHARGED.path, CHARGED.method, { token: TOKEN_B, body: CHARGED.body });
      expect(orgB).not.toBe(429);
    } finally {
      await closeTestServer(server);
    }
  });

  it("one org from two IPs shares one vendor budget", async () => {
    const { baseUrl, server } = await openServer();
    try {
      // Alternating source addresses. Keyed on IP this is two buckets of ~16 and never trips;
      // keyed on the org it is one bucket of 31 and the last call is refused.
      const result = await repeat(31, (i) =>
        call(baseUrl, CHARGED.path, CHARGED.method, {
          ip: i % 2 === 0 ? "203.0.113.10" : "198.51.100.20",
          body: CHARGED.body,
        }),
      );
      expect(result.at(-1)).toBe(429);
    } finally {
      await closeTestServer(server);
    }
  });

  it("an unauthenticated request is refused without consuming a vendor slot", async () => {
    const { baseUrl, server } = await openServer();
    try {
      const anonymous = await repeat(40, () => call(baseUrl, CHARGED.path, CHARGED.method, { token: null, body: CHARGED.body }));
      expect(new Set(anonymous)).toEqual(new Set([401]));

      // The org's 30 are still there. Before the hoist, those 40 anonymous calls drained the IP
      // bucket and a paying org arrived to find its own budget already spent by a stranger.
      const authenticated = await repeat(30, () => call(baseUrl, CHARGED.path, CHARGED.method, { body: CHARGED.body }));
      expect(authenticated).not.toContain(429);
    } finally {
      await closeTestServer(server);
    }
  });

  it("every route that can open a SOAP session is in the charged list", () => {
    // Must list every router `app.ts` mounts on `/api/fuel-cards`, in that line's order. A mounted
    // router missing from here does not go UNMETERED — `skipFuelCardVendorRateLimit` skips only an
    // explicitly classified database-only route, so anything it cannot match stays charged — but its
    // routes are then classified by accident rather than by declaration.
    //
    // `fuelCardCapabilityRouter` joined the mount line in Step 3.5 and by 3.7 serves every card
    // write; `fuelCardControlRouter` is gone and its history read moved into `fuelCardsRouter`.
    // This assertion is what noticed each move.
    const routers = [
      fuelCardSettingsRouter(),
      // `docs/37` §6 E′. Mounted ahead of `fuelCardsRouter` for the reason settings is: `GET /:id`
      // matches the literal path "unit-mileage". Both its routes open a session — the GET asks EFS
      // for its stored reading so it can be shown beside ours.
      fuelCardUnitMileageRouter(),
      fuelCardsRouter(),
      fuelCardCapabilityRouter(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv)),
      fuelCardProbeRouter(),
      fuelCardWriteProbeRouter(),
      fuelCardExperimentsRouter(),
      fuelCardEchoScanRouter(),
      // Step 4.4. The only entry here classified `opensSoap: false` that is not merely a database
      // read of our own tables: the config scan reads the mirror's stored VENDOR documents and
      // resolves no credentials, so it cannot reach EFS however the corpus got there.
      fuelCardConfigScanRouter(),
      fuelCardProveRouter(),
      fuelCardPromoteRouter(),
      // Step 7.2. Read-only, and therefore needs no probe flag — but "read-only" says nothing about
      // vendor budget: it is up to 28 paced calls in one request, and up to 75 more with sampleCards.
      fuelCardInventoryRouter(),
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

/**
 * Step 5.10 — a route that cannot succeed should not exist rather than fail politely.
 *
 * `fleetguardweb` runs a full copy of this API and its egress is refused by WEX's firewall, so every
 * fuel-card route there failed as a vendor `NotAllowed` — an answer that reads like an entitlement
 * problem with the ACCOUNT rather than a request that arrived at the wrong host. `deploy-verify`
 * meanwhile polled only the API host and reported success while the web host was two commits behind.
 */
describe("a host that cannot reach EFS refuses fuel-card routes outright", () => {
  async function openWebHost(): Promise<{ baseUrl: string; server: Server }> {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp(loadEnv({ NODE_ENV: "test", EFS_ROUTES_ENABLED: "false" } as NodeJS.ProcessEnv));
    app.locals.verifyToken = async (): Promise<AuthContext> => CTX;
    const server = await new Promise<Server>((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
    return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
  }

  it("answers a routing refusal, not a vendor error, and names the host that can serve it", async () => {
    const { baseUrl, server } = await openWebHost();
    try {
      const response = await fetch(`${baseUrl}${CHARGED.path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await response.json()) as { error: { code: string; message: string } };

      // 503, not 404: the route is real and the caller is not wrong that it exists — the deployment
      // is wrong about where they sent it.
      expect(response.status).toBe(503);
      expect(body.error.code).toBe("efs_routes_not_served_here");
      expect(body.error.message).toMatch(/API host/);
    } finally {
      await closeTestServer(server);
    }
  });

  it("refuses reads on the prefix too — the whole prefix moves, not just the writes", async () => {
    const { baseUrl, server } = await openWebHost();
    try {
      const response = await fetch(`${baseUrl}/api/fuel-cards/settings`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(response.status).toBe(503);
      await response.arrayBuffer();
    } finally {
      await closeTestServer(server);
    }
  });

  it("leaves every other API prefix alone", async () => {
    const { baseUrl, server } = await openWebHost();
    try {
      // /api/version is public and unrelated. If the refusal were mounted too broadly this is what
      // would notice — a whole deployment answering 503 to everything would still pass the two cases
      // above.
      const response = await fetch(`${baseUrl}/api/version`);
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    } finally {
      await closeTestServer(server);
    }
  });

  it("serves the routes normally when the flag is left at its default", async () => {
    // The default has to be the API host's behaviour: a forgotten variable must degrade to "card
    // control works" rather than to a silent total outage that every gate reports as healthy.
    expect(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv).EFS_ROUTES_ENABLED).toBe(true);

    const { baseUrl, server } = await openServer();
    try {
      const status = await call(baseUrl, "/api/fuel-cards/settings", "GET");
      expect(status).not.toBe(503);
    } finally {
      await closeTestServer(server);
    }
  });
});
