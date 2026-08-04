import { describe, it, expect } from "vitest";
import { planDriverMerges, type ReconcileDriver } from "./reconcile.js";

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
