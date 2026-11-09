import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext, LiveMapBoard } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `GET /api/livemap/positions` — the gate half of LM6.
 *
 * The board's assembly is tested in `liveMapBoard.test.ts`; what is only testable HERE is who is
 * answered. Two layers stack, and the difference between them is the difference between "your org
 * does not have Dispatch" and "you personally may not see it" — a support ticket can act on the
 * first and a manager can act on the second, which is why D55 keeps them separate.
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

async function ask(role: string, opts: { moduleEnabled?: boolean } = {}) {
  rec = createSupabaseRecorder({
    tables: {
      vehicle_positions: {
        data: [
          {
            vehicle_id: "veh-1",
            lat: 44.51,
            lng: -88.01,
            heading_degrees: 275,
            speed_mph: 62,
            is_ecu_speed: true,
            formatted_location: "Green Bay, WI",
            sampled_at: new Date().toISOString(),
            received_at: new Date().toISOString(),
          },
        ],
      },
      vehicles: { data: [{ id: "veh-1", unit_number: "1207", status: "active", assigned_driver_id: null }] },
      drivers: { data: [] },
      loads: { data: [] },
      load_stops: { data: [] },
    },
    rpc: { org_module_enabled: opts.moduleEnabled ?? true },
  });
  holder.client = rec.client;
  const res = await fetch(`${baseUrl}/api/livemap/positions`, {
    headers: { Authorization: `Bearer ${role}` },
  });
  return { status: res.status, body: (await res.json()) as { ok: boolean; data: LiveMapBoard; error?: { code: string } } };
}

describe("GET /api/livemap/positions", () => {
  it("answers a dispatcher — the role the whole surface exists for", async () => {
    const { status, body } = await ask("dispatcher");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.vehicles).toHaveLength(1);
    expect(body.data.scope).toBe("all");
  });

  // `dispatch: view` is enough — an auditor holds it and has no business being refused a read-only
  // board, while `manage` would have meant only the people who can change loads may look at them.
  it("answers an auditor, who holds dispatch:view but not manage", async () => {
    expect((await ask("auditor")).status).toBe(200);
  });

  it("answers admin and fleet_manager", async () => {
    expect((await ask("admin")).status).toBe(200);
    expect((await ask("fleet_manager")).status).toBe(200);
  });

  // `safety_manager` holds `dispatch: none` in the shipped matrix, and `driver` holds none of
  // anything. Neither is a judgement made here — both are read off the section matrix at request
  // time, so an org that grants its safety manager Dispatch is answered correctly without a code
  // change (D-PERM3).
  it("refuses a safety manager and a driver", async () => {
    for (const role of ["safety_manager", "driver"]) {
      const { status, body } = await ask(role);
      expect(status, role).toBe(403);
      expect(body.error?.code, role).toBe("forbidden");
    }
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await fetch(`${baseUrl}/api/livemap/positions`);
    expect(res.status).toBe(401);
  });

  // The other layer, and a different sentence on purpose: a tenant without Dispatch should get one
  // clear message naming the module rather than an empty board nobody can explain.
  it("refuses a whole org that does not have the Dispatch module, and says which module", async () => {
    const { status, body } = await ask("dispatcher", { moduleEnabled: false });
    expect(status).toBe(403);
    expect(body.error?.code).toBe("module_disabled");
  });

  it("writes no audit row for a read, however often it is polled", async () => {
    await ask("dispatcher");
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });
});

/**
 * `GET /api/livemap/loads/:id/route` (TRUCK-CARD-ROUTE-PLAN TC3, D-TC5): the board's gate, unchanged —
 * whoever may see the map may draw a route on it. The route's assembly is `liveMapLoadRoute.test.ts`;
 * here only who is answered, and that a malformed id never reaches Postgres.
 */
describe("GET /api/livemap/loads/:id/route", () => {
  const LOAD = "11111111-2222-4333-8444-000000000001";
  async function route(role: string, id = LOAD) {
    rec = createSupabaseRecorder({ tables: { loads: { data: [] } }, rpc: { org_module_enabled: true } });
    holder.client = rec.client;
    const res = await fetch(`${baseUrl}/api/livemap/loads/${id}/route`, { headers: { Authorization: `Bearer ${role}` } });
    return { status: res.status, body: (await res.json()) as { error?: { code: string } } };
  }

  it("answers a role with dispatch:view, an auditor included (404 here only because the load is absent)", async () => {
    for (const role of ["dispatcher", "auditor", "admin"]) expect((await route(role)).status, role).toBe(404);
  });

  it("refuses a role without dispatch:view before reading anything", async () => {
    const { status, body } = await route("safety_manager");
    expect(status).toBe(403);
    expect(body.error?.code).toBe("forbidden");
    expect(rec.forTable("loads")).toHaveLength(0);
  });

  it("answers a malformed id with a 404 and never asks the database", async () => {
    const { status } = await route("dispatcher", "not-a-uuid");
    expect(status).toBe(404);
    expect(rec.forTable("loads")).toHaveLength(0);
  });
});

/**
 * `GET /api/livemap/vehicles/:id/place` (D-LM31): the board's gate again — whoever may see a truck on
 * the map may see which truck stop it is at. The lookup itself is `liveMapVehiclePlace.test.ts`.
 */
describe("GET /api/livemap/vehicles/:id/place", () => {
  const TRUCK = "11111111-2222-4333-8444-000000000009";
  async function place(role: string, id = TRUCK) {
    rec = createSupabaseRecorder({
      tables: { vehicle_positions: { data: [] }, vehicles: { data: [] }, drivers: { data: [] }, loads: { data: [] }, load_stops: { data: [] } },
      rpc: { org_module_enabled: true },
    });
    holder.client = rec.client;
    const res = await fetch(`${baseUrl}/api/livemap/vehicles/${id}/place`, { headers: { Authorization: `Bearer ${role}` } });
    return { status: res.status, body: (await res.json()) as { error?: { code: string } } };
  }

  it("answers a role with dispatch:view (404 here only because the truck is not on the board)", async () => {
    for (const role of ["dispatcher", "auditor", "admin"]) {
      const { status, body } = await place(role);
      expect(status, role).toBe(404);
      expect(body.error?.code, role).toBe("not_found");
    }
  });

  it("refuses a role without dispatch:view", async () => {
    const { status, body } = await place("safety_manager");
    expect(status).toBe(403);
    expect(body.error?.code).toBe("forbidden");
  });

  it("answers a malformed id with a 404 and never reads the board", async () => {
    const { status } = await place("dispatcher", "not-a-uuid");
    expect(status).toBe(404);
    expect(rec.forTable("vehicle_positions")).toHaveLength(0);
  });

  it("writes no audit row for a lookup", async () => {
    await place("dispatcher");
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });
});

/**
 * HERE failing is a 502 the card reads as "no line", and NOT an unhandled route error — which
 * `errorResponder` would report to Sentry as our own bug (the tile proxy's B2 note, `mapProxies.ts`).
 */
describe("GET /api/livemap/vehicles/:id/place when HERE does not answer", () => {
  const TRUCK = "11111111-2222-4333-8444-00000000000a";
  it("answers 502 place_unavailable, not an unhandled route error", async () => {
    const { __resetLiveMapBoardCache } = await import("../liveMapBoardCache.js");
    __resetLiveMapBoardCache();
    const now = new Date().toISOString();
    rec = createSupabaseRecorder({
      tables: {
        vehicle_positions: {
          data: [{ vehicle_id: TRUCK, lat: 41.4808, lng: -88.0801, heading_degrees: null, speed_mph: 0, is_ecu_speed: true, formatted_location: "IL-53, Joliet, IL", sampled_at: now, received_at: now }],
        },
        vehicles: { data: [{ id: TRUCK, unit_number: "1042", status: "active", assigned_driver_id: null }] },
        drivers: { data: [] },
        loads: { data: [] },
        load_stops: { data: [] },
      },
      rpc: { org_module_enabled: true },
    });
    holder.client = rec.client;
    const realFetch = globalThis.fetch;
    const hereCalls: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("hereapi.com")) {
        hereCalls.push(url);
        throw new Error("connect ECONNREFUSED");
      }
      return realFetch(input as string, init);
    });
    const app = createApp({ ...env, HERE_API_KEY: "test-here-key" });
    app.locals.verifyToken = async (token: string): Promise<AuthContext> => who(token);
    const local = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    try {
      const res = await realFetch(`http://127.0.0.1:${(local.address() as AddressInfo).port}/api/livemap/vehicles/${TRUCK}/place`, {
        headers: { Authorization: "Bearer dispatcher" },
      });
      const body = (await res.json()) as { error?: { code: string } };
      expect(hereCalls).toHaveLength(1);
      expect(res.status).toBe(502);
      expect(body.error?.code).toBe("place_unavailable");
    } finally {
      vi.unstubAllGlobals();
      await closeTestServer(local);
      __resetLiveMapBoardCache();
    }
  });
});
