import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sectionAccess } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The permission-override API (D-PERM1, EDITABLE-PERMISSIONS-PLAN.md P1).
 *
 * ── WHY THIS FILE EXISTS AT ALL, GIVEN org-section-access.test.mjs ──────────────────────────────
 * The PGlite matrix proves the RLS policy, and that policy is what guards PostgREST. It does NOT
 * guard these handlers: the API reads with the SERVICE ROLE, which bypasses RLS entirely (root
 * CLAUDE.md). For anything reaching the database through this router, the `.eq("org_id")` filters
 * are the only isolation there is — a handler that forgot one would pass the matrix and still let
 * an admin rewrite another tenant's permissions, which is the worst write in the product.
 *
 * The second thing pinned here is the sparse-delta invariant (D-PERM4): setting a cell back to its
 * shipped default must DELETE the row, not store the default value. A stored default would read as
 * a deliberate override on the page and would silently stop tracking a future change to the shipped
 * matrix — a bug that would take a matrix revision to surface, by which time nobody would connect
 * the two.
 */
const ORG = "org-1";
const USER = "user-1";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: "admin", email: "tester@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  // P3 swapped this router's gates to `requireSection`; the stubs open the door the same way
  // `requireRole`'s always has. What each gate ADMITS is proved in middleware/requireSection.test.ts
  // against the real implementation — stubbing it here would only prove the stub.
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../../../lib/audit.js", () => ({ writeAudit: vi.fn(async () => undefined) }));

const { sectionAccessRouter } = await import("./sectionAccess.js");
const { writeAudit } = await import("../../../lib/audit.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/section-access", sectionAccessRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await closeTestServer(server);
  }
}

const put = (base: string, body: unknown) =>
  fetch(`${base}/api/section-access`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  rec = createSupabaseRecorder({
    tables: {
      org_section_access: [
        { role: "dispatcher", section: "safety", access: "view", updated_at: "2026-09-02T00:00:00Z", updated_by: USER },
      ],
    },
  });
});

describe("GET /api/section-access", () => {
  it("returns the org's overrides as a sparse map, scoped to the caller's org", async () => {
    const body = await withServer(async (base) => {
      const res = await fetch(`${base}/api/section-access`);
      expect(res.status).toBe(200);
      return (await res.json()) as { overrides: Record<string, Record<string, string>> };
    });
    expect(body.overrides).toEqual({ dispatcher: { safety: "view" } });
    expectOrgScoped(rec, ORG);
  });

  /**
   * The defaults travel with the overrides so the client never reconstructs them. A second copy of
   * SECTION_ACCESS in the browser is the restatement D-PERM4 exists to avoid, and it would be the
   * copy that goes stale, because the browser is the one shipping a cached bundle.
   */
  it("sends the shipped defaults alongside, so no client rebuilds the matrix", async () => {
    const body = await withServer(async (base) =>
      (await (await fetch(`${base}/api/section-access`)).json()) as {
        defaults: Record<string, Record<string, string>>;
        editableRoles: string[];
        editableSections: string[];
      },
    );
    expect(body.defaults.dispatcher!.dispatch).toBe(sectionAccess("dispatcher", "dispatch"));
    expect(body.defaults.recruiter!.equipment).toBe(sectionAccess("recruiter", "equipment"));
    expect(body.editableRoles).not.toContain("admin");
    expect(body.editableRoles).not.toContain("driver");
    expect(body.editableSections).not.toContain("admin");
  });

  it("drops a row for an uneditable role rather than trusting it", async () => {
    rec = createSupabaseRecorder({
      tables: {
        org_section_access: [
          { role: "admin", section: "fuel", access: "none" },
          { role: "driver", section: "fuel", access: "manage" },
          { role: "fleet_manager", section: "admin", access: "manage" },
          { role: "auditor", section: "billing", access: "none" },
        ],
      },
    });
    const body = await withServer(async (base) =>
      (await (await fetch(`${base}/api/section-access`)).json()) as { overrides: Record<string, unknown> },
    );
    expect(body.overrides).toEqual({ auditor: { billing: "none" } });
  });
});

describe("PUT /api/section-access", () => {
  it("stores an override, naming the org and the actor", async () => {
    await withServer(async (base) => {
      const res = await put(base, { role: "dispatcher", section: "safety", access: "manage" });
      expect(res.status).toBe(200);
    });
    const written = rec.writtenRows("org_section_access");
    expect(written).toEqual([
      { org_id: ORG, role: "dispatcher", section: "safety", access: "manage", updated_by: USER },
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("deletes the row instead of storing the default, so absence keeps meaning 'unchanged'", async () => {
    // `dispatcher` ships with `safety: none`, so setting `none` is a reset.
    expect(sectionAccess("dispatcher", "safety")).toBe("none");
    const body = await withServer(async (base) => {
      const res = await put(base, { role: "dispatcher", section: "safety", access: "none" });
      return (await res.json()) as { isDefault: boolean };
    });
    expect(body.isDefault).toBe(true);
    expect(rec.writtenRows("org_section_access")).toEqual([]);
    const deletes = rec.writes().filter((q) => q.write?.method === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.filters()).toContainEqual({ col: "org_id", val: ORG });
  });

  it("audits every change, carrying the default it departed from", async () => {
    await withServer(async (base) => {
      await put(base, { role: "recruiter", section: "equipment", access: "view" });
    });
    expect(writeAudit).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(writeAudit).mock.calls[0]![1];
    expect(arg.action).toBe("permissions.changed");
    expect(arg.orgId).toBe(ORG);
    expect(arg.meta).toMatchObject({
      role: "recruiter",
      section: "equipment",
      access: "view",
      shipped: "none",
      resetToDefault: false,
    });
  });

  /**
   * D-PERM7/D-PERM8 at the edge. The database refuses these too (0291's CHECK constraints), but a
   * validation 400 that names the field beats a constraint 500 that does not — and the request must
   * not reach the database at all, or a future writer could mistake "the constraint caught it" for
   * "the endpoint allows it".
   */
  it("refuses to edit the admin role, without touching the database", async () => {
    const status = await withServer(async (base) =>
      (await put(base, { role: "admin", section: "fuel", access: "none" })).status,
    );
    expect(status).toBe(400);
    expect(rec.queries).toHaveLength(0);
  });

  it("refuses to edit the driver role", async () => {
    const status = await withServer(async (base) =>
      (await put(base, { role: "driver", section: "fuel", access: "manage" })).status,
    );
    expect(status).toBe(400);
    expect(rec.queries).toHaveLength(0);
  });

  it("refuses to grant the admin section, which is the escalation path", async () => {
    const status = await withServer(async (base) =>
      (await put(base, { role: "fleet_manager", section: "admin", access: "manage" })).status,
    );
    expect(status).toBe(400);
    expect(rec.queries).toHaveLength(0);
  });

  it("refuses an access level outside the vocabulary", async () => {
    const status = await withServer(async (base) =>
      (await put(base, { role: "dispatcher", section: "fuel", access: "sudo" })).status,
    );
    expect(status).toBe(400);
  });
});
