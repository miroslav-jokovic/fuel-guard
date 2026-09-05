import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `GET /api/fueling/fleet-mpg` — the boundary a SURFACE crosses (M4, D-MPG1/D-MPG6).
 *
 * The arithmetic is proved in `fleetEfficiency.test.ts`, the pairing in `fleetMpg.test.ts` and the
 * distance in `samsaraOdometerReads.test.ts`. What is only testable here is what the route decides,
 * and each of those decisions is a ruling rather than a validation:
 *
 *   • **`grain=day` is refused.** D-MPG6 retired the daily MPG trend on measured evidence, and §2 of
 *     the plan says the API does not refuse a legal QUESTION — so `getFleetMpg` still answers for a
 *     single day and the route refuses only the daily SERIES, which is the artefact itself.
 *   • **A withheld figure is a 200 with a reason**, never a 404 or an empty body. "We cannot measure
 *     that yet, and here is why" is the answer to "what is our MPG" over a half-covered fleet; an
 *     error sends the caller looking for a bug in the page.
 *   • **`vehicles` is validated before it reaches `.in()`** on a service-role query, where the org
 *     filter is the only tenant boundary.
 */

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const V1 = "11111111-2222-4333-8444-555555555555";

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const ADMIN: AuthContext = { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" };

let server: Server;
let baseUrl = "";

const seed = () =>
  createSupabaseRecorder({
    tables: {
      organizations: [{ id: ORG, operating_hours: { tz: "America/Chicago" } }],
      samsara_odometer_readings: [],
      fuel_spend_days: [],
    },
  });

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    if (token !== "token") throw new Error("bad token");
    return ADMIN;
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
  holder.rec = seed();
});

const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { Authorization: "Bearer token" } });

describe("GET /api/fueling/fleet-mpg", () => {
  it("refuses a DAILY series, and says why in the ruling's own terms", async () => {
    const res = await get("/api/fueling/fleet-mpg?from=2026-09-01&to=2026-09-30&grain=day");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/week grain or coarser/i);
  });

  it("still answers for a single DAY as a period — the API does not refuse a legal question", async () => {
    const res = await get("/api/fueling/fleet-mpg?from=2026-09-01&to=2026-09-01");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { from: string; to: string } };
    expect(body.data).toMatchObject({ from: "2026-09-01", to: "2026-09-01" });
  });

  it("answers a withheld figure with 200 and a reason, not with an error", async () => {
    // Nothing staged: no fuel, so there is nothing to divide. A 404 here would read as a broken page.
    const res = await get("/api/fueling/fleet-mpg?from=2026-09-01&to=2026-09-07");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { mpg: number | null; reason: string | null; milesSource: string } };
    expect(body.data.mpg).toBeNull();
    expect(body.data.reason).toMatch(/nothing to divide/i);
    // The provenance travels even with a withheld figure (D-MPG1).
    expect(body.data.milesSource).toBe("measured");
  });

  it("returns the window AND its buckets at week grain, with the total measured over the window", async () => {
    const res = await get("/api/fueling/fleet-mpg?from=2026-08-31&to=2026-09-13&grain=week");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { grain: string; total: { from: string }; periods: { from: string; to: string }[] } };
    expect(body.data.grain).toBe("week");
    expect(body.data.total.from).toBe("2026-08-31");
    expect(body.data.periods.map((p) => [p.from, p.to])).toEqual([
      ["2026-08-31", "2026-09-06"],
      ["2026-09-07", "2026-09-13"],
    ]);
  });

  it("passes a validated truck list to the database and drops anything that is not a UUID", async () => {
    await get(`/api/fueling/fleet-mpg?from=2026-09-01&to=2026-09-07&vehicles=${V1},not-a-uuid`);
    const filters = holder.rec!.forTable("fuel_spend_days")[0]!.filters().map((f) => [f.col, f.val]);
    expect(filters).toEqual(expect.arrayContaining([["org_id", ORG], ["vehicle_id", [V1]]]));
  });

  it("treats an absent `vehicles` as the whole fleet, not as an empty scope", async () => {
    await get("/api/fueling/fleet-mpg?from=2026-09-01&to=2026-09-07");
    const q = holder.rec!.forTable("fuel_spend_days")[0]!;
    // The read happened — an empty scope would have skipped it entirely — and it named no truck.
    expect(q.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }]));
    expect(q.ops.some((o) => o.method === "in" && o.args[0] === "vehicle_id")).toBe(false);
  });

  it("bounds the window rather than trusting it", async () => {
    const res = await get("/api/fueling/fleet-mpg?from=2020-01-01&to=2026-09-30&grain=week");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/at most 400 days/i);
  });
});
