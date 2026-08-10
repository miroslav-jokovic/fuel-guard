import { describe, expect, it } from "vitest";
import { loadConsumptionContext, resolveFuelBalance } from "./consumptionContext.js";
import { computedMpg, type TxnView, type VehicleView } from "@fuelguard/shared";
import { createSupabaseRecorder, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import type { FtxnRow } from "./loaders.js";

const vehicle: VehicleView = { id: "v1", fuelType: "diesel", tankCapacityGal: 240, baselineMpg: 6.5 };
const row = (id: string, before: number, after: number) => ({
  id,
  created_at: `2026-08-08T12:0${id}Z`,
  fueled_at: `2026-08-08T12:0${id}Z`,
  fueled_at_precision: "instant",
  source: "fuel_card",
  fueling_time_basis: "tank_confirmed",
  samsara_recon_at: `2026-08-08T12:0${id}Z`,
  samsara_location_matched: true,
  samsara_fuel_pct_before: before,
  samsara_fuel_pct_after: after,
});

describe("resolveFuelBalance", () => {
  it("uses tank state to calculate consumed fuel", () => {
    const result = resolveFuelBalance([row("1", 10, 50), row("2", 40, 80)], vehicle, 200, "samsara_obd", 6.5);
    expect(result.mode).toBe("tank_balance");
    expect(result.startTankGallons).toBe(24);
    expect(result.endTankGallons).toBe(192);
    expect(result.consumedGallons).toBe(32);
    expect(result.sampleCount).toBe(2);
  });

  it("falls back when confirmed tank evidence is insufficient", () => {
    const result = resolveFuelBalance([row("1", 10, 50)], vehicle, 100, "entered", 6.5);
    expect(result.mode).toBe("mpg_fallback");
    expect(result.consumedGallons).toBeNull();
  });
});

/**
 * Regression test for audit 2026-08-09 finding B — asymmetric intermediate gallons.
 *
 * Intermediate gallons are the fuel burned inside an odometer span by fills that were SKIPPED when the
 * previous-fill was chosen (blank odometer, flagged entry). The fill under test got that figure from a
 * query over every tractor fill in its span; each BASELINE fill got it from the previous-fill candidate
 * rows, which are loaded with `.not("odometer", "is", null)`. So blank-odometer fuel was charged to the
 * numerator's span and omitted from every denominator's — a ONE-DIRECTIONAL lift of the MPG baseline,
 * not noise. On the truck below, three honest 6.0-MPG fills read as 8.4 MPG in the baseline, and the
 * next honest fill is then measured against a history it never drove.
 *
 * A blank odometer is common (drivers leave it off, EFS omits it), so this hits ordinary fleets.
 */
const V = "v1";
const CURRENT = "t5";

/** One tractor fill. `odometer: null` = the blank-odometer fill the two sides used to disagree about. */
const fill = (
  id: string,
  fueled_at: string,
  gallons: number,
  odometer: number | null,
): FtxnRow =>
  ({
    id,
    vehicle_id: V,
    driver_id: "d1",
    fueled_at,
    created_at: fueled_at,
    fueled_at_precision: "instant",
    source: "efs",
    tank_type: "tractor",
    is_canonical: true,
    odometer,
    gallons,
  }) as unknown as FtxnRow;

// A truck that genuinely gets 6.0 MPG. b2's span contains a 40-gal fill with no odometer entered:
// 840 miles on 100 + 40 gallons = 6.0 MPG. Omit those 40 gallons and the same span reads 8.4 MPG.
const b1 = fill("b1", "2026-06-01T12:00:00Z", 100, 100000);
const blank = fill("x1", "2026-06-03T12:00:00Z", 40, null);
const b2 = fill("b2", "2026-06-05T12:00:00Z", 100, 100840);
const b3 = fill("b3", "2026-06-09T12:00:00Z", 100, 101440);
const current = fill(CURRENT, "2026-06-12T12:00:00Z", 100, 102040);

/** Which of loadConsumptionContext's three fuel_transactions queries this is. */
const shapeOf = (q: RecordedQuery): "previous" | "window" | "span" => {
  if (q.ops.some((o) => o.method === "not" && o.args[0] === "odometer")) return "previous";
  const select = q.ops.find((o) => o.method === "select")?.args[0];
  return typeof select === "string" && select.startsWith("id, is_canonical") ? "window" : "span";
};

describe("loadConsumptionContext — intermediate gallons", () => {
  const recorder = () =>
    createSupabaseRecorder({
      tables: {
        fuel_transactions: (q) => {
          const shape = shapeOf(q);
          // The previous-fill candidates: odometer-bearing fills only, and only the older side.
          if (shape === "previous") {
            const older = q.ops.some((o) => o.method === "lt" && o.args[0] === "fueled_at");
            return older ? [b3, b2, b1] : [];
          }
          if (shape === "window") return [];
          return [b1, blank, b2, b3, current]; // the span: every tractor fill, odometer or not
        },
      },
    });

  it("counts a blank-odometer fill for the BASELINE fills, not only for the fill under test", async () => {
    const ctx = await loadConsumptionContext(
      recorder().client,
      { id: CURRENT, vehicleId: V, tankType: "tractor" } as TxnView,
      current,
      CURRENT,
      "2026-06-01T00:00:00Z",
      "2026-06-13T00:00:00Z",
      vehicle,
    );

    expect(ctx.recentTxns.map((t) => t.id)).toEqual(["b1", "b2", "b3"]); // oldest → newest
    // b2's span contains the 40-gal blank-odometer fill. This read 0 before the fix.
    expect(ctx.recentTxns[1]!.intermediateGallons).toBe(40);
    expect(ctx.recentTxns[2]!.intermediateGallons).toBe(0); // nothing between b2 and b3
    // The fill under test's own figure is unchanged by the fix — its side was already correct.
    expect(ctx.intermediateGallons).toBe(0);
  });

  it("keeps the baseline on the MPG the truck actually gets", async () => {
    const ctx = await loadConsumptionContext(
      recorder().client,
      { id: CURRENT, vehicleId: V, tankType: "tractor" } as TxnView,
      current,
      CURRENT,
      "2026-06-01T00:00:00Z",
      "2026-06-13T00:00:00Z",
      vehicle,
    );
    const mpgs = ctx.recentTxns
      .map((t, i) => computedMpg(t, ctx.recentTxns[i - 1] ?? null, t.intermediateGallons ?? 0))
      .filter((m): m is number => m != null);
    // Every span is 6.0 MPG. Dropping the blank-odometer gallons made b2 read 8.4 and dragged the
    // median baseline up, so the next honest 6.0-MPG fill fired mpg_deviation against itself.
    expect(mpgs).toEqual([6, 6]);
  });

  it("loads the intermediate-gallons universe WITHOUT an odometer filter (both sides, one query)", async () => {
    const rec = recorder();
    await loadConsumptionContext(
      rec.client,
      { id: CURRENT, vehicleId: V, tankType: "tractor" } as TxnView,
      current,
      CURRENT,
      "2026-06-01T00:00:00Z",
      "2026-06-13T00:00:00Z",
      vehicle,
    );
    const spans = rec.forTable("fuel_transactions").filter((q) => shapeOf(q) === "span");
    // Exactly one — the same set answers the fill under test and every baseline.
    expect(spans).toHaveLength(1);
    expect(spans[0]!.ops.some((o) => o.method === "not")).toBe(false);
  });
});
