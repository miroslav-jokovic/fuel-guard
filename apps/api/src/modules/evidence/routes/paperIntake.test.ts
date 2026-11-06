import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The paper-intake routes (DRIVER-PAPER-INTAKE-PLAN PI2): gated on `roster: manage`, a split queued
 * once per stack and audited, ids refused before a query runs.
 */
const ORG = "org-1";
const STACK = "5a5a5a5a-1111-4222-8333-444444444444";
const gates = vi.hoisted(() => [] as Array<[string, string]>);
const svc = vi.hoisted(() => ({
  registerStack: vi.fn(),
  markQueued: vi.fn(),
  listBatch: vi.fn(async () => []),
}));
const filing = vi.hoisted(() => ({ fileIntakeItem: vi.fn(), discardIntakeItem: vi.fn() }));
const dispatchJob = vi.hoisted(() => vi.fn(async () => ({ jobId: "j1" })));
const writeAudit = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../intake/paperIntake.js", () => svc);
vi.mock("../intake/paperIntakeBatch.js", () => ({ listBatch: svc.listBatch, pieceUrl: vi.fn() }));
vi.mock("../intake/paperIntakeFiling.js", () => filing);
vi.mock("../../../queue/dispatch.js", () => ({ dispatchJob }));
vi.mock("../../../lib/audit.js", () => ({ writeAudit }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireOrg: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "u-1", orgId: ORG, role: "safety_manager", email: "m@example.test" } as Request["auth"];
    next();
  },
  requireSection: (section: string, level: string) => {
    gates.push([section, level]);
    return (_req: Request, _res: Response, next: NextFunction) => next();
  },
}));

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const { paperIntakeRouter } = await import("./paperIntake.js");
  const app = express();
  app.use(express.json());
  app.use("/api/compliance", paperIntakeRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/compliance${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally {
    await closeTestServer(server);
  }
}

const register = { batchId: "b0b0b0b0-1111-4222-8333-444444444444", fileName: "stack.pdf", sha256: "a".repeat(64), bytes: 1000 };

beforeEach(() => {
  for (const f of [svc.registerStack, svc.markQueued, dispatchJob, writeAudit, filing.fileIntakeItem, filing.discardIntakeItem]) f.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe("paper-intake routes (PI2)", () => {
  it("is gated on managing the roster, every route", async () => {
    await import("./paperIntake.js").then((m) => m.paperIntakeRouter());
    expect(gates.length).toBeGreaterThan(0);
    expect(new Set(gates.map((g) => g.join(":")))).toEqual(new Set(["roster:manage"]));
  }, 30_000); // the first import of the router

  it("registers a file and audits it; a duplicate is answered without a second audit row", async () => {
    svc.registerStack.mockResolvedValueOnce({ stackId: STACK, uploadUrl: "https://put", duplicate: false });
    expect((await call("POST", "/paper-intake/stacks", register)).status).toBe(201);
    expect(writeAudit).toHaveBeenCalledWith({}, expect.objectContaining({ action: "compliance.paper_stack_registered", entityId: STACK, orgId: ORG }));

    writeAudit.mockClear();
    svc.registerStack.mockResolvedValueOnce({ stackId: STACK, uploadUrl: null, duplicate: true });
    const dup = await call("POST", "/paper-intake/stacks", register);
    expect(dup).toEqual({ status: 200, json: { stackId: STACK, uploadUrl: null, duplicate: true } });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses a file over the size cap before the service is asked", async () => {
    expect((await call("POST", "/paper-intake/stacks", { ...register, bytes: 51 * 1024 * 1024 })).status).toBe(400);
    expect(svc.registerStack).not.toHaveBeenCalled();
  });

  it("queues the split once, deduplicated on the stack, and not again for a stack already on its way", async () => {
    svc.markQueued.mockResolvedValueOnce("queued");
    expect((await call("POST", `/paper-intake/stacks/${STACK}/complete`)).status).toBe(202);
    expect(dispatchJob).toHaveBeenCalledWith({}, {}, "paper_intake_split", expect.objectContaining({ orgId: ORG, payload: { stackId: STACK, requestedBy: "u-1" }, dedupKey: `paper_intake_split:${STACK}` }));

    dispatchJob.mockClear();
    svc.markQueued.mockResolvedValueOnce("already");
    expect((await call("POST", `/paper-intake/stacks/${STACK}/complete`)).status).toBe(202);
    expect(dispatchJob).not.toHaveBeenCalled();
  });

  it("answers a stack that is not on file with 404 and a failed one with 409", async () => {
    svc.markQueued.mockResolvedValueOnce({ code: "not_found", error: "x" });
    expect((await call("POST", `/paper-intake/stacks/${STACK}/complete`)).status).toBe(404);
    svc.markQueued.mockResolvedValueOnce({ code: "not_uploadable", error: "x" });
    expect((await call("POST", `/paper-intake/stacks/${STACK}/complete`)).status).toBe(409);
  });

  it("refuses an id that is not one before any query", async () => {
    expect((await call("POST", "/paper-intake/stacks/not-an-id/complete")).status).toBe(400);
    expect((await call("GET", "/paper-intake/batches/not-an-id")).status).toBe(400);
    expect(svc.markQueued).not.toHaveBeenCalled();
    expect(svc.listBatch).not.toHaveBeenCalled();
  });

  const ITEM = "11111111-2222-4333-8444-555555555555";
  const fileBody = { driverId: "3f2b9c1e-8d4a-4b6f-9e21-5c7a0d1e2f34", kind: "mvr", date: "2026-01-05", expiresOn: null };

  it("files a reviewed paper as the signed-in person and audits it (PI5)", async () => {
    filing.fileIntakeItem.mockResolvedValueOnce({ status: "filed", documentId: ITEM, certificationId: null, recordId: ITEM });
    expect((await call("POST", `/paper-intake/items/${ITEM}/file`, fileBody)).status).toBe(201);
    expect(filing.fileIntakeItem).toHaveBeenCalledWith({}, ORG, { id: "u-1", role: "safety_manager" }, ITEM, fileBody);
    expect(writeAudit).toHaveBeenCalledWith({}, expect.objectContaining({ action: "compliance.paper_filed", entityId: ITEM, meta: expect.objectContaining({ kind: "mvr", recordId: ITEM }) }));
  });

  it("answers a refusal in words with the right status, and audits nothing", async () => {
    for (const [code, status] of [["refused", 422], ["forbidden", 403], ["already_decided", 409], ["not_found", 404]] as const) {
      filing.fileIntakeItem.mockResolvedValueOnce({ code, error: "x" });
      expect((await call("POST", `/paper-intake/items/${ITEM}/file`, fileBody)).status).toBe(status);
    }
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses a file request with no driver or no kind before the service is asked", async () => {
    expect((await call("POST", `/paper-intake/items/${ITEM}/file`, { ...fileBody, driverId: "" })).status).toBe(400);
    expect((await call("POST", `/paper-intake/items/${ITEM}/file`, { ...fileBody, kind: "" })).status).toBe(400);
    expect(filing.fileIntakeItem).not.toHaveBeenCalled();
  });

  it("sets a row aside with its reason in the audit row, the only place it is kept", async () => {
    filing.discardIntakeItem.mockResolvedValueOnce({ status: "discarded" });
    expect((await call("POST", `/paper-intake/items/${ITEM}/discard`, { reason: "not_dq_paper" })).status).toBe(200);
    expect(writeAudit).toHaveBeenCalledWith({}, expect.objectContaining({ action: "compliance.paper_discarded", meta: { reason: "not_dq_paper" } }));
    expect((await call("POST", `/paper-intake/items/${ITEM}/discard`, { reason: "because" })).status).toBe(400);
  });
});
