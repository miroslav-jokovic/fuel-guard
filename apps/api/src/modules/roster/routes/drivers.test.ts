import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AuthContext } from "@silvicom/shared";
import { driverCreateSchema, driverUpdateSchema, deriveFullName, resolveDriverUpdate } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * Roster drivers — GATING and CONTRACT only.
 *
 * No test in this suite mocks Supabase (a house rule): a 200 here would mean asserting against a
 * fake DB, which proves nothing about the real one. What IS worth pinning is the security boundary —
 * who is refused before any query runs — because that is decided entirely in middleware and is
 * exactly what regresses silently when someone copies a router.
 *
 * The `fleet` section matrix (packages/shared/src/auth.ts) says: manage = admin | fleet_manager |
 * safety_manager; view adds dispatcher + auditor; driver gets nothing. (The emailed enrollment
 * route `/:id/invite` was retired on 2026-09-04 — DC9; logins come from routes/credentials.ts.)
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

describe("GET /api/roster/drivers — read gate (roster: view)", () => {
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

describe("POST /api/roster/drivers — write gate (roster: manage ∪ recruitment: manage)", () => {
  const body = JSON.stringify({ full_name: "Test Driver" });

  it("401 unauthenticated", async () => {
    expect((await call("/", { method: "POST", body })).status).toBe(401);
  });

  it.each(["driver", "dispatcher", "auditor"])("403 for %s (read-only or no access)", async (token) => {
    expect((await call("/", { method: "POST", body, token })).status).toBe(403);
  });

  /**
   * The recruiter is here, and it is the one route where the two manage-sets are unioned. An
   * applicant IS a `drivers` row, so a recruiter cannot work without this — and granting them
   * `roster: manage` to get it would hand over every driver write, which is the leak the
   * `recruitment` section exists to close (RECRUITER-ROLE-SCOPE.md §2, Option B). Since the
   * D-ROS12 split the equipment half is no longer even reachable this way — a recruiter is
   * `equipment: none` — so what stays narrow here is the roster, on its own argument.
   */
  it.each(["admin", "fleet", "safety", "recruiter"])("passes the gate for %s", async (token) => {
    const res = await call("/", { method: "POST", body, token });
    expect([401, 403]).not.toContain(res.status);
  });

  it("400 on a body that satisfies neither full_name nor first+last", async () => {
    const res = await call("/", { method: "POST", body: JSON.stringify({ first_name: "Only" }), token: "admin" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/roster/drivers/:id — detail gate (roster: view)", () => {
  const path = "/11111111-1111-1111-1111-111111111111";

  it("401 unauthenticated", async () => {
    expect((await call(path)).status).toBe(401);
  });

  it.each(["driver", "pending"])("403 for %s", async (token) => {
    expect((await call(path, { token })).status).toBe(403);
  });

  it.each(["admin", "fleet", "safety", "dispatcher", "auditor"])("passes the gate for %s", async (token) => {
    expect([401, 403]).not.toContain((await call(path, { token })).status);
  });
});

describe("PATCH /api/roster/drivers/:id — write gate (fleet ∪ recruitment, minus the lifecycle)", () => {
  const path = "/11111111-1111-1111-1111-111111111111";
  const body = JSON.stringify({ cdl_expires_at: "2027-04-01" });

  it("401 unauthenticated", async () => {
    expect((await call(path, { method: "PATCH", body })).status).toBe(401);
  });

  it.each(["driver", "dispatcher", "auditor"])("403 for %s (read-only or no access)", async (token) => {
    expect((await call(path, { method: "PATCH", body, token })).status).toBe(403);
  });

  it.each(["admin", "fleet", "safety"])("passes the gate for %s", async (token) => {
    expect([401, 403]).not.toContain((await call(path, { method: "PATCH", body, token })).status);
  });

  /**
   * The lifecycle gate (0213). Refused before the read, so a rejected edit performs no query — and
   * refused on the FIELD, so un-terminating is closed with terminating.
   */
  it.each([
    ["terminating", { status: "terminated" }],
    ["un-terminating", { status: "active" }],
    ["clearing the termination date", { termination_date: null }],
  ])("403 for a recruiter %s", async (_label, patch) => {
    const res = await call(path, { method: "PATCH", body: JSON.stringify(patch), token: "recruiter" });
    expect(res.status).toBe(403);
  });

  it("lets a recruiter make an ordinary roster edit — the gate is the lifecycle, not the row", async () => {
    const res = await call(path, {
      method: "PATCH",
      body: JSON.stringify({ date_of_birth: "1980-01-01" }),
      token: "recruiter",
    });
    expect([401, 403]).not.toContain(res.status);
  });

  it("still lets the fleet managers terminate", async () => {
    for (const token of ["admin", "fleet", "safety"]) {
      const res = await call(path, {
        method: "PATCH",
        body: JSON.stringify({ status: "terminated" }),
        token,
      });
      expect([401, 403]).not.toContain(res.status);
    }
  });

  it("400 on an empty patch", async () => {
    expect((await call(path, { method: "PATCH", body: "{}", token: "admin" })).status).toBe(400);
  });

  it("400 on a field the roster does not own", async () => {
    // `identity_source` is derived, not supplied. Strict rejection beats a silent no-op.
    const res = await call(path, { method: "PATCH", body: JSON.stringify({ identity_source: "manual" }), token: "admin" });
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

  it("rejects a date that is not YYYY-MM-DD, and reads a cleared date input as null", () => {
    expect(driverCreateSchema.safeParse({ full_name: "A B", cdl_expires_at: "04/01/2027" }).success).toBe(false);
    // A cleared <input type="date"> posts "". It used to reach Postgres as ''::date and 500.
    expect(driverCreateSchema.parse({ full_name: "A B", cdl_expires_at: "" }).cdl_expires_at).toBeNull();
  });
});

describe("driverUpdateSchema (pure contract)", () => {
  it("accepts a single field", () => {
    expect(driverUpdateSchema.safeParse({ cdl_expires_at: "2027-04-01" }).success).toBe(true);
  });

  it("rejects an empty patch — a no-op PATCH is a caller bug, not a success", () => {
    expect(driverUpdateSchema.safeParse({}).success).toBe(false);
  });

  it.each(["org_id", "id", "identity_source", "user_id", "app_access_enabled", "samsara_driver_id", "app_username"])(
    "rejects %s — another surface owns it",
    (field) => {
      expect(driverUpdateSchema.safeParse({ [field]: "x" }).success).toBe(false);
    },
  );

  it("rejects a status outside the canonical vocabulary", () => {
    expect(driverUpdateSchema.safeParse({ status: "vacationing" }).success).toBe(false);
  });
});

describe("resolveDriverUpdate — what an edit MEANS", () => {
  const base = {
    identity_source: "samsara",
    termination_date: null,
    first_name: "Aaron",
    middle_name: null,
    last_name: "Rothenberg",
  };
  const TODAY = "2026-08-08";

  it("editing an identity field claims the row from telematics", () => {
    const r = resolveDriverUpdate({ phone: "555-0100" }, base, TODAY);
    expect(r.claimedFromTelematics).toBe(true);
    expect(r.patch.identity_source).toBe("manual");
  });

  it("editing a non-identity field does NOT sever the telematics name refresh", () => {
    const r = resolveDriverUpdate({ pay_rate: 0.62 }, base, TODAY);
    expect(r.claimedFromTelematics).toBe(false);
    expect(r.patch.identity_source).toBeUndefined();
  });

  it("does not re-claim a row the office already owns", () => {
    const r = resolveDriverUpdate({ phone: "555-0100" }, { ...base, identity_source: "manual" }, TODAY);
    expect(r.claimedFromTelematics).toBe(false);
    expect(r.patch.identity_source).toBeUndefined();
  });

  it("recomputes full_name from the merged parts when only a part is edited", () => {
    const r = resolveDriverUpdate({ last_name: "Rothenburg" }, base, TODAY);
    expect(r.derivedFullName).toBe(true);
    expect(r.patch.full_name).toBe("Aaron Rothenburg");
  });

  it("does not recompute when the caller sent full_name itself", () => {
    const r = resolveDriverUpdate({ full_name: "A. Rothenberg", last_name: "Rothenberg" }, base, TODAY);
    expect(r.derivedFullName).toBe(false);
    expect(r.patch.full_name).toBe("A. Rothenberg");
  });

  it("never writes an empty full_name — the column is NOT NULL", () => {
    const r = resolveDriverUpdate(
      { first_name: null, last_name: null },
      { ...base, middle_name: null },
      TODAY,
    );
    expect(r.derivedFullName).toBe(false);
    expect(r.patch.full_name).toBeUndefined();
  });

  it("stamps a termination date when terminating without one (§391.51(c) retention clock)", () => {
    const r = resolveDriverUpdate({ status: "terminated" }, base, TODAY);
    expect(r.stampedTerminationDate).toBe(true);
    expect(r.patch.termination_date).toBe(TODAY);
  });

  it("never overwrites an existing termination date", () => {
    const r = resolveDriverUpdate({ status: "terminated" }, { ...base, termination_date: "2026-01-05" }, TODAY);
    expect(r.stampedTerminationDate).toBe(false);
    expect(r.patch.termination_date).toBeUndefined();
  });

  it("respects a termination date the caller supplied", () => {
    const r = resolveDriverUpdate({ status: "terminated", termination_date: "2026-07-31" }, base, TODAY);
    expect(r.stampedTerminationDate).toBe(false);
    expect(r.patch.termination_date).toBe("2026-07-31");
  });

  it("does not stamp anything when the status change is not a termination", () => {
    const r = resolveDriverUpdate({ status: "on_leave" }, base, TODAY);
    expect(r.stampedTerminationDate).toBe(false);
    expect(r.patch.termination_date).toBeUndefined();
  });
});
