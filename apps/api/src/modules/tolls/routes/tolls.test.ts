import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/tolls` (TOLLS-PER-TRUCK-PLAN.md TL2). What 0622 refuses is proved by its PGlite matrix
 * (`supabase/tests/toll-transponders.test.mjs`); what is left is the translation, each invisible from
 * the database side:
 *
 *   · every write goes through 0622's functions, with the org and the actor the session names — never
 *     a body field, so a forged `orgId` in a request has nowhere to go;
 *   · each refusal arrives as the office's sentence under the right status, not a 500;
 *   · a tag already on file comes back WITH that tag, so the form can offer it;
 *   · the truck a tag is on is the open, unvoided row, and a voided row stays in the history;
 *   · every read is org-scoped, because the service role bypasses RLS.
 */

const ORG = "org-1";
const USER = "user-1";
const TAG = "11111111-1111-4111-8111-111111111111";
const TRUCK_A = "22222222-2222-4222-8222-222222222222";
const TRUCK_B = "33333333-3333-4333-8333-333333333333";
const ROW_A = "44444444-4444-4444-8444-444444444444";
const ROW_B = "55555555-5555-4555-8555-555555555555";
const ROW_WRONG = "66666666-6666-4666-8666-666666666666";

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
  // What each gate ADMITS is proved in middleware/requireSection.test.ts against the real
  // implementation; stubbing it here would only prove the stub.
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
  error?: { code?: string; message?: string };
  existing?: { id: string };
  transponder?: { id: string; currentVehicleId: string | null; history: Array<{ id: string; unitNumber: string | null; voidedAt: string | null }> };
  transponders?: Array<{ id: string; tagNumber: string; currentVehicleId: string | null; retiredAt: string | null }>;
}
const post = (base: string, path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const bodyOf = async (res: Awaited<ReturnType<typeof fetch>>): Promise<Body> => (await res.json()) as Body;

const tagRow = { id: TAG, provider: "ezpass", tag_number: "00812345678", issuer: null, note: null, retired_at: null, retired_reason: null };
/** On truck A June 1–10, then on truck B from June 10; an entry putting it back on A on June 15 was voided. */
const history = [
  { id: ROW_A, transponder_id: TAG, vehicle_id: TRUCK_A, valid_from: "2026-06-01T05:00:00Z", valid_to: "2026-06-10T14:00:00Z", created_at: "2026-06-01T05:00:00Z", voided_at: null, void_reason: null },
  { id: ROW_B, transponder_id: TAG, vehicle_id: TRUCK_B, valid_from: "2026-06-10T14:00:00Z", valid_to: null, created_at: "2026-06-10T14:00:00Z", voided_at: null, void_reason: null },
  { id: ROW_WRONG, transponder_id: TAG, vehicle_id: TRUCK_A, valid_from: "2026-06-15T05:00:00Z", valid_to: null, created_at: "2026-06-15T05:00:00Z", voided_at: "2026-06-16T00:00:00Z", void_reason: "typed the wrong truck" },
];
const vehicles = [
  { id: TRUCK_A, unit_number: "654" },
  { id: TRUCK_B, unit_number: "702" },
];

function fleet(rpc?: Record<string, unknown>) {
  rec = createSupabaseRecorder({
    tables: { toll_transponders: [tagRow], toll_transponder_assignments: history, vehicles },
    rpc,
  });
}

beforeEach(() => {
  audit.writeAudit.mockClear();
});

describe("GET /api/tolls/transponders", () => {
  it("names the truck holding the tag from its open, unvoided row and keeps the voided row in the history", async () => {
    fleet();
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/tolls/transponders`);
      expect(res.status).toBe(200);
      const body = await bodyOf(res);
      expect(body.transponders).toHaveLength(1);
      expect(body.transponders![0]!.currentVehicleId).toBe(TRUCK_B);
      const hist = (body.transponders![0] as unknown as { history: Array<{ id: string; unitNumber: string | null; voidedAt: string | null }> }).history;
      expect(hist.map((h) => h.id)).toEqual([ROW_WRONG, ROW_B, ROW_A]);
      expect(hist.map((h) => h.unitNumber)).toEqual(["654", "702", "654"]);
      expect(hist[0]!.voidedAt).not.toBeNull();
    });
    expectOrgScoped(rec, ORG);
  });

  it("reads one truck's tags from every assignment it ever had, not only the current one", async () => {
    fleet();
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/tolls/transponders?vehicleId=${TRUCK_A}`);
      expect(res.status).toBe(200);
      expect((await bodyOf(res)).transponders).toHaveLength(1);
    });
    const firstRead = rec.forTable("toll_transponder_assignments")[0]!;
    expect(firstRead.filters()).toContainEqual({ col: "vehicle_id", val: TRUCK_A });
    expectOrgScoped(rec, ORG);
  });

  it("answers a truck that never carried a tag with an empty list, without reading the tags", async () => {
    rec = createSupabaseRecorder({ tables: { toll_transponder_assignments: [] } });
    await withServer(async (base) => {
      const body = await bodyOf(await fetch(`${base}/api/tolls/transponders?vehicleId=${TRUCK_A}`));
      expect(body.transponders).toEqual([]);
    });
    expect(rec.forTable("toll_transponders")).toHaveLength(0);
  });

  it("refuses a truck filter that is not a record id", async () => {
    fleet();
    await withServer(async (base) => {
      expect((await fetch(`${base}/api/tolls/transponders?vehicleId=654`)).status).toBe(400);
    });
  });
});

describe("POST /api/tolls/transponders", () => {
  it("registers through 0622's function with the session's org and actor, the number as stored, and audits it", async () => {
    fleet({ register_toll_transponder: TAG });
    await withServer(async (base) => {
      const res = await post(base, "/api/tolls/transponders", {
        provider: "ezpass",
        tagNumber: "008-1234 5678",
        vehicleId: TRUCK_B,
        at: "2026-06-10T14:00:00.000Z",
        orgId: "someone-elses-org",
      });
      expect(res.status).toBe(201);
      expect((await bodyOf(res)).transponder?.id).toBe(TAG);
    });
    const [call] = rec.rpcs();
    expect(call).toEqual({
      fn: "register_toll_transponder",
      args: {
        p_org_id: ORG,
        p_provider: "ezpass",
        p_tag_number: "00812345678",
        p_issuer: null,
        p_note: null,
        p_vehicle_id: TRUCK_B,
        p_at: "2026-06-10T14:00:00.000Z",
        p_actor: USER,
      },
    });
    expect(audit.writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "tolls.transponder_registered", orgId: ORG }));
    expectOrgScoped(rec, ORG);
  });

  it("sends no start time for a tag registered into the drawer", async () => {
    fleet({ register_toll_transponder: TAG });
    await withServer(async (base) => {
      expect((await post(base, "/api/tolls/transponders", { provider: "ktag", tagNumber: "KT0000777" })).status).toBe(201);
    });
    expect(rec.rpcs()[0]!.args).toMatchObject({ p_vehicle_id: null, p_at: null });
  });

  it("answers a tag already on file with 409 and that tag, and audits nothing", async () => {
    fleet({ register_toll_transponder: { error: { code: "23505", message: "duplicate key" } } });
    await withServer(async (base) => {
      const res = await post(base, "/api/tolls/transponders", { provider: "ezpass", tagNumber: "00812345678" });
      expect(res.status).toBe(409);
      const body = await bodyOf(res);
      expect(body.error?.code).toBe("already_registered");
      expect(body.existing?.id).toBe(TAG);
    });
    expect(audit.writeAudit).not.toHaveBeenCalled();
    expectOrgScoped(rec, ORG);
  });

  it("refuses PrePass before anything reaches the database", async () => {
    fleet();
    await withServer(async (base) => {
      expect((await post(base, "/api/tolls/transponders", { provider: "prepass", tagNumber: "12345678" })).status).toBe(400);
    });
    expect(rec.rpcs()).toHaveLength(0);
  });
});

describe("moves, retirements and corrections", () => {
  for (const [sqlstate, status, code] of [
    ["TL001", 409, "tag_overlap"],
    ["TL003", 422, "not_on_fleet"],
    ["TL004", 409, "tag_retired"],
    ["TL005", 409, "move_before_current"],
  ] as const) {
    it(`answers 0622's ${sqlstate} as ${status} ${code}, with a sentence and no audit`, async () => {
      fleet({ move_toll_transponder: { error: { code: sqlstate, message: "refused" } } });
      await withServer(async (base) => {
        const res = await post(base, `/api/tolls/transponders/${TAG}/move`, { vehicleId: TRUCK_A, at: "2026-06-20T14:00:00.000Z" });
        expect(res.status).toBe(status);
        const body = await bodyOf(res);
        expect(body.error?.code).toBe(code);
        expect(body.error?.message).not.toContain("refused");
      });
      expect(audit.writeAudit).not.toHaveBeenCalled();
    });
  }

  it("takes a tag off its truck as a move to no truck, audited as a removal", async () => {
    fleet({ move_toll_transponder: null });
    await withServer(async (base) => {
      expect((await post(base, `/api/tolls/transponders/${TAG}/move`, { vehicleId: null, at: "2026-06-20T14:00:00.000Z" })).status).toBe(200);
    });
    expect(rec.rpcs()[0]).toEqual({
      fn: "move_toll_transponder",
      args: { p_org_id: ORG, p_transponder_id: TAG, p_vehicle_id: null, p_at: "2026-06-20T14:00:00.000Z", p_actor: USER },
    });
    expect(audit.writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "tolls.transponder_removed" }));
  });

  it("retires with a reason through 0622's function", async () => {
    fleet({ retire_toll_transponder: null });
    await withServer(async (base) => {
      expect((await post(base, `/api/tolls/transponders/${TAG}/retire`, { reason: "lost", at: "2026-06-20T14:00:00.000Z" })).status).toBe(200);
    });
    expect(rec.rpcs()[0]!.args).toMatchObject({ p_org_id: ORG, p_reason: "lost", p_actor: USER });
  });

  it("voids an entry of this org's and answers with its tag", async () => {
    rec = createSupabaseRecorder({
      tables: { toll_transponders: [tagRow], toll_transponder_assignments: history, vehicles },
      rpc: { void_toll_transponder_assignment: null },
    });
    await withServer(async (base) => {
      const res = await post(base, `/api/tolls/assignments/${ROW_A}/void`, { reason: "wrong truck" });
      expect(res.status).toBe(200);
      expect((await bodyOf(res)).transponder?.id).toBe(TAG);
    });
    expect(rec.rpcs()[0]!.args).toMatchObject({ p_org_id: ORG, p_assignment_id: ROW_A, p_reason: "wrong truck", p_actor: USER });
    expectOrgScoped(rec, ORG);
  });

  it("answers an entry that is not this org's with 404 and never calls the function", async () => {
    rec = createSupabaseRecorder({ tables: { toll_transponder_assignments: [] } });
    await withServer(async (base) => {
      expect((await post(base, `/api/tolls/assignments/${ROW_A}/void`, { reason: "wrong truck" })).status).toBe(404);
    });
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses a void without a reason and a move without a time", async () => {
    fleet();
    await withServer(async (base) => {
      expect((await post(base, `/api/tolls/assignments/${ROW_A}/void`, { reason: " " })).status).toBe(400);
      expect((await post(base, `/api/tolls/transponders/${TAG}/move`, { vehicleId: TRUCK_A })).status).toBe(400);
      expect((await post(base, `/api/tolls/transponders/not-an-id/move`, { vehicleId: TRUCK_A, at: "2026-06-20T14:00:00.000Z" })).status).toBe(400);
    });
    expect(rec.rpcs()).toHaveLength(0);
  });
});
