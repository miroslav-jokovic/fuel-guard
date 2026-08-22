import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AuthContext } from "@fuelguard/shared";
import { createApp } from "../../app.js";
import { loadEnv } from "../../env.js";
import { closeTestServer } from "../../testing/httpServer.js";

/**
 * Archiving a driver or an applicant (migration 0235) — the DOOR gate.
 *
 * No test in this suite mocks Supabase (a house rule): a 200 here would mean asserting against a fake
 * DB, which proves nothing about the real one. What is pinned here is the boundary decided in
 * middleware, before any query runs.
 *
 * ⚠ **The door gate is deliberately the WIDER of the two gates, and this file can only test that
 * one.** `canSeeRoster` is `rolesThatCanView("fleet") ∪ rolesThatCanView("recruitment")`, because the
 * real gate — `canArchiveDriver` — depends on the DRIVER'S STATUS as well as the caller's role, and
 * the status is not known until the row is read. A dispatcher reaching the handler and being refused
 * by that second gate is the design, not a hole: refusing them at the door would need a database read
 * in a middleware.
 *
 * The second gate is a pure function and is pinned where a pure function belongs —
 * `packages/shared/src/auth.test.ts`, "canArchiveDriver", as a full role × status matrix. Between the
 * two files every path is covered; neither file could cover it alone.
 */

let server: Server;
let baseUrl: string;
let errorLog: ReturnType<typeof vi.spyOn>;

const CTX: Record<string, AuthContext> = {
  admin: { userId: "u-admin", email: "a@silvicominc.com", orgId: "org-1", role: "admin" },
  fleet: { userId: "u-fm", email: "f@silvicominc.com", orgId: "org-1", role: "fleet_manager" },
  safety: { userId: "u-sm", email: "s@silvicominc.com", orgId: "org-1", role: "safety_manager" },
  dispatcher: { userId: "u-disp", email: "p@silvicominc.com", orgId: "org-1", role: "dispatcher" },
  auditor: { userId: "u-aud", email: "x@silvicominc.com", orgId: "org-1", role: "auditor" },
  recruiter: { userId: "u-rec", email: "r@silvicominc.com", orgId: "org-1", role: "recruiter" },
  driver: { userId: "u-drv", email: "d@silvicominc.com", orgId: "org-1", role: "driver" },
  pending: { userId: "u-new", email: "n@silvicominc.com", orgId: null, role: null },
};

beforeAll(async () => {
  // The "passes the gate" cases deliberately reach the handler, which then calls getSupabaseAdmin()
  // and throws "Supabase admin not configured" — there is no DB in the test env, and per the house
  // rule we do not mock one. That is the EXPECTED outcome (it proves the request got past the guards),
  // but the app's error middleware prints a stack for each, burying the real signal in `pnpm test`.
  // Silence just this suite's expected stderr; every assertion below is on the HTTP status, not the log.
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const ctx = CTX[t];
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
  errorLog.mockRestore();
  await closeTestServer(server);
});

const call = (path: string, init: RequestInit & { token?: string } = {}) => {
  const { token, ...rest } = init;
  return fetch(`${baseUrl}/api/roster/drivers${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
};

describe("POST /api/roster/drivers/:id/archive — door gate", () => {
  const ID = "11111111-1111-4111-8111-111111111111";

  it("401 unauthenticated", async () => {
    expect((await call(`/${ID}/archive`, { method: "POST" })).status).toBe(401);
  });

  it("403 for a driver — they see neither list", async () => {
    expect((await call(`/${ID}/archive`, { method: "POST", token: "driver" })).status).toBe(403);
  });

  it("403 for a user with no org membership yet", async () => {
    // requireOrg runs before the role check, so this is 403 on the missing org.
    expect((await call(`/${ID}/archive`, { method: "POST", token: "pending" })).status).toBe(403);
  });

  it.each(["admin", "fleet", "safety", "recruiter"])("passes the door for %s", async (token) => {
    const res = await call(`/${ID}/archive`, { method: "POST", token });
    expect([401, 403]).not.toContain(res.status);
  });

  /**
   * A dispatcher and an auditor pass the DOOR — they can view the roster — and are refused by
   * `canArchiveDriver` after the row is read. Asserted as "not 401" rather than "not 403" precisely
   * because the 403 they eventually get is the correct answer from the second gate; what this pins is
   * that the door is not where they are stopped, so the second gate never becomes dead code somebody
   * deletes as unreachable.
   */
  it.each(["dispatcher", "auditor"])("lets %s through the door for the second gate to refuse", async (token) => {
    expect((await call(`/${ID}/archive`, { method: "POST", token })).status).not.toBe(401);
  });
});

describe("POST /api/roster/drivers/:id/unarchive — same gate as archive", () => {
  const ID = "11111111-1111-4111-8111-111111111111";

  // Un-archiving is the only undo there is — DELETE on `drivers` raises DR010 for everybody — so it
  // must not be harder to reach than the act it reverses. Same gate, asserted rather than assumed.
  it("401 unauthenticated", async () => {
    expect((await call(`/${ID}/unarchive`, { method: "POST" })).status).toBe(401);
  });

  it("403 for a driver", async () => {
    expect((await call(`/${ID}/unarchive`, { method: "POST", token: "driver" })).status).toBe(403);
  });

  it.each(["admin", "fleet", "safety", "recruiter"])("passes the door for %s", async (token) => {
    const res = await call(`/${ID}/unarchive`, { method: "POST", token });
    expect([401, 403]).not.toContain(res.status);
  });
});
