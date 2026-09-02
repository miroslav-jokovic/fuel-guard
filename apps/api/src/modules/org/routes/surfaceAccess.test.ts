import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The screen-entitlement API (D-SURF1, SURFACE-ENTITLEMENTS-PLAN.md S3).
 *
 * The sibling of `sectionAccess.test.ts`, and it exists for the same reason that one does: the
 * PGlite matrix proves the RLS policy, and that policy guards PostgREST — it does NOT guard these
 * handlers, which read with the SERVICE ROLE and bypass RLS entirely. For anything reaching the
 * database through this router the `.eq("org_id")` filters are the only isolation there is, and a
 * handler that forgot one would pass the matrix while letting an admin rewrite another tenant's
 * permissions.
 *
 * Two more things are pinned here that only this layer can answer:
 *
 *  · **Allowing a screen back DELETES the row.** The table is a sparse delta (D-SURF6) and "no row"
 *    is how it says "unchanged". A stored `true` would read as a deliberate answer on the page and
 *    would keep applying after the surface's own gate changed underneath it.
 *  · **An unknown or uneditable key is refused by the schema, not by the database.** 0296 leaves
 *    `surface_key` unconstrained on purpose (a bad key is inert in SQL), so this is the layer that
 *    can say which field was wrong — and the layer that stops an org being offered a control over a
 *    screen that is a product constant (Q-SURF3).
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
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../../../lib/audit.js", () => ({ writeAudit: vi.fn(async () => undefined) }));

const { surfaceAccessRouter, toSurfaceOverrides, surfaceClaimFor } = await import("./surfaceAccess.js");
const { writeAudit } = await import("../../../lib/audit.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/surface-access", surfaceAccessRouter());
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
  fetch(`${base}/api/surface-access`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  rec = createSupabaseRecorder({
    tables: {
      org_role_surface_access: [
        { role: "technician", surface_key: "maintenance.inspectors", allowed: false },
      ],
    },
  });
});

describe("GET /api/surface-access", () => {
  it("returns the org's answers as a sparse map, scoped to the caller's org", async () => {
    const body = await withServer(async (base) => {
      const res = await fetch(`${base}/api/surface-access`);
      expect(res.status).toBe(200);
      return (await res.json()) as { overrides: Record<string, Record<string, boolean>> };
    });
    expect(body.overrides).toEqual({ technician: { "maintenance.inspectors": false } });
    expectOrgScoped(rec, ORG);
  });

  it("sends the catalogue alongside, and only the screens an org may actually change", async () => {
    const body = await withServer(
      async (base) =>
        (await (await fetch(`${base}/api/surface-access`)).json()) as {
          surfaces: Array<{ key: string; section: string | null }>;
          editableRoles: string[];
        },
    );
    const keys = body.surfaces.map((s) => s.key);
    expect(keys).toContain("maintenance.inspectors");
    // Q-SURF3: product constants are not offered as cells. Dashboard and Fuel Log carry no role
    // gate, Ask AI is any staff role, Users is admin-only — none of them an org's to deny.
    expect(keys).not.toContain("dashboard");
    expect(keys).not.toContain("fuel.log");
    expect(keys).not.toContain("ask-ai");
    expect(keys).not.toContain("admin.users");
    // D-SURF8: a detail route is never separately grantable, so it is never a cell either.
    expect(keys.every((k) => !k.endsWith(".detail"))).toBe(true);
    expect(body.editableRoles).not.toContain("admin");
    expect(body.editableRoles).not.toContain("driver");
    // Every offered screen names the section it can never reach past (D-SURF2).
    expect(body.surfaces.every((s) => s.section !== null)).toBe(true);
  });
});

describe("PUT /api/surface-access", () => {
  it("denying a screen writes one row, org-scoped, and audits it", async () => {
    await withServer(async (base) => {
      const res = await put(base, { role: "technician", surfaceKey: "maintenance.repair-spend", allowed: false });
      expect(res.status).toBe(200);
    });
    const inserted = rec.writtenRows("org_role_surface_access");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      org_id: ORG,
      role: "technician",
      surface_key: "maintenance.repair-spend",
      allowed: false,
      updated_by: USER,
    });
    expectOrgScoped(rec, ORG);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: ORG, action: "permissions.screen_changed" }),
    );
  });

  /**
   * The sparse-delta invariant, and the reason it is asserted rather than assumed: a stored `true`
   * is indistinguishable from "the org decided this" on the page, and it would keep applying after
   * the shipped gate moved underneath it.
   */
  it("allowing a screen back DELETES the row instead of storing `true`", async () => {
    await withServer(async (base) => {
      const res = await put(base, { role: "technician", surfaceKey: "maintenance.inspectors", allowed: true });
      expect(res.status).toBe(200);
    });
    expect(rec.writtenRows("org_role_surface_access")).toHaveLength(0);
    expect(rec.forTable("org_role_surface_access").some((q) => q.write?.method === "delete")).toBe(true);
  });

  it("refuses a key the catalogue does not have", async () => {
    await withServer(async (base) => {
      const res = await put(base, { role: "technician", surfaceKey: "maintenance.ghost", allowed: false });
      expect(res.status).toBe(400);
    });
    expect(rec.writtenRows("org_role_surface_access")).toHaveLength(0);
  });

  it("refuses a screen that is a product constant (Q-SURF3)", async () => {
    for (const key of ["dashboard", "ask-ai", "admin.users"]) {
      await withServer(async (base) => {
        const res = await put(base, { role: "technician", surfaceKey: key, allowed: false });
        expect(res.status, `${key} should not be an org's to deny`).toBe(400);
      });
    }
  });

  it("refuses a detail route, which is never separately grantable (D-SURF8)", async () => {
    await withServer(async (base) => {
      const res = await put(base, {
        role: "technician",
        surfaceKey: "maintenance.inspections.detail",
        allowed: false,
      });
      expect(res.status).toBe(400);
    });
  });

  it("refuses the two locked roles (D-PERM7/D-PERM8)", async () => {
    for (const role of ["admin", "driver"]) {
      await withServer(async (base) => {
        const res = await put(base, { role, surfaceKey: "maintenance.inspectors", allowed: false });
        expect(res.status, `${role} is not editable`).toBe(400);
      });
    }
  });
});

describe("toSurfaceOverrides", () => {
  /**
   * 0296 leaves `surface_key` unconstrained because a bad key is inert in SQL. "Inert" is made true
   * HERE, and it matters most for a key that used to exist: a screen removed from the catalogue must
   * not leave its old denial applying to nothing — or worse, to a key some later surface reuses.
   */
  it("drops rows naming a key the catalogue no longer has", () => {
    expect(
      toSurfaceOverrides([
        { role: "technician", surface_key: "maintenance.inspectors", allowed: false },
        { role: "technician", surface_key: "a.screen.that.was.retired", allowed: false },
      ]),
    ).toEqual({ technician: { "maintenance.inspectors": false } });
  });

  it("drops rows naming a role that cannot hold an override", () => {
    expect(
      toSurfaceOverrides([{ role: "admin", surface_key: "maintenance.inspectors", allowed: false }]),
    ).toEqual({});
  });
});

describe("surfaceClaimFor", () => {
  it("returns just this role's slice, org-scoped", async () => {
    const claim = await surfaceClaimFor(rec.client as never, ORG, "technician");
    expect(claim).toEqual({ "maintenance.inspectors": false });
    expectOrgScoped(rec, ORG);
  });

  /**
   * Fail OPEN, deliberately. A surface entitlement may only NARROW within a section (D-SURF2), so an
   * empty claim is the shipped catalogue and never more than it. Failing closed would turn a
   * transient database blip into every member of the org losing their sidebar, while the section
   * gate underneath — the actual security boundary — is untouched either way.
   */
  it("returns no denials when the table cannot be read, rather than denying everything", async () => {
    const broken = createSupabaseRecorder({
      tables: { org_role_surface_access: { data: null, error: { message: "boom" } } },
    });
    expect(await surfaceClaimFor(broken.client as never, ORG, "technician")).toEqual({});
  });

  it("returns no denials for a role that cannot hold one", async () => {
    expect(await surfaceClaimFor(rec.client as never, ORG, "admin")).toEqual({});
  });
});
