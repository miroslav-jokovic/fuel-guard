import { describe, it, expect } from "vitest";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { loadReeferContext } from "./context.js";
import type { TxnView } from "@fuelguard/shared";

/**
 * Regression test for audit 2026-08-09 finding 4.1a.
 *
 * The scoring window is built as `anchor ± cumulativeWindowHours` — twice the configured span — and
 * this loader used to sum reefer gallons all the way to the FAR edge, while ruleReeferOverfuelRate
 * sized its physical ceiling from `gph * cumulativeWindowHours`. Ninety-six hours of purchases were
 * therefore judged against a forty-eight-hour burn allowance, which fires a weight-75 `high` theft
 * alert on honest fuelling and attaches evidence text claiming a 48-hour span.
 *
 * The rule itself cannot catch this: it receives `reeferWindowGallons` as a number and has no way to
 * know what span produced it. The defect only exists in the QUERY, so that is what is asserted here.
 */
const ORG = "org1";
const ANCHOR = "2026-06-10T12:00:00Z"; // == txn.fueledAt, the bound the loader derives
const WIN_START = "2026-06-08T12:00:00Z"; // anchor − 48h
const FAR_EDGE = "2026-06-12T12:00:00Z"; // anchor + 48h — what used to be passed

const reeferTxn = (): TxnView =>
  ({ id: "t1", vehicleId: "v1", tankType: "reefer", fueledAt: ANCHOR, gallons: 45 }) as TxnView;

describe("loadReeferContext — window bounds", () => {
  it("sums reefer gallons over a TRAILING window, never past the fill being scored", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        trailers: [{ reefer_tank_capacity_gal: 50 }],
        fuel_transactions: [{ gallons: 45 }, { gallons: 45 }],
      },
    });

    await loadReeferContext(rec.client, ORG, reeferTxn(), WIN_START);

    const fills = rec.forTable("fuel_transactions")[0];
    expect(fills).toBeDefined();
    const upper = fills!.ops.find((o) => o.method === "lte" && o.args[0] === "fueled_at");
    expect(upper?.args[1]).toBe(ANCHOR);
    // The specific regression: never the far edge of the centred window.
    expect(upper?.args[1]).not.toBe(FAR_EDGE);

    const lower = fills!.ops.find((o) => o.method === "gte" && o.args[0] === "fueled_at");
    expect(lower?.args[1]).toBe(WIN_START);
  });

  it("stays scoped to one org and one vehicle's reefer tank", async () => {
    const rec = createSupabaseRecorder({
      tables: { trailers: [{ reefer_tank_capacity_gal: 50 }], fuel_transactions: [{ gallons: 45 }] },
    });
    await loadReeferContext(rec.client, ORG, reeferTxn(), WIN_START);
    for (const q of rec.queries) {
      expect(q.filters().some((f) => f.col === "org_id" && f.val === ORG)).toBe(true);
    }
  });

  it("leaves capacity unknown when the truck has two reefer trailers (match, do not guess)", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        trailers: [{ reefer_tank_capacity_gal: 50 }, { reefer_tank_capacity_gal: 80 }],
        fuel_transactions: [{ gallons: 45 }],
      },
    });
    const out = await loadReeferContext(rec.client, ORG, reeferTxn(), WIN_START);
    expect(out.reeferTankCapacityGal).toBeNull();
  });
});
