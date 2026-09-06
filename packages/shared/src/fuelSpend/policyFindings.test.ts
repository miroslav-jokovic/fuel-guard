import { describe, expect, it } from "vitest";
import {
  POLICY_EXCEPTION_KINDS,
  linesInMonth,
  monthBounds,
  policyFindings,
  policyFindingsReconcile,
} from "./policyFindings.js";
import { RECON_EXCEPTION_KINDS } from "./exceptions.js";
import { analyzePolicyExceptions, DEFAULT_FUEL_POLICY } from "./policyExceptions.js";
import type { SpendLine } from "./types.js";

/**
 * The default policy is `avoid_states {CA}`, `avoid_brands {one9}`, `preferred_brands {pilot,flying_j}`,
 * so every fixture below reads against the same three rules the carrier actually has configured.
 */
const fill = (o: Partial<SpendLine> & { tranDate: string; gallons: number; netAmount: number }): SpendLine => ({
  brand: "pilot",
  state: "TX",
  site: "100",
  city: "Dallas",
  unit: null,
  driver: null,
  product: "diesel",
  tank: "tractor",
  retailAmount: null,
  ...o,
});

/**
 * One month with a compliant baseline and three deliberately different populations:
 * truck 412 breaks all three rules, truck 500 went off-network and BEAT the baseline, and one
 * off-network fill carries no unit number at all.
 */
const august = (): SpendLine[] => [
  ...[1, 2, 3, 4].map((i) => fill({ tranDate: `2026-08-0${i}`, gallons: 100, netAmount: 400, unit: `10${i}` })),
  fill({ tranDate: "2026-08-05", gallons: 100, netAmount: 600, unit: "412", brand: "one9", state: "CA", site: "700", city: "Barstow" }),
  fill({ tranDate: "2026-08-19", gallons: 100, netAmount: 600, unit: "412", brand: "one9", state: "CA", site: "701", city: "Olancha" }),
  fill({ tranDate: "2026-08-07", gallons: 100, netAmount: 350, unit: "500", brand: "ta", site: "900", city: "Amarillo" }),
  fill({ tranDate: "2026-08-08", gallons: 100, netAmount: 500, unit: null, brand: "ta", site: "901", city: "Tucumcari" }),
];

describe("monthBounds", () => {
  it("gives the calendar month's inclusive ends, leap years included", () => {
    expect(monthBounds("2026-08")).toEqual({ start: "2026-08-01", end: "2026-08-31" });
    expect(monthBounds("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthBounds("2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(monthBounds("2026-12")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });

  it("refuses anything that is not a calendar month, rather than guessing one", () => {
    expect(() => monthBounds("2026-8")).toThrow(/YYYY-MM/);
    expect(() => monthBounds("2026-13")).toThrow(/calendar month/);
    expect(() => monthBounds("2026-08-01")).toThrow(/YYYY-MM/);
  });
});

describe("the close scope", () => {
  it("is disjoint from the reconciler's — neither producer may close the other's findings (0253)", () => {
    for (const k of POLICY_EXCEPTION_KINDS) expect(RECON_EXCEPTION_KINDS).not.toContain(k);
    expect([...POLICY_EXCEPTION_KINDS].sort()).toEqual([
      "avoided_brand_premium",
      "avoided_state_premium",
      "off_network_premium",
    ]);
  });
});

describe("policyFindings — the grouping Q-FUI3 fixed", () => {
  it("files one finding per truck, per kind, per month", () => {
    const { findings } = policyFindings(august(), "2026-08");
    const t412 = findings.filter((f) => f.unit === "412");
    expect(t412.map((f) => f.kind).sort()).toEqual([
      "avoided_brand_premium",
      "avoided_state_premium",
      "off_network_premium",
    ]);
    // Two fills, one row per kind — the 201-rows-is-not-201-actions problem `policyFindingsNote` names.
    expect(t412.every((f) => f.evidence.fills === 2)).toBe(true);
    expect(new Set(findings.map((f) => `${f.kind}|${f.unit}`)).size).toBe(findings.length);
  });

  it("dates the finding to the month it is about, not to a fill", () => {
    const f = policyFindings(august(), "2026-08").findings.find((x) => x.unit === "412")!;
    expect(f.occurredOn).toBe("2026-08-01");
    expect(f.evidence.periodStart).toBe("2026-08-01");
    expect(f.evidence.periodEnd).toBe("2026-08-31");
    expect(f.evidence.firstFill).toBe("2026-08-05");
    expect(f.evidence.lastFill).toBe("2026-08-19");
  });

  it("keeps the fingerprint stable across runs and distinct across truck and month (D-FX10)", () => {
    const a = policyFindings(august(), "2026-08").findings.map((f) => f.fingerprint).sort();
    const b = policyFindings([...august()].reverse(), "2026-08").findings.map((f) => f.fingerprint).sort();
    expect(b).toEqual(a);

    const september = august().map((l) => ({ ...l, tranDate: l.tranDate!.replace("2026-08", "2026-09") }));
    const sept = policyFindings(september, "2026-09").findings.map((f) => f.fingerprint);
    expect(sept.some((f) => a.includes(f))).toBe(false);
    expect(a.find((f) => f.startsWith("off_network_premium"))).toBe("off_network_premium|2026-08|412");
  });

  it("carries a facet onto the row only when every fill in the group agrees", () => {
    const f = policyFindings(august(), "2026-08").findings.find((x) => x.unit === "412")!;
    expect(f.state).toBe("CA");
    expect(f.brand).toBe("one9");
    // Barstow and Olancha — two sites in one truck-month, so the row claims neither.
    expect(f.site).toBeNull();
    expect(f.city).toBeNull();
    expect(f.evidence.sites).toEqual(["700 Barstow CA", "701 Olancha CA"]);
  });

  it("does not file a truck-month that beat the month's baseline", () => {
    const res = policyFindings(august(), "2026-08");
    expect(res.findings.some((f) => f.unit === "500")).toBe(false);
    expect(res.beneficial.off_network_premium).toEqual({ groups: 1, excess: -50 });
  });

  it("reports the excess it cannot place on a truck rather than dropping it", () => {
    const res = policyFindings(august(), "2026-08");
    expect(res.unattributed.off_network_premium).toEqual({ fills: 1, excess: 100 });
    expect(res.findings.every((f) => f.unit != null && f.unit !== "")).toBe(true);
  });

  it("files three overlapping findings for one fill, each carrying its full excess (D-FX5)", () => {
    const t412 = policyFindings(august(), "2026-08").findings.filter((f) => f.unit === "412");
    expect(t412).toHaveLength(3);
    const off = t412.find((f) => f.kind === "off_network_premium")!;
    // Every kind is priced against its OWN baseline — the fills that broke THAT rule against the ones
    // that did not — so the three are close but not equal, and adding them triples one truck's money.
    expect(off.amount).toBeCloseTo(400, 2);
    for (const f of t412) expect(f.amount).toBeGreaterThan(300);
    expect(t412.every((f) => f.amountKind === "premium")).toBe(true);
  });

  it("prices the month against the month, ignoring lines from any other one", () => {
    const withSeptember = [
      ...august(),
      // A cheap September month that would drag August's baseline down and inflate every premium.
      ...[1, 2, 3].map((i) => fill({ tranDate: `2026-09-0${i}`, gallons: 500, netAmount: 500, unit: `20${i}` })),
    ];
    expect(linesInMonth(withSeptember, "2026-08")).toHaveLength(8);
    const clean = policyFindings(august(), "2026-08").findings;
    const mixed = policyFindings(withSeptember, "2026-08").findings;
    expect(mixed.map((f) => [f.fingerprint, f.amount])).toEqual(clean.map((f) => [f.fingerprint, f.amount]));
  });

  it("files nothing for a policy the carrier has deliberately cleared", () => {
    const res = policyFindings(august(), "2026-08", { ...DEFAULT_FUEL_POLICY, avoidStates: [], avoidBrands: [] });
    expect(res.findings.some((f) => f.kind === "avoided_state_premium")).toBe(false);
    expect(res.findings.some((f) => f.kind === "avoided_brand_premium")).toBe(false);
    // Off-network is a separate rule and still applies: `preferred_brands` was not cleared.
    expect(res.findings.some((f) => f.kind === "off_network_premium")).toBe(true);
  });

  it("files nothing at all for a month with no fills, and does not throw", () => {
    const res = policyFindings([], "2026-08");
    expect(res.findings).toEqual([]);
    for (const k of POLICY_EXCEPTION_KINDS) expect(res.unattributed[k]).toEqual({ fills: 0, excess: 0 });
  });

  it("scores only tractor fuel — dyed reefer diesel is not the tractor's premium", () => {
    const reefer = [
      ...august(),
      fill({ tranDate: "2026-08-11", gallons: 200, netAmount: 2000, unit: "412", brand: "ta", tank: "reefer" }),
    ];
    const a = policyFindings(august(), "2026-08").findings.find((f) => f.kind === "off_network_premium" && f.unit === "412")!;
    const b = policyFindings(reefer, "2026-08").findings.find((f) => f.kind === "off_network_premium" && f.unit === "412")!;
    expect(b.amount).toBe(a.amount);
    expect(b.evidence.fills).toBe(2);
  });
});

/**
 * C6's Done-when, as an assertion rather than a claim: "a window that shows an off-network premium on
 * the old tab produces findings totalling the same money".
 */
describe("the ledger reconciles to the tab (C6 Done-when)", () => {
  it("accounts for every dollar the reading surface reports, across all three kinds", () => {
    const rows = policyFindingsReconcile(august(), "2026-08");
    expect(rows).toHaveLength(3);
    const tabs = analyzePolicyExceptions(linesInMonth(august(), "2026-08"));
    expect(rows.find((r) => r.kind === "off_network_premium")!.reported).toBe(tabs.offNetwork.excess);
    for (const r of rows) {
      expect(r.withinTolerance, `${r.kind} diverged by ${r.delta}`).toBe(true);
      expect(r.reported).toBeCloseTo(r.filed + r.unattributed + r.beneficial, 2);
    }
  });

  it("holds on a generated month, so the identity is a property and not a fixture", () => {
    const brands = ["pilot", "flying_j", "one9", "ta", null];
    const states = ["TX", "CA", "OK", "NM"];
    const lines: SpendLine[] = [];
    // Deterministic pseudo-random: a seeded walk, so a failure is reproducible from the test alone.
    let seed = 20260905;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 300; i += 1) {
      const day = 1 + Math.floor(next() * 28);
      lines.push(
        fill({
          tranDate: `2026-08-${String(day).padStart(2, "0")}`,
          gallons: 40 + Math.round(next() * 120),
          netAmount: 150 + Math.round(next() * 700),
          // One fill in six carries no unit, which is the population the grouping cannot place.
          unit: next() < 1 / 6 ? null : `T${1 + Math.floor(next() * 25)}`,
          brand: brands[Math.floor(next() * brands.length)]!,
          state: states[Math.floor(next() * states.length)]!,
          site: String(100 + Math.floor(next() * 20)),
        }),
      );
    }
    const rows = policyFindingsReconcile(lines, "2026-08");
    for (const r of rows) {
      expect(r.withinTolerance, `${r.kind} diverged by ${r.delta} (reported ${r.reported})`).toBe(true);
    }
    // The generator has to have produced all three populations, or the identity was never tested.
    const res = policyFindings(lines, "2026-08");
    expect(res.findings.length).toBeGreaterThan(5);
    expect(res.unattributed.off_network_premium.fills).toBeGreaterThan(0);
    expect(res.beneficial.off_network_premium.groups).toBeGreaterThan(0);
  });
});
