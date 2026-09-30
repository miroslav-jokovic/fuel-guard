import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { AuthContext, UserRole } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { closeTestServer } from "../testing/httpServer.js";

/**
 * The API half of a screen entitlement (D-SURF5), and the two layers it has to read.
 *
 * Written with SP1 (SETTINGS-PERMISSIONS-PLAN.md), which found the middleware reading the ROLE layer
 * only: `surfaceClaimFor` was called without the caller's id, so a person's own answers (D-SURF7)
 * reached `/api/me` and the sidebar but never the endpoint. Before Q-SET2 that was a narrowing the
 * API forgot; after it, it would refuse the one grant that gives a single person a screen that
 * starts off. Both directions are pinned below, and both need the fixture to vary by the `user_id`
 * the query asked for — a table that answered every caller alike could not tell the two apart.
 */
const ORG = "org-1";
const GRANTED = "00000000-0000-4000-8000-000000000020";
const COLLEAGUE = "00000000-0000-4000-8000-000000000021";
const DENIED = "00000000-0000-4000-8000-000000000022";

let rec: SupabaseRecorder;
vi.mock("../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));

const { requireSurface } = await import("./requireSurface.js");

beforeEach(() => {
  rec = createSupabaseRecorder({
    tables: {
      org_role_surface_access: [],
      user_surface_access: (q) => {
        const rows = [
          { user_id: GRANTED, surface_key: "admin.settings.org", allowed: true },
          { user_id: DENIED, surface_key: "maintenance.inspectors", allowed: false },
        ];
        const filter = q.filters().find((f) => f.col === "user_id");
        return filter ? rows.filter((r) => r.user_id === filter.val) : rows;
      },
    },
  });
});

async function status(role: UserRole, userId: string, key: string): Promise<number> {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId, email: null, orgId: ORG, role, sections: null } as AuthContext;
    next();
  });
  app.get("/x", requireSurface(key), (_req, res) => res.json({ ok: true }));
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`)).status;
  } finally {
    await closeTestServer(server);
  }
}

describe("requireSurface", () => {
  it("refuses a screen that starts off for the caller's role (Q-SET2), and admits the admin", async () => {
    expect(await status("fleet_manager", COLLEAGUE, "admin.settings.org")).toBe(403);
    expect(await status("admin", COLLEAGUE, "admin.settings.org")).toBe(200);
  });

  it("admits the one person the admin turned it on for, and not their colleague on the same role", async () => {
    expect(await status("fleet_manager", GRANTED, "admin.settings.org")).toBe(200);
    expect(await status("fleet_manager", COLLEAGUE, "admin.settings.org")).toBe(403);
    expectOrgScoped(rec, ORG);
  });

  it("refuses a person the admin turned a screen off for, though their role keeps it", async () => {
    expect(await status("technician", DENIED, "maintenance.inspectors")).toBe(403);
    expect(await status("technician", COLLEAGUE, "maintenance.inspectors")).toBe(200);
  });
});
