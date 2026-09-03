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
/** The member the per-user layer is about, and a person who is in no org of the caller's. */
const DISPATCHER = "00000000-0000-4000-8000-000000000010";
const OUTSIDER = "00000000-0000-4000-8000-000000000011";

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
      memberships: [{ role: "dispatcher" }],
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

// ── S5: the per-USER layer (D-SURF7) ──────────────────────────────────────────────────────────
//
// The owner asked for "custom setup for each user", and this is that request applied to DATA rather
// than to screens. The read path is entirely SQL — `custom_access_token_hook` merges these rows over
// the role's at token mint, and `supabase/tests/user-section-access.test.mjs` is where that is
// proved, because only a real Postgres can run the hook. What CAN only be proved here is the write:
// the API reads with the service role, so the `.eq("org_id")` filters are the only isolation there
// is, and the admin/driver role lock has nowhere else to live on the write path.

const putUser = (base: string, body: unknown) =>
  fetch(`${base}/api/section-access/user`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("PUT /api/section-access/user", () => {
  it("narrowing one member writes one row, org- and user-scoped, and audits it", async () => {
    await withServer(async (base) => {
      const res = await putUser(base, { userId: DISPATCHER, section: "safety", access: "none" });
      expect(res.status).toBe(200);
    });
    const inserted = rec.writtenRows("user_section_access");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      org_id: ORG,
      user_id: DISPATCHER,
      section: "safety",
      access: "none",
      updated_by: USER,
    });
    expectOrgScoped(rec, ORG);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: ORG,
        action: "permissions.changed_user",
        // The member's role and what that role resolves to travel with the change, so the log reads
        // years later without the reader reconstructing the matrix as it stood that day.
        meta: expect.objectContaining({
          userId: DISPATCHER,
          role: "dispatcher",
          roleDefault: sectionAccess("dispatcher", "safety"),
        }),
      }),
    );
  });

  /**
   * A person has no shipped default — their fallback is whatever their ROLE resolves to, and an
   * admin can change that afterwards. Storing today's answer as a row would freeze it and stop
   * tracking the role, which is the sparse-delta invariant D-PERM4 states for the layer above.
   */
  it("writing a member's access to their role's current answer still STORES a row", async () => {
    await withServer(async (base) => {
      const res = await putUser(base, {
        userId: DISPATCHER,
        section: "safety",
        access: sectionAccess("dispatcher", "safety"),
      });
      expect(res.status).toBe(200);
    });
    expect(rec.writtenRows("user_section_access")).toHaveLength(1);
  });

  /**
   * The delete-then-insert pair (`lint:upserts`: never a partial upsert) clears exactly ONE cell.
   * Without the `user_id` filter it clears that section for every member of the org, which is
   * invisible on the screen of the person being edited and is how "custom setup for each user"
   * would quietly become "custom setup for the last user edited".
   */
  it("clears exactly one member's cell — the delete carries org, user AND section", async () => {
    await withServer(async (base) => {
      const res = await putUser(base, { userId: DISPATCHER, section: "safety", access: "none" });
      expect(res.status).toBe(200);
    });
    const del = rec.forTable("user_section_access").find((q) => q.write?.method === "delete");
    expect(del).toBeDefined();
    expect(del!.filters()).toEqual(
      expect.arrayContaining([
        { col: "org_id", val: ORG },
        { col: "user_id", val: DISPATCHER },
        { col: "section", val: "safety" },
      ]),
    );
  });

  it("`access: null` is the reset — it deletes the row and stores nothing", async () => {
    await withServer(async (base) => {
      const res = await putUser(base, { userId: DISPATCHER, section: "safety", access: null });
      expect(res.status).toBe(200);
    });
    expect(rec.writtenRows("user_section_access")).toHaveLength(0);
    expect(rec.forTable("user_section_access").some((q) => q.write?.method === "delete")).toBe(true);
  });

  /**
   * D-PERM7/D-PERM8 cannot be a CHECK constraint on a user-keyed table — a row does not know its
   * member's role. This is one of the two places the lock lives; the other is the auth hook, proved
   * in `supabase/tests/user-section-access.test.mjs`.
   */
  it("refuses a member whose role is locked (D-PERM7/D-PERM8)", async () => {
    for (const role of ["admin", "driver"]) {
      rec = createSupabaseRecorder({ tables: { memberships: [{ role }] } });
      await withServer(async (base) => {
        const res = await putUser(base, { userId: DISPATCHER, section: "safety", access: "manage" });
        expect(res.status, `${role} is not editable`).toBe(400);
      });
      expect(rec.writtenRows("user_section_access")).toHaveLength(0);
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
      const res = await putUser(base, { userId: OUTSIDER, section: "safety", access: "manage" });
      expect(res.status).toBe(404);
    });
    expect(rec.writtenRows("user_section_access")).toHaveLength(0);
    const lookup = rec.forTable("memberships");
    expect(lookup).toHaveLength(1);
    expect(lookup[0]!.filters()).toEqual(
      expect.arrayContaining([
        { col: "org_id", val: ORG },
        { col: "user_id", val: OUTSIDER },
      ]),
    );
  });

  /**
   * D-PERM7 as a SECURITY boundary rather than as manners: `admin` carries user management, so
   * granting it sideways would be the escalation path the product deliberately does not have. It is
   * refused here, by 0299's CHECK constraint, and by the hook — three layers, because this is the
   * one field whose wrong value becomes authority.
   */
  it("refuses the admin section, which is nobody's to grant (D-PERM7)", async () => {
    await withServer(async (base) => {
      const res = await putUser(base, { userId: DISPATCHER, section: "admin", access: "manage" });
      expect(res.status).toBe(400);
    });
    expect(rec.writtenRows("user_section_access")).toHaveLength(0);
  });
});
