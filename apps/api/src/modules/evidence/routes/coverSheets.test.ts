import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeTestServer } from "../../../testing/httpServer.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { pdfPageTexts } from "../../../testing/pdfText.js";

/**
 * `POST /api/compliance/cover-sheets` (DRIVER-PAPER-INTAKE-PLAN PI1): the drivers are read from THIS
 * organization only, the sheets come back in the order asked, a driver from anywhere else refuses
 * the whole print, and the section gate is `roster: manage`.
 */
const ORG = "org-1";
const A = "3f2b9c1e-8d4a-4b6f-9e21-5c7a0d1e2f34";
const B = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
let rec: SupabaseRecorder;
const gates = vi.hoisted(() => [] as Array<[string, string]>);

vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireOrg: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "u-1", orgId: ORG, role: "safety_manager", email: "member@example.test" } as Request["auth"];
    next();
  },
  requireSection: (section: string, level: string) => {
    gates.push([section, level]);
    return (_req: Request, _res: Response, next: NextFunction) => next();
  },
}));

async function post(body: unknown): Promise<{ status: number; type: string | null; bytes: Buffer }> {
  const { coverSheetsRouter } = await import("./coverSheets.js");
  const app = express();
  app.use(express.json());
  app.use("/api/compliance", coverSheetsRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/compliance/cover-sheets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, type: res.headers.get("content-type"), bytes: Buffer.from(await res.arrayBuffer()) };
  } finally {
    await closeTestServer(server);
  }
}

beforeEach(() => {
  rec = createSupabaseRecorder({
    tables: {
      organizations: [{ operating_hours: { tz: "America/Chicago" } }],
      drivers: [
        { id: A, full_name: "Marko Petrović", employee_id: "E-104", hire_date: "2019-03-01" },
        { id: B, full_name: "Ann Driver", employee_id: null, hire_date: null },
      ],
    },
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T03:00:00Z")); // 9 p.m. on 11/06 in Chicago
});
afterEach(() => vi.useRealTimers());

describe("POST /api/compliance/cover-sheets", () => {
  it("prints this organization's drivers, in the order asked, dated on the carrier's day", async () => {
    const res = await post({ driverIds: [B, A] });
    expect(res.status).toBe(200);
    expect(res.type).toBe("application/pdf");
    const pages = await pdfPageTexts(res.bytes);
    expect(pages.map((p) => (p.includes("Ann Driver") ? "B" : p.includes("Marko") ? "A" : "?"))).toEqual(["B", "A"]);
    expect(pages[0]).toContain("Printed 11/06/2026");
    expectOrgScoped(rec, ORG);
  }, 30_000); // renders a PDF with embedded fonts and reads it back

  it("is gated on managing the roster, the section a driver's papers belong to", async () => {
    await import("./coverSheets.js").then((m) => m.coverSheetsRouter());
    expect(gates).toContainEqual(["roster", "manage"]);
  });

  it("refuses the whole print when a driver is not on this organization's roster", async () => {
    const res = await post({ driverIds: [A, "11111111-2222-4333-8444-555555555555"] });
    expect(res.status).toBe(404);
  });

  it("refuses a request with no drivers", async () => {
    expect((await post({ driverIds: [] })).status).toBe(400);
  });
});
