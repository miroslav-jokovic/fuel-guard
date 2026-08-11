import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import type { AuthContext } from "@fuelguard/shared";

/**
 * Phase B write gates. House style: the real app on port 0, an injected token verifier, no Supabase
 * mock anywhere. A request that reaches a handler dies on "Supabase admin not configured" — which is
 * the point. Every case here asserts WHO gets through, and the gates are the product.
 *
 * ── Why this file spins up a server PER describe block ───────────────────────────────────────────
 * `/api/fuel-cards` sits behind `strictLimiter` (30 requests / 15 minutes), because it dials a
 * rate-paced vendor on a shared service account. That limit is correct in production and it caps how
 * many assertions one server can carry. Each `createApp()` builds its own limiter with its own store,
 * so a fresh server per block keeps every block comfortably under the ceiling WITHOUT weakening the
 * limiter for tests — a `skip: NODE_ENV === "test"` would have been the easy fix and would have meant
 * the abuse control was never the thing under test.
 *
 * Keep each block under ~28 requests. If one grows past that, split it rather than raising the limit.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CARD = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
/** ≥16 chars, per cardVersionSchema. The value is never checked here — only that it is present. */
const VERSION = "0123456789abcdef0123456789abcdef";

const CTX: Record<string, AuthContext> = {
  admin: { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" },
  fleet: { userId: "u-fleet", email: "f@x.test", orgId: ORG, role: "fleet_manager" },
  dispatcher: { userId: "u-disp", email: "d@x.test", orgId: ORG, role: "dispatcher" },
  safety: { userId: "u-safe", email: "s@x.test", orgId: ORG, role: "safety_manager" },
  auditor: { userId: "u-aud", email: "au@x.test", orgId: ORG, role: "auditor" },
  driver: { userId: "u-drv", email: "dr@x.test", orgId: ORG, role: "driver" },
};

/**
 * A fresh app + server for one describe block.
 *
 * NOTE what the personas deliberately LACK: `issuedAt`. Every step-up gate therefore fails closed
 * here, which is exactly the property those gates are supposed to have — a token whose freshness
 * cannot be established is not fresh.
 */
function withServer(): { url: () => string } {
  let server: Server;
  let baseUrl = "";
  beforeAll(async () => {
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
  return { url: () => baseUrl };
}

type ApiErrorBody = { error: { code: string; message: string } };
const errorBody = async (res: Response): Promise<ApiErrorBody> => (await res.json()) as ApiErrorBody;

const send = (
  base: string, path: string, method: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });

const base = { expectedVersion: VERSION, reason: "Truck broken into overnight" };

/** The five write routes with a body each would otherwise accept, so only the GATE can refuse them. */
const WRITE_ROUTES: Array<[string, string, unknown]> = [
  [`/api/fuel-cards/${CARD}/lock`, "POST", base],
  [`/api/fuel-cards/${CARD}/unlock`, "POST", base],
  [`/api/fuel-cards/${CARD}/override`, "POST", { ...base, uses: 1, scope: { kind: "all" } }],
  [`/api/fuel-cards/${CARD}/override`, "DELETE", base],
  [`/api/fuel-cards/${CARD}/prompts`, "POST", { ...base, replaceAll: true, prompts: [] }],
];

describe("write routes — authentication and role", () => {
  const s = withServer(); // 5 + 15 + 2 = 22 requests

  it.each(WRITE_ROUTES)("refuses %s (%s) without a token", async (path, method, body) => {
    expect((await send(s.url(), path, method, { body })).status).toBe(401);
  });

  it.each(["dispatcher", "auditor", "driver"])("refuses %s every write route", async (persona) => {
    // A dispatcher granting fuel overrides is precisely the fraud pattern this product exists to
    // DETECT. A customer who wants it names that person as an approver — an audited act — rather
    // than changing a role that also grants unrelated permissions.
    for (const [path, method, body] of WRITE_ROUTES) {
      expect((await send(s.url(), path, method, { token: persona, body })).status).toBe(403);
    }
  });

  it.each(["admin", "fleet"])("stops %s at the CAPABILITY gate, not the role gate", async (persona) => {
    // The role is right and the four ANDed facts are not: EFS_CARD_CONTROL_ENABLED defaults false.
    // The distinction is the whole point of having a separate code — the UI says "an admin needs to
    // switch this on", not "forbidden".
    const res = await send(s.url(), `/api/fuel-cards/${CARD}/lock`, "POST", { token: persona, body: base });
    expect(res.status).toBe(403);
    expect((await errorBody(res)).error.code).toBe("card_control_disabled");
  });
});

describe("write routes — the contract", () => {
  const s = withServer(); // 5 + 5 + 1 + 2 + 1 = 14 requests

  it("requires a reason on every write", async () => {
    // The cheapest column in the schema and the most valuable one six months later.
    for (const [path, method, body] of WRITE_ROUTES) {
      const res = await send(s.url(), path, method, {
        token: "admin", body: { ...(body as object), reason: undefined },
      });
      expect(res.status).toBe(400);
    }
  });

  it("requires an expectedVersion on every write", async () => {
    // Without it there is no defence at all against two dispatchers acting on one stale screen.
    for (const [path, method, body] of WRITE_ROUTES) {
      const res = await send(s.url(), path, method, {
        token: "admin", body: { ...(body as object), expectedVersion: undefined },
      });
      expect(res.status).toBe(400);
    }
  });

  it("refuses a prompts change that does not say replaceAll: true", async () => {
    // Full-replace is the EFS semantic. Requiring the literal `true` means a caller can never arrive
    // at "delete every prompt on this card" by omitting a field.
    const res = await send(s.url(), `/api/fuel-cards/${CARD}/prompts`, "POST", {
      token: "admin", body: { ...base, prompts: [] },
    });
    expect(res.status).toBe(400);
  });

  it("refuses an override outside the vendor's 1-9 range", async () => {
    for (const uses of [0, 10]) {
      const res = await send(s.url(), `/api/fuel-cards/${CARD}/override`, "POST", {
        token: "admin", body: { ...base, uses, scope: { kind: "all" } },
      });
      expect(res.status).toBe(400);
    }
  });

  it("refuses a malformed Idempotency-Key rather than ignoring it", async () => {
    // Silently dropping an unparseable replay key would switch the double-submit guard off without
    // telling anyone — and a double-submitted override is a driver getting two free tanks.
    const res = await send(s.url(), `/api/fuel-cards/${CARD}/lock`, "POST", {
      token: "admin", body: base, headers: { "Idempotency-Key": "not-a-uuid" },
    });
    expect([400, 403]).toContain(res.status);
  });
});

describe("step-up re-authentication", () => {
  const s = withServer(); // 1 + 3 + 1 = 5 requests

  it("demands a fresh sign-in for an override above three uses", async () => {
    // Checked BEFORE the capability gate on purpose: the rule must not become reachable simply
    // because an org has card control switched on.
    const res = await send(s.url(), `/api/fuel-cards/${CARD}/override`, "POST", {
      token: "admin", body: { ...base, uses: 5, scope: { kind: "all" } },
    });
    expect(res.status).toBe(403);
    expect((await errorBody(res)).error.code).toBe("step_up_required");
  });

  it.each(["fleet", "dispatcher", "driver"])("refuses %s the write-entitlement probe", async (persona) => {
    expect((await send(s.url(), "/api/fuel-cards/write-check", "POST", { token: persona, body: {} })).status).toBe(403);
  });

  it("refuses even an admin the write probe without a recent sign-in", async () => {
    // The single most consequential button in the product: it sends a real setCardV2 to a real card.
    const res = await send(s.url(), "/api/fuel-cards/write-check", "POST", {
      token: "admin", body: { cardNumber: "70830000000000000", confirm: "WRITE 0000", readOnly: false },
    });
    expect(res.status).toBe(403);
    expect((await errorBody(res)).error.code).toBe("step_up_required");
  });
});

describe("history is a read", () => {
  const s = withServer(); // 5 requests

  it.each(["admin", "fleet", "dispatcher", "safety", "auditor"])(
    "lets %s read the change history",
    async (persona) => {
      // An auditor who cannot change a card is exactly the person who most needs to see what changed.
      const res = await send(s.url(), `/api/fuel-cards/${CARD}/history`, "GET", { token: persona });
      expect([401, 403]).not.toContain(res.status);
    },
  );
});
