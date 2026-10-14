import { describe, expect, it } from "vitest";
import { reconcile, HMT_RECONCILIATIONS, type CitedReconciliation } from "./reconciliations.js";

const rule = (over: Partial<CitedReconciliation> = {}): CitedReconciliation => ({
  frDoc: "2099-00001",
  citation: "99 FR 1",
  title: "Synthetic rule",
  publishedOn: "2026-08-01",
  effectiveOn: "2026-09-01",
  rows: [{ key: "UN9999|widget", field: "pgRows[—].specialProvisions", ecfr: ["200"], govinfo: [] }],
  ...over,
});
const dates = { editionDate: "2025-10-01", ecfrDate: "2026-10-09" };
const sp200 = { field: "pgRows[—].specialProvisions", sourceA: ["200"], sourceB: [] };

describe("reconcile — a disagreement is accepted only when a cited rule explains it exactly", () => {
  it("explains a listed difference and is clean", () => {
    const r = reconcile([{ key: "UN9999|widget", fieldDiffs: [sp200] }], [rule()], dates);
    expect(r.explained).toEqual([{ key: "UN9999|widget", diff: sp200, frDoc: "2099-00001", citation: "99 FR 1" }]);
    expect(r.clean).toBe(true);
  });

  it("does not explain the same field with a different value", () => {
    const r = reconcile([{ key: "UN9999|widget", fieldDiffs: [{ ...sp200, sourceA: ["201"] }] }], [rule()], dates);
    expect(r.unexplained).toHaveLength(1);
    expect(r.clean).toBe(false);
  });

  it("does not cover a second, unlisted difference on an explained row", () => {
    const extra = { field: "hazardClass", sourceA: "3", sourceB: "9" };
    const r = reconcile([{ key: "UN9999|widget", fieldDiffs: [sp200, extra] }], [rule()], dates);
    expect(r.explained).toHaveLength(1);
    expect(r.unexplained).toEqual([{ key: "UN9999|widget", diff: extra }]);
    expect(r.clean).toBe(false);
  });

  it("lets one listed row explain one difference, not two", () => {
    const r = reconcile([{ key: "UN9999|widget", fieldDiffs: [sp200] }, { key: "UN9999|widget", fieldDiffs: [sp200] }], [rule()], dates);
    expect(r.explained).toHaveLength(1);
    expect(r.unexplained).toHaveLength(1);
    expect(r.clean).toBe(false);
  });

  it("fails on a listed row with no difference behind it (the edition caught up — delete the entry)", () => {
    const r = reconcile([], [rule()], dates);
    expect(r.unused).toHaveLength(1);
    expect(r.clean).toBe(false);
  });

  it("refuses a rule in force before the edition — it cannot be why the edition differs", () => {
    const r = reconcile([{ key: "UN9999|widget", fieldDiffs: [sp200] }], [rule({ effectiveOn: "2025-10-01" })], dates);
    expect(r.outOfWindow).toHaveLength(1);
    expect(r.unexplained).toHaveLength(1);
    expect(r.clean).toBe(false);
  });

  it("refuses a rule not yet in force on the pinned eCFR date", () => {
    const r = reconcile([{ key: "UN9999|widget", fieldDiffs: [sp200] }], [rule({ effectiveOn: "2026-12-02" })], dates);
    expect(r.outOfWindow[0]?.why).toMatch(/not yet in force/);
    expect(r.clean).toBe(false);
  });

  it("refuses every rule when the capture carries no eCFR date", () => {
    const r = reconcile([{ key: "UN9999|widget", fieldDiffs: [sp200] }], [rule()], { ...dates, ecfrDate: null });
    expect(r.outOfWindow[0]?.why).toMatch(/unknown/);
    expect(r.clean).toBe(false);
  });

  it("is clean with no disagreements and no rules", () => {
    expect(reconcile([], [], dates).clean).toBe(true);
  });

  it("the shipped list names each rule once, with dates in order", () => {
    const docs = HMT_RECONCILIATIONS.map((r) => r.frDoc);
    expect(new Set(docs).size).toBe(docs.length);
    for (const r of HMT_RECONCILIATIONS) expect(r.publishedOn < r.effectiveOn).toBe(true);
  });
});
