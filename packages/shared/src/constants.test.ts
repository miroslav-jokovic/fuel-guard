import { describe, it, expect } from "vitest";
import { APP_NAME, USER_ROLES, MPG_FUEL_TYPES, RULE_IDS, runAllRules } from "./index.js";

describe("shared constants", () => {
  it("exposes the app name", () => {
    expect(APP_NAME).toBe("FuelGuard");
  });

  it("defines exactly four user roles", () => {
    expect(USER_ROLES).toHaveLength(4);
    expect(USER_ROLES).toContain("admin");
  });

  it("gates MPG rules to diesel + gasoline only (audit H1)", () => {
    expect(MPG_FUEL_TYPES).toEqual(["diesel", "gasoline"]);
  });

  it("declares all 12 anomaly rule ids", () => {
    expect(RULE_IDS).toHaveLength(19);
  });
});

describe("runAllRules stub", () => {
  it("returns no anomalies until Phase 5 implements the rules", () => {
    const result = runAllRules({
      txn: {
        id: "t1",
        vehicleId: "v1",
        driverId: "d1",
        fueledAt: "2026-06-01T12:00:00Z",
        odometer: 1000,
        gallons: 50,
        pricePerGal: 3.9,
        totalCost: 195,
      },
      vehicle: { id: "v1", fuelType: "diesel", tankCapacityGal: 120, baselineMpg: 6.4 },
      previousTxn: null,
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
    });
    expect(result).toEqual([]);
  });
});
