import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeTestServer } from "../../../testing/httpServer.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * The unit-files route judges every paper on the CARRIER's calendar day (D-PREC5). Railway's clock is
 * UTC, so at 9 p.m. in Chicago the server's date is already tomorrow — and a registration lapsing at
 * midnight would read "expired" three hours early on the list, while the Vehicles page's own cells,
 * judged on `todayInZone`, still said "due today".
 */

const ORG = "org-1";
let rec: SupabaseRecorder;
const asked: Array<{ orgId: string; subjectType: string; today: string }> = [];

vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireOrg: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "u-1", orgId: ORG, role: "fleet_manager", email: "member@example.test" };
    next();
  },
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../unitFiles.js", () => ({
  getUnitFiles: async (_admin: unknown, orgId: string, subjectType: string, today: string) => {
    asked.push({ orgId, subjectType, today });
    return { units: [] };
  },
}));

const { unitFilesRouter } = await import("./unitFiles.js");

async function get(path: string): Promise<number> {
  const app = express();
  app.use("/api/compliance", unitFilesRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const port = (server.address() as AddressInfo).port;
    return (await fetch(`http://127.0.0.1:${port}/api/compliance${path}`)).status;
  } finally {
    await closeTestServer(server);
  }
}

beforeEach(() => {
  asked.length = 0;
  rec = createSupabaseRecorder({ tables: { organizations: [{ operating_hours: { tz: "America/Chicago" } }] } });
  // Only Date is faked: the test server and fetch still need real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T02:00:00Z")); // 9 p.m. on 10/19 in Chicago
});
afterEach(() => vi.useRealTimers());

describe("GET /api/compliance/unit-files", () => {
  it("judges the files on the carrier's calendar day, not the server's", async () => {
    expect(await get("/unit-files?subjectType=tractor")).toBe(200);
    expect(asked).toEqual([{ orgId: ORG, subjectType: "tractor", today: "2026-10-19" }]);
    expectOrgScoped(rec, ORG);
  });

  it("refuses a subject type that is not a unit's", async () => {
    expect(await get("/unit-files?subjectType=driver")).toBe(400);
    expect(asked).toEqual([]);
  });
});
