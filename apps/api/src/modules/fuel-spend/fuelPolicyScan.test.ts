import { describe, it, expect } from "vitest";
import { POLICY_EXCEPTION_KINDS } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { monthsTouched, runFuelPolicyScan, runFuelPolicyScanForWindow } from "./fuelPolicyScan.js";

/**
 * The server side of the policy scan. The arithmetic is `policyFindings`, tested in
 * `packages/shared`; what is only testable here is everything that makes the scan a PRODUCER rather
 * than a report:
 *
 *   • it reads the org's own fills and nothing else — `admin` is the service role and bypasses RLS;
 *   • it reads the WHOLE calendar month, whatever window the caller was sweeping, because the month
 *     is the unit its baseline is measured over;
 *   • it declares its own period and its own close scope, because it has no `fuel_recon_runs` row.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** What `fuel_spend_lines` returns, in the RPC's own column names. */
const row = (o: Record<string, unknown> = {}) => ({
  tran_date: "2026-08-05", brand: "pilot", state: "TX", site: "436", city: "Amarillo",
  unit: "701", driver: null, tank: "tractor", gallons: 100, net_amount: 400,
  retail_amount: null, contract_amount: null, quote_stale_days: null, ...o,
});

/** Four compliant fills set the month's baseline at $4.00/gal; truck 412 breaks all three rules. */
const AUGUST = [
  row({ unit: "101" }), row({ unit: "102" }), row({ unit: "103" }), row({ unit: "104" }),
  row({ unit: "412", brand: "one9", state: "CA", city: "Barstow", site: "700", net_amount: 600 }),
];

const seed = (opts: { lines?: unknown[]; settings?: unknown; sync?: unknown } = {}) => {
  const seenPages = new Map<string, number>();
  return createSupabaseRecorder({
    tables: { route_fuel_settings: { data: opts.settings ?? { avoid_states: null, avoid_brands: null, preferred_brands: null } } },
    rpc: (fn, args) => {
      if (fn === "sync_fuel_exceptions") {
        return opts.sync ?? [{ inserted: 3, refreshed: 0, closed: 1 }];
      }
      if (fn === "fuel_spend_lines") {
        // `eachPage` stops on a short page, so one page of rows ends the loop.
        const key = JSON.stringify(args);
        const n = seenPages.get(key) ?? 0;
        seenPages.set(key, n + 1);
        return n === 0 ? (opts.lines ?? AUGUST) : [];
      }
      return null;
    },
  });
};

const syncArgs = (rec: ReturnType<typeof seed>) =>
  rec.rpcs().find((c) => c.fn === "sync_fuel_exceptions")?.args as Record<string, unknown>;

describe("monthsTouched", () => {
  it("returns the calendar months a window covers, oldest first", () => {
    expect(monthsTouched("2026-08-05", "2026-08-28")).toEqual(["2026-08"]);
    expect(monthsTouched("2026-08-25", "2026-09-08")).toEqual(["2026-08", "2026-09"]);
    expect(monthsTouched("2026-12-28", "2027-01-11")).toEqual(["2026-12", "2027-01"]);
    expect(monthsTouched("2026-01-01", "2026-03-31")).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("is capped, so a mistyped range cannot scan a decade one month at a time", () => {
    expect(monthsTouched("2016-01-01", "2026-01-01")).toHaveLength(12);
    expect(monthsTouched("2026-01-01", "2026-12-31", 3)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
});

describe("runFuelPolicyScan", () => {
  it("files a finding per truck, per kind, for the month", async () => {
    const rec = seed();
    const r = await runFuelPolicyScan(rec.client, ORG, "2026-08");
    expect(r.error).toBeNull();
    // Truck 412 is at ONE9, in California, off the preferred network — three kinds, one truck-month.
    expect(r.filed).toBe(3);
    expect(r.closed).toBe(1);
    const findings = syncArgs(rec).p_findings as { kind: string; unit: string; occurredOn: string }[];
    expect(findings.map((f) => f.kind).sort()).toEqual([
      "avoided_brand_premium", "avoided_state_premium", "off_network_premium",
    ]);
    expect(findings.every((f) => f.unit === "412" && f.occurredOn === "2026-08-01")).toBe(true);
  });

  it("declares its own period and its own close scope, because it has no reconciliation run (0320)", async () => {
    const rec = seed();
    await runFuelPolicyScan(rec.client, ORG, "2026-08");
    const a = syncArgs(rec);
    expect(a.p_run).toBeNull();
    expect(a.p_period_start).toBe("2026-08-01");
    expect(a.p_period_end).toBe("2026-08-31");
    // Passed from shared beside the producer that emits it. A literal here is how a producer ends up
    // closing findings it does not own — the failure 0253's header describes.
    expect(a.p_kinds).toEqual(POLICY_EXCEPTION_KINDS);
    expect(a.p_kinds).not.toContain("recon_amount");
  });

  it("reads the whole calendar month, not the window the sweep happened to be on", async () => {
    const rec = seed();
    await runFuelPolicyScanForWindow(rec.client, ORG, "2026-08-25", "2026-09-08");
    const ranges = rec.rpcs().filter((c) => c.fn === "fuel_spend_lines")
      .map((c) => [(c.args as Record<string, unknown>).p_from, (c.args as Record<string, unknown>).p_to]);
    // Both months whole — never 08-25 → 09-08, which would price August against six days of it.
    expect(ranges).toContainEqual(["2026-08-01", "2026-08-31"]);
    expect(ranges).toContainEqual(["2026-09-01", "2026-09-30"]);
    expect(ranges.some(([f]) => f === "2026-08-25")).toBe(false);
  });

  it("takes the whole fleet's month, because narrowing it would narrow the baseline too", async () => {
    const rec = seed();
    await runFuelPolicyScan(rec.client, ORG, "2026-08");
    const call = rec.rpcs().find((c) => c.fn === "fuel_spend_lines")!.args as Record<string, unknown>;
    expect(call.p_vehicles).toBeNull();
    expect(call.p_org).toBe(ORG);
  });

  it("scopes every query it makes to one organization", async () => {
    // The service role bypasses RLS. Without these filters the scan would price one carrier's fuel
    // against another's — the leak `fuel_spend_lines` had before 0247's D-FC1.
    const rec = seed();
    await runFuelPolicyScan(rec.client, ORG, "2026-08");
    expectOrgScoped(rec, ORG);
  });

  it("honours a policy the carrier deliberately cleared, rather than the built-in default", async () => {
    const rec = seed({ settings: { avoid_states: [], avoid_brands: [], preferred_brands: ["pilot", "flying_j"] } });
    const r = await runFuelPolicyScan(rec.client, ORG, "2026-08");
    const kinds = (syncArgs(rec).p_findings as { kind: string }[]).map((f) => f.kind);
    expect(kinds).toEqual(["off_network_premium"]);
    expect(r.filed).toBe(1);
  });

  it("reports the RPC's failure instead of throwing it into the nightly sweep", async () => {
    const rec = seed({ sync: { error: { message: "FE012" } } });
    const r = await runFuelPolicyScan(rec.client, ORG, "2026-08");
    expect(r.error).toBe("FE012");
    expect(r.inserted).toBe(0);
    // The findings were still produced — the ledger lost an entry, the sweep did not lose the org.
    expect(r.filed).toBe(3);
  });

  it("accounts for the money it could not file, so the ledger reconciles to the tab", async () => {
    const rec = seed({
      lines: [
        ...AUGUST,
        // No unit number: real money, unplaceable on a truck.
        row({ unit: null, brand: "ta", net_amount: 500 }),
        // Off-network and CHEAPER than the month's baseline: not a finding, still in the tab's total.
        row({ unit: "500", brand: "ta", net_amount: 350 }),
      ],
    });
    const r = await runFuelPolicyScan(rec.client, ORG, "2026-08");
    expect(r.unplaced.off_network_premium.fills).toBe(1);
    expect(r.unplaced.off_network_premium.excess).toBeGreaterThan(0);
    expect(r.beneficial.off_network_premium.groups).toBe(1);
    expect(r.beneficial.off_network_premium.excess).toBeLessThan(0);
    expect((syncArgs(rec).p_findings as { unit: string }[]).every((f) => f.unit === "412")).toBe(true);
  });

  it("files nothing for a month with no fills, and still states the period it looked at", async () => {
    const rec = seed({ lines: [] });
    const r = await runFuelPolicyScan(rec.client, ORG, "2026-08");
    expect(r.filed).toBe(0);
    expect(syncArgs(rec).p_findings).toEqual([]);
    // The empty batch still carries the window, which is what lets the RPC close a month that has
    // been corrected to nothing. An empty scan that stated no period would close nothing, forever.
    expect(syncArgs(rec).p_period_start).toBe("2026-08-01");
  });
});
