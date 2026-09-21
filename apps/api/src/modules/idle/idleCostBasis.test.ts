import { beforeEach, describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { __resetDieselMedianCache } from "../posted-prices/index.js";
import { resolveIdleCostBasis } from "./idleCostBasis.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/**
 * The I/O half of Q9. The three-tier RULE is proved pure in
 * `packages/shared/src/idleCostBasis.test.ts`; what is only testable here is which tables are read,
 * with which filters, and that one org's board never prices another's idle.
 */
beforeEach(() => {
  __resetDieselMedianCache();
});

const settingsRow = (gal: unknown, price: unknown) => [{ idle_gal_per_hour: gal, fuel_price_per_gal: price }];

describe("resolveIdleCostBasis", () => {
  it("scopes both reads to one org — the service role bypasses RLS", async () => {
    const rec = createSupabaseRecorder({
      tables: { idle_settings: settingsRow("0.80", "4.000"), fuel_prices: [{ net_price: 5.9, posted_price: null }] },
    });
    await resolveIdleCostBasis(rec.client, ORG);
    expectOrgScoped(rec, ORG);
    expect(rec.forTable("idle_settings")).toHaveLength(1);
    expect(rec.forTable("fuel_prices")).toHaveLength(1);
  });

  // PostgREST hands numerics back as STRINGS. A basis that took them at face value would multiply
  // seconds by "0.80" and get NaN dollars, which renders as an empty tile rather than as an error.
  it("reads the settings numerics, which arrive as strings, and prices off the board", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        idle_settings: settingsRow("1.10", "4.000"),
        fuel_prices: [{ net_price: "5.87", posted_price: null }, { net_price: "5.88", posted_price: null }],
      },
    });
    expect(await resolveIdleCostBasis(rec.client, ORG)).toEqual({
      idleGalPerHour: 1.1,
      fuelPricePerGal: 5.875,
      priceSource: "truck_stops",
    });
  });

  /**
   * The disagreement Q9 closes. `fuelIdleVerdict` used to resolve a basis from `idle_settings`
   * ALONE, so the fuel-spend report charged unpriced days $4.000/gal while the Idling page charged
   * them the truck-stop median — $5.873 against production on 2026-09-21, when the fleet's own
   * fills those days ran $5.79–$6.22. The board wins whenever it has an answer.
   */
  it("prefers the board over the configured fallback, which is the report's old answer", async () => {
    const rec = createSupabaseRecorder({
      tables: { idle_settings: settingsRow("0.80", "4.000"), fuel_prices: [{ net_price: 5.873, posted_price: null }] },
    });
    const basis = await resolveIdleCostBasis(rec.client, ORG);
    expect(basis.fuelPricePerGal).toBe(5.873);
    expect(basis.priceSource).toBe("truck_stops");
  });

  it("falls back to the configured price when the board collected nothing", async () => {
    const rec = createSupabaseRecorder({
      tables: { idle_settings: settingsRow("0.80", "4.250"), fuel_prices: [] },
    });
    expect(await resolveIdleCostBasis(rec.client, ORG)).toEqual({
      idleGalPerHour: 0.8,
      fuelPricePerGal: 4.25,
      priceSource: "settings",
    });
  });

  it("falls back to the defaults for an org with no settings row at all", async () => {
    const rec = createSupabaseRecorder({ tables: { idle_settings: [], fuel_prices: [] } });
    expect(await resolveIdleCostBasis(rec.client, ORG)).toEqual({
      idleGalPerHour: 0.8,
      fuelPricePerGal: 4,
      priceSource: "default",
    });
  });
});
