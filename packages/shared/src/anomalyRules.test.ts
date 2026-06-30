import { describe, it, expect } from "vitest";
import {
  runAllRules,
  reconcileAnomalies,
  effectiveBaseline,
  isOffHours,
  maxSeverity,
  type RuleContext,
  type TxnView,
  type VehicleView,
} from "./index.js";

const vehicle: VehicleView = { id: "v1", fuelType: "diesel", tankCapacityGal: 120, baselineMpg: 6.4 };

function txn(over: Partial<TxnView> = {}): TxnView {
  return {
    id: "t",
    vehicleId: "v1",
    driverId: "d1",
    fueledAt: "2026-06-10T17:00:00Z", // 12:00 Chicago (CDT) — within hours
    odometer: 100000,
    gallons: 90,
    pricePerGal: 3.9,
    totalCost: 351,
    ...over,
  };
}

function ctx(over: Partial<RuleContext> = {}): RuleContext {
  return {
    txn: txn(),
    vehicle,
    previousTxn: { ...txn(), id: "prev", fueledAt: "2026-06-08T17:00:00Z", odometer: 99400 }, // 600 mi, ~6.67 mpg
    recentTxns: [],
    thresholds: {
      mpgDropPct: 15,
      capacityTolerancePct: 5,
      rapidRefuelHours: 4,
      maxPlausibleMph: 85,
      costMinPerGal: null,
      costMaxPerGal: null,
      disabledRules: [],
    },
    operatingHours: { start: "05:00", end: "20:00", tz: "America/Chicago" },
    ...over,
  };
}

const ids = (c: RuleContext) => runAllRules(c).map((r) => r.ruleId);

describe("clean transaction", () => {
  it("fires nothing for a normal fill-up", () => {
    expect(runAllRules(ctx())).toEqual([]);
  });
});

describe("Tier 1 — odometer", () => {
  it("odometer_missing fires when odometer is null", () => {
    expect(ids(ctx({ txn: txn({ odometer: null }) }))).toContain("odometer_missing");
  });
  it("odometer_regression fires when below previous", () => {
    expect(ids(ctx({ txn: txn({ odometer: 99300 }) }))).toContain("odometer_regression");
  });
  it("odometer_stale fires when equal to previous with fuel dispensed", () => {
    expect(ids(ctx({ txn: txn({ odometer: 99400 }) }))).toContain("odometer_stale");
  });
  it("odometer_implausible_jump fires on impossible speed", () => {
    // 99400 → 200000 over 48h ⇒ ~2096 mph
    expect(ids(ctx({ txn: txn({ odometer: 200000 }) }))).toContain("odometer_implausible_jump");
  });
  it("does not fire odometer rules for a clean reading", () => {
    expect(ids(ctx())).not.toContain("odometer_regression");
  });
});

describe("Tier 2 — capacity (fuel vehicles only)", () => {
  it("exceeds_tank_capacity fires above tank+tolerance", () => {
    expect(ids(ctx({ txn: txn({ gallons: 150 }) }))).toContain("exceeds_tank_capacity");
  });
  it("suppresses implausible_topoff when capacity fires (precedence M9)", () => {
    const out = ids(ctx({ txn: txn({ gallons: 300, odometer: 99450 }) }));
    expect(out).toContain("exceeds_tank_capacity");
    expect(out).not.toContain("implausible_topoff");
  });
  it("implausible_topoff fires when gallons far exceed consumption", () => {
    // only ~7 miles since last but 110 gal dispensed
    expect(ids(ctx({ txn: txn({ gallons: 110, odometer: 99407 }) }))).toContain("implausible_topoff");
  });
  it("capacity rule is skipped for electric vehicles (gating H1)", () => {
    const ev: VehicleView = { id: "e1", fuelType: "electric", tankCapacityGal: 0, baselineMpg: null };
    expect(ids(ctx({ vehicle: ev, txn: txn({ gallons: 150 }) }))).not.toContain("exceeds_tank_capacity");
  });
});

describe("Tier 3 — efficiency", () => {
  it("mpg_deviation fires when MPG is well below baseline", () => {
    // 99400 → 99450 = 50 mi / 90 gal ≈ 0.56 mpg vs baseline 6.4
    expect(ids(ctx({ txn: txn({ odometer: 99450 }) }))).toContain("mpg_deviation");
  });
  it("does not fire mpg_deviation for a normal economy fill", () => {
    expect(ids(ctx())).not.toContain("mpg_deviation");
  });
  it("mpg_sustained_decline fires on a downward trend", () => {
    // build 6 prior fills: high mpg then low mpg, 100 gal each, 1 day apart
    const recent: TxnView[] = [];
    let odo = 90000;
    const mpgs = [7, 7, 7, 5, 5, 5];
    mpgs.forEach((m, i) => {
      odo += m * 100;
      recent.push(txn({ id: `r${i}`, odometer: odo, gallons: 100, fueledAt: `2026-05-${10 + i}T17:00:00Z` }));
    });
    const cur = txn({ odometer: odo + 500, gallons: 100, fueledAt: "2026-05-17T17:00:00Z" }); // 5 mpg
    expect(ids(ctx({ txn: cur, previousTxn: recent[recent.length - 1]!, recentTxns: recent }))).toContain("mpg_sustained_decline");
  });
});

describe("Tier 4 — behavioral", () => {
  it("rapid_repeat_fueling fires within the window", () => {
    expect(ids(ctx({ txn: txn({ fueledAt: "2026-06-08T18:00:00Z", odometer: 99450 }) }))).toContain("rapid_repeat_fueling");
  });
  it("off_hours_fueling fires at 2am local", () => {
    // 2026-06-10T07:00:00Z = 02:00 Chicago
    expect(ids(ctx({ txn: txn({ fueledAt: "2026-06-10T07:00:00Z" }) }))).toContain("off_hours_fueling");
  });
  it("unattributed_transaction fires with no vehicle/driver", () => {
    expect(ids(ctx({ txn: txn({ vehicleId: null, driverId: null }), previousTxn: null }))).toContain("unattributed_transaction");
  });
  it("cost_outlier fires outside a configured band", () => {
    const c = ctx({ txn: txn({ pricePerGal: 9.5 }) });
    c.thresholds.costMaxPerGal = 6;
    expect(ids(c)).toContain("cost_outlier");
  });
  it("cost_outlier does not fire without a band", () => {
    expect(ids(ctx({ txn: txn({ pricePerGal: 9.5 }) }))).not.toContain("cost_outlier");
  });
});

describe("disabledRules + helpers", () => {
  it("honors disabledRules", () => {
    const c = ctx({ txn: txn({ gallons: 150 }) });
    c.thresholds.disabledRules = ["exceeds_tank_capacity"];
    expect(ids(c)).not.toContain("exceeds_tank_capacity");
  });
  it("effectiveBaseline falls back to the seeded value with too little history", () => {
    expect(effectiveBaseline(vehicle, [])).toBe(6.4);
  });
  it("isOffHours handles the org timezone", () => {
    expect(isOffHours("2026-06-10T07:00:00Z", { start: "05:00", end: "20:00", tz: "America/Chicago" })).toBe(true);
    expect(isOffHours("2026-06-10T17:00:00Z", { start: "05:00", end: "20:00", tz: "America/Chicago" })).toBe(false);
  });
  it("maxSeverity returns the highest", () => {
    expect(maxSeverity(runAllRules(ctx({ txn: txn({ gallons: 150 }) })))).toBe("critical");
  });
});

describe("hardening — precision gating (docs/09)", () => {
  it("suppresses off-hours + rapid-repeat for date-only (EFS) transactions", () => {
    // 02:00 Chicago would normally fire off_hours; date precision must suppress it.
    const c = ctx({
      txn: txn({ fueledAt: "2026-06-10T07:00:00Z", fueledAtPrecision: "date", odometer: 99450 }),
    });
    const out = ids(c);
    expect(out).not.toContain("off_hours_fueling");
    expect(out).not.toContain("rapid_repeat_fueling");
    expect(out).not.toContain("odometer_implausible_jump");
  });

  it("uses the daily-mileage cap instead of mph for date-only data", () => {
    // 600 mi over 2 days = 300 mi/day (ok); 6000 mi over 2 days trips the 1000/day cap
    const c = ctx({ txn: txn({ fueledAtPrecision: "date", odometer: 105400 }) });
    expect(ids(c)).toContain("odometer_daily_cap");
  });
});

describe("hardening — odometer correctness (±5 cross-source)", () => {
  it("fires odometer_mismatch when the two sources differ by more than the tolerance", () => {
    const c = ctx({ crossSourceOdometer: 100020 }); // entered 100000, other source 100020 → 20 mi
    expect(ids(c)).toContain("odometer_mismatch");
  });
  it("does not fire within ±5 miles", () => {
    expect(ids(ctx({ crossSourceOdometer: 100003 }))).not.toContain("odometer_mismatch");
  });
});

describe("hardening — cumulative overfuel", () => {
  it("fires when window gallons exceed burnable + a tank", () => {
    // 120 gal tank, baseline 6.4 → 100 mi window burns ~15.6 gal; ceiling ≈ 135.6. 400 gal > ceiling.
    const c = ctx({ windowGallons: 400, windowMiles: 100 });
    expect(ids(c)).toContain("cumulative_overfuel");
  });
  it("does not fire for legitimate high-mileage fueling", () => {
    // 2000 mi window can burn ~312 gal; 300 gal purchased is fine.
    const c = ctx({ windowGallons: 300, windowMiles: 2000 });
    expect(ids(c)).not.toContain("cumulative_overfuel");
  });
});

describe("hardening — card sharing", () => {
  it("fires card_multi_vehicle when one card fuels 2+ vehicles", () => {
    const c = ctx({ txn: txn({ cardRef: "93509" }), cardVehicleCountInWindow: 3 });
    expect(ids(c)).toContain("card_multi_vehicle");
  });
  it("does not fire for a single-vehicle card", () => {
    expect(ids(ctx({ txn: txn({ cardRef: "93509" }), cardVehicleCountInWindow: 1 }))).not.toContain("card_multi_vehicle");
  });
});

describe("hardening — expected odometer band (padding)", () => {
  it("flags miles far exceeding what the fuel could cover", () => {
    // gallons 90, baseline 6.4 → expected ~576 mi; entered 99400→101000 = 1600 mi (>2x)
    expect(ids(ctx({ txn: txn({ odometer: 101000 }) }))).toContain("expected_odometer_band");
  });
});

describe("reconcileAnomalies (audit M5)", () => {
  it("inserts new fired rules and supersedes stale open ones", () => {
    const fired = runAllRules(ctx({ txn: txn({ odometer: 99300 }) })); // regression (+ mpg)
    const existing = [
      { id: "a1", rule_id: "off_hours_fueling", status: "open", source: "rules" },
      { id: "a2", rule_id: "odometer_regression", status: "investigating", source: "rules" },
    ];
    const { toInsert, toSupersedeIds } = reconcileAnomalies(existing, fired);
    // regression already has an active (investigating) anomaly → not re-inserted, not superseded
    expect(toInsert.map((r) => r.ruleId)).not.toContain("odometer_regression");
    // off_hours no longer fires and is open → superseded
    expect(toSupersedeIds).toContain("a1");
  });
});
