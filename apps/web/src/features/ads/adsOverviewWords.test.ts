import { describe, it, expect } from "vitest";
import { ACTION_KINDS } from "@silvicom/shared";
import { ACTION_KIND_LABEL, ledgerWhat, needsYouLink } from "./adsOverviewWords";
import { agentShare, agentUnits } from "./adsHealthWords";

describe("the Overview's words", () => {
  it("every action kind the ledger can hold has words", () => {
    for (const k of ACTION_KINDS) expect(ACTION_KIND_LABEL[k], k).toMatch(/\S/);
  });

  it("a move is worded by where it went, read from the machine", () => {
    expect(ledgerWhat({ kind: "transition", from_state: "review", event: "creatives_approved" })).toBe("Waiting for review → Approved");
    expect(ledgerWhat({ kind: "transition", from_state: "plan_review", event: "plan_approved" })).toBe("Plan waiting for review → Making the ads");
    // The kill switch's no-op leaves the state where it was: the event is named, not a move to itself.
    expect(ledgerWhat({ kind: "transition", from_state: "draft", event: "kill" })).toBe("Starting (kill)");
    expect(ledgerWhat({ kind: "launch", from_state: null, event: null })).toBe("Launched");
  });

  it("a campaign row opens its drawer; the rest open Settings only for someone who may open it", () => {
    expect(needsYouLink({ campaign_id: "k1" }, false)).toEqual({ path: "/ads/campaigns", query: { campaign: "k1" } });
    expect(needsYouLink({ campaign_id: null }, true)).toEqual({ path: "/ads/settings" });
    expect(needsYouLink({ campaign_id: null }, false)).toBeNull();
  });
});

describe("the Automation tab's words", () => {
  it("in shape is a share of the calls that reached the model, with its counts", () => {
    expect(agentShare({ in_shape_share: 0.75, in_shape: 3, failed: 1 })).toBe("75% (3 of 4)");
    expect(agentShare({ in_shape_share: null, in_shape: 0, failed: 0 })).toBe("—");
  });

  it("units stay in the ledger's own unit", () => {
    expect(agentUnits({ cost_units: 12_000, cost_unit: "tokens" })).toBe("12,000 tokens");
    expect(agentUnits({ cost_units: 0, cost_unit: null })).toBe("—");
  });
});
