import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import type { SamsaraFeedHealth } from "@silvicom/shared";

/**
 * The card that answers "is our data fresh?" (SAM-S5).
 *
 * What is pinned here is not the layout — it is the two things the card exists to keep straight: a
 * bound the owner AGREED is different from one worked out from a poll interval, and a read that
 * failed must not render as a clean bill of health.
 */
const fetched = { value: null as unknown, ok: true };
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    calls.push(url);
    return fetched.ok ? { ok: true, data: fetched.value } : { ok: false, error: { message: "boom" } };
  }),
}));
const calls: string[] = [];

import FeedFreshnessCard from "./FeedFreshnessCard.vue";

const feed = (o: Partial<SamsaraFeedHealth> & { id: string }): SamsaraFeedHealth =>
  ({
    label: "Live vehicle stats", what: "Fuel level and odometer as they change.",
    cadenceMs: 1_200_000, targetMs: 3_600_000, targetSource: "ruling",
    lastSuccessAt: "2026-09-05T11:55:00.000Z", ageMinutes: 5, targetMinutes: 60, cadenceMinutes: 20,
    lastError: null, state: "fresh", targetUnreachable: false, alertable: false,
    needsAttention: false, lead: "Live vehicle stats arrived 5 minutes ago.",
    ...o,
  }) as SamsaraFeedHealth;

const render = async () => {
  const w = mount(FeedFreshnessCard);
  await flushPromises();
  return w;
};

beforeEach(() => {
  calls.length = 0;
  fetched.ok = true;
  fetched.value = { feeds: [], alerting: [], error: null };
});

describe("FeedFreshnessCard", () => {
  it("reads its own route, not the page's other ones", async () => {
    await render();
    expect(calls).toEqual(["/api/integrations/samsara/feed-freshness"]);
  });

  it("says every feed is on time when it is, with the count", async () => {
    fetched.value = { feeds: [feed({ id: "stats" }), feed({ id: "ifta", label: "IFTA" })], alerting: [], error: null };
    const w = await render();
    expect(w.text()).toContain("2/2");
    expect(w.text()).toContain("delivered inside its bound");
  });

  it("leads with the feeds that need somebody, in their own words", async () => {
    const late = feed({
      id: "ifta", label: "IFTA jurisdiction miles", state: "late", needsAttention: true,
      alertable: true, ageMinutes: 4320, targetMinutes: 2880,
      lead: "IFTA jurisdiction miles last arrived 3 days ago, past the 2 days this feed is held to.",
    });
    fetched.value = { feeds: [feed({ id: "stats" }), late], alerting: [late], error: null };
    const w = await render();
    expect(w.text()).toContain("past the 2 days this feed is held to");
    expect(w.text()).toContain("1/2");
  });

  it("marks a cadence-derived bound as such and says it raises no alert", async () => {
    const derived = feed({
      id: "odometer", label: "Daily odometer readings", targetSource: "cadence",
      state: "late", needsAttention: true, alertable: false, ageMinutes: 10_000, targetMinutes: 4320,
      lead: "Daily odometer readings last arrived 6 days ago, past the 3 days this feed is held to.",
    });
    fetched.value = { feeds: [derived], alerting: [], error: null };
    const w = await render();
    expect(w.text()).toContain("From cadence");
    expect(w.text()).toContain("No alert is sent for this one");
  });

  it("does not attach that caveat to a bound the owner agreed", async () => {
    const ruled = feed({
      id: "ifta", state: "late", needsAttention: true, alertable: true, targetSource: "ruling",
      lead: "IFTA is late.",
    });
    fetched.value = { feeds: [ruled], alerting: [ruled], error: null };
    const w = await render();
    expect(w.text()).not.toContain("No alert is sent for this one");
  });

  it("does not count a switched-off tier as something to chase", async () => {
    const off = feed({ id: "ifta", state: "disabled", needsAttention: true, targetMinutes: null, ageMinutes: null, lead: "IFTA is switched off." });
    fetched.value = { feeds: [feed({ id: "stats" }), off], alerting: [], error: null };
    const w = await render();
    expect(w.text()).toContain("delivered inside its bound");
    expect(w.text()).toContain("Switched off");
  });

  it("shows a failed read instead of a clean bill of health", async () => {
    fetched.ok = false;
    const w = await render();
    expect(w.text()).toContain("boom");
    expect(w.text()).not.toContain("delivered inside its bound");
  });

  it("shows the server's own read failure too — it arrives as a 200 with an error field", async () => {
    fetched.value = { feeds: [], alerting: [], error: "jobs read refused" };
    const w = await render();
    expect(w.text()).toContain("jobs read refused");
    expect(w.text()).not.toContain("delivered inside its bound");
  });
});
