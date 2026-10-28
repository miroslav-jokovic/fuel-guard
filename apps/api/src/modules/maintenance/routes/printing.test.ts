import { describe, expect, it, vi, afterEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/maintenance/print` — one rule only this edge can hold: choosing one's OWN default printer is
 * `view`, choosing the ORGANIZATION's is `manage`, on the same route. The gate is stubbed to admit
 * `view` and refuse `manage` for this caller, so what is proved is that the route asks for `manage`
 * exactly when the scope is the organization (what each gate admits is requireSection.test.ts's),
 * and that printing — which mints tag codes — asks for `manage` too.
 */

const defaults = { purpose: "label", organizationPrinterId: null, myPrinterId: null, effectivePrinterId: null };
const printers = vi.hoisted(() => ({
  setDefault: vi.fn(async (): Promise<unknown> => ({})),
  getDefaults: vi.fn(async (): Promise<unknown> => ({})),
  listPrinters: vi.fn(),
  createPrinter: vi.fn(),
  updatePrinter: vi.fn(),
}));
const jobs = vi.hoisted(() => ({
  printLabels: vi.fn(async (): Promise<unknown> => ({ code: "no_printer", error: "No label printer is set up yet." })),
  listJobs: vi.fn(),
  cancelJob: vi.fn(),
}));
vi.mock("../printing/printers.js", () => printers);
vi.mock("../printing/jobs.js", () => jobs);
vi.mock("../printing/stations.js", () => ({ createStation: vi.fn(), listStations: vi.fn(), renewPairingCode: vi.fn(), revokeStation: vi.fn() }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../lib/audit.js", () => ({ writeAudit: vi.fn(async () => true) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "user-1", orgId: "org-1", role: "dispatcher", email: "d@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: (_section: string, level: string) => (_req: Request, res: Response, next: NextFunction) =>
    level === "manage" ? res.status(403).json({ ok: false, error: { code: "forbidden" } }) : next(),
}));

const { printingRouter } = await import("./printing.js");

let server: Server | undefined;
async function start(): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use("/print", printingRouter());
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/print`;
}
afterEach(async () => {
  if (server) await closeTestServer(server);
  server = undefined;
  vi.clearAllMocks();
});

const put = (base: string, body: unknown) =>
  fetch(`${base}/defaults`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const PRINTER = "11111111-1111-4111-8111-111111111111";

describe("PUT /defaults", () => {
  it("lets a viewer choose their own printer", async () => {
    printers.setDefault.mockResolvedValueOnce({ ...defaults, myPrinterId: PRINTER, effectivePrinterId: PRINTER });
    const res = await put(await start(), { scope: "me", printerId: PRINTER });
    expect(res.status).toBe(200);
    expect(printers.setDefault).toHaveBeenCalledWith({}, "org-1", "user-1", { purpose: "label", scope: "me", printerId: PRINTER });
  });

  it("asks for manage before changing the organization's", async () => {
    const res = await put(await start(), { scope: "organization", printerId: PRINTER });
    expect(res.status).toBe(403);
    expect(printers.setDefault).not.toHaveBeenCalled();
  });
});

describe("POST /labels", () => {
  it("is refused to a viewer — printing mints tag codes", async () => {
    const res = await fetch(`${await start()}/labels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "44444444-4444-4444-8444-444444444444", targets: [{ kind: "asset", assetId: PRINTER }] }),
    });
    expect(res.status).toBe(403);
    expect(jobs.printLabels).not.toHaveBeenCalled();
  });
});
