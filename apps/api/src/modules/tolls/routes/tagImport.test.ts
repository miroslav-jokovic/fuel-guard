import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `POST /api/tolls/transponders/import` (TOLLS-PER-TRUCK-PLAN.md TL2b). What each line MEANS is the
 * shared planner's, proved in `packages/shared/src/tolls/tollTagImport.test.ts`; what is left is that
 * the API re-plans on what is on file, turns each verdict into exactly 0622's calls with the session's
 * org and actor, keeps going past a refused line, and never leaves a tag on no truck when starting it
 * earlier fails halfway.
 */

const ORG = "org-1";
const USER = "user-1";
const TAG = "11111111-1111-4111-8111-111111111111";
const TRUCK_A = "22222222-2222-4222-8222-222222222222";
const TRUCK_B = "33333333-3333-4333-8333-333333333333";
const ROW_A = "44444444-4444-4444-8444-444444444444";
const ROW_B = "55555555-5555-4555-8555-555555555555";
const NEW_TAG = "77777777-7777-4777-8777-777777777777";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
const audit = vi.hoisted(() => ({
  writeAudit: vi.fn(async (_admin: unknown, _entry: Record<string, unknown>) => true),
}));
vi.mock("../../../lib/audit.js", () => audit);
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: "fleet_manager", email: "office@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { tollsRouter } = await import("./tolls.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/tolls", tollsRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await closeTestServer(server);
  }
}

interface Body {
  ok?: boolean;
  error?: { code?: string };
  results?: Array<{ line: number; outcome: string; message: string | null }>;
}
async function send(rows: unknown[]): Promise<{ status: number; body: Body }> {
  return withServer(async (base) => {
    const res = await fetch(`${base}/api/tolls/transponders/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows, orgId: "someone-elses-org" }),
    });
    return { status: res.status, body: (await res.json()) as Body };
  });
}

const tagRow = { id: TAG, provider: "ezpass", tag_number: "00812345678", issuer: null, note: null, retired_at: null, retired_reason: null };
const closedOnA = { id: ROW_A, transponder_id: TAG, vehicle_id: TRUCK_A, valid_from: "2026-06-01T05:00:00Z", valid_to: "2026-06-10T14:00:00Z", created_at: "2026-06-01T05:00:00Z", voided_at: null, void_reason: null };
const openOnB = { id: ROW_B, transponder_id: TAG, vehicle_id: TRUCK_B, valid_from: "2026-06-10T14:00:00Z", valid_to: null, created_at: "2026-06-10T14:00:00Z", voided_at: null, void_reason: null };

function fleet(history: object[], rpc?: Record<string, unknown> | ((fn: string, args: unknown) => unknown)) {
  rec = createSupabaseRecorder({
    tables: {
      toll_transponders: [tagRow],
      toll_transponder_assignments: history,
      vehicles: [
        { id: TRUCK_A, unit_number: "654", status: "active" },
        { id: TRUCK_B, unit_number: "702", status: "maintenance" },
      ],
      organizations: [{ id: ORG, operating_hours: null }],
    },
    rpc,
  });
}
const line = (over: object = {}) => ({ line: 2, unitNumber: "654", provider: "ezpass", tagNumber: "812345678", at: "2026-07-01T05:00:00.000Z", ...over });

beforeEach(() => audit.writeAudit.mockClear());

describe("POST /api/tolls/transponders/import", () => {
  it("adds a tag not on file to the truck its unit number names, from the line's day, as the session's org and person", async () => {
    fleet([closedOnA, openOnB], { register_toll_transponder: NEW_TAG });
    const { status, body } = await send([line({ tagNumber: "KT0000777", provider: "ktag", issuer: "KTA" })]);
    expect(status).toBe(200);
    expect(body.results).toEqual([{ line: 2, outcome: "added", message: null }]);
    expect(rec.rpcs()).toEqual([
      {
        fn: "register_toll_transponder",
        args: { p_org_id: ORG, p_provider: "ktag", p_tag_number: "KT0000777", p_issuer: "KTA", p_note: null, p_vehicle_id: TRUCK_A, p_at: "2026-07-01T05:00:00.000Z", p_actor: USER },
      },
    ]);
    expect(audit.writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: ORG, action: "tolls.transponder_registered", entityId: NEW_TAG, meta: expect.objectContaining({ via: "import", line: 2 }) }),
    );
    expectOrgScoped(rec, ORG);
  });

  it("moves the tag on file (found without its leading zeros) from the truck that has it", async () => {
    fleet([closedOnA, openOnB], { move_toll_transponder: "new-row" });
    const { body } = await send([line()]);
    expect(body.results![0]!.outcome).toBe("moved");
    expect(rec.rpcs()).toEqual([
      { fn: "move_toll_transponder", args: { p_org_id: ORG, p_transponder_id: TAG, p_vehicle_id: TRUCK_A, p_at: "2026-07-01T05:00:00.000Z", p_actor: USER } },
    ]);
    expect(audit.writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "tolls.transponder_moved", entityId: TAG }));
  });

  it("writes nothing for a tag already on that truck from an earlier day", async () => {
    fleet([closedOnA, openOnB]);
    const { body } = await send([line({ unitNumber: "702" })]);
    expect(body.results).toEqual([{ line: 2, outcome: "unchanged", message: null }]);
    expect(rec.rpcs()).toEqual([]);
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  it("starts a tag earlier on its truck by voiding the late entry with the reason in words, then putting it on from the sheet's day", async () => {
    fleet([openOnB], { void_toll_transponder_assignment: null, move_toll_transponder: "new-row" });
    const { body } = await send([line({ unitNumber: "702", at: "2026-05-01T05:00:00.000Z" })]);
    expect(body.results![0]!.outcome).toBe("backdated");
    expect(rec.rpcs()).toEqual([
      { fn: "void_toll_transponder_assignment", args: { p_org_id: ORG, p_assignment_id: ROW_B, p_reason: "Start corrected by the toll tag import: on this truck since 05/01/2026", p_actor: USER } },
      { fn: "move_toll_transponder", args: { p_org_id: ORG, p_transponder_id: TAG, p_vehicle_id: TRUCK_B, p_at: "2026-05-01T05:00:00.000Z", p_actor: USER } },
    ]);
    expect(audit.writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "tolls.transponder_backdated" }));
  });

  it("puts the tag back on from its old start when the earlier start is refused, so it is never left on no truck", async () => {
    let moves = 0;
    fleet([openOnB], (fn) => {
      if (fn === "move_toll_transponder" && ++moves === 1) return { error: { code: "TL001", message: "overlap" } };
      return null;
    });
    const { body } = await send([line({ unitNumber: "702", at: "2026-05-01T05:00:00.000Z" })]);
    expect(body.results![0]).toMatchObject({ outcome: "refused", message: expect.stringContaining("Another truck had this tag") });
    const calls = rec.rpcs().map((c) => [c.fn, (c.args as { p_at?: string }).p_at]);
    expect(calls).toEqual([
      ["void_toll_transponder_assignment", undefined],
      ["move_toll_transponder", "2026-05-01T05:00:00.000Z"],
      ["move_toll_transponder", "2026-06-10T14:00:00Z"],
    ]);
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  it("leaves the entry alone when voiding it is refused, and says so", async () => {
    fleet([openOnB], { void_toll_transponder_assignment: { error: { code: "TL003", message: "gone" } } });
    const { body } = await send([line({ unitNumber: "702", at: "2026-05-01T05:00:00.000Z" })]);
    expect(body.results![0]).toMatchObject({ outcome: "refused", message: expect.stringContaining("not on this company's fleet") });
    expect(rec.rpcs().map((c) => c.fn)).toEqual(["void_toll_transponder_assignment"]);
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  it("re-plans on what is on file: a line the preview called a move is refused when the tag's truck got it later", async () => {
    fleet([closedOnA, openOnB]);
    const { body } = await send([line({ at: "2026-06-05T05:00:00.000Z" })]);
    expect(body.results![0]).toMatchObject({ outcome: "refused", message: expect.stringContaining("on unit 702 since") });
    expect(rec.rpcs()).toEqual([]);
  });

  it("answers each line on its own, so a refused line never stops the next", async () => {
    rec = createSupabaseRecorder({
      tables: {
        toll_transponders: [tagRow],
        toll_transponder_assignments: [closedOnA, openOnB],
        vehicles: [{ id: TRUCK_A, unit_number: "654", status: "active" }],
        organizations: [{ id: ORG, operating_hours: null }],
      },
      rpc: (fn) => (fn === "register_toll_transponder" ? NEW_TAG : null),
    });
    const { body } = await send([line({ line: 2, unitNumber: "999", tagNumber: "AAAA1111" }), line({ line: 3, tagNumber: "BBBB2222" })]);
    expect(body.results).toEqual([
      { line: 2, outcome: "refused", message: "No truck 999 in the fleet. Check the unit number." },
      { line: 3, outcome: "added", message: null },
    ]);
  });

  it("says why when the database refuses a line at the last moment", async () => {
    fleet([closedOnA, openOnB], { register_toll_transponder: { error: { code: "23505", message: "dup" } } });
    const { body } = await send([line({ tagNumber: "CCCC3333" })]);
    expect(body.results![0]).toMatchObject({ outcome: "refused", message: expect.stringContaining("added by someone else") });
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  it("refuses more lines than one batch, and a provider that is not one of the three, before anything is read", async () => {
    fleet([]);
    expect((await send(Array.from({ length: 51 }, (_, i) => line({ line: i + 2 })))).status).toBe(400);
    expect((await send([line({ provider: "prepass" })])).status).toBe(400);
    expect(rec.queries).toHaveLength(0);
  });
});
