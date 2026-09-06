import { describe, it, expect } from "vitest";
import { buildFuelTieOut, OWNER_OPERATOR_FUEL_GLID } from "./fuelTieOut.js";

const line = (item: string | null, amount: number, unit: string | null = "101") => ({ item, amount, unit });

describe("buildFuelTieOut — the FUEL drift decomposed (D-FIN12)", () => {
  it("maps each product to its posting account and sizes the residual per account", () => {
    const t = buildFuelTieOut({
      lines: [line("ULSD", 900), line("DEFD", 50), line("ULSR", 6), line("SCLE", 5), line("ulsd", 100)],
      ownerOperatorUnits: new Set(),
      glTotals: [
        { glid: "40050000", descr: "Fuel for Hired Vehicles", net_amount: 995 },
        { glid: "30220000", descr: "DEF", net_amount: 50 },
        { glid: "30340000", descr: "Reefer Fuel", net_amount: 6 },
        { glid: "40760000", descr: "Scales", net_amount: 5 },
      ],
    });
    const diesel = t.rows.find((r) => r.glid === "40050000")!;
    expect(diesel).toMatchObject({ gl: 995, efs: 1000, residual: -5, label: "Fuel for Hired Vehicles" });
    expect(t.rows.find((r) => r.glid === "30220000")).toMatchObject({ gl: 50, efs: 50, residual: 0 });
    expect(t.totals).toMatchObject({ efsMapped: 1061, efsUnmapped: 0, efsOwnerOperator: 0, gl: 1056, residual: -5 });
    expect(t.unmapped).toEqual([]);
  });

  it("routes an owner-operator truck's fuel to the asset account, never to expense", () => {
    const t = buildFuelTieOut({
      lines: [line("ULSD", 900, "101"), line("ULSD", 300, "999"), line("DEFD", 20, "999")],
      ownerOperatorUnits: new Set(["999"]),
      glTotals: [
        { glid: "40050000", descr: "Fuel for Hired Vehicles", net_amount: 900 },
        { glid: OWNER_OPERATOR_FUEL_GLID, descr: "Fuel Advance", net_amount: 320 },
      ],
    });
    expect(t.rows.find((r) => r.glid === "40050000")).toMatchObject({ efs: 900, residual: 0 });
    expect(t.rows.find((r) => r.glid === OWNER_OPERATOR_FUEL_GLID)).toMatchObject({ efs: 320, gl: 320, residual: 0 });
    expect(t.totals.efsOwnerOperator).toBe(320);
    expect(t.ownerOperatorUnits).toBe(1);
  });

  it("lists an item code no rule names instead of folding it into an account", () => {
    const t = buildFuelTieOut({
      lines: [line("ULSD", 100), line("WWFL", 8.25), line("WWFL", 1.75), line(null, 3)],
      ownerOperatorUnits: new Set(),
      glTotals: [{ glid: "40050000", descr: null, net_amount: 100 }],
    });
    expect(t.unmapped).toEqual([
      { item: "WWFL", amount: 10, lines: 2 },
      { item: "(blank)", amount: 3, lines: 1 },
    ]);
    expect(t.totals.efsUnmapped).toBe(13);
    expect(t.rows.find((r) => r.glid === "40050000")!.label).toBe("Fuel for Hired Vehicles — tractor diesel"); // the rule's label when the chart has no name
  });

  it("shows a FUEL-module account no rule names, so a new posting account cannot hide", () => {
    const t = buildFuelTieOut({
      lines: [],
      ownerOperatorUnits: new Set(),
      glTotals: [{ glid: "20550000", descr: "Fuel Payable", net_amount: -1000 }],
    });
    const payable = t.rows.find((r) => r.glid === "20550000")!;
    expect(payable).toMatchObject({ gl: -1000, efs: 0, residual: -1000, items: [] });
  });

  it("an account with no GL row this month reads null, not zero — the ledger did not say", () => {
    const t = buildFuelTieOut({ lines: [line("DEFD", 40)], ownerOperatorUnits: new Set(), glTotals: [] });
    const def = t.rows.find((r) => r.glid === "30220000")!;
    expect(def.gl).toBeNull();
    expect(def.residual).toBeNull();
    expect(def.efs).toBe(40);
  });
});
