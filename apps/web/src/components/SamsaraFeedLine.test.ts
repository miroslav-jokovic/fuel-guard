import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import type { SamsaraFeedId, SamsaraFeedPulse } from "@silvicom/shared";
import SamsaraFeedLine from "./SamsaraFeedLine.vue";

/**
 * SAM-S5 bullet 3 — a page built on a Samsara tier says how current that tier is.
 *
 * The wording and the ranking are `describeSamsaraFeeds` / `worstSamsaraFeed` in `packages/shared`,
 * tested there. What is only testable HERE is what this instance is FOR: which feeds it speaks for,
 * that it speaks at all when nothing is wrong, when it raises its voice, and what it does when it
 * cannot tell — which on six pages that only quote it is "nothing", never an error.
 */

const fetched = { ok: true, feeds: [] as SamsaraFeedPulse[] };
const apiFetch = vi.fn(async () =>
  fetched.ok ? { ok: true, data: { feeds: fetched.feeds } } : { ok: false, error: { message: "nope" } },
);
vi.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...(a as [])) }));

const pulse = (id: SamsaraFeedId, o: Partial<SamsaraFeedPulse> = {}): SamsaraFeedPulse => ({
  id,
  label: id,
  state: "fresh",
  ageMinutes: 4,
  targetMinutes: 60,
  targetSource: "ruling",
  needsAttention: false,
  lead: `${id} arrived 4 minutes ago, inside the 1 hour this feed is held to.`,
  ...o,
});

/** As the route returns it: worst first. */
const FEEDS: SamsaraFeedPulse[] = [
  pulse("ifta", { state: "failing", needsAttention: true, ageMinutes: 4320, lead: "IFTA jurisdiction miles is being refused by Samsara." }),
  pulse("idle", { state: "late", needsAttention: true, ageMinutes: 900, lead: "Idle time last arrived 15 hours ago, past the 12 hours this feed is held to." }),
  pulse("telematics", { ageMinutes: 30, lead: "Per-fill corroboration arrived 30 minutes ago, inside the 1 hour this feed is held to." }),
  pulse("stats", { ageMinutes: 2, lead: "Live vehicle stats arrived 2 minutes ago, inside the 1 hour this feed is held to." }),
];

const mountFor = async (feeds: SamsaraFeedId[]) => {
  const w = mount(SamsaraFeedLine, { props: { feeds } });
  await flushPromises();
  return w;
};

beforeEach(() => {
  apiFetch.mockClear();
  fetched.ok = true;
  fetched.feeds = FEEDS;
});

describe("SamsaraFeedLine", () => {
  it("reads the ungated route, never the settings card's", async () => {
    // The pages this mounts on carry no section gate; the card's route is `settings: view`. Asking
    // for the card's payload here would 403 for most of the people the line is written for.
    await mountFor(["stats"]);
    expect(apiFetch).toHaveBeenCalledWith("/api/integrations/samsara/feed-pulse");
  });

  it("speaks only for the feeds the figures on this page are built from", async () => {
    // IFTA is worse and is nothing to do with a page about fuel corroboration. A strip scoped to all
    // eight tiers would report a breach the reader cannot act on where they are.
    const fuel = await mountFor(["stats", "telematics"]);
    expect(fuel.text()).toContain("Per-fill corroboration arrived 30 minutes ago");
    expect(fuel.text()).not.toContain("IFTA");

    expect((await mountFor(["ifta"])).text()).toContain("IFTA jurisdiction miles is being refused");
  });

  it("says something when every feed it watches is healthy, rather than disappearing", async () => {
    // The load-bearing property: an absent line would mean either "all well" or "this did not load",
    // and being unable to tell those apart is the failure this strip exists to remove.
    const w = await mountFor(["stats", "telematics"]);
    expect(w.find("[data-testid='samsara-feed-line']").exists()).toBe(true);
    expect(w.html()).not.toContain("bg-caution-50");
  });

  it("names the oldest of the healthy feeds, not the first one it was handed", async () => {
    expect((await mountFor(["stats", "telematics"])).text()).toContain("Per-fill corroboration");
    expect((await mountFor(["stats"])).text()).toContain("Live vehicle stats arrived 2 minutes ago");
  });

  it("raises its voice only for a feed that needs attention", async () => {
    expect((await mountFor(["stats"])).html()).not.toContain("bg-caution-50");
    expect((await mountFor(["idle"])).html()).toContain("bg-caution-50");
  });

  it("says nothing at all when it cannot tell, rather than breaking the page below it", async () => {
    fetched.ok = false;
    expect((await mountFor(["stats"])).find("[data-testid='samsara-feed-line']").exists()).toBe(false);

  });

  // ⚠ Its own case, and it watches the REJECTION rather than the DOM. A transport failure — offline,
  // DNS, a dropped connection — makes `apiFetch` reject rather than return `{ ok: false }`, and in an
  // async `onMounted` with no catch that is an unhandled rejection: the page keeps rendering, this
  // line stays empty, and the only evidence is a console the operator never sees. So asserting the
  // line is absent proves nothing — measured, by deleting the `try`/`catch` and watching all seven
  // assertions stay green. This is the one that fails.
  it("handles a transport failure rather than leaving a rejection loose", async () => {
    const loose: unknown[] = [];
    const onUnhandled = (e: unknown) => loose.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      apiFetch.mockRejectedValueOnce(new Error("offline"));
      const w = await mountFor(["stats"]);
      await new Promise((r) => setTimeout(r, 0)); // let the rejection reach the process
      expect(loose).toEqual([]);
      expect(w.find("[data-testid='samsara-feed-line']").exists()).toBe(false);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("says nothing about a page whose only tier is switched off", async () => {
    fetched.feeds = [pulse("ifta", { state: "disabled", targetMinutes: null, lead: "IFTA is switched off." })];
    expect((await mountFor(["ifta"])).find("[data-testid='samsara-feed-line']").exists()).toBe(false);
  });
});
