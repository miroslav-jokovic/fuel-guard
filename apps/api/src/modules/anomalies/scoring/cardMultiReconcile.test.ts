import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileCardMultiForOrg } from "./cardMultiReconcile.js";

const CASE_ID = "case-1";
const TXN = "txn-1";

interface Scenario {
  assignments: { vehicle_samsara_id: string; driver_samsara_id: string; start_at: string; end_at: string | null }[];
  updated: { id: string; patch: Record<string, unknown> }[];
  /** Q-FUI16: the fills' OWN driver attribution, per fill id. Absent = the column is null. */
  fillDrivers?: Record<string, string | null>;
  /** Q-FUI16: roster rows carrying a Samsara id, which put both sources in one identity space. */
  drivers?: { id: string; samsara_driver_id: string | null }[];
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
    { id: "f1", card_ref: "7083050030281910009", control_id: null, vehicle_id: "vA", fueled_at: "2026-07-20T08:00:00Z", driver_id: scn.fillDrivers?.f1 ?? null },
    { id: "f2", card_ref: "7083050030281910009", control_id: null, vehicle_id: "vB", fueled_at: "2026-07-20T12:00:00Z", driver_id: scn.fillDrivers?.f2 ?? null },
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
      if (table === "drivers") return b({ list: scn.drivers ?? [] });
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

  it("leaves the case OPEN when a truck has no Samsara assignment AND the fill names no driver", async () => {
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

/**
 * Q-FUI16 (owner ruling, 2026-09-05). Samsara's assignment history begins 2026-04-14, so 10 of the 17
 * open card_multi_vehicle cases resolved NO Samsara driver for ANY fill and could never clear. The
 * fill's own driver attribution now answers where Samsara is silent — and, because this widens an
 * auto-DISMISS path, these pin BOTH that it clears the benign case and that it still refuses every
 * shape it should.
 */
describe("reconcileCardMultiForOrg — the fill-attribution fallback", () => {
  const note = (scn: Scenario) => String(scn.updated[0]!.patch.resolution_note);

  it("clears on the fills' own driver when Samsara holds no assignment, and says so in the note", async () => {
    const scn: Scenario = {
      assignments: [],
      fillDrivers: { f1: "driver-7", f2: "driver-7" },
      updated: [],
    };
    expect(await reconcileCardMultiForOrg(fake(scn), "org-1")).toBe(1);
    expect(scn.updated[0]!.patch.disposition).toBe("benign_explained");
    // The weaker source must be visible to a reviewer auditing this path, not merely implied.
    expect(note(scn)).toMatch(/Samsara held no driver assignment/);
  });

  it("refuses when the fills' own drivers DISAGREE — two people, not one moving trucks", async () => {
    const scn: Scenario = {
      assignments: [],
      fillDrivers: { f1: "driver-7", f2: "driver-9" },
      updated: [],
    };
    expect(await reconcileCardMultiForOrg(fake(scn), "org-1")).toBe(0);
    expect(scn.updated).toHaveLength(0);
  });

  it("refuses when only ONE of the two fills names a driver and Samsara cannot cover the other", async () => {
    const scn: Scenario = {
      assignments: [],
      fillDrivers: { f1: "driver-7" },
      updated: [],
    };
    expect(await reconcileCardMultiForOrg(fake(scn), "org-1")).toBe(0);
  });

  it("keeps Samsara's answer where it HAS one, so a contradicting fill attribution cannot clear a case", async () => {
    // Samsara says D1 drove vA; the fill claims someone else. Samsara wins, vB falls back to the fill,
    // the two keys differ, and the case stays open — a disagreement is never resolved in favour of the
    // weaker source.
    const scn: Scenario = {
      assignments: [
        { vehicle_samsara_id: "SVA", driver_samsara_id: "D1", start_at: "2026-07-19T00:00:00Z", end_at: null },
      ],
      drivers: [{ id: "driver-1", samsara_driver_id: "D1" }],
      fillDrivers: { f1: "driver-9", f2: "driver-9" },
      updated: [],
    };
    expect(await reconcileCardMultiForOrg(fake(scn), "org-1")).toBe(0);
  });

  it("treats a Samsara driver and a fill's driver as ONE person when the roster maps them", async () => {
    // The identity-space bug this guards: without drivers.samsara_driver_id, "D1" and "driver-1" are
    // two entries in the Set and a plainly benign case is refused forever.
    const scn: Scenario = {
      assignments: [
        { vehicle_samsara_id: "SVA", driver_samsara_id: "D1", start_at: "2026-07-19T00:00:00Z", end_at: null },
      ],
      drivers: [{ id: "driver-1", samsara_driver_id: "D1" }],
      fillDrivers: { f1: "driver-1", f2: "driver-1" },
      updated: [],
    };
    expect(await reconcileCardMultiForOrg(fake(scn), "org-1")).toBe(1);
    expect(note(scn)).toMatch(/Samsara held no driver assignment/);
  });

  it("keeps the original note when Samsara alone explains the case", async () => {
    const scn: Scenario = {
      assignments: [
        { vehicle_samsara_id: "SVA", driver_samsara_id: "D1", start_at: "2026-07-19T00:00:00Z", end_at: null },
        { vehicle_samsara_id: "SVB", driver_samsara_id: "D1", start_at: "2026-07-19T00:00:00Z", end_at: null },
      ],
      fillDrivers: { f1: "driver-7", f2: "driver-7" },
      updated: [],
    };
    expect(await reconcileCardMultiForOrg(fake(scn), "org-1")).toBe(1);
    expect(note(scn)).toMatch(/^Auto-cleared: Samsara shows the same driver/);
  });
});
