import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AuthContext } from "@fuelguard/shared";
import { driverCreateSchema, deriveFullName } from "@fuelguard/shared";
import { createApp } from "../../app.js";
import { loadEnv } from "../../env.js";

/**
 * Roster drivers — GATING and CONTRACT only.
 *
 * No test in this suite mocks Supabase (a house rule): a 200 here would mean asserting against a
 * fake DB, which proves nothing about the real one. What IS worth pinning is the security boundary —
 * who is refused before any query runs — because that is decided entirely in middleware and is
 * exactly what regresses silently when someone copies a router.
 *
 * The `fleet` section matrix (packages/shared/src/auth.ts) says: manage = admin | fleet_manager |
 * safety_manager; view adds dispatcher + auditor; driver gets nothing. Enrollment (`/:id/invite`)
 * is narrower still — admin + fleet_manager — because it hands out a login.
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
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
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

describe("GET /api/roster/drivers — read gate (fleet: view)", () => {
  it("401 unauthenticated", async () => {
    expect((await call("/")).status).toBe(401);
  });

  it("403 for a driver (no fleet access at all)", async () => {
    expect((await call("/", { token: "driver" })).status).toBe(403);
  });

  it("403 for a user with no org membership yet", async () => {
    // requireOrg runs before requireRole, so this is 403 on the missing org, not on the role.
    expect((await call("/", { token: "pending" })).status).toBe(403);
  });

  it.each(["admin", "fleet", "safety", "dispatcher", "auditor"])("passes the gate for %s", async (token) => {
    // Reaches the handler (and then the DB, which is absent in test) — the point is it is NOT 401/403.
    const res = await call("/", { token });
    expect([401, 403]).not.toContain(res.status);
  });
});

describe("POST /api/roster/drivers — write gate (fleet: manage)", () => {
  const body = JSON.stringify({ full_name: "Test Driver" });

  it("401 unauthenticated", async () => {
    expect((await call("/", { method: "POST", body })).status).toBe(401);
  });

  it.each(["driver", "dispatcher", "auditor"])("403 for %s (read-only or no access)", async (token) => {
    expect((await call("/", { method: "POST", body, token })).status).toBe(403);
  });

  it.each(["admin", "fleet", "safety"])("passes the gate for %s", async (token) => {
    const res = await call("/", { method: "POST", body, token });
    expect([401, 403]).not.toContain(res.status);
  });

  it("400 on a body that satisfies neither full_name nor first+last", async () => {
    const res = await call("/", { method: "POST", body: JSON.stringify({ first_name: "Only" }), token: "admin" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/roster/drivers/:id/invite — enrollment gate (admin + fleet_manager only)", () => {
  const body = JSON.stringify({ email: "someone@silvicominc.com" });
  const path = "/11111111-1111-1111-1111-111111111111/invite";

  it("401 unauthenticated", async () => {
    expect((await call(path, { method: "POST", body })).status).toBe(401);
  });

  it("403 for safety_manager — may edit master data, may not hand out logins", async () => {
    expect((await call(path, { method: "POST", body, token: "safety" })).status).toBe(403);
  });

  it.each(["driver", "dispatcher", "auditor"])("403 for %s", async (token) => {
    expect((await call(path, { method: "POST", body, token })).status).toBe(403);
  });

  it.each(["admin", "fleet"])("passes the gate for %s", async (token) => {
    const res = await call(path, { method: "POST", body, token });
    expect([401, 403]).not.toContain(res.status);
  });

  it("400 on a malformed email", async () => {
    const res = await call(path, { method: "POST", body: JSON.stringify({ email: "nope" }), token: "admin" });
    expect(res.status).toBe(400);
  });
});

describe("driverCreateSchema + deriveFullName (pure contract)", () => {
  it("accepts full_name alone", () => {
    expect(driverCreateSchema.safeParse({ full_name: "Aaron Rothenberg" }).success).toBe(true);
  });

  it("accepts first + last without full_name", () => {
    expect(driverCreateSchema.safeParse({ first_name: "Aaron", last_name: "Rothenberg" }).success).toBe(true);
  });

  it("rejects a partial name with no full_name", () => {
    expect(driverCreateSchema.safeParse({ first_name: "Aaron" }).success).toBe(false);
    expect(driverCreateSchema.safeParse({ last_name: "Rothenberg" }).success).toBe(false);
    expect(driverCreateSchema.safeParse({}).success).toBe(false);
  });

  it("defaults status to active", () => {
    const parsed = driverCreateSchema.parse({ full_name: "A B" });
    expect(parsed.status).toBe("active");
  });

  it("rejects a status outside the canonical vocabulary", () => {
    expect(driverCreateSchema.safeParse({ full_name: "A B", status: "vacationing" }).success).toBe(false);
  });

  it("derives full_name from the structured parts, skipping the blanks", () => {
    expect(deriveFullName({ first_name: "Aaron", last_name: "Rothenberg" })).toBe("Aaron Rothenberg");
    expect(deriveFullName({ first_name: "Aaron", middle_name: "J", last_name: "Rothenberg" })).toBe(
      "Aaron J Rothenberg",
    );
    expect(deriveFullName({ first_name: " Aaron ", middle_name: "  ", last_name: "Rothenberg" })).toBe(
      "Aaron Rothenberg",
    );
    expect(deriveFullName({})).toBe("");
  });
});
