import { describe, it, expect } from "vitest";
import { CONTRACT_EXCEPTION_KINDS, MIN_CONTRACT_OVERBILL_USD, POLICY_EXCEPTION_KINDS, RECON_EXCEPTION_KINDS } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { runFuelContractScan } from "./fuelContractScan.js";

/**
 * The contract scan as a PRODUCER (Q-FSV15 ruling 4). Whether a fill is over its quote is
 * `analyzeContractCapture`, tested in `packages/shared`; what only a test here can pin is which of those
 * fills become work, that the scan closes only what it files, and that it reads one organization.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** What `fuel_spend_lines` returns, in the RPC's own column names; billed 500 against a 500 quote by default. */
const row = (o: Record<string, unknown> = {}) => ({
  tran_date: "2026-09-20", brand: "pilot", state: "TX", site: "436", city: "Amarillo", unit: "701", driver: null,
  tank: "tractor", gallons: 100, net_amount: 500, retail_amount: 560, contract_amount: 500, quote_stale_days: 0, ...o,
});

const LINES = [
  row({ unit: "701", net_amount: 520 }), // $20 over: filed
  row({ unit: "702", net_amount: 503 }), // $3 over: cents-and-rounding territory, under the floor
  row({ unit: "703", net_amount: 470 }), // under its quote: not a claim
  row({ unit: "704", contract_amount: null, retail_amount: null }), // never quoted: unmeasured, not clean
];

const seed = (lines: unknown[] = LINES) => {
  const seen = new Set<string>();
  return createSupabaseRecorder({
    tables: {},
    rpc: (fn, args) => {
      if (fn === "sync_fuel_exceptions") return [{ inserted: 1, refreshed: 0, closed: 0 }];
      if (fn === "fuel_spend_lines") {
        const key = JSON.stringify(args);
        const first = !seen.has(key);
        seen.add(key);
        return first ? lines : []; // `eachPage` stops on a short page
      }
      return null;
    },
  });
};

const sync = (rec: ReturnType<typeof seed>) =>
  rec.rpcs().find((c) => c.fn === "sync_fuel_exceptions")!.args as Record<string, unknown>;

describe("runFuelContractScan", () => {
  it("files only the fills billed at least the floor above their quote", async () => {
    const rec = seed();
    const r = await runFuelContractScan(rec.client, ORG, "2026-09-06", "2026-09-20");
    expect(r.error).toBeNull();
    expect(r.filed).toBe(1);
    const f = sync(rec).p_findings as { kind: string; unit: string; amount: number; amountKind: string }[];
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "contract_variance", unit: "701", amount: 20, amountKind: "overbilled" });
    expect(MIN_CONTRACT_OVERBILL_USD).toBe(5);
  });

  it("closes only contract findings, in the window it read", async () => {
    const rec = seed();
    await runFuelContractScan(rec.client, ORG, "2026-09-06", "2026-09-20");
    const a = sync(rec);
    expect(a.p_run).toBeNull();
    expect(a.p_period_start).toBe("2026-09-06");
    expect(a.p_period_end).toBe("2026-09-20");
    // Its own constant. Reusing a sibling's would close that producer's findings; this producer's
    // kind inside another's scope would be closed by a night with no quotes.
    expect(a.p_kinds).toEqual(CONTRACT_EXCEPTION_KINDS);
    for (const k of [...RECON_EXCEPTION_KINDS, ...POLICY_EXCEPTION_KINDS]) expect(a.p_kinds).not.toContain(k);
  });

  it("still syncs when nothing is over the floor, so yesterday's findings can close", async () => {
    const rec = seed([row({ net_amount: 500 })]);
    const r = await runFuelContractScan(rec.client, ORG, "2026-09-06", "2026-09-20");
    expect(r.filed).toBe(0);
    expect(sync(rec).p_findings).toEqual([]);
  });

  it("reads the whole fleet for one organization", async () => {
    const rec = seed();
    await runFuelContractScan(rec.client, ORG, "2026-09-06", "2026-09-20");
    const call = rec.rpcs().find((c) => c.fn === "fuel_spend_lines")!.args as Record<string, unknown>;
    expect(call.p_vehicles).toBeNull();
    expect(call.p_org).toBe(ORG);
    expectOrgScoped(rec, ORG);
  });

  it("reports a failed sync instead of throwing, so one org cannot stop the sweep", async () => {
    const rec = createSupabaseRecorder({
      tables: {},
      rpc: (fn) => (fn === "sync_fuel_exceptions" ? { error: { message: "boom" } } : []),
    });
    const r = await runFuelContractScan(rec.client, ORG, "2026-09-06", "2026-09-20");
    expect(r.error).toBe("boom");
    expect(r.inserted).toBe(0);
  });
});
