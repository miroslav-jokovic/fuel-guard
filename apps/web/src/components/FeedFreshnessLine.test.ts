import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FeedFreshnessLine from "./FeedFreshnessLine.vue";

/**
 * FUEL-T5 / A7 — a page of vendor rows says when it last heard from the vendor.
 *
 * Transactions and Rejections render EFS's own records, so neither can show a WRONG row — only a
 * missing one, and a stopped poller reads exactly like a quiet week. The wording is
 * `describeFeedFreshness`, tested in `packages/shared`; what is testable here is which feed this
 * instance speaks for, when it draws attention to itself, and what it does when it cannot tell.
 */

const fetched = { ok: true, data: null as Record<string, unknown> | null };
const apiFetch = vi.fn(async () =>
  fetched.ok ? { ok: true, data: fetched.data } : { ok: false, error: { message: "nope" } },
);
vi.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...(a as [])) }));

const feed = (o: Record<string, unknown> = {}) => ({
  feed: "posted", lastSuccessAt: "2026-09-02T11:56:00Z", ageMinutes: 4, cadenceMinutes: 15,
  neverCollected: false, failing: false, late: false, needsAttention: false,
  lead: "Completed fuel purchases last arrived 4 minutes ago.", ...o,
});

const mountFor = async (f: "posted" | "rejected") => {
  const w = mount(FeedFreshnessLine, { props: { feed: f } });
  await flushPromises();
  return w;
};

beforeEach(() => {
  apiFetch.mockClear();
  fetched.ok = true;
  fetched.data = {
    posted: feed(),
    rejected: feed({ feed: "rejected", cadenceMinutes: 5, lead: "Declined card attempts last arrived 2 minutes ago." }),
  };
});

describe("FeedFreshnessLine", () => {
  it("prints the line for the feed it was asked about, not the other one", async () => {
    expect((await mountFor("posted")).text()).toContain("Completed fuel purchases last arrived 4 minutes ago.");
    expect((await mountFor("rejected")).text()).toContain("Declined card attempts last arrived 2 minutes ago.");
    expect((await mountFor("rejected")).text()).not.toContain("Completed fuel purchases");
  });

  // A feed that delivered four minutes ago is metadata, not an alert. Touching every freshness line
  // with the caution colour is how a caution colour stops meaning anything.
  it("tones only a feed that needs attention", async () => {
    const healthy = await mountFor("posted");
    expect(healthy.html()).not.toContain("bg-caution-50");

    fetched.data = { posted: feed({ late: true, needsAttention: true, lead: "…is missing from this list…" }), rejected: feed() };
    const late = await mountFor("posted");
    expect(late.html()).toContain("bg-caution-50");
  });

  it("draws attention to a refused feed and to one never collected, not only to a late one", async () => {
    for (const s of [{ failing: true }, { neverCollected: true }]) {
      fetched.data = { posted: feed({ ...s, needsAttention: true }), rejected: feed() };
      expect((await mountFor("posted")).html()).toContain("bg-caution-50");
    }
  });

  // The rows below are still the vendor's rows. A freshness line that cannot load says nothing, which
  // is exactly what it said before this component existed — an error banner here would be a worse page.
  it("says nothing at all when it cannot read the freshness, rather than erroring over the rows", async () => {
    fetched.ok = false;
    const w = await mountFor("posted");
    expect(w.text()).toBe("");
    expect(w.html()).not.toContain("bg-caution-50");
  });

  it("asks the API once, for the fuel-section route rather than the admin integration one", async () => {
    await mountFor("posted");
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/api/fueling/feed-freshness");
  });
});
