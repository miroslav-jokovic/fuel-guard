import { describe, it, expect } from "vitest";
import { heldDriverMerges, planDriverMerges, type ReconcileDriver } from "./reconcile.js";

const d = (o: Partial<ReconcileDriver> & { id: string }): ReconcileDriver => ({
  full_name: null, samsara_driver_id: null, efs_driver_id: null, phone: null, ...o,
});

describe("planDriverMerges", () => {
  it("merges an EFS name-only source into its Samsara twin by name (annotation-stripped)", () => {
    const plans = planDriverMerges([
      d({ id: "c1", full_name: "Angel Cora", samsara_driver_id: "S1" }),
      d({ id: "s1", full_name: "ANGEL CORA COMP", efs_driver_id: "0511" }),
    ]);
    expect(plans).toEqual([{ sourceId: "s1", canonicalId: "c1", matchedBy: "name", key: "angel cora" }]);
  });

  it("prefers a phone match over name", () => {
    const plans = planDriverMerges([
      d({ id: "c1", full_name: "Different Name", samsara_driver_id: "S1", phone: "+1 (512) 555-0134" }),
      d({ id: "s1", full_name: "Whoever", phone: "512-555-0134" }),
    ]);
    expect(plans).toEqual([{ sourceId: "s1", canonicalId: "c1", matchedBy: "phone", key: "5125550134" }]);
  });

  it("does NOT merge a single-token name (e.g. 'ESTEBAN OW') — too weak", () => {
    const plans = planDriverMerges([
      d({ id: "c1", full_name: "Esteban Rodriguez", samsara_driver_id: "S1" }),
      d({ id: "s1", full_name: "ESTEBAN OW" }),
    ]);
    expect(plans).toEqual([]);
  });

  it("does NOT merge when the canonical name is ambiguous (2+ Samsara drivers share the key)", () => {
    const plans = planDriverMerges([
      d({ id: "c1", full_name: "John Smith", samsara_driver_id: "S1" }),
      d({ id: "c2", full_name: "SMITH, JOHN", samsara_driver_id: "S2" }),
      d({ id: "s1", full_name: "John Smith OW" }),
    ]);
    expect(plans).toEqual([]);
  });

  it("never targets another unmatched (source) row, and never merges canonical into canonical", () => {
    const plans = planDriverMerges([
      d({ id: "s1", full_name: "Jane Doe" }),
      d({ id: "s2", full_name: "Jane Doe" }),
    ]);
    expect(plans).toEqual([]);
  });

  it("leaves a source with no match alone", () => {
    const plans = planDriverMerges([
      d({ id: "c1", full_name: "Alice Nguyen", samsara_driver_id: "S1" }),
      d({ id: "s1", full_name: "Bob Carter" }),
    ]);
    expect(plans).toEqual([]);
  });
});

describe("a former row is never part of an automatic merge (Christopher Weaver, 2026-11-06)", () => {
  const live = d({ id: "live", full_name: "CHRISTOPHER WEAVER", status: "active" });
  const archived = d({ id: "july", full_name: "CHRISTOPHER WEAVER", samsara_driver_id: "55836857", archived_at: "2026-09-14T19:10:53Z", status: "inactive" });

  it("does not keep an archived Samsara row, and holds the pair instead", () => {
    expect(planDriverMerges([live, archived])).toEqual([]);
    expect(heldDriverMerges([live, archived])).toEqual([{ sourceId: "live", canonicalId: "july", matchedBy: "name", key: "christopher weaver" }]);
  });

  it("does not keep a terminated row either", () => {
    const terminated = { ...archived, archived_at: null, status: "terminated" };
    expect(planDriverMerges([live, terminated])).toEqual([]);
  });

  it("does not fold an archived stub away", () => {
    const stub = d({ id: "stub", full_name: "ANGEL CORA COMP", archived_at: "2026-09-14T19:10:53Z" });
    const canon = d({ id: "c1", full_name: "Angel Cora", samsara_driver_id: "S1", status: "active" });
    expect(planDriverMerges([stub, canon])).toEqual([]);
    expect(heldDriverMerges([stub, canon])).toEqual([{ sourceId: "stub", canonicalId: "c1", matchedBy: "name", key: "angel cora" }]);
  });

  it("an archived twin no longer makes a live match ambiguous — the live row is kept, nothing held", () => {
    const liveCanon = d({ id: "now", full_name: "CHRISTOPHER WEAVER", samsara_driver_id: "S9", status: "active" });
    expect(planDriverMerges([live, archived, liveCanon])).toEqual([{ sourceId: "live", canonicalId: "now", matchedBy: "name", key: "christopher weaver" }]);
    expect(heldDriverMerges([live, archived, liveCanon])).toEqual([]);
  });
});
