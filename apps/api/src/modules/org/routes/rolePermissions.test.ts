import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { IDENTITY_NUMBER_IMAGES_PERMISSION } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { stepUpHeaders } from "../../../testing/stepUp.js";

/**
 * Named permissions a carrier switches per role (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.1, D-IDP1..4).
 *
 * The matrix (`org-role-permissions.test.mjs`) proves the table's locks and the audited write; it cannot
 * see this router, which reads with the SERVICE ROLE and bypasses RLS — so the org filter on every read
 * and the org argument on every write are this file's to pin. Plus the two choices the database cannot
 * make: a switch back to its shipped value stores NO row (D-PERM4), and a failed read answers CLOSED.
 */

const ORG = "org-1";
const USER = "user-1";
const KEY = IDENTITY_NUMBER_IMAGES_PERMISSION;

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", async () => {
  const { STEP_UP_TEST_KEY } = await import("../../../testing/stepUp.js");
  return { getAppLocals: () => ({ env: { SECRETS_ENCRYPTION_KEY: STEP_UP_TEST_KEY } }) };
});
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: "admin", email: "tester@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  // What `requireRole("admin")` admits is proved against the real gate in middleware tests.
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { rolePermissionsRouter, loadPermissionGrants } = await import("./rolePermissions.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/role-permissions", rolePermissionsRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await closeTestServer(server);
  }
}

const cellCalls = () =>
  rec.rpcs().filter((r) => r.fn === "write_access_cell").map((r) => r.args as Record<string, unknown>);

const put = (base: string, body: unknown, stepUp = true) =>
  fetch(`${base}/api/role-permissions`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(stepUp ? stepUpHeaders(USER, ORG) : {}) },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  rec = createSupabaseRecorder({
    tables: { org_role_permissions: [{ role: "recruiter", permission: KEY, allowed: false }] },
  });
});

describe("GET /api/role-permissions", () => {
  it("returns the org's switches with the catalogue they are read against, scoped to the caller's org", async () => {
    const body = await withServer(async (base) => {
      const res = await fetch(`${base}/api/role-permissions`);
      expect(res.status).toBe(200);
      return (await res.json()) as {
        grants: Record<string, Record<string, boolean>>;
        permissions: { key: string; shippedRoles: string[] }[];
        editableRoles: string[];
      };
    });
    expect(body.grants).toEqual({ recruiter: { [KEY]: false } });
    expect(body.permissions.find((p) => p.key === KEY)?.shippedRoles.sort()).toEqual(["recruiter", "safety_manager"]);
    expect(body.editableRoles).not.toContain("admin");
    expect(body.editableRoles).not.toContain("driver");
    expectOrgScoped(rec, ORG);
  });
});

describe("PUT /api/role-permissions", () => {
  it("switches a role on through write_access_cell, with the org from the token and its audit action", async () => {
    const status = await withServer(async (base) => (await put(base, { role: "dispatcher", permission: KEY, allowed: true })).status);
    expect(status).toBe(200);
    expect(cellCalls()).toEqual([
      expect.objectContaining({
        p_table: "org_role_permissions",
        p_org_id: ORG,
        p_role: "dispatcher",
        p_user_id: null,
        p_key: KEY,
        p_value: "true",
        p_actor: USER,
        p_action: "permissions.named_changed",
      }),
    ]);
  });

  it("stores NO row for a switch back to its shipped value (D-PERM4)", async () => {
    await withServer(async (base) => {
      await put(base, { role: "recruiter", permission: KEY, allowed: true });
      await put(base, { role: "auditor", permission: KEY, allowed: null });
    });
    expect(cellCalls().map((c) => c.p_value)).toEqual([null, null]);
  });

  it("refuses the admin role, an unknown permission, and a write without the password again", async () => {
    const statuses = await withServer(async (base) => [
      (await put(base, { role: "admin", permission: KEY, allowed: false })).status,
      (await put(base, { role: "recruiter", permission: "safety.anything", allowed: true })).status,
      (await put(base, { role: "recruiter", permission: KEY, allowed: false }, false)).status,
    ]);
    expect(statuses[0]).toBe(400);
    expect(statuses[1]).toBe(400);
    expect(statuses[2]).toBeGreaterThanOrEqual(400);
    expect(cellCalls()).toEqual([]);
  });
});

describe("loadPermissionGrants (D-IDP3)", () => {
  it("reads the caller's org only", async () => {
    expect(await loadPermissionGrants(rec.client, ORG)).toEqual({ recruiter: { [KEY]: false } });
    expectOrgScoped(rec, ORG);
  });

  it("answers CLOSED on a failed read — the recruiter is not handed a picture its carrier may have refused", async () => {
    rec = createSupabaseRecorder({ tables: { org_role_permissions: { error: { message: "down" } } } });
    const grants = await loadPermissionGrants(rec.client, ORG);
    expect(grants.recruiter?.[KEY]).toBe(false);
    expect(grants.safety_manager?.[KEY]).toBe(false);
  });
});
