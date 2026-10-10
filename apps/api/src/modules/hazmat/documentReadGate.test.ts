import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { shippingDocumentReadGate } from "./documentReadGate.js";

/** Step 1.6: a shipping-document read passes the Hazmat Calculator's gate, read as executeExtraction reads it. */
const ORG = "org-1";
const gate = async (enabled: boolean, policy: unknown) => {
  const rec = createSupabaseRecorder({
    rpc: { org_module_enabled: enabled },
    tables: { hazmat_policies: policy === undefined ? [] : [{ policy }] },
  });
  const g = await shippingDocumentReadGate(rec.client, ORG);
  return { g, rec };
};

describe("shippingDocumentReadGate", () => {
  it("is open with no budget when the org is entitled and has no stored policy", async () => {
    const { g, rec } = await gate(true, undefined);
    expect(g).toEqual({ open: true, monthlyTokenBudget: null });
    expectOrgScoped(rec, ORG);
    expect(rec.rpcs()).toEqual([{ fn: "org_module_enabled", args: { p_org: ORG, p_module: "hazmatguard" } }]);
  });
  it("is shut when HazmatGuard is not entitled", async () => {
    expect((await gate(false, {})).g.open).toBe(false);
  });
  it("is shut only by an explicit extractionEnabled: false — the extractor's reading", async () => {
    expect((await gate(true, { extractionEnabled: false })).g.open).toBe(false);
    expect((await gate(true, { extractionEnabled: true })).g.open).toBe(true);
  });
  it("carries the org's monthly token budget", async () => {
    expect((await gate(true, { extractionMonthlyTokenBudget: 250_000 })).g.monthlyTokenBudget).toBe(250_000);
  });
});
