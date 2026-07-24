import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileCardMultiForOrg } from "./cardMultiReconcile.js";

const CASE_ID = "case-1";
const TXN = "txn-1";

interface Scenario {
  assignments: { vehicle_samsara_id: string; driver_samsara_id: string; start_at: string; end_at: string | null }[];
  updated: { id: string; patch: Record<string, unknown> }[];
}

/** Fake covering exactly the reads/writes reconcileCardMultiForOrg makes for one card-multi case. */
function fake(scn: Scenario): SupabaseClient {
  const anomaliesCase = {
    id: CASE_ID,
    transaction_id: TXN,
    evidence: { signals: [{ ruleId: "card_multi_vehicle" }, { ruleId: "cumulative_overfuel" }] },
  };
  const vehicles = [
    { id: "vA", samsara_vehicle_id: "SVA" },
    { id: "vB", samsara_vehicle_id: "SVB" },
  ];
  // WP3: fills are matched by TRUE card identity (sameCardFill) — the fixture uses a realistic PAN and
  // carries id/card_ref/control_id, exactly the columns the reconciler now reads.
  const caseTxn = { card_ref: "7083050030281910009", control_id: null, fueled_at: "2026-07-20T12:00:00Z" };
  const cardFills = [
    { id: "f1", card_ref: "7083050030281910009", control_id: null, vehicle_id: "vA", fueled_at: "2026-07-20T08:00:00Z" },
    { id: "f2", card_ref: "7083050030281910009", control_id: null, vehicle_id: "vB", fueled_at: "2026-07-20T12:00:00Z" },
  ];

  const b = (opts: { single?: unknown; list?: unknown; onUpdate?: (patch: unknown) => void }) => {
    let patch: Record<string, unknown> | null = null;
    let idEq: string | null = null;
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (col: string, val: string) => {
      if (col === "id") idEq = val;
      return q;
    };
    q.gte = () => q;
    q.lte = () => q;
    q.maybeSingle = async () => ({ data: opts.single ?? null, error: null });
    q.update = (p: Record<string, unknown>) => {
      patch = p;
      return q;
    };
    (q as { then: unknown }).then = (resolve: (v: unknown) => unknown) => {
      if (patch && idEq) opts.onUpdate?.({ id: idEq, patch });
      return resolve({ data: opts.list ?? [], error: null });
    };
    return q;
  };

  let txnCallCount = 0;
  return {
    from: (table: string) => {
      if (table === "anomalies")
        return b({ list: [anomaliesCase], onUpdate: (u) => scn.updated.push(u as { id: string; patch: Record<string, unknown> }) });
      if (table === "vehicles") return b({ list: vehicles });
      if (table === "driver_vehicle_assignments") return b({ list: scn.assignments });
      if (table === "fuel_transactions") {
        // First fuel_transactions access is the case txn (maybeSingle); second is the card fills (list).
        txnCallCount += 1;
        return txnCallCount === 1 ? b({ single: caseTxn }) : b({ list: cardFills });
      }
      return b({});
    },
  } as unknown as SupabaseClient;
}

describe("reconcileCardMultiForOrg", () => {
  it("auto-dismisses when Samsara shows the SAME driver moved between both trucks", async () => {
    const scn: Scenario = {
      assignments: [
        { vehicle_samsara_id: "SVA", driver_samsara_id: "D1", start_at: "2026-07-19T00:00:00Z", end_at: null },
        { vehicle_samsara_id: "SVB", driver_samsara_id: "D1", start_at: "2026-07-19T00:00:00Z", end_at: null },
      ],
      updated: [],
    };
    const cleared = await reconcileCardMultiForOrg(fake(scn), "org-1");
    expect(cleared).toBe(1);
    expect(scn.updated).toHaveLength(1);
    expect(scn.updated[0]!.patch.status).toBe("dismissed");
    expect(scn.updated[0]!.patch.disposition).toBe("benign_explained");
  });

  it("leaves the case OPEN when two DIFFERENT drivers held the trucks", async () => {
    const scn: Scenario = {
      assignments: [
        { vehicle_samsara_id: "SVA", driver_samsara_id: "D1", start_at: "2026-07-19T00:00:00Z", end_at: null },
        { vehicle_samsara_id: "SVB", driver_samsara_id: "D2", start_at: "2026-07-19T00:00:00Z", end_at: null },
      ],
      updated: [],
    };
    const cleared = await reconcileCardMultiForOrg(fake(scn), "org-1");
    expect(cleared).toBe(0);
    expect(scn.updated).toHaveLength(0);
  });

  it("leaves the case OPEN when a truck has no Samsara assignment (can't explain)", async () => {
    const scn: Scenario = {
      assignments: [
        { vehicle_samsara_id: "SVA", driver_samsara_id: "D1", start_at: "2026-07-19T00:00:00Z", end_at: null },
      ],
      updated: [],
    };
    const cleared = await reconcileCardMultiForOrg(fake(scn), "org-1");
    expect(cleared).toBe(0);
    expect(scn.updated).toHaveLength(0);
  });
});
