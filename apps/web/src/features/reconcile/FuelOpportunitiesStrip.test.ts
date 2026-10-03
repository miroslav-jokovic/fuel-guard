import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import type { FuelOpportunity } from "@silvicom/shared";
import FuelOpportunitiesStrip from "./FuelOpportunitiesStrip.vue";

/**
 * The strip's states. The ones a zero would lie about: the read failed (say so) and not loaded yet (say that),
 * against a real empty answer (say nothing is waiting, plainly). And it never adds the rows up.
 */
const opp = (o: Partial<FuelOpportunity> = {}): FuelOpportunity => ({
  kind: "contract_variance", label: "Paid above Pilot's quote", count: 3, amount: 61.5, withAmount: 3, oldest: "2026-09-02", ...o,
});

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/findings", component: { template: "<div/>" } }] });
const mountStrip = (over: Record<string, unknown> = {}) =>
  mount(FuelOpportunitiesStrip, {
    props: { rows: [opp()], loading: false, error: false, from: "2026-09-01", to: "2026-09-30", vehicleIds: [], canOpenInbox: true, ...over },
    global: { plugins: [router] },
  });

describe("FuelOpportunitiesStrip", () => {
  it("says the read failed, and never 'nothing is waiting'", () => {
    const t = mountStrip({ rows: undefined, error: true }).text();
    expect(t).toContain("Couldn't load the open findings");
    expect(t).not.toContain("Nothing is waiting");
  });

  it("says it is loading before the first answer, and says nothing is waiting only for a real empty answer", () => {
    expect(mountStrip({ rows: undefined, loading: true }).text()).toContain("Loading the open findings");
    expect(mountStrip({ rows: [] }).text()).toContain("Nothing is waiting for review in these dates.");
  });

  it("opens the findings inbox on that kind, with the page's dates and trucks", () => {
    const w = mountStrip({ vehicleIds: ["v1", "v2"] });
    const link = w.findComponent({ name: "RouterLink" });
    expect(link.props("to")).toEqual({ path: "/findings", query: { kind: "contract_variance", from: "2026-09-01", to: "2026-09-30", trucks: "v1,v2" } });
  });

  it("names the kind without a link when the inbox does not open for this caller", () => {
    const w = mountStrip({ canOpenInbox: false });
    expect(w.findComponent({ name: "RouterLink" }).exists()).toBe(false);
    expect(w.text()).toContain("Paid above Pilot's quote");
  });

  it("shows each kind's own dollars and count, and does not add the rows", () => {
    const w = mountStrip({ rows: [opp(), opp({ kind: "off_network_premium", label: "Off-network premium", count: 2, amount: 100, oldest: "2026-09-10" })] });
    const amounts = w.findAll('[data-testid="opportunity-amount"]').map((x) => x.text());
    expect(amounts).toEqual(["$62", "$100"]);
    expect(w.text()).not.toContain("$161");
    expect(w.text()).toContain("not added up");
    expect(w.text()).toContain("3 to review");
  });

  it("does not claim dollars for findings that carry none", () => {
    const t = mountStrip({ rows: [opp({ withAmount: 0, amount: 0 })] }).text();
    expect(t).toContain("no amount");
    const partial = mountStrip({ rows: [opp({ withAmount: 1, count: 3, amount: 20 })] }).text();
    expect(partial).toContain("amount on 1 of them");
  });
});
