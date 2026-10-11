import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext, IdleEquipmentRow } from "@silvicom/shared";
import { createApp } from "../../app.js";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../testing/httpServer.js";
import { readIdleEquipment } from "./idleEquipment.js";

/**
 * `GET /api/idle/equipment` and `readIdleEquipment` (IE1, D-IE7). The verdict's thresholds are
 * pinned in `@silvicom/shared`; what is only testable here is the join — behaviour lands on the
 * right truck, a truck with no parks is "not enough", the window and shares reach 0403's function —
 * and who is answered.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-02T12:00:00Z");
const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} as NodeJS.ProcessEnv);

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const truck = (id: string, unit: string, over: Record<string, unknown> = {}) => ({
  id,
  unit_number: unit,
  make: "Freightliner",
  model: "Cascadia",
  year: 2021,
  purchased_at: "2020-12-21",
  has_apu: false,
  apu_type: "none",
  has_optimized_idle: false,
  equipment_source: "owner_ruling_2026-10-01",
  idle_capability: "continuous_only",
  idle_optimized_pct: "12.5",
  ...over,
});

function recorder() {
  return createSupabaseRecorder({
    tables: {
      vehicles: [
        truck("v568", "568"),
        truck("v728", "728", { model: "LT625", make: "International", year: 2026, purchased_at: "2025-05-01", has_apu: true, apu_type: "battery_hvac" }),
        truck("v830", "830", { year: null, purchased_at: null, has_apu: null, apu_type: null, has_optimized_idle: null, equipment_source: null, idle_optimized_pct: null }),
      ],
    },
    rpc: {
      vehicle_long_park_behaviour: [
        { vehicle_id: "v568", parks: 20, idling_parks: 0, off_parks: 16 },
        { vehicle_id: "v728", parks: 50, idling_parks: 27, off_parks: 16 },
      ],
    },
  });
}

describe("readIdleEquipment", () => {
  it("puts each truck's behaviour beside its declaration and flags the disagreements", async () => {
    const rec = recorder();
    const rows = await readIdleEquipment(rec.client as never, ORG, NOW);
    const by = new Map(rows.map((r) => [r.unitNumber, r]));
    expect(by.get("568")).toMatchObject({
      batch: "Freightliner|Cascadia|2021|2020-12",
      declared: "no_apu",
      equipmentSource: "owner_ruling_2026-10-01",
      parks: 20,
      idlingPct: 0,
      offPct: 80,
      behavesLike: "battery_apu",
      review: true,
      idleOptimizedPct: 12.5,
    });
    expect(by.get("728")).toMatchObject({ declared: "battery_apu", behavesLike: "no_apu", idlingPct: 54, review: true });
  });

  it("reads a truck with no long parks as not enough, with no batch when it has no purchase date", async () => {
    const rec = recorder();
    const row = (await readIdleEquipment(rec.client as never, ORG, NOW)).find((r) => r.unitNumber === "830")!;
    expect(row).toMatchObject({ batch: null, declared: "not_entered", parks: 0, idlingPct: null, behavesLike: "not_enough_parks", review: false, idleOptimizedPct: 0 });
  });

  it("asks 0403's function for this org, the 45-day window and the §1.6 long-park definition", async () => {
    const rec = recorder();
    await readIdleEquipment(rec.client as never, ORG, NOW);
    expect(rec.rpcs()).toEqual([
      {
        fn: "vehicle_long_park_behaviour",
        args: {
          p_org: ORG,
          p_from: "2026-08-18T12:00:00.000Z",
          p_to: "2026-10-02T12:00:00.000Z",
          p_min_park_sec: 14400,
          p_idling_share: 0.8,
          p_off_share: 0.2,
        },
      },
    ]);
  });

  it("reads only this org's in-service trucks", async () => {
    const rec = recorder();
    await readIdleEquipment(rec.client as never, ORG, NOW);
    expectOrgScoped(rec, ORG);
    const q = rec.queries.find((x) => x.table === "vehicles")!;
    expect(q.ops).toContainEqual({ method: "in", args: ["status", ["active", "maintenance"]] });
  });

  it("fails loudly when the function fails, rather than calling every truck not enough", async () => {
    const rec = createSupabaseRecorder({
      tables: { vehicles: [truck("v568", "568")] },
      rpc: () => ({ data: null, error: { message: "permission denied" } }),
    });
    await expect(readIdleEquipment(rec.client as never, ORG, NOW)).rejects.toThrow(/permission denied/);
  });
});

describe("GET /api/idle/equipment", () => {
  let server: Server;
  let baseUrl = "";
  const who = (role: string): AuthContext =>
    ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role: role as AuthContext["role"] });

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

  async function ask(role: string) {
    const rec: SupabaseRecorder = recorder();
    holder.client = rec.client;
    const res = await fetch(`${baseUrl}/api/idle/equipment`, { headers: { Authorization: `Bearer ${role}` } });
    return { status: res.status, body: (await res.json()) as { ok: boolean; data: IdleEquipmentRow[] }, rec };
  }

  it("answers a safety viewer with every row and the review flag on the wire", async () => {
    const { status, body, rec } = await ask("auditor");
    expect(status).toBe(200);
    expect(body.data.map((r) => [r.unitNumber, r.review])).toEqual([["568", true], ["728", true], ["830", false]]);
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });

  it("refuses a driver", async () => {
    expect((await ask("driver")).status).toBe(403);
  });
});
