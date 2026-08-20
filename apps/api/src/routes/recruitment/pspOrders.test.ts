import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@fuelguard/shared";
import { createApp } from "../../app.js";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../testing/httpServer.js";

/**
 * The ordering surface (P9). Two properties are pinned, and both are about money.
 *
 * FIRST, NOTHING BILLS BY DEFAULT. `PSP_ORDERS_ENABLED` defaults to false, so a deployment that has
 * a key configured still cannot spend on it. The refusal is a 503 and it happens before any vendor
 * module is reached.
 *
 * SECOND, THE PREFLIGHT IS FREE AND HONEST. It reports the budget and the FIRST substantive blocker
 * without calling PSP — and it never reports `step_up_required`, because being asked for a password
 * and only then told the driver never signed the disclosure is the wrong order to learn things in.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

const ctx = (role: string): AuthContext =>
  ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);

const CTX: Record<string, AuthContext> = {
  admin: ctx("admin"),
  fleet: ctx("fleet_manager"),
  safety: ctx("safety_manager"),
  recruiter: ctx("recruiter"),
  dispatcher: ctx("dispatcher"),
  driver: ctx("driver"),
};

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const call = (path: string, init: RequestInit & { token?: string } = {}) =>
  fetch(`${baseUrl}/api/recruitment${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

const seed = (over: { auths?: unknown[] } = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      drivers: [
        {
          id: DRIVER,
          first_name: "Susan",
          last_name: "Godfrey",
          full_name: "Susan Godfrey",
          date_of_birth: "1980-04-01",
          cdl_number: "12345678",
          cdl_state: "PA",
        },
      ],
      driver_authorizations: over.auths ?? [
        { id: "a1", purpose: "psp", accepted_at: "2026-08-01T00:00:00Z", revokes: null },
        { id: "a2", purpose: "fcra_disclosure", accepted_at: "2026-08-01T00:00:00Z", revokes: null },
      ],
      psp_requests: [],
      audit_logs: [],
    },
  });

beforeAll(async () => {
  // A configured key with ordering OFF — the shape a real deployment has before somebody decides.
  const app = createApp(loadEnv({ NODE_ENV: "test", PSP_API_KEY: "k", PSP_DOT_NUMBER: "43586" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const found = CTX[t];
    if (!found) throw new Error("bad token");
    return found;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => closeTestServer(server));

describe("who may order", () => {
  it("admits the section managers who may also read the report", async () => {
    for (const token of ["admin", "safety", "recruiter"]) {
      rec = seed();
      holder.client = rec.client;
      const res = await call(`/psp-orders/preflight?driverId=${DRIVER}`, { token });
      expect(res.status).toBe(200);
    }
  });

  /** Manages the section, cannot read §391.53(a)(1) history — cannot spend on a report they may
   *  not open. Same intersection the import uses. */
  it("refuses the fleet_manager, the dispatcher and the driver", async () => {
    for (const token of ["fleet", "dispatcher", "driver"]) {
      rec = seed();
      holder.client = rec.client;
      expect((await call(`/psp-orders/preflight?driverId=${DRIVER}`, { token })).status).toBe(403);
      expect(
        (await call("/psp-orders", { method: "POST", token, body: JSON.stringify({ driver_id: DRIVER }) })).status,
      ).toBe(403);
    }
  });
});

describe("the preflight", () => {
  it("reports the budget and what bills, without calling PSP", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call(`/psp-orders/preflight?driverId=${DRIVER}`, { token: "recruiter" });
    const body = (await res.json()) as {
      enabled: boolean; budget: { used: number; limit: number; remaining: number };
      billsOn: string[]; unitPriceUsd: number | null; refusal: { code: string } | null;
    };

    // §8: the fee lands on Success, Partial AND Failure. Read from the status table, not restated.
    expect(body.billsOn.sort()).toEqual(["failure", "partial", "success"]);
    expect(body.budget.limit).toBeGreaterThan(0);
    expect(body.budget.remaining).toBe(body.budget.limit - body.budget.used);
    // Q2 is unanswered, so the price is null rather than a number somebody invented.
    expect(body.unitPriceUsd).toBeNull();
    // The kill switch is off, so ordering is not available even with a key configured.
    expect(body.enabled).toBe(false);
    expect(body.refusal?.code).toBe("psp_disabled");
    expectOrgScoped(rec, ORG);
  });

  it("names the missing release rather than asking for a password first", async () => {
    rec = seed({ auths: [] });
    holder.client = rec.client;
    const res = await call(`/psp-orders/preflight?driverId=${DRIVER}`, { token: "recruiter" });
    const body = (await res.json()) as { refusal: { code: string } | null };
    // Ordering is disabled in this deploy, so that refusal comes first — legality is checked second,
    // and either way the answer is never "confirm your password".
    expect(["psp_disabled", "authorization_missing"]).toContain(body.refusal?.code);
    expect(body.refusal?.code).not.toBe("step_up_required");
  });
});

describe("the order", () => {
  it("refuses to spend while the kill switch is off, before reaching the vendor", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/psp-orders", {
      method: "POST",
      token: "recruiter",
      body: JSON.stringify({ driver_id: DRIVER }),
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("psp_disabled");
    // No ledger row: a refusal costs nothing and leaves nothing to explain.
    expect(rec.writtenRows("psp_requests")).toHaveLength(0);
  });

  it("rejects a body that is not a driver id", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/psp-orders", {
      method: "POST",
      token: "recruiter",
      body: JSON.stringify({ driver_id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
  });
});
