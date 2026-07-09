import { describe, it, expect } from "vitest";
import {
  runAllRules,
  reconcileAnomalies,
  correlateSignals,
  effectiveBaseline,
  learnOdometerOffset,
  learnTankSensorReliability,
  learnObservedMaxFill,
  effectiveCapacityGal,
  robustWindowMiles,
  isOffHours,
  maxSeverity,
  type RuleContext,
  type RuleResult,
  type RuleId,
  type TxnView,
  type VehicleView,
} from "./index.js";

const vehicle: VehicleView = { id: "v1", fuelType: "diesel", tankCapacityGal: 120, baselineMpg: 6.4 };
// A truck whose fills reconcile with the tank sensor — required for the per-fill volume/consumption rules
// (tank_space_exceeded, implausible_topoff, mpg_deviation, mpg_sustained_decline) to be evaluated at all.
const reliable: VehicleView = { ...vehicle, tankSensorReliable: true };

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

describe("tank_space_exceeded (physical: can't add more than the tank holds)", () => {
  it("fires when billed gallons exceed the empty space before fueling (reliable-sensor truck)", () => {
    // 120 gal tank, 60% full before → only 48 gal of space, but billed 90 → impossible.
    expect(ids(ctx({ vehicle: reliable, tankPctBefore: 60 }))).toContain("tank_space_exceeded");
  });
  it("is suppressed for a truck whose sensor is not learned-reliable (dual-tank) — no false space alarm", () => {
    expect(ids(ctx({ tankPctBefore: 60 }))).not.toContain("tank_space_exceeded");
  });
  it("does not fire when the fill fits (near-empty tank)", () => {
    expect(ids(ctx({ tankPctBefore: 5 }))).not.toContain("tank_space_exceeded");
  });
  it("stays silent when the pre-fill level is unknown (no false alarm on missing data)", () => {
    expect(ids(ctx())).not.toContain("tank_space_exceeded");
  });
});

describe("correlateSignals (multi-signal → one case)", () => {
  const sig = (ruleId: RuleId, severity: RuleResult["severity"] = "high"): RuleResult => ({
    ruleId,
    fired: true,
    severity,
    message: `${ruleId} fired`,
    evidence: {},
  });

  it("no signals → clear (no anomaly)", () => {
    expect(correlateSignals([]).level).toBe("clear");
  });
  it("a lone WEAK signal (odometer mismatch) → clear, not a red alert", () => {
    expect(correlateSignals([sig("odometer_mismatch")]).level).toBe("clear");
  });
  it("a lone location mismatch → clear (corroboration-only, never alerts alone)", () => {
    expect(correlateSignals([sig("location_mismatch")]).level).toBe("clear");
  });
  it("a lone STRONG volume signal (tank fill short) → review", () => {
    const c = correlateSignals([sig("tank_fill_short")]);
    expect(c.level).toBe("review");
    expect(c.severity).toBe("medium");
  });
  it("an overwhelming physical signal (tank space) → alert on its own", () => {
    expect(correlateSignals([sig("tank_space_exceeded", "critical")]).level).toBe("alert");
  });
  it("two independent axes agreeing → alert", () => {
    const c = correlateSignals([sig("location_mismatch"), sig("tank_fill_short")]);
    expect(c.level).toBe("alert");
    expect(c.axes.sort()).toEqual(["location", "volume"]);
  });
  it("two signals on the SAME axis do not over-count into an alert", () => {
    // both odometer axis, weights 55 + 45 → single-axis, top 55 < review → clear
    const c = correlateSignals([sig("odometer_regression"), sig("odometer_mismatch")]);
    expect(c.level).toBe("clear");
  });
});

describe("Tier 1 — odometer", () => {
  it("odometer_missing is suppressed (data-quality, not an anomaly)", () => {
    expect(ids(ctx({ txn: txn({ odometer: null }) }))).not.toContain("odometer_missing");
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
  it("implausible_topoff fires when gallons far exceed consumption (reliable-sensor truck)", () => {
    // only ~7 miles since last but 110 gal dispensed
    expect(ids(ctx({ vehicle: reliable, txn: txn({ gallons: 110, odometer: 99407 }) }))).toContain("implausible_topoff");
  });
  it("capacity rule is skipped for electric vehicles (gating H1)", () => {
    const ev: VehicleView = { id: "e1", fuelType: "electric", tankCapacityGal: 0, baselineMpg: null };
    expect(ids(ctx({ vehicle: ev, txn: txn({ gallons: 150 }) }))).not.toContain("exceeds_tank_capacity");
  });
});

describe("Phase 2 — learned combined tank capacity", () => {
  it("learnObservedMaxFill returns null until enough fills, then a robust high value", () => {
    expect(learnObservedMaxFill([100, 100, 100, 100, 100])).toBeNull(); // < 12 samples
    const twelve = Array(12).fill(100);
    expect(learnObservedMaxFill(twelve)!.gallons).toBe(100);
    // Mostly single-tank ~100 with regular both-tank ~200 fills → converges near the both-tank volume.
    const mixed = [100, 100, 100, 100, 100, 100, 200, 200, 200, 200, 200, 200];
    expect(learnObservedMaxFill(mixed)!.gallons).toBeGreaterThanOrEqual(190);
  });

  it("learnObservedMaxFill drops a lone pump/theft outlier at larger n (p95)", () => {
    // 29 normal ~200 fills + one 900-gal outlier → p95 stays at the normal max, not the outlier.
    const vals = [...Array(29).fill(200), 900];
    expect(learnObservedMaxFill(vals)!.gallons).toBe(200);
  });

  it("effectiveCapacityGal only RAISES capacity above an under-entered nameplate, never lowers it", () => {
    expect(effectiveCapacityGal({ ...vehicle, tankCapacityGal: 120 })).toBe(120); // nothing learned
    expect(effectiveCapacityGal({ ...vehicle, tankCapacityGal: 120, observedMaxFillGal: 210 })).toBe(210); // dual-tank raise
    expect(effectiveCapacityGal({ ...vehicle, tankCapacityGal: 240, observedMaxFillGal: 210 })).toBe(240); // never lowers
  });

  it("a legitimate both-tank fill fires exceeds_tank_capacity ONLY before capacity is learned", () => {
    const singleTankEntered: VehicleView = { ...vehicle, tankCapacityGal: 120 }; // one tank entered
    const bothTankFill = txn({ gallons: 200, odometer: 100000 }); // fills both saddle tanks
    // Cold-start (nameplate only) → false-fires on the legit both-tank fill (current behaviour).
    expect(ids(ctx({ vehicle: singleTankEntered, txn: bothTankFill }))).toContain("exceeds_tank_capacity");
    // After learning the true combined capacity → no longer fires.
    const learned: VehicleView = { ...singleTankEntered, observedMaxFillGal: 210 };
    expect(ids(ctx({ vehicle: learned, txn: bothTankFill }))).not.toContain("exceeds_tank_capacity");
  });
});

describe("Tier 3 — efficiency", () => {
  it("mpg_deviation fires when MPG is well below baseline (reliable-sensor truck)", () => {
    // 99400 → 99450 = 50 mi / 90 gal ≈ 0.56 mpg vs baseline 6.4
    expect(ids(ctx({ vehicle: reliable, txn: txn({ odometer: 99450 }) }))).toContain("mpg_deviation");
  });
  it("mpg_deviation is suppressed for a not-yet-reliable / dual-tank truck (per-fill MPG unreliable)", () => {
    expect(ids(ctx({ txn: txn({ odometer: 99450 }) }))).not.toContain("mpg_deviation");
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
    expect(ids(ctx({ vehicle: reliable, txn: cur, previousTxn: recent[recent.length - 1]!, recentTxns: recent }))).toContain("mpg_sustained_decline");
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
  it("unattributed_transaction is suppressed (data-quality, not an anomaly)", () => {
    expect(ids(ctx({ txn: txn({ vehicleId: null, driverId: null }), previousTxn: null }))).not.toContain("unattributed_transaction");
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

describe("reefer tank split (Phase 0)", () => {
  it("does NOT run tractor volume rules on a reefer (ULSR) fill", () => {
    // 150 gal into a 120-gal tractor tank would fire exceeds_tank_capacity — but this is a reefer fill,
    // so tractor volume/consumption/tank rules are suppressed entirely.
    const reefer = ctx({ txn: txn({ gallons: 150, tankType: "reefer" }) });
    const out = ids(reefer);
    expect(out).not.toContain("exceeds_tank_capacity");
    expect(out).not.toContain("tank_space_exceeded");
    expect(out).not.toContain("mpg_deviation");
  });

  it("still runs tractor volume rules on a normal tractor fill", () => {
    expect(ids(ctx({ txn: txn({ gallons: 150, tankType: "tractor" }) }))).toContain("exceeds_tank_capacity");
  });

  it("fires reefer_exceeds_capacity when a ULSR fill exceeds the reefer tank", () => {
    // 80 gal reefer fill into a 50-gal reefer tank → can't fit.
    const c = ctx({ txn: txn({ gallons: 80, tankType: "reefer" }), reeferTankCapacityGal: 50 });
    const out = ids(c);
    expect(out).toContain("reefer_exceeds_capacity");
    expect(out).not.toContain("exceeds_tank_capacity"); // tractor rule stays off
  });

  it("does not fire reefer_exceeds_capacity for a normal reefer fill within the tank", () => {
    expect(ids(ctx({ txn: txn({ gallons: 40, tankType: "reefer" }), reeferTankCapacityGal: 50 }))).not.toContain("reefer_exceeds_capacity");
  });

  it("fires reefer_overfuel_rate when window reefer gallons exceed burn + a tank", () => {
    // 48h window, 1.5 gph → ~72 gal burnable + 50 tank = 122 max. 200 reefer gal → over.
    const c = ctx({ txn: txn({ gallons: 30, tankType: "reefer" }), reeferTankCapacityGal: 50, reeferWindowGallons: 200 });
    expect(ids(c)).toContain("reefer_overfuel_rate");
  });

  it("does NOT fire reefer rules when the reefer tank is unknown (no assumption → no false critical)", () => {
    // Big reefer fill but no paired reefer trailer → tank unknown → we must not accuse on an assumed 50 gal.
    const c = ctx({ txn: txn({ gallons: 90, tankType: "reefer" }) }); // reeferTankCapacityGal omitted → null
    const out = ids(c);
    expect(out).not.toContain("reefer_exceeds_capacity");
    expect(out).not.toContain("reefer_overfuel_rate");
  });

  it("reefer_exceeds_capacity correlates on the reefer axis (overwhelming → alert)", () => {
    const c = correlateSignals([{ ruleId: "reefer_exceeds_capacity", fired: true, severity: "critical", message: "m", evidence: {} }]);
    expect(c.axes).toContain("reefer");
    expect(c.level).toBe("alert"); // weight 90 ≥ overwhelming
  });
});

describe("hardening — time confidence (EFS auth-time vs telematics)", () => {
  it("suppresses off-hours + rapid-repeat when the posted time is UNcorroborated (timeConfirmed=false)", () => {
    // 02:00 Chicago posted time would fire off_hours, but we couldn't corroborate it (may be an EFS
    // authorization time, not the pump time) → suppress rather than flag a possibly-wrong clock.
    const c = ctx({ txn: txn({ fueledAt: "2026-06-10T07:00:00Z", timeConfirmed: false, odometer: 99450 }) });
    const out = ids(c);
    expect(out).not.toContain("off_hours_fueling");
    expect(out).not.toContain("rapid_repeat_fueling");
    expect(out).not.toContain("odometer_implausible_jump"); // implied-speed needs a reliable interval
  });

  it("uses the telematics eventAt (not the wrong posted time) for off-hours when corroborated", () => {
    // EFS posted 02:00 Chicago (would be off-hours), but telematics says the truck actually fueled at
    // 12:00 Chicago → eventAt governs and off_hours does NOT fire.
    const c = ctx({
      txn: txn({ fueledAt: "2026-06-10T07:00:00Z", eventAt: "2026-06-10T17:00:00Z", timeConfirmed: true }),
    });
    expect(ids(c)).not.toContain("off_hours_fueling");
  });

  it("still flags real off-hours fueling confirmed by telematics", () => {
    const c = ctx({
      txn: txn({ fueledAt: "2026-06-10T07:00:00Z", eventAt: "2026-06-10T07:00:00Z", timeConfirmed: true }),
    });
    expect(ids(c)).toContain("off_hours_fueling"); // 02:00 Chicago, corroborated → genuine
  });

  it("rapid-repeat measures the interval between telematics eventAt instants", () => {
    // Previous fill's true (telematics) time is 17:00; this one 18:00 → 1h apart → within the 4h window.
    const prev = { ...txn(), id: "prev", fueledAt: "2026-06-08T02:00:00Z", eventAt: "2026-06-08T17:00:00Z", odometer: 99400, timeConfirmed: true };
    const c = ctx({
      previousTxn: prev,
      txn: txn({ fueledAt: "2026-06-08T03:00:00Z", eventAt: "2026-06-08T18:00:00Z", odometer: 99450, timeConfirmed: true }),
    });
    expect(ids(c)).toContain("rapid_repeat_fueling");
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

  it("does NOT fire on a GPS-sourced odometer even with a large diff (GPS bias, display-only)", () => {
    // GPS-derived odometer carries a big per-truck bias a single offset can't absorb → never flag on it.
    expect(ids(ctx({ crossSourceOdometer: 100020, crossSourceOdometerSource: "gps" }))).not.toContain("odometer_mismatch");
    expect(ids(ctx({ crossSourceOdometer: 100020, crossSourceOdometerSource: "reconstructed" }))).not.toContain("odometer_mismatch");
  });
  it("still fires on an OBD-sourced odometer beyond tolerance", () => {
    expect(ids(ctx({ crossSourceOdometer: 100020, crossSourceOdometerSource: "obd" }))).toContain("odometer_mismatch");
  });

  it("a learned per-vehicle offset absorbs a constant dash↔Samsara gap (no false flag)", () => {
    // Truck's dash reads 1,200 mi above Samsara's OBD on every fill. Without calibration this fires; with
    // the learned offset applied it doesn't, because entered≈samsara+offset.
    const calibrated: VehicleView = { ...vehicle, odometerOffset: 1200 };
    expect(ids(ctx({ crossSourceOdometer: 98800 }))).toContain("odometer_mismatch"); // raw 1,200 gap
    expect(ids(ctx({ vehicle: calibrated, crossSourceOdometer: 98800 }))).not.toContain("odometer_mismatch");
  });

  it("still fires when a fill deviates from the established offset beyond tolerance", () => {
    const calibrated: VehicleView = { ...vehicle, odometerOffset: 1200 };
    // Expected entered ≈ 98800 + 1200 = 100000; this fill entered 100000 but samsara says 98750 → 50 off.
    expect(ids(ctx({ vehicle: calibrated, crossSourceOdometer: 98750 }))).toContain("odometer_mismatch");
  });
});

describe("learnTankSensorReliability", () => {
  const fills = (ratios: number[]) => ratios.map((r) => ({ observedRiseGal: r * 100, billedGallons: 100 }));
  it("marks a single-tank truck reliable (ratio clusters ≈1)", () => {
    const r = learnTankSensorReliability(fills([0.98, 1.02, 1.0, 0.95, 1.05, 1.01]));
    expect(r).not.toBeNull();
    expect(r!.reliable).toBe(true);
    expect(r!.ratio).toBeCloseTo(1.0, 1);
  });
  it("marks a dual-independent-tank truck UNreliable (ratio ≈0.5)", () => {
    const r = learnTankSensorReliability(fills([0.5, 0.48, 0.52, 0.49, 0.51]));
    expect(r!.reliable).toBe(false);
  });
  it("marks an erratic sensor UNreliable (wide swings)", () => {
    const r = learnTankSensorReliability(fills([1.9, 0.1, 1.0, 0.5, 1.4, 0.2]));
    expect(r!.reliable).toBe(false);
  });
  it("returns null until enough samples", () => {
    expect(learnTankSensorReliability(fills([1.0, 1.0]))).toBeNull();
  });
});

describe("learnOdometerOffset", () => {
  const P = (entered: number, samsara: number) => ({ entered, samsara });

  it("returns the median offset once enough tightly-clustered pairs exist", () => {
    const r = learnOdometerOffset([P(1200, 0), P(1201, 0), P(1199, 0), P(1200, 0)]);
    expect(r).toEqual({ offset: 1200, samples: 4 });
  });

  it("returns null below the minimum sample count", () => {
    expect(learnOdometerOffset([P(1200, 0), P(1201, 0)])).toBeNull();
  });

  it("returns null when pairs don't cluster (noisy, no stable offset)", () => {
    expect(learnOdometerOffset([P(1200, 0), P(50, 0), P(900, 0), P(-300, 0)])).toBeNull();
  });

  it("ignores outliers via the median and clustered majority", () => {
    const r = learnOdometerOffset([P(1200, 0), P(1200, 0), P(1200, 0), P(9999, 0)]);
    expect(r).toEqual({ offset: 1200, samples: 4 }); // 3 of 4 within tolerance → accepted
  });

  it("only considers the most recent `window` pairs", () => {
    const old = Array.from({ length: 8 }, () => P(0, 0)); // stale zero-offset era
    const recent = [P(500, 0), P(501, 0), P(499, 0), P(500, 0)]; // shifted to +500
    const r = learnOdometerOffset([...old, ...recent], { window: 4 });
    expect(r).toEqual({ offset: 500, samples: 4 });
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
  it("does not fire when miles are unknown (untrustworthy window → suppressed)", () => {
    const c = ctx({ windowGallons: 400, windowMiles: null });
    expect(ids(c)).not.toContain("cumulative_overfuel");
  });
});

describe("Phase 3 — robust over-fuel window miles", () => {
  const row = (enteredOdometer: number | null, samsaraOdometer: number | null = null, samsaraSource: string | null = null) =>
    ({ enteredOdometer, samsaraOdometer, samsaraSource });

  it("prefers the clean OBD Samsara odometer span over the noisy entered span", () => {
    const rows = [row(100000, 500000, "obd"), row(100050, 500600, "obd")]; // entered barely moves; OBD shows 600 mi
    const r = robustWindowMiles(rows);
    expect(r.basis).toBe("samsara_obd");
    expect(r.miles).toBe(600);
  });

  it("ignores GPS/reconstructed Samsara odometer (different baseline) and uses a clean entered span", () => {
    const rows = [row(100000, 900000, "gps"), row(100600, 930000, "reconstructed")];
    const r = robustWindowMiles(rows);
    expect(r.basis).toBe("entered");
    expect(r.miles).toBe(600);
  });

  it("suppresses (null) when the entered odometer regresses — a bad entry, not real miles", () => {
    const rows = [row(100600), row(100000)]; // later reading below the earlier one
    expect(robustWindowMiles(rows).miles).toBeNull();
  });

  it("returns null when fewer than two usable readings exist", () => {
    expect(robustWindowMiles([row(100000)]).miles).toBeNull();
    expect(robustWindowMiles([row(null, null, "obd")]).miles).toBeNull();
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

describe("location mismatch (precise state comparison)", () => {
  it("fires (high) only when telematics confirms a different state at the fueling time", () => {
    const fired = runAllRules(ctx({ samsaraLocationMatched: false, locationEvidence: { efsState: "GA", samsaraState: "TX" } }));
    const loc = fired.find((r) => r.ruleId === "location_mismatch");
    expect(loc).toBeTruthy();
    expect(loc!.severity).toBe("high");
    expect(loc!.evidence.samsaraState).toBe("TX");
  });
  it("does not fire when the state matches or is unknown", () => {
    expect(ids(ctx({ samsaraLocationMatched: true }))).not.toContain("location_mismatch");
    expect(ids(ctx({ samsaraLocationMatched: null }))).not.toContain("location_mismatch");
    expect(ids(ctx())).not.toContain("location_mismatch");
  });
});

describe("hardening — tank fill short (Samsara, advisory)", () => {
  // The check only runs for a truck with a configured MONITORED (sensed) tank capacity.
  const monitored: VehicleView = { ...vehicle, tankSensorReliable: true };
  it("fires (low) when the tank rose far less than billed gallons (monitored tank configured)", () => {
    const fired = runAllRules(ctx({ vehicle: monitored, tankFillShortGal: 65, tankObservedRiseGal: 25 }));
    const tank = fired.find((r) => r.ruleId === "tank_fill_short");
    expect(tank).toBeTruthy();
    expect(tank!.severity).toBe("low");
  });
  it("does NOT fire when the sensor is not learned-reliable (dual-tank/unknown) — even on a large shortfall", () => {
    // Default vehicle has tankSensorReliable falsy → single sensor can't reconcile a possibly-two-tank fill
    // → suppress rather than false-flag.
    expect(ids(ctx({ tankFillShortGal: 65, tankObservedRiseGal: 25 }))).not.toContain("tank_fill_short");
  });
  it("does not fire when the shortfall is absent or zero", () => {
    expect(ids(ctx())).not.toContain("tank_fill_short");
    expect(ids(ctx({ tankFillShortGal: 0 }))).not.toContain("tank_fill_short");
  });
  it("does NOT fire on a small sensor-noise shortfall within tolerance (monitored tank configured)", () => {
    // 0.4 gal short on a 90-gal fill (~27 gal sensor tolerance) is noise, not siphoning — must stay quiet.
    expect(ids(ctx({ vehicle: monitored, tankFillShortGal: 0.4, tankObservedRiseGal: 89.6 }))).not.toContain("tank_fill_short");
    // Just under the tolerance still doesn't fire.
    expect(ids(ctx({ vehicle: monitored, tankFillShortGal: 20 }))).not.toContain("tank_fill_short");
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
