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

describe("GET /api/idle/engine/avoidable (IE3)", () => {
  const get = (role: string, q: string) => {
    rec = createSupabaseRecorder({
      tables: {
        organizations: [{ operating_hours: { tz: "America/Chicago" } }],
        idle_settings: [{ comfort_low_f: "20", comfort_high_f: "85", idle_gal_per_hour: "0.80", fuel_price_per_gal: "4.000" }],
        fuel_prices: [], idle_engine_stops: [], vehicles: [],
      },
      rpc: { idle_engine_burn_hours: [] },
    });
    holder.client = rec.client;
    return fetch(`${baseUrl}/api/idle/engine/avoidable?${q}`, { headers: { Authorization: `Bearer ${role}` } });
  };

  it("answers a range of local days", async () => {
    const res = await get("safety_manager", "from=2026-09-01&to=2026-09-30");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { from: string; to: string; totals: { parks: number } } };
    expect(body.data).toMatchObject({ from: "2026-09-01", to: "2026-09-30", totals: { parks: 0 } });
  });

  it.each([
    ["a missing end", "from=2026-09-01"],
    ["a reversed range", "from=2026-09-30&to=2026-09-01"],
    ["an impossible date", "from=2026-02-31&to=2026-03-01"],
    ["a range past a year", "from=2025-01-01&to=2026-01-02"],
  ])("refuses %s, and reads no park", async (_, q) => {
    expect((await get("safety_manager", q)).status).toBe(400);
    expect(rec.forTable("idle_engine_stops")).toHaveLength(0);
  });

  it("is the Idling surface's door: a role without safety is refused", async () => {
    expect((await get("recruiter", "from=2026-09-01&to=2026-09-30")).status).toBe(403);
  });
});

describe("GET /api/idle/engine/burn-rates (IE4)", () => {
  const get = (role: string) => {
    rec = createSupabaseRecorder({
      tables: { idle_settings: [{ idle_gal_per_hour: "0.80", fuel_price_per_gal: "4.000" }], fuel_prices: [], vehicles: [] },
      rpc: { idle_engine_burn_hours: [] },
    });
    holder.client = rec.client;
    return fetch(`${baseUrl}/api/idle/engine/burn-rates`, { headers: { Authorization: `Bearer ${role}` } });
  };

  it("answers the learned table beside the configured rate", async () => {
    const res = await get("safety_manager");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { cells: unknown[]; configuredGalPerHour: number; priorGalPerHour: number } };
    expect(body.data).toMatchObject({ cells: [], configuredGalPerHour: 0.8, priorGalPerHour: 0.72 });
  });

  it("is the Idling surface's door: a role without safety is refused, and nothing is read", async () => {
    expect((await get("recruiter")).status).toBe(403);
    expect(rec.rpcs()).toHaveLength(0);
  });
});

describe("GET /api/idle/engine/parity (IE5)", () => {
  const get = (role: string) => {
    rec = createSupabaseRecorder({ tables: { organizations: [{ operating_hours: { tz: "America/Chicago" } }], jobs: [] } });
    holder.client = rec.client;
    return fetch(`${baseUrl}/api/idle/engine/parity`, { headers: { Authorization: `Bearer ${role}` } });
  };

  it("answers the gate, nothing final before the first nightly", async () => {
    const res = await get("safety_manager");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { finalThrough: string | null; pass: boolean; daysNeeded: number } };
    expect(body.data).toMatchObject({ finalThrough: null, pass: false, daysNeeded: 14 });
  });

  it("is the Idling surface's door: a role without safety is refused", async () => {
    expect((await get("recruiter")).status).toBe(403);
    expect(rec.forTable("jobs")).toHaveLength(0);
  });
});

