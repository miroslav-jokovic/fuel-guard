import { describe, expect, it, vi, beforeEach } from "vitest";
import { NAV_SURFACES } from "@silvicom/shared";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { stepUpHeaders } from "../../../testing/stepUp.js";

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
/** The technician the owner's example names, and a colleague on the same role who must be untouched. */
const SHOP_LEAD = "00000000-0000-4000-8000-000000000010";
const OTHER_TECH = "00000000-0000-4000-8000-000000000011";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
// SP9: the key the step-up token is verified against — the same one `stepUpHeaders` mints under.
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
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../../../lib/audit.js", () => ({ writeAudit: vi.fn(async () => undefined) }));

const { surfaceAccessRouter, toSurfaceOverrides, toUserSurfaceClaim, surfaceClaimFor } = await import(
  "./surfaceAccess.js"
);
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

/** The `write_access_cell` calls this test's requests made, by their arguments (SP8). */
const cellCalls = () =>
  rec.rpcs().filter((r) => r.fn === "write_access_cell").map((r) => r.args as Record<string, unknown>);

/** A write as the page makes it: with the step-up token the password prompt minted (SP9). */
const put = (base: string, body: unknown, stepUp = true) =>
  fetch(`${base}/api/surface-access`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(stepUp ? stepUpHeaders(USER, ORG) : {}) },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  rec = createSupabaseRecorder({
    tables: {
      org_role_surface_access: [
        { role: "technician", surface_key: "maintenance.inspectors", allowed: false },
      ],
      // The table holds rows for ONE member, and the fixture applies the `user_id` filter the query
      // actually asked for — returning EVERYTHING when it asked for none, which is what Postgres
      // would do. A fixture that answered `[]` for an unfiltered read would make a handler that
      // forgot `.eq("user_id")` look correct; this one hands the shop lead's answers to every
      // technician, which is the "no other technician is affected" half of S4.
      user_surface_access: (q) => {
        const rows = [
          { user_id: SHOP_LEAD, surface_key: "maintenance.inspectors", allowed: true },
          { user_id: SHOP_LEAD, surface_key: "maintenance.repair-spend", allowed: false },
        ];
        const filter = q.filters().find((f) => f.col === "user_id");
        return filter ? rows.filter((r) => r.user_id === filter.val) : rows;
      },
      memberships: [{ role: "technician" }],
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
    // Q-SURF3: product constants are not offered as cells. Dashboard carries no role gate, Users
    // is admin-only — none of them an org's to deny. Fuel Log and the two
    // hazmat pages WERE on this list until D-SURF10 (2026-09-03) put every page in a section's group
    // behind that section; they are cells now, and their absence here would be the old defect back.
    expect(keys).not.toContain("dashboard");
    // Ask AI WAS a product constant (`staff`) until Q-SET15 (owner 2026-09-30) made it admin-only by
    // default and grantable: a Fuel-gated cell that starts off, like the Settings screens.
    expect(keys).toContain("ask-ai");
    expect(keys).not.toContain("admin.users");
    expect(keys).toContain("fuel.log");
    expect(keys).toContain("safety.hazmat-review");
    expect(keys).toContain("safety.placard-calculator");
    // D-SURF8: a detail route is never separately grantable, so it is never a cell either.
    expect(keys.every((k) => !k.endsWith(".detail"))).toBe(true);
    expect(body.editableRoles).not.toContain("admin");
    expect(body.editableRoles).not.toContain("driver");
    // Every offered screen names the section it can never reach past (D-SURF2).
    expect(body.surfaces.every((s) => s.section !== null)).toBe(true);
  });

  /**
   * SP1: the Settings screens are cells now, each with its own key — and the four Q-SET1 ruled
   * admin-only are not. The directory and the starting default travel with each row, because the
   * page cannot group the row or draw its switch without them.
   */
  it("offers each Settings screen as its own cell, with where it is reached from and who it starts on for", async () => {
    const body = await withServer(
      async (base) =>
        (await (await fetch(`${base}/api/surface-access`)).json()) as {
          surfaces: Array<{ key: string; reachedFrom: string | null; startsOnFor: string[] | null }>;
        },
    );
    const byKey = new Map(body.surfaces.map((s) => [s.key, s]));
    expect(byKey.get("admin.settings.org")).toMatchObject({ reachedFrom: "admin.settings", startsOnFor: [] });
    expect(byKey.get("admin.settings.audit")).toMatchObject({ reachedFrom: "admin.settings", startsOnFor: [] });
    expect(byKey.get("admin.settings.data")).toMatchObject({ reachedFrom: "admin.settings", startsOnFor: [] });
    // The Settings entry itself is not a cell: it follows the screens behind it.
    expect(byKey.has("admin.settings")).toBe(false);
    expect(byKey.get("fuel.log")).toMatchObject({ reachedFrom: null, startsOnFor: null });
    for (const key of ["admin.users", "admin.settings.permissions", "admin.settings.card-control", "admin.settings.efs"])
      expect(byKey.has(key), `${key} is admin-only by Q-SET1`).toBe(false);
  });
});

describe("PUT /api/surface-access", () => {
  /**
   * SP8 (Q-SET7 (a), migration 0395): the cell and its audit row are ONE `write_access_cell` call.
   * The org comes from the token, the answer travels as the boolean's text (the function casts it to
   * the column's type), and no separate insert, delete or `writeAudit` is left to fail between.
   */
  it("denying a screen is one write_access_cell call, org-scoped, carrying the audit meta", async () => {
    await withServer(async (base) => {
      const res = await put(base, { role: "technician", surfaceKey: "maintenance.repair-spend", allowed: false });
      expect(res.status).toBe(200);
    });
    expect(cellCalls()).toEqual([
      {
        p_table: "org_role_surface_access",
        p_org_id: ORG,
        p_role: "technician",
        p_user_id: null,
        p_key: "maintenance.repair-spend",
        p_value: "false",
        p_actor: USER,
        p_action: "permissions.screen_changed",
        p_meta: { role: "technician", surfaceKey: "maintenance.repair-spend", allowed: false, resetToDefault: false },
      },
    ]);
    expect(rec.writes()).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  /**
   * The sparse-delta invariant, and the reason it is asserted rather than assumed: a stored `true`
   * is indistinguishable from "the org decided this" on the page, and it would keep applying after
   * the shipped gate moved underneath it.
   */
  it("allowing a screen back asks for NO row (null) instead of storing `true`", async () => {
    await withServer(async (base) => {
      const res = await put(base, { role: "technician", surfaceKey: "maintenance.inspectors", allowed: true });
      expect(res.status).toBe(200);
    });
    expect(cellCalls()).toHaveLength(1);
    expect(cellCalls()[0]!.p_value).toBeNull();
  });

  /**
   * Q-SET2: a screen that starts OFF for a role is turned on by storing `true` — the one role-layer
   * answer that could never be a row before SP1 — and answering `false` is then the reset, which
   * stores nothing. The same PUT, the same sparse delta, measured against the screen's starting value
   * instead of against a constant `true`.
   */
  it("turning on a screen that starts off STORES `true`, and turning it off again stores nothing", async () => {
    await withServer(async (base) => {
      const res = await put(base, { role: "fleet_manager", surfaceKey: "admin.settings.org", allowed: true });
      expect(res.status).toBe(200);
    });
    expect(cellCalls()).toEqual([
      expect.objectContaining({
        p_org_id: ORG,
        p_role: "fleet_manager",
        p_key: "admin.settings.org",
        p_value: "true",
        p_meta: expect.objectContaining({ allowed: true, resetToDefault: false }),
      }),
    ]);

    rec.reset();
    await withServer(async (base) => {
      const res = await put(base, { role: "fleet_manager", surfaceKey: "admin.settings.org", allowed: false });
      expect(res.status).toBe(200);
    });
    expect(cellCalls()).toEqual([
      expect.objectContaining({ p_value: null, p_meta: expect.objectContaining({ allowed: false, resetToDefault: true }) }),
    ]);
  });

  /** The Audit log starts ON for the auditor (Q-SET3), so for them it is `false` that makes a row. */
  it("measures the reset per screen: a Settings screen starts off for every role, any other screen on", async () => {
    await withServer(async (base) => {
      expect((await put(base, { role: "auditor", surfaceKey: "admin.settings.audit", allowed: false })).status).toBe(200);
      expect((await put(base, { role: "fleet_manager", surfaceKey: "fuel.log", allowed: true })).status).toBe(200);
    });
    expect(cellCalls().map((c) => c.p_value)).toEqual([null, null]);
    rec.reset();
    await withServer(async (base) => {
      expect((await put(base, { role: "auditor", surfaceKey: "admin.settings.audit", allowed: true })).status).toBe(200);
    });
    expect(cellCalls()).toEqual([
      expect.objectContaining({ p_role: "auditor", p_key: "admin.settings.audit", p_value: "true" }),
    ]);
  });

  it("answers 500 and no success when the function fails — the change and its record did not happen", async () => {
    rec = createSupabaseRecorder({ rpc: { write_access_cell: { error: { message: "boom" } } } });
    const res = await withServer(async (base) => {
      const r = await put(base, { role: "technician", surfaceKey: "maintenance.repair-spend", allowed: false });
      return { status: r.status, body: (await r.json()) as { ok?: boolean; error?: { code: string } } };
    });
    expect(res.status).toBe(500);
    expect(res.body.ok).toBeUndefined();
    expect(res.body.error?.code).toBe("db_error");
  });

  it("refuses each screen Q-SET1 keeps admin-only", async () => {
    for (const key of ["admin.settings.permissions", "admin.settings.card-control", "admin.settings.efs"]) {
      await withServer(async (base) => {
        const res = await put(base, { role: "fleet_manager", surfaceKey: key, allowed: true });
        expect(res.status, `${key} should never be offered`).toBe(400);
      });
    }
    expect(cellCalls()).toHaveLength(0);
  });

  it("refuses a key the catalogue does not have", async () => {
    await withServer(async (base) => {
      const res = await put(base, { role: "technician", surfaceKey: "maintenance.ghost", allowed: false });
      expect(res.status).toBe(400);
    });
    expect(cellCalls()).toHaveLength(0);
  });

  it("refuses a screen that is a product constant (Q-SURF3)", async () => {
    for (const key of ["dashboard", "admin.users"]) {
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

// ── S4: the per-USER layer (D-SURF7) ──────────────────────────────────────────────────────────
//
// What distinguishes S4 from S3 is one clause of the plan's Done-when: "and no other technician is
// affected". A role-level answer applied to the wrong person looks identical to a working feature
// on the screen of the person who asked for it, so the fixture above varies by the `user_id` filter
// the query actually applied — a handler that dropped that filter reads one member's answers for
// everybody, and only an assertion about a DIFFERENT member can see it.

const putUser = (base: string, body: unknown, stepUp = true) =>
  fetch(`${base}/api/surface-access/user`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(stepUp ? stepUpHeaders(USER, ORG) : {}) },
    body: JSON.stringify(body),
  });

describe("PUT /api/surface-access/user", () => {
  it("denying a screen for one member is one write_access_cell call, org- and user-scoped", async () => {
    await withServer(async (base) => {
      const res = await putUser(base, {
        userId: SHOP_LEAD,
        surfaceKey: "maintenance.repair-spend",
        allowed: false,
      });
      expect(res.status).toBe(200);
    });
    // The user_id is the SUBJECT of the cell: without it the function could not tell this member's
    // row from every other technician's, which is the "no other technician is affected" half of S4.
    expect(cellCalls()).toEqual([
      {
        p_table: "user_surface_access",
        p_org_id: ORG,
        p_role: null,
        p_user_id: SHOP_LEAD,
        p_key: "maintenance.repair-spend",
        p_value: "false",
        p_actor: USER,
        p_action: "permissions.screen_changed_user",
        p_meta: { userId: SHOP_LEAD, role: "technician", surfaceKey: "maintenance.repair-spend", allowed: false, resetToRole: false },
      },
    ]);
    expectOrgScoped(rec, ORG);
    expect(rec.writes()).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  /**
   * The row 0296's boolean column exists for, and the reason this endpoint is NOT symmetric with the
   * role-level one above: an org denies Inspectors to `technician`, then gives it back to the shop
   * lead alone. At the role layer a `true` is inert and therefore a reset; here it is the answer.
   */
  it("allowing a screen back for one member STORES `true` rather than removing the row", async () => {
    await withServer(async (base) => {
      const res = await putUser(base, {
        userId: SHOP_LEAD,
        surfaceKey: "maintenance.inspectors",
        allowed: true,
      });
      expect(res.status).toBe(200);
    });
    expect(cellCalls()).toEqual([expect.objectContaining({ p_user_id: SHOP_LEAD, p_value: "true" })]);
  });

  it("`allowed: null` is the reset — the function is asked to remove the row", async () => {
    await withServer(async (base) => {
      const res = await putUser(base, {
        userId: SHOP_LEAD,
        surfaceKey: "maintenance.inspectors",
        allowed: null,
      });
      expect(res.status).toBe(200);
    });
    expect(cellCalls()).toEqual([
      expect.objectContaining({ p_user_id: SHOP_LEAD, p_value: null, p_meta: expect.objectContaining({ resetToRole: true }) }),
    ]);
  });

  /**
   * D-PERM7/D-PERM8 cannot be a CHECK constraint on a user-keyed table — a row does not know its
   * member's role, and 0298's header says so at length. This is one of the two places the lock
   * actually lives; the other is `surfaceClaimFor`, below.
   */
  it("refuses a member whose role is locked (D-PERM7/D-PERM8)", async () => {
    for (const role of ["admin", "driver"]) {
      rec = createSupabaseRecorder({ tables: { memberships: [{ role }] } });
      await withServer(async (base) => {
        const res = await putUser(base, {
          userId: SHOP_LEAD,
          surfaceKey: "maintenance.inspectors",
          allowed: false,
        });
        expect(res.status, `${role} is not editable`).toBe(400);
      });
      expect(cellCalls()).toHaveLength(0);
    }
  });

  /**
   * The membership lookup is org-scoped as well as user-scoped, and that is not tidiness: the
   * service role bypasses RLS, so without the `org_id` filter an admin could answer for a member of
   * another tenant and the composite foreign key would be the only thing left — a 500, not a
   * refusal.
   */
  it("refuses a person who is not a member of the caller's org", async () => {
    rec = createSupabaseRecorder({ tables: { memberships: [] } });
    await withServer(async (base) => {
      const res = await putUser(base, {
        userId: OTHER_TECH,
        surfaceKey: "maintenance.inspectors",
        allowed: false,
      });
      expect(res.status).toBe(404);
    });
    expect(cellCalls()).toHaveLength(0);
    const lookup = rec.forTable("memberships");
    expect(lookup).toHaveLength(1);
    expect(lookup[0]!.filters()).toEqual(
      expect.arrayContaining([
        { col: "org_id", val: ORG },
        { col: "user_id", val: OTHER_TECH },
      ]),
    );
  });

  it("refuses a key the catalogue does not have, and a product constant, before any lookup", async () => {
    for (const surfaceKey of ["maintenance.ghost", "admin.users", "maintenance.inspections.detail"]) {
      await withServer(async (base) => {
        const res = await putUser(base, { userId: SHOP_LEAD, surfaceKey, allowed: false });
        expect(res.status, `${surfaceKey} should not be answerable`).toBe(400);
      });
    }
    expect(cellCalls()).toHaveLength(0);
  });
});

describe("toUserSurfaceClaim", () => {
  /**
   * The mirror of `toSurfaceOverrides`'s guard, and it matters more here: a `true` for a retired key
   * is not merely inert, it would be a stored GRANT pointing at whatever screen later reuses the
   * name. Keeping both booleans otherwise is the point — this layer is the only one where `true`
   * says something.
   */
  it("keeps both answers but drops a key the catalogue no longer has", () => {
    expect(
      toUserSurfaceClaim([
        { surface_key: "maintenance.inspectors", allowed: true },
        { surface_key: "maintenance.repair-spend", allowed: false },
        { surface_key: "a.screen.that.was.retired", allowed: true },
      ]),
    ).toEqual({ "maintenance.inspectors": true, "maintenance.repair-spend": false });
  });
});

describe("surfaceClaimFor — the user layer over the role layer (D-SURF6)", () => {
  /**
   * The owner's example, resolved: the org has taken Inspectors from `technician`, and the shop lead
   * keeps it while also losing Repair spend that the role still has.
   */
  it("merges the member's own answers OVER their role's", async () => {
    expect(await surfaceClaimFor(rec.client as never, ORG, "technician", SHOP_LEAD)).toEqual({
      "maintenance.inspectors": true,
      "maintenance.repair-spend": false,
    });
    expectOrgScoped(rec, ORG);
  });

  /** The clause that distinguishes S4 from S3. */
  it("leaves every other member of the same role untouched", async () => {
    expect(await surfaceClaimFor(rec.client as never, ORG, "technician", OTHER_TECH)).toEqual({
      "maintenance.inspectors": false,
    });
  });

  /**
   * Fail OPEN, one layer at a time. This is the property that licenses S4 shipping its table and its
   * reader in ONE merge against D-SURF9's two-merge rule: for the ~9 minutes between a deploy being
   * served and its migration being applied, the user table does not exist, which is a query error,
   * so the role layer answers exactly as it did the minute before.
   */
  it("returns the role's answers unchanged when the user table cannot be read", async () => {
    const broken = createSupabaseRecorder({
      tables: {
        org_role_surface_access: [
          { role: "technician", surface_key: "maintenance.inspectors", allowed: false },
        ],
        user_surface_access: { data: null, error: { message: "relation does not exist" } },
      },
    });
    expect(await surfaceClaimFor(broken.client as never, ORG, "technician", SHOP_LEAD)).toEqual({
      "maintenance.inspectors": false,
    });
  });

  /** …and the mirror: the role table failing does not discard the member's own answers. */
  it("keeps the member's answers when the ROLE table cannot be read", async () => {
    const broken = createSupabaseRecorder({
      tables: {
        org_role_surface_access: { data: null, error: { message: "boom" } },
        user_surface_access: [{ surface_key: "maintenance.inspectors", allowed: false }],
      },
    });
    expect(await surfaceClaimFor(broken.client as never, ORG, "technician", SHOP_LEAD)).toEqual({
      "maintenance.inspectors": false,
    });
  });

  /**
   * The READ half of the lock 0298 cannot state as a CHECK. A row for a locked role can only exist
   * through a restore, a support action or a future writer — and this is the last place that can
   * decline to honour it, so it must refuse before either table is read rather than after.
   */
  it("reads neither table for a role that cannot hold an override", async () => {
    expect(await surfaceClaimFor(rec.client as never, ORG, "admin", SHOP_LEAD)).toEqual({});
    expect(rec.forTable("user_surface_access")).toHaveLength(0);
  });

  /** A caller with no user id — the shape `/api/me` had before S4 — still gets the role's answers. */
  it("answers with the role alone when no member is named", async () => {
    expect(await surfaceClaimFor(rec.client as never, ORG, "technician")).toEqual({
      "maintenance.inspectors": false,
    });
    expect(rec.forTable("user_surface_access")).toHaveLength(0);
  });
});

/**
 * The per-user READ (S6) — the People tab's half of the screen answers.
 *
 * Its sibling in `sectionAccess.test.ts` explains why the layers travel unmerged. The extra thing
 * this one carries is the catalogue: a cell cannot be drawn without knowing which SECTION the
 * screen sits behind and at what level, because a screen inside a section the member does not hold
 * is not a choice an admin has (D-SURF2) and the page has to say so rather than offer a control
 * that changes nothing.
 */
describe("GET /api/surface-access/user/:userId", () => {
  const layered = () =>
    createSupabaseRecorder({
      tables: {
        org_role_surface_access: (q) => {
          const rows = [
            { role: "technician", surface_key: "maintenance.inspectors", allowed: false },
            // A screen the ROLE loses and the member says nothing about, so the two layers do not
            // answer the same key. Without it, merging one into the other is invisible — the merge
            // mutation passed every assertion until this row existed.
            { role: "technician", surface_key: "fuel.cards", allowed: false },
            { role: "recruiter", surface_key: "recruitment.screening", allowed: false },
          ];
          const f = q.filters().find((x) => x.col === "role");
          return f ? rows.filter((r) => r.role === f.val) : rows;
        },
        // Filters applied as Postgres would apply them — a fixture answering `[]` for an unfiltered
        // read makes a handler that forgot `.eq("user_id")` or `.eq("org_id")` look correct.
        user_surface_access: (q) => {
          const rows = [
            { org_id: ORG, user_id: SHOP_LEAD, surface_key: "maintenance.inspectors", allowed: true },
            { org_id: ORG, user_id: OTHER_TECH, surface_key: "maintenance.repair-spend", allowed: false },
            { org_id: "org-2", user_id: SHOP_LEAD, surface_key: "fuel.ifta", allowed: false },
          ];
          return q
            .filters()
            .reduce(
              (acc, f) => acc.filter((r) => (r as Record<string, unknown>)[f.col] === f.val),
              rows as Array<Record<string, unknown>>,
            );
        },
        memberships: [{ role: "technician" }],
      },
    });

  const get = async (userId: string) =>
    withServer(async (base) => {
      const res = await fetch(`${base}/api/surface-access/user/${userId}`);
      return {
        status: res.status,
        body: (await res.json()) as {
          role?: string;
          roleOverrides?: Record<string, boolean>;
          userOverrides?: Record<string, boolean>;
          surfaces?: Array<{ key: string; section: string | null; level: string | null }>;
        },
      };
    });

  it("returns the two layers separately, never merged", async () => {
    rec = layered();
    const { status, body } = await get(SHOP_LEAD);
    expect(status).toBe(200);
    expect(body.role).toBe("technician");
    expect(body.roleOverrides).toEqual({ "maintenance.inspectors": false, "fuel.cards": false });
    expect(body.userOverrides).toEqual({ "maintenance.inspectors": true });
    expectOrgScoped(rec, ORG);
  });

  it("reads only this member's ROLE's answers", async () => {
    rec = layered();
    const { body } = await get(SHOP_LEAD);
    expect(body.roleOverrides).not.toHaveProperty("recruitment.screening");
    expect(rec.forTable("org_role_surface_access")[0]!.filters()).toEqual(
      expect.arrayContaining([
        { col: "org_id", val: ORG },
        { col: "role", val: "technician" },
      ]),
    );
  });

  it("reads only this member's own answers", async () => {
    rec = layered();
    const { body } = await get(SHOP_LEAD);
    expect(body.userOverrides).not.toHaveProperty("maintenance.repair-spend");
    expect(rec.forTable("user_surface_access")[0]!.filters()).toEqual(
      expect.arrayContaining([
        { col: "org_id", val: ORG },
        { col: "user_id", val: SHOP_LEAD },
      ]),
    );
  });

  /** The service role bypasses RLS, so `.eq("org_id")` is the whole of the tenant boundary here. */
  it("does not read another tenant's rows for the same person", async () => {
    rec = layered();
    const { body } = await get(SHOP_LEAD);
    expect(body.userOverrides).not.toHaveProperty("fuel.ifta");
  });

  /**
   * The catalogue travels with the answers, and it carries the SECTION and the LEVEL because the
   * page cannot draw a cell without them: an Import cell for a role with `fuel: "view"` is not a
   * choice, it is an explanation.
   */
  it("sends the catalogue with each screen's section and level, and no product constants", async () => {
    rec = layered();
    const { body } = await get(SHOP_LEAD);
    const byKey = new Map(body.surfaces!.map((s) => [s.key, s]));
    expect(byKey.get("maintenance.inspectors")).toMatchObject({ section: "maintenance", level: "view" });
    // ⚠ The manage-level example is READ from the catalogue rather than named. `fuel.import` was
    // named here for one day and retired by FUEL-C4 the next; a screen retiring is not a reason for
    // this assertion to fail, but a `level` that stopped travelling is.
    const managed = NAV_SURFACES.find((s) => s.gate.kind === "section" && s.gate.level === "manage")!;
    expect(byKey.get(managed.key)).toMatchObject({ level: "manage" });
    expect(byKey.has("dashboard")).toBe(false);
    expect(byKey.has("admin.users")).toBe(false);
  });

  /** ⚠ The read does not apply the D-PERM7/D-PERM8 lock — see the section sibling's header. */
  it("shows a locked member's screens rather than refusing to look", async () => {
    rec = createSupabaseRecorder({
      tables: { org_role_surface_access: [], user_surface_access: [], memberships: [{ role: "admin" }] },
    });
    const { status, body } = await get(SHOP_LEAD);
    expect(status).toBe(200);
    expect(body.role).toBe("admin");
  });

  it("refuses a person who is not a member of the caller's org", async () => {
    rec = createSupabaseRecorder({ tables: { memberships: [] } });
    const { status } = await get(OTHER_TECH);
    expect(status).toBe(404);
  });

  it("refuses an id that is not a member id", async () => {
    rec = layered();
    const { status } = await get("not-a-uuid");
    expect(status).toBe(400);
    expect(rec.forTable("memberships")).toHaveLength(0);
  });
});

describe("SP9 · a screen-access write needs the password again (Q-SET8 (a))", () => {
  /**
   * The owner ruled 2026-09-30 that every write on the Permissions page takes the same five-minute
   * step-up card control uses. Refused before the handler: no function call, no row, no audit.
   */
  it.each([
    ["PUT /", (base: string) => put(base, { role: "technician", surfaceKey: "maintenance.repair-spend", allowed: false }, false)],
    ["PUT /user", (base: string) => putUser(base, { userId: SHOP_LEAD, surfaceKey: "maintenance.repair-spend", allowed: false }, false)],
  ])("%s without a step-up token answers 403 step_up_required and writes nothing", async (_name, send) => {
    await withServer(async (base) => {
      const res = await send(base);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("step_up_required");
    });
    expect(rec.rpcs()).toEqual([]);
    expect(rec.writes()).toEqual([]);
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
