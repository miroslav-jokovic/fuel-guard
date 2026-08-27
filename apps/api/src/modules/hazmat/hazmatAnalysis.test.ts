import { describe, expect, it } from "vitest";
import { evaluateLoad, type Verdict } from "@hazmat/engine";
import { loadDataset } from "@hazmat/data";
import {
  buildManualLoadInput, computeManualFlags, manualInputHash,
  type ManualLoadRow,
} from "./hazmatAnalysis.js";

const dataset = loadDataset();
const gasLoad: ManualLoadRow = {
  declared_lines: [{ hmtRef: "UN1203-gasoline#II", quantity: { value: 8000, unit: "gal" }, grossWeightLb: 50000, packagingKind: "bulk" }],
  tank_state: "loaded", carrier_relationship: "unknown", claimed_no_placards: false,
  special_permit_numbers: [], vehicle_id: null, trailer_id: null, driver_id: null, planned_pickup_at: null,
};

describe("hazmatAnalysis — manual-path decision logic (plan H4-4)", () => {
  it("builds a LoadInput the engine accepts and produces the right placard", () => {
    const v = evaluateLoad(buildManualLoadInput(gasLoad, null, dataset, "2026-07-31T00:00:00Z"));
    expect(v.placards.required.map((r) => r.placard)).toContain("FLAMMABLE");
  });

  it("FAIL-CLOSED: a not_checked verdict is flagged (never auto-cleared until H6/H8)", () => {
    const flags = computeManualFlags(
      { eligibility: { status: "not_checked", blocks: [] }, segregation: [] } as unknown as Verdict,
      dataset.provisional,
    );
    expect(flags).toContain("eligibility_not_checked");
    expect(flags.length).toBeGreaterThan(0); // ⇒ outcome "flagged" ⇒ needs_review
  });

  it("flags a provisional dataset, a blocked eligibility, and violation findings", () => {
    const blocked = { eligibility: { status: "blocked", blocks: [{ ruleId: "seg_x", tier: "violation" }] }, segregation: [{ ruleId: "segregation_prohibited", tier: "violation" }] } as unknown as Verdict;
    const flags = computeManualFlags(blocked, true);
    expect(flags).toContain("provisional_dataset");
    expect(flags).toContain("eligibility_blocked");
    expect(flags).toContain("violation:seg_x");
    expect(flags).toContain("segregation:segregation_prohibited");
  });

  it("an eligible verdict with no violations produces zero flags (green — auto-clear-eligible)", () => {
    const clean = { eligibility: { status: "eligible", blocks: [] }, segregation: [] } as unknown as Verdict;
    expect(computeManualFlags(clean, false)).toEqual([]);
  });

  it("manualInputHash is deterministic and changes when the load context changes", () => {
    const a = manualInputHash(gasLoad, "0.6.0", dataset.version);
    const b = manualInputHash(gasLoad, "0.6.0", dataset.version);
    const c = manualInputHash({ ...gasLoad, tank_state: "residue_uncleaned" }, "0.6.0", dataset.version);
    const d = manualInputHash(gasLoad, "0.7.0", dataset.version);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d); // engine-version bump changes the cache key
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
