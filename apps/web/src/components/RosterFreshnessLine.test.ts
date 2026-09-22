import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";

/**
 * The roster's freshness line (E6, D-MR2). What is worth pinning is that a STOPPED sync is said out
 * loud — on 2026-09-22 McLeod had last been read eight days earlier and no page said so — and that a
 * carrier with no McLeod is told nothing at all.
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

import RosterFreshnessLine from "@/components/RosterFreshnessLine.vue";

const NOW = new Date("2026-09-22T20:00:00Z");

const line = async (data: unknown) => {
  apiFetch.mockResolvedValue({ ok: true, data });
  const w = mount(RosterFreshnessLine, {
    global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] },
  });
  await flushPromises();
  return w;
};

describe("RosterFreshnessLine", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("reads as ordinary metadata while McLeod was read inside the hour", async () => {
    const w = await line({ configured: true, readAt: "2026-09-22T19:58:00Z", counts: null });
    const p = w.get("[data-testid=roster-freshness]");
    expect(p.text()).toContain("From McLeod, as of");
    expect(p.classes()).not.toContain("bg-caution-50");
  });

  it("says out loud when the sync has stopped", async () => {
    const w = await line({ configured: true, readAt: "2026-09-14T19:11:00Z", counts: null });
    const p = w.get("[data-testid=roster-freshness]");
    expect(p.text()).toContain("McLeod was last read");
    expect(p.text()).toContain("may be out of date");
    expect(p.classes()).toContain("bg-caution-50");
  });

  it("says so when McLeod has never been read", async () => {
    const w = await line({ configured: true, readAt: null, counts: null });
    expect(w.get("[data-testid=roster-freshness]").text()).toContain("has not been read yet");
  });

  it("says nothing for a carrier with no McLeod roster", async () => {
    const w = await line({ configured: false, readAt: null, counts: null });
    expect(w.find("[data-testid=roster-freshness]").exists()).toBe(false);
  });

  it("says nothing when the line itself cannot be fetched — the rows are still McLeod's", async () => {
    apiFetch.mockResolvedValue({ ok: false });
    const w = mount(RosterFreshnessLine, { global: { plugins: [VueQueryPlugin] } });
    await flushPromises();
    expect(w.find("[data-testid=roster-freshness]").exists()).toBe(false);
  });
});
