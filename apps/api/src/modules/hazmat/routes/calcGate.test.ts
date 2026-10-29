import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `POST /api/hazmat/calc` sits behind the hazmat section's VIEW gate, like `/products` beside it and the calculator page
 * (TWO-CLICK-READER-PLAN TC1.5). Until 2026-10-29 it was the one route of the router with no section gate: any member
 * of an entitled org could call it. The auth middleware is replaced by one that admits a request only when its
 * `x-sections` header grants what the route asks for, so the test reads the gate the route DECLARES.
 */
vi.mock("../../../middleware/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../middleware/auth.js")>()),
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "u-1", orgId: "org-1", role: "dispatcher", email: "d@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, res: Response) => res.status(403).end(),
  requireSection: (section: string, level: string = "manage") => (req: Request, res: Response, next: NextFunction) => {
    const granted = String(req.headers["x-sections"] ?? "").split(",");
    return granted.includes(`${section}:${level}`) || granted.includes(`${section}:manage`) ? next() : res.status(403).json({ error: { code: "forbidden" } });
  },
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../../../middleware/requireModule.js", () => ({ requireModule: () => (_req: Request, _res: Response, next: NextFunction) => next() }));

const { hazmatRouter } = await import("./index.js");

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/hazmat", hazmatRouter());
  server = await new Promise<Server>((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/hazmat`;
});
afterAll(() => closeTestServer(server));

const LOAD = {
  vehicle: { kind: "cargo_tank", cargoTankCapacityGal: null, compartments: null },
  lines: [{ hmtRef: "UN1203-gasoline#II", packagingKind: "bulk", grossWeightLb: 30000, packageCount: 1, quantity: { value: 5000, unit: "gal" } }],
};
const calc = (sections: string, load: object = LOAD) =>
  fetch(`${base}/calc`, { method: "POST", headers: { "content-type": "application/json", "x-sections": sections }, body: JSON.stringify({ load }) });

describe("POST /api/hazmat/calc — the section's view gate (TC1.5)", () => {
  it("refuses a member without hazmat view", async () => {
    expect((await calc("dispatch:view")).status).toBe(403);
  });

  it("answers a member with hazmat view, with the verdict", async () => {
    const res = await calc("hazmat:view");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { verdict: { placards: { required: { placard: string }[] } } };
    expect(body.verdict.placards.required.map((p) => p.placard)).toContain("FLAMMABLE");
  });
});
