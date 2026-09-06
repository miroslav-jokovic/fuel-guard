import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * Deleting an invitation (2026-09-02).
 *
 * Revoking an invite hid it from use and left it on the page forever — an admin could neither act on
 * a revoked row nor remove it, so the Users page accumulated dead entries with no affordance. This
 * is the missing verb.
 *
 * Two rules carry the weight, and both are about which invites may go:
 *
 *  · a PENDING invite must be revoked first. Revoking is what makes the outstanding emailed link
 *    unusable; deleting the row without it would leave a live invitation in somebody's inbox and
 *    nothing on screen to say so. The endpoint must refuse rather than helpfully do both.
 *  · an ACCEPTED invite is the provenance of a membership that exists, and stays.
 *
 * And one about evidence: `invites` is deliberately NOT in `RETENTION_FORBIDDEN` — no regulation
 * reads it — but the audit row is what remains, so it has to carry what the deleted row carried.
 */
const ORG = "org-1";
const USER = "user-1";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: { MAIL_PROVIDER: "none" } }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: "admin", email: "admin@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../../../lib/audit.js", () => ({ writeAudit: vi.fn(async () => undefined) }));

const { invitesRouter } = await import("./invites.js");
const { writeAudit } = await import("../../../lib/audit.js");

async function del(id: string): Promise<{ status: number }> {
  const app = express();
  app.use(express.json());
  app.use("/api/invites", invitesRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/invites/${id}`, {
      method: "DELETE",
    });
    return { status: res.status };
  } finally {
    await closeTestServer(server);
  }
}

const seed = (status: string) =>
  createSupabaseRecorder({
    tables: {
      invites: [{ id: "inv-1", email: "george@example.test", role: "technician", status }],
    },
  });

beforeEach(() => vi.clearAllMocks());

describe("DELETE /api/invites/:id", () => {
  it("deletes a revoked invitation, scoped to the caller's org", async () => {
    rec = seed("revoked");
    expect((await del("inv-1")).status).toBe(200);
    const deletes = rec.writes().filter((q) => q.write?.method === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.filters()).toContainEqual({ col: "org_id", val: ORG });
    expect(deletes[0]!.filters()).toContainEqual({ col: "id", val: "inv-1" });
    expectOrgScoped(rec, ORG);
  });

  it("deletes an expired one too", async () => {
    rec = seed("expired");
    expect((await del("inv-1")).status).toBe(200);
  });

  /**
   * The rule that matters. Revoking is what kills the emailed link; deleting the row first would
   * leave a working invitation in an inbox with nothing on screen recording that it exists.
   */
  it("refuses a PENDING invitation, and says revoking is the step that disables the link", async () => {
    rec = seed("pending");
    expect((await del("inv-1")).status).toBe(409);
    expect(rec.writes().filter((q) => q.write?.method === "delete")).toHaveLength(0);
  });

  it("refuses an ACCEPTED one — it is the provenance of a membership that exists", async () => {
    rec = seed("accepted");
    expect((await del("inv-1")).status).toBe(409);
    expect(rec.writes().filter((q) => q.write?.method === "delete")).toHaveLength(0);
  });

  it("is a 404 for an id belonging to nobody, without deleting anything", async () => {
    rec = createSupabaseRecorder({ tables: { invites: [] } });
    expect((await del("nope")).status).toBe(404);
    expect(rec.writes().filter((q) => q.write?.method === "delete")).toHaveLength(0);
  });

  it("audits the deletion carrying what the row held, because nothing else will", async () => {
    rec = seed("revoked");
    await del("inv-1");
    expect(writeAudit).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(writeAudit).mock.calls[0]![1];
    expect(arg.action).toBe("invite.deleted");
    expect(arg.orgId).toBe(ORG);
    expect(arg.meta).toMatchObject({
      email: "george@example.test",
      role: "technician",
      status: "revoked",
    });
  });
});
