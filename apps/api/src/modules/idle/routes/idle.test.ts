import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext, IdleCostBasis } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { __resetDieselMedianCache } from "../../posted-prices/index.js";

/**
 * `GET /api/idle/cost-basis` — the door half of Q9.
 *
 * The basis itself is proved in `idleCostBasis.test.ts` and its rule in `@silvicom/shared`. What is
 * only testable HERE is who is answered, and that `priceSource` survives the wire: the Idling page
 * DISPLAYS which tier priced the fleet's idle, and a contract that dropped it would silently remove
 * the only explanation the page gives for a number in dollars.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} as NodeJS.ProcessEnv);

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const who = (role: string): AuthContext =>
  ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role: role as AuthContext["role"] });

let server: Server;
let baseUrl = "";
let rec: SupabaseRecorder;

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => who(token);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await closeTestServer(server);
});

beforeEach(() => {
  __resetDieselMedianCache();
});

async function ask(role: string, prices: unknown[] = [{ net_price: 5.873, posted_price: null }]) {
  rec = createSupabaseRecorder({
    tables: {
      idle_settings: [{ idle_gal_per_hour: "0.80", fuel_price_per_gal: "4.000" }],
      fuel_prices: prices,
    },
  });
  holder.client = rec.client;
  const res = await fetch(`${baseUrl}/api/idle/cost-basis`, { headers: { Authorization: `Bearer ${role}` } });
  return { status: res.status, body: (await res.json()) as { ok: boolean; data: IdleCostBasis; error?: { code: string } } };
}

describe("GET /api/idle/cost-basis", () => {
  it("answers a safety manager with the basis AND where the price came from", async () => {
    const { status, body } = await ask("safety_manager");
    expect(status).toBe(200);
    expect(body.data).toEqual({ idleGalPerHour: 0.8, fuelPricePerGal: 5.873, priceSource: "truck_stops" });
  });

  it("names the tier when the board is empty, so the page can explain a fallback price", async () => {
    const { body } = await ask("safety_manager", []);
    expect(body.data).toEqual({ idleGalPerHour: 0.8, fuelPricePerGal: 4, priceSource: "settings" });
  });

  // `safety: view` is enough: an auditor holds it, and the Idling page they may already open shows
  // these two numbers. The level is read off the section matrix at request time, so an org that
  // grants its dispatcher Safety is answered correctly without a code change (D-PERM3).
  it("answers admin, fleet_manager and auditor", async () => {
    for (const role of ["admin", "fleet_manager", "auditor"]) {
      expect((await ask(role)).status, role).toBe(200);
    }
  });

  it("refuses a driver", async () => {
    const { status, body } = await ask("driver");
    expect(status).toBe(403);
    expect(body.error?.code).toBe("forbidden");
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await fetch(`${baseUrl}/api/idle/cost-basis`);
    expect(res.status).toBe(401);
  });

  it("writes no audit row for a read", async () => {
    await ask("safety_manager");
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });
});
