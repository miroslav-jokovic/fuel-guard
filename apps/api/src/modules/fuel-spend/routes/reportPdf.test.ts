import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `GET /api/fueling/report.pdf` (FS-PDF, Q-FSV14). The document itself is `fuelCostsReport.test.ts`'s; what only
 * the route decides is that the screen's own query string reaches the renderer with every filter intact, that a
 * value the screen's report would refuse is refused here too (one parser, `parseReportQuery`), who may ask, and
 * that the export leaves an audit row.
 */
const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));
const render = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("../fuelCostsReport.js", () => ({
  renderFuelCostsReport: async (...args: unknown[]) => {
    render.calls.push(args);
    return { pdf: Buffer.from("%PDF-1.4 test"), pages: 2 };
  },
}));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const V1 = "11111111-2222-4333-8444-555555555555";
const S1 = "21111111-2222-4333-8444-555555555555";

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const ADMIN: AuthContext = { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" };
const DRIVER: AuthContext = { userId: "u-drv", email: "d@x.test", orgId: ORG, role: "driver" };

let server: Server;
let baseUrl = "";
let auth: AuthContext = ADMIN;

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    if (token !== "token") throw new Error("bad token");
    return auth;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));
beforeEach(() => {
  auth = ADMIN;
  render.calls.length = 0;
  holder.rec = createSupabaseRecorder({ tables: { audit_logs: [] } });
});

const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { Authorization: "Bearer token" } });
const Q = "from=2026-09-01&to=2026-09-30";

describe("GET /api/fueling/report.pdf", () => {
  it("returns a PDF attachment named for the range", async () => {
    const res = await get(`/api/fueling/report.pdf?${Q}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("silvicom-fuel-costs-2026-09-01-to-2026-09-30.pdf");
    expect(Buffer.from(await res.arrayBuffer()).toString().startsWith("%PDF")).toBe(true);
  });

  it("hands the renderer the organization, the range and EVERY filter the screen sent", async () => {
    await get(`/api/fueling/report.pdf?${Q}&vehicles=${V1}&states=tx,ca&sites=${S1}&networks=out,unknown`);
    const [, org, from, to, filters] = render.calls[0]!;
    expect([org, from, to]).toEqual([ORG, "2026-09-01", "2026-09-30"]);
    expect(filters).toEqual({ vehicleIds: [V1], states: ["TX", "CA"], siteIds: [S1], networks: ["out", "unknown"] });
  });

  it("refuses what the screen's report refuses, and renders nothing", async () => {
    for (const bad of ["&states=Texas", "&networks=sideways", "&vehicles=nope", "&sites=nope"]) {
      const res = await get(`/api/fueling/report.pdf?${Q}${bad}`);
      expect(res.status, bad).toBe(400);
    }
    expect((await get("/api/fueling/report.pdf?from=2026-09-30&to=2026-09-01")).status).toBe(400);
    expect((await get("/api/fueling/report.pdf?from=2024-01-01&to=2026-09-30")).status).toBe(400);
    expect(render.calls).toHaveLength(0);
  });

  it("refuses a caller without the fuel section", async () => {
    auth = DRIVER;
    expect((await get(`/api/fueling/report.pdf?${Q}`)).status).toBe(403);
    expect(render.calls).toHaveLength(0);
  });

  it("leaves an audit row saying which filters the document carried", async () => {
    await get(`/api/fueling/report.pdf?${Q}&states=TX&vehicles=${V1}`);
    const rows = holder.rec!.writtenRows("audit_logs");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ org_id: ORG, action: "export.generated", entity: "fuel_report_days" });
    expect(JSON.stringify(rows[0])).toContain('"states":1');
  });
});
